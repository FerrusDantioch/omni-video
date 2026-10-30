/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — blancs.js
   « Enlever les blancs » : Omni-Vidéo écoute le son d'un clip vidéo,
   repère les silences (quand personne ne parle) et propose de les couper
   d'un seul geste. Pratique pour une vidéo face caméra.

   1. Écoute : le son est lu petit à petit (jamais en entier en mémoire) ;
      on ne garde que le volume de chaque tranche de 50 ms.
   2. Seuil du silence : calculé sur CE clip, entre le bruit de fond (les
      moments les plus calmes) et la voix (les plus forts). Chaque pièce et
      chaque micro sont différents : un seuil fixe se tromperait.
   3. Les blancs plus longs que la durée choisie sont enlevés, en gardant
      un petit souffle (0,2 s) avant et après chaque phrase, pour ne pas
      couper les mots. Les blancs du début et de la fin partent en entier.
   Le clip est remplacé par ses morceaux parlés, en une seule étape :
   « Annuler » remet tout.
   ============================================================ */
'use strict';

const TRANCHE_BLANCS = 0.05;      // secondes : une mesure de volume par tranche
const MARGE_BLANCS = 0.2;         // souffle gardé avant et après la parole
const BRUIT_COURT_BLANCS = 3;     // un bruit de moins de 3 tranches (0,15 s) au milieu d'un blanc ne compte pas
const ECART_MIN_BLANCS = 10;      // dB : en dessous, pas de vrais blancs (musique, bruit fort…)

