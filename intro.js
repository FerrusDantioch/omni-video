/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — intro.js
   L'intro et la fin réutilisables. L'idée : on fabrique son intro (logo,
   titre, petite musique) ou sa fin (« Abonne-toi ! ») comme un petit
   projet à part. Ensuite, dans n'importe quelle vidéo, on l'ajoute d'un
   appui au début ou à la fin.

   Ce qui est recopié : les clips, les textes et images incrustés, les
   musiques et voix, les sous-titres. Les images et les sons sont copiés
   (chaque projet garde les siens) ; les vidéos, elles, ne sont jamais
   copiées (comme partout dans Omni-Vidéo) : si l'intro contient une
   vidéo, il faudra peut-être la « retrouver ».
   ============================================================ */
'use strict';

const IntroFin = {
  initialiser() {
    // La liste se met à jour à chaque ouverture du bloc
    $('#bloc-intro').addEventListener('toggle', () => { if ($('#bloc-intro').open) this.afficher().catch(signalerErreur); });
  },

  /* La liste des autres projets, avec leur durée */
  async afficher() {
    const projet = Projets.courant;
    if (!projet) return;
    let liste = [];
    try { liste = await Base.lireProjets(); } catch (e) { /* liste vide */ }
    const autres = liste
      .filter((p) => p.id !== projet.id)
      .map((p) => ({ p, duree: this._duree(p) }))
      .filter((x) => x.duree > 0)
      .sort((a, b) => b.p.modifie - a.p.modifie);
    $('#intro-vide').hidden = autres.length > 0;
    $('#liste-intro').innerHTML = autres.map(({ p, duree }) =>
      '<li class="carte-intro">' +
        '<p class="media-nom">' + proteger(p.nom) + ' <span class="mono discret">' + formaterDuree(duree) + '</span></p>' +
        '<div class="rangee-2">' +
          '<button type="button" class="bouton" data-action="inserer-projet" data-place="debut" data-id="' + proteger(p.id) + '">' +
            '<svg class="icone" aria-hidden="true"><use href="#i-gauche"/></svg>Au début</button>' +
          '<button type="button" class="bouton" data-action="inserer-projet" data-place="fin" data-id="' + proteger(p.id) + '">' +
            'À la fin<svg class="icone" aria-hidden="true"><use href="#i-droite"/></svg></button>' +
        '</div>' +
      '</li>').join('');
  },

  _duree(projet) {
    const segments = Montage.segments(projet);
    return segments.length ? segments[segments.length - 1].fin : 0;
  },

  /* Ajoute le projet « idSource » au début ou à la fin du projet ouvert */
  async inserer(idSource, place) {
    const projet = Projets.courant;
    if (!projet || idSource === projet.id) return;
    Lecteur.pause();
    let source = null;
    try { source = await Base.lireProjet(idSource); } catch (e) { /* traité juste en dessous */ }
    if (!source || Projets.courant !== projet) {
      if (!source) Message.probleme('Ce projet est introuvable.');
      return;
    }
    const dureeSourceAvant = this._duree(source);

    // 1. Les fichiers de l'intro, rangés dans ce projet-ci
    const utilises = new Set();
    source.clips.forEach((c) => utilises.add(c.mediaId));
    source.calques.forEach((c) => { if (c.mediaId) utilises.add(c.mediaId); });
    source.pistes.forEach((p) => utilises.add(p.mediaId));
    const correspondance = new Map();
    const nouveauxMedias = [];
    let videosARetrouver = 0;
    try {
      for (const m of source.medias) {
        if (!utilises.has(m.id)) continue;
        if (m.type === 'video') {
          // Une vidéo déjà dans ce projet (même nom, même taille) : on la réutilise
          const meme = projet.medias.find((x) => x.type === 'video' && x.nom === m.nom && x.taille === m.taille);
          if (meme) { correspondance.set(m.id, meme.id); continue; }
          const copie = Object.assign({}, m, { id: nouvelId() });
          if (Medias.fichiers.has(m.id)) Medias.fichiers.set(copie.id, Medias.fichiers.get(m.id));
          else if (!m.probleme) videosARetrouver++;
          nouveauxMedias.push(copie);
          correspondance.set(m.id, copie.id);
        } else {
          const contenu = await Base.lireFichier(m.id).catch(() => null);
          if (!contenu) continue;   // fichier perdu : ce qui l'utilise est laissé de côté
          const copie = Object.assign({}, m, { id: nouvelId() });
          await Base.enregistrerFichier(copie.id, contenu);
          Medias.fichiers.set(copie.id, contenu);
          nouveauxMedias.push(copie);
          correspondance.set(m.id, copie.id);
        }
      }
    } catch (e) {
      Message.probleme(messageErreurStockage(e));
      return;
    }
    if (Projets.courant !== projet) return;
    Chronologie._memoriser();
    projet.medias = projet.medias.concat(nouveauxMedias);

    // 2. Les clips de l'intro (sans transition à la jointure)
    const sansTransition = nettoyerTransition(null, TYPES_TRANSITION);
    const clips = source.clips
      .filter((c) => correspondance.has(c.mediaId))
      .map((c, i) => Object.assign({}, c, { id: nouvelId(), mediaId: correspondance.get(c.mediaId) },
        i === 0 ? { transition: sansTransition } : {}))
      .map((c) => nettoyerClip(c, projet.medias)).filter(Boolean);
    const dureeSource = this._duree({ clips, medias: projet.medias });
    const dureeCible = Lecteur.duree();
    // Au début : tout ce qui était là est repoussé de la durée de l'intro
    const debutIntro = place === 'debut' ? 0 : dureeCible;
    const pousser = place === 'debut' ? dureeSource : 0;

    if (place === 'debut') {
      if (projet.clips[0]) projet.clips[0].transition = sansTransition;
      projet.clips = clips.concat(projet.clips);
      projet.calques.forEach((c) => { c.debut += pousser; });
      projet.pistes.forEach((p) => { p.debut += pousser; });
      projet.sousTitres.forEach((s) => { s.debut += pousser; });
      // Un chapitre à 0:00 y reste (l'intro fait partie du premier chapitre)
      projet.chapitres.forEach((c) => { if (c.t > 0) c.t += Math.round(pousser); });
    } else {
      projet.clips = projet.clips.concat(clips);
    }

    // 3. Les textes, images, sons et sous-titres de l'intro, à sa place
    const placer = (x) => Object.assign({}, x, { id: nouvelId(), debut: x.debut + debutIntro },
      x.mediaId ? { mediaId: correspondance.get(x.mediaId) } : {});
    const calques = source.calques
      .filter((c) => !c.mediaId || correspondance.has(c.mediaId))
      .map(placer).map((c) => nettoyerCalque(c, projet.medias)).filter(Boolean);
    const pistes = source.pistes
      .filter((p) => correspondance.has(p.mediaId))
      // « Jusqu'à la fin » de l'intro, pas de toute la vidéo
      .map((p) => Object.assign({}, p, { duree: PistesAudio.duree(p, dureeSourceAvant), jusquALaFin: false }))
      .map(placer).map((p) => nettoyerPiste(p, projet.medias)).filter(Boolean);
    projet.calques = projet.calques.concat(calques);
    projet.pistes = projet.pistes.concat(pistes);
    projet.sousTitres = nettoyerSousTitres(projet.sousTitres.concat(source.sousTitres.map(placer)));
    projet.chapitres = nettoyerChapitres(projet.chapitres);

    Projets.modifie();
    Projets.afficherProjet();
    Chronologie._apresModification(debutIntro);
    PistesAudio.afficherListes();
    PistesAudio.synchroniser();
    Incrustations.redessiner(true);
    Message.montrer('« ' + source.nom + ' » ajouté ' + (place === 'debut' ? 'au début' : 'à la fin') + ' ✓' +
      (videosARetrouver ? ' Retrouve ses vidéos avec le bouton en haut de l\'écran.' : ' « Annuler » le retire.'));
  }
};
