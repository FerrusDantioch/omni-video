/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Harnais commun pour les tests unitaires Node (node:vm, sans dépendances). */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'node:test';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nettoyeursActifs = new Set();

afterEach(() => {
  for (const nettoyer of [...nettoyeursActifs]) {
    nettoyer();
  }
  nettoyeursActifs.clear();
});

export class MockOPFS {
  constructor() {
    this.files = new Map();
  }

  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) {
      if (!opts.create) {
        const err = new Error('Fichier introuvable : ' + name);
        err.name = 'NotFoundError';
        throw err;
      }
      this.files.set(name, new Uint8Array(0));
    }
    const self = this;
    return {
      kind: 'file',
      name,
      async getFile() {
        const bytes = self.files.get(name) || new Uint8Array(0);
        return new File([bytes], name);
      },
      async createSyncAccessHandle() {
        return {
          async truncate(size) {
            const prev = self.files.get(name) || new Uint8Array(0);
            const next = new Uint8Array(size);
            next.set(prev.subarray(0, Math.min(prev.length, size)));
            self.files.set(name, next);
          },
          async write(buf, { at = 0 } = {}) {
            const view = buf instanceof Uint8Array
              ? buf
              : ArrayBuffer.isView(buf)
                ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
                : new Uint8Array(buf);
            const prev = self.files.get(name) || new Uint8Array(0);
            const fin = at + view.length;
            if (fin > prev.length) {
              const next = new Uint8Array(fin);
              next.set(prev);
              next.set(view, at);
              self.files.set(name, next);
            } else {
              prev.set(view, at);
            }
          },
          async flush() {},
          async close() {}
        };
      }
    };
  }

  async removeEntry(name) {
    if (!this.files.has(name)) {
      const err = new Error('Introuvable : ' + name);
      err.name = 'NotFoundError';
      throw err;
    }
    this.files.delete(name);
  }

  async *entries() {
    for (const name of [...this.files.keys()]) {
      yield [name, await this.getFileHandle(name)];
    }
  }
}

export function creerMockWorkerClasse(opfs, options = {}) {
  const codeWorker = fs.readFileSync(path.join(RACINE, 'disque-prive.js'), 'utf8');
  return class MockWorker {
    constructor() {
      this.terminated = false;
      this.onmessage = null;
      this.onerror = null;
      const selfWorker = {
        onmessage: null,
        postMessage: (msg) => {
          if (this.terminated) return;
          queueMicrotask(() => {
            if (!this.terminated && this.onmessage) this.onmessage({ data: msg });
          });
        }
      };
      const workerCtx = vm.createContext({
        self: selfWorker,
        navigator: { storage: { getDirectory: async () => opfs } },
        Error, TypeError, Uint8Array, ArrayBuffer, DataView, Promise, console,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
      });
      vm.runInContext(codeWorker, workerCtx, { filename: 'disque-prive.js' });
      this._selfWorker = selfWorker;
      if (options.onCreate) options.onCreate(this);
    }

    postMessage(msg) {
      if (this.terminated) return;
      if (options.ignoreType && msg && msg.type === options.ignoreType) return;
      if (options.failOnType && msg && msg.type === options.failOnType) {
        queueMicrotask(() => {
          if (!this.terminated && this.onmessage) {
            this.onmessage({
              data: { n: msg.n, ok: false, nom: options.failName || 'QuotaExceededError', message: 'Quota dépassé' }
            });
          }
        });
        return;
      }
      queueMicrotask(() => {
        if (this.terminated || !this._selfWorker.onmessage) return;
        this._selfWorker.onmessage({ data: msg });
      });
    }

    terminate() {
      this.terminated = true;
    }
  };
}

export function creerEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = String(v); },
      removeProperty(k) { delete this._props[k]; }
    },
    dataset: {},
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach((c) => this._set.add(c)); },
      remove(...cs) { cs.forEach((c) => this._set.delete(c)); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c); else this._set.add(c);
          return this._set.has(c);
        }
        if (force) this._set.add(c); else this._set.delete(c);
        return !!force;
      },
      contains(c) { return this._set.has(c); }
    },
    attributes: new Map(),
    children: [],
    childNodes: [],
    hidden: false,
    disabled: false,
    checked: false,
    value: '',
    textContent: '',
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v);
      if (!v) { this.children = []; this.childNodes = []; }
    },
    width: 0,
    height: 0,
    clientWidth: 800,
    clientHeight: 450,
    scrollLeft: 0,
    scrollTop: 0,
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'class') {
        this.className = String(v);
        this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
      }
    },
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; },
    hasAttribute(k) { return this.attributes.has(k); },
    removeAttribute(k) { this.attributes.delete(k); },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) {
      if (!el._qs) el._qs = new Map();
      if (!el._qs.has(sel)) el._qs.set(sel, creerEl());
      return el._qs.get(sel);
    },
    querySelectorAll() { return []; },
    closest() { return creerEl(); },
    appendChild(c) {
      if (c && c._isFrag) {
        for (const sub of c.childNodes) {
          this.childNodes.push(sub);
          if (sub.nodeType === 1) this.children.push(sub);
        }
        c.childNodes = [];
        c.children = [];
        return c;
      }
      this.childNodes.push(c);
      if (c && c.nodeType === 1) this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.childNodes = this.childNodes.filter((x) => x !== c);
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.childNodes = [];
      for (const n of nodes) this.appendChild(n);
    },
    remove() {},
    click() {},
    focus() {},
    select() {},
    scrollIntoView() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    getContext() {
      return {
        save() {}, restore() {}, clearRect() {}, fillRect() {}, drawImage() {},
        beginPath() {}, roundRect() {}, fill() {}, strokeRect() {},
        strokeText() {}, fillText() {}, setLineDash() {}, translate() {}, scale() {},
        filter: '',
        measureText: (s) => ({ width: String(s).length * 10 })
      };
    },
    toBlob(cb, type) { cb(new Blob(['img'], { type: type || 'image/png' })); },
    toDataURL(type) { return `data:${type || 'image/png'};base64,AAAA`; }
  };
  return el;
}

