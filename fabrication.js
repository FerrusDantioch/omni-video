/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — fabrication.js
   Le moteur de l'export : fabrique le fichier MP4 final (image H.264,
   son AAC), image par image, sans jamais charger une vidéo entière.

   Comment ça marche, seconde après seconde :
   1. Le SON de cette seconde est mélangé : le son des clips, la musique
      de fond et les voix off, avec leurs volumes et leurs fondus.
   2. Les IMAGES de cette seconde (30 par seconde) sont dessinées sur une
      toile : le ou les clips (transitions comprises), puis les textes,
      les images incrustées et les sous-titres (rendu.js, comme l'aperçu).
   3. Mediabunny compresse le tout et l'écrit petit à petit dans le
      « disque privé » du navigateur (OPFS), jamais en mémoire vive.

   ⚠️ Les calculs de place, de transparence et de volume sont ceux de
   l'aperçu (Montage, Rendu, PistesAudio) : la vidéo finale ressemble
   exactement à ce qu'on a vu pendant le montage.
   ============================================================ */
'use strict';

const IMAGES_PAR_SECONDE = 30;
const FREQUENCE_SON = 48000;        // échantillons de son par seconde
const DEBIT_SON = 128000;           // 128 kbit/s : la qualité conseillée par YouTube
const DEBITS_VIDEO = { '1080p': 8000000, '720p': 5000000 };
const NOM_FICHIER_EXPORT = 'omnivideo-export.mp4';   // dans le disque privé du navigateur
const TAILLE_MAX_EN_MEMOIRE = 300 * 1024 * 1024;     // sans disque privé : 300 Mo au plus

/* La taille de l'image finale selon la forme et la qualité */
function tailleExport(format, qualite) {
  const grand = qualite === '1080p' ? 1920 : 1280;
  const petit = qualite === '1080p' ? 1080 : 720;
  return format === '9:16' ? { largeur: petit, hauteur: grand } : { largeur: grand, hauteur: petit };
}

/* Le poids estimé du fichier final, en octets */
function poidsEstime(duree, qualite) {
  return Math.round(duree * (DEBITS_VIDEO[qualite] + DEBIT_SON) / 8 * 1.03);
}

/* ---------- La puce vidéo de la tablette ----------
   Compresser les images est le plus long travail de la fabrication. La
   « puce vidéo » de la tablette le fait bien plus vite que le processeur,
   mais certaines ne connaissent pas le réglage « High » (celui choisi
   d'office) : on essaie donc aussi « Main » et « Baseline », un peu moins
   efficaces mais tout à fait bons pour YouTube. Si aucun ne passe par la
   puce, on garde les réglages ordinaires (le processeur).
   Renvoie { materiel: vrai/faux, codec, profil } (codec absent = ordinaire).
   Si la puce a déjà fait échouer une fabrication, on ne l'essaie plus. */
const CLE_SANS_MATERIEL = 'omnivideo-sans-materiel';
const _encodeurs = new Map();

function choisirEncodeur(largeur, hauteur, debit) {
  const cle = largeur + 'x' + hauteur + '-' + debit;
  if (lireReglage(CLE_SANS_MATERIEL) === 'oui') return Promise.resolve({ materiel: false });
  if (!_encodeurs.has(cle)) {
    _encodeurs.set(cle, (async () => {
      if (typeof VideoEncoder !== 'function') return { materiel: false };
      // Le « niveau » H.264 : 3.1 jusqu'au 720p, 4.0 au-delà (comme Mediabunny)
      const niveau = largeur * hauteur > 1280 * 720 ? '28' : '1f';
      for (const { profil, code } of PROFILS_H264) {
        const codec = 'avc1.' + code + niveau;
        const ok = await soutenu(() => VideoEncoder.isConfigSupported({
          codec, width: largeur, height: hauteur, bitrate: debit, framerate: IMAGES_PAR_SECONDE,
          hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' }
        }));
        if (ok) return { materiel: true, codec, profil };
      }
      return { materiel: false };
    })());
  }
  return _encodeurs.get(cle);
}

/* Les réglages de compression des images pour Mediabunny */
function reglagesImages(qualite, encodeur) {
  const reglages = { codec: 'avc', bitrate: DEBITS_VIDEO[qualite], keyFrameInterval: 2 };
  if (encodeur && encodeur.materiel) {
    reglages.fullCodecString = encodeur.codec;
    reglages.hardwareAcceleration = 'prefer-hardware';
  }
  return reglages;
}

/* Une fabrication a échoué alors que la puce vidéo travaillait : la
   prochaine fois, on passera par le processeur (réglages ordinaires). */
function noterEchecMateriel(erreur, encodeur) {
  if (!encodeur || !encodeur.materiel || !erreur) return;
  if (['Annulation', 'TropLongEnMemoire', 'QuotaExceededError', 'MorceauxIncompatibles'].includes(erreur.name)) return;
  ecrireReglage(CLE_SANS_MATERIEL, 'oui');
  _encodeurs.clear();
}

/* L'erreur levée quand on touche « Arrêter » : ce n'est pas un vrai souci */
class Annulation extends Error {
  constructor() { super('Fabrication arrêtée'); this.name = 'Annulation'; }
}


/* ---------- Cache des fichiers vidéo/audio ouverts pendant un export ----------
   Quand une même vidéo est découpée en plusieurs clips (coupes, « Enlever
   les blancs »…), on n'analyse son sommaire MP4 qu'une seule fois. */
class CacheEntrees {
  constructor() {
    this.entrees = new Map();   // mediaId → { entree, videoPret, pisteVideo, sonPret, pisteSon }
  }

  _obtenir(mediaId, fichier) {
    let e = this.entrees.get(mediaId);
    if (!e) {
      e = {
        entree: new Mediabunny.Input({ source: new Mediabunny.BlobSource(fichier), formats: Mediabunny.ALL_FORMATS }),
        videoPret: false, pisteVideo: null,
        sonPret: false, pisteSon: null
      };
      this.entrees.set(mediaId, e);
    }
    return e;
  }

  async pisteVideo(mediaId, fichier) {
    const e = this._obtenir(mediaId, fichier);
    if (!e.videoPret) {
      e.videoPret = true;
      try {
        const p = await e.entree.getPrimaryVideoTrack();
        if (p && await p.canDecode()) e.pisteVideo = p;
      } catch (err) { /* illisible */ }
    }
    return e.pisteVideo;
  }

  async pisteSon(mediaId, fichier) {
    const e = this._obtenir(mediaId, fichier);
    if (!e.sonPret) {
      e.sonPret = true;
      try {
        const p = await e.entree.getPrimaryAudioTrack();
        if (p && await p.canDecode()) e.pisteSon = p;
      } catch (err) { /* illisible ou format non géré par Mediabunny */ }
    }
    return e.pisteSon;
  }

  fermer() {
    for (const e of this.entrees.values()) e.entree.dispose();
    this.entrees.clear();
  }
}

/* Jusqu'où un même décodeur vidéo peut continuer sans fermer : si les clips
   suivants viennent du MÊME fichier, sans chevauchement et à moins de 3 s
   en avant (coupes, « Enlever les blancs »), un seul décodeur les enchaîne. */
const SAUT_REUTILISATION_VIDEO = 3;

function finCourseVideo(segments, i, finExport) {
  const seg0 = segments[i];
  const limite = Number.isFinite(finExport) ? finExport : Infinity;
  let fin = Montage.tempsFichier(seg0, Math.min(seg0.fin, limite));
  for (let j = i + 1; j < segments.length; j++) {
    const seg = segments[j];
    if (seg.debut >= limite) break;
    if (!seg.media || seg.media.id !== seg0.media.id) break;
    // Chevauchement (transition enchaînée / glissement) : il faut deux lecteurs distincts
    if (seg.debut < segments[j - 1].fin - 1e-6) break;
    const deb = seg.clip.debut;
    if (deb < fin - 0.02 || deb - fin > SAUT_REUTILISATION_VIDEO) break;
    fin = Montage.tempsFichier(seg, Math.min(seg.fin, limite));
  }
  return fin + 0.15;
}

/* ---------- Les images d'un clip vidéo ----------
   Lit les images d'un morceau de vidéo, dans l'ordre, une seule fois
   chacune. On garde au plus deux images à la fois (l'actuelle et la
   suivante), toujours refermées après usage. */
class SourceImages {
  constructor(fichier, debut, fin, options) {
    const opts = options || {};
    this.fichier = fichier;
    this.debut = debut;   // le moment de départ, en secondes DANS le fichier
    this.fin = Number.isFinite(fin) ? fin : Infinity;
    this.mediaId = opts.mediaId || null;
    this.cacheEntrees = opts.cacheEntrees || null;
    this.courante = null;
    this.suivante = null;
    this.tCourant = debut;
    this.fini = false;
  }

  async ouvrir() {
    let piste;
    if (this.cacheEntrees && this.mediaId) {
      piste = await this.cacheEntrees.pisteVideo(this.mediaId, this.fichier);
    } else {
      this.entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(this.fichier), formats: Mediabunny.ALL_FORMATS });
      const p = await this.entree.getPrimaryVideoTrack();
      piste = p && (await p.canDecode()) ? p : null;
    }
    if (!piste) { this.fini = true; return; }
    // Passer la fin évite de décoder inutilement des images au-delà du clip
    this.lecture = new Mediabunny.VideoSampleSink(piste).samples(this.debut, this.fin);
  }

  async _lireSuivante() {
    if (this.fini) return null;
    const r = await this.lecture.next();
    if (r.done) { this.fini = true; return null; }
    return r.value;
  }

  /* L'image à montrer au moment t (en secondes dans le fichier) : la
     dernière qui commence avant t (ou la première, au tout début). */
  async imageA(t) {
    if (!this.courante) this.courante = await this._lireSuivante();
    for (;;) {
      if (!this.suivante) this.suivante = await this._lireSuivante();
      if (!this.suivante || this.suivante.timestamp > t + 0.001) break;
      if (this.courante) this.courante.close();
      this.courante = this.suivante;
      this.suivante = null;
    }
    if (this.courante) this.tCourant = this.courante.timestamp;
    return this.courante;
  }

  async fermer() {
    if (this.courante) this.courante.close();
    if (this.suivante) this.suivante.close();
    this.courante = this.suivante = null;
    try { if (this.lecture) await this.lecture.return(); } catch (e) { /* déjà fermé */ }
    if (this.entree) this.entree.dispose();
  }
}


