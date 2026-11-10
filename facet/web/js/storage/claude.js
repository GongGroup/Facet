/**
 * "Claude cloud": per-user private project storage when Facet runs as a claude.ai artifact.
 * Layout (artifact db): data/users/<uid>/<projectId>                   — summary document {…, nChunks, gen}
 *                       data/users/<uid>/<projectId>/chunks/g<gen>c<n>  — the project JSON in pieces whose stored
 *                                                                          document stays under the 256 KiB db limit
 * Saves are crash-safe: a new generation of chunks is written first and the summary is switched to it
 * only after every chunk succeeded, so an interrupted save leaves the previous version readable.
 * Projects saved before generations existed (chunks c0..cn, no `gen`) still open.
 */
import { summarize, storable, upgradeSummary } from './index.js';

const CHUNK = 180 * 1024;      // characters tried per piece …
const MAX_DOC = 240 * 1024;    // … shrunk until the stored document {s} is at most this many UTF-8 bytes (db limit: 256 KiB)
const chunkId = (gen, i) => (gen ? `g${gen}c${i}` : `c${i}`);

/**
 * Split the project JSON into pieces by their stored size: quotes and backslashes are escaped again inside
 * {s: "…"} (one-letter element symbols nearly double), and non-ASCII text takes up to 3 bytes per character.
 * Never cuts a surrogate pair in two.
 */
export function splitChunks(json, maxBytes = MAX_DOC, chunk = CHUNK) {
  const enc = new TextEncoder();
  const out = [];
  let i = 0;
  while (i < json.length) {
    let len = Math.min(chunk, json.length - i);
    for (;;) {
      let end = i + len;
      const c = json.charCodeAt(end - 1);
      if (end < json.length && c >= 0xd800 && c <= 0xdbff && end - 1 > i) end--;
      const s = json.slice(i, end);
      const size = enc.encode(JSON.stringify({ s })).length;
      if (size <= maxBytes || len <= 64) { out.push(s); i = end; break; }
      len = Math.max(64, Math.floor(len * (maxBytes / size) * 0.97));
    }
  }
  return out.length ? out : [''];
}

export class ClaudeCloudStore {
  id = 'claude';
  label = 'Claude cloud';
  icon = 'cloud';
  where = 'in Claude cloud';
  description = 'Private to your claude.ai account and kept with this app. Available wherever you open it.';
  db = null; uid = null;
  _queues = new Map(); // project id -> tail of its save chain

  async init() {
    if (typeof window.claude?.use !== 'function') return false;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return false;
      const uid = await user.id();
      if (!uid) return false;
      this.db = db; this.uid = uid;
      return true;
    } catch { return false; }
  }
  async available() { return !!(this.db && this.uid); }

  col() { return this.db.collection(`data/users/${this.uid}`); }
  chunks(id) { return this.col().doc(id).collection('chunks'); }

  async list() {
    const snap = await this.col().get();
    // rows saved by older versions get today's formula order (rewritten for good on their next save)
    const rows = snap.docs.filter((d) => d.exists && d.data()?.kind === 'project').map((d) => upgradeSummary({ ...d.data(), id: d.id }));
    // older multi-structure rows only describe the active structure: rebuild them once from the full document
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      if (!(r.nStructures > 1) || Array.isArray(r.formulas)) continue;
      try {
        const doc = await this.get(r.id);
        const raw = (await this.col().doc(r.id).get()).data();
        const fresh = { ...raw, ...summarize(doc, raw.size), kind: 'project', thumbnail: raw.thumbnail ?? null };
        await this.col().doc(r.id).set(fresh);
        rows[k] = { ...fresh, id: r.id };
      } catch { /* best effort: the row is complete after the project's next save */ }
    }
    return rows.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    const meta = await this.col().doc(id).get();
    if (!meta.exists) throw Object.assign(new Error('That project was not found in your cloud space.'), { code: 'notfound' });
    const m = meta.data();
    const parts = [];
    for (let i = 0; i < m.nChunks; i++) {
      const c = await this.chunks(id).doc(chunkId(m.gen, i)).get();
      if (!c.exists) throw new Error('Part of this project is missing. Save it again to repair it.');
      parts.push(c.data().s);
    }
    return JSON.parse(parts.join(''));
  }

  /** Saves of the same project run one after another (a later save never interleaves with an earlier one). */
  save(project, opts = {}) {
    const id = project.location?.provider === this.id && project.location.id ? project.location.id : project.id;
    const prev = this._queues.get(id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this._save(project, id, opts));
    const tail = run.catch(() => {});
    this._queues.set(id, tail);
    tail.then(() => { if (this._queues.get(id) === tail) this._queues.delete(id); });
    return run;
  }

  async _save(project, id) {
    const doc = { ...storable(project), updated: new Date().toISOString(), id };
    const { thumbnail, ...body } = doc;
    const json = JSON.stringify(body);
    const parts = splitChunks(json);
    const n = parts.length;
    let old = null;
    try { const snap = await this.col().doc(id).get(); old = snap.exists ? snap.data() : null; } catch { /* treat as new */ }
    let gen = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    if (old?.gen === gen) gen += 'x';
    const chunks = this.chunks(id);
    try {
      for (let i = 0; i < n; i++) await withRetry(() => chunks.doc(chunkId(gen, i)).set({ s: parts[i] }));
    } catch (e) {
      for (let i = 0; i < n; i++) chunks.doc(chunkId(gen, i)).delete().catch(() => {}); // drop the half-written generation
      throw e;
    }
    const meta = { ...summarize(doc, json.length), kind: 'project', nChunks: n, gen, size: json.length, thumbnail: thumbnail?.length < 60000 ? thumbnail : null };
    await withRetry(() => this.col().doc(id).set(meta));
    // the new version is live; remove the previous generation (best effort)
    if (old?.nChunks) for (let i = 0; i < old.nChunks; i++) await chunks.doc(chunkId(old.gen, i)).delete().catch(() => {});
    return { ...doc, thumbnail };
  }

  async remove(id) {
    const m = await this.col().doc(id).get();
    const data = m.exists ? m.data() : {};
    await this.col().doc(id).delete();
    for (let i = 0; i < (data.nChunks ?? 0); i++) await this.chunks(id).doc(chunkId(data.gen, i)).delete().catch(() => {});
  }
}

async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code === 'unavailable') {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      try { return await fn(); } catch (e2) { e = e2; }
    }
    if (e?.code === 'quota_exceeded') throw new Error('Your cloud space is full. Delete a project and try again.');
    if (e?.code === 'unavailable') throw Object.assign(new Error('Claude cloud is not reachable right now. Your changes are kept here; try again in a moment.'), { code: 'offline' });
    throw new Error(e?.message || 'Saving to the cloud failed.');
  }
}
