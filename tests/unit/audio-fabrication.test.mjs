/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Tests unitaires audio et fabrication : SourceSon._charger() sur boucle musicale,
   PistesAudio.baisseSousVoix() pré-indexé, MesureVolume et Limiteur. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, chargerScripts, lireSymbole } from './_harnais.mjs';

function creerContexteAudio() {
  const ctx = creerContexte();
  chargerScripts(ctx, ['outils.js', 'stockage.js', 'transitions.js', 'audio.js', 'fabrication.js']);
  return ctx;
}

test('SourceSon._charger recharge depuis 0 après fin de lecture et vidage de morceaux', async () => {
  const ctx = creerContexteAudio();
  let appelsSamples = 0;

  ctx._samplesFactory = () => {
    appelsSamples++;
    const chunks = [
      { debutS: 0, valeur: 0.25, nb: 24000 },
      { debutS: 0.5, valeur: 0.5, nb: 24000 }
    ];
    let idx = 0;
    return {
      async next() {
        if (idx >= chunks.length) return { done: true };
        const c = chunks[idx++];
        return {
          done: false,
          value: {
            timestamp: c.debutS,
            numberOfFrames: c.nb,
            numberOfChannels: 2,
            copyTo(dest) { dest.fill(c.valeur); },
            close() {}
          }
        };
      },
      async return() {}
    };
  };

  lireSymbole(ctx, `
    var srcTest = new SourceSon({ id: 'mus1', type: 'audio', nom: 'mus.mp3' }, new Blob(['x']));
    srcTest.frequence = 48000;
    srcTest.sink = { samples: () => _samplesFactory() };
  `);

  // Première lecture jusqu'au bout (0..1.2s) : morceaux se vide et fini passe à true
  await lireSymbole(ctx, `(async () => {
    const g1 = new Float32Array(28800);
    const d1 = new Float32Array(28800);
    await srcTest.ajouter(g1, d1, 0, 28800, 0, 0, () => 1, 1);
    const g2 = new Float32Array(28800);
    const d2 = new Float32Array(28800);
    await srcTest.ajouter(g2, d2, 0, 28800, 0.6, 0.6, () => 1, 1);
    // Avance juste au-delà pour vider morceaux
    const g3 = new Float32Array(4800);
    const d3 = new Float32Array(4800);
    await srcTest.ajouter(g3, d3, 0, 4800, 1.2, 1.2, () => 1, 1);
  })()`);

  assert.equal(appelsSamples, 1);
  assert.equal(lireSymbole(ctx, 'srcTest.fini'), true);
  assert.equal(lireSymbole(ctx, 'srcTest.morceaux.length'), 0);

  // Boucle de la musique : retour à tSource = 0 (f0 = 0 < finCharge)
  const sommeApresBoucle = await lireSymbole(ctx, `(async () => {
    const g = new Float32Array(4800);
    const d = new Float32Array(4800);
    await srcTest.ajouter(g, d, 0, 4800, 2.0, 0, () => 1, 1);
    let s = 0;
    for (let i = 0; i < g.length; i++) s += Math.abs(g[i]);
    return s;
  })()`);

  assert.equal(appelsSamples, 2, 'sink.samples doit être rouvert au retour à tSource = 0');
  assert.ok(sommeApresBoucle > 100, 'La musique bouclée ne doit pas produire de silence');
});

test('SourceSon._charger ne rouvre pas sink.samples() à chaque seconde sur une piste audio vide', async () => {
  const ctx = creerContexteAudio();
  let appelsSamples = 0;

  ctx._emptySamplesFactory = () => {
    appelsSamples++;
    return {
      async next() { return { done: true }; },
      async return() {}
    };
  };

  lireSymbole(ctx, `
    var srcVide = new SourceSon({ id: 'musVide', type: 'audio', nom: 'vide.mp3' }, new Blob(['x']));
    srcVide.frequence = 48000;
    srcVide.sink = { samples: () => _emptySamplesFactory() };
  `);

  await lireSymbole(ctx, `(async () => {
    for (let s = 0; s < 5; s++) {
      const g = new Float32Array(48000);
      const d = new Float32Array(48000);
      await srcVide.ajouter(g, d, 0, 48000, s, s, () => 1, 1);
    }
  })()`);

  assert.equal(appelsSamples, 1, 'sink.samples ne doit être appelé qu une seule fois sur une piste vide');
  assert.equal(lireSymbole(ctx, 'srcVide._pisteVide'), true);
});

