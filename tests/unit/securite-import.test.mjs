/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Tests unitaires sécurité : import .omnivideo, miniatures XSS, bornes, rollback et échappement. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, chargerScripts, lireSymbole } from './_harnais.mjs';

function preparerContexte() {
  const fichiersDb = new Map();
  const projetsDb = new Map();
  const supprimes = [];
  const messages = [];

  const ctx = creerContexte();
  chargerScripts(ctx, [
    'outils.js', 'stockage.js', 'transitions.js', 'lecteur.js', 'rendu.js',
    'sauvegarde.js', 'projets.js', 'chronologie.js', 'incrustations.js', 'youtube.js'
  ]);

  ctx.VERSION = '1.4.1';
  ctx.vueActive = 'accueil';
  const MediasStub = { disponible: () => true, fichiers: new Map(), oublier() {} };
  const PistesStub = { duree: (p) => p.duree };
  ctx._testHooks = { fichiersDb, projetsDb, supprimes, messages, MediasStub, PistesStub };

  lireSymbole(ctx, `
    Medias = _testHooks.MediasStub;
    PistesAudio = _testHooks.PistesStub;
    Base.enregistrerFichier = async (id, blob) => { _testHooks.fichiersDb.set(id, blob); };
    Base.supprimerFichier = async (id) => { _testHooks.supprimes.push(id); _testHooks.fichiersDb.delete(id); };
    Base.enregistrerProjet = async (p) => { _testHooks.projetsDb.set(p.id, p); };
    Base.lireProjets = async () => Array.from(_testHooks.projetsDb.values());
    Message.probleme = (t) => { _testHooks.messages.push({ type: 'probleme', t }); };
    Message.montrer = (t) => { _testHooks.messages.push({ type: 'ok', t }); };
  `);

  return ctx;
}

function construireOmnivideo(descObj, buffers = []) {
  const magie = new TextEncoder().encode('OMNIVIDEO-PROJET-1\n');
  const descBytes = new TextEncoder().encode(JSON.stringify(descObj));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, descBytes.length, true);
  return new File([magie, len, descBytes, ...buffers], 'test.omnivideo', { type: 'application/octet-stream' });
}

test('nettoyerMedia valide les miniatures avec la regex stricte et borne les champs', () => {
  const ctx = preparerContexte();
  const validePng = 'data:image/png;base64,iVBORw0KGgo=';
  const valideWebp = 'data:image/webp;base64,UklGRh4AAABXRUJQ';
  const xssSvg = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+';
  const xssBreakout = 'data:image/png;base64,AAA"onerror="alert(1)';
  const tropLong = 'data:image/png;base64,' + 'A'.repeat(300001);

  const okPng = lireSymbole(ctx, `nettoyerMedia({ id: 'm1', type: 'image', miniature: ${JSON.stringify(validePng)} })`);
  assert.equal(okPng.miniature, validePng);

  const okWebp = lireSymbole(ctx, `nettoyerMedia({ id: 'm2', type: 'image', miniature: ${JSON.stringify(valideWebp)} })`);
  assert.equal(okWebp.miniature, valideWebp);

  for (const mauvais of [xssSvg, xssBreakout, 'javascript:alert(1)', tropLong]) {
    const res = lireSymbole(ctx, `nettoyerMedia({ id: 'm3', type: 'image', miniature: ${JSON.stringify(mauvais)} })`);
    assert.equal(res.miniature, '', `Payload accepté à tort : ${mauvais.slice(0, 40)}`);
  }

  const borne = lireSymbole(ctx, `nettoyerMedia({
    id: 'm4', type: 'video', taille: -50, duree: -3, largeur: -100, hauteur: -200,
    probleme: 'X'.repeat(500)
  })`);
  assert.equal(borne.taille, 0);
  assert.equal(borne.duree, 0);
  assert.equal(borne.largeur, 0);
  assert.equal(borne.hauteur, 0);
  assert.equal(borne.probleme.length, 300);
  assert.equal(lireSymbole(ctx, `nettoyerMedia({ id: '', type: 'image' })`), null);
  assert.equal(lireSymbole(ctx, `nettoyerMedia({ id: 'x'.repeat(101), type: 'image' })`), null);
});

