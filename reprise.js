/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — reprise.js
   Les longues vidéos (plus de 10 minutes) sont fabriquées par MORCEAUX,
   gardés dans le disque privé de la tablette. Si la fabrication est
   interrompue (batterie vide, appel, application fermée, « Arrêter »…),
   elle reprend plus tard là où elle s'était arrêtée.

   Un fichier MP4 coupé en plein milieu est illisible : on ne peut pas
   simplement « continuer » à l'écrire. D'où les étapes :
   1. le SON de toute la vidéo, d'un coup, dans omnivideo-son.mp4 (rapide :
      aucune image n'est dessinée) ;
   2. les IMAGES, par morceaux de 2 minutes : omnivideo-partie-0.mp4, -1…
      (chaque morceau terminé est noté : il ne sera jamais refait) ;
   3. l'ASSEMBLAGE : les morceaux et le son sont recopiés, sans rien
      recompresser, dans le fichier final (omnivideo-export.mp4). Chaque
      morceau est effacé dès qu'il est recopié (la place reste petite).

   Ce qui est déjà fait est noté dans localStorage (CLE_REPRISE), avec une
   « empreinte » du montage : si le montage ou les réglages ont changé
   depuis, tout recommence (sinon la vidéo mélangerait deux montages).
   ============================================================ */
'use strict';

const SEUIL_PARTIES = 600;          // au-delà de 10 minutes, fabrication par morceaux
const DUREE_PARTIE = 120;           // secondes par morceau (un multiple de 1/30 s)
const CLE_REPRISE = 'omnivideo-reprise';
const CLE_SANS_PARTIES = 'omnivideo-sans-parties';   // 'oui' si l'assemblage a échoué un jour sur cette tablette
const NOM_FICHIER_SON = 'omnivideo-son.mp4';
const PART_SON = 0.06;              // parts de la barre de progression
const PART_ASSEMBLAGE = 0.04;

function nomPartie(k) {
  return 'omnivideo-partie-' + k + '.mp4';
}

/* L'empreinte du montage et des réglages : si un seul détail change, elle change */
function empreinteExport(projet, reglages) {
  const p = projet;
  const texte = JSON.stringify([VERSION, p.id, p.format, p.ajustement, p.clips, p.calques, p.pistes, p.transitionDebut,
    p.transitionFin, p.sousTitres, p.styleSousTitres, p.baisserMusique, p.medias.map((m) => [m.id, m.taille, m.duree]),
    reglages.qualite, !!reglages.harmoniser, DUREE_PARTIE]);
  // Une petite « somme de contrôle » (FNV-1a), suffisante pour reconnaître un changement
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + '-' + texte.length;
}

const Reprise = {
  lire() {
    try { return JSON.parse(lireReglage(CLE_REPRISE) || 'null'); } catch (e) { return null; }
  },

  ecrire(etat) {
    ecrireReglage(CLE_REPRISE, JSON.stringify(etat));
  },

  /* La fabrication interrompue de CE projet, avec CES réglages (ou null) */
  pour(projet, reglages) {
    const etat = this.lire();
    if (!etat || etat.projetId !== projet.id) return null;
    if (reglages && etat.empreinte !== empreinteExport(projet, reglages)) return null;
    return etat;
  },

  /* La part déjà faite (0 à 1), pour l'afficher */
  avancement(etat) {
    const faites = etat.faites.filter(Boolean).length;
    return (etat.gainPret ? PART_MESURE * (etat.harmoniser ? 1 : 0) : 0) + (etat.son ? PART_SON : 0) +
      (1 - PART_SON - PART_ASSEMBLAGE - (etat.harmoniser ? PART_MESURE : 0)) * faites / etat.faites.length;
  },

  /* On oublie tout, morceaux compris */
  async effacer() {
    const etat = this.lire();
    try { localStorage.removeItem(CLE_REPRISE); } catch (e) { /* pas grave */ }
    const dossier = await DisquePrive.dossier();
    if (!dossier) return;
    await dossier.removeEntry(NOM_FICHIER_SON).catch(() => {});
    const n = etat && Array.isArray(etat.faites) ? etat.faites.length : 0;
    for (let k = 0; k < Math.max(n, 1000); k++) {
      const ok = await dossier.removeEntry(nomPartie(k)).then(() => true, () => false);
      if (!ok && k >= n) break;   // plus aucun morceau après
    }
  }
};


