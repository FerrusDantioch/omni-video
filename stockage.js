/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — stockage.js
   Tout ce qui est enregistré dans la tablette, dans une petite base de
   données du navigateur appelée IndexedDB. Aucun compte, aucun serveur :
   rien ne quitte l'appareil.

   La base contient deux « tiroirs » :
   - « projets » : la description de chaque projet (nom, forme, liste des
     fichiers, et plus tard la chronologie, les textes…). C'est léger.
   - « fichiers » : les fichiers légers qu'Omni-Vidéo garde lui-même :
     images, musiques, voix off. Rangés sous le numéro du fichier.

   ⚠️ Les VIDÉOS, elles, ne sont jamais copiées ici (trop lourdes : 1 à 3 Go
   pour 30 minutes). Seuls leur nom, leur taille et une miniature sont
   retenus ; à la réouverture d'un projet, on les redemande (voir medias.js).

   ⚠️ Toutes les applications de ferrusdantioch.github.io partagent le même
   espace de stockage. Tous les noms commencent donc par « omnivideo »
   pour ne jamais se mélanger avec ceux de L'Atelier, Omni-Time, etc.
   ============================================================ */
'use strict';

const NOM_BASE = 'omnivideo';
const VERSION_BASE = 1;   // à augmenter seulement si on ajoute un tiroir

const Base = {
  _promesse: null,   // la base ouverte (on ne l'ouvre qu'une fois)

  /* Ouvre la base (et la crée au tout premier lancement). */
  ouvrir() {
    if (this._promesse) return this._promesse;
    this._promesse = new Promise((reussir, echouer) => {
      let demande;
      try {
        demande = indexedDB.open(NOM_BASE, VERSION_BASE);
      } catch (e) {
        echouer(e);
        return;
      }
      // Premier lancement (ou nouvelle version) : on crée les tiroirs
      demande.onupgradeneeded = () => {
        const base = demande.result;
        if (!base.objectStoreNames.contains('projets')) base.createObjectStore('projets', { keyPath: 'id' });
        if (!base.objectStoreNames.contains('fichiers')) base.createObjectStore('fichiers');
      };
      demande.onsuccess = () => reussir(demande.result);
      demande.onerror = () => echouer(demande.error);
      demande.onblocked = () => echouer(new Error('Base bloquée par un autre onglet'));
    });
    // Si l'ouverture échoue, on pourra réessayer plus tard
    this._promesse.catch(() => { this._promesse = null; });
    return this._promesse;
  },

  /* Petite aide : fait une opération dans un tiroir et attend la fin. */
  async _operation(tiroir, mode, travail) {
    const base = await this.ouvrir();
    return new Promise((reussir, echouer) => {
      const transaction = base.transaction(tiroir, mode);
      const magasin = transaction.objectStore(tiroir);
      let resultat;
      const demande = travail(magasin);
      if (demande) demande.onsuccess = () => { resultat = demande.result; };
      transaction.oncomplete = () => reussir(resultat);
      transaction.onerror = () => echouer(transaction.error);
      transaction.onabort = () => echouer(transaction.error || new Error('Opération annulée'));
    });
  },

  /* ----- Projets ----- */

  async lireProjets() {
    const liste = await this._operation('projets', 'readonly', (m) => m.getAll());
    return (liste || []).map(nettoyerProjet).filter(Boolean);
  },

  async lireProjet(id) {
    return nettoyerProjet(await this._operation('projets', 'readonly', (m) => m.get(id)));
  },

  async enregistrerProjet(projet) {
    await this._operation('projets', 'readwrite', (m) => m.put(projet));
  },

  /* Supprime un projet ET les fichiers qu'Omni-Vidéo gardait pour lui
     (images, musiques). Les vidéos de la tablette, elles, ne sont jamais
     touchées : elles restent dans la galerie. */
  async supprimerProjet(projet) {
    const ids = projet.medias.map((m) => m.id);
    await this._operation('fichiers', 'readwrite', (m) => { ids.forEach((id) => m.delete(id)); });
    await this._operation('projets', 'readwrite', (m) => m.delete(projet.id));
  },

  /* ----- Fichiers légers (images, musiques, voix) ----- */

  async lireFichier(id) {
    return (await this._operation('fichiers', 'readonly', (m) => m.get(id))) || null;
  },

  async enregistrerFichier(id, blob) {
    await this._operation('fichiers', 'readwrite', (m) => m.put(blob, id));
  },

  async supprimerFichier(id) {
    await this._operation('fichiers', 'readwrite', (m) => m.delete(id));
  }
};


