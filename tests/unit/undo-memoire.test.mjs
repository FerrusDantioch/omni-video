/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Tests unitaires Undo & mémoire : IntroFin.inserer(), Chapitres.changerTitre(),
   SousTitres.decaler(), course ImageBitmap dans Rendu, libération toiles,
   et délai ObjectURL >= 60s. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, chargerScripts, lireSymbole } from './_harnais.mjs';

function preparerContexteUndo(t = null) {
  const fichiersDb = new Map();
  const projetsDb = new Map();
  const supprimes = [];
  const ctx = creerContexte({}, t);
  ctx.Guide = { etape: -1, terminer() {} };
  ctx.Visionneuse = { fermer() {}, media: null };
  chargerScripts(ctx, [
    'outils.js', 'stockage.js', 'transitions.js', 'lecteur.js', 'rendu.js',
    'chronologie.js', 'incrustations.js', 'audio.js', 'sous-titres.js',
    'intro.js', 'youtube.js', 'medias.js', 'projets.js'
  ]);
  ctx._hooks = { fichiersDb, projetsDb, supprimes };
  lireSymbole(ctx, `
    Base.lireProjet = async (id) => _hooks.projetsDb.get(id) || null;
    Base.lireFichier = async (id) => _hooks.fichiersDb.get(id) || null;
    Base.enregistrerFichier = async (id, b) => { _hooks.fichiersDb.set(id, b); };
    Base.supprimerFichier = async (id) => { _hooks.supprimes.push(id); _hooks.fichiersDb.delete(id); };
    Base.enregistrerProjet = async (p) => { _hooks.projetsDb.set(p.id, p); };
    Message.montrer = () => {};
    Message.probleme = () => {};
  `);
  return ctx;
}

test('IntroFin.inserer() permet d annuler et rétablir les médias insérés et purge les orphelins à la fermeture', async () => {
  const ctx = preparerContexteUndo();
  const { fichiersDb, projetsDb, supprimes } = ctx._hooks;
  fichiersDb.set('mIntroImg', new Blob(['img'], { type: 'image/png' }));
  projetsDb.set('intro1', {
    id: 'intro1', nom: 'Mon Intro', format: '16:9', ajustement: 'contenir',
    medias: [{ id: 'mIntroImg', type: 'image', nom: 'logo.png', taille: 3, largeur: 100, hauteur: 100, duree: 0 }],
    clips: [{ id: 'cIntro', mediaId: 'mIntroImg', debut: 0, fin: 3, volume: 1, vitesse: 1, mouvement: 'aucun', lumiere: 1, contraste: 1, saturation: 1, transition: { type: 'aucune', duree: 1 } }],
    calques: [], pistes: [], sousTitres: [], chapitres: [],
    transitionDebut: { type: 'aucune', duree: 1 }, transitionFin: { type: 'aucune', duree: 1 },
    styleSousTitres: { taille: 'normale', place: 'bas', fond: 'bandeau', couleur: '#ffffff', visibles: true },
    baisserMusique: true
  });

  await lireSymbole(ctx, `(async () => {
    const cible = nettoyerProjet({
      id: 'p1', nom: 'Principal',
      medias: [{ id: 'mBase', type: 'image', nom: 'fond.png', taille: 10, largeur: 100, hauteur: 100 }],
      clips: [{ id: 'c1', mediaId: 'mBase', debut: 0, fin: 5 }]
    });
    Projets.courant = cible;
    Chronologie.ouvrir(cible);
    await IntroFin.inserer('intro1', 'debut');
  })()`);

  assert.equal(lireSymbole(ctx, 'Projets.courant.medias.length'), 2);
  assert.equal(lireSymbole(ctx, 'Projets.courant.clips.length'), 2);

  // Annuler -> médias et clips reviennent à l'état initial
  lireSymbole(ctx, 'Chronologie.annuler()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.medias.length'), 1);
  assert.equal(lireSymbole(ctx, 'Projets.courant.medias[0].id'), 'mBase');
  assert.equal(lireSymbole(ctx, 'Projets.courant.clips.length'), 1);

  // Rétablir -> remet le média et le clip de l'intro
  lireSymbole(ctx, 'Chronologie.retablir()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.medias.length'), 2);

  // Annuler à nouveau puis fermer le projet -> purge le blob orphelin de la base
  lireSymbole(ctx, 'Chronologie.annuler()');
  lireSymbole(ctx, 'Projets.fermer()');
  assert.equal(supprimes.length, 1);
  assert.equal(fichiersDb.has('mIntroImg'), true, 'Le fichier d origine de l intro reste intact');
});

