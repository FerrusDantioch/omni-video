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

/* L'erreur levée quand on touche « Arrêter » : ce n'est pas un vrai souci */
class Annulation extends Error {
  constructor() { super('Fabrication arrêtée'); this.name = 'Annulation'; }
}


/* ---------- Les images d'un clip vidéo ----------
   Lit les images d'un morceau de vidéo, dans l'ordre, une seule fois
   chacune. On garde au plus deux images à la fois (l'actuelle et la
   suivante), toujours refermées après usage. */
class SourceImages {
  constructor(fichier, debut) {
    this.fichier = fichier;
    this.debut = debut;   // le moment de départ, en secondes DANS le fichier
    this.courante = null;
    this.suivante = null;
    this.fini = false;
  }

  async ouvrir() {
    this.entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(this.fichier), formats: Mediabunny.ALL_FORMATS });
    const piste = await this.entree.getPrimaryVideoTrack();
    if (!piste || !(await piste.canDecode())) { this.fini = true; return; }
    this.lecture = new Mediabunny.VideoSampleSink(piste).samples(this.debut);
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
  constructor(media, fichier) {
    this.media = media;
    this.fichier = fichier;
    this.morceaux = [];   // [{ debut (n° d'échantillon), g, d (gauche, droite) }]
    this.finCharge = -Infinity;
    this.fini = false;
    this.muet = false;
  }

  async ouvrir() {
    try {
      this.entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(this.fichier), formats: Mediabunny.ALL_FORMATS });
      const piste = await this.entree.getPrimaryAudioTrack();
      if (piste && await piste.canDecode()) {
        this.sink = new Mediabunny.AudioBufferSink(piste);
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
        this._ajouterMorceau(0, tampon);
        this.frequence = tampon.sampleRate;
        this.fini = true;
        return;
      } catch (e) { /* illisible */ }
    }
    this.muet = true;
  }

  _ajouterMorceau(debut, tampon) {
    const g = tampon.getChannelData(0);
    const d = tampon.numberOfChannels > 1 ? tampon.getChannelData(1) : g;
    this.morceaux.push({ debut, g, d });
    this.finCharge = Math.max(this.finCharge, debut + g.length);
  }

  /* Prépare les échantillons de f0 à f1 (numéros dans le fichier) */
  async _charger(f0, f1) {
    if (!this.sink) return;
    const premier = this.morceaux[0];
    // Retour en arrière (musique qui recommence) ou grand saut : on
    // reprend la lecture à cet endroit
    if (!this.lecture || (premier && f0 < premier.debut - 2) || f0 > this.finCharge + this.frequence * 2) {
      if (this.lecture) { try { await this.lecture.return(); } catch (e) { /* déjà fermé */ } }
      this.lecture = this.sink.buffers(Math.max(0, f0 / this.frequence - 0.05));
      this.morceaux = [];
      this.finCharge = -Infinity;
      this.fini = false;
    }
    while (this.finCharge < f1 && !this.fini) {
      const r = await this.lecture.next();
      if (r.done) { this.fini = true; break; }
      this._ajouterMorceau(Math.round(r.value.timestamp * this.frequence), r.value.buffer);
    }
    // Les morceaux déjà joués sont oubliés (la mémoire reste petite)
    this.morceaux = this.morceaux.filter((m) => m.debut + m.g.length >= f0 - 1);
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

    // On recopie d'abord ces échantillons dans deux tableaux continus
    const g = new Float32Array(f1 - f0 + 1);
    const d = new Float32Array(f1 - f0 + 1);
    for (const m of this.morceaux) {
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
    const BLOC = 128;
    for (let k0 = 0; k0 < n; k0 += BLOC) {
      const k1 = Math.min(n, k0 + BLOC);
      const v0 = gainA(tSortie + k0 / FREQUENCE_SON);
      const v1 = gainA(tSortie + k1 / FREQUENCE_SON);
      if (v0 <= 0 && v1 <= 0) continue;
      for (let k = k0; k < k1; k++) {
        const pos = depart + k * pas;
        const j = pos | 0;
        const f = pos - j;
        const v = v0 + (v1 - v0) * (k - k0) / BLOC;
        gauche[ia + k] += (g[j] + (g[j + 1] - g[j]) * f) * v;
        droite[ia + k] += (d[j] + (d[j + 1] - d[j]) * f) * v;
      }
    }
  }

  async fermer() {
    try { if (this.lecture) await this.lecture.return(); } catch (e) { /* déjà fermé */ }
    if (this.entree) this.entree.dispose();
    this.morceaux = [];
  }
}


