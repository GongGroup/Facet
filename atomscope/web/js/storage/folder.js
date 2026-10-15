/**
 * Local folder: projects are `*.atomscope.json` files in a folder you pick on your computer
 * (File System Access API — Chromium browsers). The folder handle is remembered between visits.
 */
import { summarize } from './index.js';
import { slug } from './files.js';

export class FolderStore {
  id = 'folder';
  label = 'Local folder';
  icon = 'folder';
  description = 'Projects are .atomscope.json files in a folder on your computer — easy to back up, sync or put under version control.';
  handle = null;

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

  async connect() {
    this.handle = await window.showDirectoryPicker({ id: 'atomscope-projects', mode: 'readwrite' });
    await this.kv?.kvSet('folderHandle', this.handle);
    return this.handle.name;
  }

  async ensurePermission() {
    if (!this.handle) throw Object.assign(new Error('Choose a folder first.'), { code: 'nofolder' });
    const opts = { mode: 'readwrite' };
    if ((await this.handle.queryPermission(opts)) === 'granted') return true;
    if ((await this.handle.requestPermission(opts)) === 'granted') return true;
    throw new Error('Permission to use the folder was not granted.');
  }

  async list() {
    await this.ensurePermission();
    const out = [];
    for await (const [name, entry] of this.handle.entries()) {
      if (entry.kind !== 'file' || !name.endsWith('.atomscope.json')) continue;
      try {
        const f = await entry.getFile();
        const doc = JSON.parse(await f.text());
        out.push({ ...summarize(doc), id: name, file: name, size: f.size, updated: doc.updated ?? new Date(f.lastModified).toISOString() });
      } catch { out.push({ id: name, name: name.replace('.atomscope.json', ''), file: name, broken: true, updated: '' }); }
    }
    return out.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  async get(id) {
    await this.ensurePermission();
    const fh = await this.handle.getFileHandle(id);
    const doc = JSON.parse(await (await fh.getFile()).text());
    return doc;
  }

  async save(project) {
    await this.ensurePermission();
    const { location, ...rest } = project;
    const doc = { ...rest, updated: new Date().toISOString() };
    const file = project.location?.provider === this.id && project.location.id ? project.location.id : `${slug(doc.name)}.atomscope.json`;
    const fh = await this.handle.getFileHandle(file, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(doc, null, 1));
    await w.close();
    return { ...doc, __locationId: file };
  }

  async remove(id) {
    await this.ensurePermission();
    await this.handle.removeEntry(id);
  }
}
