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

    // « Son du clip » : un glissement du curseur = une seule étape « Annuler »
    const curseur = $('#volume-clip');
    curseur.addEventListener('input', () => {
      const c = this._cible();
      if (!c) return;
      if (!this._volumeEnCours) { this._memoriser(); this._volumeEnCours = true; }
      c.seg.clip.volume = Number(curseur.value) / 100;
      Lecteur.appliquerVolume();
      this._majVolume(c.seg);
      Projets.modifie();
    });
    curseur.addEventListener('change', () => { this._volumeEnCours = false; });
  },

  /* « Couper le son » du clip, ou le remettre (à 100 %) */
  basculerSonClip() {
    const c = this._cible();
    if (!c || c.seg.media.type !== 'video') return;
    this._memoriser();
    c.seg.clip.volume = c.seg.clip.volume > 0 ? 0 : 1;
    Lecteur.appliquerVolume();
    this._majVolume(c.seg);
    Projets.modifie();
  },

  _majVolume(seg) {
    const volume = Math.round(seg.clip.volume * 100);
    $('#volume-clip').value = volume;
    ecrireTexte($('#volume-clip-valeur'), volume === 0 ? 'coupé' : volume + ' %');
    const bouton = $('#bouton-muet-clip');
    $('use', bouton).setAttribute('href', volume === 0 ? '#i-son' : '#i-muet');
    ecrireTexte($('span', bouton), volume === 0 ? 'Remettre le son' : 'Couper le son');
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

    this.dessinerCalques();
    this.dessinerSousTitres();
    this.dessinerPistes();
    this.dessinerTransitions();
    $('#chronologie-vide').hidden = Lecteur.segments.length > 0;
    this._indexAffiche = -2;
    this._placerBande(Lecteur.t);
    this.majPosition();
  },

  /* Les textes et images incrustées, en petites barres au-dessus des
     clips. Deux rangées : quand deux calques se chevauchent dans le
     temps, le second passe sur la rangée du dessous. */
  dessinerCalques() {
    const projet = Projets.courant;
    if (!projet) return;
    // Pas de calque : la ligne ne prend pas de place ; une seule rangée si
    // aucun calque n'en chevauche un autre
    $('#chrono-piste').style.setProperty('--h-calques', projet.calques.length ? (this._chevauchement(projet.calques) ? '40px' : '21px') : '0px');
    const finRangee = [-Infinity, -Infinity];
    const calques = projet.calques.slice().sort((a, b) => a.debut - b.debut);
    $('#chrono-calques').innerHTML = calques.map((c) => {
      const rangee = c.debut >= finRangee[0] ? 0 : 1;
      finRangee[rangee] = Math.max(finRangee[rangee], c.debut + c.duree);
      const media = c.type === 'image' ? projet.medias.find((m) => m.id === c.mediaId) : null;
      const libelle = c.type === 'texte' ? c.texte.trim().split('\n')[0] || 'Texte' : (media ? media.nom : 'Image');
      return '<button type="button" class="chrono-calque chrono-calque-' + c.type + '" data-action="editer-calque" data-id="' + proteger(c.id) + '" ' +
        'style="left:' + (this._marge + c.debut * this.pps).toFixed(1) + 'px;width:' + Math.max(18, c.duree * this.pps).toFixed(1) + 'px;top:' + (rangee * 19) + 'px" ' +
        'aria-label="Modifier : ' + proteger(libelle) + '">' +
        '<span>' + (c.type === 'texte' ? 'T ' : '▣ ') + proteger(libelle) + '</span></button>';
    }).join('');
  },

  /* Les sous-titres, en petites barres grises juste au-dessus des clips
     (une seule rangée : ils se suivent). Le sous-titre modifié est mis en
     valeur. */
  dessinerSousTitres() {
    const projet = Projets.courant;
    if (!projet) return;
    const liste = projet.sousTitres;
    $('#chrono-piste').style.setProperty('--h-st', liste.length ? '21px' : '0px');
    $('#chrono-sous-titres').innerHTML = liste.map((s) => {
      const largeur = Math.max(6, s.duree * this.pps);
      const libelle = s.texte.trim().replace(/\n/g, ' ') || '…';
      return '<button type="button" class="chrono-sous-titre' + (s.id === SousTitres.edite ? ' selectionne' : '') + '" ' +
        'data-action="editer-sous-titre" data-id="' + proteger(s.id) + '" ' +
        'style="left:' + (this._marge + s.debut * this.pps).toFixed(1) + 'px;width:' + largeur.toFixed(1) + 'px" ' +
        'aria-label="Modifier le sous-titre : ' + proteger(libelle) + '">' +
        (largeur > 30 ? '<span>' + proteger(libelle) + '</span>' : '') + '</button>';
    }).join('');
  },

  /* Les pastilles des transitions : une au tout début, une entre chaque
     paire de clips, une à la toute fin. Violette si une transition est
     posée, discrète sinon. */
  dessinerTransitions() {
    const projet = Projets.courant;
    const segs = Lecteur.segments;
    if (!projet || !segs.length) { $('#chrono-transitions').innerHTML = ''; return; }
    const pastille = (cle, t, transition, libelle) =>
      '<button type="button" class="chrono-transition' + (transition && transition.type !== 'aucune' ? ' active' : '') + '" ' +
      'data-action="choisir-transition" data-cle="' + cle + '" style="left:' + (this._marge + t * this.pps).toFixed(1) + 'px" ' +
      'aria-label="' + libelle + ' : ' + NOMS_TRANSITIONS[transition ? transition.type : 'aucune'] + '">' +
      '<svg class="icone" aria-hidden="true"><use href="#i-transition"/></svg></button>';
    let html = pastille('debut', 0, projet.transitionDebut, 'Début de la vidéo');
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      const chevauche = s.transition && s.transition.type !== 'fondu';
      const centre = s.debut + (chevauche ? s.transition.duree / 2 : 0);
      html += pastille(i, centre, s.transition, 'Transition entre le clip ' + i + ' et le clip ' + (i + 1));
    }
    html += pastille('fin', Lecteur.duree(), projet.transitionFin, 'Fin de la vidéo');
    $('#chrono-transitions').innerHTML = html;
  },

  /* ---------- Choisir une transition ----------
     cle : « debut », « fin », ou le numéro du clip (la transition qui
     mène à ce clip depuis le précédent). */
  ouvrirTransition(cle) {
    const projet = Projets.courant;
    if (!projet) return;
    Lecteur.pause();
    const bord = cle === 'debut' || cle === 'fin';
    const i = Number(cle);
    let actuelle;
    if (cle === 'debut') actuelle = projet.transitionDebut;
    else if (cle === 'fin') actuelle = projet.transitionFin;
    else if (projet.clips[i] && i > 0) actuelle = projet.clips[i].transition;
    else return;

    const fenetre = $('#fenetre-transition');
    const formulaire = $('form', fenetre);
    ecrireTexte($('#titre-transition'), cle === 'debut' ? 'Début de la vidéo' : cle === 'fin' ? 'Fin de la vidéo' : 'Transition');
    ecrireTexte($('#transition-explication'), cle === 'debut'
      ? 'Ta vidéo peut commencer en sortant doucement du noir.'
      : cle === 'fin' ? 'Ta vidéo peut finir en s\'assombrissant doucement jusqu\'au noir.'
      : 'Entre le clip ' + i + ' et le clip ' + (i + 1) + '.');
    $$('.transition-entre-clips', fenetre).forEach((el) => { el.hidden = bord; });
    formulaire.elements.type.value = actuelle.type;
    formulaire.elements.duree.value = String(DUREES_TRANSITION.reduce((a, b) => (Math.abs(b - actuelle.duree) < Math.abs(a - actuelle.duree) ? b : a)));
    formulaire.elements.tous.checked = false;
    fenetre.returnValue = '';
    fenetre.showModal();

    fenetre.onclose = () => {
      if (fenetre.returnValue !== 'ok' || projet !== Projets.courant) return;
      const choix = { type: formulaire.elements.type.value, duree: Number(formulaire.elements.duree.value) };
      this._memoriser();
      if (cle === 'debut') projet.transitionDebut = nettoyerTransition(choix, TYPES_TRANSITION_BORD);
      else if (cle === 'fin') projet.transitionFin = nettoyerTransition(choix, TYPES_TRANSITION_BORD);
      else if (formulaire.elements.tous.checked) projet.clips.forEach((c, j) => { if (j > 0) c.transition = nettoyerTransition(choix, TYPES_TRANSITION); });
      else projet.clips[i].transition = nettoyerTransition(choix, TYPES_TRANSITION);

      // La ligne se place juste avant la transition, pour la regarder tout de suite
      Lecteur.calculer(projet);
      let t = 0;
      if (cle === 'fin') t = Math.max(0, Lecteur.duree() - 3);
      else if (!bord) t = Math.max(0, Lecteur.segments[i].debut - 1.5);
      this._apresModification(t);

      if (choix.type === 'aucune') { Message.montrer('Transition retirée.'); return; }
      // Des clips trop courts raccourcissent la transition : on le dit
      const reelle = bord ? null : Lecteur.segments[i].transition;
      if (reelle && reelle.duree < choix.duree - 0.05) {
        Message.montrer('Transition posée ✓ Les clips sont courts : elle dure ' + String(Math.round(reelle.duree * 10) / 10).replace('.', ',') + ' s. Touche « Lecture » pour la voir.');
      } else {
        Message.montrer('Transition posée ✓ Touche « Lecture » pour la voir.');
      }
    };
  },

  /* Le bouton « Transition avant ce clip » des outils */
  transitionDuClip() {
    const c = this._cible();
    if (!c) return;
    this.ouvrirTransition(c.i === 0 ? 'debut' : c.i);
  },

  /* Deux calques se chevauchent-ils dans le temps ? */
  _chevauchement(calques) {
    const tries = calques.slice().sort((a, b) => a.debut - b.debut);
    let fin = -Infinity;
    for (const c of tries) {
      if (c.debut < fin) return true;
      fin = Math.max(fin, c.debut + c.duree);
    }
    return false;
  },

  /* La musique de fond et les voix off, en barres sous les clips
     (musique sur la première rangée, voix sur la seconde) */
  dessinerPistes() {
    const projet = Projets.courant;
    if (!projet) return;
    const musique = projet.pistes.some((p) => p.type === 'musique');
    const voix = projet.pistes.some((p) => p.type === 'voix');
    $('#chrono-piste').style.setProperty('--h-pistes', musique && voix ? '40px' : (musique || voix ? '21px' : '0px'));
    const rangeeVoix = musique ? 19 : 0;
    $('#chrono-pistes').innerHTML = projet.pistes.map((p) => {
      const media = projet.medias.find((m) => m.id === p.mediaId);
      const nom = media ? media.nom : 'Son';
      const duree = PistesAudio.duree(p);
      return '<button type="button" class="chrono-piste-audio chrono-' + p.type + '" data-action="onglet" data-onglet="son" ' +
        'style="left:' + (this._marge + p.debut * this.pps).toFixed(1) + 'px;width:' + Math.max(18, duree * this.pps).toFixed(1) + 'px;top:' + (p.type === 'voix' ? rangeeVoix : 0) + 'px" ' +
        'aria-label="Régler le son : ' + proteger(nom) + '"><span>' + (p.type === 'musique' ? '♪ ' : '') + proteger(nom) +
        ' · ' + Math.round(p.volume * 100) + ' %</span></button>';
    }).join('');
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
    actif('transition-clip', true);
    const image = seg.media.type === 'image';
    $$('.outil-image', zone).forEach((b) => { b.hidden = !image; });
    // Le son du clip : seulement pour une vidéo qui a du son
    const avecSon = seg.media.type === 'video' && seg.media.aSon;
    $('#outil-volume').hidden = !avecSon;
    if (avecSon) {
      $('#volume-clip').disabled = Lecteur.enLecture;
      $('#bouton-muet-clip').disabled = Lecteur.enLecture;
      if (!this._volumeEnCours) this._majVolume(seg);
    }
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
    this.majBoutonsHistorique();
  },

  _photo() {
    const p = Projets.courant;
    return JSON.stringify({
      clips: p.clips, calques: p.calques, pistes: p.pistes,
      transitionDebut: p.transitionDebut, transitionFin: p.transitionFin,
      sousTitres: p.sousTitres, styleSousTitres: p.styleSousTitres, t: Lecteur.t
    });
  },

  _restaurer(photo) {
    const projet = Projets.courant;
    const donnees = JSON.parse(photo);
    // Un clip ou une image dont le fichier a été retiré du projet entre-temps est oublié
    projet.clips = donnees.clips.map((c) => nettoyerClip(c, projet.medias)).filter(Boolean);
    projet.calques = (donnees.calques || []).map((c) => nettoyerCalque(c, projet.medias)).filter(Boolean);
    projet.pistes = (donnees.pistes || []).map((x) => nettoyerPiste(x, projet.medias)).filter(Boolean);
    projet.transitionDebut = nettoyerTransition(donnees.transitionDebut, TYPES_TRANSITION_BORD);
    projet.transitionFin = nettoyerTransition(donnees.transitionFin, TYPES_TRANSITION_BORD);
    projet.sousTitres = nettoyerSousTitres(donnees.sousTitres);
    projet.styleSousTitres = nettoyerStyleSousTitres(donnees.styleSousTitres);
    this._apresModification(donnees.t);
    PistesAudio.afficherListes();
    PistesAudio.synchroniser();
    // L'éditeur ouvert suit (ou se ferme si son calque n'existe plus)
    if (Incrustations.edite) {
      if (Incrustations.calque(Incrustations.edite)) { Incrustations.majEditeur(); Incrustations._dejaMemorise = false; }
      else Incrustations.fermerEditeur();
    } else {
      Incrustations.afficherListes();
    }
    // Pareil pour l'éditeur d'un sous-titre
    SousTitres._nouveau = null;
    if (SousTitres.edite) {
      if (SousTitres.trouver(SousTitres.edite)) { SousTitres.majEditeur(); SousTitres._dejaMemorise = false; }
      else SousTitres.fermerEditeur();
    }
    SousTitres.afficherListe();
    Incrustations.redessiner(true);
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
    // La seconde moitié suit directement la première : pas de transition entre elles
    const second = Object.assign({}, c.seg.clip, { id: nouvelId(), debut: c.local, transition: nettoyerTransition(null, TYPES_TRANSITION) });
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
