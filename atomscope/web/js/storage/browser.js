/**
 * Projects stored in this browser (IndexedDB). When the browser blocks IndexedDB (private modes,
 * strict settings) projects live in memory for this tab only — `memory` is true and the label says so.
 */
import { summarize, conflictError, storable } from './index.js';

const DB = 'atomscope', VERSION = 1;
const MISSING = 'That project no longer exists in this browser.';

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
const friendly = (e) => (e?.name === 'QuotaExceededError'
  ? new Error('Browser storage is full. Delete projects you no longer need, or download this one.') : e);

export class BrowserStore {
  id = 'browser';
  icon = 'monitor';
  /** True when IndexedDB is unavailable and projects only last until this tab closes. */
  memory = false;
  _mem = null;
  _versions = new Map(); // id -> `updated` of the copy this tab last loaded or saved

  get label() { return this.memory ? 'This session only' : 'This browser'; }
  get description() {
    return this.memory
      ? 'Your browser blocked storage; projects are lost when you close this tab. Download the project or use another location.'
      : 'Saved in this browser on this device. Works offline; clearing site data removes it.';
  }
  get where() { return this.memory ? 'in this tab only' : 'in this browser'; }

  async init() {
    try { this.db = await openDB(); } catch { this.db = null; this._mem = new Map(); this.memory = true; }
    return true;
  }
  async available() { return true; }

  async list() {
    if (this.memory) return [...this._mem.values()].map((p) => summarize(p)).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
    const all = await tx(this.db, ['meta'], 'readonly', (t) => reqP(t.objectStore('meta').getAll()));
    let rows = await all;
    // summaries written by older versions (alphabetical formula, no `formulas`): rebuilt once from the projects
    const stale = rows.filter((m) => !Array.isArray(m.formulas));
    if (stale.length) {
      try {
        const fixed = await tx(this.db, ['projects', 'meta'], 'readwrite', (t) => {
          const out = new Map();
          for (const m of stale) {
            const r = t.objectStore('projects').get(m.id);
            r.onsuccess = () => {
              const doc = r.result;
              if (!doc?.id) return;
              let size = m.size;
              if (size == null) { try { size = JSON.stringify(doc).length; } catch { /* unknown */ } }
              const sum = summarize(doc, size);
              t.objectStore('meta').put(sum);
              out.set(m.id, sum);
            };
          }
          return out;
        });
        rows = rows.map((m) => fixed.get(m.id) ?? m);
      } catch { /* keep the old summaries */ }
    }
    return rows.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    let doc;
    if (this.memory) doc = this._mem.has(id) ? structuredClone(this._mem.get(id)) : null;
    else doc = await (await tx(this.db, ['projects'], 'readonly', (t) => reqP(t.objectStore('projects').get(id))));
    if (!doc) throw Object.assign(new Error(MISSING), { code: 'notfound' });
    this._versions.set(id, doc.updated);
    return doc;
  }

  /** Stored `updated` of a project, or undefined. */
  async _storedUpdated(id) {
    if (this.memory) return this._mem.get(id)?.updated;
    const m = await (await tx(this.db, ['meta'], 'readonly', (t) => reqP(t.objectStore('meta').get(id))));
    return m?.updated;
  }

  /**
   * Save a project. When it is an update of a project loaded from here and another tab saved a newer
   * copy in the meantime, rejects with code 'conflict' unless opts.force is set.
   */
  async save(project, opts = {}) {
    const doc = { ...storable(project), updated: new Date().toISOString() };
    if (!opts.force && project.location?.provider === this.id) {
      // the version the edited copy was loaded from; a later read (Duplicate, Download) must not move it forward
      const base = project.baseUpdated ?? opts.baseUpdated ?? this._versions.get(doc.id);
      const stored = base ? await this._storedUpdated(doc.id) : undefined;
      if (stored && stored > base) throw conflictError('This project was changed in another tab since you opened it.');
    }
    if (this.memory) { this._mem.set(doc.id, structuredClone(doc)); this._versions.set(doc.id, doc.updated); return doc; }
    let size;
    try { size = JSON.stringify(doc).length; } catch { size = undefined; }
    try {
      await tx(this.db, ['projects', 'meta'], 'readwrite', (t) => {
        t.objectStore('projects').put(doc);
        t.objectStore('meta').put(summarize(doc, size));
      });
    } catch (e) { throw friendly(e); }
    this._versions.set(doc.id, doc.updated);
    return doc;
  }

  async remove(id) {
    this._versions.delete(id);
    if (this.memory) { this._mem.delete(id); return; }
    await tx(this.db, ['projects', 'meta'], 'readwrite', (t) => { t.objectStore('projects').delete(id); t.objectStore('meta').delete(id); });
  }

  async kvGet(key) { if (!this.db) return undefined; const r = await tx(this.db, ['kv'], 'readonly', (t) => reqP(t.objectStore('kv').get(key))); return r; }
  async kvSet(key, value) { if (!this.db) return; await tx(this.db, ['kv'], 'readwrite', (t) => { t.objectStore('kv').put(value, key); }); }
}
