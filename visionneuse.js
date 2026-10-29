/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — visionneuse.js
   La fenêtre « Voir un fichier » : elle montre une vidéo, une image ou
   une musique de « Mes fichiers », avec de gros boutons Lecture / Pause,
   ±5 s et une barre de temps, et le bouton « Ajouter à la vidéo ».

   Pour rester léger, elle utilise le lecteur vidéo intégré du
   navigateur (<video>) : il lit le fichier directement sur la tablette,
   morceau par morceau, avec l'aide de la puce vidéo. Rien n'est copié.
   ============================================================ */
'use strict';

const Visionneuse = {
  media: null,       // le média affiché en ce moment
  glisse: false,     // vrai pendant qu'on fait glisser la barre de temps

  /* Branche les événements du lecteur (une seule fois, au démarrage) */
  initialiser() {
    const video = $('#vision-video');
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
    const barre = $('#vision-barre');
    barre.addEventListener('input', () => {
      this.glisse = true;
      if (Number.isFinite(video.duration)) {
        video.currentTime = (barre.value / 1000) * video.duration;
        ecrireTexte($('#vision-temps'), formaterDuree(video.currentTime));
      }
    });
    barre.addEventListener('change', () => { this.glisse = false; });

    // Fenêtre fermée (bouton Fermer, geste retour…) : on lâche le fichier
    $('#fenetre-fichier').addEventListener('close', () => {
      this.arreter();
      this.media = null;
    });
  },

  /* Ouvre la fenêtre sur un média du projet */
  ouvrir(media) {
    // On met le montage en pause : un seul son à la fois
    Lecteur.pause();
    this.arreter();
    this.media = media;
    const video = $('#vision-video');
    const image = $('#vision-image');
    video.hidden = true;
    image.hidden = true;
    ecrireTexte($('#titre-fichier'), media.nom);

    if (media.probleme) {
      this.message('i-info', media.probleme);
    } else if (!Medias.disponible(media)) {
      this.message('i-dossier', media.type === 'video'
        ? 'Cette vidéo est à retrouver : touche « Retrouver mes vidéos » en haut de l\'écran du projet.'
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

    // « Ajouter à la vidéo » : pour les vidéos et images lisibles seulement
    // (la musique de fond arrive à l'étape « Audio »)
    $('#vision-ajouter').hidden = media.type === 'audio' || !!media.probleme || !Medias.disponible(media);
    this.majCommandes();
    $('#fenetre-fichier').showModal();
  },

  fermer() {
    const fenetre = $('#fenetre-fichier');
    if (fenetre.open) fenetre.close();
  },

  /* Arrête la lecture et lâche le fichier (libère la mémoire) */
  arreter() {
    const video = $('#vision-video');
    video.pause();
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    $('#vision-image').removeAttribute('src');
  },

  message(icone, texte) {
    const zone = $('#vision-message');
    $('use', zone).setAttribute('href', '#' + icone);
    ecrireTexte($('#vision-message-texte'), texte);
    zone.hidden = false;
  },

  cacherMessage() {
    $('#vision-message').hidden = true;
  },

  /* ----- Commandes ----- */

  lisible() {
    const video = $('#vision-video');
    return !!(this.media && (this.media.type === 'video' || this.media.type === 'audio') &&
              video.getAttribute('src') && !video.error);
  },

  basculerLecture() {
    const video = $('#vision-video');
    if (!this.lisible()) return;
    if (video.paused || video.ended) {
      video.play().catch(() => Message.probleme('La lecture n\'a pas pu démarrer. Touche à nouveau « Lecture ».'));
    } else {
      video.pause();
    }
  },

  deplacer(secondes) {
    const video = $('#vision-video');
    if (!this.lisible() || !Number.isFinite(video.duration)) return;
    video.currentTime = borner(video.currentTime + secondes, 0, video.duration);
    this.majTemps();
  },

  /* ----- Mise à jour de l'affichage ----- */

  majCommandes() {
    const actif = this.lisible();
    $$('#vision-commandes button, #vision-barre').forEach((el) => { el.disabled = !actif; });
    const video = $('#vision-video');
    const duree = actif && Number.isFinite(video.duration) ? video.duration : (this.media ? this.media.duree : 0);
    ecrireTexte($('#vision-duree'), formaterDuree(duree));
    $('#vision-commandes').hidden = !!(this.media && this.media.type === 'image');
    this.majTemps();
    this.majBoutonLecture();
  },

  majTemps() {
    const video = $('#vision-video');
    const actuel = this.lisible() ? video.currentTime : 0;
    ecrireTexte($('#vision-temps'), formaterDuree(actuel));
    if (!this.glisse) {
      const duree = video.duration;
      $('#vision-barre').value = this.lisible() && Number.isFinite(duree) && duree > 0 ? Math.round((actuel / duree) * 1000) : 0;
    }
  },

  majBoutonLecture() {
    const video = $('#vision-video');
    const enLecture = this.lisible() && !video.paused && !video.ended;
    const bouton = $('#vision-lecture');
    $('use', bouton).setAttribute('href', enLecture ? '#i-pause' : '#i-lecture');
    ecrireTexte($('span', bouton), enLecture ? 'Pause' : 'Lecture');
  }
};