/* ---------- Le son d'un fichier ----------
   Lit le son d'un fichier (vidéo, musique, voix) petit à petit, dans
   l'ordre, et l'ajoute au mélange. Si le fichier n'a pas la même
   fréquence que la vidéo finale (44 100 au lieu de 48 000 échantillons
   par seconde, par exemple), le son est « réétiré » en douceur. */
class SourceSon {
  constructor(media, fichier, cacheEntrees) {
    this.media = media;
    this.fichier = fichier;
    this.cacheEntrees = cacheEntrees || null;
    this.morceaux = [];   // [{ debut (n° d'échantillon), g, d (gauche, droite) }]
    this.finCharge = -Infinity;
    this.fini = false;
    this.muet = false;
    this._aEuMorceau = false;
    this._pisteVide = false;
    this._debutLecture = Infinity;
    this._g = new Float32Array(0);
    this._d = new Float32Array(0);
  }

  async ouvrir() {
    try {
      let piste;
      if (this.cacheEntrees) {
        piste = await this.cacheEntrees.pisteSon(this.media.id, this.fichier);
      } else {
        this.entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(this.fichier), formats: Mediabunny.ALL_FORMATS });
        const p = await this.entree.getPrimaryAudioTrack();
        piste = p && (await p.canDecode()) ? p : null;
      }
      if (piste) {
        // AudioSampleSink lit directement les nombres du son (sans créer d'AudioBuffer à chaque trame)
        this.sink = new Mediabunny.AudioSampleSink(piste);
        this.frequence = piste.sampleRate;
        return;
      }
    } catch (e) { /* format inconnu de Mediabunny : on essaie autrement */ }
    if (this.entree) { this.entree.dispose(); this.entree = null; }
    // Plan B pour une musique (fichier léger) : le décodeur du navigateur,
    // qui lit tout le fichier d'un coup
    if (this.media.type === 'audio' && this.fichier.size < 150 * 1024 * 1024) {
      try {
        const contexte = new OfflineAudioContext(2, 1, FREQUENCE_SON);
        const tampon = await contexte.decodeAudioData(await this.fichier.arrayBuffer());
        const g = tampon.getChannelData(0);
        const d = tampon.numberOfChannels > 1 ? tampon.getChannelData(1) : g;
        this.morceaux.push({ debut: 0, g, d });
        this.finCharge = g.length;
        this.frequence = tampon.sampleRate;
        this.fini = true;
        return;
      } catch (e) { /* illisible */ }
    }
    this.muet = true;
  }

  _ajouterEchantillon(echantillon) {
    try {
      const nb = echantillon.numberOfFrames;
      const debut = Math.round(echantillon.timestamp * this.frequence);
      const g = new Float32Array(nb);
      echantillon.copyTo(g, { planeIndex: 0, format: 'f32-planar' });
      let d = g;
      if (echantillon.numberOfChannels > 1) {
        d = new Float32Array(nb);
        echantillon.copyTo(d, { planeIndex: 1, format: 'f32-planar' });
      }
      this.morceaux.push({ debut, g, d });
      this.finCharge = Math.max(this.finCharge, debut + nb);
    } finally {
      echantillon.close();
    }
  }

  /* Prépare les échantillons de f0 à f1 (numéros dans le fichier) */
  async _charger(f0, f1) {
    if (!this.sink || this._pisteVide) return;
    const premier = this.morceaux[0];
    // Retour en arrière (musique qui recommence) ou grand saut : on
    // reprend la lecture à cet endroit
    const aReouvrir = !this.lecture ||
      (premier ? f0 < premier.debut - 2 : f0 < this.finCharge) ||
      (f0 > this.finCharge + this.frequence * 2 && !(this.fini && !this._aEuMorceau && f0 >= this._debutLecture));
    if (aReouvrir) {
      if (this.lecture) { try { await this.lecture.return(); } catch (e) { /* déjà fermé */ } }
      const depart = Math.max(0, f0 / this.frequence - 0.05);
      this.lecture = this.sink.samples(depart);
      this.morceaux = [];
      this.finCharge = -Infinity;
      this.fini = false;
      this._aEuMorceau = false;
      this._debutLecture = depart === 0 ? 0 : f0;
    }
    while (this.finCharge < f1 && !this.fini) {
      const r = await this.lecture.next();
      if (r.done) {
        this.fini = true;
        if (!this._aEuMorceau && this._debutLecture === 0) this._pisteVide = true;
        break;
      }
      this._aEuMorceau = true;
      this._ajouterEchantillon(r.value);
    }
    // Les morceaux déjà joués sont oubliés (la mémoire reste petite)
    let garder = 0;
    while (garder < this.morceaux.length && this.morceaux[garder].debut + this.morceaux[garder].g.length < f0 - 1) garder++;
    if (garder > 0) this.morceaux.splice(0, garder);
  }

  /* Ajoute le son au mélange (tableaux gauche et droite de la vidéo finale)
     - de la case ia à la case ib (exclue) des tableaux ;
     - tSortie : le moment de la case ia dans la vidéo finale ;
     - tSource : le moment correspondant DANS le fichier ;
     - gainA(t) : le volume au moment t de la vidéo finale ;
     - vitesse : 2 = le fichier est lu deux fois plus vite (son plus aigu). */
  async ajouter(gauche, droite, ia, ib, tSortie, tSource, gainA, vitesse) {
    if (this.muet || ib <= ia) return;
    const fr = this.frequence;
    const n = ib - ia;
    const vit = vitesse || 1;
    const f0 = Math.floor(tSource * fr);
    const f1 = Math.ceil((tSource + n * vit / FREQUENCE_SON) * fr) + 2;
    await this._charger(f0, f1);

    // On recopie d'abord ces échantillons dans deux tableaux continus (réutilisés)
    const taille = f1 - f0 + 1;
    if (this._g.length < taille) {
      this._g = new Float32Array(taille);
      this._d = new Float32Array(taille);
    }
    const g = this._g.subarray(0, taille);
    const d = this._d.subarray(0, taille);
    g.fill(0);
    d.fill(0);
    for (let mIdx = 0; mIdx < this.morceaux.length; mIdx++) {
      const m = this.morceaux[mIdx];
      const a = Math.max(f0, m.debut);
      const b = Math.min(f1 + 1, m.debut + m.g.length);
      if (b <= a) continue;
      g.set(m.g.subarray(a - m.debut, b - m.debut), a - f0);
      d.set(m.d.subarray(a - m.debut, b - m.debut), a - f0);
    }

    // Puis on les ajoute au mélange, en ajustant la fréquence et le volume.
    // Le volume est calculé tous les 128 échantillons (moins de 3 millièmes
    // de seconde) et glisse en douceur entre deux calculs.
    const pas = fr / FREQUENCE_SON * vit;
    const depart = tSource * fr - f0;
    const direct = fr === FREQUENCE_SON && vit === 1 && Math.abs(depart) < 1e-4;
    const BLOC = 128;
    for (let k0 = 0; k0 < n; k0 += BLOC) {
      const k1 = Math.min(n, k0 + BLOC);
      const v0 = gainA(tSortie + k0 / FREQUENCE_SON);
      const v1 = gainA(tSortie + k1 / FREQUENCE_SON);
      if (v0 <= 0 && v1 <= 0) continue;
      const dv = (v1 - v0) / (k1 - k0);
      let v = v0;
      if (direct) {
        // Même fréquence (48 kHz) et vitesse normale : addition directe, sans réétirer
        for (let k = k0; k < k1; k++, v += dv) {
          gauche[ia + k] += g[k] * v;
          droite[ia + k] += d[k] * v;
        }
      } else {
        for (let k = k0; k < k1; k++, v += dv) {
          const pos = depart + k * pas;
          const j = pos | 0;
          const f = pos - j;
          gauche[ia + k] += (g[j] + (g[j + 1] - g[j]) * f) * v;
          droite[ia + k] += (d[j] + (d[j + 1] - d[j]) * f) * v;
        }
      }
    }
  }

  async fermer() {
    try { if (this.lecture) await this.lecture.return(); } catch (e) { /* déjà fermé */ }
    if (this.entree) this.entree.dispose();
    this.morceaux = [];
    this._g = this._d = new Float32Array(0);
  }
}