export function creerContexte(overrides = {}) {
  const timers = new Map();
  const intervals = new Map();
  let nextTimerId = 1;
  const scheduledTimers = [];
  const storageData = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const addEvt = (map) => (type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const elements = new Map();
  const createdCanvases = [];
  const createdUrls = [];
  const revokedUrls = [];
  let urlCounter = 1;

  const ctx = {
    console,
    Math, Date, Number, String, Boolean, Array, Object, Map, Set,
    Promise, Error, TypeError, RangeError, JSON, RegExp, WebAssembly,
    Uint8Array, Int16Array, Float32Array, Float64Array, Uint32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, Blob, File, WritableStream, ReadableStream,
    URL: {
      createObjectURL: (blob) => {
        const u = 'blob:mock/' + (urlCounter++);
        createdUrls.push({ url: u, blob });
        return u;
      },
      revokeObjectURL: (u) => {
        revokedUrls.push(u);
      }
    },
    performance: { now: () => Date.now() },
    isSecureContext: true,
    location: { hash: '', pathname: '/omni-video/', search: '', reload() {} },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    scrollTo() {},
    CSS: { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1') },
    localStorage: {
      getItem: (k) => (storageData.has(k) ? storageData.get(k) : null),
      setItem: (k, v) => { storageData.set(k, String(v)); },
      removeItem: (k) => { storageData.delete(k); },
      clear: () => storageData.clear()
    },
    navigator: {
      userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      hardwareConcurrency: 4,
      deviceMemory: 4,
      storage: {
        estimate: async () => ({ quota: 1e9, usage: 1e6 }),
        persisted: async () => false,
        persist: async () => true
      }
    },
    document: {
      body: creerEl('body'),
      head: creerEl('head'),
      visibilityState: 'visible',
      fonts: { load: async () => [] },
      getElementById: (id) => elements.get('#' + id) || null,
      querySelector: (sel) => {
        if (!elements.has(sel)) elements.set(sel, creerEl());
        return elements.get(sel);
      },
      querySelectorAll: () => [],
      createElement: (tag) => {
        const el = creerEl(tag);
        if (String(tag).toLowerCase() === 'canvas') createdCanvases.push(el);
        return el;
      },
      createElementNS: (_ns, tag) => creerEl(tag),
      createTextNode: (txt) => ({ nodeType: 3, textContent: String(txt) }),
      createDocumentFragment: () => {
        const frag = {
          _isFrag: true,
          children: [],
          childNodes: [],
          appendChild(c) {
            if (c && c._isFrag) {
              for (const sub of c.childNodes) {
                this.childNodes.push(sub);
                if (sub.nodeType === 1) this.children.push(sub);
              }
              c.childNodes = [];
              c.children = [];
              return c;
            }
            this.childNodes.push(c);
            if (c && c.nodeType === 1) this.children.push(c);
            return c;
          }
        };
        return frag;
      },
      addEventListener: addEvt(listeners.document)
    },
    addEventListener: addEvt(listeners.window),
    setTimeout: (fn, ms, ...args) => {
      const id = nextTimerId++;
      scheduledTimers.push({ id, ms, fn });
      const handle = globalThis.setTimeout(() => { timers.delete(id); fn(...args); }, ms);
      timers.set(id, handle);
      return id;
    },
    clearTimeout: (id) => {
      const h = timers.get(id);
      if (h) { globalThis.clearTimeout(h); timers.delete(id); }
    },
    setInterval: (fn, ms, ...args) => {
      const id = nextTimerId++;
      const handle = globalThis.setInterval(fn, ms, ...args);
      intervals.set(id, handle);
      return id;
    },
    clearInterval: (id) => {
      const h = intervals.get(id);
      if (h) { globalThis.clearInterval(h); intervals.delete(id); }
    },
    requestAnimationFrame: (fn) => ctx.setTimeout(() => fn(Date.now()), 0),
    ResizeObserver: class { observe() {} disconnect() {} },
    ...overrides
  };

  const nettoyerMinuteurs = () => {
    for (const h of timers.values()) globalThis.clearTimeout(h);
    timers.clear();
    for (const h of intervals.values()) globalThis.clearInterval(h);
    intervals.clear();
  };

  ctx.window = ctx;
  ctx.self = ctx;
  ctx._testElements = elements;
  ctx._createdCanvases = createdCanvases;
  ctx._storageData = storageData;
  ctx._scheduledTimers = scheduledTimers;
  ctx._createdUrls = createdUrls;
  ctx._revokedUrls = revokedUrls;
  ctx._nettoyerMinuteurs = nettoyerMinuteurs;
  nettoyeursActifs.add(nettoyerMinuteurs);
  return vm.createContext(ctx);
}

export function chargerScripts(ctx, fichiers) {
  for (const f of fichiers) {
    const code = fs.readFileSync(path.join(RACINE, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
}

export function lireSymbole(ctx, expr) {
  return vm.runInContext(expr, ctx);
}
