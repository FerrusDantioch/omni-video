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

/* Position précise, avec les dixièmes de seconde (pour couper au bon
   endroit) : 83,4 → « 1:23,4 ». En français, on sépare par une virgule. */
function formaterPosition(secondes) {
  const dixiemes = Math.floor(Math.max(0, secondes || 0) * 10 + 1e-6);
  return formaterDuree(Math.floor(dixiemes / 10)) + ',' + (dixiemes % 10);
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


/* Donne un fichier fabriqué par l'application (il arrive dans
   « Téléchargements » sur la tablette). */
function telechargerFichier(blob, nom) {
  const adresse = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  // L'adresse est libérée un peu plus tard, une fois le fichier enregistré
  setTimeout(() => URL.revokeObjectURL(adresse), 60000);
}

/* Un nom de fichier sans caractères interdits ni accents : « Ma vidéo :
   jour 1 » → « Ma video - jour 1 ». Sans accents, car certains navigateurs
   remplacent sinon le nom entier par « download ». */
function nomDeFichier(nom) {
  const propre = String(nom || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é → e, ç → c…
    .replace(/[œŒæÆ]/g, (l) => ({ 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE' })[l])
    .replace(/[^\x20-\x7e]+/g, '')                        // tout autre signe spécial disparaît
    .replace(/[\\/:*?"<>|]+/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return propre || 'Omni-Video';
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


/* ---------- Garder l'écran allumé ----------
   Pendant un enregistrement (et plus tard pendant l'export), l'écran ne
   doit pas s'éteindre tout seul : la tablette arrêterait tout. Si le
   navigateur ne sait pas le faire, on n'insiste pas. */
const Veille = {
  _verrou: null,
  _voulu: false,

  async empecher() {
    this._voulu = true;
    try {
      if ('wakeLock' in navigator && !this._verrou) {
        this._verrou = await navigator.wakeLock.request('screen');
        this._verrou.addEventListener('release', () => { this._verrou = null; });
      }
    } catch (e) { /* pas grave : l'écran suivra le réglage de la tablette */ }
  },

  permettre() {
    this._voulu = false;
    if (this._verrou) this._verrou.release().catch(() => {});
    this._verrou = null;
  }
};
// Quand on revient sur Omni-Vidéo, la tablette a lâché le verrou : on le reprend
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Veille._voulu) Veille.empecher();
});


/* ---------- La batterie ----------
   Chrome dit si la tablette est branchée et combien il reste de batterie.
   Sert à conseiller de brancher la tablette avant une longue fabrication,
   et à la mettre en pause si la batterie devient trop faible. Si le
   navigateur ne le dit pas, on fait comme si la tablette était branchée
   (on ne dérange personne pour rien). */
const SEUIL_BATTERIE_FAIBLE = 0.15;   // 15 %

const Batterie = {
  _gestion: null,
  _quandChange: [],

  async initialiser() {
    if (typeof navigator.getBattery !== 'function') return;
    try {
      this._gestion = await navigator.getBattery();
    } catch (e) {
      return;
    }
    const prevenir = () => this._quandChange.forEach((f) => f());
    this._gestion.addEventListener('chargingchange', prevenir);
    this._gestion.addEventListener('levelchange', prevenir);
  },

  /* { branchee, niveau (0 à 1) }, ou null si on ne sait pas */
  etat() {
    const g = this._gestion;
    if (!g) return null;
    return { branchee: !!g.charging, niveau: Number.isFinite(g.level) ? g.level : 1 };
  },

  faible() {
    const e = this.etat();
    return !!e && !e.branchee && e.niveau <= SEUIL_BATTERIE_FAIBLE;
  },

  /* Appelle « f » à chaque changement (branchée / débranchée, niveau) */
  surveiller(f) {
    this._quandChange.push(f);
  }
};


/* ---------- Le signal de fin ----------
   Une vibration et deux petites notes douces quand la vidéo est prête :
   on peut faire autre chose pendant la fabrication. Le son est fabriqué
   sur place (pas de fichier). Le « lecteur de son » est préparé au moment
   où on touche « Fabriquer » : le navigateur n'autorise un son qu'après un
   geste de la personne. */
const SignalFin = {
  _son: null,

  preparer() {
    const Contexte = window.AudioContext || window.webkitAudioContext;
    if (!Contexte || this._son) return;
    try {
      this._son = new Contexte();
      this._son.suspend().catch(() => {});   // en sommeil jusqu'à la fin
    } catch (e) {
      this._son = null;
    }
  },

  async jouer() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { /* pas de vibreur */ }
    const son = this._son;
    this._son = null;
    if (!son) return;
    try {
      await son.resume();
      const debut = son.currentTime + 0.05;
      // Deux notes qui montent (do puis sol), avec une attaque et une fin douces
      [[523.25, 0], [783.99, 0.22]].forEach(([frequence, decalage]) => {
        const note = son.createOscillator();
        const volume = son.createGain();
        note.type = 'sine';
        note.frequency.value = frequence;
        const t = debut + decalage;
        volume.gain.setValueAtTime(0, t);
        volume.gain.linearRampToValueAtTime(0.25, t + 0.03);
        volume.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        note.connect(volume).connect(son.destination);
        note.start(t);
        note.stop(t + 0.65);
      });
      setTimeout(() => son.close().catch(() => {}), 1500);
    } catch (e) {
      son.close().catch(() => {});
    }
  },

  /* Pas de signal (fabrication arrêtée ou en erreur) : on range le lecteur */
  oublier() {
    if (this._son) this._son.close().catch(() => {});
    this._son = null;
  }
};


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
