/**
 * App controller: owns the project, the active structure, scene settings, history, storage and the
 * viewer, and exposes the actions that the UI, the command palette, shortcuts and plugins call.
 */
import { Emitter } from './core/events.js';
import { Structure } from './core/structure.js';
import { uid, deepClone, deepMerge, setPath, getPath, debounce } from './core/util.js';
import { parseStructure, exportStructure, formats, detectFormat } from './io/index.js';
import { samples } from './build/samples.js';
import { Viewer } from './render/viewer.js';
import { makeScene } from './render/settings.js';
import { looks } from './render/looks.js';
import { styles } from './render/styles.js';
import { presetToSettings } from './render/lighting.js';
import { StorageManager } from './storage/index.js';
import { BrowserStore } from './storage/browser.js';
import { ServerStore } from './storage/server.js';
import { ClaudeCloudStore } from './storage/claude.js';
import { FolderStore } from './storage/folder.js';
import { saveFile, readText, slug, isArtifact } from './storage/files.js';
import { toast } from './ui/overlays.js';
import { makeZip } from './core/zip.js';

export const VERSION = '0.1.0';
const PREF_KEY = 'atomscope.prefs';

export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; } }
export function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

export class App extends Emitter {
  constructor(viewportEl) {
    super();
    this.prefs = loadPrefs();
    this.viewer = new Viewer(viewportEl);
    this.storage = new StorageManager();
    this.browserStore = new BrowserStore();
    this.serverStore = new ServerStore('');
    this.claudeStore = new ClaudeCloudStore();
    this.folderStore = new FolderStore(this.browserStore);
    this.project = this._blankProject();
    this.structure = null;
    this.dirty = false;
    this.saveState = 'idle';
    this.tool = 'select';
    this.measureType = 'distance';
    this.measurePicks = [];
    this.undoStack = []; this.redoStack = [];
    this._sceneBefore = null;
    this._commitScene = debounce(() => this._pushSceneHistory(), 650);
    this._autosave = debounce(() => this.autosave(), 2500);
    this.viewer.on('atomclick', (e) => this._onAtomClick(e));
    this.viewer.on('error', (e) => toast(e.message, { type: 'error' }));
    this.viewer.on('camera', debounce(() => { if (this.structure) this.project.scene.camera = this.viewer.getCameraState(); }, 400));
  }

  async init() {
    await this.browserStore.init();
    this.storage.register(this.browserStore);
    const hasServer = await this.serverStore.probe();
    if (hasServer) this.storage.register(this.serverStore);
    if (await this.claudeStore.init()) this.storage.register(this.claudeStore);
    if (await this.folderStore.init()) this.storage.register(this.folderStore);
    this.defaultProvider = hasServer && this.serverStore.info.mode === 'local' ? 'server' : 'browser';
    this.emit('providers');
  }

  // ------------------------------------------------------------------ project model
  _blankProject(name = 'Untitled project') {
    const scene = makeScene();
    const t = document.documentElement.dataset.theme;
    const dark = t ? t === 'dark' : matchMedia?.('(prefers-color-scheme: dark)').matches;
    if (dark) { deepMerge(scene, deepClone(looks.get('dark').scene)); scene.look = 'dark'; }
    return { id: uid('p'), name, description: '', tags: [], created: new Date().toISOString(), updated: null, structures: [], activeStructure: null, scene, location: null, thumbnail: null };
  }

  get scene() { return this.project.scene; }
  get pristine() { return !this.project.location && !this.dirty; }

  projectToJSON({ thumbnail = true } = {}) {
    const p = this.project;
    if (this.structure) p.scene.camera = this.viewer.getCameraState();
    return {
      schema: 'atomscope.project/1', id: p.id, name: p.name, description: p.description, tags: p.tags, created: p.created, updated: p.updated ?? p.created,
      thumbnail: thumbnail && this.structure ? this.viewer.thumbnail() : p.thumbnail,
      activeStructure: p.activeStructure,
      structures: p.structures.map((s) => ({ id: s.id, name: s.name, structure: s.structure.toJSON() })),
      scene: deepClone(p.scene),
    };
  }

