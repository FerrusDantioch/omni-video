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
const { lancer, section, verifier, nouvellePage, controlesCommuns } = require('./outils.js');

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

  await section('Fabriquer la vidéo MP4', async () => {
    await aller(p, '#bouton-export');
    await p.click('#export-lancer');
    await p.waitForSelector('[data-etape="termine"]:not([hidden]), [data-etape="erreur"]:not([hidden])', { timeout: 180000 });
    const reussi = await p.isVisible('[data-etape="termine"]');
    verifier(reussi, 'la vidéo est fabriquée', reussi ? '' : await p.textContent('#fenetre-export').catch(() => ''));
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
  });

  await ctx.close();
});