/* ---------- Fabriquer une longue vidéo, par morceaux ---------- */
async function fabriquerParParties(projet, reglages, suivi, arret, prep) {
  const { largeur, hauteur, segments, total, nbImages, avertissements, ajustement, verifier } = prep;
  const empreinte = empreinteExport(projet, reglages);
  const nbParties = Math.ceil(total / DUREE_PARTIE - 1e-9);
  let etat = Reprise.lire();
  if (!etat || etat.empreinte !== empreinte) {
    // Rien à reprendre (ou un autre montage) : on part de zéro
    await Reprise.effacer();
    etat = {
      empreinte, projetId: projet.id, nom: projet.nom, qualite: reglages.qualite, harmoniser: !!reglages.harmoniser,
      date: Date.now(), gain: 1, gainPret: !reglages.harmoniser, son: false,
      faites: new Array(nbParties).fill(false), avertissements: []
    };
    Reprise.ecrire(etat);
  }
  const repris = Reprise.avancement(etat) > 0;
  etat.avertissements.forEach((a) => { if (!avertissements.includes(a)) avertissements.push(a); });
  const noter = () => {
    avertissements.forEach((a) => { if (!etat.avertissements.includes(a)) etat.avertissements.push(a); });
    Reprise.ecrire(etat);
  };

  // La barre de progression : mesure du son, son, images, assemblage
  const partMesure = etat.harmoniser ? PART_MESURE : 0;
  const partImages = 1 - partMesure - PART_SON - PART_ASSEMBLAGE;
  const depart = performance.now();
  const dejaFait = Reprise.avancement(etat);
  const signaler = (fait, etape, image) => suivi({
    fait, depuis: dejaFait, image: image || 0, images: nbImages, etape,
    ecoule: (performance.now() - depart) / 1000
  });

  // 1. Le volume harmonisé (une seule fois)
  if (!etat.gainPret) {
    etat.gain = await mesurerGain(projet, segments, total, avertissements, verifier, (f) => signaler(partMesure * f, 'mesure'));
    etat.gainPret = true;
    noter();
  }

  // 2. Le son de toute la vidéo
  if (!etat.son) {
    await fabriquerSonSeul(projet, segments, total, etat.gain, avertissements, verifier,
      (f) => signaler(partMesure + PART_SON * f, 'son'));
    etat.son = true;
    noter();
  }

  // 3. Les images, morceau par morceau
  const imagesFaites = () => etat.faites.reduce((n, fait, k) =>
    n + (fait ? Math.min(nbImages, Math.round((k + 1) * DUREE_PARTIE * IMAGES_PAR_SECONDE)) - Math.round(k * DUREE_PARTIE * IMAGES_PAR_SECONDE) : 0), 0);
  for (let k = 0; k < nbParties; k++) {
    if (etat.faites[k]) continue;
    const avant = imagesFaites();
    await fabriquerPartie(projet, segments, total, k, largeur, hauteur, reglages.qualite, ajustement, avertissements, verifier,
      (n) => signaler(partMesure + PART_SON + partImages * (avant + n) / nbImages, 'images', avant + n));
    etat.faites[k] = true;
    noter();
  }

  // 4. L'assemblage du fichier final
  signaler(1 - PART_ASSEMBLAGE, 'assemblage', nbImages);
  const fichier = await assemblerParties(projet, nbParties, (f) => signaler(1 - PART_ASSEMBLAGE + PART_ASSEMBLAGE * f, 'assemblage', nbImages), etat);
  await Reprise.effacer();
  return { fichier, avertissements, repris };
}

