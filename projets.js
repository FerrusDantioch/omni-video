/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — projets.js
   Les projets : la liste de l'accueil, créer, ouvrir, renommer,
   supprimer, changer la forme de la vidéo, et la SAUVEGARDE
   AUTOMATIQUE (chaque changement est enregistré moins d'une seconde
   après, sans rien avoir à toucher).
   ============================================================ */
'use strict';

const NOMS_FORMATS = { '16:9': 'Horizontale 16:9', '9:16': 'Verticale 9:16' };
const ORDRE_TYPES = { video: 0, image: 1, audio: 2 };

const Projets = {
  liste: [],          // tous les projets (pour l'accueil)
  courant: null,      // le projet ouvert
  _minuteur: null,    // sauvegarde automatique en attente
  _importEnCours: false,

  /* ---------- Accueil : la liste des projets ---------- */

  async afficherListe() {
    try {
      this.liste = await Base.lireProjets();
    } catch (e) {
      this.liste = [];
    }
    // Le plus récemment modifié en premier
    this.liste.sort((a, b) => b.modifie - a.modifie);
    const ul = $('#liste-projets');
    ul.innerHTML = this.liste.map((p) => {
      const nb = (type) => p.medias.filter((m) => m.type === type && !m.voix).length;
      const morceaux = [NOMS_FORMATS[p.format]];
      const v = nb('video'), i = nb('image'), a = nb('audio');
      if (v) morceaux.push(v + (v > 1 ? ' vidéos' : ' vidéo'));
      if (i) morceaux.push(i + (i > 1 ? ' images' : ' image'));
      if (a) morceaux.push(a + (a > 1 ? ' musiques' : ' musique'));
      const duree = p.clips.reduce((total, c) => total + (c.fin - c.debut), 0);
      if (duree > 0) morceaux.push('durée ' + dureeEnMots(duree));
      const voix = p.pistes.filter((x) => x.type === 'voix').length;
      if (voix) morceaux.push(voix + ' voix off');
      return '<li class="carte projet-carte">' +
        '<h3 class="projet-nom">' + proteger(p.nom) + '</h3>' +
        '<p class="projet-resume">' + proteger(morceaux.join(' · ')) + '<br>Modifié ' + proteger(dateEnMots(p.modifie)) + '</p>' +
        '<div class="rangee-2">' +
          '<button type="button" class="bouton bouton-principal" data-action="ouvrir-projet" data-id="' + proteger(p.id) + '">Ouvrir</button>' +
          '<button type="button" class="bouton" data-action="supprimer-projet" data-id="' + proteger(p.id) + '">' +
            '<svg class="icone" aria-hidden="true"><use href="#i-poubelle"/></svg>Supprimer</button>' +
        '</div>' +
      '</li>';
    }).join('');
    $('#projets-vide').hidden = this.liste.length > 0;
  },

  /* ---------- Créer un projet ---------- */

  creer() {
    const fenetre = $('#fenetre-nouveau');
    const formulaire = $('form', fenetre);
    formulaire.reset();
    fenetre.returnValue = '';
    fenetre.showModal();
    fenetre.onclose = async () => {
      if (fenetre.returnValue !== 'ok') return;
      const nom = formulaire.elements.nom.value.trim() || 'Ma vidéo du ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      const projet = nouveauProjet(nom, formulaire.elements.format.value);
      try {
        await Base.enregistrerProjet(projet);
      } catch (e) {
        Message.probleme(messageErreurStockage(e));
        return;
      }
      await this.ouvrir(projet.id);
    };
  },

  /* ---------- Ouvrir / fermer ---------- */

  async ouvrir(id) {
    let projet = null;
    try { projet = await Base.lireProjet(id); } catch (e) { /* traité juste en dessous */ }
    if (!projet) {
      Message.probleme('Ce projet est introuvable. Il a peut-être été supprimé.');
      this.afficherListe();
      return;
    }
    // Ménage : une voix off qui n'est plus utilisée nulle part (supprimée lors
    // d'une visite précédente) est effacée pour de bon, avec son fichier
    const orphelines = projet.medias.filter((m) => m.voix && !projet.pistes.some((x) => x.mediaId === m.id));
    if (orphelines.length) {
      projet.medias = projet.medias.filter((m) => !orphelines.includes(m));
      orphelines.forEach((m) => Base.supprimerFichier(m.id).catch(() => {}));
      Base.enregistrerProjet(projet).catch(() => {});
    }
    this.courant = projet;
    await Medias.chargerFichiersLegers(projet);
    allerA('projet');
    Onglets.ouvrir('fichiers');
    Chronologie.ouvrir(projet);
  },

  /* Appelé quand on quitte l'écran du projet */
  fermer() {
    if (!this.courant) return;
    this.enregistrerMaintenant();
    if (Enregistreur.enCours) Enregistreur.arreter();
    Visionneuse.fermer();
    Incrustations.fermerEditeur();
    Lecteur.vider();
    PistesAudio.vider();
    this.courant = null;
    Rendu.oublierImages();
    Incrustations.redessiner(true);
  },

  /* ---------- Sauvegarde automatique ----------
     Chaque changement appelle modifie() : on attend 700 ms (si on fait
     plusieurs changements d'affilée, une seule écriture suffit), puis on
     enregistre. Le petit texte en haut dit « Enregistré ✓ ». */

  modifie() {
    if (!this.courant) return;
    this.courant.modifie = Date.now();
    ecrireTexte($('#etat-sauvegarde'), 'Enregistrement…');
    clearTimeout(this._minuteur);
    this._minuteur = setTimeout(() => this.enregistrerMaintenant(), 700);
  },

  async enregistrerMaintenant() {
    clearTimeout(this._minuteur);
    this._minuteur = null;
    const projet = this.courant;
    if (!projet) return;
    try {
      await Base.enregistrerProjet(projet);
      if (projet === this.courant) ecrireTexte($('#etat-sauvegarde'), 'Enregistré ✓');
    } catch (e) {
      ecrireTexte($('#etat-sauvegarde'), 'Non enregistré');
      Message.probleme(messageErreurStockage(e));
    }
  },

  /* ---------- Renommer, forme de la vidéo, supprimer ---------- */

  renommer() {
    const projet = this.courant;
    if (!projet) return;
    const fenetre = $('#fenetre-renommer');
    const champ = $('input[name="nom"]', fenetre);
    champ.value = projet.nom;
    fenetre.returnValue = '';
    fenetre.showModal();
    champ.select();
    fenetre.onclose = () => {
      if (fenetre.returnValue !== 'ok' || projet !== this.courant) return;
      const nom = champ.value.trim();
      if (!nom || nom === projet.nom) return;
      projet.nom = nom.slice(0, 80);
      this.modifie();
      this.afficherProjet();
    };
  },

  changerFormat() {
    const projet = this.courant;
    if (!projet) return;
    const fenetre = $('#fenetre-format');
    const formulaire = $('form', fenetre);
    formulaire.elements.format.value = projet.format;
    formulaire.elements.ajustement.value = projet.ajustement;
    fenetre.returnValue = '';
    fenetre.showModal();
    fenetre.onclose = () => {
      if (fenetre.returnValue !== 'ok' || projet !== this.courant) return;
      projet.format = formulaire.elements.format.value;
      projet.ajustement = formulaire.elements.ajustement.value;
      this.modifie();
      this.afficherProjet();
    };
  },

  async supprimer(id, bouton) {
    armerBouton(bouton, 'Supprimer définitivement ?', async () => {
      const projet = this.liste.find((p) => p.id === id);
      if (!projet) return;
      try {
        await Base.supprimerProjet(projet);
        projet.medias.forEach((m) => Medias.oublier(m.id));
        Message.montrer('Projet « ' + projet.nom + ' » supprimé. Tes vidéos sont toujours dans la tablette.');
      } catch (e) {
        Message.probleme("Le projet n'a pas pu être supprimé. Réessaie dans un instant.");
      }
      this.afficherListe();
    });
  },

  /* ---------- L'écran du projet ---------- */

  afficherProjet() {
    const projet = this.courant;
    if (!projet) return;
    ecrireTexte($('#titre-projet'), projet.nom);
    ecrireTexte($('#bouton-format-texte'), NOMS_FORMATS[projet.format]);
    const cadre = $('#cadre-apercu');
    cadre.dataset.format = projet.format;
    cadre.dataset.ajustement = projet.ajustement;
    if (!$('#etat-sauvegarde').textContent) ecrireTexte($('#etat-sauvegarde'), 'Enregistré ✓');
    this.afficherManquantes();
    this.afficherMedias();
  },

  afficherManquantes() {
    const manquantes = Medias.manquantes(this.courant);
    const bandeau = $('#bandeau-manquants');
    bandeau.hidden = manquantes.length === 0;
    ecrireTexte($('#manquants-titre'), manquantes.length > 1
      ? manquantes.length + ' vidéos sont à retrouver'
      : 'Une vidéo est à retrouver');
  },

  afficherMedias() {
    const projet = this.courant;
    if (!projet) return;
    // Les voix off ne sont pas des fichiers de la tablette : elles se
    // trouvent dans l'onglet « Son »
    const medias = projet.medias.filter((m) => !m.voix).sort((a, b) => ORDRE_TYPES[a.type] - ORDRE_TYPES[b.type]);
    $('#liste-medias').innerHTML = medias.map((m) => carteMedia(m, utilisations(projet, m.id))).join('');
    $('#medias-vide').hidden = medias.length > 0;
  },

  /* ---------- Importer des fichiers ---------- */

  choisirFichiers(type) {
    if (this._importEnCours) {
      Message.montrer('Patiente un instant : Omni-Vidéo prépare encore les fichiers précédents.');
      return;
    }
    const champ = $('#choisir-' + type);
    champ.value = '';   // permet de choisir deux fois le même fichier
    champ.onchange = () => this.importer(type, champ.files);
    champ.click();
  },

  async importer(type, fichiers) {
    const projet = this.courant;
    if (!projet || !fichiers || !fichiers.length) return;
    this._importEnCours = true;
    $$('[data-action="importer"]').forEach((b) => { b.disabled = true; });
    const etat = $('#import-etat');
    etat.hidden = false;
    const dejaLa = new Set(projet.medias.map((m) => m.id));
    let bilan;
    try {
      bilan = await Medias.importer(projet, type, fichiers, (texte) => ecrireTexte(etat, texte));
    } finally {
      this._importEnCours = false;
      $$('[data-action="importer"]').forEach((b) => { b.disabled = false; });
      etat.hidden = true;
    }
    if (projet !== this.courant) { Base.enregistrerProjet(projet).catch(() => {}); return; }

    // Premières vidéos d'un projet vide : on les place tout de suite dans
    // la chronologie, dans l'ordre choisi (c'est presque toujours ce qu'on veut)
    let placees = 0;
    if (type === 'video' && projet.clips.length === 0) {
      const nouvelles = projet.medias.filter((m) => !dejaLa.has(m.id) && m.type === 'video' && !m.probleme && Medias.disponible(m));
      nouvelles.forEach((m) => {
        projet.clips.push(nettoyerClip({ id: nouvelId(), mediaId: m.id, debut: 0, fin: m.duree }, projet.medias));
      });
      placees = nouvelles.length;
    }
    this.modifie();
    this.afficherProjet();
    if (placees) {
      Lecteur.calculer(projet);
      Chronologie.pps = Chronologie._zoomPourTout(Lecteur.duree());
      Chronologie.dessiner();
      Lecteur.aller(0);
    } else {
      this.rafraichirMontage();
    }
    // Le choix des images à incruster était ouvert : il montre les nouvelles
    if (type === 'image' && !$('#choix-incrustation').hidden) Incrustations.montrerChoixImages(true);
    if (type === 'audio' && !$('#choix-musique').hidden) PistesAudio.montrerChoixMusiques(true);
    // Demande à la tablette de ne pas effacer nos données (une fois suffit)
    Persistance.demander();

    // Le bilan, en mots simples
    const mots = { video: ['vidéo ajoutée', 'vidéos ajoutées'], image: ['image ajoutée', 'images ajoutées'], audio: ['musique ajoutée', 'musiques ajoutées'] }[type];
    if (bilan.refus.length === 0) {
      Message.montrer(bilan.ajoutes + ' ' + mots[bilan.ajoutes > 1 ? 1 : 0] + ' ✓' +
        (placees ? (placees > 1 ? ' Elles sont placées dans la chronologie.' : ' Elle est placée dans la chronologie.') : ''));
    } else {
      const premier = bilan.refus[0];
      Message.probleme((bilan.ajoutes ? bilan.ajoutes + ' ' + mots[bilan.ajoutes > 1 ? 1 : 0] + '. ' : '') +
        '« ' + premier.nom + ' » : ' + premier.raison +
        (bilan.refus.length > 1 ? ' (et ' + (bilan.refus.length - 1) + ' autre' + (bilan.refus.length > 2 ? 's' : '') + ')' : ''));
    }
  },

  /* Après un changement des fichiers (vidéo retrouvée, retirée…) :
     l'aperçu et la chronologie se remettent à jour, sans bouger la ligne. */
  rafraichirMontage() {
    if (!this.courant) return;
    Lecteur.pause();
    Lecteur.calculer(this.courant);
    Chronologie.dessiner();
    Lecteur.aller(Lecteur.t);
  },

  retrouverVideos() {
    const champ = $('#choisir-retrouver');
    champ.value = '';
    champ.onchange = () => {
      const projet = this.courant;
      if (!projet || !champ.files.length) return;
      const resultat = Medias.retrouver(projet, champ.files);
      const reste = Medias.manquantes(projet).length;
      if (resultat.trouvees && !reste) {
        Message.montrer(resultat.trouvees > 1 ? 'Toutes les vidéos sont retrouvées ✓' : 'Vidéo retrouvée ✓');
      } else if (resultat.trouvees) {
        Message.montrer(resultat.trouvees + ' retrouvée' + (resultat.trouvees > 1 ? 's' : '') + ' ✓ — il en reste ' + reste + '.');
      } else {
        Message.probleme('Aucune de ces vidéos ne fait partie du projet. Choisis exactement les vidéos utilisées (même nom de fichier).');
      }
      this.afficherProjet();
      this.rafraichirMontage();
    };
    champ.click();
  },

  media(id) {
    return this.courant ? this.courant.medias.find((m) => m.id === id) || null : null;
  },

  voirMedia(id) {
    const media = this.media(id);
    if (media) Visionneuse.ouvrir(media);
  },

  ajouterAuMontage(id) {
    const media = this.media(id);
    if (!media) return;
    Chronologie.ajouter(media);
    Message.montrer((media.type === 'image' ? 'Image ajoutée' : 'Vidéo ajoutée') + ' à la fin de la chronologie ✓');
  },

  retirerMedia(id, bouton) {
    const projet = this.courant;
    if (!projet) return;
    const n = utilisations(projet, id);
    const question = n > 1 ? 'Retirer, et ses ' + n + ' utilisations ?' : n === 1 ? 'Retirer, et son utilisation ?' : 'Retirer du projet ?';
    armerBouton(bouton, question, async () => {
      if (projet !== this.courant) return;
      if (Visionneuse.media && Visionneuse.media.id === id) Visionneuse.fermer();
      // Les clips et les incrustations de ce fichier quittent la vidéo
      projet.clips = projet.clips.filter((c) => c.mediaId !== id);
      projet.calques = projet.calques.filter((c) => c.mediaId !== id);
      projet.pistes = projet.pistes.filter((x) => x.mediaId !== id);
      PistesAudio.synchroniser();
      PistesAudio.afficherListes();
      Rendu.oublierImages();
      if (Incrustations.edite && !Incrustations.calque(Incrustations.edite)) Incrustations.fermerEditeur();
      await Medias.retirer(projet, id);
      this.modifie();
      this.afficherProjet();
      this.rafraichirMontage();
      Chronologie.majBoutonsHistorique();
      Message.montrer('Fichier retiré du projet. Il est toujours dans la tablette.');
    });
  }
};