/* ---------- Le mélange du son ----------
   Mélange, seconde après seconde, le son des clips vidéo, la musique de
   fond et les voix off, avec leurs volumes et leurs fondus (les mêmes
   calculs que l'aperçu). Quand le volume est harmonisé, on s'en sert deux
   fois : d'abord pour mesurer le volume, puis pour fabriquer la vidéo. */
class Melangeur {
  constructor(projet, segments, total, avertissements, cacheEntrees) {
    this.projet = projet;
    this.segments = segments;
    this.total = total;
    this.avertissements = avertissements;
    this.cacheEntrees = cacheEntrees || null;
    this.sons = new Map();   // clé (clip ou piste) → SourceSon
    this.echantillon = 0;    // le prochain échantillon à fabriquer
    // Un seul tableau réutilisé d'une seconde à l'autre (gauche puis droite)
    this.tampon = new Float32Array(2 * FREQUENCE_SON);
    // Les pistes audio (musique, voix) qui peuvent être lues
    this.pistes = projet.pistes.map((p) => ({ piste: p, media: projet.medias.find((m) => m.id === p.mediaId) }))
      .filter((x) => x.media && Medias.fichiers.has(x.media.id));
    this.voix = PistesAudio.indexerVoix(projet, total);
    // Dernière seconde où chaque média vidéo sert encore (pour garder son lecteur ouvert entre deux coupes)
    this.derniereFinMedia = new Map();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.media.type === 'video' && seg.media.aSon && seg.clip.volume > 0) {
        this.derniereFinMedia.set(seg.media.id, Math.max(this.derniereFinMedia.get(seg.media.id) || 0, seg.fin));
      }
    }
  }

  /* Le son d'un segment ou d'une piste (ouvert la première fois) */
  async _sonDe(cle, media) {
    let s = this.sons.get(cle);
    if (!s) {
      s = new SourceSon(media, Medias.fichiers.get(media.id), this.cacheEntrees);
      await s.ouvrir();
      const avertissement = 'Le son de « ' + media.nom + ' » n\'a pas pu être lu : ce passage sera sans ce son.';
      if (s.muet && !this.avertissements.includes(avertissement)) this.avertissements.push(avertissement);
      this.sons.set(cle, s);
    }
    return s;
  }

  /* Le son de la seconde n° « seconde » : { donnees, gauche, droite, t, n }.
     ⚠️ « donnees », « gauche » et « droite » partagent le même tableau : ils
     doivent être utilisés avant le prochain appel à suivante(). */
  async suivante(seconde) {
    const { projet, segments, total } = this;
    const finBloc = Math.min(total, seconde + 1);
    const e0 = this.echantillon;
    const e1 = Math.round(finBloc * FREQUENCE_SON);
    const n = e1 - e0;
    const donnees = this.tampon.subarray(0, 2 * n);
    donnees.fill(0);
    const gauche = donnees.subarray(0, n);
    const droite = donnees.subarray(n, 2 * n);
    const tBloc = e0 / FREQUENCE_SON;

    // Deux clips du même fichier qui se chevauchent pendant cette seconde ?
    const actifsParMedia = new Map();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.fin <= tBloc || seg.debut >= finBloc) continue;
      if (seg.media.type !== 'video' || !seg.media.aSon || seg.clip.volume <= 0) continue;
      actifsParMedia.set(seg.media.id, (actifsParMedia.get(seg.media.id) || 0) + 1);
    }

    // Le son des clips vidéo
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.fin <= tBloc || seg.debut >= finBloc) continue;
      if (seg.media.type !== 'video' || !seg.media.aSon || seg.clip.volume <= 0) continue;
      const ia = Math.max(0, Math.round(seg.debut * FREQUENCE_SON) - e0);
      const ib = Math.min(n, Math.round(seg.fin * FREQUENCE_SON) - e0);
      if (ib <= ia) continue;
      const tSortie = (e0 + ia) / FREQUENCE_SON;
      // Sans chevauchement, on partage le même lecteur audio d'un clip à l'autre du même fichier
      const cle = actifsParMedia.get(seg.media.id) > 1 ? 'clip' + i : 'media' + seg.media.id;
      const s = await this._sonDe(cle, seg.media);
      await s.ajouter(gauche, droite, ia, ib, tSortie, Montage.tempsFichier(seg, tSortie),
        (t) => seg.clip.volume * Montage.etat(projet, segments, i, t).son, Montage.vitesse(seg));
    }
    // La musique de fond et les voix off
    for (const { piste, media } of this.pistes) {
      const duree = PistesAudio.duree(piste, total);
      const finPiste = piste.debut + duree;
      if (finPiste <= tBloc || piste.debut >= finBloc) continue;
      let ia = Math.max(0, Math.round(piste.debut * FREQUENCE_SON) - e0);
      const ib = Math.min(n, Math.round(finPiste * FREQUENCE_SON) - e0);
      const s = await this._sonDe('piste' + piste.id, media);
      const gainA = (t) => PistesAudio.volumeA(piste, t, total, projet, this.voix);
      // Une musique qui recommence au début pendant cette seconde : en deux fois
      while (ia < ib) {
        const tSortie = (e0 + ia) / FREQUENCE_SON;
        const position = PistesAudio.positionA(piste, media, tSortie);
        let jusque = ib;
        if (piste.type === 'musique' && media.duree > 0) {
          jusque = Math.min(ib, ia + Math.max(1, Math.round((media.duree - position) * FREQUENCE_SON)));
        }
        await s.ajouter(gauche, droite, ia, jusque, tSortie, position, gainA);
        ia = jusque;
      }
    }

    // Les sons terminés sont fermés (ils ne resserviront pas)
    for (const [cle, s] of this.sons) {
      let fini = false;
      if (cle.startsWith('clip')) {
        fini = segments[Number(cle.slice(4))].fin <= finBloc;
      } else if (cle.startsWith('media')) {
        fini = (this.derniereFinMedia.get(cle.slice(5)) || 0) <= finBloc;
      } else if (cle.startsWith('piste')) {
        const piste = projet.pistes.find((p) => 'piste' + p.id === cle);
        fini = !piste || piste.debut + PistesAudio.duree(piste, total) <= finBloc;
      }
      if (fini) { await s.fermer(); this.sons.delete(cle); }
    }
    this.echantillon = e1;
    return { donnees, gauche, droite, t: tBloc, n };
  }

  async fermer() {
    for (const s of this.sons.values()) await s.fermer();
    this.sons.clear();
  }
}