/* ---------- La forme d'un projet ----------
   Un projet est un simple objet. nettoyerProjet() vérifie chaque champ
   et met une valeur par défaut s'il manque quelque chose : un projet
   abîmé (ou enregistré par une ancienne version) ne fait jamais planter
   l'application.
   ⚠️ Elle ne garde QUE les champs qu'elle connaît : tout nouveau champ
   doit y être ajouté. */

const FORMATS = ['16:9', '9:16'];
const AJUSTEMENTS = ['contenir', 'remplir'];
const TYPES_MEDIA = ['video', 'image', 'audio'];

function nouveauProjet(nom, format) {
  const maintenant = Date.now();
  return nettoyerProjet({
    id: nouvelId(),
    nom: nom,
    format: format,
    cree: maintenant,
    modifie: maintenant
  });
}

function nettoyerProjet(brut) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  const texte = (v, defaut) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : defaut);
  const nombre = (v, defaut) => (Number.isFinite(v) ? v : defaut);
  const medias = Array.isArray(brut.medias) ? brut.medias.map(nettoyerMedia).filter(Boolean) : [];
  // Un clip dont le fichier a disparu du projet est oublié
  const clips = Array.isArray(brut.clips)
    ? brut.clips.map((c) => nettoyerClip(c, medias)).filter(Boolean)
    : [];
  return {
    id: brut.id,
    version: 1,
    nom: texte(brut.nom, 'Projet sans nom'),
    format: FORMATS.includes(brut.format) ? brut.format : '16:9',
    ajustement: AJUSTEMENTS.includes(brut.ajustement) ? brut.ajustement : 'contenir',
    cree: nombre(brut.cree, Date.now()),
    modifie: nombre(brut.modifie, Date.now()),
    medias,
    clips,
    calques: Array.isArray(brut.calques)
      ? brut.calques.map((c) => nettoyerCalque(c, medias)).filter(Boolean)
      : [],
    pistes: Array.isArray(brut.pistes)
      ? brut.pistes.map((p) => nettoyerPiste(p, medias)).filter(Boolean)
      : [],
    // Fondu au noir au tout début et à la toute fin de la vidéo
    transitionDebut: nettoyerTransition(brut.transitionDebut, TYPES_TRANSITION_BORD),
    transitionFin: nettoyerTransition(brut.transitionFin, TYPES_TRANSITION_BORD),
    sousTitres: nettoyerSousTitres(brut.sousTitres),
    styleSousTitres: nettoyerStyleSousTitres(brut.styleSousTitres)
  };
}

/* Les sous-titres : ce qui est dit, écrit en bas de l'image.
   - debut / duree : en secondes, dans la vidéo finale (comme les textes).
   - texte : une ou deux lignes.
   La liste est toujours rangée dans l'ordre du temps. */
const SOUS_TITRES_MAX = 5000;
const DUREE_SOUS_TITRE_MIN = 0.2;

function nettoyerSousTitre(brut) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  const nombre = (v, defaut, min, max) => borner(Number.isFinite(v) ? v : defaut, min, max);
  return {
    id: brut.id,
    debut: nombre(brut.debut, 0, 0, DUREE_CALQUE_MAX),
    duree: nombre(brut.duree, 3, DUREE_SOUS_TITRE_MIN, 60),
    texte: typeof brut.texte === 'string' ? brut.texte.slice(0, 300) : ''
  };
}

function nettoyerSousTitres(liste) {
  if (!Array.isArray(liste)) return [];
  return liste.slice(0, SOUS_TITRES_MAX).map(nettoyerSousTitre).filter(Boolean)
    .sort((a, b) => a.debut - b.debut);
}

/* L'apparence des sous-titres : la même pour tous.
   - taille : petite, normale ou grande
   - place : en bas, un peu plus haut (YouTube Shorts cache le bas de
     l'image avec ses boutons), ou en haut
   - fond : bandeau sombre derrière le texte, ou contour noir
   - visibles : faux = les sous-titres ne sont ni dans l'aperçu, ni dans
     la vidéo finale (ils restent gardés) */
const TAILLES_SOUS_TITRES = ['petite', 'normale', 'grande'];
const PLACES_SOUS_TITRES = ['bas', 'releve', 'haut'];
const FONDS_SOUS_TITRES = ['bandeau', 'contour'];
const COULEURS_SOUS_TITRES = ['#ffffff', '#ffd84d'];

function nettoyerStyleSousTitres(brut) {
  const s = brut && typeof brut === 'object' ? brut : {};
  return {
    taille: TAILLES_SOUS_TITRES.includes(s.taille) ? s.taille : 'normale',
    place: PLACES_SOUS_TITRES.includes(s.place) ? s.place : 'bas',
    fond: FONDS_SOUS_TITRES.includes(s.fond) ? s.fond : 'bandeau',
    couleur: COULEURS_SOUS_TITRES.includes(s.couleur) ? s.couleur : '#ffffff',
    visibles: s.visibles !== false
  };
}

