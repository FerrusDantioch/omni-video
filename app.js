/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — app.js
   Le chef d'orchestre : passage d'un écran à l'autre, réponse aux
   boutons, filet de sécurité contre les erreurs, et démarrage de
   l'application. Chargé en dernier.
   ============================================================ */
'use strict';

/* Numéro de version affiché dans « À propos ». À changer à chaque
   nouvelle version publiée. */
const VERSION = '0.6.0';

/* ---------- 1. Navigation entre les écrans ----------
   Chaque écran est une <section class="vue" data-vue="…">.
   Un seul est visible à la fois. On garde une trace dans l'historique
   du navigateur : le bouton « retour » d'Android ramène donc à l'écran
   précédent, au lieu de fermer l'application. */

const VUES = ['accueil', 'projet', 'tablette', 'apropos'];
let vueActive = 'accueil';

/* Quel écran l'adresse demande-t-elle ? (« …/index.html#apropos » → apropos) */
function vueDepuisAdresse() {
  const nom = location.hash.replace('#', '');
  return VUES.includes(nom) ? nom : 'accueil';
}

function afficherVue(nom) {
  // L'écran du projet n'a de sens que si un projet est ouvert
  if (nom === 'projet' && !Projets.courant) nom = 'accueil';
  if (vueActive === 'projet' && nom !== 'projet') Projets.fermer();

  vueActive = nom;
  document.body.dataset.vue = nom;
  $$('.vue').forEach((section) => { section.hidden = section.dataset.vue !== nom; });

  // Remet chaque écran à jour au moment où on l'ouvre
  switch (nom) {
    case 'accueil':  Projets.afficherListe(); Capacites.afficherBandeau(); break;
    case 'projet':   Projets.afficherProjet(); break;
    case 'tablette': Capacites.afficher(); break;
  }

  window.scrollTo(0, 0);
  // Le titre de l'écran reçoit le focus : un lecteur d'écran l'annonce
  const titre = $('.vue[data-vue="' + nom + '"] h1');
  if (titre) titre.focus({ preventScroll: true });
}

/* Ouvre un écran en l'ajoutant à l'historique */
function allerA(nom) {
  history.pushState({ omniVideo: true }, '', '#' + nom);
  afficherVue(nom);
}

/* Revient à l'écran précédent (ou à l'accueil si l'application a été
   ouverte directement sur cet écran). */
function revenir() {
  if (history.state && history.state.omniVideo) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    afficherVue('accueil');
  }
}

// Bouton « retour » de la tablette (ou geste de retour)
window.addEventListener('popstate', () => afficherVue(vueDepuisAdresse()));


/* ---------- 2. Les boutons ----------
   Un seul « écouteur » pour toute la page : chaque bouton porte un
   attribut data-action qui dit ce qu'il fait. */