/* ---------- Le volume harmonisé ----------
   YouTube joue toutes les vidéos à peu près au même volume : une vidéo
   trop forte est baissée, une vidéo trop faible reste… trop faible. On
   mesure donc le volume « ressenti » de toute la vidéo (la mesure LUFS,
   celle des télévisions et de YouTube), puis on règle le son pour
   arriver au niveau conseillé : −14 LUFS. */
const VOLUME_CIBLE = -14;          // LUFS, le niveau de YouTube
const GAIN_MAX_DB = 15;            // on ne monte jamais le son de plus de 15 dB (le souffle monterait aussi)…
const GAIN_MIN_DB = -12;           // … ni ne le baisse de plus de 12 dB
const PLAFOND_SON = 0.89;          // −1 dB : le son ne touche jamais le maximum
const PART_MESURE = 0.08;          // part de la barre de progression pour la mesure

class MesureVolume {
  constructor() {
    // Le filtre « K » de la mesure LUFS (norme UIT BS.1770, à 48 kHz) :
    // l'oreille entend moins les graves et un peu plus les aigus
    this.etats = new Float64Array(16);   // 2 canaux × 2 filtres × (x1, x2, y1, y2)
    this.taille = FREQUENCE_SON / 10;   // des morceaux de 0,1 seconde
    this.somme = 0;
    this.compte = 0;
    this.morceaux = [];                 // énergie moyenne de chaque morceau de 0,1 s
  }

  ajouter(gauche, droite) {
    // Les constantes du filtre gardées dans des variables simples :
    // beaucoup plus rapide sur des millions d'échantillons
    const b0 = 1.53512485958697, b1 = -2.69169618940638, b2 = 1.19839281085285;
    const a1 = -1.69065929318241, a2 = 0.73248077421585;
    const c1 = -1.99004745483398, c2 = 0.99007225036621;
    const e = this.etats;
    let gx1 = e[0], gx2 = e[1], gy1 = e[2], gy2 = e[3];
    let g2x1 = e[4], g2x2 = e[5], g2y1 = e[6], g2y2 = e[7];
    let dx1 = e[8], dx2 = e[9], dy1 = e[10], dy2 = e[11];
    let d2x1 = e[12], d2x2 = e[13], d2y1 = e[14], d2y2 = e[15];
    const taille = this.taille;
    const morceaux = this.morceaux;
    let somme = this.somme;
    let compte = this.compte;

    for (let k = 0; k < gauche.length; k++) {
      const xg = gauche[k];
      const yg = b0 * xg + b1 * gx1 + b2 * gx2 - a1 * gy1 - a2 * gy2;
      gx2 = gx1; gx1 = xg; gy2 = gy1; gy1 = yg;
      const g = yg - 2 * g2x1 + g2x2 - c1 * g2y1 - c2 * g2y2;
      g2x2 = g2x1; g2x1 = yg; g2y2 = g2y1; g2y1 = g;

      const xd = droite[k];
      const yd = b0 * xd + b1 * dx1 + b2 * dx2 - a1 * dy1 - a2 * dy2;
      dx2 = dx1; dx1 = xd; dy2 = dy1; dy1 = yd;
      const d = yd - 2 * d2x1 + d2x2 - c1 * d2y1 - c2 * d2y2;
      d2x2 = d2x1; d2x1 = yd; d2y2 = d2y1; d2y1 = d;

      somme += g * g + d * d;
      if (++compte === taille) {
        morceaux.push(somme / taille);
        somme = 0;
        compte = 0;
      }
    }
    e[0] = gx1; e[1] = gx2; e[2] = gy1; e[3] = gy2;
    e[4] = g2x1; e[5] = g2x2; e[6] = g2y1; e[7] = g2y2;
    e[8] = dx1; e[9] = dx2; e[10] = dy1; e[11] = dy2;
    e[12] = d2x1; e[13] = d2x2; e[14] = d2y1; e[15] = d2y2;
    this.somme = somme;
    this.compte = compte;
  }