/* Le son de toute la vidéo, seul, dans omnivideo-son.mp4 */
async function fabriquerSonSeul(projet, segments, total, gain, avertissements, verifier, progres) {
  const ouvert = await DisquePrive.ouvrirFichier(NOM_FICHIER_SON);
  if (!ouvert) throw new Error('Disque privé indisponible');
  const sortie = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat({ fastStart: false }),
    target: new Mediabunny.StreamTarget(ouvert.flux, { chunked: true, chunkSize: 4 * 1024 * 1024 })
  });
  const sourceSon = new Mediabunny.AudioSampleSource({ codec: 'aac', bitrate: DEBIT_SON });
  sortie.addAudioTrack(sourceSon);
  const melange = new Melangeur(projet, segments, total, avertissements);
  const limiteur = new Limiteur();
  try {
    await sortie.start();
    for (let seconde = 0; seconde < total; seconde++) {
      verifier();
      const { gauche, droite, t, n } = await melange.suivante(seconde);
      limiteur.appliquer(gauche, droite, gain);
      const donnees = new Float32Array(2 * n);
      donnees.set(gauche, 0);
      donnees.set(droite, n);
      const morceau = new Mediabunny.AudioSample({
        data: donnees, format: 'f32-planar', numberOfChannels: 2, sampleRate: FREQUENCE_SON, timestamp: t
      });
      await sourceSon.add(morceau);
      morceau.close();
      progres(Math.min(total, seconde + 1) / total);
    }
    await melange.fermer();
    await sortie.finalize();
  } catch (erreur) {
    await melange.fermer().catch(() => {});
    if (sortie.state !== 'finalized' && sortie.state !== 'canceled') await sortie.cancel().catch(() => {});
    await ouvert.flux.abort().catch(() => {});
    const dossier = await DisquePrive.dossier();
    if (dossier) await dossier.removeEntry(NOM_FICHIER_SON).catch(() => {});
    throw erreur;
  }
}

/* Les images du morceau n° k (de k × 2 min à (k + 1) × 2 min), sans son.
   Dans ce fichier, le temps repart de 0 : l'assemblage le recalera. */
async function fabriquerPartie(projet, segments, total, k, largeur, hauteur, qualite, ajustement, avertissements, verifier, progres) {
  const premiere = Math.round(k * DUREE_PARTIE * IMAGES_PAR_SECONDE);
  const derniere = Math.min(Math.ceil(total * IMAGES_PAR_SECONDE - 1e-6), Math.round((k + 1) * DUREE_PARTIE * IMAGES_PAR_SECONDE));
  const t0 = premiere / IMAGES_PAR_SECONDE;
  const nom = nomPartie(k);
  const ouvert = await DisquePrive.ouvrirFichier(nom);
  if (!ouvert) throw new Error('Disque privé indisponible');
  const toile = nouvelleToile(largeur, hauteur);
  const ctx = toile.getContext('2d', { alpha: false });
  const sortie = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat({ fastStart: false }),
    target: new Mediabunny.StreamTarget(ouvert.flux, { chunked: true, chunkSize: 8 * 1024 * 1024 })
  });
  const sourceImages = new Mediabunny.CanvasSource(toile, {
    codec: 'avc',
    bitrate: DEBITS_VIDEO[qualite],
    keyFrameInterval: 2
  });
  sortie.addVideoTrack(sourceImages, { frameRate: IMAGES_PAR_SECONDE });
  const ouvertes = new Map();
  const fermer = async () => {
    for (const s of ouvertes.values()) await s.fermer();
    ouvertes.clear();
  };
  try {
    await sortie.start();
    for (let image = premiere; image < derniere; image++) {
      verifier();
      const t = image / IMAGES_PAR_SECONDE;
      await dessinerImage(ctx, largeur, hauteur, projet, segments, t, ouvertes, ajustement, avertissements);
      await sourceImages.add(t - t0, 1 / IMAGES_PAR_SECONDE);
      if ((image - premiere) % IMAGES_PAR_SECONDE === IMAGES_PAR_SECONDE - 1) progres(image - premiere + 1);
    }
    await fermer();
    await sortie.finalize();
  } catch (erreur) {
    await fermer().catch(() => {});
    if (sortie.state !== 'finalized' && sortie.state !== 'canceled') await sortie.cancel().catch(() => {});
    await ouvert.flux.abort().catch(() => {});
    const dossier = await DisquePrive.dossier();
    if (dossier) await dossier.removeEntry(nom).catch(() => {});
    throw erreur;
  }
}

/* Deux réglages de décodage identiques ? (sinon les morceaux ne peuvent
   pas être mis bout à bout) */