  loadProjectJSON(doc, location = null) {
    if (!doc || !Array.isArray(doc.structures)) throw new Error('This file is not an AtomScope project.');
    const p = {
      id: doc.id ?? uid('p'), name: doc.name ?? 'Untitled project', description: doc.description ?? '', tags: doc.tags ?? [], created: doc.created ?? new Date().toISOString(), updated: doc.updated ?? null,
      structures: doc.structures.map((s) => ({ id: s.id ?? uid('s'), name: s.name ?? s.structure?.name ?? 'Structure', structure: Structure.fromJSON(s.structure) })),
      activeStructure: doc.activeStructure, scene: makeScene(doc.scene), location, thumbnail: doc.thumbnail ?? null,
    };
    if (!p.structures.find((s) => s.id === p.activeStructure)) p.activeStructure = p.structures[0]?.id ?? null;
    this.project = p;
    this.undoStack = []; this.redoStack = [];
    this.dirty = false;
    this._activate(p.activeStructure, { camera: doc.scene?.camera });
    this.setSaveState(location ? 'saved' : 'idle');
    this.emit('project');
  }

  _activate(sid, { camera = null, resetCamera = true } = {}) {
    const entry = this.project.structures.find((s) => s.id === sid);
    this.project.activeStructure = entry?.id ?? null;
    this.structure = entry?.structure ?? null;
    this.measurePicks = [];
    this.viewer.applySettings(this.scene, { force: true });
    if (this.structure) {
      this.viewer.setStructure(this.structure, { resetCamera: resetCamera && !camera });
      if (camera) this.viewer.setCameraState(camera);
    } else {
      this.viewer.structure = null;
      this.viewer.model = null;
      this.viewer._disposeObject(this.viewer.rep); this.viewer.rep = null;
      this.viewer._disposeObject(this.viewer.cellObj); this.viewer.cellObj = null;
      this.viewer.requestRender();
    }
    this.emit('structure');
    this.emit('selection');
  }

  setActiveStructure(sid) { this._activate(sid); this.markDirty(); }

  /** Add a structure to the project (or replace the scratch project's content). */
  addStructure(structure, { look = null, scene = null, newProject = false, name = null } = {}) {
    if (newProject || this.pristine) {
      const keepScene = this.project.scene;
      this.project = this._blankProject(name ?? structure.name ?? 'Untitled project');
      if (!newProject) this.project.scene = keepScene;
      this.undoStack = []; this.redoStack = [];
    } else this._pushStructureHistory();
    const entry = { id: uid('s'), name: structure.name, structure };
    this.project.structures.push(entry);
    if (look) this.applyLook(look, { silent: true });
    if (scene) deepMerge(this.project.scene, deepClone(scene));
    this._activate(entry.id);
    this.markDirty();
    this.emit('project');
    return entry;
  }

  removeStructure(sid) {
    this._pushStructureHistory();
    const i = this.project.structures.findIndex((s) => s.id === sid);
    if (i < 0) return;
    this.project.structures.splice(i, 1);
    if (this.project.activeStructure === sid) this._activate(this.project.structures[Math.max(0, i - 1)]?.id ?? null);
    this.markDirty();
    this.emit('project');
  }

  renameStructure(sid, name) {
    const e = this.project.structures.find((s) => s.id === sid);
    if (!e) return;
    e.name = name; e.structure.name = name;
    this.markDirty();
    this.emit('project'); this.emit('structure');
  }

  newProject() {
    this.project = this._blankProject();
    this.dirty = false;
    this.undoStack = []; this.redoStack = [];
    this._activate(null);
    this.setSaveState('idle');
    this.emit('project');
  }

  rename(name) { this.project.name = name || 'Untitled project'; this.markDirty(); this.emit('project'); }

  markDirty() {
    this.dirty = true;
    this.setSaveState('dirty');
    if (this.prefs.autosave !== false) this._autosave();
  }

  setSaveState(s, detail = '') { this.saveState = s; this.saveDetail = detail; this.emit('saveState', s); }

  // ------------------------------------------------------------------ scene settings
  /** Set one scene value by dotted path, e.g. set('post.ao.intensity', 1.2). */
  set(path, value) {
    if (this._sceneBefore == null) this._sceneBefore = JSON.stringify(this.scene);
    setPath(this.scene, path, value);
    if (path.startsWith('style.') || path.startsWith('lighting.') || path.startsWith('post.') || path.startsWith('display.background')) this.scene.look = null;
    this._sceneChanged();
  }
  get(path) { return getPath(this.scene, path); }