  /* Le volume de toute la vidéo, en LUFS (-Infinity si silencieuse) */
  volume() {
    // Des fenêtres de 0,4 s qui se chevauchent (4 morceaux de 0,1 s)
    const blocs = [];
    for (let i = 0; i + 4 <= this.morceaux.length; i++) {
      blocs.push((this.morceaux[i] + this.morceaux[i + 1] + this.morceaux[i + 2] + this.morceaux[i + 3]) / 4);
    }
    const lufs = (z) => -0.691 + 10 * Math.log10(z);
    const moyenne = (liste) => liste.reduce((a, b) => a + b, 0) / liste.length;
    // On ignore les silences (sous −70), puis ce qui est 10 fois plus faible que la moyenne
    const audibles = blocs.filter((z) => lufs(z) > -70);
    if (!audibles.length) return -Infinity;
    const seuil = lufs(moyenne(audibles)) - 10;
    const retenus = audibles.filter((z) => lufs(z) > seuil);
    return lufs(moyenne(retenus));
  }
}

/* Écoute tout le son de la vidéo et renvoie le réglage de volume
   (progres(f) : f de 0 à 1) */
async function mesurerGain(projet, segments, total, avertissements, verifier, progres, cacheEntrees) {
  const mesure = new MesureVolume();
  const ecoute = new Melangeur(projet, segments, total, avertissements, cacheEntrees);
  try {
    for (let seconde = 0; seconde < total; seconde++) {
      verifier();
      const { gauche, droite } = await ecoute.suivante(seconde);
      mesure.ajouter(gauche, droite);
      progres(Math.min(total, seconde + 1) / total);
    }
  } finally {
    await ecoute.fermer();
  }
  return gainPourVolume(mesure.volume());
}

/* Le réglage de volume (multiplicateur) pour arriver au niveau conseillé */
function gainPourVolume(lufs) {
  if (!Number.isFinite(lufs)) return 1;   // vidéo sans son
  const db = borner(VOLUME_CIBLE - lufs, GAIN_MIN_DB, GAIN_MAX_DB);
  return Math.pow(10, db / 20);
}

/* Le limiteur : quand le son (une fois monté) dépasserait le plafond, il
   est baissé tout de suite, juste ce qu'il faut, puis remonte en douceur
   (en un dixième de seconde environ). Il garde son état d'une seconde à
   l'autre. */
class Limiteur {
  constructor() {
    this.reduction = 1;   // 1 = rien n'est baissé
    this.remontee = 1 - Math.exp(-1 / (0.1 * FREQUENCE_SON));
  }

  appliquer(gauche, droite, gain) {
    let r = this.reduction;
    for (let k = 0; k < gauche.length; k++) {
      const g = gauche[k] * gain;
      const d = droite[k] * gain;
      const crete = Math.max(Math.abs(g), Math.abs(d));
      const besoin = crete > PLAFOND_SON ? PLAFOND_SON / crete : 1;
      r = besoin < r ? besoin : r + (1 - r) * this.remontee;
      if (r > besoin) r = besoin;
      gauche[k] = g * r;
      droite[k] = d * r;
    }
    this.reduction = r;
  }
}


/* ---------- L'encodeur AAC de secours ----------
   Certaines tablettes (et le navigateur de test) ne savent pas fabriquer
   le son AAC demandé par YouTube. On charge alors l'encodeur de secours
   fourni avec l'application (encodeur-aac.js et encodeur-aac.wasm :
   l'encodeur de VisualOn, voir CREDITS.md). Il n'est chargé que si besoin. */
let aacDeSecours = false;

async function preparerAac() {
  const options = { numberOfChannels: 2, sampleRate: FREQUENCE_SON, bitrate: DEBIT_SON };
  if (await Mediabunny.canEncodeAudio('aac', options)) return true;
  if (!aacDeSecours) {
    await new Promise((reussir, echouer) => {
      const script = document.createElement('script');
      script.src = './encodeur-aac.js';
      script.onload = reussir;
      script.onerror = () => echouer(new Error('Encodeur AAC de secours introuvable'));
      document.head.appendChild(script);
    });
    aacDeSecours = true;   // encodeur-aac.js se présente tout seul à Mediabunny
  }
  return Mediabunny.canEncodeAudio('aac', options);
}


/* ---------- Le disque privé du navigateur (OPFS) ---------- */
const DisquePrive = {
  async dossier() {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    try { return await navigator.storage.getDirectory(); } catch (e) { return null; }
  },

  /* La dernière vidéo fabriquée, si elle est encore là (sinon null) */
  async dernierExport() {
    const dossier = await this.dossier();
    if (!dossier) return null;
    try {
      const fichier = await (await dossier.getFileHandle(NOM_FICHIER_EXPORT)).getFile();
      return fichier.size > 0 ? fichier : null;
    } catch (e) {
      return null;
    }
  },

  async effacer() {
    const dossier = await this.dossier();
    if (dossier) await dossier.removeEntry(NOM_FICHIER_EXPORT).catch(() => {});
  },

  /* Place occupée dans le disque privé par les fichiers d'export et de reprise d'Omni-Vidéo */
  async tailleFichiersExport() {
    const dossier = await this.dossier();
    if (!dossier) return 0;
    let total = 0;
    if (typeof dossier.entries === 'function') {
      try {
        for await (const [nom, poignee] of dossier.entries()) {
          if (poignee.kind !== 'file') continue;
          if (nom === NOM_FICHIER_EXPORT || (typeof NOM_FICHIER_SON !== 'undefined' && nom === NOM_FICHIER_SON) || nom.startsWith('omnivideo-partie-')) {
            const f = await poignee.getFile().catch(() => null);
            if (f) total += f.size;
          }
        }
        return total;
      } catch (e) { /* repli ci-dessous */ }
    }
    const dernier = await this.dernierExport();
    return dernier ? dernier.size : 0;
  },

  /* Crée le fichier « nom » (vide) et renvoie { poignee, flux } pour
     l'écrire petit à petit, ou null si la tablette ne sait pas.
     Deux façons d'écrire :
     - createWritable(), depuis la page (Chrome sur ordinateur, récent) ;
     - sinon un travailleur (disque-prive.js) avec createSyncAccessHandle(),
       ce que Chrome sur Android sait faire. */
  async ouvrirFichier(nom) {
    const dossier = await this.dossier();
    if (!dossier) return null;
    let poignee;
    try {
      await dossier.removeEntry(nom).catch(() => {});
      poignee = await dossier.getFileHandle(nom, { create: true });
    } catch (e) {
      return null;
    }
    if (typeof poignee.createWritable === 'function') {
      try { return { poignee, flux: await poignee.createWritable() }; } catch (e) { /* on essaie l'autre façon */ }
    }
    try {
      return { poignee, flux: await fluxParTravailleur(nom) };
    } catch (e) {
      await dossier.removeEntry(nom).catch(() => {});
      return null;
    }
  },

  /* Le disque privé marche-t-il vraiment ? (essai avec un tout petit
     fichier, fait une seule fois par visite) */
  peutEcrire() {
    if (!this._essai) {
      this._essai = (async () => {
        const ouvert = await this.ouvrirFichier('omnivideo-test.tmp');
        if (!ouvert) return false;
        try {
          const ecrivain = ouvert.flux.getWriter();
          await ecrivain.write({ type: 'write', data: new Uint8Array([1, 2, 3]), position: 0 });
          await ecrivain.close();
          return (await ouvert.poignee.getFile()).size === 3;
        } catch (e) {
          await ouvert.flux.abort().catch(() => {});
          return false;
        } finally {
          const dossier = await this.dossier();
          if (dossier) await dossier.removeEntry('omnivideo-test.tmp').catch(() => {});
        }
      })();
    }
    return this._essai;
  }
};

