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
      const nb = (type) => p.medias.filter((m) => m.type === type).length;
      const morceaux = [NOMS_FORMATS[p.format]];
      const v = nb('video'), i = nb('image'), a = nb('audio');
      if (v) morceaux.push(v + (v > 1 ? ' vidéos' : ' vidéo'));
      if (i) morceaux.push(i + (i > 1 ? ' images' : ' image'));
      if (a) morceaux.push(a + (a > 1 ? ' musiques' : ' musique'));
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
    this.courant = projet;
    await Medias.chargerFichiersLegers(projet);
    allerA('projet');
  },

  /* Appelé quand on quitte l'écran du projet */
  fermer() {
    if (!this.courant) return;
    this.enregistrerMaintenant();
    Apercu.vider();
    this.courant = null;
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
    const medias = projet.medias.slice().sort((a, b) => ORDRE_TYPES[a.type] - ORDRE_TYPES[b.type]);
    const actif = Apercu.media && Apercu.media.id;
    $('#liste-medias').innerHTML = medias.map((m) => carteMedia(m, m.id === actif)).join('');
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
    let bilan;
    try {
      bilan = await Medias.importer(projet, type, fichiers, (texte) => ecrireTexte(etat, texte));
    } finally {
      this._importEnCours = false;
      $$('[data-action="importer"]').forEach((b) => { b.disabled = false; });
      etat.hidden = true;
    }
    this.modifie();
    if (projet !== this.courant) return;
    this.afficherProjet();
    // Demande à la tablette de ne pas effacer nos données (une fois suffit)
    Persistance.demander();

    // Le bilan, en mots simples
    const mots = { video: ['vidéo ajoutée', 'vidéos ajoutées'], image: ['image ajoutée', 'images ajoutées'], audio: ['musique ajoutée', 'musiques ajoutées'] }[type];
    if (bilan.refus.length === 0) {
      Message.montrer(bilan.ajoutes + ' ' + mots[bilan.ajoutes > 1 ? 1 : 0] + ' ✓');
    } else {
      const premier = bilan.refus[0];
      Message.probleme((bilan.ajoutes ? bilan.ajoutes + ' ' + mots[bilan.ajoutes > 1 ? 1 : 0] + '. ' : '') +
        '« ' + premier.nom + ' » : ' + premier.raison +
        (bilan.refus.length > 1 ? ' (et ' + (bilan.refus.length - 1) + ' autre' + (bilan.refus.length > 2 ? 's' : '') + ')' : ''));
    }
    // Première vidéo du projet : on la montre tout de suite
    if (!Apercu.media) {
      const premiere = projet.medias.find((m) => m.type === 'video' && !m.probleme && Medias.disponible(m));
      if (premiere) { Apercu.montrer(premiere); this.afficherMedias(); }
    }
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
      if (Apercu.media) Apercu.montrer(Apercu.media);
    };
    champ.click();
  },

  voirMedia(id) {
    const media = this.courant && this.courant.medias.find((m) => m.id === id);
    if (!media) return;
    Apercu.montrer(media);
    this.afficherMedias();
    // Sur une tablette tenue en portrait, l'aperçu est au-dessus : on y remonte
    $('#cadre-apercu').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  retirerMedia(id, bouton) {
    armerBouton(bouton, 'Retirer du projet ?', async () => {
      const projet = this.courant;
      if (!projet) return;
      if (Apercu.media && Apercu.media.id === id) Apercu.vider();
      await Medias.retirer(projet, id);
      this.modifie();
      this.afficherProjet();
      Message.montrer('Fichier retiré du projet. Il est toujours dans la tablette.');
    });
  }
};


/* ---------- La carte d'un fichier dans « Mes fichiers » ---------- */
function carteMedia(m, actif) {
  const disponible = Medias.disponible(m);
  const classes = ['media'];
  if (actif) classes.push('actif');
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
