/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — youtube.js
   L'onglet « YouTube » : ce qui accompagne la vidéo quand on la publie.
   - La MINIATURE : une image de la vidéo, avec un titre écrit en gros,
     enregistrée en JPEG (1280 × 720, la taille demandée par YouTube).
   - Les CHAPITRES : des repères dans la vidéo (« Intro », « Recette »…).
     Omni-Vidéo prépare le texte à coller dans la description YouTube
     (« 0:00 Intro », « 1:24 Recette »…), que YouTube transforme en
     chapitres cliquables.
   Les deux sont gardés dans le projet (projet.miniature, projet.chapitres).
   ============================================================ */
'use strict';

/* Taille du titre de la miniature, en % du côté le plus court de l'image */
const TAILLE_TITRE_MINIATURE = { normale: 9, grande: 12, enorme: 15 };
const Y_TITRE_MINIATURE = { haut: 0, centre: 0.5, bas: 1 };
const QUALITE_JPEG_MINIATURE = 0.9;   // YouTube refuse les miniatures de plus de 2 Mo

/* Les règles de YouTube pour que les chapitres apparaissent */
const CHAPITRES_MIN = 3;
const DUREE_CHAPITRE_MIN = 10;   // secondes

const Miniature = {
  _fond: null,       // l'image de la vidéo (toile), sans le titre
  _cleFond: '',      // ce qui a servi à la fabriquer (pour ne pas la refaire pour rien)
  _enCours: null,    // fabrication de l'image en cours

  initialiser() {
    $('#miniature-couleurs').innerHTML = COULEURS_TEXTE.map((c) =>
      '<button type="button" class="pastille-couleur" data-action="miniature-reglage" data-reglage="couleur" data-valeur="' + c.valeur + '" ' +
      'style="--couleur:' + c.valeur + '" aria-label="' + c.nom + '"><span>' + c.nom + '</span></button>').join('');
    $('#miniature-texte').addEventListener('input', (e) => {
      const projet = Projets.courant;
      if (!projet) return;
      projet.miniature.texte = e.target.value;
      Projets.modifie();
      this.dessinerApercu();
    });
  },

  /* 1280 × 720 pour une vidéo horizontale, 720 × 1280 pour un Short */
  taille(projet) {
    return projet.format === '9:16' ? { largeur: 720, hauteur: 1280 } : { largeur: 1280, hauteur: 720 };
  },

  /* L'onglet s'ouvre (ou le projet a changé) */
  afficher() {
    const projet = Projets.courant;
    if (!projet) return;
    const m = projet.miniature;
    const total = Lecteur.duree();
    // Première fois : l'image de la ligne violette
    if (m.t === null && total > 0) { m.t = Lecteur.t; Projets.modifie(); }
    const champ = $('#miniature-texte');
    if (champ.value !== m.texte) champ.value = m.texte;
    $$('[data-action="miniature-reglage"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(m[b.dataset.reglage] === b.dataset.valeur));
    });
    $('#miniature-apercu').dataset.format = projet.format;
    ecrireTexte($('#miniature-moment'), total > 0 && m.t !== null
      ? 'Image prise à ' + formaterPosition(m.t) + ' dans la vidéo.'
      : 'Ajoute d\'abord des clips dans la chronologie.');
    $('#miniature-enregistrer').disabled = total <= 0;
    this.dessinerApercu();
    this.preparerFond().catch(signalerErreur);
  },

  changer(reglage, valeur) {
    const projet = Projets.courant;
    if (!projet) return;
    projet.miniature[reglage] = valeur;
    Projets.modifie();
    this.afficher();
  },

  /* « Prendre l'image de la ligne violette » */
  prendreImage() {
    const projet = Projets.courant;
    if (!projet || Lecteur.duree() <= 0) return;
    Lecteur.pause();
    projet.miniature.t = Lecteur.t;
    Projets.modifie();
    this.afficher();
  },

  /* Tout ce dont dépend l'image de la vidéo : si rien n'a changé, inutile de la refaire */
  _cle(projet) {
    return JSON.stringify([projet.id, projet.miniature.t, projet.format, projet.ajustement, projet.clips,
      projet.transitionDebut, projet.transitionFin, Array.from(Medias.fichiers.keys())]);
  },

  /* Fabrique l'image de la vidéo au moment choisi (une seule fois pour
     un même moment et un même montage) */
  async preparerFond() {
    const projet = Projets.courant;
    if (!projet || projet.miniature.t === null || Lecteur.duree() <= 0) return null;
    const { largeur, hauteur } = this.taille(projet);
    const cle = this._cle(projet);
    if (cle === this._cleFond && this._fond) return this._fond;
    if (this._enCours && this._enCours.cle === cle) return this._enCours.promesse;
    const promesse = imageDuMontage(projet, projet.miniature.t, largeur, hauteur).then((toile) => {
      if (this._enCours && this._enCours.cle === cle) {
        this._fond = toile;
        this._cleFond = cle;
        this._enCours = null;
        if (Projets.courant === projet) this.dessinerApercu();
      }
      return toile;
    });
    this._enCours = { cle, promesse };
    promesse.catch(() => { if (this._enCours && this._enCours.cle === cle) this._enCours = null; });
    return promesse;
  },

  /* Dessine la miniature complète (image + titre) sur une toile */
  dessinerSur(ctx, largeur, hauteur, projet, fond) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, largeur, hauteur);
    if (fond) ctx.drawImage(fond, 0, 0, largeur, hauteur);
    const m = projet.miniature;
    if (!m.texte.trim()) return;
    ctx.save();
    Rendu.dessinerTexte(ctx, largeur, hauteur, {
      texte: m.texte,
      police: 'oxanium',
      gras: true,
      style: 'contour',
      couleur: m.couleur,
      taille: TAILLE_TITRE_MINIATURE[m.taille],
      x: 0.5,
      y: Y_TITRE_MINIATURE[m.place],
      marge: 0.05
    });
    ctx.restore();
  },

  /* Le petit aperçu dans l'onglet (moitié de la vraie taille) */
  dessinerApercu() {
    const projet = Projets.courant;
    if (!projet) return;
    const toile = $('#miniature-apercu');
    const { largeur, hauteur } = this.taille(projet);
    if (toile.width !== largeur / 2 || toile.height !== hauteur / 2) {
      toile.width = largeur / 2;
      toile.height = hauteur / 2;
    }
    const fond = this._fond && this._cleFond === this._cle(projet) ? this._fond : null;
    this.dessinerSur(toile.getContext('2d'), toile.width, toile.height, projet, fond);
    const manquantes = Medias.manquantes(projet).length;
    const attente = $('#miniature-attente');
    attente.hidden = !!fond && !manquantes;
    ecrireTexte(attente, manquantes
      ? 'Retrouve d\'abord tes vidéos (bouton en haut de l\'écran) pour voir leur image ici.'
      : 'Préparation de l\'image…');
  },

  /* « Enregistrer la miniature » : un JPEG dans « Téléchargements » */
  async enregistrer() {
    const projet = Projets.courant;
    if (!projet || Lecteur.duree() <= 0) return;
    if (Medias.manquantes(projet).length) {
      Message.probleme('Retrouve d\'abord tes vidéos : touche « Retrouver mes vidéos » en haut de l\'écran.');
      return;
    }
    const fond = await this.preparerFond();
    const { largeur, hauteur } = this.taille(projet);
    const toile = nouvelleToile(largeur, hauteur);
    this.dessinerSur(toile.getContext('2d', { alpha: false }), largeur, hauteur, projet, fond);
    const image = await new Promise((reussir) => toile.toBlob(reussir, 'image/jpeg', QUALITE_JPEG_MINIATURE));
    if (!image) { Message.probleme('La miniature n\'a pas pu être fabriquée. Réessaie.'); return; }
    telechargerFichier(image, nomDeFichier(projet.nom) + '-miniature.jpg');
    Message.montrer('Miniature enregistrée dans « Téléchargements » ✓ (' + tailleEnTexte(image.size) + ')');
  },

  /* Le projet est fermé : on oublie l'image */
  oublier() {
    this._fond = null;
    this._cleFond = '';
    this._enCours = null;
  }
};