  /** Deep-merge a partial scene. */
  patch(partial, { history = true } = {}) {
    if (history && this._sceneBefore == null) this._sceneBefore = JSON.stringify(this.scene);
    deepMerge(this.scene, deepClone(partial));
    this._sceneChanged(history);
  }

  _sceneChanged(history = true) {
    this.viewer.applySettings(this.scene);
    if (history) this._commitScene();
    this.markDirty();
    this.emit('scene');
  }

  applyLook(id, { silent = false } = {}) {
    const l = looks.get(id);
    if (!l) return;
    if (!silent && this._sceneBefore == null) this._sceneBefore = JSON.stringify(this.scene);
    const partial = deepClone(l.scene);
    deepMerge(this.scene, partial);
    this.scene.look = id;
    if (silent) { this.viewer.applySettings(this.scene); this.emit('scene'); return; }
    this._sceneChanged();
  }

  setRepresentation(id) {
    const s = styles.get(id);
    if (!s) return;
    this.patch({ style: { rep: id, ...s.defaults } });
  }

  setLightingPreset(id) {
    const base = this.scene.lighting;
    this.patch({ lighting: presetToSettings(id, { follow: base.follow, shadows: base.shadows, exposure: base.exposure, toneMapping: base.toneMapping }) });
    this.scene.look = null;
  }

  // ------------------------------------------------------------------ history
  _pushSceneHistory() {
    if (this._sceneBefore == null) return;
    const after = JSON.stringify(this.scene);
    if (after !== this._sceneBefore) { this.undoStack.push({ kind: 'scene', before: this._sceneBefore, after }); this.redoStack = []; }
    this._sceneBefore = null;
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.emit('history');
  }

  _structuresSnapshot() {
    return JSON.stringify({ active: this.project.activeStructure, list: this.project.structures.map((s) => ({ id: s.id, name: s.name, structure: s.structure.toJSON({ precision: 8 }), frame: s.structure.frame })) });
  }
  _pushStructureHistory() {
    this._commitScene.flush();
    this.undoStack.push({ kind: 'structure', before: this._structuresSnapshot() });
    this.redoStack = [];
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.emit('history');
  }
  _restoreStructures(json) {
    const o = JSON.parse(json);
    this.project.structures = o.list.map((s) => { const st = Structure.fromJSON(s.structure); st.setFrame(s.frame ?? 0); return { id: s.id, name: s.name, structure: st }; });
    this._activate(o.active, { resetCamera: false });
    this.emit('project');
  }