const Blancs = {
  _analyse: null,   // { clipId, debut, fin, vitesse, volumes, seuil }
  _arret: false,
  _enCours: false,

  initialiser() {
    const fenetre = $('#fenetre-blancs');
    // Changer la durée des blancs : le résultat se recalcule tout de suite
    $('form', fenetre).addEventListener('change', () => this._majResultat());
    fenetre.addEventListener('close', () => {
      this._arret = true;
      if (fenetre.returnValue === 'ok') this.appliquer();
    });
  },

  /* Le bouton « Enlever les blancs » sous la chronologie */
  async ouvrir() {
    const seg = Lecteur.segmentCourant();
    if (!seg || Lecteur.enLecture || seg.media.type !== 'video') return;
    const fichier = Medias.fichiers.get(seg.media.id);
    if (!fichier) {
      Message.probleme('Cette vidéo est à retrouver : touche d\'abord « Retrouver mes vidéos » en haut de l\'écran.');
      return;
    }
    if (this._enCours) return;
    Lecteur.pause();
    const fenetre = $('#fenetre-blancs');
    fenetre.returnValue = '';
    $('#blancs-resultat').hidden = true;
    $('#blancs-choix').hidden = true;
    $('#blancs-avis').hidden = true;
    $('#blancs-valider').disabled = true;
    ecrireTexte($('#blancs-etat'), 'J\'écoute le clip…');
    fenetre.showModal();

    const clip = seg.clip;
    this._analyse = null;
    this._arret = false;
    this._enCours = true;
    try {
      const volumes = await this._ecouter(fichier, clip.debut, clip.fin, (part) => {
        ecrireTexte($('#blancs-etat'), 'J\'écoute le clip… ' + Math.floor(part * 100) + ' %');
      });
      if (!volumes || this._arret || !fenetre.open) return;
      this._analyse = { clipId: clip.id, debut: clip.debut, fin: clip.fin, vitesse: Montage.vitesse(seg), volumes, seuil: seuilSilence(volumes) };
      this._majResultat();
    } catch (e) {
      console.error(e);
      if (fenetre.open) ecrireTexte($('#blancs-etat'), 'Je n\'ai pas réussi à écouter le son de ce clip.');
    } finally {
      this._enCours = false;
    }
  },

  /* Lit le son du fichier de « debut » à « fin » (secondes DANS le fichier)
     et renvoie le volume (en dB) de chaque tranche de 50 ms, ou null s'il
     n'y a pas de son lisible. */
  async _ecouter(fichier, debut, fin, progres) {
    const entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(fichier), formats: Mediabunny.ALL_FORMATS });
    try {
      const piste = await entree.getPrimaryAudioTrack();
      if (!piste || !(await piste.canDecode())) return null;
      const sink = new Mediabunny.AudioBufferSink(piste);
      const n = Math.max(1, Math.ceil((fin - debut) / TRANCHE_BLANCS));
      const somme = new Float64Array(n);
      const compte = new Uint32Array(n);
      let dernierAffichage = 0;
      for await (const morceau of sink.buffers(debut, fin)) {
        if (this._arret) return null;
        const tampon = morceau.buffer;
        const g = tampon.getChannelData(0);
        const d = tampon.numberOfChannels > 1 ? tampon.getChannelData(1) : null;
        const depart = (morceau.timestamp - debut) / TRANCHE_BLANCS;   // n° de tranche (à virgule) du 1er échantillon
        const pas = 1 / (tampon.sampleRate * TRANCHE_BLANCS);
        for (let k = 0; k < g.length; k++) {
          const w = Math.floor(depart + k * pas);
          if (w < 0) continue;
          if (w >= n) break;
          const v = d ? (g[k] + d[k]) / 2 : g[k];
          somme[w] += v * v;
          compte[w]++;
        }
        // Le compteur n'est mis à jour que 4 fois par seconde au plus
        const maintenant = performance.now();
        if (maintenant - dernierAffichage > 250) {
          dernierAffichage = maintenant;
          progres(borner((morceau.timestamp + morceau.duration - debut) / (fin - debut), 0, 1));
        }
      }
      // Volume de chaque tranche en décibels (une tranche sans son = silence complet)
      const volumes = new Float32Array(n);
      for (let w = 0; w < n; w++) {
        volumes[w] = compte[w] ? Math.max(-100, 10 * Math.log10(somme[w] / compte[w] + 1e-12)) : -100;
      }
      return volumes;
    } finally {
      entree.dispose();
    }
  },

  /* Les blancs à enlever et les morceaux gardés, pour la durée choisie */
  _decouper(minimum) {
    const a = this._analyse;
    const n = a.volumes.length;
    const fort = new Uint8Array(n);
    for (let i = 0; i < n; i++) fort[i] = a.volumes[i] >= a.seuil ? 1 : 0;
    // Un bruit très court au milieu d'un blanc (un clic, une porte) ne compte pas
    for (let i = 0; i < n;) {
      if (!fort[i]) { i++; continue; }
      let j = i;
      while (j < n && fort[j]) j++;
      if (j - i < BRUIT_COURT_BLANCS) fort.fill(0, i, j);
      i = j;
    }
    // Les blancs assez longs, moins le souffle gardé autour de la parole
    const enleves = [];
    for (let i = 0; i < n;) {
      if (fort[i]) { i++; continue; }
      let j = i;
      while (j < n && !fort[j]) j++;
      const s = a.debut + i * TRANCHE_BLANCS;
      const e = Math.min(a.fin, a.debut + j * TRANCHE_BLANCS);
      if (e - s >= minimum) {
        const de = i === 0 ? a.debut : s + MARGE_BLANCS;   // début du clip : tout part
        const a2 = j >= n ? a.fin : e - MARGE_BLANCS;     // fin du clip : tout part
        if (a2 - de > 0.05) enleves.push([de, a2]);
      }
      i = j;
    }
    // Ce qui reste : les morceaux parlés
    const gardes = [];
    let t = a.debut;
    for (const [de, jusque] of enleves) {
      if (de - t >= DUREE_CLIP_MIN) gardes.push([t, de]);
      t = jusque;
    }
    if (a.fin - t >= DUREE_CLIP_MIN) gardes.push([t, a.fin]);
    return { enleves, gardes };
  },

  _minimum() {
    return Number($('#fenetre-blancs form').elements.minimum.value) || 1;
  },

  /* Affiche ce que « Enlever » va faire */
  _majResultat() {
    const a = this._analyse;
    if (!a) return;
    const ecart = ecartVolumes(a.volumes);
    $('#blancs-choix').hidden = false;
    let texte = '';
    let possible = false;
    if (ecart < ECART_MIN_BLANCS) {
      texte = 'Je n\'ai pas trouvé de vrais blancs dans ce clip : le son ne s\'arrête presque jamais ' +
        '(musique, bruit de fond fort…).';
    } else {
      const { enleves, gardes } = this._decouper(this._minimum());
      const avant = (a.fin - a.debut) / a.vitesse;
      const apres = gardes.reduce((s, [de, jusque]) => s + jusque - de, 0) / a.vitesse;
      if (!gardes.length) {
        texte = 'Ce clip semble entièrement silencieux : je n\'enlève rien.';
      } else if (!enleves.length) {
        texte = 'Aucun blanc de cette longueur dans ce clip. Essaie une durée plus courte.';
      } else {
        possible = true;
        texte = (enleves.length > 1 ? enleves.length + ' blancs trouvés' : 'Un blanc trouvé') + ', ' +
          dureeEnMots(Math.max(1, Math.round(avant - apres))) + ' en tout. Ce clip passera de ' +
          dureeEnMots(Math.round(avant)) + ' à ' + dureeEnMots(Math.max(1, Math.round(apres))) + '.';
      }
    }
    ecrireTexte($('#blancs-etat'), 'J\'ai écouté le clip ✓');
    ecrireTexte($('#blancs-resultat'), texte);
    $('#blancs-resultat').hidden = false;
    // Les textes, sous-titres, musiques et chapitres suivent le temps du
    // MONTAGE : ceux qui sont après ce clip ne bougent pas avec lui
    const p = Projets.courant;
    const seg = p && Lecteur.segments.find((s) => s.clip.id === a.clipId);
    const apresClip = (debut) => seg && debut > seg.debut + 0.01;
    const autres = p && (p.calques.some((c) => apresClip(c.debut)) || p.sousTitres.some((s) => apresClip(s.debut)) ||
      p.pistes.some((x) => apresClip(x.debut)) || p.chapitres.some((c) => apresClip(c.t)));
    $('#blancs-avis').hidden = !(possible && autres);
    $('#blancs-valider').disabled = !possible;
  },

  /* « Enlever les blancs » : le clip est remplacé par ses morceaux parlés */
  appliquer() {
    const a = this._analyse;
    const projet = Projets.courant;
    if (!a || !projet || ecartVolumes(a.volumes) < ECART_MIN_BLANCS) return;
    const { enleves, gardes } = this._decouper(this._minimum());
    this._analyse = null;
    const i = projet.clips.findIndex((c) => c.id === a.clipId);
    const clip = projet.clips[i];
    // Le clip a changé entre-temps ? (on ne devine pas : on ne touche à rien)
    if (!clip || clip.debut !== a.debut || clip.fin !== a.fin) return;
    if (!enleves.length || !gardes.length) return;
    Chronologie._memoriser();
    // Chaque morceau garde les réglages du clip ; seul le premier garde sa
    // transition (entre deux morceaux : coupe nette, comme « Couper ici »)
    const morceaux = gardes.map(([debut, fin], k) => Object.assign({}, clip, {
      id: k === 0 ? clip.id : nouvelId(),
      debut,
      fin,
      transition: k === 0 ? clip.transition : nettoyerTransition(null, TYPES_TRANSITION)
    }));
    projet.clips.splice(i, 1, ...morceaux);
    Lecteur.calculer(projet);
    const gagne = ((a.fin - a.debut) - gardes.reduce((s, [de, jusque]) => s + jusque - de, 0)) / a.vitesse;
    Chronologie._apresModification(Lecteur.segments[i] ? Lecteur.segments[i].debut : 0);
    Message.montrer((enleves.length > 1 ? enleves.length + ' blancs enlevés' : 'Un blanc enlevé') + ' ✓ (' +
      dureeEnMots(Math.max(1, Math.round(gagne))) + '). « Annuler » remet tout comme avant.');
  }
};

/* L'écart entre les moments forts (la voix) et les plus calmes (le bruit
   de fond), en dB : 10 % les plus calmes contre 10 % les plus forts. */
function ecartVolumes(volumes) {
  const { calme, fort } = quantilesVolumes(volumes);
  return fort - calme;
}

function quantilesVolumes(volumes) {
  const tries = Float32Array.from(volumes).sort();
  const n = tries.length;
  return { calme: tries[Math.floor(n * 0.1)], fort: tries[Math.min(n - 1, Math.floor(n * 0.9))] };
}

/* Le seuil du silence : un peu au-dessus du bruit de fond (au moins 6 dB,
   ou 30 % du chemin vers la voix) */
function seuilSilence(volumes) {
  const { calme, fort } = quantilesVolumes(volumes);
  return calme + Math.max(6, 0.3 * (fort - calme));
}