/* Un calque : un texte ou une image posé PAR-DESSUS la vidéo, pendant un
   moment donné.
   - debut / duree : en secondes, dans la vidéo finale (la chronologie).
   - x / y : la place du centre, en fractions de l'image (0 = bord gauche
     ou haut, 1 = bord droit ou bas). Ainsi, la place reste juste en
     720p comme en 1080p, et même si on change de forme 16:9 ↔ 9:16.
   - fondu : apparition et disparition en douceur.
   Pour un texte : texte, police, taille (en % du côté le plus court de l'image),
   couleur, style (ombre, contour, bandeau, aucun), gras.
   Pour une image : mediaId (une image de « Mes fichiers ») et largeur
   (en % de la largeur de l'image). */
const POLICES_TEXTE = ['oxanium', 'literata', 'mono', 'simple', 'classique'];
const STYLES_TEXTE = ['ombre', 'contour', 'bandeau', 'aucun'];
const DUREE_CALQUE_MIN = 0.3;
const DUREE_CALQUE_MAX = 3 * 3600;

function nettoyerCalque(brut, medias) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  if (brut.type !== 'texte' && brut.type !== 'image') return null;
  const nombre = (v, defaut, min, max) => borner(Number.isFinite(v) ? v : defaut, min, max);
  const commun = {
    id: brut.id,
    type: brut.type,
    debut: nombre(brut.debut, 0, 0, DUREE_CALQUE_MAX),
    duree: nombre(brut.duree, 4, DUREE_CALQUE_MIN, DUREE_CALQUE_MAX),
    x: nombre(brut.x, 0.5, 0, 1),
    y: nombre(brut.y, 0.5, 0, 1),
    fondu: brut.fondu !== false
  };
  if (brut.type === 'texte') {
    return Object.assign(commun, {
      texte: typeof brut.texte === 'string' ? brut.texte.slice(0, 300) : '',
      police: POLICES_TEXTE.includes(brut.police) ? brut.police : 'oxanium',
      taille: nombre(brut.taille, 8, 3, 20),
      couleur: /^#[0-9a-f]{6}$/i.test(brut.couleur) ? brut.couleur.toLowerCase() : '#ffffff',
      style: STYLES_TEXTE.includes(brut.style) ? brut.style : 'ombre',
      gras: brut.gras !== false
    });
  }
  // Une image incrustée dont le fichier a été retiré du projet est oubliée
  const media = medias.find((m) => m.id === brut.mediaId && m.type === 'image');
  if (!media) return null;
  return Object.assign(commun, {
    mediaId: media.id,
    largeur: nombre(brut.largeur, 30, 5, 100)
  });
}

/* Un clip : un morceau d'une vidéo (ou une image) placé dans la
   chronologie. Les clips sont joués les uns après les autres, dans
   l'ordre de la liste.
   - debut / fin : le morceau gardé, en secondes, dans le fichier
     d'origine (pour une image : 0 et la durée d'affichage).
   - volume : 1 = volume normal, 0 = muet. */
const DUREE_IMAGE_DEFAUT = 5;   // secondes d'affichage d'une image ajoutée
const DUREE_IMAGE_MAX = 600;
const DUREE_CLIP_MIN = 0.1;     // un clip ne peut pas être plus court

function nettoyerClip(brut, medias) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  const media = medias.find((m) => m.id === brut.mediaId);
  if (!media || media.type === 'audio') return null;
  const limite = media.type === 'video' && media.duree > 0 ? media.duree : DUREE_IMAGE_MAX;
  const debut = borner(Number.isFinite(brut.debut) ? brut.debut : 0, 0, Math.max(0, limite - DUREE_CLIP_MIN));
  const fin = borner(Number.isFinite(brut.fin) ? brut.fin : limite, debut + DUREE_CLIP_MIN, limite);
  return {
    id: brut.id,
    mediaId: media.id,
    debut,
    fin,
    volume: borner(Number.isFinite(brut.volume) ? brut.volume : 1, 0, 1),
    // La transition qui mène À ce clip depuis le précédent (ignorée pour le premier)
    transition: nettoyerTransition(brut.transition, TYPES_TRANSITION)
  };
}

/* Une transition : { type, duree }.
   - aucune     : coupe nette
   - fondu      : fondu au noir (l'image s'assombrit, puis la suivante apparaît)
   - enchaine   : fondu enchaîné (une image se fond dans l'autre)
   - glissement : la nouvelle image arrive par la droite et pousse l'ancienne
   Le fondu enchaîné et le glissement font se CHEVAUCHER les deux clips :
   la vidéo devient plus courte de la durée de la transition. */
