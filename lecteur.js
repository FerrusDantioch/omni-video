/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — lecteur.js
   Le lecteur du MONTAGE : il joue les clips de la chronologie les uns
   après les autres, dans le grand cadre d'aperçu, avec les transitions.

   Comment il fait, sans copier aucune vidéo :
   - il a deux lecteurs vidéo du navigateur (<video>) et deux images
     (<img>), posés les uns sur les autres. À tout moment, il s'occupe
     de DEUX segments au plus : celui en cours, et le suivant.
     · en temps normal, le suivant est déjà préparé (fichier ouvert,
       bonne position) : le passage d'un clip à l'autre est presque
       sans coupure ;
     · pendant un fondu enchaîné ou un glissement, les deux jouent EN
       MÊME TEMPS, l'un par-dessus l'autre.
   - l'apparence de chaque clip (transparence, glissement, volume) est
     calculée par Montage.etat() (transitions.js), le même calcul que
     pour la vidéo finale.
   - la « position » du montage (this.t, en secondes) vient du lecteur
     vidéo du clip en cours : l'image et le son restent ensemble. Pour une
     image, elle vient de l'horloge de la tablette.

   C'est un aperçu léger pour le montage. La vidéo finale, elle, sera
   fabriquée image par image, avec précision, à l'étape « Export ».
   ============================================================ */
'use strict';

/* Marge de sécurité en fin de clip : on passe au suivant un tout petit
   peu avant la fin exacte (le lecteur avance par images de 1/30 s). */
const MARGE_FIN_CLIP = 0.03;