const ACTIONS = {
  'nouveau-projet':   () => Projets.creer(),
  'ouvrir-projet':    (b) => Projets.ouvrir(b.dataset.id),
  'supprimer-projet': (b) => Projets.supprimer(b.dataset.id, b),
  'voir-tablette':    () => allerA('tablette'),
  'voir-apropos':     () => allerA('apropos'),
  'retour':           () => revenir(),
  'refaire-test':     async () => {
    Capacites.resultat = null;
    Capacites.afficher();
    await Capacites.tester();
    Capacites.afficher();
    Message.montrer('Test terminé.');
  },
  'renommer-projet':  () => Projets.renommer(),
  'changer-format':   () => Projets.changerFormat(),
  'importer':         (b) => Projets.choisirFichiers(b.dataset.type),
  'retrouver-videos': () => Projets.retrouverVideos(),
  'voir-media':       (b) => Projets.voirMedia(b.dataset.id),
  'retirer-media':    (b) => Projets.retirerMedia(b.dataset.id, b),
  'ajouter-au-montage': (b) => Projets.ajouterAuMontage(b.dataset.id),

  // Fenêtre « Voir un fichier »
  'vision-lecture':   () => Visionneuse.basculerLecture(),
  'vision-deplacer':  (b) => Visionneuse.deplacer(Number(b.dataset.secondes)),
  'vision-ajouter':   () => {
    const media = Visionneuse.media;
    Visionneuse.fermer();
    if (media) Projets.ajouterAuMontage(media.id);
  },

  // Aperçu du montage
  'montage-lecture':  () => Lecteur.basculer(),
  'montage-deplacer': (b) => Chronologie.deplacer(Number(b.dataset.secondes)),

  // Chronologie
  'annuler':          () => Chronologie.annuler(),
  'retablir':         () => Chronologie.retablir(),
  'zoom':             (b) => Chronologie.zoomer(Number(b.dataset.sens)),
  'couper':           () => Chronologie.couper(),
  'enlever-avant':    () => Chronologie.enleverAvant(),
  'enlever-apres':    () => Chronologie.enleverApres(),
  'deplacer-clip':    (b) => Chronologie.deplacerClip(Number(b.dataset.sens)),
  'duree-image':      (b) => Chronologie.dureeImage(Number(b.dataset.secondes)),
  'supprimer-clip':   (b) => Chronologie.supprimerClip(b),

  // Onglets, textes et images incrustées
  'onglet':               (b) => Onglets.ouvrir(b.dataset.onglet),
  'ajouter-texte':        () => Incrustations.ajouterTexte(),
  'choisir-incrustation': () => Incrustations.montrerChoixImages(),
  'incruster-image':      (b) => Incrustations.ajouterImage(b.dataset.id),
  'editer-calque':        (b) => Incrustations.ouvrirEditeur(b.dataset.id),
  'fermer-editeur':       () => Incrustations.fermerEditeur(),
  'calque-police':        (b) => Incrustations.changer('police', b.dataset.police),
  'calque-couleur':       (b) => Incrustations.changer('couleur', b.dataset.couleur),
  'calque-style':         (b) => Incrustations.changer('style', b.dataset.style),
  'calque-place':         (b) => {
    const c = Incrustations.calque(Incrustations.edite);
    if (!c) return;
    Incrustations.changer('x', Number(b.dataset.x));
    Incrustations.changer('y', Number(b.dataset.y));
  },
  'calque-debut-ligne':   () => Incrustations.commencerALaLigne(),
  'calque-fin-ligne':     () => Incrustations.finirALaLigne(),
  'calque-duree':         (b) => {
    const c = Incrustations.calque(Incrustations.edite);
    if (c) Incrustations.changer('duree', c.duree + Number(b.dataset.secondes));
  },
  'supprimer-calque':     (b) => Incrustations.supprimer(b),

  // Son : musique de fond, voix off, son des clips
  'choisir-musique':      () => PistesAudio.montrerChoixMusiques(),
  'ajouter-musique':      (b) => PistesAudio.ajouterMusique(b.dataset.id),
  'enregistrer-voix':     () => Enregistreur.basculer(),
  'piste-debut':          (b) => PistesAudio.commencerALaLigne(b.dataset.id),
  'piste-fin':            (b) => PistesAudio.finirALaLigne(b.dataset.id),
  'supprimer-piste':      (b) => PistesAudio.supprimer(b.dataset.id, b),
  'couper-son-clip':      () => Chronologie.basculerSonClip(),

  // Transitions
  'choisir-transition':   (b) => Chronologie.ouvrirTransition(b.dataset.cle),
  'transition-clip':      () => Chronologie.transitionDuClip(),

  // Sous-titres
  'ajouter-sous-titre':        () => SousTitres.ajouter(),
  'importer-sous-titres':      () => SousTitres.choisirFichier(),
  'editer-sous-titre':         (b) => SousTitres.ouvrirEditeur(b.dataset.id),
  'fermer-sous-titre':         () => SousTitres.fermerEditeur(),
  'sous-titre-voisin':         (b) => SousTitres.voisin(Number(b.dataset.sens)),
  'ecouter-sous-titre':        () => SousTitres.ecouter(),
  'sous-titre-debut-ligne':    () => SousTitres.commencerALaLigne(),
  'sous-titre-fin-ligne':      () => SousTitres.finirALaLigne(),
  'sous-titre-duree':          (b) => SousTitres.changerDuree(Number(b.dataset.secondes)),
  'sous-titre-suivant':        () => SousTitres.ajouterSuivant(),
  'supprimer-sous-titre':      (b) => SousTitres.supprimer(b),
  'supprimer-tous-sous-titres': (b) => SousTitres.supprimerTous(b),
  'style-sous-titres':         (b) => SousTitres.changerStyle(b.dataset.reglage, b.dataset.valeur),
  'decaler-sous-titres':       (b) => SousTitres.decaler(Number(b.dataset.secondes)),
  'enregistrer-srt':           () => SousTitres.enregistrerSrt()
};