test('Chapitres.changerTitre() crée une étape Annuler et restaure l ancien titre', () => {
  const ctx = preparerContexteUndo();
  lireSymbole(ctx, `(() => {
    const p = nettoyerProjet({
      id: 'p1', nom: 'P',
      medias: [{ id: 'm1', type: 'image', nom: 'a.png', taille: 5, largeur: 10, hauteur: 10 }],
      clips: [{ id: 'c1', mediaId: 'm1', debut: 0, fin: 30 }],
      chapitres: [{ id: 'ch1', t: 0, titre: 'Intro' }]
    });
    Projets.courant = p;
    Chronologie.ouvrir(p);
    Chapitres.changerTitre('ch1', 'Nouveau');
    Chapitres.changerTitre('ch1', 'Nouveau titre');
  })()`);

  assert.equal(lireSymbole(ctx, 'Chronologie._historique.length'), 1, 'Une seule étape pour la frappe continue');
  assert.equal(lireSymbole(ctx, 'Projets.courant.chapitres[0].titre'), 'Nouveau titre');

  lireSymbole(ctx, 'Chronologie.annuler()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.chapitres[0].titre'), 'Intro');

  lireSymbole(ctx, 'Chronologie.retablir()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.chapitres[0].titre'), 'Nouveau titre');
});

test('SousTitres.decaler() ignore les no-op avant _memoriser et réinitialise _dernierDecalage après Undo', () => {
  const ctx = preparerContexteUndo();
  lireSymbole(ctx, `(() => {
    const p = nettoyerProjet({
      id: 'p1', nom: 'P',
      sousTitres: [{ id: 's1', debut: 0, duree: 2, texte: 'Salut' }]
    });
    Projets.courant = p;
    Chronologie.ouvrir(p);
    SousTitres.decaler(-1);
  })()`);
  assert.equal(lireSymbole(ctx, 'Chronologie._historique.length'), 0, 'Un décalage nul ne doit pas empiler d étape Annuler');

  lireSymbole(ctx, `(() => {
    SousTitres.decaler(2);
    Chronologie.annuler();
  })()`);
  assert.equal(lireSymbole(ctx, 'Projets.courant.sousTitres[0].debut'), 0);
  assert.equal(lireSymbole(ctx, 'SousTitres._dernierDecalage'), 0);

  // Un second décalage juste après Undo (< 4s) doit mémoriser une nouvelle étape
  lireSymbole(ctx, 'SousTitres.decaler(1)');
  assert.equal(lireSymbole(ctx, 'Chronologie._historique.length'), 1);
  assert.equal(lireSymbole(ctx, 'Projets.courant.sousTitres[0].debut'), 1);
});

