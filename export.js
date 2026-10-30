/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — export.js
   La fenêtre « Fabriquer la vidéo » :
   1. les réglages (forme, qualité) et ce qu'il faut savoir avant
      (taille du fichier, temps estimé, place disponible) ;
   2. la fabrication, avec sa barre de progression et « Arrêter » ;
   3. la vidéo prête : l'enregistrer dans la tablette ou la partager ;
   4. un souci, expliqué simplement.
   La fabrication elle-même est dans fabrication.js.

   Pendant la fabrication : l'écran reste allumé (Veille), la fenêtre ne
   peut pas être fermée par erreur (bouton retour de la tablette), et
   quitter la page demande une confirmation.
   ============================================================ */
'use strict';

const CLE_VITESSE = 'omnivideo-vitesse-';   // + qualité : secondes de fabrication par seconde de vidéo
const CLE_QUALITE = 'omnivideo-qualite';
const CLE_HARMONISER = 'omnivideo-harmoniser';   // 'non' si la case « volume harmonisé » est décochée

/* Petites aides pour se souvenir de réglages (sans jamais planter si le
   navigateur refuse) */
function lireReglage(cle) {
  try { return localStorage.getItem(cle); } catch (e) { return null; }
}
function ecrireReglage(cle, valeur) {
  try { localStorage.setItem(cle, valeur); } catch (e) { /* pas grave */ }
}