/* Un flux d'écriture (WritableStream, comme celui de createWritable())
   qui confie chaque morceau au travailleur disque-prive.js. Il attend que
   chaque morceau soit écrit avant d'accepter le suivant : la mémoire vive
   ne garde jamais plus d'un morceau (8 Mo). */
async function fluxParTravailleur(nom) {
  const travailleur = new Worker('./disque-prive.js');
  const attentes = new Map();   // n° du message → sa promesse
  let numero = 0;
  let arrete = false;
  let promesseFermeture = null;
  const toutRefuser = (erreur) => {
    for (const a of attentes.values()) a.echec(erreur);
    attentes.clear();
  };
  travailleur.onmessage = (e) => {
    const a = attentes.get(e.data.n);
    if (!a) return;
    attentes.delete(e.data.n);
    if (e.data.ok) { a.reussite(); return; }
    const erreur = new Error(e.data.message);
    erreur.name = e.data.nom;
    a.echec(erreur);
  };
  travailleur.onerror = (e) => {
    e.preventDefault();
    arrete = true;
    travailleur.terminate();
    toutRefuser(new Error('Le travailleur du disque privé s\'est arrêté'));
  };
  const demander = (message, transfert) => new Promise((reussite, echec) => {
    if (arrete) { echec(new Error('Fichier déjà fermé')); return; }
    message.n = ++numero;
    attentes.set(message.n, { reussite, echec });
    travailleur.postMessage(message, transfert || []);
  });
  // Fermer le fichier (le reste du programme pourra le relire ou l'effacer)
  const fermer = () => {
    if (promesseFermeture) return promesseFermeture;
    promesseFermeture = (async () => {
      if (arrete) return;
      try {
        await avecDelai(demander({ type: 'fermer' }), 5000);
      } finally {
        arrete = true;
        travailleur.terminate();
        toutRefuser(new Error('Fichier fermé'));
      }
    })();
    return promesseFermeture;
  };

  try {
    await avecDelai(demander({ type: 'ouvrir', nom }), 5000);
  } catch (e) {
    arrete = true;
    travailleur.terminate();
    throw e;
  }

  return new WritableStream({
    // morceau = { type: 'write', data, position }, envoyé par Mediabunny
    async write(morceau) {
      // Un morceau complet (cas habituel des blocs de 8 Mo) peut être transféré
      // sans recopie mémoire au travailleur (Mediabunny ne l'utilise plus ensuite)
      const complet = morceau.data.byteOffset === 0 && morceau.data.byteLength === morceau.data.buffer.byteLength;
      const donnees = complet ? morceau.data : morceau.data.slice();
      try {
        await demander({ type: 'ecrire', position: morceau.position, donnees }, [donnees.buffer]);
      } catch (erreur) {
        // Le fichier est relâché tout de suite, pour pouvoir l'effacer
        await fermer().catch(() => {});
        throw erreur;
      }
    },
    close: fermer,
    abort: () => fermer().catch(() => {})
  });
}


/* ---------- Fabriquer la vidéo ----------
   projet : le projet à exporter ;
   reglages : { qualite: '720p' | '1080p' } (la forme est celle du projet) ;
   suivi(etat) : appelé régulièrement avec { fait (0 à 1), image, images, etape } ;
   arret : objet { demande: false } ; mettre demande à vrai pour arrêter.
   Renvoie { fichier, avertissements }. */