test('SousTitres.decaler() crée une nouvelle étape Annuler quand le sens de décalage s inverse (< 4s)', () => {
  const ctx = preparerContexteUndo();
  lireSymbole(ctx, `(() => {
    const p = nettoyerProjet({
      id: 'p1', nom: 'P',
      sousTitres: [{ id: 's1', debut: 1.5, duree: 2, texte: 'Salut' }]
    });
    Projets.courant = p;
    Chronologie.ouvrir(p);
    SousTitres.decaler(-1); // 1.5 -> 0.5 (étape 1 : 1.5)
    SousTitres.decaler(-1); // 0.5 -> 0 (même sens < 4s : regroupé)
    SousTitres.decaler(-1); // no-op à 0
    SousTitres.decaler(1);  // 0 -> 1 (sens inversé < 4s : étape 2 : 0)
  })()`);
  assert.equal(lireSymbole(ctx, 'Chronologie._historique.length'), 2);
  assert.equal(lireSymbole(ctx, 'Projets.courant.sousTitres[0].debut'), 1);

  lireSymbole(ctx, 'Chronologie.annuler()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.sousTitres[0].debut'), 0);
  assert.equal(lireSymbole(ctx, 'SousTitres._dernierSensDecalage'), 0);

  lireSymbole(ctx, 'Chronologie.annuler()');
  assert.equal(lireSymbole(ctx, 'Projets.courant.sousTitres[0].debut'), 1.5);
});

test('Rendu.image() ferme l ImageBitmap si oublierImage/oublierImages survient avant résolution', async () => {
  const ctx = preparerContexteUndo();
  let resoudre1, resoudre2;
  let closed1 = false, closed2 = false;
  ctx._cbAppele = 0;

  ctx.createImageBitmap = (() => {
    let appel = 0;
    return () => {
      appel++;
      if (appel === 1) return new Promise((r) => { resoudre1 = r; });
      return new Promise((r) => { resoudre2 = r; });
    };
  })();

  lireSymbole(ctx, `
    Medias.fichiers.set('m1', new Blob(['1']));
    Medias.fichiers.set('m2', new Blob(['2']));
    Rendu.image({ id: 'm1' }, () => { throw new Error('ne doit pas être appelé'); });
    Rendu.oublierImage('m1');
  `);
  resoudre1({ close() { closed1 = true; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closed1, true);
  assert.equal(lireSymbole(ctx, "Rendu._images.has('m1')"), false);

  lireSymbole(ctx, `Rendu.image({ id: 'm2' }, () => { _cbAppele++; }); Rendu.oublierImages();`);
  resoudre2({ close() { closed2 = true; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closed2, true);
  assert.equal(ctx._cbAppele, 0);
  assert.equal(lireSymbole(ctx, "Rendu._images.has('m2')"), false);
});

test('libererToile remet width=0 et height=0 dans Miniature et analyserImage, et telechargerFichier attend >= 60 s', async (t) => {
  const ctx = preparerContexteUndo(t);
  await lireSymbole(ctx, `(async () => {
    // 1. Miniature.enregistrer + Miniature.oublier
    const fond = nouvelleToile(1280, 720);
    Miniature._fond = fond;
    Miniature._cleFond = 'cle';
    Miniature._cle = () => 'cle';
    Miniature.preparerFond = async () => fond;
    Projets.courant = nettoyerProjet({
      id: 'p1', nom: 'Test',
      medias: [{ id: 'm1', type: 'image', nom: 'a.png', taille: 5, largeur: 10, hauteur: 10 }],
      clips: [{ id: 'c1', mediaId: 'm1', debut: 0, fin: 5 }]
    });
    Medias.fichiers.set('m1', new Blob(['x']));
    Lecteur.calculer(Projets.courant);
    await Miniature.enregistrer();
    Miniature.oublier();

    // 2. analyserImage
    createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
    await analyserImage(new File(['img'], 'a.png', { type: 'image/png' }));
  })()`);

  const toilesNonVides = ctx._createdCanvases.filter((c) => c.width !== 0 || c.height !== 0);
  assert.equal(toilesNonVides.length, 0, 'Toutes les toiles temporaires doivent être remises à 0×0');

  // 3. ObjectURL revocation >= 60000 ms
  lireSymbole(ctx, `telechargerFichier(new Blob(['data']), 'video.mp4')`);
  const revocations = ctx._scheduledTimers.filter((t) => t.ms >= 60000);
  assert.ok(revocations.length >= 1, 'Le délai de révocation ObjectURL doit être >= 60 000 ms');
});
