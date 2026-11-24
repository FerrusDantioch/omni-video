/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Contrôles statiques d'Omni-Vidéo (Node.js pur, zéro dépendance externe).
   Lancement : node --test tests/verifier-statique.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8');
const existe = (f) => fs.existsSync(path.join(racine, decodeURI(f)));

const html = lire('index.html');
const css = lire('styles.css');
const sw = lire('sw.js');
const manifest = JSON.parse(lire('manifest.json'));

function extraireCsp() {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/i);
  if (!m) return null;
  return Object.fromEntries(
    m[1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([n, ...v]) => [n.toLowerCase(), v])
  );
}

function extraireFichiersSw() {
  const m = sw.match(/const FICHIERS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, 'FICHIERS introuvable dans sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function fichiersJsApplication() {
  return fs
    .readdirSync(racine)
    .filter((f) => f.endsWith('.js') && f !== 'mediabunny.min.js' && f !== 'sw.js');
}

test('hygiène du dépôt : .nojekyll et fichiers de licence présents', () => {
  for (const f of ['.nojekyll', 'LICENSE', 'CREDITS.md', 'LICENCE-MEDIABUNNY.txt', 'LICENCE-APACHE-VO-AACENC.txt', 'POLICES-OFL.txt']) {
    assert.ok(existe(f), `${f} manquant à la racine`);
  }
});

test('index.html possède une CSP stricte compatible ferrusdantioch.github.io', () => {
  const c = extraireCsp();
  assert.ok(c, 'index.html : balise <meta http-equiv="Content-Security-Policy"> manquante');
  assert.deepEqual(c['default-src'], ["'self'"]);
  assert.deepEqual(c['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(c['style-src'], ["'self'"]);
  assert.deepEqual(c['img-src'], ["'self'", 'blob:', 'data:']);
  assert.deepEqual(c['media-src'], ["'self'", 'blob:']);
  assert.deepEqual(c['font-src'], ["'self'"]);
  assert.deepEqual(c['connect-src'], ["'self'", 'blob:']);
  assert.deepEqual(c['worker-src'], ["'self'"]);
  assert.deepEqual(c['object-src'], ["'none'"]);
  assert.deepEqual(c['base-uri'], ["'none'"]);
  assert.deepEqual(c['form-action'], ["'none'"]);
  assert.deepEqual(c['frame-src'], ["'none'"]);
  for (const [nom, valeurs] of Object.entries(c)) {
    assert.ok(!valeurs.includes("'unsafe-inline'"), `${nom} autorise 'unsafe-inline'`);
    assert.ok(!valeurs.includes("'unsafe-eval'"), `${nom} autorise 'unsafe-eval'`);
    assert.ok(!valeurs.some((v) => /^https?:|^\*$/.test(v)), `${nom} autorise un domaine externe ou *`);
  }
});

test("aucun script ni style en ligne dans index.html ou les gabarits JS", () => {
  assert.ok(!/<style[\s>]/i.test(html), 'balise <style> détectée dans index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), '<script> en ligne détecté dans index.html');
  assert.ok(!/\sstyle\s*=/i.test(html), 'attribut style= détecté dans index.html');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'attribut événementiel on*= détecté dans index.html');

  for (const fichier of fichiersJsApplication()) {
    const contenu = lire(fichier);
    assert.ok(!/['"`][^'"`]*?(?<![a-z-])style\s*=\s*['"]/i.test(contenu), `${fichier} injecte un attribut style= en HTML`);
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(contenu), `${fichier} injecte un attribut on*= en HTML`);
  }
});

test("aucune ressource externe n'est chargée par HTML ou CSS", () => {
  const balises = [...html.matchAll(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/gi)].map((m) => m[0]);
  for (const b of balises) {
    assert.ok(!/(src|href)="(https?:)?\/\//i.test(b), `chargement externe : ${b.slice(0, 120)}`);
  }
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/i.test(html + css), 'Google Fonts détecté');
  assert.ok(!/@import/i.test(css), '@import détecté dans styles.css');
  assert.ok(!/url\(\s*["']?(https?:)?\/\//i.test(css), 'ressource externe dans styles.css');
});

test('vérification réciproque du Service Worker (sw.js <-> HTML/CSS/manifeste/JS)', () => {
  const entreesSw = extraireFichiersSw();
  const ensembleSw = new Set(entreesSw);

  // 1. Chaque entrée du cache SW existe sur disque
  for (const entree of entreesSw) {
    const chemin = entree === './' ? 'index.html' : entree.replace(/^\.\//, '');
    assert.ok(existe(chemin), `Entrée du cache SW introuvable sur disque : ${entree}`);
  }

  // 2. Tous les fichiers locaux appelés par HTML, CSS, manifeste et chargements dynamiques JS figurent dans sw.js
  const refsHtml = [...html.matchAll(/<(?:link|script|img)\b[^>]*\b(?:src|href)="([^"#:]+)"/gi)].map((m) => m[1]);
  const refsCss = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  const refsManifest = [manifest.start_url, ...(manifest.icons || []).map((ic) => ic.src)].filter(Boolean);
  const refsDynamiques = [];
  for (const fichier of fichiersJsApplication()) {
    const contenu = lire(fichier);
    for (const m of contenu.matchAll(/(?:Worker\s*\(|\.src\s*=|fetch\s*\()\s*['"](\.\/[^'"]+)['"]/g)) {
      refsDynamiques.push(m[1]);
    }
  }

  const tousLocaux = [...new Set([...refsHtml, ...refsCss, ...refsManifest, ...refsDynamiques])];
  assert.ok(tousLocaux.includes('./compat.js'), 'index.html doit charger ./compat.js');
  assert.ok(tousLocaux.includes('./disque-prive.js'), 'chargement dynamique ./disque-prive.js attendu');
  assert.ok(tousLocaux.includes('./encodeur-aac.js'), 'chargement dynamique ./encodeur-aac.js attendu');
  assert.ok(tousLocaux.includes('./encodeur-aac.wasm'), 'chargement dynamique ./encodeur-aac.wasm attendu');

  for (const ref of tousLocaux) {
    const normalise = ref.startsWith('./') ? ref : './' + ref;
    assert.ok(existe(normalise.replace(/^\.\//, '')), `${ref} référencé mais absent du disque`);
    assert.ok(ensembleSw.has(normalise), `${normalise} est référencé mais absent de FICHIERS dans sw.js`);
  }

  // 3. Isolation sur l'origine partagée ferrusdantioch.github.io
  const mCache = sw.match(/const CACHE\s*=\s*'([^']+)'/);
  const mPrefixe = sw.match(/const PREFIXE\s*=\s*'([^']+)'/);
  assert.ok(mCache && mPrefixe, 'CACHE ou PREFIXE manquant dans sw.js');
  assert.equal(mPrefixe[1], 'omni-video-');
  assert.ok(mCache[1].startsWith(mPrefixe[1]), 'CACHE doit commencer par PREFIXE');
  assert.match(sw, /k\.startsWith\(PREFIXE\)\s*&&\s*k\s*!==\s*CACHE/);
});

test('styles.css : replis avant color-mix(), curseurs Firefox et pistes 28–32 px', () => {
  // Enlever les commentaires pour analyser proprement les blocs CSS
  const sansCom = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocs = [...sansCom.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  let nbColorMix = 0;
  for (const [, selecteur, corps] of blocs) {
    const decls = corps.split(';').map((d) => d.trim()).filter(Boolean);
    for (let i = 0; i < decls.length; i++) {
      const m = decls[i].match(/^([a-z-]+)\s*:\s*(.+)$/i);
      if (!m || !m[2].includes('color-mix(')) continue;
      nbColorMix++;
      const prop = m[1].toLowerCase();
      if (prop === '--bord-bouton' && selecteur.trim() === ':root') {
        // Doit avoir une valeur de repli directe dans le premier :root (hors @supports)
        assert.match(sansCom, /:root\s*\{[^}]*--bord-bouton\s*:\s*#[0-9a-f]{3,8}\s*;/i);
        continue;
      }
      const aRepli = decls.slice(0, i).some((prev) => {
        const pm = prev.match(/^([a-z-]+)\s*:\s*(.+)$/i);
        return pm && pm[1].toLowerCase() === prop && !pm[2].includes('color-mix(');
      });
      assert.ok(aRepli, `Repli manquant avant ${prop}: ${m[2]} dans "${selecteur.trim()}"`);
    }
  }
  assert.ok(nbColorMix >= 15, `Attendu au moins 15 règles color-mix(), trouvé ${nbColorMix}`);

  assert.match(sansCom, /input\[type="range"\]::-moz-range-track\s*\{/);
  assert.match(sansCom, /input\[type="range"\]::-moz-range-thumb\s*\{/);

  for (const cls of ['.chrono-calque', '.chrono-sous-titre', '.chrono-piste-audio']) {
    const re = new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`);
    const m = sansCom.match(re);
    assert.ok(m, `Règle ${cls} introuvable`);
    const hm = m[1].match(/\bheight\s*:\s*(\d+)px/);
    assert.ok(hm, `height manquant dans ${cls}`);
    const h = Number(hm[1]);
    assert.ok(h >= 28 && h <= 32, `Hauteur de ${cls} (${h}px) hors plage 28-32px`);
  }
});

test('polices embarquées et absence de régression typographique', () => {
  for (const f of ['oxanium.woff2', 'literata.woff2', 'jetbrains-mono.woff2']) {
    assert.ok(existe(f), `Police ${f} manquante`);
  }
  assert.match(lire('POLICES-OFL.txt'), /SIL Open Font License/);
  assert.ok(!lire('incrustations.js').includes("du l'image"), 'coquille "du l\'image" toujours présente');
});