async function fabriquerVideo(projet, reglages, suivi, arret) {
  const { largeur, hauteur } = tailleExport(projet.format, reglages.qualite);
  const segments = Montage.segments(projet);
  const total = segments.length ? segments[segments.length - 1].fin : 0;
  if (total <= 0) throw new Error('Montage vide');
  const nbImages = Math.ceil(total * IMAGES_PAR_SECONDE - 1e-6);
  const avertissements = [];
  const ajustement = projet.ajustement === 'remplir' ? 'cover' : 'contain';
  const verifier = () => { if (arret.demande) throw new Annulation(); };

  suivi({ fait: 0, image: 0, images: nbImages, etape: 'preparation' });

  // 1. Tout ce qui doit être prêt avant la première image
  await Rendu.chargerPolices();
  await Rendu.preparerImages(projet);
  if (!(await Mediabunny.canEncodeVideo('avc', { width: largeur, height: hauteur, bitrate: DEBITS_VIDEO[reglages.qualite] }))) {
    const e = new Error('Encodage H.264 impossible');
    e.name = 'EncodageImpossible';
    throw e;
  }
  if (!(await preparerAac())) {
    const e = new Error('Encodage AAC impossible');
    e.name = 'SonImpossible';
    throw e;
  }
  verifier();

  // Une longue vidéo se fabrique par morceaux, gardés sur la tablette :
  // si la fabrication est interrompue, on pourra la reprendre (reprise.js)
  if (total > SEUIL_PARTIES && lireReglage(CLE_SANS_PARTIES) !== 'oui' && await DisquePrive.peutEcrire()) {
    return fabriquerParParties(projet, reglages, suivi, arret,
      { largeur, hauteur, segments, total, nbImages, avertissements, ajustement, verifier });
  }
  // La puce vidéo, si elle sait compresser ces images (bien plus rapide)
  const encodeur = await choisirEncodeur(largeur, hauteur, DEBITS_VIDEO[reglages.qualite]);
  const cacheEntrees = new CacheEntrees();
  const cachePhotos = new Map();
  const mediasParId = new Map(projet.medias.map((m) => [m.id, m]));
  const viderCaches = () => {
    cacheEntrees.fermer();
    cachePhotos.forEach((c) => libererToile(c));
    cachePhotos.clear();
  };

  // 1 bis. Volume harmonisé : on écoute d'abord tout le son de la vidéo
  //    pour mesurer son volume (rapide : aucune image n'est dessinée)
  const departChrono = performance.now();
  const partMesure = reglages.harmoniser ? PART_MESURE : 0;
  let gain = 1;
  try {
    if (reglages.harmoniser) {
      gain = await mesurerGain(projet, segments, total, avertissements, verifier, (f) => suivi({
        fait: partMesure * f, image: 0, images: nbImages, etape: 'mesure',
        ecoule: (performance.now() - departChrono) / 1000
      }), cacheEntrees);
    }
  } catch (erreur) {
    viderCaches();
    throw erreur;
  }
  const limiteur = new Limiteur();

  // 2. Où écrire : le disque privé (même une vidéo de 30 minutes), ou la
  //    mémoire vive s'il n'existe pas (vidéos courtes seulement)
  let cible;
  const ouvert = await DisquePrive.ouvrirFichier(NOM_FICHIER_EXPORT);
  const poignee = ouvert ? ouvert.poignee : null;
  const flux = ouvert ? ouvert.flux : null;
  if (flux) {
    cible = new Mediabunny.StreamTarget(flux, { chunked: true, chunkSize: 8 * 1024 * 1024 });
  } else {
    if (poidsEstime(total, reglages.qualite) > TAILLE_MAX_EN_MEMOIRE) {
      viderCaches();
      const e = new Error('Pas de disque privé');
      e.name = 'TropLongEnMemoire';
      throw e;
    }
    cible = new Mediabunny.BufferTarget();
  }

  // 3. La toile où chaque image est dessinée, et le fichier de sortie
  const toile = nouvelleToile(largeur, hauteur);
  const ctx = toile.getContext('2d', { alpha: false });
  try {
    const sortie = new Mediabunny.Output({
      format: new Mediabunny.Mp4OutputFormat({ fastStart: flux ? false : 'in-memory' }),
      target: cible
    });
    const sourceImages = new Mediabunny.CanvasSource(toile, reglagesImages(reglages.qualite, encodeur));
    const sourceSon = new Mediabunny.AudioSampleSource({ codec: 'aac', bitrate: DEBIT_SON });
    sortie.addVideoTrack(sourceImages, { frameRate: IMAGES_PAR_SECONDE });
    sortie.addAudioTrack(sourceSon);
    sortie.setMetadataTags({ title: projet.nom });

    const imagesOuvertes = new Map();   // n° de segment → SourceImages
    const sonsOuverts = [];             // le mélangeur du son
    const fermerTout = async () => {
      for (const s of imagesOuvertes.values()) await s.fermer();
      for (const s of sonsOuverts) await s.fermer();
      imagesOuvertes.clear();
      sonsOuverts.length = 0;
      viderCaches();
    };

    try {
      await sortie.start();

      let image = 0;
      const melange = new Melangeur(projet, segments, total, avertissements, cacheEntrees);
      sonsOuverts.push(melange);
      const optionsDessin = { cacheEntrees, cachePhotos, mediasParId, finExport: total, curseur: { i: 0 } };
      for (let seconde = 0; seconde < total; seconde++) {
        verifier();
        const finBloc = Math.min(total, seconde + 1);

        // ----- 1. Le son de cette seconde -----
        const { donnees, gauche, droite, t: tBloc } = await melange.suivante(seconde);
        // Le volume harmonisé, puis le limiteur : jamais de grésillement
        limiteur.appliquer(gauche, droite, gain);
        const morceauSon = new Mediabunny.AudioSample({
          data: donnees, format: 'f32-planar', numberOfChannels: 2, sampleRate: FREQUENCE_SON, timestamp: tBloc
        });
        try {
          await sourceSon.add(morceauSon);
        } finally {
          morceauSon.close();
        }

        // ----- 2. Les images de cette seconde -----
        while (image < nbImages && image / IMAGES_PAR_SECONDE < finBloc - 1e-9) {
          verifier();
          const t = image / IMAGES_PAR_SECONDE;
          await dessinerImage(ctx, largeur, hauteur, projet, segments, t, imagesOuvertes, ajustement, avertissements, optionsDessin);
          await sourceImages.add(t, 1 / IMAGES_PAR_SECONDE);
          image++;
        }

        suivi({
          fait: partMesure + (1 - partMesure) * finBloc / total, image, images: nbImages, etape: 'images',
          ecoule: (performance.now() - departChrono) / 1000
        });
      }

      verifier();
      suivi({ fait: 1, image, images: nbImages, etape: 'finition' });
      await fermerTout();
      await sortie.finalize();
    } catch (erreur) {
      await fermerTout().catch(() => {});
      if (sortie.state !== 'finalized' && sortie.state !== 'canceled') await sortie.cancel().catch(() => {});
      if (flux) await flux.abort().catch(() => {});
      if (poignee) await DisquePrive.effacer();
      if (encodeur.materiel && erreur && erreur.name !== 'Annulation') {
        // La puce vidéo a refusé : on recommence tout de suite par le
        // processeur (si le souci venait d'ailleurs, il reviendra et s'affichera)
        noterEchecMateriel(erreur, encodeur);
        if (lireReglage(CLE_SANS_MATERIEL) === 'oui') {
          libererToile(toile);
          return fabriquerVideo(projet, reglages, suivi, arret);
        }
      }
      throw erreur;
    }
  } finally {
    libererToile(toile);
  }

  const fichier = poignee
    ? await poignee.getFile()
    : new Blob([cible.buffer], { type: 'video/mp4' });
  return { fichier, avertissements };
}


/* Prépare une version déjà redimensionnée d'une photo immobile (évite
   de la redimensionner 30 fois par seconde pendant tout le clip). */
function photoRedimensionnee(cachePhotos, mediaId, img, l, h) {
  const rl = Math.max(1, Math.round(l));
  const rh = Math.max(1, Math.round(h));
  const cle = mediaId + '|' + rl + 'x' + rh;
  const existante = cachePhotos.get(cle);
  if (existante) return existante;
  const c = nouvelleToile(rl, rh);
  c.getContext('2d').drawImage(img, 0, 0, rl, rh);
  cachePhotos.set(cle, c);
  if (cachePhotos.size > 4) {
    const plusAncienne = cachePhotos.keys().next().value;
    const vieille = cachePhotos.get(plusAncienne);
    if (vieille) libererToile(vieille);
    cachePhotos.delete(plusAncienne);
  }
  return c;
}

/* ---------- Dessiner une image de la vidéo finale ----------
   Le fond noir, le ou les clips du moment (avec la transparence et le
   glissement des transitions), puis les textes, images et sous-titres. */