const Lecteur = {
  t: 0,                 // position dans le montage, en secondes
  enLecture: false,
  muet: false,          // vrai pendant l'enregistrement d'une voix off (le micro ne doit pas entendre la vidéo)
  segments: [],         // les clips, avec leur place dans le montage (Montage.segments)
  videos: [],           // les deux lecteurs vidéo
  images: [],           // les deux images
  index: -1,            // numéro du segment en cours
  _projet: null,
  _attribution: new Map(),   // segment → élément (vidéo ou image) qui l'affiche
  _horloge: null,       // { depart, t0 } : pour avancer quand le clip en cours n'est pas une vidéo
  _boucle: 0,           // numéro de l'animation en cours
  _ecouteurs: [],       // fonctions prévenues à chaque changement

  initialiser() {
    this.videos = [$('#montage-video-a'), $('#montage-video-b')];
    this.images = [$('#montage-image-a'), $('#montage-image-b')];
    this.videos.forEach((el) => {
      // Un clip qui va jusqu'au bout du fichier se termine par « ended »
      el.addEventListener('ended', () => {
        if (this.enLecture && el === this.elementPrincipal()) this.passerAuSuivant();
      });
      el.addEventListener('error', () => {
        if (el !== this.elementPrincipal() || !el.getAttribute('src')) return;
        this.message('i-video', 'La tablette n\'arrive pas à lire cette vidéo. Elle a peut-être été déplacée ou supprimée.');
      });
    });
  },

  /* Prévenir une fonction à chaque changement de position ou d'état */
  surChangement(fonction) {
    this._ecouteurs.push(fonction);
  },

  _prevenir() {
    this._ecouteurs.forEach((f) => f(this));
  },

  /* ---------- La liste des segments ----------
     À recalculer après chaque modification de la chronologie. */
  calculer(projet) {
    this._projet = projet || null;
    this.segments = projet ? Montage.segments(projet) : [];
    this._attribution = new Map();
    this.t = borner(this.t, 0, this.duree());
    this.index = -1;   // force le prochain affichage à tout remettre en place
  },

  duree() {
    return this.segments.length ? this.segments[this.segments.length - 1].fin : 0;
  },

  /* Le numéro du segment en cours à l'instant t : le premier qui n'est
     pas fini (pendant une transition qui chevauche, c'est celui qui
     s'en va). Le dernier si t est tout au bout, -1 si le montage est vide. */
  indexA(t) {
    if (!this.segments.length) return -1;
    const i = this.segments.findIndex((s) => t < s.fin - 1e-6);
    return i === -1 ? this.segments.length - 1 : i;
  },

  segmentCourant() {
    const i = this.indexA(this.t);
    return i === -1 ? null : this.segments[i];
  },

  /* Ce qu'il faut pour afficher un segment : 'video', 'image', ou null
     (fichier à retrouver, illisible…) */
  _genre(seg) {
    if (!seg || seg.media.probleme || !Medias.disponible(seg.media)) return null;
    return seg.media.type === 'video' ? 'video' : (seg.media.type === 'image' ? 'image' : null);
  },

  _estVideo(seg) {
    return this._genre(seg) === 'video';
  },

  /* Le lecteur vidéo du clip en cours (ou null si ce n'est pas une vidéo) */
  elementPrincipal() {
    const seg = this.segments[this.index];
    const el = seg && this._attribution.get(seg);
    return el && el.tagName === 'VIDEO' ? el : null;
  },

  /* ---------- Se déplacer, lire, mettre en pause ---------- */

  aller(t) {
    this.t = borner(t, 0, this.duree());
    const i = this.indexA(this.t);
    if (i === -1) this.afficherVide();
    else this._mettreEnPlace(i);
    this._horloge = { depart: performance.now(), t0: this.t };
    this._prevenir();
  },

  lire() {
    if (!this.segments.length || this.enLecture) return;
    // Au bout du montage : on recommence au début
    if (this.t >= this.duree() - MARGE_FIN_CLIP) this.t = 0;
    this.enLecture = true;
    this._horloge = { depart: performance.now(), t0: this.t };
    this._mettreEnPlace(this.indexA(this.t));
    this._lancerBoucle();
    this._prevenir();
  },

  pause() {
    if (!this.enLecture) return;
    this.enLecture = false;
    cancelAnimationFrame(this._boucle);
    this.videos.forEach((el) => el.pause());
    this._prevenir();
  },

  basculer() {
    if (this.enLecture) this.pause();
    else this.lire();
  },

  /* Applique tout de suite le volume (réglage du clip changé, « muet »…) */
  appliquerVolume() {
    this._composer();
  },

  /* Quand on quitte le projet : on lâche les fichiers (libère la mémoire) */
  vider() {
    this.pause();
    this.segments = [];
    this.t = 0;
    this.index = -1;
    this._attribution = new Map();
    this.videos.forEach((el) => {
      if (el.getAttribute('src')) { el.removeAttribute('src'); el.load(); }
      delete el.dataset.media;
      delete el.dataset.clip;
    });
    this.images.forEach((el) => {
      el.removeAttribute('src');
      delete el.dataset.media;
      delete el.dataset.clip;
    });
    this.afficherVide();
  },

  /* ---------- Mettre en place le segment i (et le suivant) ---------- */
  _mettreEnPlace(i) {
    const seg = this.segments[i];
    if (!seg) return;
    this.index = i;
    const suivant = this.segments[i + 1];
    // Un clip qui continue exactement le précédent (vidéo coupée en deux,
    // sans transition) garde le même lecteur : rien à préparer
    const liste = this._continuite(seg, suivant) ? [seg] : [seg, suivant];
    this._attribuer(liste);

    for (const s of liste) {
      if (!s) continue;
      const el = this._attribution.get(s);
      if (!el) continue;
      if (el.tagName === 'VIDEO') {
        const commence = s === seg || this.t >= s.debut;
        const local = commence ? Montage.tempsFichier(s, this.t) : s.clip.debut;
        this._vitesse(el, s);
        // Pendant la lecture, on tolère un petit écart (un recalage ferait un à-coup)
        const tolerance = this.enLecture ? 0.3 : 0.04;
        if (el._neuf || Math.abs(el.currentTime - local) > tolerance) el.currentTime = local;
        el._neuf = false;
        const doitJouer = this.enLecture && commence;
        if (doitJouer && el.paused) el.play().catch(() => this.pause());
        if (!doitJouer && !el.paused) el.pause();
      } else {
        const adresse = Medias.adresse(s.media);
        if (el.getAttribute('src') !== adresse) el.src = adresse;
      }
    }

    // Le clip en cours n'est ni une vidéo ni une image lisible : on le dit
    if (this._genre(seg)) {
      this.cacherMessage();
    } else {
      this.message('i-dossier', seg.media.type === 'video'
        ? '« ' + seg.media.nom + ' » est à retrouver : touche « Retrouver mes vidéos » en haut de l\'écran.'
        : '« ' + seg.media.nom + ' » est introuvable.');
    }
    this._composer();
  },

  /* Donne à chaque segment de la liste un élément pour l'afficher : un
     lecteur vidéo pour une vidéo, une image pour une image. On garde de
     préférence l'élément qui l'affiche déjà, puis celui qui a déjà ouvert
     le même fichier. Les éléments qui ne servent plus se mettent en pause. */
  _attribuer(liste) {
    const ancienne = this._attribution;
    this._attribution = new Map();
    for (const genre of ['video', 'image']) {
      const elements = genre === 'video' ? this.videos : this.images;
      const segs = liste.filter((s) => s && this._genre(s) === genre);
      // D'abord, ceux qui sont déjà prêts pour ce clip
      const pris = new Set();
      for (const s of segs) {
        const el = elements.find((e) => !pris.has(e) && (ancienne.get(s) === e || e.dataset.clip === s.clip.id));
        if (el) { this._attribution.set(s, el); pris.add(el); }
      }
      // Ensuite, les autres reçoivent un élément libre
      for (const s of segs) {
        if (this._attribution.has(s)) continue;
        const libres = elements.filter((e) => !pris.has(e));
        const el = libres.find((e) => e.dataset.media === s.media.id) || libres[0];
        if (!el) continue;
        if (el.dataset.media !== s.media.id) {
          el.src = Medias.adresse(s.media);
          el.dataset.media = s.media.id;
        }
        el.dataset.clip = s.clip.id;
        el._neuf = true;
        this._attribution.set(s, el);
        pris.add(el);
      }
      // Ceux qui ne servent pas se taisent
      elements.forEach((e) => { if (!pris.has(e) && e.tagName === 'VIDEO' && !e.paused) e.pause(); });
    }
  },

  /* Deux clips qui se suivent dans le même fichier, sans trou et sans
     transition (une vidéo coupée en deux) : le même lecteur continue. */
  _continuite(seg, suivant) {
    return !!suivant && !suivant.transition && this._estVideo(seg) && this._estVideo(suivant) &&
           seg.media.id === suivant.media.id && Math.abs(suivant.clip.debut - seg.clip.fin) < 0.02 &&
           Montage.vitesse(seg) === Montage.vitesse(suivant);
  },

  /* Ralenti / accéléré : le lecteur joue à la vitesse du clip. Le son
     suit la vitesse (plus grave au ralenti, plus aigu en accéléré),
     exactement comme dans la vidéo finale. */
  _vitesse(el, seg) {
    const v = Montage.vitesse(seg);
    if (el.playbackRate !== v) el.playbackRate = v;
    if ('preservesPitch' in el && el.preservesPitch) el.preservesPitch = false;
  },

  /* ---------- L'apparence de chaque élément à l'instant t ----------
     Transparence et glissement (transitions), volume (clip, transitions,
     « muet »). Appelé à chaque image pendant la lecture. */
  _composer() {
    const projet = this._projet;
    const visibles = new Map();
    if (projet) {
      for (const [seg, el] of this._attribution) {
        const i = this.segments.indexOf(seg);
        // Visible s'il est commencé et pas fini (le clip en cours l'est toujours)
        if (i === this.index || (this.t >= seg.debut && this.t < seg.fin)) {
          visibles.set(el, { seg, etat: Montage.etat(projet, this.segments, i, this.t) });
        }
      }
    }
    for (const el of this.videos.concat(this.images)) {
      const v = visibles.get(el);
      if (!v) {
        el.style.opacity = '0';
        el.style.transform = '';
        if (el.tagName === 'VIDEO') el.muted = true;
        continue;
      }
      el.style.opacity = String(v.etat.opacite);
      // Glissement (transition), zoom lent d'une photo, lumière et couleurs
      const mvt = Montage.mouvement(v.seg, this.t);
      const dx = v.etat.decalage + mvt.dx;
      el.style.transform = (dx ? 'translateX(' + (dx * 100).toFixed(2) + '%) ' : '') +
        (mvt.echelle !== 1 ? 'scale(' + mvt.echelle.toFixed(4) + ')' : '');
      const filtre = Montage.filtre(v.seg.clip);
      if (el.style.filter !== filtre) el.style.filter = filtre;
      el.style.zIndex = v.etat.dessus ? '2' : '1';
      if (el.tagName === 'VIDEO') {
        el.volume = borner(v.seg.clip.volume * v.etat.son, 0, 1);
        el.muted = this.muet || v.seg.clip.volume === 0;
      }
    }
  },

  /* ---------- La boucle de lecture ----------
     Environ 60 fois par seconde : on lit la position, on démarre le clip
     suivant quand une transition commence, et on passe au suivant quand
     le clip en cours est terminé. */
  _lancerBoucle() {
    cancelAnimationFrame(this._boucle);
    const tour = () => {
      if (!this.enLecture) return;
      const seg = this.segments[this.index];
      if (!seg) { this.pause(); return; }
      const el = this.elementPrincipal();
      let fini = false;
      if (el) {
        const local = el.currentTime;
        this.t = borner(Montage.tempsMontage(seg, local), seg.debut, seg.fin);
        fini = local >= seg.clip.fin - MARGE_FIN_CLIP;
      } else {
        this.t = this._horloge.t0 + (performance.now() - this._horloge.depart) / 1000;
        fini = this.t >= seg.fin;
      }
      // Une transition qui chevauche commence : le clip suivant démarre aussi
      const suivant = this.segments[this.index + 1];
      if (suivant && this.t >= suivant.debut) {
        const el2 = this._attribution.get(suivant);
        if (el2 && el2.tagName === 'VIDEO' && el2.paused) {
          el2.currentTime = Montage.tempsFichier(suivant, this.t);
          this._vitesse(el2, suivant);
          el2.play().catch(() => {});
        }
      }
      if (fini) this.passerAuSuivant();
      else this._composer();
      this._prevenir();
      if (this.enLecture) this._boucle = requestAnimationFrame(tour);
    };
    this._boucle = requestAnimationFrame(tour);
  },

  passerAuSuivant() {
    const seg = this.segments[this.index];
    const i = this.index + 1;
    if (i >= this.segments.length) {
      // Fin du montage
      this.t = this.duree();
      this.pause();
      this._composer();
      this._prevenir();
      return;
    }
    const suivant = this.segments[i];
    if (this._continuite(seg, suivant)) {
      // Même fichier, sans trou : le même lecteur continue, il change juste de clip
      const el = this._attribution.get(seg);
      if (el) { el.dataset.clip = suivant.clip.id; this._attribution.set(suivant, el); }
    }
    // Sans chevauchement, le clip suivant commence exactement maintenant
    this.t = Math.max(this.t, suivant.debut);
    this._horloge = { depart: performance.now(), t0: this.t };
    this._mettreEnPlace(i);
  },

  /* ---------- Messages dans le cadre ---------- */

  afficherVide() {
    this.index = -1;
    this.videos.forEach((el) => { el.pause(); el.style.opacity = '0'; });
    this.images.forEach((el) => { el.style.opacity = '0'; });
    this.message('i-video', 'Ta vidéo est vide pour l\'instant. Ajoute une vidéo avec « Ajouter des vidéos », ' +
      'ou touche « Ajouter à la vidéo » sur un de tes fichiers.');
  },

  message(icone, texte) {
    const zone = $('#montage-message');
    $('use', zone).setAttribute('href', '#' + icone);
    ecrireTexte($('#montage-message-texte'), texte);
    zone.hidden = false;
  },

  cacherMessage() {
    $('#montage-message').hidden = true;
  }
};
