/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Tests automatiques d'Omni-Vidéo.
   Ils ouvrent l'application dans un vrai navigateur (Chromium, piloté
   par Playwright), créent un projet, importent la petite vidéo
   d'exemple (tests/exemple.mp4 : 3 s, une mire et une note « la »),
   ajoutent un texte, FABRIQUENT la vidéo finale et la vérifient.
   Rien n'est envoyé sur internet.

   Lancer (Playwright doit être installé) :  node tests/tester.js
   Si ffprobe (de FFmpeg) est installé, la vidéo fabriquée est aussi
   analysée (durée, image, son) ; sinon cette partie est sautée.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { lancer, section, verifier, verifierCsp, nouvellePage, controlesCommuns } = require('./outils.js');

const EXEMPLE = path.join(__dirname, 'exemple.mp4');
const texte = (p, sel) => p.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
async function aller(p, sel) { await p.click(sel); await p.waitForTimeout(500); }

lancer('Omni-Vidéo', async () => {
  await controlesCommuns({ serviceWorker: 'sw.js' });

  // Tablette en paysage
  const { ctx, p } = await nouvellePage({ viewport: { width: 1280, height: 800 } });
  await p.waitForTimeout(1500);

  await section('Nouveau projet', async () => {
    await aller(p, '[data-action="nouveau-projet"]');
    await p.fill('#fenetre-nouveau input[name="nom"]', 'Test automatique');
    await p.click('#fenetre-nouveau button[value="ok"]');
    await p.waitForTimeout(1200);
    verifier((await texte(p, '#titre-projet')).includes('Test automatique'), 'le projet s’ouvre');
  });

  await section('Importer une vidéo', async () => {
    // Comme une personne : toucher « Importer » (vidéo), puis choisir le fichier.
    const [choix] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-action="importer"][data-type="video"]')]);
    await choix.setFiles({ name: 'exemple.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(EXEMPLE) });
    await p.waitForSelector('#liste-medias > *', { timeout: 20000 });
    verifier(true, 'la vidéo apparaît dans « Mes fichiers »');
    // Si elle n'est pas posée d'office dans la chronologie, on l'y ajoute.
    if (!(await p.$('#chrono-clips .chrono-clip'))) {
      const ajout = await p.$('#liste-medias [data-action*="ajouter"], #liste-medias button');
      if (ajout) await ajout.click();
      await p.waitForTimeout(1000);
    }
    const clips = await p.$$eval('#chrono-clips .chrono-clip', (c) => c.length);
    verifier(clips === 1, 'un clip dans la chronologie', clips);
    const duree = await texte(p, '#montage-duree');
    verifier(/0?:?0?3/.test(duree), 'durée du montage : 3 s', duree);
  });

  await section('Aperçu', async () => {
    await p.click('#montage-lecture');
    await p.waitForTimeout(1500);
    const t = await p.$eval('#montage-video-a, #montage-video-b', () =>
      Math.max(document.getElementById('montage-video-a').currentTime, document.getElementById('montage-video-b').currentTime));
    verifier(t > 0.3, 'la vidéo avance dans l’aperçu', t);
    await p.click('#montage-lecture');
  });

  await section('Couper, texte et sous-titre', async () => {
    // Couper le clip en deux vers 1,5 s (teste la réutilisation du décodeur vidéo/son)
    await p.evaluate(() => { Lecteur.aller(1.5); });
    await p.waitForTimeout(200);
    await p.click('[data-action="couper"]');
    await p.waitForTimeout(300);
    const clips = await p.$$eval('#chrono-clips .chrono-clip', (c) => c.length);
    verifier(clips === 2, 'le clip est coupé en deux morceaux', clips);

    // Ajouter un texte (style ombre par défaut : teste le cache de rendu)
    await aller(p, '.onglet[data-onglet="textes"]');
    await aller(p, '[data-action="ajouter-texte"]');
    await p.fill('#ed-texte', 'Bonjour Omni-Vidéo !');
    await p.waitForTimeout(200);
    await aller(p, '[data-action="fermer-editeur"]');
    const nbTextes = await p.$$eval('#liste-textes > li', (l) => l.length);
    verifier(nbTextes === 1, 'un texte incrusté est ajouté', nbTextes);

    // Ajouter un sous-titre (teste la recherche binaire et la mise à jour ciblée)
    await aller(p, '.onglet[data-onglet="sous-titres"]');
    await aller(p, '[data-action="ajouter-sous-titre"]');
    await p.fill('#st-texte', 'Sous-titre de test');
    await p.waitForTimeout(200);
    await aller(p, '[data-action="fermer-sous-titre"]');
    const nbSt = await p.$$eval('#liste-sous-titres > li', (l) => l.length);
    verifier(nbSt === 1, 'un sous-titre est ajouté', nbSt);
  });

  await section('Fabriquer la vidéo MP4', async () => {
    await aller(p, '#bouton-export');
    const depart = Date.now();
    await p.click('#export-lancer');
    await p.waitForSelector('[data-etape="termine"]:not([hidden]), [data-etape="erreur"]:not([hidden])', { timeout: 180000 });
    const reussi = await p.isVisible('[data-etape="termine"]');
    const dureeExport = ((Date.now() - depart) / 1000).toFixed(1);
    verifier(reussi, `la vidéo est fabriquée (${dureeExport} s)`, reussi ? '' : await p.textContent('#fenetre-export').catch(() => ''));
    if (!reussi) return;
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-action="export-enregistrer"]')]);
    const chemin = await telechargement.path();
    const taille = fs.statSync(chemin).size;
    verifier(taille > 10000, 'le fichier est enregistré (' + Math.round(taille / 1024) + ' Ko)');
    verifier(/\.mp4$/.test(telechargement.suggestedFilename()), 'nom en .mp4 : ' + telechargement.suggestedFilename());
    let analyse = null;
    try {
      analyse = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', chemin]).toString());
    } catch (e) { console.log('  (ffprobe absent : analyse sautée)'); }
    if (analyse) {
      const video = analyse.streams.find((s) => s.codec_type === 'video');
      const son = analyse.streams.find((s) => s.codec_type === 'audio');
      const duree = Number(analyse.format.duration);
      const hd = video && ((video.width === 1280 && video.height === 720) || (video.width === 1920 && video.height === 1080));
      verifier(video && video.codec_name === 'h264' && hd, `image H.264 en 16:9 (${video && video.width} × ${video && video.height})`, video);
      verifier(son && son.codec_name === 'aac', 'son AAC (accepté par YouTube)', son);
      verifier(Math.abs(duree - 3) < 0.15, 'durée : 3 s', duree);
    }
    await p.click('#fenetre-export button[value="fermer"]');
    await p.waitForTimeout(300);
  });

  await section('Hauteurs timeline et rendu sans violation CSP', async () => {
    const hauteurs = await p.evaluate(() => {
      const calque = document.querySelector('#chrono-calques .chrono-calque');
      const st = document.querySelector('#chrono-sous-titres .chrono-sous-titre');
      return {
        calque: calque ? calque.getBoundingClientRect().height : 0,
        st: st ? st.getBoundingClientRect().height : 0
      };
    });
    verifier(hauteurs.calque >= 28 && hauteurs.calque <= 32, 'hauteur piste calque 28–32 px', hauteurs.calque);
    verifier(hauteurs.st >= 28 && hauteurs.st <= 32, 'hauteur piste sous-titre 28–32 px', hauteurs.st);

    for (const onglet of ['textes', 'images', 'son', 'sous-titres', 'youtube', 'fichiers']) {
      await aller(p, `.onglet[data-onglet="${onglet}"]`);
    }
    const cspOnglets = await verifierCsp(p);
    verifier(cspOnglets.length === 0, 'aucune violation CSP sur les onglets', cspOnglets);
  });

  await section('Undo complet (chapitres, sous-titres, intro/fin)', async () => {
    // 1. Chapitre : renommage + Annuler
    await aller(p, '.onglet[data-onglet="youtube"]');
    await aller(p, '[data-action="ajouter-chapitre"]');
    const champCh = await p.$('#liste-chapitres input[data-chapitre]');
    if (champCh) {
      await champCh.fill('Mon Chapitre');
      await p.waitForTimeout(200);
      await champCh.dispatchEvent('focusout');
    }
    await aller(p, '[data-action="annuler"]');
    const titreApresUndo = await p.$eval('#liste-chapitres input[data-chapitre]', (el) => el.value);
    verifier(titreApresUndo === '', 'Annuler restaure le titre du chapitre', titreApresUndo);

    // 2. Sous-titres : décaler jusqu'à 0:00, puis no-op ne crée pas d'étape fantôme
    await aller(p, '.onglet[data-onglet="sous-titres"]');
    await aller(p, '#st-decaler summary');
    await p.waitForSelector('[data-action="decaler-sous-titres"][data-secondes="-1"]', { timeout: 5000 });
    await aller(p, '[data-action="decaler-sous-titres"][data-secondes="-1"]');
    await aller(p, '[data-action="decaler-sous-titres"][data-secondes="-1"]');
    const histAvant = await p.evaluate(() => Chronologie._historique.length);
    await aller(p, '[data-action="decaler-sous-titres"][data-secondes="-1"]');
    const histApresNoop = await p.evaluate(() => Chronologie._historique.length);
    verifier(histApresNoop === histAvant, 'decaler() au début (no-op) n empile aucune étape Annuler', { histAvant, histApresNoop });

    await aller(p, '[data-action="decaler-sous-titres"][data-secondes="1"]');
    await aller(p, '[data-action="annuler"]');
    const debutSt = await p.evaluate(() => Projets.courant.sousTitres[0].debut);
    verifier(debutSt === 0, 'Annuler remet le sous-titre à 0:00', debutSt);

    // 3. Intro/Fin : insérer un autre projet puis Annuler remet clips et medias
    await aller(p, '[data-action="retour"]');
    await aller(p, '[data-action="nouveau-projet"]');
    await p.fill('#fenetre-nouveau input[name="nom"]', 'Intro courte');
    await p.click('#fenetre-nouveau button[value="ok"]');
    await p.waitForTimeout(1000);
    const [choixIntro] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-action="importer"][data-type="video"]')]);
    await choixIntro.setFiles({ name: 'intro-exemple.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(EXEMPLE) });
    await p.waitForSelector('#liste-medias > *', { timeout: 20000 });
    await p.waitForTimeout(800);

    await aller(p, '[data-action="retour"]');
    await p.evaluate(() => {
      const cartes = [...document.querySelectorAll('.projet-carte')];
      const cible = cartes.find((c) => c.textContent.includes('Test automatique'));
      if (cible) cible.querySelector('[data-action="ouvrir-projet"]').click();
    });
    await p.waitForTimeout(1000);
    const avantIntro = await p.evaluate(() => ({
      clips: Projets.courant.clips.length,
      medias: Projets.courant.medias.length
    }));
    await aller(p, '#bloc-intro summary');
    await p.waitForSelector('[data-action="inserer-projet"][data-place="debut"]', { timeout: 5000 });
    await aller(p, '[data-action="inserer-projet"][data-place="debut"]');
    await p.waitForTimeout(500);
    const pendantIntro = await p.evaluate(() => ({
      clips: Projets.courant.clips.length,
      medias: Projets.courant.medias.length
    }));
    verifier(pendantIntro.clips > avantIntro.clips && pendantIntro.medias > avantIntro.medias, 'IntroFin.inserer() ajoute clips et médias', pendantIntro);
    await aller(p, '[data-action="annuler"]');
    const apresUndoIntro = await p.evaluate(() => ({
      clips: Projets.courant.clips.length,
      medias: Projets.courant.medias.length
    }));
    verifier(
      apresUndoIntro.clips === avantIntro.clips && apresUndoIntro.medias === avantIntro.medias,
      'Annuler après IntroFin.inserer() restaure clips et médias',
      { avantIntro, apresUndoIntro }
    );
  });

  await section('Import .omnivideo XSS et bornes', async () => {
    await aller(p, '[data-action="retour"]');
    const fabriquerContainer = (descObj, rawLen) => {
      const magie = Buffer.from('OMNIVIDEO-PROJET-1\n', 'utf8');
      const desc = Buffer.from(JSON.stringify(descObj), 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(rawLen !== undefined ? rawLen : desc.length, 0);
      return Buffer.concat([magie, len, desc]);
    };

    const nbProjetsAvant = await p.$$eval('#liste-projets > li', (l) => l.length);
    const malveillants = [
      { nom: 'longueur.omnivideo', buf: fabriquerContainer({ format: 'omnivideo-projet', version: 1, projet: { id: 'x1' }, fichiers: [] }, 0xFFFFFFFF) },
      { nom: 'taille-neg.omnivideo', buf: fabriquerContainer({ format: 'omnivideo-projet', version: 1, projet: { id: 'x2', medias: [{ id: 'm1', type: 'image' }] }, fichiers: [{ id: 'm1', taille: -10, type: 'image/png' }] }) }
    ];
    for (const mal of malveillants) {
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-action="importer-projet"]')]);
      await fc.setFiles({ name: mal.nom, mimeType: 'application/octet-stream', buffer: mal.buf });
      await p.waitForTimeout(500);
    }
    const nbApresMal = await p.$$eval('#liste-projets > li', (l) => l.length);
    verifier(nbApresMal === nbProjetsAvant, 'les sauvegardes malformées sont rejetées', { nbProjetsAvant, nbApresMal });

    const xssBuf = fabriquerContainer({
      format: 'omnivideo-projet',
      version: 1,
      projet: {
        id: 'xss-p',
        nom: '<img src=x onerror="window.__xss=1">',
        medias: [{
          id: 'm-xss', type: 'image', nom: '<script>window.__xss=2</script>',
          miniature: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9IndpbmRvdy5fX3hzc19tPTEiPg=='
        }]
      },
      fichiers: []
    });
    const [fcXss] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-action="importer-projet"]')]);
    await fcXss.setFiles({ name: 'xss.omnivideo', mimeType: 'application/octet-stream', buffer: xssBuf });
    await p.waitForTimeout(700);
    const xssEval = await p.evaluate(() => ({
      flag: window.__xss,
      svgDansDom: document.body.innerHTML.includes('data:image/svg+xml')
    }));
    verifier(xssEval.flag === undefined && !xssEval.svgDansDom, 'aucune exécution XSS ni miniature SVG après import', xssEval);
  });

  await section('Vérifier ma tablette, Refaire le test et repli Safari (sans AudioEncoder)', async () => {
    await aller(p, '[data-action="voir-tablette"]');
    await aller(p, '[data-action="refaire-test"]');
    await p.waitForSelector('#liste-tests > li', { timeout: 10000 });
    const nbTests = await p.$$eval('#liste-tests > li', (l) => l.length);
    verifier(nbTests >= 5, 'Refaire le test remplit la liste des diagnostics', nbTests);
    await verifierCsp(p);
    await ctx.close();

    // Simulation Safari sans AudioEncoder : vérifie que l'export bascule sur encodeur-aac.wasm
    const { ctx: ctxSafari, p: pSafari } = await nouvellePage({
      viewport: { width: 1280, height: 800 },
      avant: async (c) => { await c.addInitScript(() => { delete window.AudioEncoder; }); }
    });
    await pSafari.waitForTimeout(1500);
    const capSafari = await pSafari.evaluate(() => ({
      peutExporter: Capacites.resultat && Capacites.resultat.peutExporter,
      aacDirect: Capacites.resultat && Capacites.resultat.aacDirect
    }));
    verifier(capSafari.peutExporter === true && capSafari.aacDirect === false, 'Safari sans AudioEncoder autorise l export via WASM', capSafari);

    await aller(pSafari, '[data-action="nouveau-projet"]');
    await pSafari.fill('#fenetre-nouveau input[name="nom"]', 'Test Safari WASM');
    await pSafari.click('#fenetre-nouveau button[value="ok"]');
    await pSafari.waitForTimeout(1000);
    const [fcSafari] = await Promise.all([pSafari.waitForEvent('filechooser'), pSafari.click('[data-action="importer"][data-type="video"]')]);
    await fcSafari.setFiles({ name: 'exemple.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(EXEMPLE) });
    await pSafari.waitForSelector('#liste-medias > *', { timeout: 20000 });
    await aller(pSafari, '#bouton-export');
    await pSafari.click('#export-lancer');
    await pSafari.waitForSelector('[data-etape="termine"]:not([hidden]), [data-etape="erreur"]:not([hidden])', { timeout: 180000 });
    const exportSafariOk = await pSafari.isVisible('[data-etape="termine"]');
    verifier(exportSafariOk, 'export MP4 réussi sans AudioEncoder (encodeur-aac.wasm)');
    await verifierCsp(pSafari);
    await ctxSafari.close();
  });
});
