/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Tests unitaires reprise/OPFS : disque-prive.js + fluxParTravailleur,
   fabriquerSonSeul() morceau.close(), assemblerParties() entreeSon.dispose() & état avant removeEntry,
   Reprise.effacer() avec trous, et calcul de quota dans export.js. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, chargerScripts, lireSymbole, MockOPFS, creerMockWorkerClasse } from './_harnais.mjs';

function creerContexteReprise(opfs, workerOpts = {}) {
  const Worker = creerMockWorkerClasse(opfs, workerOpts);
  const ctx = creerContexte({ Worker });
  ctx.navigator.storage.getDirectory = async () => opfs;
  chargerScripts(ctx, ['outils.js', 'stockage.js', 'transitions.js', 'audio.js', 'fabrication.js', 'reprise.js', 'export.js']);
  ctx.VERSION = '1.4.1';
  return ctx;
}

test('fluxParTravailleur + disque-prive.js écrit correctement et gère erreurs / timeout', async () => {
  const opfs = new MockOPFS();
  const ctx = creerContexteReprise(opfs);

  // 1. Écriture de morceaux alignés et avec byteOffset non nul
  await lireSymbole(ctx, `(async () => {
    const flux = await fluxParTravailleur('test.mp4');
    const w = flux.getWriter();
    await w.write({ type: 'write', position: 0, data: new Uint8Array([10, 20, 30]) });
    const vueDecalee = new Uint8Array([99, 40, 50, 99]).subarray(1, 3);
    await w.write({ type: 'write', position: 3, data: vueDecalee });
    await w.close();
  })()`);
  assert.deepEqual(Array.from(opfs.files.get('test.mp4')), [10, 20, 30, 40, 50]);

  // 2. Erreur QuotaExceededError sur écriture
  const travailleurs = [];
  const ctxErr = creerContexteReprise(opfs, {
    failOnType: 'ecrire',
    failName: 'QuotaExceededError',
    onCreate: (w) => travailleurs.push(w)
  });
  const nomErreur = await lireSymbole(ctxErr, `(async () => {
    const flux = await fluxParTravailleur('err.mp4');
    const w = flux.getWriter();
    try {
      await w.write({ type: 'write', position: 0, data: new Uint8Array([1, 2]) });
      return '';
    } catch (e) {
      return e.name;
    }
  })()`);
  assert.equal(nomErreur, 'QuotaExceededError');
  assert.equal(travailleurs[0].terminated, true);

  // 3. Travailleur bloqué sur fermer() -> avecDelai + terminate() sans attente infinie
  const bloques = [];
  const ctxBloque = creerContexteReprise(opfs, {
    ignoreType: 'fermer',
    onCreate: (w) => bloques.push(w)
  });
  // Raccourcir le délai de test en vérifiant que avecDelai est bien utilisé sur fermer()
  const res = await lireSymbole(ctxBloque, `(async () => {
    const origAvecDelai = avecDelai;
    let delaiAppele = false;
    avecDelai = (p, ms) => {
      delaiAppele = true;
      return origAvecDelai(p, ms === 5000 && p ? 20 : ms);
    };
    const flux = await fluxParTravailleur('bloque.mp4');
    const w = flux.getWriter();
    await w.close().catch(() => {});
    avecDelai = origAvecDelai;
    return delaiAppele;
  })()`);
  assert.equal(res, true);
  assert.equal(bloques[0].terminated, true);
});

test('fabriquerSonSeul ferme morceau.close() même si sourceSon.add() rejette', async () => {
  const opfs = new MockOPFS();
  const ctx = creerContexteReprise(opfs);
  const compte = await lireSymbole(ctx, `(async () => {
    let created = 0, closed = 0, addCalls = 0;
    Mediabunny = {
      Output: class {
        constructor() { this.state = 'pending'; }
        addAudioTrack() {}
        async start() {}
        async finalize() {}
        async cancel() { this.state = 'canceled'; }
      },
      Mp4OutputFormat: class {},
      StreamTarget: class {},
      AudioSampleSource: class {
        async add() {
          addCalls++;
          if (addCalls === 2) throw new Error('Erreur encodage');
        }
      },
      AudioSample: class {
        constructor() { created++; }
        close() { closed++; }
      }
    };
    Medias = { fichiers: new Map() };
    const projet = { id: 'p1', pistes: [], medias: [], baisserMusique: false };
    try {
      await fabriquerSonSeul(projet, [], 2, 1, [], () => {}, () => {}, null);
    } catch (e) {}
    return { created, closed };
  })()`);

  assert.equal(compte.created, 2);
  assert.equal(compte.closed, 2, 'chaque AudioSample doit être fermé dans finally');
});

