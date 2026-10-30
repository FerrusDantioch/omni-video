/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — incrustations.js
   Les textes et les images posés par-dessus la vidéo (les « calques »).
   - Les onglets du panneau de droite : Mes fichiers, Textes, Images,
     Son, Sous-titres, YouTube.
   - La liste des textes et des images incrustées.
   - L'éditeur : le texte, la police, la taille, la couleur, le style,
     la place dans l'image et le moment où il apparaît.
   - L'aperçu : les calques sont dessinés sur une toile transparente
     posée sur la vidéo. On peut toucher un texte pour le modifier, et le
     faire glisser du doigt pour le déplacer.
   Le dessin lui-même est dans rendu.js (le même que pour l'export).
   ============================================================ */
'use strict';

const DUREE_TEXTE_DEFAUT = 4;
const DUREE_INCRUSTATION_DEFAUT = 5;
const AIMANT_CENTRE = 0.02;   // près du centre, le calque s'y « colle » (2 %)

/* Les 9 places toutes prêtes (x, y : 0 = bord gauche / haut, 1 = droit / bas) */
const PLACES = [
  { x: 0, y: 0, nom: 'En haut à gauche', fleche: '↖' },
  { x: 0.5, y: 0, nom: 'En haut au centre', fleche: '↑' },
  { x: 1, y: 0, nom: 'En haut à droite', fleche: '↗' },
  { x: 0, y: 0.5, nom: 'Au milieu à gauche', fleche: '←' },
  { x: 0.5, y: 0.5, nom: 'Au centre', fleche: '•' },
  { x: 1, y: 0.5, nom: 'Au milieu à droite', fleche: '→' },
  { x: 0, y: 1, nom: 'En bas à gauche', fleche: '↙' },
  { x: 0.5, y: 1, nom: 'En bas au centre', fleche: '↓' },
  { x: 1, y: 1, nom: 'En bas à droite', fleche: '↘' }
];


/* ---------- Les onglets du panneau de droite ---------- */
const Onglets = {
  actif: 'fichiers',

  ouvrir(nom) {
    Incrustations.fermerEditeur();
    SousTitres.fermerEditeur();
    this.actif = nom;
    $$('.onglet').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === nom)));
    $$('.onglet-contenu').forEach((zone) => { zone.hidden = zone.dataset.onglet !== nom; });
    if (nom === 'textes' || nom === 'images') Incrustations.afficherListes();
    if (nom === 'son') PistesAudio.afficherListes();
    if (nom === 'sous-titres') SousTitres.afficherListe();
    if (nom === 'youtube') { Miniature.afficher(); Chapitres.afficherListe(); }
  }
};