test('PistesAudio.baisseSousVoix et indexerVoix évitent find() dans la boucle et respectent la courbe', () => {
  const ctx = creerContexteAudio();
  const res = lireSymbole(ctx, `(() => {
    const medias = [];
    for (let i = 0; i < 100; i++) medias.push({ id: 'm' + i, type: 'audio', duree: 60 });
    medias.push({ id: 'v1', type: 'audio', duree: 2.0 });
    medias.push({ id: 'v2', type: 'audio', duree: 5.0 });
    const projet = {
      baisserMusique: true,
      medias,
      pistes: [
        { id: 'pMus', type: 'musique', mediaId: 'm0', debut: 0, duree: 20, jusquALaFin: true, volume: 1 },
        { id: 'pV1', type: 'voix', mediaId: 'v1', debut: 2.0, duree: 3.0 }, // tronquée à media.duree=2.0 -> fin 4.0
        { id: 'pV2', type: 'voix', mediaId: 'v2', debut: 10.0, duree: 2.0 }
      ]
    };
    const voixIndex = PistesAudio.indexerVoix(projet, 20);
    const origFind = Array.prototype.find;
    let appelsFind = 0;
    Array.prototype.find = function (...a) { appelsFind++; return origFind.apply(this, a); };
    try {
      const courbes = {
        avant: PistesAudio.baisseSousVoix(projet, 1.5, 20, voixIndex),
        descente: PistesAudio.baisseSousVoix(projet, 1.85, 20, voixIndex),
        pendant: PistesAudio.baisseSousVoix(projet, 2.5, 20, voixIndex),
        remontee: PistesAudio.baisseSousVoix(projet, 4.4, 20, voixIndex),
        apres: PistesAudio.baisseSousVoix(projet, 5.0, 20, voixIndex),
        desactive: PistesAudio.baisseSousVoix({ ...projet, baisserMusique: false }, 2.5, 20)
      };
      return { courbes, appelsFind };
    } finally {
      Array.prototype.find = origFind;
    }
  })()`);

  assert.equal(res.appelsFind, 0, 'baisseSousVoix avec voixIndex ne doit appeler aucun Array.find()');
  assert.ok(Math.abs(res.courbes.avant - 1.0) < 1e-6);
  assert.ok(Math.abs(res.courbes.descente - 0.65) < 1e-6);
  assert.ok(Math.abs(res.courbes.pendant - 0.3) < 1e-6);
  assert.ok(Math.abs(res.courbes.remontee - 0.65) < 1e-6);
  assert.ok(Math.abs(res.courbes.apres - 1.0) < 1e-6);
  assert.equal(res.courbes.desactive, 1.0);
});

test('MesureVolume (silence -> -Infinity) et Limiteur (plafond <= 0.89)', () => {
  const ctx = creerContexteAudio();
  const r = lireSymbole(ctx, `(() => {
    const m = new MesureVolume();
    const z = new Float32Array(48000);
    m.ajouter(z, z);
    const vol = m.volume();
    const gainSilence = gainPourVolume(vol);

    const lim = new Limiteur();
    const g = new Float32Array(1000).fill(0.5);
    const d = new Float32Array(1000).fill(-0.5);
    lim.appliquer(g, d, 5);
    let maxPic = 0;
    for (let i = 0; i < g.length; i++) maxPic = Math.max(maxPic, Math.abs(g[i]), Math.abs(d[i]));
    return { vol, gainSilence, maxPic };
  })()`);

  assert.equal(r.vol, -Infinity);
  assert.equal(r.gainSilence, 1);
  assert.ok(r.maxPic <= 0.89 + 1e-6, `Pic supérieur au plafond : ${r.maxPic}`);
});