/* Combien de fois un fichier est-il utilisé dans la vidéo (clips et
   images incrustées) ? */
function utilisations(projet, mediaId) {
  return projet.clips.filter((c) => c.mediaId === mediaId).length +
         projet.calques.filter((c) => c.mediaId === mediaId).length +
         projet.pistes.filter((x) => x.mediaId === mediaId).length;
}


/* ---------- La carte d'un fichier dans « Mes fichiers » ---------- */
function carteMedia(m, utilise) {
  const disponible = Medias.disponible(m);
  const classes = ['media'];
  if (utilise) classes.push('utilise');
  if (m.probleme) classes.push('illisible');
  else if (!disponible) classes.push('manquant');

  const icone = { video: 'i-video', image: 'i-image', audio: 'i-musique' }[m.type];
  const vignette = m.miniature
    ? '<img src="' + m.miniature + '" alt="">'
    : '<svg class="icone" aria-hidden="true"><use href="#' + icone + '"/></svg>';
  const duree = m.type !== 'image' && m.duree ? '<span class="media-duree">' + formaterDuree(m.duree) + '</span>' : '';

  const details = [];
  if (m.type === 'audio') {
    details.push('<span class="pastille">Musique</span>');
  } else if (m.largeur && m.hauteur) {
    const sens = m.largeur > m.hauteur ? 'Horizontale' : m.largeur < m.hauteur ? 'Verticale' : 'Carrée';
    details.push('<span class="pastille">' + sens + '</span>' + m.largeur + ' × ' + m.hauteur);
  }
  details.push(tailleEnTexte(m.taille));
  if (m.type === 'video' && !m.probleme) details.push(m.aSon ? 'avec son' : 'sans son');
  if (utilise) details.push('<strong>dans la vidéo' + (utilise > 1 ? ' (' + utilise + ' fois)' : '') + '</strong>');

  let probleme = '';
  if (m.probleme) probleme = '<p class="media-probleme">' + proteger(m.probleme) + '</p>';
  else if (!disponible && m.type === 'video') probleme = '<p class="media-probleme">À retrouver (voir en haut de l\'écran)</p>';
  else if (!disponible) probleme = '<p class="media-probleme">Introuvable : retire-le, puis ajoute-le à nouveau.</p>';

  const id = proteger(m.id);
  return '<li class="' + classes.join(' ') + '">' +
    '<button type="button" class="media-voir" data-action="voir-media" data-id="' + id + '" aria-label="Voir « ' + proteger(m.nom) + ' »">' +
      vignette + duree + '</button>' +
    '<div class="media-infos">' +
      '<p class="media-nom">' + proteger(m.nom) + '</p>' +
      '<p class="media-details">' + details.join(' · ') + '</p>' +
      probleme +
      '<div class="media-actions">' +
        (m.type !== 'audio' && !m.probleme && disponible
          ? '<button type="button" class="bouton bouton-principal" data-action="ajouter-au-montage" data-id="' + id + '">' +
            '<svg class="icone" aria-hidden="true"><use href="#i-plus"/></svg>Ajouter à la vidéo</button>'
          : '') +
        (m.type === 'audio' && !m.probleme && disponible
          ? '<button type="button" class="bouton bouton-principal" data-action="ajouter-musique" data-id="' + id + '">' +
            '<svg class="icone" aria-hidden="true"><use href="#i-plus"/></svg>Mettre en musique de fond</button>'
          : '') +
        '<button type="button" class="bouton" data-action="voir-media" data-id="' + id + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-lecture"/></svg>Voir</button>' +
        '<button type="button" class="bouton bouton-discret" data-action="retirer-media" data-id="' + id + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-poubelle"/></svg>Retirer</button>' +
      '</div>' +
    '</div>' +
  '</li>';
}

/* « aujourd'hui à 15:20 », « hier à 9:05 », « le 3 octobre à 18:00 » */
function dateEnMots(horodatage) {
  const date = new Date(horodatage);
  const heure = date.getHours() + ':' + deuxChiffres(date.getMinutes());
  const auj = new Date();
  const hier = new Date(); hier.setDate(auj.getDate() - 1);
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  if (memeJour(date, auj)) return 'aujourd\'hui à ' + heure;
  if (memeJour(date, hier)) return 'hier à ' + heure;
  const options = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== auj.getFullYear()) options.year = 'numeric';
  return 'le ' + date.toLocaleDateString('fr-FR', options) + ' à ' + heure;
}
