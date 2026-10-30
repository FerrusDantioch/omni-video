/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — guide.js
   Le petit guide de la première fois : quelques bulles qui montrent où
   toucher, à la première ouverture d'un projet. On peut le passer, et le
   revoir depuis la page « À propos ».
   ============================================================ */
'use strict';

const CLE_GUIDE = 'omnivideo-guide-vu';   // 'oui' quand le guide a été vu (ou passé)

/* Les étapes : la bulle montre le premier élément VISIBLE de « cibles » */
const ETAPES_GUIDE = [
  {
    cibles: ['.onglet-contenu[data-onglet="fichiers"] [data-action="importer"][data-type="video"]'],
    titre: 'Commence par tes vidéos',
    texte: 'Touche « Ajouter des vidéos » et choisis celles de ta tablette. Elles y restent : rien n\'est envoyé sur Internet.'
  },
  {
    cibles: ['.chronologie'],
    titre: 'Ta vidéo se construit ici',
    texte: 'Fais glisser la bande avec le doigt : la ligne violette montre l\'endroit choisi, et l\'aperçu suit.'
  },
  {
    cibles: ['#outils-clip:not([hidden]) .outils-boutons', '.chronologie'],
    titre: 'Couper, déplacer, ralentir',
    texte: 'Sous la bande, les outils du clip : couper à la ligne violette, enlever un morceau, changer l\'ordre, la vitesse, la lumière… « Annuler » répare toute erreur.'
  },
  {
    cibles: ['.onglets'],
    titre: 'Textes, musique, voix et sous-titres',
    texte: 'Ces onglets ajoutent tout le reste : des textes, des images, une musique de fond, ta voix, des sous-titres, et dans « YouTube », la miniature et les chapitres.'
  },
  {
    cibles: ['#bouton-export'],
    titre: 'Et pour finir',
    texte: 'Quand ta vidéo est prête, touche « Fabriquer la vidéo », puis enregistre-la pour l\'envoyer sur YouTube. Ton projet est enregistré tout seul, à chaque changement.'
  }
];

const Guide = {
  etape: -1,
  _cible: null,

  initialiser() {
    // La bulle suit si l'écran change de taille (tablette tournée)
    window.addEventListener('resize', () => { if (this.etape >= 0) this._placer(); });
  },

  /* À la première ouverture d'un projet */
  peutEtreDemarrer() {
    if (lireReglage(CLE_GUIDE) === 'oui') return;
    setTimeout(() => { if (Projets.courant && this.etape < 0) this.demarrer(); }, 600);
  },

  demarrer() {
    this.etape = 0;
    $('#guide').hidden = false;
    this._afficher();
  },

  suivant() {
    if (this.etape < 0) return;
    if (this.etape >= ETAPES_GUIDE.length - 1) { this.terminer(); return; }
    this.etape++;
    this._afficher();
  },

  terminer() {
    this.etape = -1;
    ecrireReglage(CLE_GUIDE, 'oui');
    this._marquer(null);
    $('#guide').hidden = true;
  },

  /* « Revoir le guide » (page À propos) : il reviendra au prochain projet ouvert */
  revoir() {
    ecrireReglage(CLE_GUIDE, 'non');
    Message.montrer('Le guide s\'affichera à la prochaine ouverture d\'un projet.');
  },

  _afficher() {
    const e = ETAPES_GUIDE[this.etape];
    const cible = e.cibles.map((c) => $(c)).find((el) => el && el.offsetParent !== null) || null;
    this._marquer(cible);
    ecrireTexte($('#guide-compte'), 'Étape ' + (this.etape + 1) + ' sur ' + ETAPES_GUIDE.length);
    ecrireTexte($('#guide-titre'), e.titre);
    ecrireTexte($('#guide-texte'), e.texte);
    const dernier = this.etape === ETAPES_GUIDE.length - 1;
    ecrireTexte($('#guide-suivant span'), dernier ? 'C\'est parti !' : 'Suivant');
    $('#guide-passer').hidden = dernier;
    if (cible) cible.scrollIntoView({ block: 'nearest' });
    this._placer();
    $('#guide-suivant').focus();
  },

  /* L'élément montré est entouré (classe guide-cible) */
  _marquer(cible) {
    if (this._cible) this._cible.classList.remove('guide-cible');
    this._cible = cible;
    if (cible) cible.classList.add('guide-cible');
  },

  /* La bulle se place sous l'élément montré, ou au-dessus s'il n'y a pas
     la place, sans jamais sortir de l'écran */
  _placer() {
    const bulle = $('#guide-bulle');
    const marge = 16;
    const largeur = Math.min(420, window.innerWidth - 2 * marge);
    bulle.style.width = largeur + 'px';
    const h = bulle.offsetHeight;
    let haut = (window.innerHeight - h) / 2;
    let gauche = (window.innerWidth - largeur) / 2;
    if (this._cible) {
      const r = this._cible.getBoundingClientRect();
      if (r.bottom + 12 + h <= window.innerHeight - marge) haut = r.bottom + 12;
      else if (r.top - 12 - h >= marge) haut = r.top - 12 - h;
      else haut = window.innerHeight - h - marge;   // élément très grand : bulle en bas
      gauche = borner(r.left + r.width / 2 - largeur / 2, marge, window.innerWidth - largeur - marge);
    }
    bulle.style.top = Math.round(borner(haut, marge, Math.max(marge, window.innerHeight - h - marge))) + 'px';
    bulle.style.left = Math.round(gauche) + 'px';
  }
};