/* ---------- Le mélange du son ----------
   Mélange, seconde après seconde, le son des clips vidéo, la musique de
   fond et les voix off, avec leurs volumes et leurs fondus (les mêmes
   calculs que l'aperçu). Quand le volume est harmonisé, on s'en sert deux
   fois : d'abord pour mesurer le volume, puis pour fabriquer la vidéo. */
class Melangeur {
  constructor(projet, segments, total, avertissements) {
    this.projet = projet;
    this.segments = segments;
    this.total = total;
    this.avertissements = avertissements;
    this.sons = new Map();   // n° de segment ou de piste → SourceSon
    this.echantillon = 0;    // le prochain échantillon à fabriquer
    // Les pistes audio (musique, voix) qui peuvent être lues
    this.pistes = projet.pistes.map((p) => ({ piste: p, media: projet.medias.find((m) => m.id === p.mediaId) }))
      .filter((x) => x.media && Medias.fichiers.has(x.media.id));
  }

  /* Le son d'un segment ou d'une piste (ouvert la première fois) */
  async _sonDe(cle, media) {
    let s = this.sons.get(cle);
    if (!s) {
      s = new SourceSon(media, Medias.fichiers.get(media.id));
      await s.ouvrir();
      const avertissement = 'Le son de « ' + media.nom + ' » n\'a pas pu être lu : ce passage sera sans ce son.';
      if (s.muet && !this.avertissements.includes(avertissement)) this.avertissements.push(avertissement);
      this.sons.set(cle, s);
    }
    return s;
  }

