/**
 * Local folder: projects are `*.atomscope.json` files in a folder you pick on your computer
 * (File System Access API — Chromium browsers). The folder handle is remembered between visits.
 * A new project never overwrites another project's file (a free name is chosen), and saving a file
 * that changed on disk since it was opened rejects with code 'conflict' unless {force: true}.
 */
import { summarize, conflictError, storable } from './index.js';
import { slug } from './files.js';

const EXT = '.atomscope.json';

export class FolderStore {
  id = 'folder';
  label = 'Local folder';
  icon = 'folder';
  description = 'Projects are .atomscope.json files in a folder on your computer — easy to back up, sync or put under version control.';
  handle = null;
  _seen = new Map(); // file name -> lastModified when this tab last read or wrote it

  constructor(kv) { this.kv = kv; }

  supported() {
    if (typeof window.showDirectoryPicker !== 'function') return false;
    try { return window.self === window.top; } catch { return false; }
  }

  async init() {
    if (!this.supported()) return false;
    try {
      const h = await this.kv?.kvGet('folderHandle');
      if (h) this.handle = h;
    } catch { /* ignore */ }
    return true;
  }
  async available() { return this.supported(); }
  get connected() { return !!this.handle; }
  get folderName() { return this.handle?.name ?? null; }
  get where() { return this.folderName ? `in folder ${this.folderName}` : 'in a folder on this computer'; }

  async connect() {
    this.handle = await window.showDirectoryPicker({ id: 'atomscope-projects', mode: 'readwrite' });
    this._seen.clear();
    await this.kv?.kvSet('folderHandle', this.handle);
    return this.handle.name;
  }

  async ensurePermission() {
    if (!this.handle) throw Object.assign(new Error('Choose a folder first.'), { code: 'nofolder' });
    const opts = { mode: 'readwrite' };
    if (typeof this.handle.queryPermission !== 'function') return true;
    if ((await this.handle.queryPermission(opts)) === 'granted') return true;
    if ((await this.handle.requestPermission(opts)) === 'granted') return true;
    throw new Error('Permission to use the folder was not granted.');
  }

  async list() {
    await this.ensurePermission();
    const out = [];
    for await (const [name, entry] of this.handle.entries()) {
      if (entry.kind !== 'file' || !name.endsWith(EXT)) continue;
      try {
        const f = await entry.getFile();
        const doc = JSON.parse(await f.text());
        out.push({ ...summarize(doc, f.size), id: name, file: name, size: f.size, updated: doc.updated ?? new Date(f.lastModified).toISOString() });
      } catch { out.push({ id: name, name: name.replace(EXT, ''), file: name, broken: true, updated: '' }); }
    }
    return out.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    await this.ensurePermission();
    let fh;
    try { fh = await this.handle.getFileHandle(id); }
    catch (e) { if (e?.name === 'NotFoundError') throw Object.assign(new Error(`${id} is no longer in the folder.`), { code: 'notfound' }); throw e; }
    const f = await fh.getFile();
    const doc = JSON.parse(await f.text());
    this._seen.set(id, f.lastModified);
    return doc;
  }

  /** The file (if any) named `name`: {file, doc?} or null when it does not exist. */
  async _peek(name) {
    let fh;
    try { fh = await this.handle.getFileHandle(name); }
    catch (e) { if (e?.name === 'NotFoundError' || e?.name === 'TypeError') return null; throw e; }
    const file = await fh.getFile();
    let doc = null;
    try { doc = JSON.parse(await file.text()); } catch { /* not a project: still occupied */ }
    return { file, doc };
  }

  /** A file name for `doc` that no other project uses: name.atomscope.json, name-2…, then name-<id>. */
  async _freeName(doc) {
    const base = slug(doc.name);
    for (let k = 1; k <= 50; k++) {
      const name = `${base}${k > 1 ? `-${k}` : ''}${EXT}`;
      const hit = await this._peek(name);
      if (!hit || hit.doc?.id === doc.id) return name;
    }
    return `${base}-${String(doc.id ?? Date.now().toString(36)).slice(-6)}${EXT}`;
  }

  async save(project, opts = {}) {
    await this.ensurePermission();
    const doc = { ...storable(project), updated: new Date().toISOString() };
    let file = project.location?.provider === this.id && project.location.id ? project.location.id : null;
    if (file) {
      const hit = await this._peek(file);
      if (hit?.doc && hit.doc.id && doc.id && hit.doc.id !== doc.id) file = null; // the name now belongs to another project
      else if (hit && !opts.force) {
        const seen = this._seen.get(file);
        const base = project.baseUpdated ?? opts.baseUpdated;
        // newer than the copy being edited (another tab saved it; also after a later read such as Duplicate
        // refreshed `seen`), or touched on disk since this tab last read or wrote it
        const changed = !!(base && hit.doc?.updated && hit.doc.updated > base) || (seen != null && hit.file.lastModified !== seen);
        if (changed) throw conflictError(`${file} changed on disk since you opened it.`);
      }
    }
    if (!file) file = await this._freeName(doc);
    const fh = await this.handle.getFileHandle(file, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(doc, null, 1));
    await w.close();
    try { this._seen.set(file, (await fh.getFile()).lastModified); } catch { this._seen.delete(file); }
    return { ...doc, __locationId: file };
  }

  async remove(id) {
    await this.ensurePermission();
    await this.handle.removeEntry(id);
    this._seen.delete(id);
  }
}