async function dessinerImage(ctx, largeur, hauteur, projet, segments, t, ouvertes, ajustement, avertissements, options) {
  const opts = options || {};
  const Source = opts.source || SourceImages;
  const estSourceDefaut = Source === SourceImages;

  // Les clips visibles à cet instant (deux au plus, pendant une transition)
  const actifs = [];
  let depart = 0;
  if (opts.curseur) {
    while (opts.curseur.i < segments.length && segments[opts.curseur.i].fin <= t) opts.curseur.i++;
    depart = opts.curseur.i;
  }
  for (let i = depart; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.debut > t) break;
    if (t >= seg.debut && t < seg.fin) actifs.push({ i, seg, etat: Montage.etat(projet, segments, i, t) });
  }
  // Celui qui arrive « par-dessus » est dessiné en dernier
  if (actifs.length > 1) actifs.sort((a, b) => Number(a.etat.dessus) - Number(b.etat.dessus));

  // Les clips vidéo terminés libèrent leur lecteur — sauf s'il peut être
  // réutilisé tout de suite par le clip suivant du MÊME fichier
  const recyclables = [];
  for (const [i, source] of ouvertes) {
    if (segments[i].fin <= t) {
      ouvertes.delete(i);
      if (estSourceDefaut && source.mediaId && !source.fini) recyclables.push(source);
      else await source.fermer();
    }
  }

  // On prépare les images de chaque clip actif avant de peindre la toile
  const aDessiner = [];
  for (const item of actifs) {
    const { i, seg, etat } = item;
    const tFichier = Montage.tempsFichier(seg, t);
    if (seg.media.type === 'video') {
      let source = ouvertes.get(i);
      if (!source) {
        if (!Medias.fichiers.has(seg.media.id)) continue;   // vidéo pas encore retrouvée
        // Un lecteur du même fichier vient de finir juste avant ? On le garde !
        const idxRec = recyclables.findIndex((r) =>
          r.mediaId === seg.media.id &&
          tFichier >= r.tCourant - 0.001 &&
          tFichier <= r.fin - 0.05 &&
          tFichier - r.tCourant <= SAUT_REUTILISATION_VIDEO);
        if (idxRec >= 0) {
          source = recyclables.splice(idxRec, 1)[0];
        } else {
          // Lecture à partir d'ici (le début du clip, ou plus loin pour un
          // morceau de vidéo fabriqué à part : voir reprise.js)
          const finRun = estSourceDefaut ? finCourseVideo(segments, i, opts.finExport) : undefined;
          source = new Source(Medias.fichiers.get(seg.media.id), Math.max(seg.clip.debut, tFichier), finRun, {
            mediaId: seg.media.id, cacheEntrees: opts.cacheEntrees
          });
          await source.ouvrir();
          const msg = 'Les images de « ' + seg.media.nom + ' » n\'ont pas pu être lues.';
          if (source.fini && !avertissements.includes(msg)) avertissements.push(msg);
        }
        ouvertes.set(i, source);
      }
      // L'image est lue même si elle est invisible (fondu au noir) : la
      // lecture du fichier reste ainsi dans l'ordre
      const echantillon = await source.imageA(tFichier);
      if (!echantillon || etat.opacite <= 0) continue;
      aDessiner.push({ type: 'video', seg, etat, echantillon });
    } else if (seg.media.type === 'image') {
      const img = Rendu._images.get(seg.media.id);
      if (!img || etat.opacite <= 0) continue;
      aDessiner.push({ type: 'image', seg, etat, img, mvt: Montage.mouvement(seg, t) });
    }
  }
  // Les lecteurs non réutilisés sont refermés tout de suite
  for (const r of recyclables) await r.fermer();

  // Inutile de repeindre le fond noir (2 millions de pixels en 1080p) si le
  // premier clip est opaque, centré et remplit entièrement le cadre
  let couvreTout = false;
  if (aDessiner.length > 0) {
    const p = aDessiner[0];
    if (p.etat.opacite >= 1 && !p.etat.decalage) {
      const ratioToile = largeur / hauteur;
      if (p.type === 'video') {
        const w = p.echantillon.displayWidth, h = p.echantillon.displayHeight;
        couvreTout = ajustement === 'cover' || (h > 0 && Math.abs(w / h - ratioToile) < 0.002);
      } else if (p.mvt.echelle >= 1 && p.mvt.dx === 0) {
        couvreTout = ajustement === 'cover' || (p.img.height > 0 && Math.abs(p.img.width / p.img.height - ratioToile) < 0.002);
      }
    }
  }
  ctx.globalAlpha = 1;
  if (!couvreTout) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, largeur, hauteur);
  }

  for (const p of aDessiner) {
    const { seg, etat } = p;
    const filtre = Montage.filtre(seg.clip);
    if (p.type === 'video') {
      const simple = etat.opacite >= 1 && !etat.decalage && !filtre;
      if (simple) {
        p.echantillon.drawWithFit(ctx, { fit: ajustement });
      } else {
        ctx.save();
        ctx.globalAlpha = etat.opacite;
        if (etat.decalage) ctx.translate(etat.decalage * largeur, 0);
        if (filtre && 'filter' in ctx) ctx.filter = filtre;
        p.echantillon.drawWithFit(ctx, { fit: ajustement });
        ctx.restore();
      }
    } else {
      const { img, mvt } = p;
      const echelle = ajustement === 'cover'
        ? Math.max(largeur / img.width, hauteur / img.height)
        : Math.min(largeur / img.width, hauteur / img.height);
      const l = img.width * echelle;
      const h = img.height * echelle;
      const immobile = !etat.decalage && mvt.echelle === 1 && mvt.dx === 0;
      if (immobile && !filtre && opts.cachePhotos) {
        const pret = photoRedimensionnee(opts.cachePhotos, seg.media.id, img, l, h);
        if (etat.opacite < 1) {
          ctx.save();
          ctx.globalAlpha = etat.opacite;
          ctx.drawImage(pret, (largeur - pret.width) / 2, (hauteur - pret.height) / 2);
          ctx.restore();
        } else {
          ctx.drawImage(pret, (largeur - pret.width) / 2, (hauteur - pret.height) / 2);
        }
      } else {
        ctx.save();
        ctx.globalAlpha = etat.opacite;
        // Glissement (transition) et zoom lent, autour du centre de l'image
        ctx.translate((etat.decalage + mvt.dx) * largeur + largeur / 2, hauteur / 2);
        ctx.scale(mvt.echelle, mvt.echelle);
        ctx.translate(-largeur / 2, -hauteur / 2);
        if (filtre && 'filter' in ctx) ctx.filter = filtre;
        ctx.drawImage(img, (largeur - l) / 2, (hauteur - h) / 2, l, h);
        ctx.restore();
      }
    }
  }

  // Les textes, images incrustées et sous-titres : le même dessin que l'aperçu
  if (opts.calques !== false) Rendu.dessiner(ctx, largeur, hauteur, projet, t, { mediasParId: opts.mediasParId });
}


/* ---------- Une seule image du montage (pour la miniature) ----------
   Même interface que SourceImages, mais va chercher directement l'image
   du moment demandé, sans relire le clip depuis son début. */
class ImageUnique {
  constructor(fichier) {
    this.fichier = fichier;
    this.echantillon = null;
    this.fini = false;
  }

  async ouvrir() {
    this.entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(this.fichier), formats: Mediabunny.ALL_FORMATS });
    this.piste = await this.entree.getPrimaryVideoTrack();
    if (!this.piste || !(await this.piste.canDecode())) { this.fini = true; return; }
    this.sink = new Mediabunny.VideoSampleSink(this.piste);
  }

  async imageA(t) {
    if (this.fini) return null;
    if (!this.echantillon) {
      // Avant la toute première image du fichier : on prend la première
      const premier = await this.piste.getFirstTimestamp();
      this.echantillon = await this.sink.getSample(Math.max(t, premier));
    }
    return this.echantillon;
  }

  async fermer() {
    if (this.echantillon) this.echantillon.close();
    this.echantillon = null;
    if (this.entree) this.entree.dispose();
  }
}

/* L'image du montage au moment t, SANS les textes ni les sous-titres,
   dessinée sur une nouvelle toile largeur × hauteur. */
async function imageDuMontage(projet, t, largeur, hauteur) {
  const segments = Montage.segments(projet);
  const total = segments.length ? segments[segments.length - 1].fin : 0;
  await Rendu.preparerImages(projet);
  const toile = nouvelleToile(largeur, hauteur);
  const ctx = toile.getContext('2d', { alpha: false });
  const ouvertes = new Map();
  try {
    await dessinerImage(ctx, largeur, hauteur, projet, segments, borner(t, 0, Math.max(0, total - 0.05)), ouvertes,
      projet.ajustement === 'remplir' ? 'cover' : 'contain', [], { source: ImageUnique, calques: false });
  } finally {
    for (const s of ouvertes.values()) await s.fermer();
  }
  return toile;
}