  /* Le son de la seconde n° « seconde » : { gauche, droite, t, n } */
  async suivante(seconde) {
    const { projet, segments, total } = this;
    const finBloc = Math.min(total, seconde + 1);
    const e0 = this.echantillon;
    const e1 = Math.round(finBloc * FREQUENCE_SON);
    const n = e1 - e0;
    const gauche = new Float32Array(n);
    const droite = new Float32Array(n);
    const tBloc = e0 / FREQUENCE_SON;

    // Le son des clips vidéo
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.fin <= tBloc || seg.debut >= finBloc) continue;
      if (seg.media.type !== 'video' || !seg.media.aSon || seg.clip.volume <= 0) continue;
      const ia = Math.max(0, Math.round(seg.debut * FREQUENCE_SON) - e0);
      const ib = Math.min(n, Math.round(seg.fin * FREQUENCE_SON) - e0);
      if (ib <= ia) continue;
      const tSortie = (e0 + ia) / FREQUENCE_SON;
      const s = await this._sonDe('clip' + i, seg.media);
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
      const gainA = (t) => PistesAudio.volumeA(piste, t, total, projet);
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
      const i = cle.startsWith('clip') ? Number(cle.slice(4)) : -1;
      const piste = cle.startsWith('piste') ? projet.pistes.find((p) => 'piste' + p.id === cle) : null;
      const fini = i >= 0 ? segments[i].fin <= finBloc : (piste && piste.debut + PistesAudio.duree(piste, total) <= finBloc);
      if (fini) { await s.fermer(); this.sons.delete(cle); }
    }
    this.echantillon = e1;
    return { gauche, droite, t: tBloc, n };
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
    this.filtres = [0, 1].map(() => [
      { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585], x1: 0, x2: 0, y1: 0, y2: 0 },
      { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621], x1: 0, x2: 0, y1: 0, y2: 0 }
    ]);
    this.taille = FREQUENCE_SON / 10;   // des morceaux de 0,1 seconde
    this.somme = 0;
    this.compte = 0;
    this.morceaux = [];                 // énergie moyenne de chaque morceau de 0,1 s
  }

  _filtrer(f, x) {
    const y = f.b[0] * x + f.b[1] * f.x1 + f.b[2] * f.x2 - f.a[0] * f.y1 - f.a[1] * f.y2;
    f.x2 = f.x1; f.x1 = x;
    f.y2 = f.y1; f.y1 = y;
    return y;
  }

  ajouter(gauche, droite) {
    const [fg, fd] = this.filtres;
    for (let k = 0; k < gauche.length; k++) {
      const g = this._filtrer(fg[1], this._filtrer(fg[0], gauche[k]));
      const d = this._filtrer(fd[1], this._filtrer(fd[0], droite[k]));
      this.somme += g * g + d * d;
      if (++this.compte === this.taille) {
        this.morceaux.push(this.somme / this.taille);
        this.somme = 0;
        this.compte = 0;
      }
    }
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
    toutRefuser(new Error('Le travailleur du disque privé s\'est arrêté'));
  };
  const demander = (message, transfert) => new Promise((reussite, echec) => {
    if (arrete) { echec(new Error('Fichier déjà fermé')); return; }
    message.n = ++numero;
    attentes.set(message.n, { reussite, echec });
    travailleur.postMessage(message, transfert || []);
  });
  // Fermer le fichier (le reste du programme pourra le relire ou l'effacer)
  const fermer = async () => {
    if (arrete) return;
    try {
      await demander({ type: 'fermer' });
    } finally {
      arrete = true;
      travailleur.terminate();
      toutRefuser(new Error('Fichier fermé'));
    }
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
      const donnees = morceau.data.slice();   // une copie, donnée au travailleur
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

  // 1 bis. Volume harmonisé : on écoute d'abord tout le son de la vidéo
  //    pour mesurer son volume (rapide : aucune image n'est dessinée)
  const departChrono = performance.now();
  const partMesure = reglages.harmoniser ? PART_MESURE : 0;
  let gain = 1;
  if (reglages.harmoniser) {
    const mesure = new MesureVolume();
    const ecoute = new Melangeur(projet, segments, total, avertissements);
    try {
      for (let seconde = 0; seconde < total; seconde++) {
        verifier();
        const { gauche, droite } = await ecoute.suivante(seconde);
        mesure.ajouter(gauche, droite);
        suivi({
          fait: partMesure * Math.min(total, seconde + 1) / total, image: 0, images: nbImages, etape: 'mesure',
          ecoule: (performance.now() - departChrono) / 1000
        });
      }
    } finally {
      await ecoute.fermer();
    }
    gain = gainPourVolume(mesure.volume());
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
      const e = new Error('Pas de disque privé');
      e.name = 'TropLongEnMemoire';
      throw e;
    }
    cible = new Mediabunny.BufferTarget();
  }

  // 3. La toile où chaque image est dessinée, et le fichier de sortie
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const ctx = toile.getContext('2d', { alpha: false });
  const sortie = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat({ fastStart: flux ? false : 'in-memory' }),
    target: cible
  });
  const sourceImages = new Mediabunny.CanvasSource(toile, {
    codec: 'avc',
    bitrate: DEBITS_VIDEO[reglages.qualite],
    keyFrameInterval: 2
  });
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
  };

  try {
    await sortie.start();

    let image = 0;
    const melange = new Melangeur(projet, segments, total, avertissements);
    sonsOuverts.push(melange);
    for (let seconde = 0; seconde < total; seconde++) {
      verifier();
      const finBloc = Math.min(total, seconde + 1);

      // ----- 1. Le son de cette seconde -----
      const { gauche, droite, t: tBloc, n } = await melange.suivante(seconde);
      // Le volume harmonisé, puis le limiteur : jamais de grésillement
      limiteur.appliquer(gauche, droite, gain);
      const donnees = new Float32Array(2 * n);
      donnees.set(gauche, 0);
      donnees.set(droite, n);
      const morceauSon = new Mediabunny.AudioSample({
        data: donnees, format: 'f32-planar', numberOfChannels: 2, sampleRate: FREQUENCE_SON, timestamp: tBloc
      });
      await sourceSon.add(morceauSon);
      morceauSon.close();

      // ----- 2. Les images de cette seconde -----
      while (image < nbImages && image / IMAGES_PAR_SECONDE < finBloc - 1e-9) {
        verifier();
        const t = image / IMAGES_PAR_SECONDE;
        await dessinerImage(ctx, largeur, hauteur, projet, segments, t, imagesOuvertes, ajustement, avertissements);
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
    throw erreur;
  }

  const fichier = poignee
    ? await poignee.getFile()
    : new Blob([cible.buffer], { type: 'video/mp4' });
  return { fichier, avertissements };
}


/* ---------- Dessiner une image de la vidéo finale ----------
   Le fond noir, le ou les clips du moment (avec la transparence et le
   glissement des transitions), puis les textes, images et sous-titres. */
async function dessinerImage(ctx, largeur, hauteur, projet, segments, t, ouvertes, ajustement, avertissements, options) {
  const opts = options || {};
  const Source = opts.source || SourceImages;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, largeur, hauteur);

  // Les clips visibles à cet instant (deux au plus, pendant une transition)
  const actifs = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (t >= seg.debut && t < seg.fin) actifs.push({ i, seg, etat: Montage.etat(projet, segments, i, t) });
  }
  // Celui qui arrive « par-dessus » est dessiné en dernier
  actifs.sort((a, b) => Number(a.etat.dessus) - Number(b.etat.dessus));

  // Les clips vidéo terminés libèrent leur lecteur
  for (const [i, source] of ouvertes) {
    if (segments[i].fin <= t) { await source.fermer(); ouvertes.delete(i); }
  }

  for (const { i, seg, etat } of actifs) {
    const tFichier = Montage.tempsFichier(seg, t);
    if (seg.media.type === 'video') {
      let source = ouvertes.get(i);
      if (!source) {
        if (!Medias.fichiers.has(seg.media.id)) continue;   // vidéo pas encore retrouvée
        source = new Source(Medias.fichiers.get(seg.media.id), seg.clip.debut);
        await source.ouvrir();
        if (source.fini) avertissements.push('Les images de « ' + seg.media.nom + ' » n\'ont pas pu être lues.');
        ouvertes.set(i, source);
      }
      // L'image est lue même si elle est invisible (fondu au noir) : la
      // lecture du fichier reste ainsi dans l'ordre
      const echantillon = await source.imageA(tFichier);
      if (!echantillon || etat.opacite <= 0) continue;
      ctx.save();
      ctx.globalAlpha = etat.opacite;
      if (etat.decalage) ctx.translate(etat.decalage * largeur, 0);
      echantillon.drawWithFit(ctx, { fit: ajustement });
      ctx.restore();
    } else if (seg.media.type === 'image') {
      const img = Rendu._images.get(seg.media.id);
      if (!img || etat.opacite <= 0) continue;
      ctx.save();
      ctx.globalAlpha = etat.opacite;
      if (etat.decalage) ctx.translate(etat.decalage * largeur, 0);
      const echelle = ajustement === 'cover'
        ? Math.max(largeur / img.width, hauteur / img.height)
        : Math.min(largeur / img.width, hauteur / img.height);
      const l = img.width * echelle;
      const h = img.height * echelle;
      ctx.drawImage(img, (largeur - l) / 2, (hauteur - h) / 2, l, h);
      ctx.restore();
    }
  }

  // Les textes, images incrustées et sous-titres : le même dessin que l'aperçu
  if (opts.calques !== false) Rendu.dessiner(ctx, largeur, hauteur, projet, t, {});
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