function memesReglagesVideo(a, b) {
  if (!a || !b || a.codec !== b.codec || a.codedWidth !== b.codedWidth || a.codedHeight !== b.codedHeight) return false;
  const octets = (d) => (!d ? new Uint8Array(0) : d instanceof Uint8Array ? d : ArrayBuffer.isView(d)
    ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d));
  const x = octets(a.description);
  const y = octets(b.description);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/* Recopie le son et les morceaux d'images dans le fichier final, sans
   rien recompresser. Chaque morceau est effacé dès qu'il est recopié. */
async function assemblerParties(projet, nbParties, progres, etat) {
  const dossier = await DisquePrive.dossier();
  const lire = async (nom) => (await dossier.getFileHandle(nom)).getFile();
  const entreeSon = new Mediabunny.Input({ source: new Mediabunny.BlobSource(await lire(NOM_FICHIER_SON)), formats: Mediabunny.ALL_FORMATS });
  const pisteSon = await entreeSon.getPrimaryAudioTrack();
  const reglagesSon = await pisteSon.getDecoderConfig();
  const paquetsSon = new Mediabunny.EncodedPacketSink(pisteSon).packets();

  const ouvert = await DisquePrive.ouvrirFichier(NOM_FICHIER_EXPORT);
  if (!ouvert) throw new Error('Disque privé indisponible');
  const sortie = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat({ fastStart: false }),
    target: new Mediabunny.StreamTarget(ouvert.flux, { chunked: true, chunkSize: 8 * 1024 * 1024 })
  });
  const images = new Mediabunny.EncodedVideoPacketSource('avc');
  const son = new Mediabunny.EncodedAudioPacketSource('aac');
  sortie.addVideoTrack(images, { frameRate: IMAGES_PAR_SECONDE });
  sortie.addAudioTrack(son);
  sortie.setMetadataTags({ title: projet.nom });

  let paquetSon = (await paquetsSon.next()).value || null;
  let premierSon = true;
  // Le son avance avec les images (le fichier final reste bien mélangé)
  const sonJusqua = async (t) => {
    while (paquetSon && paquetSon.timestamp < t) {
      await son.add(paquetSon, premierSon ? { decoderConfig: reglagesSon } : undefined);
      premierSon = false;
      paquetSon = (await paquetsSon.next()).value || null;
    }
  };

  let reglagesImages = null;
  try {
    await sortie.start();
    for (let k = 0; k < nbParties; k++) {
      const entree = new Mediabunny.Input({ source: new Mediabunny.BlobSource(await lire(nomPartie(k))), formats: Mediabunny.ALL_FORMATS });
      try {
        const piste = await entree.getPrimaryVideoTrack();
        const reglages = await piste.getDecoderConfig();
        const premier = !reglagesImages;
        if (premier) reglagesImages = reglages;
        else if (!memesReglagesVideo(reglages, reglagesImages)) {
          const e = new Error('Morceaux incompatibles');
          e.name = 'MorceauxIncompatibles';
          throw e;
        }
        const decalage = Math.round(k * DUREE_PARTIE * IMAGES_PAR_SECONDE) / IMAGES_PAR_SECONDE;
        let debutMorceau = premier;
        for await (const paquet of new Mediabunny.EncodedPacketSink(piste).packets()) {
          const t = paquet.timestamp + decalage;
          await sonJusqua(t);
          await images.add(paquet.clone({ timestamp: t }), debutMorceau ? { decoderConfig: reglages } : undefined);
          debutMorceau = false;
        }
      } finally {
        entree.dispose();
      }
      // Ce morceau est recopié : sa place est libérée
      await dossier.removeEntry(nomPartie(k)).catch(() => {});
      etat.faites[k] = false;
      Reprise.ecrire(etat);
      progres((k + 1) / nbParties);
    }
    await sonJusqua(Infinity);
    entreeSon.dispose();
    await sortie.finalize();
  } catch (erreur) {
    entreeSon.dispose();
    if (sortie.state !== 'finalized' && sortie.state !== 'canceled') await sortie.cancel().catch(() => {});
    await ouvert.flux.abort().catch(() => {});
    await DisquePrive.effacer();
    if (erreur && erreur.name === 'MorceauxIncompatibles') {
      // Cette tablette fabrique des morceaux qui ne se recollent pas : la
      // prochaine fois, tout sera fait d'un coup (sans reprise possible)
      ecrireReglage(CLE_SANS_PARTIES, 'oui');
      await Reprise.effacer();
    }
    throw erreur;
  }
  return ouvert.poignee.getFile();
}