/* Un nombre avec des espaces entre les milliers : 12345 → « 12 345 » */
function nombreEnTexte(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* Une durée arrondie pour un temps restant : « environ 12 min » */
function tempsArrondi(secondes) {
  if (secondes < 60) return 'moins d\'une minute';
  if (secondes < 3600) return 'environ ' + Math.round(secondes / 60) + ' min';
  return 'environ ' + dureeEnMots(Math.round(secondes / 300) * 300);
}

const Export = {
  enCours: false,     // une fabrication est en cours (rien ne doit l'interrompre)
  _arret: null,
  _fichier: null,     // la dernière vidéo prête
  _nom: '',
  _quitte: false,

  initialiser() {
    const fenetre = $('#fenetre-export');
    // Le bouton « retour » de la tablette ne ferme pas la fenêtre pendant la fabrication
    fenetre.addEventListener('cancel', (e) => { if (this.enCours) e.preventDefault(); });
    fenetre.addEventListener('close', () => { if (this.enCours) fenetre.showModal(); });
    // Fermer ou recharger la page pendant la fabrication : le navigateur demande confirmation
    window.addEventListener('beforeunload', (e) => {
      if (!this.enCours) return;
      e.preventDefault();
      e.returnValue = '';
    });
    // Omni-Vidéo passe en arrière-plan pendant la fabrication : on le dira au retour
    document.addEventListener('visibilitychange', () => {
      if (!this.enCours) return;
      if (document.visibilityState === 'hidden') this._quitte = true;
      else if (this._quitte) $('#export-quitte').hidden = false;
    });
    // Changer la forme ou la qualité met à jour l'estimation
    $('form', fenetre).addEventListener('change', () => this.majReglages());
  },

  _etape(nom) {
    $$('#fenetre-export .export-etape').forEach((e) => { e.hidden = e.dataset.etape !== nom; });
  },

  _formulaire() {
    return $('#fenetre-export form');
  },

  /* ---------- 1. Les réglages ---------- */

  async ouvrir() {
    const projet = Projets.courant;
    if (!projet) return;
    Lecteur.pause();
    const f = this._formulaire();
    const capacites = Capacites.resultat;
    const avec1080 = !capacites || capacites.export1080;
    f.elements.format.value = projet.format;
    const qualite = lireReglage(CLE_QUALITE) || '1080p';
    f.elements.qualite.value = avec1080 ? qualite : '720p';
    $('#export-harmoniser').checked = lireReglage(CLE_HARMONISER) !== 'non';
    $('#fenetre-export input[value="1080p"]').disabled = !avec1080;
    $('#export-sans-1080').hidden = avec1080;
    $('#export-dernier').hidden = true;
    this._etape('reglages');
    const fenetre = $('#fenetre-export');
    if (!fenetre.open) fenetre.showModal();
    await this.majReglages();

    // Une vidéo fabriquée avant (et peut-être pas encore enregistrée) ?
    const dernier = await DisquePrive.dernierExport();
    if (dernier) {
      ecrireTexte($('#export-dernier-texte'), 'La dernière vidéo fabriquée (' + tailleEnTexte(dernier.size) +
        ') est encore gardée. Elle sera remplacée par la nouvelle.');
      $('#export-dernier').hidden = false;
    }
  },

  _duree() {
    const segments = Montage.segments(Projets.courant);
    return segments.length ? segments[segments.length - 1].fin : 0;
  },

  /* Ce qui empêche de fabriquer la vidéo (ou '' si tout va bien) */
  async _probleme(qualite) {
    const projet = Projets.courant;
    const duree = this._duree();
    if (duree <= 0) return 'Ta vidéo est vide : ajoute d\'abord des clips dans la chronologie.';
    if (Capacites.resultat && !Capacites.resultat.peutExporter) {
      return 'Ta tablette ne sait pas fabriquer de vidéo MP4 (H.264). Mettre Google Chrome à jour peut régler le souci.';
    }
    const manquantes = Medias.manquantes(projet);
    if (manquantes.length) {
      return (manquantes.length > 1 ? manquantes.length + ' vidéos sont à retrouver' : 'Une vidéo est à retrouver') +
        ' : ferme cette fenêtre et touche « Retrouver mes vidéos » en haut de l\'écran.';
    }
    const poids = poidsEstime(duree, qualite);
    const disque = await DisquePrive.peutEcrire();
    if (!disque && poids > TAILLE_MAX_EN_MEMOIRE) {
      return 'Sur cette tablette, Omni-Vidéo ne peut fabriquer que des vidéos courtes (environ ' +
        tailleEnTexte(TAILLE_MAX_EN_MEMOIRE) + '). Essaie la qualité 720p, ou découpe ta vidéo en plusieurs parties.';
    }
    try {
      const estimation = await navigator.storage.estimate();
      const ancien = await DisquePrive.dernierExport();   // il sera effacé avant de commencer
      const libre = estimation.quota - estimation.usage + (ancien ? ancien.size : 0);
      if (Number.isFinite(libre) && libre < poids * 1.1) {
        return 'Il n\'y a pas assez de place sur la tablette : la vidéo pèsera environ ' + tailleEnTexte(poids) +
          ', et il reste environ ' + tailleEnTexte(Math.max(0, libre)) + '. Libère de la place, ou choisis la qualité 720p.';
      }
    } catch (e) { /* on ne sait pas : on essaie quand même */ }
    return '';
  },

  async majReglages() {
    const projet = Projets.courant;
    if (!projet) return;
    const f = this._formulaire();
    const qualite = f.elements.qualite.value || '720p';
    const duree = this._duree();
    const { largeur, hauteur } = tailleExport(f.elements.format.value, qualite);
    ecrireTexte($('#export-resume'), 'Durée : ' + dureeEnMots(duree) + ' · ' + largeur + ' × ' + hauteur + ' · MP4');
    const poids = poidsEstime(duree, qualite);
    let texte = 'Fichier d\'environ ' + tailleEnTexte(poids) + '. ';
    // Une grosse vidéo existe deux fois un moment : dans Omni-Vidéo, puis
    // sa copie dans « Téléchargements » (jusqu'à « Libérer la place »)
    if (poids > 1024 * 1024 * 1024) {
      texte += 'Garde environ ' + tailleEnTexte(poids * 2) + ' de libre : la vidéo est fabriquée, puis copiée dans « Téléchargements ». ';
    }
    const vitesse = Number(lireReglage(CLE_VITESSE + qualite));
    texte += vitesse > 0
      ? 'Temps de fabrication : ' + tempsArrondi(vitesse * duree) + ' (d\'après ta dernière vidéo).'
      : 'Le temps restant s\'affichera pendant la fabrication.';
    ecrireTexte($('#export-estimation'), texte);
    // Une fabrication de cette vidéo interrompue ? (avec CES réglages)
    const reprise = Reprise.pour(projet, { qualite, harmoniser: $('#export-harmoniser').checked });
    const autreReprise = !reprise && Reprise.pour(projet);
    $('#export-reprise').hidden = !reprise && !autreReprise;
    if (reprise) {
      ecrireTexte($('#export-reprise-texte'), 'La fabrication de cette vidéo a été interrompue (' +
        Math.floor(Reprise.avancement(reprise) * 100) + ' % déjà faits). Touche « Fabriquer » : elle reprendra là où elle s\'était arrêtée.');
      ecrireTexte($('#export-lancer span'), 'Reprendre');
    } else {
      if (autreReprise) {
        ecrireTexte($('#export-reprise-texte'), 'Une fabrication interrompue existe, mais le montage ou les réglages ont changé depuis : ' +
          'la vidéo sera fabriquée depuis le début.');
      }
      ecrireTexte($('#export-lancer span'), 'Fabriquer');
    }
    const probleme = await this._probleme(qualite);
    ecrireTexte($('#export-probleme'), probleme);
    $('#export-probleme').hidden = !probleme;
    $('#export-lancer').disabled = !!probleme;
  },

  /* ---------- 2. La fabrication ---------- */

  async lancer() {
    const projet = Projets.courant;
    if (!projet || this.enCours) return;
    // Marqué tout de suite : un double appui ne lance pas deux fabrications
    this.enCours = true;
    const f = this._formulaire();
    const qualite = f.elements.qualite.value;
    const probleme = await this._probleme(qualite);
    if (probleme) { this.enCours = false; this.majReglages(); return; }

    // La forme choisie devient celle du projet (les textes suivent : leurs
    // places sont en fractions de l'image)
    if (f.elements.format.value !== projet.format) {
      projet.format = f.elements.format.value;
      Projets.modifie();
      Projets.afficherProjet();
      Incrustations.redessiner(true);
    }
    ecrireReglage(CLE_QUALITE, qualite);
    const harmoniser = $('#export-harmoniser').checked;
    ecrireReglage(CLE_HARMONISER, harmoniser ? 'oui' : 'non');

    this._arret = { demande: false };
    this._quitte = false;
    this._fichier = null;
    $('#export-quitte').hidden = true;
    this._suivi({ fait: 0, image: 0, images: 0, etape: 'preparation' });
    this._etape('travail');
    Veille.empecher();
    // L'aperçu lâche ses vidéos pendant la fabrication : une tablette ne
    // peut lire que quelques vidéos à la fois, autant les laisser à l'export
    const position = Lecteur.t;
    Lecteur.vider();
    PistesAudio.vider();
    const depart = performance.now();
    const duree = this._duree();
    try {
      const resultat = await fabriquerVideo(projet, { qualite, harmoniser }, (e) => this._suivi(e), this._arret);
      const secondes = (performance.now() - depart) / 1000;
      if (duree >= 20 && !resultat.repris) ecrireReglage(CLE_VITESSE + qualite, String(secondes / duree));
      this._fichier = resultat.fichier;
      this._nom = nomDeFichier(projet.nom) + '.mp4';
      this._montrerTermine(duree, qualite, resultat.avertissements, secondes);
      annoncer('Ta vidéo est prête.');
    } catch (erreur) {
      if (erreur && erreur.name === 'Annulation') {
        this._etape('reglages');
        this.majReglages();
        Message.montrer(Reprise.pour(projet)
          ? 'Fabrication arrêtée. Ce qui est déjà fait est gardé : touche « Reprendre » quand tu veux.'
          : 'Fabrication arrêtée. Rien n\'a été gardé.');
      } else {
        console.error(erreur);
        this._montrerErreur(erreur);
      }
    } finally {
      this.enCours = false;
      Veille.permettre();
      MiseAJour.majBandeau();   // une mise à jour attendait peut-être la fin
      // L'aperçu reprend là où il était
      if (Projets.courant === projet) {
        Lecteur.calculer(projet);
        Chronologie.dessiner();
        Lecteur.aller(position);
      }
    }
  },

  _suivi(e) {
    const pourcent = Math.floor(e.fait * 100);
    ecrireTexte($('#export-pourcent'), pourcent + ' %');
    $('#export-barre-remplie').style.width = (e.fait * 100).toFixed(1) + '%';
    $('#export-barre').setAttribute('aria-valuenow', String(pourcent));
    let detail = 'Préparation…';
    if (e.etape === 'mesure') detail = 'Mesure du volume du son…';
    if (e.etape === 'son') detail = 'Fabrication du son…';
    if (e.etape === 'assemblage') detail = 'Assemblage des morceaux…';
    if (e.etape === 'images') detail = 'Image ' + nombreEnTexte(e.image) + ' sur ' + nombreEnTexte(e.images);
    if (e.etape === 'finition') detail = 'Finition du fichier…';
    if (this._arret && this._arret.demande) detail = 'Arrêt en cours…';
    ecrireTexte($('#export-detail'), detail);
    let temps = '';
    if (e.ecoule) {
      temps = 'Temps écoulé : ' + dureeEnMots(e.ecoule);
      // Le temps restant n'est fiable qu'après quelques secondes
      // (après une reprise, seul ce qui est fait depuis compte pour la vitesse)
      const fait = e.fait - (e.depuis || 0);
      if (fait > 0.01 && e.ecoule > 8) temps += ' · reste ' + tempsArrondi(e.ecoule * (1 - e.fait) / fait);
    }
    ecrireTexte($('#export-temps'), temps);
  },

  arreter(bouton) {
    if (!this.enCours) return;
    armerBouton(bouton, 'Arrêter ? Touche encore', () => {
      this._arret.demande = true;
      ecrireTexte($('#export-detail'), 'Arrêt en cours…');
    });
  },

  /* ---------- 3. La vidéo prête ---------- */

  _montrerTermine(duree, qualite, avertissements, secondes) {
    const fichier = this._fichier;
    const morceaux = [this._nom];
    if (duree) morceaux.push(dureeEnMots(duree));
    if (qualite) morceaux.push(qualite);
    morceaux.push(tailleEnTexte(fichier.size));
    let bilan = morceaux.join(' · ');
    if (secondes) bilan += '\nFabriquée en ' + dureeEnMots(secondes) + '.';
    ecrireTexte($('#export-bilan'), bilan);
    ecrireTexte($('#export-poids'), tailleEnTexte(fichier.size));
    const liste = $('#export-avertissements');
    liste.innerHTML = (avertissements || []).map((a) => '<li>' + proteger(a) + '</li>').join('');
    liste.hidden = !(avertissements && avertissements.length);
    // « Partager » seulement si la tablette sait partager ce fichier
    let partage = false;
    try { partage = !!(navigator.canShare && navigator.canShare({ files: [this._enFichier()] })); } catch (e) { partage = false; }
    $('#export-partager').hidden = !partage;
    this._etape('termine');
  },

  /* Le fichier avec son nom (le partage en a besoin) */
  _enFichier() {
    return new File([this._fichier], this._nom, { type: 'video/mp4' });
  },

  async retrouver() {
    const dernier = await DisquePrive.dernierExport();
    if (!dernier) { $('#export-dernier').hidden = true; return; }
    this._fichier = dernier;
    this._nom = nomDeFichier(Projets.courant ? Projets.courant.nom : 'Omni-Video') + '.mp4';
    this._montrerTermine(0, '', [], 0);
  },

  enregistrer() {
    if (!this._fichier) return;
    telechargerFichier(this._fichier, this._nom);
    Message.montrer('La vidéo s\'enregistre dans « Téléchargements ». Pour une longue vidéo, cela peut prendre une minute.');
  },

  async partager() {
    if (!this._fichier) return;
    try {
      await navigator.share({ files: [this._enFichier()], title: this._nom });
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // la personne a fermé le menu de partage
      Message.probleme('Le partage n\'a pas fonctionné (la vidéo est peut-être trop lourde). Touche plutôt « Enregistrer dans la tablette ».');
    }
  },

  liberer(bouton) {
    armerBouton(bouton, 'Effacer la copie ? Touche encore', async () => {
      await DisquePrive.effacer();
      this._fichier = null;
      $('#fenetre-export').close();
      Message.montrer('Place libérée ✓');
    });
  },

  /* ---------- 4. Un souci ---------- */

  /* « Tout recommencer depuis le début » : les morceaux déjà faits sont effacés */
  recommencer(bouton) {
    armerBouton(bouton, 'Effacer ce qui est fait ?', async () => {
      await Reprise.effacer();
      Message.montrer('C\'est effacé : la prochaine fabrication repartira du début.');
      this.majReglages();
    });
  },

  _montrerErreur(erreur) {
    const nom = erreur && erreur.name;
    let texte;
    if (nom === 'QuotaExceededError') {
      texte = 'La mémoire de la tablette s\'est remplie pendant la fabrication. Libère de la place ' +
        '(anciennes vidéos, applications inutiles), ou choisis la qualité 720p, puis réessaie.';
    } else if (nom === 'EncodageImpossible') {
      texte = 'Ta tablette ne sait pas fabriquer une vidéo MP4 de cette taille. Essaie la qualité 720p.';
    } else if (nom === 'SonImpossible') {
      texte = 'Le son de la vidéo n\'a pas pu être fabriqué. Mets Google Chrome à jour, puis réessaie.';
    } else if (nom === 'TropLongEnMemoire') {
      texte = 'Sur cette tablette, Omni-Vidéo ne peut fabriquer que des vidéos courtes. Essaie la qualité 720p.';
    } else if (nom === 'MorceauxIncompatibles') {
      texte = 'Les morceaux de la vidéo n\'ont pas pu être assemblés sur cette tablette. Touche « Réessayer » : ' +
        'la vidéo sera fabriquée d\'un seul coup cette fois.';
    } else if (nom === 'NotReadableError' || nom === 'NotFoundError') {
      texte = 'Une de tes vidéos n\'a pas pu être relue (elle a peut-être été déplacée ou effacée). ' +
        'Ferme le projet, rouvre-le et retrouve tes vidéos, puis réessaie.';
    } else {
      texte = 'Un souci imprévu est arrivé pendant la fabrication. Réessaie ; si le souci revient, choisis la ' +
        'qualité 720p et ferme les autres applications. (Détail pour un retour : ' +
        String(erreur && erreur.message || erreur).slice(0, 160) + ')';
    }
    ecrireTexte($('#export-erreur-texte'), texte);
    this._etape('erreur');
  }
};
