/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — outils.js
   Petites fonctions utiles partout dans l'application :
   trouver des éléments de la page, mettre les durées et les tailles
   en forme, parler aux lecteurs d'écran, boutons « deux appuis »,
   petit message en bas de l'écran.
   ============================================================ */
'use strict';

/* Trouve UN élément de la page (le premier qui correspond). */
function $(selecteur, racine) {
  return (racine || document).querySelector(selecteur);
}

/* Trouve TOUS les éléments qui correspondent, sous forme de liste. */
function $$(selecteur, racine) {
  return Array.from((racine || document).querySelectorAll(selecteur));
}

/* Garde un nombre entre un minimum et un maximum. */
function borner(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/* Écrit un nombre sur deux chiffres : 7 → « 07 ». */
function deuxChiffres(n) {
  return String(n).padStart(2, '0');
}

/* Change le texte d'un élément seulement s'il a changé (évite de
   redessiner la page pour rien). */
function ecrireTexte(element, texte) {
  if (element && element.textContent !== texte) element.textContent = texte;
}

/* Met une durée (en secondes) en forme :
   - 65   → « 1:05 »
   - 3725 → « 1:02:05 » (au-delà d'une heure) */
function formaterDuree(totalSecondes) {
  const s = Math.max(0, Math.floor(totalSecondes || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + deuxChiffres(m) + ':' + deuxChiffres(sec);
  return m + ':' + deuxChiffres(sec);
}

/* Durée en toutes lettres, pour les lecteurs d'écran et les résumés :
   90 → « 1 min 30 s ». */
function dureeEnMots(totalSecondes) {
  const s = Math.max(0, Math.round(totalSecondes || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const morceaux = [];
  if (h) morceaux.push(h + ' h');
  if (m) morceaux.push(m + ' min');
  if (sec || morceaux.length === 0) morceaux.push(sec + ' s');
  return morceaux.join(' ');
}

/* Taille d'un fichier en mots simples : 1 536 000 000 → « 1,4 Go ». */
function tailleEnTexte(octets) {
  const n = Number(octets) || 0;
  const unites = ['octets', 'Ko', 'Mo', 'Go', 'To'];
  let valeur = n;
  let i = 0;
  while (valeur >= 1024 && i < unites.length - 1) { valeur /= 1024; i++; }
  const arrondi = i === 0 ? String(Math.round(valeur)) : valeur.toFixed(valeur < 10 ? 1 : 0);
  return arrondi.replace('.', ',') + ' ' + unites[i];
}

/* Fait lire un message par le lecteur d'écran (zone invisible « annonce »). */
function annoncer(texte) {
  const zone = document.getElementById('annonce');
  if (!zone) return;
  zone.textContent = '';
  setTimeout(() => { zone.textContent = texte; }, 60);
}

/* Fabrique un identifiant unique (pour reconnaître chaque projet, chaque fichier…). */
function nouvelId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Attend un petit moment (en millisecondes). */
function attendre(ms) {
  return new Promise((fin) => setTimeout(fin, ms));
}

/* Protège un texte avant de l'écrire dans la page en HTML : un nom de
   fichier comme « <vacances>.mp4 » doit s'afficher tel quel, et jamais
   être compris comme du code. */
function proteger(texte) {
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ---------- Boutons « deux appuis » ----------
   Pour les actions qui font perdre quelque chose (supprimer, retirer) :
   le premier appui « arme » le bouton (il change de texte et de couleur),
   le second confirme. Sans second appui, il se désarme seul après 4 s.
   Même fonctionnement que dans Cap et Omni-Time. */
function armerBouton(bouton, texteArme, action) {
  if (!bouton.classList.contains('arme')) {
    bouton.classList.add('arme');
    bouton.dataset.texteOriginal = bouton.innerHTML;
    bouton.textContent = texteArme;
    // Le nom lu par les lecteurs d'écran change aussi (« Confirmer ? »)
    if (bouton.hasAttribute('aria-label')) {
      bouton.dataset.ariaOriginal = bouton.getAttribute('aria-label');
      bouton.setAttribute('aria-label', texteArme);
    }
    clearTimeout(bouton._minuteurArme);
    bouton._minuteurArme = setTimeout(() => desarmerBouton(bouton), 4000);
    return;
  }
  // On remet le bouton dans son état normal AVANT l'action : un bouton qui
  // reste affiché ne doit pas rester armé pour la fois suivante.
  desarmerBouton(bouton);
  action();
}

function desarmerBouton(bouton) {
  clearTimeout(bouton._minuteurArme);
  bouton.classList.remove('arme');
  if (bouton.dataset.texteOriginal) {
    // On remet exactement ce qu'il y avait (icône comprise)
    bouton.innerHTML = bouton.dataset.texteOriginal;
    delete bouton.dataset.texteOriginal;
  }
  if (bouton.dataset.ariaOriginal) {
    bouton.setAttribute('aria-label', bouton.dataset.ariaOriginal);
    delete bouton.dataset.ariaOriginal;
  }
}


/* ---------- Petit message en bas de l'écran ----------
   Pour dire « C'est fait » ou expliquer un souci, sans fenêtre à fermer.
   Il disparaît tout seul (plus lentement si c'est un problème, pour
   laisser le temps de lire). */
const Message = {
  minuteur: null,

  montrer(texte, probleme) {
    const zone = document.getElementById('message-flottant');
    if (!zone) return;
    zone.textContent = texte;
    zone.classList.toggle('probleme', !!probleme);
    zone.classList.remove('cache');
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => zone.classList.add('cache'), probleme ? 9000 : 4000);
  },

  probleme(texte) { this.montrer(texte, true); }
};