const Incrustations = {
  edite: null,           // numéro du calque qu'on modifie (ou null)
  _places: [],           // place des calques dessinés dans l'aperçu (pour le doigt)
  _cle: '',              // ce qui est dessiné en ce moment (pour ne pas redessiner pour rien)
  _glisse: null,         // déplacement au doigt en cours
  _dejaMemorise: false,  // une seule étape « Annuler » par séance de modification

  initialiser() {
    // Les choix de l'éditeur, fabriqués une fois pour toutes
    $('#ed-polices').innerHTML = Object.entries(POLICES).map(([cle, p]) =>
      '<button type="button" class="bouton choix-police" data-action="calque-police" data-police="' + cle + '" ' +
      'style="font-family:' + p.famille.replace(/"/g, '&quot;') + '">' + p.libelle + '</button>').join('');
    $('#ed-couleurs').innerHTML = COULEURS_TEXTE.map((c) =>
      '<button type="button" class="pastille-couleur" data-action="calque-couleur" data-couleur="' + c.valeur + '" ' +
      'style="--couleur:' + c.valeur + '" aria-label="' + c.nom + '"><span>' + c.nom + '</span></button>').join('');
    $('#ed-styles').innerHTML = Object.entries(NOMS_STYLES).map(([cle, nom]) =>
      '<button type="button" class="bouton" data-action="calque-style" data-style="' + cle + '">' + nom + '</button>').join('');
    $('#ed-places').innerHTML = PLACES.map((p) =>
      '<button type="button" class="bouton" data-action="calque-place" data-x="' + p.x + '" data-y="' + p.y + '" ' +
      'aria-label="' + p.nom + '" title="' + p.nom + '">' + p.fleche + '</button>').join('');

    // Les champs qui changent au fil de la frappe ou du glissement
    $('#ed-texte').addEventListener('input', (e) => this.changer('texte', e.target.value, true));
    $('#ed-taille').addEventListener('input', (e) => this.changer('taille', Number(e.target.value)));
    $('#ed-largeur').addEventListener('input', (e) => this.changer('largeur', Number(e.target.value)));
    $('#ed-gras').addEventListener('change', (e) => this.changer('gras', e.target.checked));
    $('#ed-fondu').addEventListener('change', (e) => this.changer('fondu', e.target.checked));

    // L'aperçu : toucher un calque, le faire glisser
    const toile = $('#montage-calques');
    toile.addEventListener('pointerdown', (e) => this._doigtPose(e));
    toile.addEventListener('pointermove', (e) => this._doigtBouge(e));
    toile.addEventListener('pointerup', (e) => this._doigtLeve(e));
    toile.addEventListener('pointercancel', (e) => this._doigtLeve(e));

    Lecteur.surChangement(() => this.redessiner());
    new ResizeObserver(() => this.redessiner(true)).observe($('#cadre-apercu'));
  },

  calque(id) {
    const projet = Projets.courant;
    return projet ? projet.calques.find((c) => c.id === id) || null : null;
  },

  /* ---------- Dessiner les calques dans l'aperçu ---------- */
  redessiner(force) {
    const projet = Projets.courant;
    const toile = $('#montage-calques');
    const ctx = toile.getContext('2d');
    if (!projet) { ctx.clearRect(0, 0, toile.width, toile.height); return; }

    // La toile a la taille réelle de l'écran (net sur un écran très fin)
    const cadre = $('#cadre-apercu');
    const echelle = Math.min(window.devicePixelRatio || 1, 2);
    const l = Math.round(cadre.clientWidth * echelle);
    const h = Math.round(cadre.clientHeight * echelle);
    if (toile.width !== l || toile.height !== h) { toile.width = l; toile.height = h; force = true; }

    // Rien n'a changé depuis le dernier dessin ? On ne refait rien.
    const t = Lecteur.t;
    const cle = Rendu.actifs(projet, t).map((c) => c.id + ':' + Rendu.opacite(c, t).toFixed(2)).join(',') + '|' +
      Rendu.sousTitresActifs(projet, t).map((s) => s.id).join(',') + '|' + this.edite + '|' + SousTitres.edite;
    if (!force && cle === this._cle) return;
    this._cle = cle;

    ctx.clearRect(0, 0, l, h);
    this._places = Rendu.dessiner(ctx, l, h, projet, t, {
      selection: this.edite || SousTitres.edite,
      quandPret: () => this.redessiner(true)
    });
  },

  /* Le calque sous le doigt (le plus haut si plusieurs se superposent) */
  _sousLeDoigt(e) {
    const toile = $('#montage-calques');
    const r = toile.getBoundingClientRect();
    const x = (e.clientX - r.left) * toile.width / r.width;
    const y = (e.clientY - r.top) * toile.height / r.height;
    for (let i = this._places.length - 1; i >= 0; i--) {
      const p = this._places[i];
      const marge = toile.height * 0.02;   // un peu de marge : plus facile à attraper
      if (x >= p.x - marge && x <= p.x + p.l + marge && y >= p.y - marge && y <= p.y + p.h + marge) return p.id;
    }
    return null;
  },

  _doigtPose(e) {
    if (!Projets.courant) return;
    const touche = this._sousLeDoigt(e);
    // Toucher un sous-titre : on ouvre son éditeur (il ne se déplace pas au
    // doigt : sa place se règle pour tous dans « Apparence »)
    if (touche && SousTitres.trouver(touche)) {
      if (touche !== SousTitres.edite) { Lecteur.pause(); SousTitres.ouvrirEditeur(touche); }
      return;
    }
    // Toucher un autre calque : on passe à celui-là
    if (touche && touche !== this.edite) {
      Lecteur.pause();
      this.ouvrirEditeur(touche);
    }
    const calque = this.calque(this.edite);
    if (!calque || Lecteur.enLecture) return;
    // Le calque modifié n'est pas à l'écran en ce moment : rien à déplacer
    if (!Rendu.actifs(Projets.courant, Lecteur.t).includes(calque)) return;
    const r = $('#montage-calques').getBoundingClientRect();
    this._glisse = {
      id: e.pointerId,
      departX: e.clientX,
      departY: e.clientY,
      bouge: false,
      ecartX: (e.clientX - r.left) / r.width - calque.x,
      ecartY: (e.clientY - r.top) / r.height - calque.y
    };
    e.target.setPointerCapture(e.pointerId);
  },

  _doigtBouge(e) {
    if (!this._glisse || this._glisse.id !== e.pointerId) return;
    const calque = this.calque(this.edite);
    if (!calque) return;
    // Un simple appui (le doigt bouge de moins de 6 pixels) ne déplace rien
    if (!this._glisse.bouge) {
      if (Math.hypot(e.clientX - this._glisse.departX, e.clientY - this._glisse.departY) < 6) return;
      this._glisse.bouge = true;
      this._avantChangement();
    }
    const r = $('#montage-calques').getBoundingClientRect();
    let x = borner((e.clientX - r.left) / r.width - this._glisse.ecartX, 0, 1);
    let y = borner((e.clientY - r.top) / r.height - this._glisse.ecartY, 0, 1);
    if (Math.abs(x - 0.5) < AIMANT_CENTRE) x = 0.5;
    if (Math.abs(y - 0.5) < AIMANT_CENTRE) y = 0.5;
    calque.x = x;
    calque.y = y;
    this.redessiner(true);
  },

  _doigtLeve(e) {
    if (!this._glisse || this._glisse.id !== e.pointerId) return;
    const bouge = this._glisse.bouge;
    this._glisse = null;
    if (bouge) { Projets.modifie(); this.majEditeur(); }
  },

  /* ---------- Ajouter ---------- */

  /* Le moment où commence un nouveau calque : à la ligne violette (un peu
     avant si la ligne est tout au bout de la vidéo) */
  _debutPour(duree) {
    const total = Lecteur.duree();
    return total > 0 && Lecteur.t > total - duree ? Math.max(0, total - duree) : Lecteur.t;
  },

  ajouterTexte() {
    const projet = Projets.courant;
    if (!projet) return;
    Lecteur.pause();
    Chronologie._memoriser();
    const calque = nettoyerCalque({
      id: nouvelId(), type: 'texte', debut: this._debutPour(DUREE_TEXTE_DEFAUT), duree: DUREE_TEXTE_DEFAUT,
      texte: 'Ton texte ici', x: 0.5, y: 0.85
    }, projet.medias);
    projet.calques.push(calque);
    Projets.modifie();
    Chronologie.dessiner();
    this.ouvrirEditeur(calque.id, true);
    // Le texte d'exemple est tout sélectionné : il suffit de taper pour le remplacer
    const champ = $('#ed-texte');
    champ.focus();
    champ.select();
  },

  ajouterImage(mediaId) {
    const projet = Projets.courant;
    if (!projet) return;
    Lecteur.pause();
    Chronologie._memoriser();
    const calque = nettoyerCalque({
      id: nouvelId(), type: 'image', mediaId, debut: this._debutPour(DUREE_INCRUSTATION_DEFAUT),
      duree: DUREE_INCRUSTATION_DEFAUT, largeur: 30, x: 1, y: 0
    }, projet.medias);
    if (!calque) return;
    projet.calques.push(calque);
    Projets.modifie();
    Chronologie.dessiner();
    $('#choix-incrustation').hidden = true;
    Projets.afficherMedias();   // « dans la vidéo »
    this.ouvrirEditeur(calque.id, true);
  },

  /* ---------- L'éditeur ---------- */

  ouvrirEditeur(id, dejaMemorise) {
    const calque = this.calque(id);
    if (!calque) return;
    Lecteur.pause();
    SousTitres.fermerEditeur();
    // L'onglet qui correspond (Textes ou Images) devient l'onglet ouvert
    const onglet = calque.type === 'texte' ? 'textes' : 'images';
    if (Onglets.actif !== onglet) {
      Onglets.actif = onglet;
      $$('.onglet').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === onglet)));
    }
    this.edite = id;
    this._dejaMemorise = !!dejaMemorise;
    $$('.onglet-contenu').forEach((zone) => { zone.hidden = true; });
    $('#editeur-calque').hidden = false;
    $('.panneau').scrollTop = 0;   // l'éditeur s'ouvre en haut, même après une longue liste
    // La ligne violette va sur le calque, pour qu'on le voie dans l'aperçu
    // (pas tout au bord : avec l'apparition en douceur, il y serait invisible)
    const bord = calque.fondu ? Math.min(DUREE_FONDU_CALQUE, calque.duree / 3) : 0;
    if (Lecteur.t < calque.debut + bord || Lecteur.t > calque.debut + calque.duree - bord) {
      Lecteur.aller(calque.debut + Math.min(Math.max(0.5, bord), calque.duree / 2));
    }
    this.majEditeur();
    this.redessiner(true);
  },

  fermerEditeur() {
    if (!this.edite) return;
    this.edite = null;
    this._glisse = null;
    $('#editeur-calque').hidden = true;
    $$('.onglet-contenu').forEach((zone) => { zone.hidden = zone.dataset.onglet !== Onglets.actif; });
    this.afficherListes();
    this.redessiner(true);
  },

  /* Remplit l'éditeur avec les réglages du calque */
  majEditeur() {
    const c = this.calque(this.edite);
    if (!c) { this.fermerEditeur(); return; }
    const texte = c.type === 'texte';
    ecrireTexte($('#editeur-titre'), texte ? 'Modifier le texte' : 'Modifier l\'image incrustée');
    $$('.ed-texte').forEach((el) => { el.hidden = !texte; });
    $$('.ed-image').forEach((el) => { el.hidden = texte; });
    if (texte) {
      if ($('#ed-texte').value !== c.texte) $('#ed-texte').value = c.texte;
      $('#ed-taille').value = c.taille;
      ecrireTexte($('#ed-taille-valeur'), String(c.taille).replace('.', ','));
      $('#ed-gras').checked = c.gras;
      $$('[data-action="calque-police"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.police === c.police)));
      $$('[data-action="calque-couleur"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.couleur === c.couleur)));
      $$('[data-action="calque-style"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === c.style)));
    } else {
      $('#ed-largeur').value = c.largeur;
      ecrireTexte($('#ed-largeur-valeur'), Math.round(c.largeur) + ' %');
    }
    $('#ed-fondu').checked = c.fondu;
    $$('[data-action="calque-place"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.x) === c.x && Number(b.dataset.y) === c.y)));
    ecrireTexte($('#ed-moment'), 'De ' + formaterPosition(c.debut) + ' à ' + formaterPosition(c.debut + c.duree) +
      ' (' + dureeEnMots(c.duree) + ')');
    $('[data-action="calque-duree"][data-secondes="-1"]').disabled = c.duree <= 1.05;
    const total = Lecteur.duree();
    $('#ed-avertissement').hidden = !(total > 0 && c.debut >= total);
    $('[data-action="supprimer-calque"] span').textContent = texte ? 'Supprimer ce texte' : 'Supprimer cette image';
    $('[data-action="dupliquer-calque"] span').textContent = texte ? 'Dupliquer ce texte' : 'Dupliquer cette image';
  },

  /* Avant le premier changement d'une séance de modification, on garde
     une copie pour « Annuler » (une seule étape par séance, même si on
     a fait glisser le réglage de taille cent fois). */
  _avantChangement() {
    if (this._dejaMemorise) return;
    Chronologie._memoriser();
    Chronologie.majBoutonsHistorique();
    this._dejaMemorise = true;
  },

  /* Change un réglage du calque modifié */
  changer(propriete, valeur, depuisLeChamp) {
    const projet = Projets.courant;
    const c = this.calque(this.edite);
    if (!projet || !c) return;
    this._avantChangement();
    c[propriete] = valeur;
    // nettoyerCalque remet chaque valeur dans les limites permises
    Object.assign(c, nettoyerCalque(c, projet.medias));
    Projets.modifie();
    this.redessiner(true);
    if (!depuisLeChamp) this.majEditeur();
    if (propriete === 'texte' || propriete === 'debut' || propriete === 'duree') Chronologie.dessinerCalques();
  },

  /* « Commence à la ligne » : le calque est déplacé (même durée) */
  commencerALaLigne() {
    const c = this.calque(this.edite);
    if (!c) return;
    this.changer('debut', Lecteur.t);
  },

  /* « Finit à la ligne » : la fin est posée sur la ligne */
  finirALaLigne() {
    const c = this.calque(this.edite);
    if (!c) return;
    if (Lecteur.t <= c.debut + DUREE_CALQUE_MIN) {
      Message.probleme('Place d\'abord la ligne violette APRÈS le début du ' + (c.type === 'texte' ? 'texte' : 'l\'image') + ', puis touche à nouveau « Finit à la ligne ».');
      return;
    }
    this.changer('duree', Lecteur.t - c.debut);
    // La ligne revient un peu avant la fin, pour que le calque reste visible
    Lecteur.aller(Math.max(c.debut, c.debut + c.duree - 0.1));
  },

  /* Dupliquer le texte ou l'image : la copie garde tous les réglages. Elle
     se place à la ligne violette si la ligne est ailleurs, sinon juste
     après l'original. */
  dupliquer() {
    const c = this.calque(this.edite);
    if (!c) return;
    const projet = Projets.courant;
    const dedans = Lecteur.t >= c.debut && Lecteur.t < c.debut + c.duree;
    Chronologie._memoriser();
    const copie = nettoyerCalque(Object.assign({}, c, { id: nouvelId(), debut: dedans ? c.debut + c.duree : Lecteur.t }), projet.medias);
    if (!copie) return;
    projet.calques.push(copie);
    Projets.modifie();
    Chronologie.majBoutonsHistorique();
    Chronologie.dessiner();
    Lecteur.aller(copie.debut);
    this.ouvrirEditeur(copie.id, true);
    Message.montrer((c.type === 'texte' ? 'Texte dupliqué' : 'Image dupliquée') + ' ✓ Tu modifies maintenant la copie, à ' +
      formaterPosition(copie.debut) + '.');
  },

  supprimer(bouton) {
    const c = this.calque(this.edite);
    if (!c) return;
    armerBouton(bouton, 'Supprimer ? Touche encore', () => {
      const projet = Projets.courant;
      Chronologie._memoriser();
      projet.calques = projet.calques.filter((x) => x.id !== c.id);
      Projets.modifie();
      Chronologie.majBoutonsHistorique();
      Chronologie.dessiner();
      this.fermerEditeur();
      Message.montrer((c.type === 'texte' ? 'Texte supprimé.' : 'Image supprimée.') + ' « Annuler » le fait revenir.');
    });
  },

  /* ---------- Les listes (onglets Textes et Images) ---------- */
  afficherListes() {
    const projet = Projets.courant;
    if (!projet) return;
    const parDebut = (a, b) => a.debut - b.debut;
    const moment = (c) => 'De ' + formaterDuree(c.debut) + ' à ' + formaterDuree(c.debut + c.duree);

    const textes = projet.calques.filter((c) => c.type === 'texte').sort(parDebut);
    $('#liste-textes').innerHTML = textes.map((c) =>
      '<li class="carte-calque">' +
        '<p class="calque-apercu" style="font-family:' + (POLICES[c.police].famille).replace(/"/g, '&quot;') + '">' + proteger(c.texte.trim() || '(texte vide)') + '</p>' +
        '<p class="aide">' + moment(c) + '</p>' +
        '<button type="button" class="bouton" data-action="editer-calque" data-id="' + proteger(c.id) + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-crayon"/></svg>Modifier</button>' +
      '</li>').join('');
    $('#textes-vide').hidden = textes.length > 0;

    const images = projet.calques.filter((c) => c.type === 'image').sort(parDebut);
    $('#liste-incrustations').innerHTML = images.map((c) => {
      const media = projet.medias.find((m) => m.id === c.mediaId);
      return '<li class="carte-calque carte-calque-image">' +
        (media && media.miniature ? '<img src="' + media.miniature + '" alt="">' : '') +
        '<div><p class="media-nom">' + proteger(media ? media.nom : 'Image') + '</p>' +
        '<p class="aide">' + moment(c) + '</p></div>' +
        '<button type="button" class="bouton" data-action="editer-calque" data-id="' + proteger(c.id) + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-crayon"/></svg>Modifier</button>' +
      '</li>';
    }).join('');
    $('#incrustations-vide').hidden = images.length > 0;
  },

  /* « Ajouter une image » : on choisit parmi les images de « Mes fichiers » */
  montrerChoixImages(garderOuvert) {
    const projet = Projets.courant;
    if (!projet) return;
    const images = projet.medias.filter((m) => m.type === 'image' && !m.probleme && Medias.disponible(m));
    const zone = $('#choix-incrustation');
    zone.hidden = garderOuvert ? false : !zone.hidden;
    if (zone.hidden) return;
    $('#choix-incrustation-liste').innerHTML = images.map((m) =>
      '<button type="button" class="choix-image" data-action="incruster-image" data-id="' + proteger(m.id) + '">' +
        '<img src="' + m.miniature + '" alt=""><span>' + proteger(m.nom) + '</span></button>').join('');
    $('#choix-incrustation-vide').hidden = images.length > 0;
  }
};