  undo() {
    this._commitScene.flush();
    const e = this.undoStack.pop();
    if (!e) { toast('Nothing to undo'); return; }
    if (e.kind === 'scene') { this.project.scene = JSON.parse(e.before); this.viewer.applySettings(this.scene); this.emit('scene'); }
    else { e.after = this._structuresSnapshot(); this._restoreStructures(e.before); }
    this.redoStack.push(e);
    this.markDirty(); this.emit('history');
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) { toast('Nothing to redo'); return; }
    if (e.kind === 'scene') { this.project.scene = JSON.parse(e.after); this.viewer.applySettings(this.scene); this.emit('scene'); }
    else { e.before = this._structuresSnapshot(); this._restoreStructures(e.after); }
    this.undoStack.push(e);
    this.markDirty(); this.emit('history');
  }

  // ------------------------------------------------------------------ selection + editing
  get selection() { return [...this.viewer.selection]; }
  select(indices, { add = false } = {}) {
    const s = add ? new Set(this.viewer.selection) : new Set();
    for (const i of indices) { if (add && s.has(i)) s.delete(i); else s.add(i); }
    this.viewer.setSelection([...s]);
    this.emit('selection');
  }
  selectElement(sym, add = false) { this.select(this.structure.symbols.map((s, i) => (s === sym ? i : -1)).filter((i) => i >= 0), { add }); }
  invertSelection() { const s = this.viewer.selection; this.select(this.structure.symbols.map((_, i) => i).filter((i) => !s.has(i))); }
  clearSelection() { this.viewer.setSelection([]); this.measurePicks = []; this.emit('selection'); }

  deleteSelected() {
    const sel = this.selection;
    if (!sel.length || !this.structure) return;
    this._pushStructureHistory();
    this.structure.deleteAtoms(sel);
    this.viewer.setSelection([]);
    this.viewer.setStructure(this.structure, { resetCamera: false });
    this.markDirty();
    this.emit('structure'); this.emit('selection');
    toast(`Deleted ${sel.length} atom${sel.length > 1 ? 's' : ''}`, { action: { label: 'Undo', run: () => this.undo() } });
  }

  replaceSelected(symbol) {
    const sel = this.selection;
    if (!sel.length) return;
    this._pushStructureHistory();
    this.structure.setSymbols(sel, symbol);
    this.viewer.setStructure(this.structure, { resetCamera: false });
    this.viewer.setSelection(sel);
    this.markDirty();
    this.emit('structure');
  }

  /** Replace the active structure in place (e.g. wrap, supercell bake) with undo. */
  replaceActiveStructure(newStructure, { resetCamera = false } = {}) {
    this._pushStructureHistory();
    const e = this.project.structures.find((s) => s.id === this.project.activeStructure);
    e.structure = newStructure; e.name = newStructure.name;
    this.structure = newStructure;
    this.viewer.setStructure(newStructure, { resetCamera });
    this.markDirty();
    this.emit('structure'); this.emit('project');
  }

  setTool(tool, measureType) {
    this.tool = tool;
    if (measureType) this.measureType = measureType;
    this.measurePicks = [];
    this.emit('tool');
  }

  _onAtomClick({ index, shiftKey }) {
    if (this.tool === 'measure') {
      if (index < 0) { this.measurePicks = []; this.emit('tool'); return; }
      const need = { distance: 2, angle: 3, dihedral: 4 }[this.measureType];
      if (this.measurePicks.at(-1) === index) return;
      this.measurePicks.push(index);
      this.viewer.setSelection(this.measurePicks.map((i) => this.viewer.model.src[i]));
      if (this.measurePicks.length >= need) {
        this.viewer.addMeasurement(this.measureType, this.measurePicks);
        this.measurePicks = [];
        this.viewer.setSelection([]);
        this.emit('measure');
      }
      this.emit('tool');
      return;
    }
    if (index < 0) { if (!shiftKey) this.clearSelection(); return; }
    this.select([this.viewer.model.src[index]], { add: shiftKey });
  }

  // ------------------------------------------------------------------ loading
  loadSample(id, opts = {}) {
    const s = samples.get(id);
    if (!s) throw new Error(`Unknown sample ${id}`);
    const structure = s.build();
    const scene = s.scene ? deepClone(s.scene) : null;
    if (scene?.display?.bonds?.disabledPairs) {
      const ov = {};
      scene.display.bonds.disabledPairs.forEach((k) => { ov[k] = false; });
      scene.display.bonds = { pairOverrides: ov };
    }
    const rep = s.rep && styles.get(s.rep) ? { style: { rep: s.rep, ...styles.get(s.rep).defaults } } : null;
    this.addStructure(structure, { look: s.look, scene: rep ? deepMerge(rep, scene ?? {}) : scene, ...opts });
    return structure;
  }

  async importFiles(files) {
    for (const f of files) {
      try {
        const text = await readText(f);
        if (/\.json$/i.test(f.name) && /"atomscope\.project/.test(text.slice(0, 400))) {
          this.loadProjectJSON(JSON.parse(text), null);
          this.markDirty();
          toast(`Opened project “${this.project.name}”`);
          continue;
        }
        let structure;
        const fmt = detectFormat(f.name, text);
        if (!fmt && this.storage.get('server')) structure = Structure.fromJSON(await this.serverStore.parse(f));
        else structure = parseStructure(text, f.name, fmt);
        if (!structure.name || structure.name === 'Untitled') structure.name = f.name;
        this.addStructure(structure, { name: f.name.replace(/\.[^.]+$/, '') });
        const w = structure.info.warning;
        toast(`Loaded ${f.name} — ${structure.length} atoms${structure.nFrames > 1 ? `, ${structure.nFrames} frames` : ''}${w ? ` (${w})` : ''}`);
      } catch (err) {
        if (err.project) { this.loadProjectJSON(err.project); continue; }
        console.error(err);
        toast(`Could not open ${f.name}: ${err.message}`, { type: 'error' });
      }
    }
  }

  async importText(text, name = 'pasted', format = null) {
    const structure = parseStructure(text, name, format);
    this.addStructure(structure);
    return structure;
  }

  // ------------------------------------------------------------------ storage
  providerFor(id) { return this.storage.get(id); }

  async saveTo(providerId = this.project.location?.provider ?? this.defaultProvider, { quiet = false } = {}) {
    const prov = this.storage.get(providerId);
    if (!prov) throw new Error('That storage location is not available here.');
    if (this.project.location && this.project.location.provider !== providerId) {
      // "save a copy" to another place: new identity there
      this.project.location = null;
    }
    this.setSaveState('saving');
    try {
      const doc = this.projectToJSON();
      doc.updated = new Date().toISOString();
      if (this.project.location?.provider === providerId) doc.location = this.project.location;
      const saved = await prov.save(doc);
      const locId = saved.__locationId ?? saved.id;
      this.project.location = { provider: providerId, id: locId };
      if (providerId === 'server' && saved.id) this.project.id = saved.id;
      this.project.updated = saved.updated ?? doc.updated;
      this.project.thumbnail = doc.thumbnail;
      this.dirty = false;
      this.setSaveState('saved');
      if (!quiet) toast(`Saved to ${prov.label}${prov.folderName ? ` (${prov.folderName})` : ''}`);
      this.emit('project'); this.emit('saved');
      return true;
    } catch (err) {
      this.setSaveState('error', err.message);
      if (err.code === 'auth') this.emit('needAuth');
      if (!quiet) toast(`Save failed: ${err.message}`, { type: 'error' });
      else console.warn('autosave failed', err);
      return false;
    }
  }

  async autosave() {
    if (!this.dirty || !this.structure) return;
    const target = this.project.location?.provider ?? this.defaultProvider;
    if (target === 'folder' && !this.folderStore.connected) return;
    await this.saveTo(target, { quiet: true });
  }

  async openProject(providerId, id) {
    const prov = this.storage.get(providerId);
    this._autosave.flush();
    const doc = await prov.get(id);
    this.loadProjectJSON(doc, { provider: providerId, id });
    toast(`Opened “${this.project.name}”`);
  }

  async deleteProject(providerId, id) {
    await this.storage.get(providerId).remove(id);
    if (this.project.location?.provider === providerId && this.project.location?.id === id) { this.project.location = null; this.markDirty(); }
    this.emit('providers');
  }

  async duplicateProject(providerId, id) {
    const prov = this.storage.get(providerId);
    const doc = await prov.get(id);
    const copy = { ...doc, id: uid('p'), name: `${doc.name} (copy)`, created: new Date().toISOString() };
    delete copy.location;
    await prov.save(copy);
    this.emit('providers');
  }

  async downloadProject() {
    const doc = this.projectToJSON();
    return saveFile(`${slug(this.project.name)}.atomscope.json`, JSON.stringify(doc, null, 1), 'application/json');
  }

  // ------------------------------------------------------------------ export
  async exportImage({ scale = 2, transparent = false } = {}) {
    if (!this.structure) throw new Error('Nothing to export yet.');
    const blob = await this.viewer.screenshot({ scale, transparent });
    const ok = await saveFile(`${slug(this.structure.name)}${transparent ? '-transparent' : ''}@${scale}x.png`, blob, 'image/png');
    if (ok) toast(`Image saved (${Math.round(this.viewer.width * scale)}×${Math.round(this.viewer.height * scale)} px)`);
  }

  async exportGLB() {
    if (!this.structure) throw new Error('Nothing to export yet.');
    const blob = await this.viewer.exportGLB();
    const name = `${slug(this.structure.name)}.glb`;
    // sandboxed viewers only save common file types, so the model travels inside a .zip there
    const ok = isArtifact() ? await saveFile(`${name}.zip`, await makeZip([{ name, data: blob }]), 'application/zip') : await saveFile(name, blob, 'model/gltf-binary');
    if (ok) toast(isArtifact() ? `Saved ${name} inside a .zip` : `Saved ${name}`);
  }

  async exportStructureFile(formatId) {
    if (!this.structure) throw new Error('Nothing to export yet.');
    const { text, filename, mime } = exportStructure(this.structure, formatId);
    const direct = !isArtifact() || /\.(txt|json|csv|md)$/.test(filename);
    const ok = direct ? await saveFile(filename, text, mime) : await saveFile(`${filename}.zip`, await makeZip([{ name: filename, data: text }]), 'application/zip');
    if (ok) toast(direct ? `Saved ${filename}` : `Saved ${filename} inside a .zip`);
  }

  // ------------------------------------------------------------------ prefs
  setPref(k, v) { this.prefs[k] = v; savePrefs(this.prefs); this.emit('prefs'); }
}

export { formats, samples };