document.addEventListener('click', (evenement) => {
  const bouton = evenement.target.closest('[data-action]');
  if (!bouton || bouton.disabled) return;
  const action = ACTIONS[bouton.dataset.action];
  if (!action) return;
  evenement.preventDefault();
  try {
    const resultat = action(bouton);
    if (resultat && typeof resultat.catch === 'function') resultat.catch(signalerErreur);
  } catch (erreur) {
    signalerErreur(erreur);
  }
});


/* ---------- 3. Filet de sécurité ----------
   Si une erreur imprévue arrive, on ne laisse pas l'application en plan :
   un message rassurant s'affiche, et le projet est enregistré. */

function signalerErreur(erreur) {
  console.error(erreur);
  Message.probleme('Oups, quelque chose ne s\'est pas passé comme prévu. Ton projet est enregistré. ' +
    'Si le souci revient, ferme Omni-Vidéo et rouvre-la.');
  if (Projets.courant) Projets.enregistrerMaintenant();
}

window.addEventListener('error', (e) => {
  // Les erreurs de chargement d'image ou de vidéo sont traitées ailleurs
  if (e.target && e.target !== window) return;
  signalerErreur(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => signalerErreur(e.reason));

// Quand Omni-Vidéo passe en arrière-plan, on enregistre tout de suite
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && Projets.courant) Projets.enregistrerMaintenant();
});


/* ---------- 4. Démarrage ---------- */

async function demarrer() {
  ecrireTexte($('#numero-version'), 'Version ' + VERSION);
  Visionneuse.initialiser();
  Lecteur.initialiser();
  Chronologie.initialiser();
  Incrustations.initialiser();
  PistesAudio.initialiser();
  SousTitres.initialiser();
  // Les polices sont chargées tout de suite (la toile ne les attend pas)
  Rendu.chargerPolices().then(() => Incrustations.redessiner(true));

  // L'application est prête à s'afficher
  $('#chargement').hidden = true;
  $('#application').hidden = false;
  document.body.dataset.pret = 'oui';

  // Ouvre l'écran demandé par l'adresse (le projet, lui, demande d'être rouvert)
  const vue = vueDepuisAdresse();
  history.replaceState(null, '', location.pathname + location.search + (vue === 'accueil' || vue === 'projet' ? '' : '#' + vue));
  afficherVue(vue === 'projet' ? 'accueil' : vue);

  // Le test de la tablette tourne pendant que l'accueil s'affiche
  await Capacites.tester();
  if (vueActive === 'accueil') Capacites.afficherBandeau();
  if (vueActive === 'tablette') Capacites.afficher();
}

demarrer().catch((erreur) => {
  console.error(erreur);
  const p = $('#chargement');
  p.hidden = false;
  p.textContent = 'Omni-Vidéo n\'a pas réussi à démarrer. Ferme-la et rouvre-la ; si le souci revient, ' +
    'mets Google Chrome à jour depuis le Play Store.';
});