test('Sauvegarde.importer rejette longueurs/tailles invalides et nettoie en cas d erreur', async () => {
  const ctx = preparerContexte();
  const { fichiersDb, projetsDb, supprimes } = ctx._testHooks;

  // 1. Longueur d'en-tête aberrante
  const magie = new TextEncoder().encode('OMNIVIDEO-PROJET-1\n');
  const lenBad = new Uint8Array(4);
  new DataView(lenBad.buffer).setUint32(0, 0xFFFFFFFF, true);
  ctx._fTest = new File([magie, lenBad, new Uint8Array([1, 2, 3])], 'bad.omnivideo');
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(projetsDb.size, 0);
  assert.equal(fichiersDb.size, 0);

  // 2. f.taille négative -> rejetée avant toute écriture en base
  ctx._fTest = construireOmnivideo({
    format: 'omnivideo-projet',
    version: 1,
    projet: { id: 'p1', nom: 'Test', medias: [{ id: 'm1', type: 'image', nom: 'a.png' }] },
    fichiers: [{ id: 'm1', taille: -10, type: 'image/png' }]
  });
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(projetsDb.size, 0);
  assert.equal(fichiersDb.size, 0);

  // 3. Version invalide -> rejetée
  ctx._fTest = construireOmnivideo({
    format: 'omnivideo-projet',
    version: 99,
    projet: { id: 'p1', nom: 'Test', medias: [] },
    fichiers: []
  });
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(projetsDb.size, 0);

  // 4. Rollback IndexedDB si enregistrerProjet échoue après écriture d'un blob
  const payload = new Uint8Array([1, 2, 3, 4]);
  ctx._fTest = construireOmnivideo({
    format: 'omnivideo-projet',
    version: 1,
    projet: { id: 'p1', nom: 'Test', medias: [{ id: 'm1', type: 'image', nom: 'a.png' }] },
    fichiers: [{ id: 'm1', taille: 4, type: 'image/svg+xml' }]
  }, [payload]);
  lireSymbole(ctx, `
    Base.enregistrerProjet = async () => { const e = new Error('Plein'); e.name = 'QuotaExceededError'; throw e; };
  `);
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(supprimes.length, 1, 'Le blob écrit avant l erreur doit être supprimé (rollback)');
  assert.equal(fichiersDb.size, 0);

  // 5. Type MIME dangereux (text/html) ou audio/svg+xml assaini en chaîne vide sur import réussi
  lireSymbole(ctx, `
    Base.enregistrerProjet = async (p) => { _testHooks.projetsDb.set(p.id, p); };
  `);
  ctx._fTest = construireOmnivideo({
    format: 'omnivideo-projet',
    version: 1,
    projet: { id: 'p2', nom: 'Sain', medias: [{ id: 'm1', type: 'image', nom: 'a.png' }] },
    fichiers: [{ id: 'm1', taille: 4, type: 'text/html' }]
  }, [payload]);
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(projetsDb.size, 1);
  const blobStocke = Array.from(fichiersDb.values())[0];
  assert.notEqual(blobStocke.type, 'text/html');

  ctx._fTest = construireOmnivideo({
    format: 'omnivideo-projet',
    version: 1,
    projet: { id: 'p3', nom: 'Son sain', medias: [{ id: 'm1', type: 'audio', nom: 'a.mp3' }] },
    fichiers: [{ id: 'm1', taille: 4, type: 'audio/svg+xml' }]
  }, [payload]);
  await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
  assert.equal(projetsDb.size, 2);
  const blobAudioSvg = Array.from(fichiersDb.values())[1];
  assert.equal(blobAudioSvg.type, '');

  // 6. donnees.projet primitif (true) ou tableau ([]) rejeté proprement sans TypeError
  const { messages } = ctx._testHooks;
  for (const mauvaisProjet of [true, []]) {
    ctx._fTest = construireOmnivideo({
      format: 'omnivideo-projet',
      version: 1,
      projet: mauvaisProjet,
      fichiers: []
    });
    await lireSymbole(ctx, `Sauvegarde.importer(_fTest)`);
    assert.match(messages[messages.length - 1].t, /pas une sauvegarde/);
  }
  assert.equal(projetsDb.size, 2);
});

test('rendu UI : aucune injection XSS ni style= et CSS.escape sur les IDs chapitres', () => {
  const ctx = preparerContexte();
  const payloadNom = '<img src=x onerror=alert(1)>';
  const payloadId = 'ch"1]';

  // carteMedia échappe nom/id/problème et rejette une miniature non validée
  const htmlCarte = lireSymbole(ctx, `carteMedia({
    id: ${JSON.stringify(payloadId)}, type: 'image', nom: ${JSON.stringify(payloadNom)},
    taille: 100, largeur: 10, hauteur: 10, aSon: false,
    miniature: 'data:image/svg+xml;base64,PHN2Zz4=', probleme: ${JSON.stringify(payloadNom)}
  }, 0)`);
  assert.ok(!htmlCarte.includes('<img src=x'), 'XSS non échappé dans carteMedia');
  assert.ok(!htmlCarte.includes('data:image/svg+xml'), 'SVG miniature injectée dans carteMedia');

  // Incrustations : pas de style= dans #liste-textes, SVG miniature bloquée dans #liste-incrustations
  lireSymbole(ctx, `
    Projets.courant = {
      id: 'p1',
      medias: [{ id: 'm1', type: 'image', nom: ${JSON.stringify(payloadNom)}, miniature: 'data:image/svg+xml;base64,PHN2Zz4=' }],
      calques: [
        { id: 'c1', type: 'texte', debut: 0, duree: 2, texte: ${JSON.stringify(payloadNom)}, police: 'oxanium' },
        { id: 'c2', type: 'image', mediaId: 'm1', debut: 0, duree: 2 }
      ],
      clips: [], pistes: [], sousTitres: [], chapitres: []
    };
    Incrustations.afficherListes();
  `);
  const listeTextes = lireSymbole(ctx, `$('#liste-textes')`);
  assert.equal(listeTextes.children.length, 1);
  assert.equal(listeTextes.children[0].children[0].textContent, payloadNom);
  const htmlInc = lireSymbole(ctx, `$('#liste-incrustations').innerHTML`);
  assert.ok(!htmlInc.includes('data:image/svg+xml'));
  assert.ok(!htmlInc.includes('<img src=x'));

  // Chapitres.ajouter échappe l'ID dans querySelector via CSS.escape
  let selecteurObserve = '';
  ctx._origQS = ctx.document.querySelector;
  ctx.document.querySelector = (sel) => {
    if (sel.includes('[data-chapitre=')) selecteurObserve = sel;
    return ctx._origQS(sel);
  };
  lireSymbole(ctx, `
    Lecteur.duree = () => 60;
    nouvelId = () => 'id"avec]guillemet';
    Chapitres.ajouter();
  `);
  assert.ok(selecteurObserve.includes('id\\"avec\\]guillemet'), `Sélecteur non échappé : ${selecteurObserve}`);
});
