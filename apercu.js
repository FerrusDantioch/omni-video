/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — apercu.js
   Le cadre d'aperçu de l'écran du projet : il montre une vidéo, une
   image ou une musique, avec de gros boutons Lecture / Pause, ±5 s et
   une barre de temps.

   Pour rester léger, l'aperçu utilise le lecteur vidéo intégré du
   navigateur (<video>) : il lit le fichier directement sur la tablette,
   morceau par morceau, avec l'aide de la puce vidéo. Rien n'est copié.
   ============================================================ */
'use strict';

const Apercu = {
  media: null,       // le média affiché en ce moment
  glisse: false,     // vrai pendant qu'on fait glisser la barre de temps

  /* Branche les événements du lecteur (une seule fois, au démarrage) */
  initialiser() {
    const video = $('#apercu-video');
    video.addEventListener('loadedmetadata', () => this.majCommandes());
    video.addEventListener('timeupdate', () => this.majTemps());
    video.addEventListener('play', () => this.majBoutonLecture());
    video.addEventListener('pause', () => this.majBoutonLecture());
    video.addEventListener('ended', () => this.majBoutonLecture());
    video.addEventListener('error', () => {
      if (!this.media || !video.getAttribute('src')) return;
      this.message('i-video', 'La tablette n\'arrive pas à lire ce fichier. Il a peut-être été déplacé ou supprimé de la tablette.');
      this.majCommandes();
    });

    // Barre de temps : on déplace la lecture pendant qu'on fait glisser
    const barre = $('#barre-temps');
    barre.addEventListener('input', () => {
      this.glisse = true;
      if (Number.isFinite(video.duration)) {
        video.currentTime = (barre.value / 1000) * video.duration;
        ecrireTexte($('#temps-actuel'), formaterDuree(video.currentTime));
      }
    });
    barre.addEventListener('change', () => { this.glisse = false; });
  },

  /* Affiche un média du projet dans le cadre */
  montrer(media) {
    this.arreter();
    this.media = media;
    const video = $('#apercu-video');
    const image = $('#apercu-image');
    video.hidden = true;
    image.hidden = true;

    if (media.probleme) {
      this.message('i-info', media.probleme);
    } else if (!Medias.disponible(media)) {
      this.message('i-dossier', media.type === 'video'
        ? 'Cette vidéo est à retrouver : touche « Retrouver mes vidéos » en haut de l\'écran.'
        : 'Ce fichier est introuvable. Retire-le, puis ajoute-le à nouveau.');
    } else if (media.type === 'image') {
      image.src = Medias.adresse(media);
      image.hidden = false;
      this.cacherMessage();
    } else {
      // Vidéo ou musique : le même lecteur sait lire les deux
      video.src = Medias.adresse(media);
      video.hidden = media.type !== 'video';
      if (media.type === 'audio') this.message('i-musique', media.nom);
      else this.cacherMessage();
    }
    this.majCommandes();
  },

  /* Vide le cadre (projet fermé, média retiré…) */
  vider(texte) {
    this.arreter();
    this.media = null;
    $('#apercu-video').hidden = true;
    $('#apercu-image').hidden = true;
    this.message('i-video', texte || 'Ajoute une vidéo, puis touche sa miniature pour la voir ici.');
    this.majCommandes();
  },

  /* Arrête la lecture et lâche le fichier (libère la mémoire) */
  arreter() {
    const video = $('#apercu-video');
    video.pause();
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    $('#apercu-image').removeAttribute('src');
  },

  message(icone, texte) {
    const zone = $('#apercu-message');
    $('use', zone).setAttribute('href', '#' + icone);
    ecrireTexte($('#apercu-message-texte'), texte);
    zone.hidden = false;
  },

  cacherMessage() {
    $('#apercu-message').hidden = true;
  },

  /* ----- Commandes ----- */

  lisible() {
    const video = $('#apercu-video');
    return !!(this.media && (this.media.type === 'video' || this.media.type === 'audio') &&
              video.getAttribute('src') && !video.error);
  },

  basculerLecture() {
    const video = $('#apercu-video');
    if (!this.lisible()) return;
    if (video.paused || video.ended) {
      video.play().catch(() => Message.probleme('La lecture n\'a pas pu démarrer. Touche à nouveau « Lecture ».'));
    } else {
      video.pause();
    }
  },

  deplacer(secondes) {
    const video = $('#apercu-video');
    if (!this.lisible() || !Number.isFinite(video.duration)) return;
    video.currentTime = borner(video.currentTime + secondes, 0, video.duration);
    this.majTemps();
  },

  /* ----- Mise à jour de l'affichage ----- */

  majCommandes() {
    const actif = this.lisible();
    $$('#commandes-lecture button, #barre-temps').forEach((el) => { el.disabled = !actif; });
    const video = $('#apercu-video');
    const duree = actif && Number.isFinite(video.duration) ? video.duration : (this.media ? this.media.duree : 0);
    ecrireTexte($('#temps-total'), formaterDuree(duree));
    this.majTemps();
    this.majBoutonLecture();
  },

  majTemps() {
    const video = $('#apercu-video');
    const actuel = this.lisible() ? video.currentTime : 0;
    ecrireTexte($('#temps-actuel'), formaterDuree(actuel));
    if (!this.glisse) {
      const duree = video.duration;
      $('#barre-temps').value = this.lisible() && Number.isFinite(duree) && duree > 0 ? Math.round((actuel / duree) * 1000) : 0;
    }
  },

  majBoutonLecture() {
    const video = $('#apercu-video');
    const enLecture = this.lisible() && !video.paused && !video.ended;
    const bouton = $('#bouton-lecture');
    $('use', bouton).setAttribute('href', enLecture ? '#i-pause' : '#i-lecture');
    ecrireTexte($('span', bouton), enLecture ? 'Pause' : 'Lecture');
  }
};
