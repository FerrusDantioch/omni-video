/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — medias.js
   Les fichiers du projet : vidéos, images, musiques.
   - Importer : choisir des fichiers dans la tablette, les analyser
     (durée, taille de l'image, son), fabriquer une petite miniature.
   - Retrouver : à la réouverture d'un projet, redemander les vidéos.

   ⚠️ Mémoire : une vidéo n'est JAMAIS chargée en entier. La bibliothèque
   Mediabunny lit seulement les petits morceaux du fichier dont elle a
   besoin (le sommaire du fichier, puis une seule image pour la
   miniature). Une vidéo de 3 Go s'analyse donc aussi vite qu'une petite.
   ============================================================ */
'use strict';

/* Taille de la miniature (en pixels, côté le plus court) et taille
   maximale gardée pour les images (côté le plus long : assez pour
   remplir une vidéo 1080p, horizontale ou verticale). */
const MINIATURE_COTE = 144;
const IMAGE_COTE_MAX = 1920;

/* Noms des formats vidéo, en clair */
const NOMS_CODECS = {
  avc: 'H.264', hevc: 'HEVC (H.265)', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', prores: 'ProRes'
};

const Medias = {
  /* Les fichiers ouverts pendant cette visite : numéro du média → fichier.
     Pour les vidéos, c'est seulement une « poignée » vers le fichier de la
     tablette (rien n'est copié). Pour les images et musiques, c'est la
     copie gardée dans la base. */
  fichiers: new Map(),
  /* Adresses internes (blob:…) déjà fabriquées pour l'aperçu */
  adresses: new Map(),

  /* Le fichier d'un média est-il disponible maintenant ? */
  disponible(media) {
    return this.fichiers.has(media.id);
  },

  /* Adresse utilisable par <video> ou <img> pour un média (ou null) */
  adresse(media) {
    if (this.adresses.has(media.id)) return this.adresses.get(media.id);
    const fichier = this.fichiers.get(media.id);
    if (!fichier) return null;
    const url = URL.createObjectURL(fichier);
    this.adresses.set(media.id, url);
    return url;
  },

  /* Oublie un média (fichier et adresse) */
  oublier(id) {
    const url = this.adresses.get(id);
    if (url) URL.revokeObjectURL(url);
    this.adresses.delete(id);
    this.fichiers.delete(id);
  },

  /* À l'ouverture d'un projet : on recharge depuis la base les images et
     musiques qu'Omni-Vidéo garde lui-même. */
  async chargerFichiersLegers(projet) {
    for (const media of projet.medias) {
      if (media.type === 'video' || this.fichiers.has(media.id)) continue;
      try {
        const blob = await Base.lireFichier(media.id);
        if (blob) this.fichiers.set(media.id, blob);
      } catch (e) { /* le média sera affiché comme « introuvable » */ }
    }
  },

  /* Les vidéos du projet qu'il faut redemander */
  manquantes(projet) {
    return projet.medias.filter((m) => m.type === 'video' && !m.probleme && !this.fichiers.has(m.id));
  },

  /* ---------- Importer des fichiers ----------
     « suivi(texte) » est appelé pour afficher l'avancement.
     Renvoie le bilan : { ajoutes, refus: [ { nom, raison } ] }. */
  async importer(projet, type, liste, suivi) {
    const bilan = { ajoutes: 0, refus: [] };
    const fichiers = Array.from(liste);
    for (let i = 0; i < fichiers.length; i++) {
      const fichier = fichiers[i];
      suivi('Préparation de « ' + fichier.name + ' »' + (fichiers.length > 1 ? ' (' + (i + 1) + ' sur ' + fichiers.length + ')' : '') + '…');

      // Déjà dans le projet ? (même nom, même taille)
      const doublon = projet.medias.find((m) => m.type === type && m.nom === fichier.name && m.taille === fichier.size);
      if (doublon) {
        // Si c'était une vidéo à retrouver, ce choix la retrouve justement
        if (type === 'video' && !this.fichiers.has(doublon.id)) {
          this.fichiers.set(doublon.id, fichier);
          bilan.ajoutes++;
        } else {
          bilan.refus.push({ nom: fichier.name, raison: 'déjà dans le projet' });
        }
        continue;
      }

      const media = nettoyerMedia({
        id: nouvelId(),
        type,
        nom: fichier.name,
        taille: fichier.size,
        dateFichier: fichier.lastModified || 0
      });

      try {
        if (type === 'video') {
          Object.assign(media, await analyserVideo(fichier));
          this.fichiers.set(media.id, fichier);
        } else if (type === 'image') {
          const resultat = await analyserImage(fichier);
          Object.assign(media, resultat.infos);
          media.taille = fichier.size;   // la taille d'origine sert à reconnaître le fichier
          await Base.enregistrerFichier(media.id, resultat.blob);
          this.fichiers.set(media.id, resultat.blob);
        } else {
          Object.assign(media, await analyserAudio(fichier));
          if (!media.probleme) {
            await Base.enregistrerFichier(media.id, fichier);
            this.fichiers.set(media.id, fichier);
          }
        }
      } catch (erreur) {
        if (erreur && erreur.name === 'QuotaExceededError') {
          bilan.refus.push({ nom: fichier.name, raison: 'mémoire de la tablette pleine' });
          continue;
        }
        console.warn('Import impossible', fichier.name, erreur);
        media.probleme = (erreur && erreur.messagePourTous) ||
          "Omni-Vidéo n'arrive pas à lire ce fichier. Il est peut-être abîmé ou dans un format inhabituel.";
      }

      projet.medias.push(media);
      if (media.probleme) bilan.refus.push({ nom: fichier.name, raison: media.probleme });
      else bilan.ajoutes++;
    }
    return bilan;
  },

  /* ---------- Retrouver les vidéos d'un projet rouvert ----------
     On reconnaît chaque vidéo à son nom et à sa taille exacte (à
     l'octet près : deux vidéos différentes n'ont presque jamais la
     même). Si le nom a changé mais qu'une seule vidéo manquante a
     cette taille-là, c'est forcément elle. */
  retrouver(projet, liste) {
    let trouvees = 0;
    const inconnues = [];
    for (const fichier of Array.from(liste)) {
      const manquantes = this.manquantes(projet);
      let media = manquantes.find((m) => m.nom === fichier.name && m.taille === fichier.size);
      if (!media) {
        const memeTaille = manquantes.filter((m) => m.taille === fichier.size);
        if (memeTaille.length === 1) media = memeTaille[0];
      }
      if (media) {
        this.fichiers.set(media.id, fichier);
        trouvees++;
      } else {
        inconnues.push(fichier.name);
      }
    }
    return { trouvees, inconnues };
  },

  /* Retire un média du projet (la vidéo reste dans la tablette, bien sûr) */
  async retirer(projet, id) {
    const media = projet.medias.find((m) => m.id === id);
    if (!media) return;
    projet.medias = projet.medias.filter((m) => m.id !== id);
    this.oublier(id);
    if (media.type !== 'video') {
      try { await Base.supprimerFichier(id); } catch (e) { /* déjà parti */ }
    }
  }
};


/* ---------- Erreur avec un message pour l'utilisatrice ---------- */
function erreurPourTous(message) {
  const e = new Error(message);
  e.messagePourTous = message;
  return e;
}


/* ---------- Analyser une vidéo ----------
   Lit la durée, la taille de l'image telle qu'on la voit (une vidéo
   filmée en vertical est souvent enregistrée « couchée » avec une
   consigne de rotation : Mediabunny en tient compte), la présence du
   son, et fabrique une miniature. */
async function analyserVideo(fichier) {
  const M = Mediabunny;
  const entree = new M.Input({ source: new M.BlobSource(fichier), formats: M.ALL_FORMATS });
  try {
    let piste;
    try {
      piste = await entree.getPrimaryVideoTrack();
    } catch (e) {
      if (e instanceof M.UnsupportedInputFormatError) {
        throw erreurPourTous("Ce fichier n'est pas une vidéo reconnue. Omni-Vidéo accepte les vidéos MP4, MOV et WebM.");
      }
      throw e;
    }
    if (!piste) throw erreurPourTous('Ce fichier ne contient pas d\'image vidéo.');

    const infos = {
      duree: await entree.computeDuration(),
      largeur: await piste.getDisplayWidth(),
      hauteur: await piste.getDisplayHeight(),
      aSon: false,
      miniature: '',
      probleme: ''
    };

    const codec = await piste.getCodec();
    if (!(await piste.canDecode())) {
      const nom = NOMS_CODECS[codec] || codec || 'inconnu';
      throw erreurPourTous('Cette vidéo est au format ' + nom + ', que ta tablette ne sait pas lire. ' +
        'Pour les prochaines vidéos, règle l\'appareil photo du téléphone sur « H.264 » ou « Le plus compatible ».');
    }

    const son = await entree.getPrimaryAudioTrack();
    infos.aSon = !!son && (await son.canDecode());

    infos.miniature = await miniatureVideo(piste, infos.duree);
    return infos;
  } finally {
    // On referme le fichier : la mémoire utilisée pour l'analyse est rendue
    entree.dispose();
  }
}

/* Une image prise vers le début de la vidéo (à 10 % de la durée, au
   maximum 1 seconde après le début : la toute première image est
   souvent noire). */
async function miniatureVideo(piste, duree) {
  const M = Mediabunny;
  const largeur = await piste.getDisplayWidth();
  const hauteur = await piste.getDisplayHeight();
  const taille = largeur >= hauteur ? { height: MINIATURE_COTE } : { width: MINIATURE_COTE };
  const sink = new M.CanvasSink(piste, taille);
  const debut = await piste.getFirstTimestamp();
  let image = await sink.getCanvas(debut + Math.min(1, duree * 0.1));
  if (!image) image = await sink.getCanvas(debut);
  if (!image) return '';
  return await toileEnImage(image.canvas, 'image/jpeg', 0.75);
}


/* ---------- Analyser une image ----------
   Les photos du téléphone sont souvent énormes (4000 × 3000 pixels).
   On en garde une version réduite à 1920 pixels de côté au plus : c'est
   assez pour la vidéo finale, et beaucoup plus léger en mémoire. */
async function analyserImage(fichier) {
  let image;
  try {
    // « from-image » : la photo est tournée dans le bon sens (EXIF)
    image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  } catch (e) {
    throw erreurPourTous('Ce format d\'image n\'est pas lisible ici. Choisis une image JPEG, PNG ou WebP.');
  }
  try {
    const echelle = Math.min(1, IMAGE_COTE_MAX / Math.max(image.width, image.height));
    const l = Math.max(1, Math.round(image.width * echelle));
    const h = Math.max(1, Math.round(image.height * echelle));

    // Les PNG, WebP et GIF peuvent être transparents : on garde la transparence
    const transparente = /png|webp|gif/i.test(fichier.type);
    const toile = nouvelleToile(l, h);
    toile.getContext('2d').drawImage(image, 0, 0, l, h);
    const blob = await toileEnBlob(toile, transparente ? 'image/png' : 'image/jpeg', 0.92);

    // Miniature
    const em = MINIATURE_COTE / Math.min(l, h);
    const mini = nouvelleToile(Math.max(1, Math.round(l * em)), Math.max(1, Math.round(h * em)));
    mini.getContext('2d').drawImage(toile, 0, 0, mini.width, mini.height);
    const miniature = await toileEnImage(mini, 'image/webp', 0.8);

    return { blob, infos: { largeur: l, hauteur: h, duree: 0, miniature } };
  } finally {
    image.close();   // libère la photo en mémoire tout de suite
  }
}


/* ---------- Analyser une musique ---------- */
async function analyserAudio(fichier) {
  const M = Mediabunny;
  const entree = new M.Input({ source: new M.BlobSource(fichier), formats: M.ALL_FORMATS });
  try {
    let piste;
    try {
      piste = await entree.getPrimaryAudioTrack();
    } catch (e) {
      if (e instanceof M.UnsupportedInputFormatError) {
        throw erreurPourTous('Ce format de musique n\'est pas pris en charge. Choisis un fichier MP3, M4A, WAV, OGG ou FLAC.');
      }
      throw e;
    }
    if (!piste) throw erreurPourTous('Ce fichier ne contient pas de son.');
    if (!(await piste.canDecode())) {
      throw erreurPourTous('Ta tablette ne sait pas lire ce format de musique. Choisis plutôt un fichier MP3.');
    }
    return { duree: await entree.computeDuration(), probleme: '' };
  } finally {
    entree.dispose();
  }
}


/* ---------- Petites aides pour les dessins (« toiles ») ---------- */

function nouvelleToile(largeur, hauteur) {
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  return toile;
}

/* Une toile → un fichier image (Blob) */
function toileEnBlob(toile, type, qualite) {
  if (typeof toile.convertToBlob === 'function') return toile.convertToBlob({ type, quality: qualite });
  return new Promise((reussir, echouer) => {
    toile.toBlob((blob) => (blob ? reussir(blob) : echouer(new Error('Image impossible'))), type, qualite);
  });
}

/* Une toile → une petite image écrite en texte (« data:image/… »),
   facile à ranger dans la description du projet. */
async function toileEnImage(toile, type, qualite) {
  if (typeof toile.toDataURL === 'function') return toile.toDataURL(type, qualite);
  const blob = await toileEnBlob(toile, type, qualite);
  return new Promise((reussir) => {
    const lecteur = new FileReader();
    lecteur.onload = () => reussir(lecteur.result);
    lecteur.onerror = () => reussir('');
    lecteur.readAsDataURL(blob);
  });
}
