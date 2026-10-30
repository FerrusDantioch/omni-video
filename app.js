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
const VERSION = '1.2.0';

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
    case 'accueil':  Projets.afficherListe(); Capacites.afficherBandeau(); MiseAJour.majBandeau(); break;
    case 'projet':   Projets.afficherProjet(); break;
    case 'tablette': Capacites.afficher(); Place.afficher(); break;
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
window.addEventListener('popstate', () => {
  // Pendant la fabrication de la vidéo, on reste sur le projet
  if (Export.enCours) {
    history.pushState({ omniVideo: true }, '', '#projet');
    Message.montrer('Patiente : ta vidéo est en cours de fabrication.');
    return;
  }
  afficherVue(vueDepuisAdresse());
});


/* ---------- 2. Les boutons ----------
   Un seul « écouteur » pour toute la page : chaque bouton porte un
   attribut data-action qui dit ce qu'il fait. */

const ACTIONS = {
  'nouveau-projet':   () => Projets.creer(),
  'ouvrir-projet':    (b) => Projets.ouvrir(b.dataset.id),
  'sauvegarder-projet': (b) => Sauvegarde.exporter(b.dataset.id),
  'importer-projet':  () => Sauvegarde.choisirFichier(),
  'rappel-plus-tard': () => RappelSauvegarde.repousser(),
  'mettre-a-jour':    (b) => MiseAJour.appliquer(b),
  'plus-tard':        () => MiseAJour.repousser(),
  'installer':        () => Installation.installer(),
  'supprimer-projet': (b) => Projets.supprimer(b.dataset.id, b),
  'voir-tablette':    () => allerA('tablette'),
  'voir-apropos':     () => allerA('apropos'),
  'retour':           () => revenir(),
  'refaire-test':     async () => {
    Capacites.resultat = null;
    Capacites.afficher();
    await Capacites.tester();
    Capacites.afficher();
    Place.afficher();
    Message.montrer('Test terminé.');
  },
  'place-effacer':    (b) => Place.effacer(b.dataset.quoi, b),
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
  'dupliquer-clip':   () => Chronologie.dupliquerClip(),
  'enlever-blancs':   () => Blancs.ouvrir(),
  'vitesse-clip':     (b) => Chronologie.vitesseClip(Number(b.dataset.vitesse)),
  'mouvement-clip':   (b) => Chronologie.mouvementClip(b.dataset.mouvement),
  'reglages-clip-origine': () => Chronologie.reglagesOrigine(),

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
  'dupliquer-calque':     () => Incrustations.dupliquer(),

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
  'enregistrer-srt':           () => SousTitres.enregistrerSrt(),

  // Onglet « YouTube » : miniature et chapitres
  'miniature-image':       () => Miniature.prendreImage(),
  'miniature-reglage':     (b) => Miniature.changer(b.dataset.reglage, b.dataset.valeur),
  'miniature-enregistrer': () => Miniature.enregistrer(),
  'ajouter-chapitre':      () => Chapitres.ajouter(),
  'aller-chapitre':        (b) => Chapitres.aller(b.dataset.id),
  'supprimer-chapitre':    (b) => Chapitres.supprimer(b.dataset.id, b),
  'copier-chapitres':      () => Chapitres.copier(),

  // Le guide de la première fois
  'guide-suivant':         () => Guide.suivant(),
  'guide-passer':          () => Guide.terminer(),
  'revoir-guide':          () => Guide.revoir(),
  'inserer-projet':        (b) => IntroFin.inserer(b.dataset.id, b.dataset.place),

  // Fabriquer la vidéo finale
  'ouvrir-export':     () => Export.ouvrir(),
  'export-lancer':     () => Export.lancer(),
  'export-arreter':    (b) => Export.arreter(b),
  'export-enregistrer': () => Export.enregistrer(),
  'export-partager':   () => Export.partager(),
  'export-recommencer': (b) => Export.recommencer(b),
  'export-liberer':    (b) => Export.liberer(b),
  'export-retrouver':  () => Export.retrouver(),
  'export-reglages':   () => Export.ouvrir()
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


/* ---------- 4. Nouvelle version et installation ----------
   Le fonctionnement hors ligne est assuré par sw.js (le « service
   worker »). Quand une nouvelle version est publiée, elle se télécharge
   discrètement, puis ATTEND : un bandeau sur l'accueil propose « Mettre à
   jour ». Jamais de changement par surprise, et jamais pendant la
   fabrication d'une vidéo. */

const MiseAJour = {
  inscription: null,   // l'inscription du service worker
  demandee: false,     // vrai après un appui sur « Mettre à jour »
  repoussee: false,    // « Plus tard » : plus rien jusqu'à la prochaine ouverture

  surveiller(inscription) {
    this.inscription = inscription;
    // Une version attendait déjà (téléchargée lors d'une visite précédente)
    this.majBandeau();
    inscription.addEventListener('updatefound', () => {
      const nouveau = inscription.installing;
      if (!nouveau) return;
      nouveau.addEventListener('statechange', () => {
        if (nouveau.state === 'installed') this.majBandeau();
      });
    });
    // À chaque retour dans l'application, on regarde s'il y a du nouveau
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !Export.enCours) inscription.update().catch(() => {});
    });
  },

  prete() {
    // Sans « controller », c'est la toute première installation : rien à proposer
    return !!(this.inscription && this.inscription.waiting && navigator.serviceWorker.controller);
  },

  majBandeau() {
    $('#bandeau-mise-a-jour').hidden = !this.prete() || this.repoussee || Export.enCours;
  },

  appliquer(bouton) {
    if (!this.prete() || Export.enCours) return;
    if (Projets.courant) Projets.enregistrerMaintenant();
    this.demandee = true;
    bouton.disabled = true;
    ecrireTexte(bouton, 'Mise à jour…');
    this.inscription.waiting.postMessage({ type: 'activer' });
  },

  repousser() {
    this.repoussee = true;
    this.majBandeau();
    annoncer('D\'accord. Omni-Vidéo te le reproposera à la prochaine ouverture.');
  }
};

