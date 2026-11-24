/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Tests unitaires capacités & Safari : High/Main/Baseline H.264, Safari sans AudioEncoder,
   invalidation des caches sur « Refaire le test », et EncodeurAacDeSecours. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, chargerScripts, lireSymbole } from './_harnais.mjs';

function preparerContexteCapacites(overrides = {}) {
  const ctx = creerContexte(overrides);
  ctx.Mediabunny = {
    CustomAudioEncoder: class {},
    EncodedPacket: class {
      constructor(data, type, timestamp, duration) {
        this.data = data; this.type = type; this.timestamp = timestamp; this.duration = duration;
      }
    },
    registerEncoder() {},
    canEncodeAudio: async () => false,
    canEncodeVideo: async () => true
  };
  chargerScripts(ctx, ['outils.js', 'stockage.js', 'capacites.js', 'fabrication.js', 'reprise.js', 'export.js']);
  // Stubs minimaux avant de charger app.js (qui lance demarrer())
  for (const nom of ['Visionneuse', 'Lecteur', 'Chronologie', 'Incrustations', 'PistesAudio',
    'SousTitres', 'Miniature', 'Chapitres', 'Guide', 'IntroFin', 'Blancs', 'Projets']) {
    ctx[nom] = { initialiser() {}, afficherListe() {}, afficherBandeau() {}, redessiner() {}, fermer() {}, afficherProjet() {} };
  }
  ctx.Rendu = { chargerPolices: async () => {} };
  ctx.Base.ouvrir = async () => ({});
  // Isoler demarrer() afin qu'il ne lance pas un Capacites.tester() concurrent en arrière-plan
  const origTester = ctx.Capacites.tester.bind(ctx.Capacites);
  ctx.Capacites.tester = async () => null;
  chargerScripts(ctx, ['app.js']);
  ctx.Capacites.tester = origTester;
  return ctx;
}

test('encodageH264Soutenu et choisirEncodeur acceptent Main ou Baseline quand High échoue', async () => {
  const ctx = preparerContexteCapacites({
    VideoDecoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoEncoder: Object.assign(function () {}, {
      isConfigSupported: async (cfg) => ({
        supported: cfg.codec.startsWith('avc1.4d00') || cfg.codec.startsWith('avc1.42e0')
      })
    }),
    AudioDecoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    AudioEncoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoFrame: function () {}
  });

  const r = await lireSymbole(ctx, 'Capacites.tester()');
  assert.equal(r.peutExporter, true);
  assert.equal(r.export1080, true);
  const enc = r.tests.find((t) => t.id === 'encodage');
  assert.equal(enc.niveau, 'ok');
  const mat = r.tests.find((t) => t.id === 'materiel');
  assert.match(mat.explication, /Main/);
});

test('Safari sans AudioEncoder (ni AudioDecoder) ne bloque pas l export et utilise encodeur-aac.wasm', async () => {
  const ctx = preparerContexteCapacites({
    VideoDecoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoEncoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoFrame: function () {},
    AudioDecoder: undefined,
    AudioEncoder: undefined
  });

  const r = await lireSymbole(ctx, 'Capacites.tester()');
  assert.equal(r.peutFonctionner, true);
  assert.equal(r.peutExporter, true);
  assert.equal(r.aacDirect, false);
  const testAac = r.tests.find((t) => t.id === 'aac');
  assert.equal(testAac.niveau, 'attention');
  assert.match(testAac.explication, /secours/);
});

test('Action refaire-test vide _encodeurs et DisquePrive._essai avant de relancer Capacites.tester()', async () => {
  const ctx = preparerContexteCapacites({
    VideoDecoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoEncoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    AudioDecoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    AudioEncoder: Object.assign(function () {}, { isConfigSupported: async () => ({ supported: true }) }),
    VideoFrame: function () {}
  });

  const avant = lireSymbole(ctx, `(() => {
    _encodeurs.set('1280x720-5000000', Promise.resolve({ materiel: false }));
    DisquePrive._essai = Promise.resolve(false);
    return { enc: _encodeurs.size, essai: DisquePrive._essai !== null };
  })()`);
  assert.equal(avant.enc, 1);
  assert.equal(avant.essai, true);

  const verif = await lireSymbole(ctx, `(async () => {
    _encodeurs.set('factice', Promise.resolve({ materiel: false }));
    DisquePrive._essai = Promise.resolve(false);
    let etatAuDebutDuTest = null;
    const orig = Capacites.tester;
    Capacites.tester = async function () {
      etatAuDebutDuTest = { enc: _encodeurs.size, essai: DisquePrive._essai };
      return orig.call(this);
    };
    await ACTIONS['refaire-test']();
    Capacites.tester = orig;
    return etatAuDebutDuTest;
  })()`);
  assert.deepEqual(verif, { enc: 0, essai: null });
  assert.equal(lireSymbole(ctx, '_encodeurs.size > 0'), true, '_encodeurs doit être repeuplé par Capacites.tester()');
});

test('EncodeurAacDeSecours : supports, AudioSpecificConfig 48kHz stéréo, encode 1024 trames, flush/close', async () => {
  let registered = null;
  const memoire = new ArrayBuffer(65536);
  const wasmExports = {
    memory: { buffer: memoire },
    va_ouvrir: () => 0,
    va_entree: () => 0,
    va_sortie: () => 8192,
    va_encoder: () => 16
  };
  const ctx = creerContexte({
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    WebAssembly: {
      compile: async () => ({ mock: true }),
      instantiate: async () => ({ exports: wasmExports })
    }
  });
  ctx.Mediabunny = {
    CustomAudioEncoder: class {},
    EncodedPacket: class {
      constructor(data, type, timestamp, duration) {
        this.data = data; this.type = type; this.timestamp = timestamp; this.duration = duration;
      }
    },
    registerEncoder: (cls) => { registered = cls; }
  };
  chargerScripts(ctx, ['encodeur-aac.js']);
  assert.ok(registered);
  assert.equal(registered.supports('aac', { numberOfChannels: 2, sampleRate: 48000 }), true);
  assert.equal(registered.supports('aac', { numberOfChannels: 2, sampleRate: 12345 }), false);

  const paquets = [];
  const enc = new registered();
  enc.config = { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 };
  enc.onPacket = (pkt, meta) => paquets.push({ pkt, meta });
  await enc.init();
  assert.deepEqual(Array.from(enc.description), [0x11, 0x90]);

  const samples = new Float32Array(1024 * 2);
  enc.encode({
    timestamp: 0,
    allocationSize: () => samples.byteLength,
    copyTo: (dest) => { new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength).set(new Uint8Array(samples.buffer)); }
  });
  assert.equal(paquets.length, 1);
  assert.ok(paquets[0].meta && paquets[0].meta.decoderConfig);
  enc.flush();
  assert.ok(paquets.length >= 3);
  enc.close();
  assert.equal(enc.wasm, null);
});
