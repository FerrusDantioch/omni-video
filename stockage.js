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
    clips
  };
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
    volume: borner(Number.isFinite(brut.volume) ? brut.volume : 1, 0, 1)
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
    probleme: typeof brut.probleme === 'string' ? brut.probleme : ''   // texte si le fichier est illisible
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