/* Installer Omni-Vidéo comme une application : Chrome prévient quand
   c'est possible (« beforeinstallprompt ») ; on montre alors notre propre
   bouton, plus visible que le menu du navigateur. */
const Installation = {
  _demande: null,

  initialiser() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._demande = e;
      $('#bandeau-installer').hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      this._demande = null;
      $('#bandeau-installer').hidden = true;
      Persistance.demander();
      Message.montrer('Omni-Vidéo est installée ✓ Tu la retrouves sur l\'écran d\'accueil de la tablette.');
    });
  },

  async installer() {
    if (!this._demande) return;
    const demande = this._demande;
    this._demande = null;
    $('#bandeau-installer').hidden = true;
    try { await demande.prompt(); } catch (e) { /* refusé ou impossible : rien de grave */ }
  }
};

/* Le fonctionnement sans Internet est-il prêt ? (écran « Vérifier ma tablette »)
   Réponses : 'pret', 'premiere-visite', 'incomplet' ou 'impossible'. */
async function etatHorsLigne() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return 'impossible';
  const gardien = navigator.serviceWorker.controller;
  if (!gardien) return 'premiere-visite';
  try {
    const reponse = await avecDelai(new Promise((reussir) => {
      const canal = new MessageChannel();
      canal.port1.onmessage = (e) => reussir(e.data);
      gardien.postMessage({ type: 'verifier' }, [canal.port2]);
    }), 15000);
    return reponse && reponse.complet ? 'pret' : 'incomplet';
  } catch (e) {
    return 'incomplet';
  }
}


/* ---------- 5. Démarrage ---------- */

async function demarrer() {
  ecrireTexte($('#numero-version'), 'Version ' + VERSION);
  Visionneuse.initialiser();
  Lecteur.initialiser();
  Chronologie.initialiser();
  Incrustations.initialiser();
  PistesAudio.initialiser();
  SousTitres.initialiser();
  Miniature.initialiser();
  Chapitres.initialiser();
  Guide.initialiser();
  IntroFin.initialiser();
  Blancs.initialiser();
  Export.initialiser();
  Installation.initialiser();

  // Mode hors ligne : on installe le service worker (fichier sw.js)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // Ce changement a aussi lieu à la toute première installation : on
    // ne recharge que si la personne a touché « Mettre à jour ».
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (MiseAJour.demandee) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((i) => MiseAJour.surveiller(i)).catch(() => {
      /* Pas de mode hors ligne : l'application marche quand même tant
         qu'elle est ouverte. */
    });
  }
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
