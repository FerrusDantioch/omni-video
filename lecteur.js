/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — lecteur.js
   Le lecteur du MONTAGE : il joue les clips de la chronologie les uns
   après les autres, dans le grand cadre d'aperçu.

   Comment il fait, sans copier aucune vidéo :
   - il utilise deux lecteurs vidéo du navigateur (<video>) qui se
     relaient : pendant que l'un joue un clip, l'autre prépare déjà le
     clip suivant (fichier ouvert, bonne position). Au moment de passer
     au clip suivant, on échange les deux : presque aucune coupure.
   - une image de la chronologie est affichée pendant sa durée, mesurée
     avec l'horloge de la tablette.
   - la « position » du montage (this.t, en secondes) vient du lecteur
     vidéo en cours : l'image et le son restent toujours ensemble.

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
  segments: [],         // les clips, avec leur place dans le montage
  elements: [],         // les deux lecteurs vidéo qui se relaient
  actif: 0,             // numéro (0 ou 1) du lecteur visible
  index: -1,            // numéro du segment affiché
  _horloge: null,       // pour les images : { depart, t0 }
  _boucle: 0,           // numéro de l'animation en cours
  _ecouteurs: [],       // fonctions prévenues à chaque changement

  initialiser() {
    this.elements = [$('#montage-video-a'), $('#montage-video-b')];
    this.elements.forEach((el) => {
      // Un clip qui va jusqu'au bout du fichier se termine par « ended »
      el.addEventListener('ended', () => {
        if (this.enLecture && el === this.elements[this.actif]) this.passerAuSuivant();
      });
      el.addEventListener('error', () => {
        if (el !== this.elements[this.actif] || !el.getAttribute('src')) return;
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
    let curseur = 0;
    this.segments = (projet ? projet.clips : []).map((clip) => {
      const media = projet.medias.find((m) => m.id === clip.mediaId);
      const seg = { clip, media, debut: curseur, fin: curseur + (clip.fin - clip.debut) };
      curseur = seg.fin;
      return seg;
    });
    this.t = borner(this.t, 0, this.duree());
    this.index = -1;   // force le prochain affichage à tout remettre en place
  },

  duree() {
    return this.segments.length ? this.segments[this.segments.length - 1].fin : 0;
  },

  /* Le numéro du segment qui contient l'instant t (le dernier si t est
     tout au bout du montage, -1 si le montage est vide). */
  indexA(t) {
    if (!this.segments.length) return -1;
    const i = this.segments.findIndex((s) => t < s.fin - 1e-6);
    return i === -1 ? this.segments.length - 1 : i;
  },

  segmentCourant() {
    const i = this.indexA(this.t);
    return i === -1 ? null : this.segments[i];
  },

  /* Un segment se lit-il avec un lecteur vidéo ? */
  _estVideo(seg) {
    return seg && seg.media.type === 'video' && Medias.disponible(seg.media) && !seg.media.probleme;
  },

  /* ---------- Se déplacer, lire, mettre en pause ---------- */

  aller(t) {
    this.t = borner(t, 0, this.duree());
    const i = this.indexA(this.t);
    if (i === -1) {
      this.afficherVide();
    } else {
      this.afficher(i, this.enLecture);
    }
    this._prevenir();
  },

  lire() {
    if (!this.segments.length || this.enLecture) return;
    // Au bout du montage : on recommence au début
    if (this.t >= this.duree() - MARGE_FIN_CLIP) this.t = 0;
    this.enLecture = true;
    this.afficher(this.indexA(this.t), true);
    this._lancerBoucle();
    this._prevenir();
  },

  pause() {
    if (!this.enLecture) return;
    this.enLecture = false;
    cancelAnimationFrame(this._boucle);
    this.elements.forEach((el) => el.pause());
    this._prevenir();
  },

  /* Applique tout de suite le volume du clip en cours (réglage changé,
     ou « muet » activé / désactivé) */
  appliquerVolume() {
    const seg = this.segments[this.index];
    if (!seg || !this._estVideo(seg)) return;
    const el = this.elements[this.actif];
    el.volume = seg.clip.volume;
    el.muted = this.muet || seg.clip.volume === 0;
  },

  basculer() {
    if (this.enLecture) this.pause();
    else this.lire();
  },

  /* Quand on quitte le projet : on lâche les fichiers (libère la mémoire) */
  vider() {
    this.pause();
    this.segments = [];
    this.t = 0;
    this.index = -1;
    this.elements.forEach((el) => {
      if (el.getAttribute('src')) { el.removeAttribute('src'); el.load(); }
      delete el.dataset.media;
      delete el.dataset.clip;
    });
    $('#montage-image').removeAttribute('src');
    this.afficherVide();
  },

  /* ---------- Afficher le segment numéro i ---------- */
  afficher(i, lancer) {
    const seg = this.segments[i];
    if (!seg) return;
    this.index = i;
    const local = seg.clip.debut + (this.t - seg.debut);   // position dans le fichier d'origine
    const image = $('#montage-image');

    if (this._estVideo(seg)) {
      const el = this._choisirElement(seg);
      if (Math.abs(el.currentTime - local) > 0.04 || el.dataset.clip !== seg.clip.id) el.currentTime = local;
      el.dataset.clip = seg.clip.id;
      el.volume = seg.clip.volume;
      el.muted = this.muet || seg.clip.volume === 0;
      // On montre ce lecteur-là, et seulement lui
      el.classList.add('montre');
      this.elements[1 - this.actif].classList.remove('montre');
      this.elements[1 - this.actif].pause();
      image.hidden = true;
      this.cacherMessage();
      if (lancer) el.play().catch(() => this.pause());
      else el.pause();
    } else {
      // Image, ou vidéo à retrouver : les lecteurs vidéo se taisent
      this.elements.forEach((el) => { el.pause(); el.classList.remove('montre'); });
      if (seg.media.type === 'image' && Medias.disponible(seg.media)) {
        const adresse = Medias.adresse(seg.media);
        if (image.getAttribute('src') !== adresse) image.src = adresse;
        image.hidden = false;
        this.cacherMessage();
      } else {
        image.hidden = true;
        this.message('i-dossier', seg.media.type === 'video'
          ? '« ' + seg.media.nom + ' » est à retrouver : touche « Retrouver mes vidéos » en haut de l\'écran.'
          : '« ' + seg.media.nom + ' » est introuvable.');
      }
      this._horloge = { depart: performance.now(), t0: this.t };
    }
    this._preparerSuivant(i);
  },

  /* Le lecteur à utiliser pour un segment vidéo : de préférence celui qui
     a déjà préparé ce clip, sinon celui qui a déjà ouvert ce fichier. */
  _choisirElement(seg) {
    const [a, b] = [this.elements[this.actif], this.elements[1 - this.actif]];
    let el = a;
    if (b.dataset.clip === seg.clip.id && a.dataset.clip !== seg.clip.id) el = b;
    else if (a.dataset.media !== seg.media.id && b.dataset.media === seg.media.id) el = b;
    if (el === b) {
      a.pause();
      this.actif = 1 - this.actif;
    }
    if (el.dataset.media !== seg.media.id) {
      el.src = Medias.adresse(seg.media);
      el.dataset.media = seg.media.id;
      delete el.dataset.clip;
    }
    return el;
  },

  /* Deux clips qui se suivent dans le même fichier, sans trou (une vidéo
     coupée en deux) : le même lecteur continue simplement de jouer. */
  _continuite(seg, suivant) {
    return suivant && this._estVideo(seg) && this._estVideo(suivant) &&
           seg.media.id === suivant.media.id && Math.abs(suivant.clip.debut - seg.clip.fin) < 0.02;
  },

  /* Pendant qu'un clip joue, l'autre lecteur prépare le clip suivant */
  _preparerSuivant(i) {
    const seg = this.segments[i];
    const suivant = this.segments[i + 1];
    if (!this._estVideo(suivant) || this._continuite(seg, suivant)) return;
    // Si le clip en cours n'est pas une vidéo, le lecteur visible est libre aussi
    const el = this._estVideo(seg) ? this.elements[1 - this.actif] : this.elements[this.actif];
    // Déjà prêt ? On ne refait rien (c'est appelé souvent pendant qu'on fait glisser)
    if (el.dataset.clip === suivant.clip.id && Math.abs(el.currentTime - suivant.clip.debut) < 0.04) return;
    if (el.dataset.media !== suivant.media.id) {
      el.src = Medias.adresse(suivant.media);
      el.dataset.media = suivant.media.id;
    }
    el.dataset.clip = suivant.clip.id;
    el.pause();
    el.currentTime = suivant.clip.debut;
  },

  /* ---------- La boucle de lecture ----------
     Environ 60 fois par seconde : on lit la position, et on passe au clip
     suivant quand celui-ci est terminé. */
  _lancerBoucle() {
    cancelAnimationFrame(this._boucle);
    const tour = () => {
      if (!this.enLecture) return;
      const seg = this.segments[this.index];
      if (!seg) { this.pause(); return; }
      if (this._estVideo(seg)) {
        const el = this.elements[this.actif];
        const local = el.currentTime;
        this.t = borner(seg.debut + (local - seg.clip.debut), seg.debut, seg.fin);
        if (local >= seg.clip.fin - MARGE_FIN_CLIP) this.passerAuSuivant();
      } else {
        this.t = this._horloge.t0 + (performance.now() - this._horloge.depart) / 1000;
        if (this.t >= seg.fin) this.passerAuSuivant();
      }
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
      this._prevenir();
      return;
    }
    const suivant = this.segments[i];
    this.t = suivant.debut;
    if (this._continuite(seg, suivant)) {
      // Même fichier, sans trou : on continue, on change juste le volume
      this.index = i;
      const el = this.elements[this.actif];
      el.dataset.clip = suivant.clip.id;
      el.volume = suivant.clip.volume;
      el.muted = this.muet || suivant.clip.volume === 0;
      this._preparerSuivant(i);
    } else {
      this.afficher(i, true);
    }
  },

  /* ---------- Messages dans le cadre ---------- */

  afficherVide() {
    this.index = -1;
    this.elements.forEach((el) => { el.pause(); el.classList.remove('montre'); });
    $('#montage-image').hidden = true;
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
