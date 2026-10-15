/** Projects stored in this browser (IndexedDB). Falls back to memory when IndexedDB is blocked. */
import { summarize } from './index.js';

const DB = 'atomscope', VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

const tx = (db, stores, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(stores, mode);
  let out;
  t.oncomplete = () => resolve(out);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  out = fn(t);
});
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class BrowserStore {
  id = 'browser';
  label = 'This browser';
  icon = 'monitor';
  description = 'Saved in this browser on this device. Works offline; clearing site data removes it.';
  memory = null;

  async init() {
    try { this.db = await openDB(); } catch { this.memory = new Map(); }
    return true;
  }
  async available() { return true; }

  async list() {
    if (this.memory) return [...this.memory.values()].map((p) => summarize(p)).sort((a, b) => b.updated.localeCompare(a.updated));
    const rows = await tx(this.db, ['meta'], 'readonly', (t) => reqP(t.objectStore('meta').getAll()));
    const all = await rows;
    return all.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    if (this.memory) return structuredClone(this.memory.get(id));
    const p = await tx(this.db, ['projects'], 'readonly', (t) => reqP(t.objectStore('projects').get(id)));
    const doc = await p;
    if (!doc) throw new Error('That project no longer exists in this browser.');
    return doc;
  }

  async save(project) {
    const { location, ...rest } = project;
    const doc = { ...rest, updated: new Date().toISOString() };
    if (this.memory) { this.memory.set(doc.id, structuredClone(doc)); return doc; }
    await tx(this.db, ['projects', 'meta'], 'readwrite', (t) => {
      t.objectStore('projects').put(doc);
      t.objectStore('meta').put(summarize(doc));
    });
    return doc;
  }

  async remove(id) {
    if (this.memory) { this.memory.delete(id); return; }
    await tx(this.db, ['projects', 'meta'], 'readwrite', (t) => { t.objectStore('projects').delete(id); t.objectStore('meta').delete(id); });
  }

  async kvGet(key) { if (!this.db) return undefined; const r = await tx(this.db, ['kv'], 'readonly', (t) => reqP(t.objectStore('kv').get(key))); return r; }
  async kvSet(key, value) { if (!this.db) return; await tx(this.db, ['kv'], 'readwrite', (t) => { t.objectStore('kv').put(value, key); }); }
}