const TYPES_TRANSITION = ['aucune', 'fondu', 'enchaine', 'glissement'];
const TYPES_TRANSITION_BORD = ['aucune', 'fondu'];   // tout début et toute fin de la vidéo
const DUREES_TRANSITION = [0.5, 1, 2];

function nettoyerTransition(brut, typesPermis) {
  const t = brut && typeof brut === 'object' ? brut : {};
  return {
    type: typesPermis.includes(t.type) ? t.type : 'aucune',
    duree: borner(Number.isFinite(t.duree) ? t.duree : 1, 0.3, 3)
  };
}

/* Une piste audio : une musique de fond ou une voix off, jouée en même
   temps que la vidéo.
   - debut : en secondes, dans la vidéo finale (la chronologie).
   - duree : combien de temps elle joue. Si « jusquALaFin » est vrai, elle
     joue jusqu'à la fin de la vidéo, quelle que soit sa longueur (une
     musique trop courte recommence alors depuis le début).
   - volume : 0 = muet, 1 = volume normal.
   Une musique recommence toujours si elle est plus courte que sa place ;
   une voix off, jamais. */
const TYPES_PISTE = ['musique', 'voix'];
const VOLUME_MUSIQUE_DEFAUT = 0.3;   // une musique de fond reste discrète

function nettoyerPiste(brut, medias) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  if (!TYPES_PISTE.includes(brut.type)) return null;
  const media = medias.find((m) => m.id === brut.mediaId && m.type === 'audio');
  if (!media) return null;
  const nombre = (v, defaut, min, max) => borner(Number.isFinite(v) ? v : defaut, min, max);
  return {
    id: brut.id,
    type: brut.type,
    mediaId: media.id,
    debut: nombre(brut.debut, 0, 0, DUREE_CALQUE_MAX),
    duree: nombre(brut.duree, media.duree || 1, DUREE_CALQUE_MIN, DUREE_CALQUE_MAX),
    jusquALaFin: !!brut.jusquALaFin,
    volume: nombre(brut.volume, brut.type === 'musique' ? VOLUME_MUSIQUE_DEFAUT : 1, 0, 1)
  };
}

/* Un fichier du projet (vidéo, image ou musique) */
function nettoyerMedia(brut) {
  if (!brut || typeof brut !== 'object' || typeof brut.id !== 'string') return null;
  if (!TYPES_MEDIA.includes(brut.type)) return null;
  const nombre = (v, defaut) => (Number.isFinite(v) ? v : defaut);
  return {
    id: brut.id,
    type: brut.type,
    nom: typeof brut.nom === 'string' ? brut.nom.slice(0, 300) : 'Fichier',
    taille: nombre(brut.taille, 0),            // en octets : sert à reconnaître la vidéo
    dateFichier: nombre(brut.dateFichier, 0),  // date de dernière modification du fichier
    duree: nombre(brut.duree, 0),              // en secondes (0 pour une image)
    largeur: nombre(brut.largeur, 0),          // telle qu'on la voit (rotation comprise)
    hauteur: nombre(brut.hauteur, 0),
    aSon: !!brut.aSon,                         // la vidéo contient-elle du son ?
    miniature: typeof brut.miniature === 'string' && brut.miniature.startsWith('data:image/') ? brut.miniature : '',
    probleme: typeof brut.probleme === 'string' ? brut.probleme : '',  // texte si le fichier est illisible
    voix: brut.type === 'audio' && !!brut.voix   // une voix off enregistrée au micro (pas dans « Mes fichiers »)
  };
}


/* ---------- Demander à la tablette de ne pas effacer nos données ----------
   Quand la mémoire est presque pleine, Chrome peut effacer les données
   des sites pour faire de la place. On lui demande de garder les nôtres
   (il dit oui, en général, pour une application installée). */
const Persistance = {
  async demander() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* pas grave : les données restent enregistrées quand même */ }
    return false;
  }
};


/* ---------- Traduire une erreur d'enregistrement en mots simples ---------- */
function messageErreurStockage(erreur) {
  const nom = erreur && erreur.name;
  if (nom === 'QuotaExceededError') {
    return "La mémoire de la tablette est pleine : Omni-Vidéo n'a pas pu tout enregistrer. " +
           'Libère un peu de place (anciennes vidéos, applications inutiles), puis réessaie.';
  }
  return "Omni-Vidéo n'a pas réussi à enregistrer. Ferme l'application et rouvre-la, puis réessaie.";
}