test('assemblerParties appelle entreeSon.dispose() sur erreur et persiste etat avant removeEntry', async () => {
  const opfs = new MockOPFS();
  opfs.files.set('omnivideo-son.mp4', new Uint8Array([1, 2]));
  opfs.files.set('omnivideo-partie-0.mp4', new Uint8Array([3, 4]));
  opfs.files.set('omnivideo-partie-1.mp4', new Uint8Array([5, 6]));

  const ctx = creerContexteReprise(opfs);

  // 1. Erreur précoce avant boucle (getDecoderConfig throws) -> entreeSon.dispose() appelé
  const disposed = await lireSymbole(ctx, `(async () => {
    let sonDisposed = false;
    Mediabunny = {
      ALL_FORMATS: [],
      BlobSource: class {},
      Input: class {
        constructor() { this.son = true; }
        async getPrimaryAudioTrack() {
          return { getDecoderConfig: async () => { throw new Error('Audio corrompu'); } };
        }
        dispose() { sonDisposed = true; }
      }
    };
    try {
      await assemblerParties({ nom: 'P' }, 2, () => {}, { faites: [true, true] });
    } catch (e) {}
    return sonDisposed;
  })()`);
  assert.equal(disposed, true);

  // 2. Ordre état-avant-removeEntry dans la boucle d'assemblage
  const trace = [];
  opfs.files.set('omnivideo-son.mp4', new Uint8Array([1, 2]));
  opfs.files.set('omnivideo-partie-0.mp4', new Uint8Array([3, 4]));
  opfs.files.set('omnivideo-partie-1.mp4', new Uint8Array([5, 6]));
  const origRemove = opfs.removeEntry.bind(opfs);
  opfs.removeEntry = async (name) => {
    if (name.startsWith('omnivideo-partie-')) trace.push('remove:' + name);
    return origRemove(name);
  };
  ctx._trace = trace;

  await lireSymbole(ctx, `(async () => {
    const origSetItem = localStorage.setItem;
    localStorage.setItem = (k, v) => {
      if (k === CLE_REPRISE) {
        const etat = JSON.parse(v);
        _trace.push('state:' + etat.faites.join(','));
      }
      return origSetItem.call(localStorage, k, v);
    };
    Mediabunny = {
      ALL_FORMATS: [],
      BlobSource: class {},
      Input: class {
        async getPrimaryAudioTrack() { return { getDecoderConfig: async () => ({ codec: 'aac' }) }; }
        async getPrimaryVideoTrack() { return { getDecoderConfig: async () => ({ codec: 'avc', codedWidth: 1280, codedHeight: 720, description: new Uint8Array([1]) }) }; }
        dispose() {}
      },
      EncodedPacketSink: class {
        packets() {
          return {
            async next() { return { done: true }; },
            async return() {},
            [Symbol.asyncIterator]() { return this; }
          };
        }
      },
      Output: class {
        constructor() { this.state = 'pending'; }
        addVideoTrack() {}
        addAudioTrack() {}
        setMetadataTags() {}
        async start() {}
        async finalize() { this.state = 'finalized'; }
      },
      Mp4OutputFormat: class {},
      StreamTarget: class {},
      EncodedVideoPacketSource: class {},
      EncodedAudioPacketSource: class {}
    };
    await assemblerParties({ nom: 'P' }, 2, () => {}, { faites: [true, true] });
  })()`);

  const idxState0 = trace.indexOf('state:false,true');
  const idxRem0 = trace.indexOf('remove:omnivideo-partie-0.mp4');
  assert.ok(idxState0 >= 0 && idxRem0 > idxState0, `État doit être écrit avant removeEntry (${JSON.stringify(trace)})`);
});

test('Reprise.effacer supprime les morceaux orphelins même avec des trous et sans état', async () => {
  const opfs = new MockOPFS();
  opfs.files.set('omnivideo-son.mp4', new Uint8Array([1]));
  opfs.files.set('omnivideo-partie-2.mp4', new Uint8Array([2]));
  opfs.files.set('omnivideo-partie-5.mp4', new Uint8Array([3]));
  opfs.files.set('autre-app-fichier.txt', new Uint8Array([9]));

  const ctx = creerContextReprise(opfs);
  await lireSymbole(ctx, 'Reprise.effacer()');

  assert.equal(opfs.files.has('omnivideo-son.mp4'), false);
  assert.equal(opfs.files.has('omnivideo-partie-2.mp4'), false);
  assert.equal(opfs.files.has('omnivideo-partie-5.mp4'), false);
  assert.equal(opfs.files.has('autre-app-fichier.txt'), true, 'Ne jamais supprimer les fichiers d autres applications');
});

test('Export._probleme crédite les fichiers de reprise récupérables et calcule le pic segmenté', async () => {
  const opfs = new MockOPFS();
  const taillesSimulees = new Map([
    ['omnivideo-son.mp4', 50 * 1024 * 1024],
    ['omnivideo-partie-0.mp4', 100 * 1024 * 1024]
  ]);
  opfs.files.set('omnivideo-son.mp4', new Uint8Array([1]));
  opfs.files.set('omnivideo-partie-0.mp4', new Uint8Array([1]));
  const origGetFileHandle = opfs.getFileHandle.bind(opfs);
  opfs.getFileHandle = async (name, opts) => {
    const h = await origGetFileHandle(name, opts);
    if (taillesSimulees.has(name)) {
      const sz = taillesSimulees.get(name);
      h.getFile = async () => ({ size: sz });
    }
    return h;
  };

  const ctx = creerContexteReprise(opfs);
  const msg = await lireSymbole(ctx, `(async () => {
    Medias = { manquantes: () => [] };
    // Vidéo courte de 100 s (~100 Mo en 1080p) : quota=300 Mo, usage=220 Mo -> brut 80 Mo, +150 Mo récupérables = 230 Mo
    navigator.storage.estimate = async () => ({ quota: 300 * 1024 * 1024, usage: 220 * 1024 * 1024 });
    Projets = { courant: { id: 'p1', clips: [{ id: 'c1', debut: 0, fin: 100 }], medias: [] } };
    Montage.segments = () => [{ debut: 0, fin: 100 }];
    Capacites = { resultat: { peutExporter: true } };
    return await Export._probleme('1080p');
  })()`);

  assert.equal(msg, '', 'Les fichiers Reprise récupérables doivent être crédités au quota libre');
});