const Chapitres = {
  initialiser() {
    // Les titres des chapitres changent au fil de la frappe
    $('#liste-chapitres').addEventListener('input', (e) => {
      if (e.target.dataset.chapitre) this.changerTitre(e.target.dataset.chapitre, e.target.value);
    });
  },

  /* « Ajouter un chapitre à la ligne violette » */
  ajouter() {
    const projet = Projets.courant;
    if (!projet) return;
    const total = Lecteur.duree();
    if (total <= 0) { Message.probleme('Ajoute d\'abord des clips dans la chronologie.'); return; }
    if (projet.chapitres.length >= CHAPITRES_MAX) {
      Message.probleme('Il y a déjà ' + CHAPITRES_MAX + ' chapitres : c\'est le maximum.');
      return;
    }
    Lecteur.pause();
    // Le tout premier chapitre commence toujours au début (règle de YouTube)
    const t = projet.chapitres.length === 0 ? 0 : Math.floor(Lecteur.t);
    if (projet.chapitres.some((c) => c.t === t)) {
      Message.probleme('Il y a déjà un chapitre à ' + formaterDuree(t) + '. Déplace la ligne violette un peu plus loin.');
      return;
    }
    Chronologie._memoriser();
    const chapitre = { id: nouvelId(), t, titre: '' };
    projet.chapitres = nettoyerChapitres(projet.chapitres.concat([chapitre]));
    this._apresModification();
    if (t === 0 && Lecteur.t >= 1) {
      Message.montrer('Le premier chapitre commence toujours au début de la vidéo (0:00). Ajoute le suivant à la ligne violette.');
    }
    // On peut tout de suite écrire son titre
    const champ = $('#liste-chapitres [data-chapitre="' + chapitre.id + '"]');
    if (champ) champ.focus();
  },

  changerTitre(id, titre) {
    const projet = Projets.courant;
    const chapitre = projet && projet.chapitres.find((c) => c.id === id);
    if (!chapitre) return;
    chapitre.titre = titre.slice(0, 100);
    Projets.modifie();
    this.majVerification();
    Chronologie.dessiner();
  },

  aller(id) {
    const chapitre = Projets.courant && Projets.courant.chapitres.find((c) => c.id === id);
    if (!chapitre) return;
    Lecteur.pause();
    Lecteur.aller(chapitre.t);
  },

  supprimer(id, bouton) {
    armerBouton(bouton, 'Supprimer ?', () => {
      const projet = Projets.courant;
      if (!projet) return;
      Chronologie._memoriser();
      projet.chapitres = projet.chapitres.filter((c) => c.id !== id);
      this._apresModification();
    });
  },

  _apresModification() {
    Projets.modifie();
    this.afficherListe();
    Chronologie.dessiner();
  },

  /* ---------- La liste (onglet YouTube) ---------- */
  afficherListe() {
    const projet = Projets.courant;
    if (!projet) return;
    const liste = projet.chapitres;
    $('#chapitres-vide').hidden = liste.length > 0;
    $('#chapitres-texte-bloc').hidden = liste.length === 0;
    $('#liste-chapitres').innerHTML = liste.map((c, i) =>
      '<li class="carte-chapitre">' +
        '<button type="button" class="bouton mono" data-action="aller-chapitre" data-id="' + proteger(c.id) + '" ' +
          'aria-label="Aller au chapitre ' + (i + 1) + ', à ' + formaterDuree(c.t) + '">' + formaterDuree(c.t) + '</button>' +
        '<input type="text" maxlength="100" data-chapitre="' + proteger(c.id) + '" value="' + proteger(c.titre) + '" ' +
          'placeholder="Titre du chapitre ' + (i + 1) + '" aria-label="Titre du chapitre ' + (i + 1) + '">' +
        '<button type="button" class="bouton" data-action="supprimer-chapitre" data-id="' + proteger(c.id) + '" aria-label="Supprimer ce chapitre">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-poubelle"/></svg></button>' +
      '</li>').join('');
    this.majVerification();
  },

  /* Le texte pour la description YouTube, une ligne par chapitre */
  texte(projet) {
    // Au-delà d'une heure, YouTube veut le même format partout (0:05:00)
    const long = projet.chapitres.some((c) => c.t >= 3600);
    return projet.chapitres.map((c, i) => {
      const temps = long && c.t < 3600 ? '0:' + deuxChiffres(Math.floor(c.t / 60)) + ':' + deuxChiffres(c.t % 60) : formaterDuree(c.t);
      return temps + ' ' + (c.titre.trim() || 'Chapitre ' + (i + 1));
    }).join('\n');
  },

  /* Les règles de YouTube : sinon, il n'affiche pas les chapitres */
  problemes(projet) {
    const liste = projet.chapitres;
    const total = Lecteur.duree();
    const soucis = [];
    if (!liste.length) return soucis;
    if (liste[0].t !== 0) soucis.push('Le premier chapitre doit commencer à 0:00.');
    if (liste.length < CHAPITRES_MIN) {
      soucis.push('YouTube demande au moins ' + CHAPITRES_MIN + ' chapitres (il y en a ' + liste.length + ').');
    }
    liste.forEach((c, i) => {
      const fin = i + 1 < liste.length ? liste[i + 1].t : total;
      if (fin - c.t < DUREE_CHAPITRE_MIN) {
        soucis.push('Le chapitre ' + (i + 1) + ' (' + formaterDuree(c.t) + ') dure moins de ' + DUREE_CHAPITRE_MIN + ' secondes.');
      }
    });
    if (liste.some((c) => !c.titre.trim())) soucis.push('Un chapitre n\'a pas de titre : « Chapitre N » sera écrit à sa place.');
    return soucis;
  },

  majVerification() {
    const projet = Projets.courant;
    if (!projet) return;
    $('#chapitres-texte').value = this.texte(projet);
    const soucis = this.problemes(projet);
    const zone = $('#chapitres-soucis');
    zone.hidden = soucis.length === 0;
    zone.innerHTML = soucis.map((s) => '<li>' + proteger(s) + '</li>').join('');
  },

  /* « Copier pour YouTube » */
  async copier() {
    const projet = Projets.courant;
    if (!projet || !projet.chapitres.length) return;
    const texte = this.texte(projet);
    try {
      await navigator.clipboard.writeText(texte);
      Message.montrer('Chapitres copiés ✓ Colle-les dans la description de ta vidéo YouTube.');
    } catch (e) {
      // Sans presse-papiers : on sélectionne le texte, il suffit d'appuyer longuement
      const champ = $('#chapitres-texte');
      champ.focus();
      champ.select();
      Message.montrer('Appuie longuement sur le texte sélectionné, puis « Copier ».');
    }
  },

  /* Les repères dans la règle de la chronologie */
  reperes(projet, marge, pps) {
    return projet.chapitres.map((c, i) =>
      '<span class="chrono-chapitre" style="left:' + Math.round(marge + c.t * pps) + 'px">' +
        proteger(c.titre.trim() || 'Chapitre ' + (i + 1)) + '</span>').join('');
  }
};
