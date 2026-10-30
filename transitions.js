/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — transitions.js
   Le calcul du montage, sans rien afficher :
   - Montage.segments() : où se place chaque clip dans la vidéo finale,
     en tenant compte des transitions qui font se chevaucher deux clips ;
   - Montage.etat() : à un instant donné, comment montrer un clip
     (transparence, décalage du glissement) et à quel volume.

   ⚠️ Ces calculs servent à l'aperçu ET à l'export : la vidéo finale
   ressemble donc exactement à ce qu'on voit pendant le montage.

   Les transitions possibles (voir stockage.js) :
   - fondu      : la fin du clip s'assombrit jusqu'au noir, puis le clip
                  suivant sort du noir (pas de chevauchement) ;
   - enchaine   : le clip suivant apparaît PAR-DESSUS le précédent,
                  de plus en plus visible (les deux se chevauchent) ;
   - glissement : le clip suivant arrive par la droite et pousse le
                  précédent vers la gauche (les deux se chevauchent).
   Le son suit : il baisse et monte en même temps que l'image.

   Un clip peut être ralenti ou accéléré (clip.vitesse) : sa place dans la
   vidéo finale change, et tempsFichier() / tempsMontage() font le lien
   entre le temps de la vidéo finale et celui du fichier.
   ============================================================ */
'use strict';

const NOMS_TRANSITIONS = {
  aucune: 'Aucune',
  fondu: 'Fondu au noir',
  enchaine: 'Fondu enchaîné',
  glissement: 'Glissement'
};

const Montage = {
  /* La vitesse d'un segment (1 = normale ; une image n'a pas de vitesse) */
  vitesse(seg) {
    return seg.media && seg.media.type === 'video' ? seg.clip.vitesse || 1 : 1;
  },

  /* L'instant t de la vidéo finale → le moment à lire DANS le fichier */
  tempsFichier(seg, t) {
    return seg.clip.debut + (t - seg.debut) * this.vitesse(seg);
  },

  /* L'inverse : un moment du fichier → l'instant de la vidéo finale */
  tempsMontage(seg, local) {
    return seg.debut + (local - seg.clip.debut) / this.vitesse(seg);
  },

  /* La place de chaque clip dans la vidéo finale.
     Une transition ne peut pas durer plus de la moitié de chacun des deux
     clips : ainsi, jamais plus de deux clips ne se chevauchent. */
  segments(projet) {
    const liste = [];
    projet.clips.forEach((clip, i) => {
      const media = projet.medias.find((m) => m.id === clip.mediaId);
      // Un clip ralenti dure plus longtemps dans la vidéo finale, un clip accéléré moins
      const longueur = (clip.fin - clip.debut) / (clip.vitesse || 1);
      let transition = null;
      let chevauchement = 0;
      if (i > 0 && clip.transition && clip.transition.type !== 'aucune') {
        const precedent = liste[i - 1];
        const duree = Math.min(clip.transition.duree, (precedent.fin - precedent.debut) / 2, longueur / 2);
        if (duree >= 0.1) {
          transition = { type: clip.transition.type, duree };
          if (transition.type === 'enchaine' || transition.type === 'glissement') chevauchement = duree;
        }
      }
      const debut = i === 0 ? 0 : liste[i - 1].fin - chevauchement;
      liste.push({ clip, media, debut, fin: debut + longueur, transition });
    });
    return liste;
  },

  /* Comment montrer le segment numéro i à l'instant t :
     { opacite (0 à 1), decalage (en largeurs d'image, pour le glissement),
       son (0 à 1, multiplie le volume du clip), dessus (vrai si ce clip
       doit être dessiné par-dessus l'autre) } */
  etat(projet, segments, i, t) {
    const seg = segments[i];
    let opacite = 1;
    let decalage = 0;
    let son = 1;
    let dessus = false;

    // L'arrivée de ce clip (sa transition d'entrée)
    const entree = seg.transition;
    if (entree) {
      if (entree.type === 'fondu') {
        const demi = entree.duree / 2;
        if (t < seg.debut + demi) {
          const q = borner((t - seg.debut) / demi, 0, 1);
          opacite *= q;
          son *= q;
        }
      } else {
        const p = borner((t - seg.debut) / entree.duree, 0, 1);
        if (p < 1) {
          dessus = true;
          son *= p;
          if (entree.type === 'enchaine') opacite *= p;
          else decalage = 1 - p;        // il arrive de la droite
        }
      }
    }

    // Le départ de ce clip (la transition d'entrée du clip suivant)
    const suivant = segments[i + 1];
    const sortie = suivant && suivant.transition;
    if (sortie) {
      if (sortie.type === 'fondu') {
        const demi = sortie.duree / 2;
        if (t >= suivant.debut - demi) {
          const q = borner((suivant.debut - t) / demi, 0, 1);
          opacite *= q;
          son *= q;
        }
      } else {
        const p = borner((t - suivant.debut) / sortie.duree, 0, 1);
        if (p > 0) {
          son *= 1 - p;
          if (sortie.type === 'glissement') decalage = -p;   // il part vers la gauche
        }
      }
    }

    // Fondu au noir au tout début et à la toute fin de la vidéo
    const total = segments.length ? segments[segments.length - 1].fin : 0;
    if (i === 0 && projet.transitionDebut.type === 'fondu') {
      const q = borner(t / projet.transitionDebut.duree, 0, 1);
      opacite *= q;
      son *= q;
    }
    if (i === segments.length - 1 && projet.transitionFin.type === 'fondu') {
      const q = borner((total - t) / projet.transitionFin.duree, 0, 1);
      opacite *= q;
      son *= q;
    }
    return { opacite, decalage, son, dessus };
  }
};
