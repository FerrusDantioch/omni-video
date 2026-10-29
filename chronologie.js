/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — chronologie.js
   La chronologie, sous l'aperçu : les clips de la vidéo, posés les uns
   après les autres sur une bande qu'on fait glisser du doigt.

   - La LIGNE VIOLETTE reste au milieu ; c'est la bande qui bouge. La
     position sous la ligne est celle de l'aperçu.
   - Le clip sous la ligne est encadré en violet : c'est lui que
     modifient les outils (couper, enlever avant / après, déplacer,
     supprimer).
   - Chaque modification peut être annulée (« Annuler », « Rétablir »).

   Calcul utile : la bande a une marge vide d'une demi-largeur d'écran au
   début et à la fin. Ainsi, quand on a fait défiler la bande de
   D pixels, la ligne du milieu montre l'instant D ÷ (pixels par seconde).
   ============================================================ */
'use strict';

/* Les niveaux de zoom, en pixels par seconde de vidéo */
const NIVEAUX_ZOOM = [0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240];
const HISTORIQUE_MAX = 60;   // nombre de retours en arrière possibles

const Chronologie = {
  pps: 30,                 // pixels par seconde (le zoom)
  _marge: 0,               // la demi-largeur vide au début et à la fin
  _defilementAttendu: -1,  // position de défilement posée par nous (à ne pas confondre avec le doigt)
  _depuisDefilement: false,
  _demandeDefilement: 0,
  _historique: [],
  _refaire: [],
  _indexAffiche: -2,       // pour ne redessiner les outils que si le clip change

  initialiser() {
    const defilement = $('#chrono-defilement');

    // Le doigt fait glisser la bande : l'aperçu suit
    defilement.addEventListener('scroll', () => this._surDefilement(), { passive: true });
    // Dès qu'on pose le doigt, la lecture s'arrête (on veut choisir un endroit)
    defilement.addEventListener('pointerdown', () => Lecteur.pause());

    // Toucher un clip : la ligne va à cet endroit
    $('#chrono-clips').addEventListener('click', (e) => {
      const piste = $('#chrono-piste').getBoundingClientRect();
      const t = (e.clientX - piste.left - this._marge) / this.pps;
      this.allerA(t);
    });

    // L'écran change de taille (tablette tournée) : on redessine
    new ResizeObserver(() => { if (Projets.courant) this.dessiner(); }).observe(defilement);

    Lecteur.surChangement(() => this.majPosition());
  },

  /* ---------- Ouvrir un projet ---------- */
  ouvrir(projet) {
    this._historique = [];
    this._refaire = [];
    Lecteur.calculer(projet);
    this.pps = this._zoomPourTout(Lecteur.duree());
    this.dessiner();
    Lecteur.aller(0);
    this.majBoutonsHistorique();
  },

  /* Le zoom qui montre toute la vidéo sur à peu près la largeur de l'écran */
  _zoomPourTout(duree) {
    const largeur = $('#chrono-defilement').clientWidth || 800;
    if (duree <= 0) return 30;
    let choix = NIVEAUX_ZOOM[0];
    for (const n of NIVEAUX_ZOOM) if (duree * n <= largeur * 0.9) choix = n;
    return choix;
  },

  zoomer(sens) {
    const i = NIVEAUX_ZOOM.indexOf(this.pps);
    const suivant = NIVEAUX_ZOOM[borner((i === -1 ? 6 : i) + sens, 0, NIVEAUX_ZOOM.length - 1)];
    if (suivant === this.pps) return;
    this.pps = suivant;
    this.dessiner();
  },

  /* ---------- Dessiner la bande ---------- */
  dessiner() {
    const projet = Projets.courant;
    if (!projet) return;
    const defilement = $('#chrono-defilement');
    this._marge = Math.round(defilement.clientWidth / 2);
    const duree = Lecteur.duree();
    const piste = $('#chrono-piste');
    piste.style.width = Math.ceil(duree * this.pps + 2 * this._marge) + 'px';

    // La règle : un repère toutes les N secondes, N choisi pour garder
    // au moins 70 pixels entre deux repères
    const pas = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].find((p) => p * this.pps >= 70) || 1800;
    let regle = '';
    for (let s = 0; s <= duree + 0.001; s += pas) {
      regle += '<span class="chrono-repere" style="left:' + Math.round(this._marge + s * this.pps) + 'px">' + formaterDuree(s) + '</span>';
    }
    $('#chrono-regle').innerHTML = regle;

    // Les clips
    $('#chrono-clips').innerHTML = Lecteur.segments.map((seg, i) => {
      const largeur = Math.max(3, (seg.fin - seg.debut) * this.pps);
      const classes = ['chrono-clip'];
      if (seg.media.type === 'image') classes.push('chrono-image');
      if (!Medias.disponible(seg.media)) classes.push('chrono-manquant');
      const fond = seg.media.miniature ? 'background-image:url(' + seg.media.miniature + ');' : '';
      const duree = largeur > 54 ? '<span class="chrono-clip-duree">' + formaterDuree(seg.fin - seg.debut) + '</span>' : '';
      return '<div class="' + classes.join(' ') + '" data-index="' + i + '" style="left:' +
        (this._marge + seg.debut * this.pps).toFixed(1) + 'px;width:' + largeur.toFixed(1) + 'px;' + fond + '">' +
        duree + '</div>';
    }).join('');

    $('#chronologie-vide').hidden = Lecteur.segments.length > 0;
    this._indexAffiche = -2;
    this._placerBande(Lecteur.t);
    this.majPosition();
  },

  /* ---------- La bande et la ligne ---------- */

  /* Fait défiler la bande pour que la ligne montre l'instant t */
  _placerBande(t) {
    const defilement = $('#chrono-defilement');
    defilement.scrollLeft = Math.round(t * this.pps);
    this._defilementAttendu = defilement.scrollLeft;
  },

  /* Le doigt a fait glisser la bande */
  _surDefilement() {
    const defilement = $('#chrono-defilement');
    if (Math.abs(defilement.scrollLeft - this._defilementAttendu) <= 1) return;   // c'est nous
    // On ne déplace l'aperçu qu'une fois par image affichée (60 fois par seconde au plus)
    if (this._demandeDefilement) return;
    this._demandeDefilement = requestAnimationFrame(() => {
      this._demandeDefilement = 0;
      Lecteur.pause();
      this._depuisDefilement = true;
      Lecteur.aller(defilement.scrollLeft / this.pps);
      this._depuisDefilement = false;
    });
  },

  /* Place la ligne à un instant précis (boutons ±, toucher un clip…) */
  allerA(t) {
    Lecteur.aller(t);
  },

  deplacer(secondes) {
    Lecteur.pause();
    Lecteur.aller(Lecteur.t + secondes);
  },

  /* Appelé par le lecteur à chaque changement de position */
  majPosition() {
    if (!Projets.courant) return;
    if (!this._depuisDefilement) this._placerBande(Lecteur.t);
    ecrireTexte($('#montage-temps'), formaterPosition(Lecteur.t));
    ecrireTexte($('#montage-duree'), formaterDuree(Lecteur.duree()));

    // Bouton Lecture / Pause
    const bouton = $('#montage-lecture');
    $('use', bouton).setAttribute('href', Lecteur.enLecture ? '#i-pause' : '#i-lecture');
    ecrireTexte($('span', bouton), Lecteur.enLecture ? 'Pause' : 'Lecture');
    $$('#commandes-montage button').forEach((b) => { b.disabled = Lecteur.segments.length === 0; });

    // Le clip sous la ligne
    const i = Lecteur.indexA(Lecteur.t);
    if (i !== this._indexAffiche) {
      this._indexAffiche = i;
      $$('#chrono-clips .chrono-clip').forEach((el) => el.classList.toggle('selectionne', Number(el.dataset.index) === i));
    }
    this.majOutils();
  },

  /* Active ou grise chaque outil selon la situation */
  majOutils() {
    const seg = Lecteur.segmentCourant();
    const i = Lecteur.indexA(Lecteur.t);
    const n = Lecteur.segments.length;
    // Pendant la lecture, tous les outils sont grisés : inutile de tout
    // revérifier 60 fois par seconde, seulement quand le clip change.
    const etat = i + '|' + Lecteur.enLecture + '|' + n;
    if (Lecteur.enLecture && etat === this._etatOutils) return;
    this._etatOutils = etat;
    const zone = $('#outils-clip');
    zone.hidden = !seg;
    if (!seg) return;

    const dansLeClip = Lecteur.t - seg.debut >= DUREE_CLIP_MIN && seg.fin - Lecteur.t >= DUREE_CLIP_MIN;
    const actif = (action, oui) => $$('[data-action="' + action + '"]', zone).forEach((b) => { b.disabled = !oui || Lecteur.enLecture; });
    actif('couper', dansLeClip);
    actif('enlever-avant', dansLeClip);
    actif('enlever-apres', dansLeClip);
    $('[data-action="deplacer-clip"][data-sens="-1"]', zone).disabled = i <= 0 || Lecteur.enLecture;
    $('[data-action="deplacer-clip"][data-sens="1"]', zone).disabled = i >= n - 1 || Lecteur.enLecture;
    actif('supprimer-clip', true);
    const image = seg.media.type === 'image';
    $$('.outil-image', zone).forEach((b) => { b.hidden = !image; });
    if (image) $('[data-action="duree-image"][data-secondes="-1"]', zone).disabled = seg.fin - seg.debut <= 1.05 || Lecteur.enLecture;

    ecrireTexte($('#outils-titre'), 'Clip ' + (i + 1) + ' sur ' + n + ' · ' + seg.media.nom + ' · ' +
      dureeEnMots(seg.fin - seg.debut) + (Lecteur.enLecture ? ' — mets en pause pour modifier' : ''));
  },

  majBoutonsHistorique() {
    $('#bouton-annuler').disabled = this._historique.length === 0;
    $('#bouton-retablir').disabled = this._refaire.length === 0;
  },

  /* ---------- Annuler / Rétablir ----------
     Avant chaque modification, on garde une copie de la liste des clips. */

  _memoriser() {
    this._historique.push(this._photo());
    if (this._historique.length > HISTORIQUE_MAX) this._historique.shift();
    this._refaire = [];
  },

  _photo() {
    return JSON.stringify({ clips: Projets.courant.clips, t: Lecteur.t });
  },

  _restaurer(photo) {
    const projet = Projets.courant;
    const donnees = JSON.parse(photo);
    // Un clip dont le fichier a été retiré du projet entre-temps est oublié
    projet.clips = donnees.clips.map((c) => nettoyerClip(c, projet.medias)).filter(Boolean);
    this._apresModification(donnees.t);
  },

  annuler() {
    if (!this._historique.length || !Projets.courant) return;
    Lecteur.pause();
    this._refaire.push(this._photo());
    this._restaurer(this._historique.pop());
    Message.montrer('Modification annulée.');
  },

  retablir() {
    if (!this._refaire.length || !Projets.courant) return;
    Lecteur.pause();
    this._historique.push(this._photo());
    this._restaurer(this._refaire.pop());
    Message.montrer('Modification rétablie.');
  },

  /* Après chaque modification : recalculer, redessiner, enregistrer */
  _apresModification(t) {
    Lecteur.calculer(Projets.courant);
    this.dessiner();
    Lecteur.aller(t);
    this.majBoutonsHistorique();
    Projets.modifie();
    Projets.afficherMedias();   // « utilisé 2 fois dans la vidéo »
  },

  /* ---------- Les outils ---------- */

  /* Le clip sous la ligne, et la position de la ligne DANS son fichier */
  _cible() {
    const seg = Lecteur.segmentCourant();
    if (!seg || Lecteur.enLecture) return null;
    const i = Lecteur.segments.indexOf(seg);
    return { seg, i, local: seg.clip.debut + (Lecteur.t - seg.debut) };
  },

  /* Ajoute un fichier (vidéo entière ou image) à la fin de la vidéo */
  ajouter(media) {
    const projet = Projets.courant;
    if (!projet || media.probleme || media.type === 'audio') return;
    Lecteur.pause();
    this._memoriser();
    const debutNouveau = Lecteur.duree();
    projet.clips.push(nettoyerClip({
      id: nouvelId(),
      mediaId: media.id,
      debut: 0,
      fin: media.type === 'image' ? DUREE_IMAGE_DEFAUT : media.duree
    }, projet.medias));
    this._apresModification(debutNouveau);
  },

  /* Couper en deux à la ligne */
  couper() {
    const c = this._cible();
    if (!c) return;
    this._memoriser();
    const premier = Object.assign({}, c.seg.clip, { fin: c.local });
    const second = Object.assign({}, c.seg.clip, { id: nouvelId(), debut: c.local });
    Projets.courant.clips.splice(c.i, 1, premier, second);
    this._apresModification(Lecteur.t);
    Message.montrer('Clip coupé en deux ✓');
  },

  /* Enlever le morceau du clip qui est avant la ligne */
  enleverAvant() {
    const c = this._cible();
    if (!c) return;
    this._memoriser();
    c.seg.clip.debut = c.local;
    // La ligne se retrouve au début de ce qui reste du clip
    this._apresModification(c.seg.debut);
  },

  /* Enlever le morceau du clip qui est après la ligne */
  enleverApres() {
    const c = this._cible();
    if (!c) return;
    this._memoriser();
    c.seg.clip.fin = c.local;
    // On garde la ligne sur ce clip, juste avant sa nouvelle fin (une image)
    this._apresModification(Math.max(c.seg.debut, Lecteur.t - 1 / 30));
  },

  /* Déplacer le clip d'un cran plus tôt (sens = -1) ou plus tard (+1) */
  deplacerClip(sens) {
    const c = this._cible();
    if (!c) return;
    const j = c.i + sens;
    const clips = Projets.courant.clips;
    if (j < 0 || j >= clips.length) return;
    this._memoriser();
    const decalage = Lecteur.t - c.seg.debut;   // la ligne reste au même endroit du clip
    [clips[c.i], clips[j]] = [clips[j], clips[c.i]];
    Lecteur.calculer(Projets.courant);
    const nouveau = Lecteur.segments[j];
    this._apresModification(nouveau.debut + decalage);
  },

  /* Changer la durée d'affichage d'une image */
  dureeImage(secondes) {
    const c = this._cible();
    if (!c || c.seg.media.type !== 'image') return;
    this._memoriser();
    const clip = c.seg.clip;
    clip.fin = borner(clip.fin + secondes, clip.debut + 1, DUREE_IMAGE_MAX);
    this._apresModification(Math.min(Lecteur.t, c.seg.debut + (clip.fin - clip.debut) - 0.05));
  },

  /* Supprimer le clip (deux appuis ; et « Annuler » le fait revenir) */
  supprimerClip(bouton) {
    armerBouton(bouton, 'Supprimer ce clip ?', () => {
      const c = this._cible();
      if (!c) return;
      this._memoriser();
      Projets.courant.clips.splice(c.i, 1);
      this._apresModification(c.seg.debut);
      Message.montrer('Clip supprimé. « Annuler » le fait revenir.');
    });
  }
};
