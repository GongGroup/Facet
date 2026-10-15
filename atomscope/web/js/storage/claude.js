/**
 * "Claude cloud": per-user private project storage when AtomScope runs as a claude.ai artifact.
 * Layout (artifact db): data/users/<uid>/<projectId>               — summary document
 *                       data/users/<uid>/<projectId>/chunks/<n>    — the project JSON in ≤180 KB pieces
 */
import { summarize } from './index.js';

const CHUNK = 180 * 1024;

export class ClaudeCloudStore {
  id = 'claude';
  label = 'Claude cloud';
  icon = 'cloud';
  description = 'Private to your claude.ai account and kept with this app. Available wherever you open it.';
  db = null; uid = null;

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

  async list() {
    const snap = await this.col().get();
    return snap.docs.filter((d) => d.exists && d.data()?.kind === 'project').map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    const meta = await this.col().doc(id).get();
    if (!meta.exists) throw new Error('That project was not found in your cloud space.');
    const m = meta.data();
    const parts = [];
    for (let i = 0; i < m.nChunks; i++) {
      const c = await this.col().doc(id).collection('chunks').doc(`c${i}`).get();
      if (!c.exists) throw new Error('Part of this project is missing. Save it again to repair it.');
      parts.push(c.data().s);
    }
    return JSON.parse(parts.join(''));
  }

  async save(project) {
    const { location, ...rest } = project;
    const doc = { ...rest, updated: new Date().toISOString() };
    const id = project.location?.provider === this.id && project.location.id ? project.location.id : doc.id;
    doc.id = id;
    const { thumbnail, ...body } = doc;
    const json = JSON.stringify(body);
    const n = Math.ceil(json.length / CHUNK) || 1;
    let prev = 0;
    try { const old = await this.col().doc(id).get(); prev = old.exists ? old.data().nChunks ?? 0 : 0; } catch { /* new */ }
    const chunks = this.col().doc(id).collection('chunks');
    for (let i = 0; i < n; i++) await withRetry(() => chunks.doc(`c${i}`).set({ s: json.slice(i * CHUNK, (i + 1) * CHUNK) }));
    for (let i = n; i < prev; i++) await chunks.doc(`c${i}`).delete();
    const meta = { ...summarize(doc), kind: 'project', nChunks: n, size: json.length, thumbnail: thumbnail?.length < 60000 ? thumbnail : null };
    await withRetry(() => this.col().doc(id).set(meta));
    return { ...doc, thumbnail };
  }

  async remove(id) {
    const m = await this.col().doc(id).get();
    const n = m.exists ? m.data().nChunks ?? 0 : 0;
    for (let i = 0; i < n; i++) await this.col().doc(id).collection('chunks').doc(`c${i}`).delete();
    await this.col().doc(id).delete();
  }
}

async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code === 'unavailable') { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
    if (e?.code === 'quota_exceeded') throw new Error('Your cloud space is full. Delete a project and try again.');
    throw new Error(e?.message || 'Saving to the cloud failed.');
  }
}
