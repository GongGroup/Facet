/**
 * App controller: owns the project, the active structure, scene settings, history, storage and the
 * viewer, and exposes the actions that the UI, the command palette, shortcuts and plugins call.
 *
 * Events (app.on):
 *   'project' | 'structure' | 'selection' | 'scene' | 'tool' | 'measure' | 'providers' | 'prefs'
 *   'saveState' state            — 'idle' | 'dirty' | 'saving' | 'saved' | 'error' (detail in app.saveDetail)
 *   'saved'                      — the open project was stored
 *   'history'                    — undo/redo stacks changed (see undoLabel(), redoLabel(), canUndo())
 *   'busy' {busy, label}         — a long task started or ended (export, import, explicit save)
 *   'auth' user|null             — the server account changed (sign in, sign out, expired session)
 *   'needAuth'                   — a save needs the user to sign in (again)
 */
import { Emitter } from './core/events.js';
import { Structure } from './core/structure.js';
import { uid, deepClone, deepMerge, setPath, getPath, debounce, relativeTime } from './core/util.js';
import { parseStructure, exportStructure, formats, detectFormat } from './io/index.js';
import { samples } from './build/samples.js';
import { Viewer, measureArity } from './render/viewer.js';
import { makeScene, DEFAULT_SCENE } from './render/settings.js';
import { looks } from './render/looks.js';
import { styles } from './render/styles.js';
import { presetToSettings, lightingPresets } from './render/lighting.js';
import { StorageManager } from './storage/index.js';
import { BrowserStore } from './storage/browser.js';
import { ServerStore } from './storage/server.js';
import { ClaudeCloudStore } from './storage/claude.js';
import { FolderStore } from './storage/folder.js';
import { saveFile, readText, slug, isArtifact } from './storage/files.js';
import { toast, dialog } from './ui/overlays.js';
import { h } from './ui/dom.js';
import { makeZip } from './core/zip.js';

export const VERSION = '0.1.0';
const PREF_KEY = 'atomscope.prefs';   // key from the app's former name, kept so saved preferences survive the rename
const RECOVERY_KEY = 'recovery';
const RETRY_DELAYS = [5000, 15000, 60000];
const NO_RETRY = new Set(['nofolder', 'notfound', 'toolarge', 'ratelimit']);   // retrying cannot help
const THUMB_EVERY = 60000;
export const DARK_BG = { mode: 'gradient', color1: '#252a31', color2: '#0f1114' };
export const DARK_CELL = '#9aa4b1';   // unit-cell lines on DARK_BG (a look's cellDark takes precedence)

/**
 * Scene paths owned by a look. applyLook() resets these to the defaults before applying the look,
 * so a look always gives the same picture whatever was set before. ('lighting.*' except follow.)
 */
export const LOOK_KEYS = Object.freeze([
  ...Object.keys(DEFAULT_SCENE.lighting).filter((k) => k !== 'follow').map((k) => `lighting.${k}`),
  'post', 'style.material', 'style.roughness', 'style.metalness', 'style.opacity', 'style.colorScheme', 'style.monoColor',
  'display.background', 'display.cell.color',
]);

/** True when setting dotted scene path `path` changes something a look owns (then scene.look becomes null). */
export const touchesLook = (path) => LOOK_KEYS.some((k) => path === k || path.startsWith(`${k}.`) || k.startsWith(`${path}.`));
/** Dotted paths of the leaf values of a partial scene ({a: {b: 1}} → ['a.b']). */
function leafPaths(o, pre = '', out = []) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) leafPaths(v, p, out); else out.push(p);
  }
  return out;
}

/** View-only scene paths: they change the picture but are not undoable edits and do not mark the project unsaved. */
export const VIEW_PATHS = new Set(['display.turntable']);
/** Quick view toggles: consecutive changes merge into one 'View' undo step. */
const VIEW_MERGE = new Set(['display.projection', 'display.labels', 'display.cell.show']);

const PATH_LABELS = [
  ['style.rep', 'Representation'], ['style.atomScale', 'Atom size'], ['style.radiusSource', 'Atom radii'], ['style.bondRadius', 'Bond thickness'],
  ['style.bondColor', 'Bond colour'], ['style.colorScheme', 'Colour scheme'], ['style.colorOverrides', 'Element colour'], ['style.property', 'Colour by property'],
  ['style.material', 'Material'], ['style.opacity', 'Opacity'], ['style.polyhedra', 'Polyhedra'], ['style', 'Style'],
  ['lighting.shadows', 'Shadows'], ['lighting.exposure', 'Exposure'], ['lighting', 'Lighting'],
  ['post.ao', 'Ambient occlusion'], ['post.outline', 'Outlines'], ['post.bloom', 'Bloom'], ['post.dof', 'Depth of field'],
  ['post.vignette', 'Vignette'], ['post.fog', 'Depth cueing'], ['post', 'Effects'],
  ['display.background', 'Background'], ['display.supercell', 'Supercell'], ['display.bonds', 'Bonds'], ['display.hiddenElements', 'Hidden elements'],
  ['display.cell', 'Unit cell'], ['display', 'Display'],
];
const labelForPath = (path) => PATH_LABELS.find(([p]) => path === p || path.startsWith(`${p}.`))?.[1] ?? 'Settings';
const firstPath = (o, pre = '') => {
  const k = o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o)[0] : null;
  return k == null ? pre : firstPath(o[k], pre ? `${pre}.${k}` : k);
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function isLightBackground(bg) {
  if (!bg) return false;
  const ls = [bg.color1, bg.mode === 'solid' ? null : bg.color2].map(luminance).filter((v) => v != null);
  return ls.length > 0 && ls.reduce((a, b) => a + b, 0) / ls.length > 0.5;
}
/** Saved measurements that can be shown: a known type with its number of atom keys (others are dropped). */
const cleanMeasurements = (list) => (Array.isArray(list) ? list : [])
  .filter((m) => m && Array.isArray(m.keys) && measureArity(m.type) === m.keys.length && m.keys.every((k) => typeof k === 'string'))
  .map((m) => ({ type: m.type, keys: m.keys.slice() }));
const toStructure = (s) => (s instanceof Structure ? s : Structure.fromJSON(s));
const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));

export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; } }
export function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

export class App extends Emitter {
  constructor(viewportEl) {
    super();
    this.prefs = loadPrefs();
    this.viewer = new Viewer(viewportEl);
    this.viewer.toolProvider = () => this.tool;   // box selection (Shift/Alt+drag) only with the Select tool
    this.storage = new StorageManager();
    this.browserStore = new BrowserStore();
    this.serverStore = new ServerStore('');
    this.claudeStore = new ClaudeCloudStore();
    this.folderStore = new FolderStore(this.browserStore);
    this.project = this._blankProject();
    this.structure = null;
    this.dirty = false;
    this.saveState = 'idle';
    this.saveDetail = '';
    this.defaultProvider = 'browser';
    this.busy = false;
    this.busyLabel = '';
    this.tool = 'select';
    this.measureType = 'distance';
    this.measurePicks = [];
    this.undoStack = []; this.redoStack = [];
    this._authUser = null;
    this._rev = 0;               // bumped on every edit; tells a finished save whether newer edits exist
    this._sceneBefore = null; this._sceneLabel = null; this._lastEntry = null; this._tx = null;
    this._saving = null; this._savingFor = null; this._again = null; this._retry = null; this._recovery = null;
    this._busyOps = [];
    this._measGuard = 0;
    this._exporting = false;
    this._commitScene = debounce(() => this._pushSceneHistory(), 650);
    this._autosave = debounce(() => this.autosave(), 2500);
    this.serverStore.onAuth = (u) => this._onAuth(u);
    this.viewer.on('atomclick', (e) => this._onAtomClick(e));
    this.viewer.on('measure', () => this._onViewerMeasure());
    this.viewer.on('error', (e) => toast(e.message, { type: 'error' }));
    this.viewer.on('camera', debounce(() => { if (this.structure) this.project.scene.camera = this.viewer.getCameraState(); }, 400));
    // same rule as confirmLeave(): an empty project has nothing to lose, a running save must finish
    addEventListener('beforeunload', (e) => {
      if (this._hasUnsaved() || this._saving) {
        if (this.dirty && this.structure) this._writeRecovery(this.project);
        e.preventDefault(); e.returnValue = '';
      }
    });
    addEventListener('online', () => { if (this._retry) this._runRetry(this._retry); });
  }

  async init() {
    await this.browserStore.init();
    this.storage.register(this.browserStore);
    const hasServer = await this.serverStore.probe();
    if (hasServer) this.storage.register(this.serverStore);
    if (await this.claudeStore.init()) this.storage.register(this.claudeStore);
    if (await this.folderStore.init()) this.storage.register(this.folderStore);
    this._authUser = this.serverStore.user?.id ?? null;
    this.defaultProvider = this._pickDefaultProvider();
    this.emit('providers');
    this._checkRecovery().catch((e) => console.warn('recovery check failed', e));
  }

  /** Where new projects are saved: the claude.ai cloud, the server (when usable), this browser or a connected folder. */
  _pickDefaultProvider() {
    if (this.storage.get('claude')) return 'claude';
    const s = this.serverStore;
    // a server that wants a token (local mode with CRYSTALLUME_TOKEN, or cloud) is used once signed in (see _onAuth)
    if (this.storage.get('server') && ((s.info?.mode === 'local' && !s.needsAuth) || (s.info?.mode === 'cloud' && s.user))) return 'server';
    if (!this.browserStore.memory) return 'browser';
    if (this.storage.get('folder') && this.folderStore.connected) return 'folder';
    return 'browser';
  }

  _onAuth(user) {
    const id = user?.id ?? null;
    this.defaultProvider = this._pickDefaultProvider();
    if (id === this._authUser) return;
    this._authUser = id;
    this.project._authNotified = false;
    this.emit('auth', user ?? null);
    this.setSaveState(this.saveState, this.saveDetail);   // the save target may have changed
    if (user && this.dirty) this.autosave();
  }

  // ------------------------------------------------------------------ project model
  _isDarkUI() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
  }

  _blankProject(name = 'Untitled project') {
    // a new project starts from the default look, or from Midnight in a dark interface
    const scene = makeScene();
    const look = looks.get(this._isDarkUI() ? 'midnight' : scene.look);
    if (look) { deepMerge(scene, deepClone(look.scene)); scene.look = look.id; }
    scene.lookBase = scene.look;
    return { id: uid('p'), name, description: '', tags: [], created: new Date().toISOString(), updated: null, structures: [], activeStructure: null, scene, location: null, thumbnail: null };
  }

  get scene() { return this.project.scene; }
  /** True for a scratch project nobody has worked on (empty, or an untouched sample). */
  get pristine() { return !this.project.location && !this.dirty; }
  /** True when leaving now would lose work: unsaved changes in a project that holds structures. */
  _hasUnsaved() { return this.dirty && this.project.structures.length > 0; }
  _activeEntry() { return this.project.structures.find((s) => s.id === this.project.activeStructure) ?? null; }
  _newEntry(structure) { return { id: uid('s'), name: structure.name, structure, measurements: [] }; }

  /**
   * The project as a `crystallume.project/1` document.
   * thumbnail: true renders a new one, false reuses the last, 'auto' re-renders at most once a minute.
   */
  projectToJSON({ thumbnail = true } = {}) {
    const p = this.project;
    if (this.structure) p.scene.camera = this.viewer.getCameraState();
    let thumb = p.thumbnail ?? null;
    if (this.structure && (thumbnail === true || (thumbnail === 'auto' && this._thumbDue(p)))) {
      try { thumb = this.viewer.thumbnail(240, 150, 0.7); p._thumbAt = Date.now(); p._thumbSig = this._viewSig(); } catch (e) { console.warn('thumbnail failed', e); }
    }
    const active = this._activeEntry();
    const out = {
      schema: 'crystallume.project/1', id: p.id, name: p.name, description: p.description, tags: p.tags, created: p.created, updated: p.updated ?? p.created,
      thumbnail: thumb,
      activeStructure: p.activeStructure,
      structures: p.structures.map((s) => {
        const ms = s === active ? this._viewerMeasurements() : (s.measurements ?? []);
        return { id: s.id, name: s.name, structure: s.structure.toJSON(), ...(ms.length ? { measurements: ms } : {}) };
      }),
      scene: deepClone(p.scene),
    };
    if (p.importedFrom) out.importedFrom = p.importedFrom;
    return out;
  }

  _viewSig() { return `${this._rev}|${JSON.stringify(this.scene.camera ?? null)}`; }
  _thumbDue(p) {
    if (!p.thumbnail || !p.location) return true;
    if (Date.now() - (p._thumbAt ?? 0) < THUMB_EVERY) return false;
    return p._thumbSig !== this._viewSig();
  }

  /** Replace the open project with a document. Throws (leaving the current project open) if it cannot be shown. */
  loadProjectJSON(doc, location = null) {
    if (!doc || !Array.isArray(doc.structures)) throw new Error('This file is not a Crystallume project.');
    const p = {
      id: doc.id ?? uid('p'), name: doc.name ?? 'Untitled project', description: doc.description ?? '', tags: doc.tags ?? [], created: doc.created ?? new Date().toISOString(), updated: doc.updated ?? null,
      structures: doc.structures.map((s) => ({ id: s.id ?? uid('s'), name: s.name ?? s.structure?.name ?? 'Structure', structure: Structure.fromJSON(s.structure), measurements: cleanMeasurements(s.measurements) })),
      activeStructure: doc.activeStructure, scene: makeScene(doc.scene), location, thumbnail: doc.thumbnail ?? null,
    };
    if (doc.importedFrom) p.importedFrom = doc.importedFrom;
    // projects saved before lookBase existed: the look they show, not the default's ('studio')
    if (doc.scene && !('lookBase' in doc.scene)) p.scene.lookBase = doc.scene.look ?? null;
    if (!p.structures.find((s) => s.id === p.activeStructure)) p.activeStructure = p.structures[0]?.id ?? null;
    const prev = { project: this.project, undo: this.undoStack, redo: this.redoStack, dirty: this.dirty, state: this.saveState, camera: this.structure ? this.viewer.getCameraState() : null, selection: this.selection };
    this._switchProject(p);
    try { this._activate(p.activeStructure, { camera: doc.scene?.camera }); }
    catch (err) { this._restorePrevious(prev); throw err; }
    this.setSaveState(location ? 'saved' : 'idle');
    this.emit('project');
    return p;
  }

  /** Common bookkeeping when another project becomes the open one. */
  _switchProject(project) {
    // a pending autosave of the old project still runs (its document is taken now)
    if (this._autosave.pending() && this.dirty) { this._autosave.cancel(); this.autosave(); }
    if (this._again && this._again.proj === this.project && !this._again.doc) {
      try { this._again.doc = this.projectToJSON({ thumbnail: false }); } catch { /* skipped */ }
    }
    this._autosave.cancel();
    this._cancelRetry();
    this._commitScene.cancel(); this._sceneBefore = null; this._sceneLabel = null;
    this.project = project;
    this.undoStack = []; this.redoStack = []; this._lastEntry = null;
    this.dirty = false;
    this.measurePicks = [];
    this.viewer.selection?.clear?.();   // the old project's atoms; _activate redraws the halos and emits 'selection'
    this.emit('history');
  }

  _restorePrevious(prev) {
    this.project = prev.project; this.undoStack = prev.undo; this.redoStack = prev.redo; this.dirty = prev.dirty;
    this.viewer.measurements = [];   // the failed project's; the previous structure's own are shown again below
    try {
      this._activate(prev.project.activeStructure, { camera: prev.camera });
      if (prev.selection?.length) this.select(prev.selection);
    } catch (e) { console.error(e); }
    this.setSaveState(prev.state, this.saveDetail);
    this.emit('project'); this.emit('history');
  }

  /** Show structure `sid`. The viewer is updated first; on failure the error is rethrown. */
  _activate(sid, { camera = null, resetCamera = true } = {}) {
    const entry = this.project.structures.find((s) => s.id === sid);
    this.project.activeStructure = entry?.id ?? null;
    this.structure = entry?.structure ?? null;
    this.measurePicks = [];
    if (this.structure) {
      // a kept selection (resetCamera:false) must not point past the end of this structure
      const n = this.structure.length;
      for (const i of [...this.viewer.selection]) if (i >= n) this.viewer.selection.delete(i);
      this._measGuard++;
      try {
        this.viewer.settings = this.scene;   // setStructure builds once, with this project's settings
        this.viewer.setStructure(this.structure, { resetCamera: resetCamera && !camera });
      } finally { this._measGuard--; }
      this._showMeasurements(entry);
      if (camera) this.viewer.setCameraState(camera);
    } else {
      this.viewer.structure = null;
      this.viewer.model = null;
      this.viewer.selection?.clear?.();
      this.viewer.measurements = [];
      this.viewer._disposeObject(this.viewer.measureObj); this.viewer.measureObj = null;
      this.viewer._disposeObject(this.viewer.rep); this.viewer.rep = null;
      this.viewer._disposeObject(this.viewer.cellObj); this.viewer.cellObj = null;
      this.viewer.applySettings(this.scene, { force: true });
      this.viewer.requestRender();
    }
    this.emit('structure');
    this.emit('selection');
  }

  setActiveStructure(sid) { this._activate(sid); this.markDirty(); }

  /**
   * Add a structure to the project. A pristine scratch project (or newProject:true) is replaced by a new
   * project holding the structure; `look` only applies then — adding to existing work keeps the user's look.
   * Adding to existing work is one undo step. If the viewer cannot show the structure, nothing changes and
   * the error is rethrown.
   */
  addStructure(structure, { look = null, scene = null, newProject = false, name = null } = {}) {
    if (newProject || this.pristine) {
      const prev = { project: this.project, undo: this.undoStack, redo: this.redoStack, dirty: this.dirty, state: this.saveState, camera: this.structure ? this.viewer.getCameraState() : null, selection: this.selection, scene: JSON.stringify(this.project.scene) };
      const proj = this._blankProject(name ?? structure.name ?? 'Untitled project');
      // an empty scratch project keeps the settings chosen so far; an untouched sample's settings are not the user's
      if (!newProject && !this.project._fromSample) proj.scene = this.project.scene;
      this._switchProject(proj);
      const entry = this._newEntry(structure);
      proj.structures.push(entry);
      try {
        if (look) this.applyLook(look, { silent: true });
        if (scene) deepMerge(proj.scene, deepClone(scene));
        this._activate(entry.id);
      } catch (err) {
        prev.project.scene = JSON.parse(prev.scene);
        this._restorePrevious(prev);
        throw err;
      }
      this.markDirty();
      this.emit('project');
      return entry;
    }
    let entry;
    this.transaction(`Add ${structure.name || name || 'structure'}`, () => {
      this._pushStructureHistory();
      entry = this._newEntry(structure);
      this.project.structures.push(entry);
      if (scene) deepMerge(this.scene, deepClone(scene));
      this._activate(entry.id);
    });
    this.markDirty();
    this.emit('project');
    return entry;
  }

  removeStructure(sid) {
    const i = this.project.structures.findIndex((s) => s.id === sid);
    if (i < 0) return;
    this._pushStructureHistory(`Remove ${this.project.structures[i].name}`);
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

  /** Start an empty project. Asks about unsaved changes first unless {force:true}. Resolves false if cancelled. */
  async newProject({ force = false } = {}) {
    if (!force && !(await this.confirmLeave('start a new project'))) return false;
    this._switchProject(this._blankProject());
    this._activate(null);
    this.setSaveState('idle');
    this.emit('project');
    return true;
  }

  rename(name) { this.project.name = name || 'Untitled project'; this.markDirty(); this.emit('project'); }

  markDirty() {
    this._rev++;
    this.dirty = true;
    if (this.project._conflict) this.setSaveState('error', 'Changed elsewhere');
    else this.setSaveState('dirty');
    if (this.prefs.autosave !== false && !this.project._conflict) this._autosave();
  }

  setSaveState(s, detail = '') { this.saveState = s; this.saveDetail = detail; this.emit('saveState', s); }

  // ------------------------------------------------------------------ scene settings
  /** Set one scene value by dotted path, e.g. set('post.ao.intensity', 1.2). */
  set(path, value) {
    if (VIEW_PATHS.has(path)) {
      setPath(this.scene, path, value);
      this.viewer.applySettings(this.scene);
      this.emit('scene');
      return;
    }
    this._beginScene(VIEW_MERGE.has(path) ? 'View' : labelForPath(path));
    setPath(this.scene, path, value);
    // a hand edit of a look-owned setting (material, colours, lighting, effects, background) leaves the look;
    // sizes, bonds, the representation and other settings a look does not set keep it
    if (touchesLook(path)) this.scene.look = null;
    this._sceneChanged();
  }
  get(path) { return getPath(this.scene, path); }

  /** Deep-merge a partial scene. */
  patch(partial, { history = true, label = null } = {}) {
    if (history) this._beginScene(label ?? labelForPath(firstPath(partial)));
    const leavesLook = !Object.hasOwn(partial ?? {}, 'look') && leafPaths(partial).some(touchesLook);
    deepMerge(this.scene, deepClone(partial));
    if (leavesLook) this.scene.look = null;
    this._sceneChanged(history);
  }

  _sceneChanged(history = true) {
    this.viewer.applySettings(this.scene);
    if (history && !this._tx) this._commitScene();
    this.markDirty();
    this.emit('scene');
  }

  /**
   * Apply a look. The look-owned settings (LOOK_KEYS) are reset to the defaults first, so the result
   * does not depend on what was set before; representation, sizes, supercell, bonds, labels and camera stay.
   */
  applyLook(id, { silent = false } = {}) {
    const l = looks.get(id);
    if (!l) return false;
    const apply = () => {
      const sc = this.scene, base = makeScene();
      const follow = sc.lighting?.follow ?? base.lighting.follow;
      sc.lighting = base.lighting; sc.lighting.follow = follow;
      for (const p of LOOK_KEYS) if (!p.startsWith('lighting.')) setPath(sc, p, deepClone(getPath(base, p)));
      deepMerge(sc, deepClone(l.scene));
      sc.look = id; sc.lookBase = id;
      this.viewer.applySettings(sc);
      this.emit('scene');
    };
    if (silent) { apply(); return true; }
    this.transaction(`Look: ${l.name ?? id}`, () => { apply(); this.markDirty(); });
    return true;
  }

  setRepresentation(id) {
    const s = styles.get(id);
    if (!s) return;
    this.transaction(`Representation: ${s.name ?? id}`, () => this.patch({ style: { rep: id, ...s.defaults } }));
  }

  setLightingPreset(id) {
    const base = this.scene.lighting;
    this.transaction(`Lighting: ${lightingPresets.get?.(id)?.name ?? id}`, () => {
      this.scene.look = null;
      this.patch({ lighting: presetToSettings(id, { follow: base.follow, shadows: base.shadows, exposure: base.exposure, toneMapping: base.toneMapping }) });
    });
  }

  // ------------------------------------------------------------------ history
  /** Label of the step Undo would revert (e.g. 'Delete 2 atoms'), or null. */
  undoLabel() { return this._sceneBefore != null ? this._sceneLabel : (this.undoStack.at(-1)?.label ?? null); }
  redoLabel() { return this._sceneBefore != null ? null : (this.redoStack.at(-1)?.label ?? null); }
  canUndo() { return this._sceneBefore != null || this.undoStack.length > 0; }
  canRedo() { return this._sceneBefore == null && this.redoStack.length > 0; }

  /**
   * Run fn as one undo step: scene and structure changes made inside are recorded together under `label`.
   * Nested transactions join the outer one. If fn throws, its changes are rolled back and the error rethrown.
   * fn must be synchronous: the step closes when fn returns, so other edits made while a returned Promise
   * is pending are never folded into it (changes made after an await are recorded as their own steps).
   */
  transaction(label, fn) {
    if (this._tx) return fn();
    this._commitScene.flush();
    const tx = this._tx = { label, sceneBefore: this._sceneJSON(), before: null, selBefore: null };
    const finish = () => {
      this._tx = null;
      const sceneAfter = this._sceneJSON();
      const sc = sceneAfter !== tx.sceneBefore;
      if (tx.before && sc) this._record({ kind: 'both', label, sceneBefore: tx.sceneBefore, sceneAfter, before: tx.before, selBefore: tx.selBefore });
      else if (tx.before) this._record({ kind: 'structure', label, before: tx.before, selBefore: tx.selBefore });
      else if (sc) this._record({ kind: 'scene', label, before: tx.sceneBefore, after: sceneAfter });
    };
    const fail = (err) => {
      this._tx = null;
      try {
        if (this._sceneJSON() !== tx.sceneBefore) this._restoreScene(tx.sceneBefore);
        if (tx.before) this._restoreStructures(tx.before, tx.selBefore);
      } catch (e) { console.error('rollback failed', e); }
      throw err;
    };
    let out;
    try { out = fn(); } catch (err) { fail(err); }
    if (out && typeof out.then === 'function') console.warn(`transaction “${label}”: fn returned a Promise; only its synchronous part is one undo step`);
    finish();
    return out;
  }

  _record(e) {
    this.undoStack.push(e);
    this.redoStack = [];
    this._lastEntry = e;
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.emit('history');
  }

  /** Scene snapshot for history (camera and view-only toggles left out). */
  _sceneJSON(scene = this.scene) {
    const { camera, ...rest } = scene;
    return JSON.stringify(rest.display ? { ...rest, display: { ...rest.display, turntable: undefined } } : rest);
  }
  _restoreScene(json) {
    const s = JSON.parse(json), cur = this.scene;
    s.camera = cur.camera ?? null;
    for (const p of VIEW_PATHS) if (getPath(cur, p) !== undefined) setPath(s, p, getPath(cur, p));
    this.project.scene = s;
    this.viewer.applySettings(s);
    this.emit('scene');
  }

  _beginScene(label) {
    if (this._tx) return;
    if (this._sceneBefore != null && this._sceneLabel !== label) this._commitScene.flush();
    if (this._sceneBefore == null) {
      this._sceneBefore = this._sceneJSON();
      this._sceneLabel = label;
      this.emit('history');
    }
  }

  _pushSceneHistory() {
    if (this._sceneBefore == null) return;
    const before = this._sceneBefore, label = this._sceneLabel ?? 'Settings';
    this._sceneBefore = null; this._sceneLabel = null;
    const after = this._sceneJSON();
    const top = this.undoStack.at(-1);
    if (label === 'View' && top && top === this._lastEntry && top.kind === 'scene' && top.label === 'View') {
      top.after = after;
      if (top.before === after) { this.undoStack.pop(); this._lastEntry = null; }
      this.emit('history');
      return;
    }
    if (after !== before) this._record({ kind: 'scene', label, before, after });
    else this.emit('history');
  }

  _structuresSnapshot() {
    const active = this._activeEntry();
    return JSON.stringify({
      active: this.project.activeStructure,
      list: this.project.structures.map((s) => ({ id: s.id, name: s.name, structure: s.structure.toJSON({ precision: 8 }), frame: s.structure.frame, measurements: s === active ? this._viewerMeasurements() : (s.measurements ?? []) })),
    });
  }
  _pushStructureHistory(label = 'Edit structure') {
    this._commitScene.flush();
    if (this._tx) {
      if (!this._tx.before) { this._tx.before = this._structuresSnapshot(); this._tx.selBefore = this.selection; }
      return;
    }
    this._record({ kind: 'structure', label, before: this._structuresSnapshot(), selBefore: this.selection });
  }
  _restoreStructures(json, selection = null) {
    const o = JSON.parse(json);
    this.project.structures = o.list.map((s) => { const st = Structure.fromJSON(s.structure); st.setFrame(s.frame ?? 0); return { id: s.id, name: s.name, structure: st, measurements: cleanMeasurements(s.measurements) }; });
    this._activate(o.active, { resetCamera: false });
    const n = this.structure?.length ?? 0;
    this.viewer.setSelection((selection ?? []).filter((i) => i >= 0 && i < n));
    this.measurePicks = [];
    this.emit('selection'); this.emit('measure');
    this.emit('project');
  }

  /** Undo the last step. Returns its label (or null when there is nothing to undo). */
  undo() {
    this._commitScene.flush();
    const e = this.undoStack.pop();
    if (!e) { toast('Nothing to undo'); return null; }
    this._lastEntry = null;
    if (e.kind === 'scene') this._restoreScene(e.before);
    else {
      e.after = this._structuresSnapshot(); e.selAfter = this.selection;
      if (e.kind === 'both') this._restoreScene(e.sceneBefore);
      this._restoreStructures(e.before, e.selBefore);
    }
    this.redoStack.push(e);
    this.markDirty(); this.emit('history');
    return e.label ?? null;
  }

  redo() {
    this._commitScene.flush();
    const e = this.redoStack.pop();
    if (!e) { toast('Nothing to redo'); return null; }
    this._lastEntry = null;
    if (e.kind === 'scene') this._restoreScene(e.after);
    else {
      e.before = this._structuresSnapshot(); e.selBefore = this.selection;
      if (e.kind === 'both') this._restoreScene(e.sceneAfter);
      this._restoreStructures(e.after, e.selAfter);
    }
    this.undoStack.push(e);
    this.markDirty(); this.emit('history');
    return e.label ?? null;
  }

  // ------------------------------------------------------------------ selection + editing
  get selection() { return [...this.viewer.selection]; }
  select(indices, { add = false } = {}) {
    const n = this.structure?.length ?? 0;
    const s = add ? new Set(this.viewer.selection) : new Set();
    for (const v of indices) {
      const i = Number(v);
      if (!Number.isInteger(i) || i < 0 || i >= n) continue;
      if (add && s.has(i)) s.delete(i); else s.add(i);
    }
    this.viewer.setSelection([...s]);
    this.emit('selection');
  }
  selectElement(sym, add = false) { if (!this.structure) return; this.select(this.structure.symbols.map((s, i) => (s === sym ? i : -1)).filter((i) => i >= 0), { add }); }
  invertSelection() { if (!this.structure) return; const s = this.viewer.selection; this.select(this.structure.symbols.map((_, i) => i).filter((i) => !s.has(i))); }
  clearSelection() { this.viewer.setSelection([]); this.measurePicks = []; this.emit('selection'); }

  deleteSelected() {
    const sel = this.selection;
    if (!sel.length || !this.structure) return;
    const label = `Delete ${plural(sel.length, 'atom')}`;
    this._pushStructureHistory(label);
    const n = this.structure.length, gone = new Set(sel), map = new Int32Array(n);
    for (let i = 0, k = 0; i < n; i++) map[i] = gone.has(i) ? -1 : k++;
    this.structure.deleteAtoms(sel);
    this.viewer.setSelection([]);
    this._remapMeasurements(map);
    this._measGuard++;
    try { this.viewer.setStructure(this.structure, { resetCamera: false }); } finally { this._measGuard--; }
    this._showMeasurements(this._activeEntry());
    this.markDirty();
    this.emit('structure'); this.emit('selection'); this.emit('measure');
    toast(`Deleted ${plural(sel.length, 'atom')}`, { action: { label: 'Undo', run: () => this.undo() } });
  }

  replaceSelected(symbol) {
    const sel = this.selection;
    if (!sel.length) return;
    this._pushStructureHistory(`Change ${plural(sel.length, 'atom')} to ${symbol}`);
    this.structure.setSymbols(sel, symbol);
    this._measGuard++;
    try { this.viewer.setStructure(this.structure, { resetCamera: false }); } finally { this._measGuard--; }
    this._showMeasurements(this._activeEntry());
    this.viewer.setSelection(sel);
    this.markDirty();
    this.emit('structure');
  }

  /**
   * Replace the active structure in place (e.g. wrap, supercell bake) with undo.
   * indexMap (Int32Array or function old→new, -1 = removed) keeps measurements and the selection on the
   * same atoms; by default atom i stays atom i while it exists.
   */
  replaceActiveStructure(newStructure, { resetCamera = false, label = 'Edit structure', indexMap = null } = {}) {
    const e = this._activeEntry();
    if (!e) return this.addStructure(newStructure);
    const old = e.structure, n = old.length, m = newStructure.length;
    const map = new Int32Array(n);
    for (let i = 0; i < n; i++) map[i] = typeof indexMap === 'function' ? indexMap(i) : indexMap ? (indexMap[i] ?? -1) : (i < m ? i : -1);
    const selBefore = this.selection, sel = selBefore.map((i) => (i < n ? map[i] : -1)).filter((i) => i >= 0 && i < m);
    const measBefore = this._viewerMeasurements();   // the viewer holds the active entry's measurements
    this._pushStructureHistory(label);
    e.structure = newStructure; e.name = newStructure.name;
    this.structure = newStructure;
    this._remapMeasurements(map);
    this.viewer.selection = new Set(sel);   // no old indices past the end while the viewer rebuilds ('model' listeners read it)
    this._measGuard++;
    try { this.viewer.setStructure(newStructure, { resetCamera }); }
    catch (err) {
      // put back the structure, its measurements and the selection; the failed step leaves no undo entry
      e.structure = old; e.name = old.name; this.structure = old;
      e.measurements = measBefore;
      try {
        this.viewer.setStructure(old, { resetCamera: false });
        this._showMeasurements(e);
        this.viewer.setSelection(selBefore);
      } catch { /* keep the error below */ }
      if (!this._tx && this.undoStack.at(-1)?.label === label) { this.undoStack.pop(); this.emit('history'); }
      throw err;
    } finally { this._measGuard--; }
    this._showMeasurements(e);
    this.viewer.setSelection(sel);
    this.markDirty();
    this.emit('structure'); this.emit('project'); this.emit('selection');
    return e;
  }

  setTool(tool, measureType) {
    this.tool = tool;
    if (measureType) this.measureType = measureType;
    this.measurePicks = [];
    this.emit('tool');
  }

  _onAtomClick({ index, shiftKey }) {
    if (this.tool === 'measure') {
      if (index < 0) { this.measurePicks = []; this.viewer.setSelection([]); this.emit('tool'); this.emit('selection'); return; }
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

  // ------------------------------------------------------------------ measurements (saved per structure)
  _viewerMeasurements() { return (this.viewer.measurements ?? []).map((m) => ({ type: m.type, keys: m.keys.slice() })); }

  _showMeasurements(entry) {
    this._measGuard++;
    try {
      this.viewer.measurements = (entry?.measurements ?? []).map((m) => ({ id: Math.random().toString(36).slice(2, 8), type: m.type, keys: m.keys.slice() }));
      this.viewer._buildMeasurements?.();
    } finally { this._measGuard--; }
  }

  /** Measurements added or removed in the viewer (tool, panel, API) belong to the active structure. */
  _onViewerMeasure() {
    if (this._measGuard) return;
    const e = this._activeEntry();
    if (!e || this.viewer.structure !== e.structure) return;
    const cur = this._viewerMeasurements();
    if (JSON.stringify(cur) === JSON.stringify(e.measurements ?? [])) return;
    e.measurements = cur;
    this.markDirty();
  }

  /** Point measurement keys ('src:image') at new atom indices; measurements on removed atoms are dropped. */
  _remapMeasurements(map) {
    const out = [];
    for (const m of this.viewer.measurements ?? []) {
      const keys = m.keys.map((k) => {
        const c = k.indexOf(':'), i = Number(k.slice(0, c));
        const j = Number.isInteger(i) && i >= 0 && i < map.length ? map[i] : -1;
        return j >= 0 ? `${j}${k.slice(c)}` : null;
      });
      if (keys.every((k) => k != null)) out.push({ ...m, keys });
    }
    this.viewer.measurements = out;
    const e = this._activeEntry();
    if (e) e.measurements = out.map((m) => ({ type: m.type, keys: m.keys.slice() }));
  }

  // ------------------------------------------------------------------ loading
  /**
   * Show a sample. A pristine project is replaced. Otherwise the sample opens as a new project after the
   * current one is saved (returns a Promise), or with {newProject:false} it is added to the current project.
   */
  loadSample(id, opts = {}) {
    const s = samples.get(id);
    if (!s) throw new Error(`Unknown sample ${id}`);
    const { newProject, adaptBackground = true } = opts;
    if (this.pristine) return this._openSample(s, { adaptBackground });
    if (newProject === false) return this._addSample(s);
    return this._openSampleAsNew(s, { offerAdd: newProject === undefined, adaptBackground });
  }

  _sampleScene(s) {
    const scene = s.scene ? deepClone(s.scene) : null;
    if (scene?.display?.bonds?.disabledPairs) {
      const ov = {};
      scene.display.bonds.disabledPairs.forEach((k) => { ov[k] = false; });
      scene.display.bonds = { pairOverrides: ov };
    }
    const rep = s.rep && styles.get(s.rep) ? { style: { rep: s.rep, ...styles.get(s.rep).defaults } } : null;
    return rep ? deepMerge(rep, scene ?? {}) : scene;
  }

  /** Load a sample as a fresh, still pristine project. */
  _openSample(s, { adaptBackground = true } = {}) {
    const structure = s.build();
    // the project is named as in the Library; the structure keeps its descriptive builder name
    this.addStructure(structure, { name: s.name, look: s.look, scene: this._sampleScene(s), newProject: true });
    if (adaptBackground && s.look) this._adaptBackground(s.look);
    this.project._fromSample = s.id;
    this._autosave.cancel();
    this.dirty = false;
    this.setSaveState('idle');
    this.undoStack = []; this.redoStack = []; this._lastEntry = null;
    this.emit('history');
    return structure;
  }

  _addSample(s) {
    const structure = s.build();
    this.addStructure(structure, { newProject: false });
    toast(`Added ${s.name} to this project (${plural(this.project.structures.length, 'structure')})`, { action: { label: 'Undo', run: () => this.undo() } });
    return structure;
  }

  async _openSampleAsNew(s, { offerAdd, adaptBackground }) {
    if (!(await this.confirmLeave(`open ${s.name}`))) return null;
    const prev = { project: this.project, undo: this.undoStack, redo: this.redoStack, dirty: this.dirty, camera: this.structure ? this.viewer.getCameraState() : null };
    const structure = this._openSample(s, { adaptBackground });
    const fresh = this.project;
    const back = () => {
      if (this.project !== fresh || !this.pristine) { toast('The sample has been changed since, so it stays a separate project.'); return; }
      this._switchProject(prev.project);
      this.undoStack = prev.undo; this.redoStack = prev.redo; this.dirty = prev.dirty;
      this._activate(prev.project.activeStructure, { camera: prev.camera });
      this.setSaveState(this.dirty ? 'dirty' : prev.project.location ? 'saved' : 'idle');
      this.emit('project'); this.emit('history');
      this._addSample(s);
    };
    toast(`Opened ${s.name} in a new project`, offerAdd ? { timeout: 8000, action: { label: 'Add to current instead', run: back } } : {});
    return structure;
  }

  /**
   * In a dark interface, samples whose look has a light background get a dark one (the look's backgroundDark)
   * and unit-cell lines that show on it (the look's cellDark). Only used for fresh samples, never saved projects.
   */
  _adaptBackground(lookId) {
    const l = looks.get(lookId);
    if (!this._isDarkUI() || !isLightBackground(l?.scene?.display?.background)) return;
    const d = this.scene.display, bg = deepClone(l.backgroundDark ?? DARK_BG);
    d.background = bg;
    // the look's cell colour was picked for its light background; a backgroundDark that stays light keeps it
    const cell = l.cellDark ?? (isLightBackground(bg) ? null : DARK_CELL);
    if (cell && d.cell && d.cell.color === (l.scene.display.cell?.color ?? d.cell.color)) d.cell.color = cell;
    this.viewer.applySettings(this.scene);
    this.emit('scene');
  }

  async importFiles(files) {
    for (const f of [...files]) {
      const busy = this._busyStart(`Reading ${f.name}…`);
      try {
        const text = await readText(f);
        if (/\.json$/i.test(f.name) && /"(crystallume|atomscope)\.project/.test(text.slice(0, 400))) {
          const doc = JSON.parse(text);
          busy.end();   // the file is read; do not keep the spinner up while the unsaved-changes dialog waits
          await this._openImportedProject(doc, f.name);
          continue;
        }
        let structure;
        const fmt = detectFormat(f.name, text);
        if (!fmt && this.storage.get('server')) structure = await this.serverStore.parse(f);
        else structure = await this._parse(text, f.name, fmt);
        structure = toStructure(structure);
        if (!structure.name || structure.name === 'Untitled') structure.name = f.name;
        this.addStructure(structure, { name: f.name.replace(/\.[^.]+$/, '') });
        const w = structure.info?.warning;
        toast(`Loaded ${f.name} — ${structure.length} atoms${structure.nFrames > 1 ? `, ${structure.nFrames} frames` : ''}${w ? ` (${w})` : ''}`);
      } catch (err) {
        if (err.project) {
          busy.end();
          try { await this._openImportedProject(err.project, f.name); continue; } catch (e2) { err = e2; }
        }
        console.warn(`Could not open ${f.name}`, err);
        toast(`Could not open ${f.name}: ${err.message}`, { type: 'error' });
      } finally { busy.end(); }
    }
  }

  /** A project file opens as a new project (new id), so saving never overwrites a stored project with the same id. */
  async _openImportedProject(doc, filename) {
    if (!(await this.confirmLeave(`open ${filename}`))) return false;
    this.loadProjectJSON({ ...doc, id: uid('p'), importedFrom: doc.id ?? null }, null);
    this.markDirty();
    toast(`Opened “${this.project.name}” as a new project`);
    return true;
  }

  async importText(text, name = 'pasted', format = null) {
    const structure = await this._parse(text, name, format);
    this.addStructure(structure);
    return structure;
  }

  /** parseStructure that also awaits readers returning a Promise (e.g. server-backed formats, `server: true`). */
  async _parse(text, filename, format = null) {
    const fmt = formats.get(format ?? detectFormat(filename, text));
    if (!fmt?.server || !fmt.read) return toStructure(await parseStructure(text, filename, format));
    const s = toStructure(await fmt.read(text, filename));
    if (!s?.length) throw new Error('The file was read but contains no atoms.');
    if (!s.info.source) s.info.source = fmt.id;
    return s;
  }

  // ------------------------------------------------------------------ storage
  providerFor(id) { return this.storage.get(id); }

  /**
   * Save the open project (to its location, or `providerId`). Saves run one at a time: a save requested
   * while one is running runs once more afterwards, at the location the first one created.
   * Resolves true when stored, false when it failed (the state and a message are shown).
   */
  saveTo(providerId, opts = {}) {
    this._autosave.cancel();
    const proj = this.project;
    if (this._saving) {
      if (this._savingFor === proj) {
        const q = (this._again ??= { proj, providerId: undefined, quiet: true, force: false, doc: null, promise: null, chosen: false });
        // a location the user picked (Save > …) is kept; a later autosave or retry does not send it back
        if (providerId !== undefined && (!q.chosen || !opts.quiet)) { q.providerId = providerId; q.chosen ||= !opts.quiet; }
        q.quiet = q.quiet && !!opts.quiet;
        q.force = q.force || !!opts.force;
        q.promise ??= this._saving.then(() => this._runAgain(q), () => this._runAgain(q));
        return q.promise;
      }
      const later = () => (this.project === proj ? this.saveTo(providerId, opts) : false);
      return this._saving.then(later, later);
    }
    return this._startSave(proj, providerId, opts);
  }

  _startSave(proj, providerId, opts) {
    const p = this._saveNow(proj, providerId, opts);
    this._saving = p; this._savingFor = proj;
    const done = () => { if (this._saving === p) { this._saving = null; this._savingFor = null; } };
    p.then(done, done);
    return p;
  }

  _runAgain(q) {
    if (this._again === q) this._again = null;
    if (this.project !== q.proj && !q.doc) return false;
    if (this.project === q.proj && q.quiet && !this.dirty) return true;
    // an autosave or retry follows the location the save that just ran created; a location the user picked is kept
    const pid = q.chosen ? q.providerId : (q.proj.location?.provider ?? q.providerId);
    return this._startSave(q.proj, pid, q);
  }

  async _saveNow(proj, providerId, { quiet = false, force = false, doc: preDoc = null } = {}) {
    providerId ??= proj.location?.provider ?? this.defaultProvider;
    const prov = this.storage.get(providerId);
    if (!prov) throw new Error('That storage location is not available here.');
    const current = () => this.project === proj;
    if (!preDoc && !current()) return false;   // nothing to save: the project was closed without a snapshot
    const cloud = providerId === 'server' && this.serverStore.info?.mode === 'cloud';
    // saving somewhere else stores a copy with a new identity there; the location switches once it is stored
    const here = proj.location?.provider === providerId ? proj.location : null;
    // never write into another account's copy
    if (cloud && here) {
      const me = this.serverStore.user?.id ?? null;
      if (!me || (here.user && here.user !== me)) {
        const msg = me ? 'Signed in as a different user' : 'Sign in to save to the server';
        if (current()) this.setSaveState('error', msg);
        this._needAuth(proj, !quiet);
        if (!quiet) toast(`Not saved: ${msg}.`, { type: 'error', action: me ? { label: 'Save a copy to my account', run: () => this.saveAsCopy('server') } : undefined });
        return false;
      }
    }
    const rev = this._rev;
    if (current()) this.setSaveState('saving');
    const doc = preDoc ?? this.projectToJSON({ thumbnail: quiet ? 'auto' : true });
    const base = here ? proj.updated ?? null : null;
    doc.updated = new Date().toISOString();
    delete doc.location; delete doc.baseUpdated;
    if (here) { doc.location = { ...here }; doc.baseUpdated = base; }
    const where = prov.where ?? `in ${prov.label}`;   // 'in this browser', 'in your cloud account', 'in folder X' (as the save chip)
    const busy = quiet ? null : this._busyStart(`Saving ${where}…`);
    try {
      const saved = await prov.save(doc, { force, baseUpdated: base });
      proj.location = { provider: providerId, id: saved?.__locationId ?? saved?.id ?? doc.id };
      if (cloud) proj.location.user = this.serverStore.user?.id ?? null;
      if (providerId === 'server' && saved?.id) proj.id = saved.id;
      proj.updated = saved?.updated ?? doc.updated;
      proj.thumbnail = doc.thumbnail;
      proj._conflict = false; proj._conflictShown = false; proj._authNotified = false;
      this._clearRecovery(proj);
      if (this._retry?.proj === proj) this._cancelRetry();
      if (current()) {
        this.dirty = this._rev !== rev;   // edits made while saving are still unsaved
        this.setSaveState(this.dirty ? 'dirty' : 'saved');
        if (!quiet) toast(`Saved ${where}`);
        this.emit('project'); this.emit('saved');
      }
      return true;
    } catch (err) {
      const code = err?.code;
      if (current()) this.setSaveState('error', code === 'conflict' ? 'Changed elsewhere' : err.message);
      this._writeRecovery(proj, doc);
      if (code === 'conflict') { proj._conflict = true; this._onConflict(proj, providerId, quiet); }
      else if (code === 'auth') this._needAuth(proj, !quiet);
      else if (!NO_RETRY.has(code)) this._scheduleRetry(proj, providerId);
      if (!quiet && code !== 'conflict') toast(`Save failed: ${err.message}`, { type: 'error' });
      else console.warn('autosave failed', err);
      return false;
    } finally { busy?.end(); }
  }

  _needAuth(proj, always) {
    if (!always && proj._authNotified) return;
    proj._authNotified = true;
    this.emit('needAuth');
  }

  /** Save the open project as a new project ("<name> (copy)") at `providerId`. */
  async saveAsCopy(providerId = this.project.location?.provider ?? this.defaultProvider) {
    await this.flushSave();
    const p = this.project;
    p.location = null; p.id = uid('p'); p.name = `${p.name} (copy)`; p.updated = null;
    p._conflict = false; p._conflictShown = false;
    this.emit('project');
    return this.saveTo(providerId);
  }

  _onConflict(proj, providerId, quiet) {
    if (this.project !== proj || (quiet && proj._conflictShown) || this._conflictDlg?.el?.isConnected) return;
    proj._conflictShown = true;
    const loc = proj.location ? { ...proj.location } : null;
    this._conflictDlg = dialog({
      title: 'This project was changed somewhere else',
      body: h('div', { style: { display: 'grid', gap: '8px' } },
        h('p', `“${proj.name}” was saved from another tab, device or account after you opened it, so your changes were not saved yet.`),
        h('p.hint', 'Save mine as a copy keeps both versions. Overwrite replaces the other version with yours.')),
      actions: [
        loc ? { label: 'Reload their version', run: () => { this._clearRecovery(proj); this.openProject(loc.provider, loc.id, { force: true }).catch((e) => toast(e.message, { type: 'error' })); } } : null,
        { label: 'Overwrite', danger: true, run: () => { this.saveTo(providerId, { force: true }); } },
        { label: 'Save mine as a copy', primary: true, run: () => { this.saveAsCopy(providerId); } },
      ].filter(Boolean),
    });
  }

  async autosave() {
    if (!this.dirty || !this.structure || this.prefs.autosave === false || this.project._conflict) return false;
    const target = this.project.location?.provider ?? this.defaultProvider;
    if (target === 'folder' && !this.folderStore.connected) return false;
    if (!this.storage.get(target)) return false;
    return this.saveTo(target, { quiet: true });
  }

  /** Wait until pending and running saves of the open project are done (runs a pending autosave now). */
  async flushSave() {
    if (this._autosave.pending()) { this._autosave.cancel(); await this.autosave(); }
    else if (this._retry && this._retry.proj === this.project && this.dirty && !this._saving) await this.saveTo(this._retry.providerId, { quiet: true });
    await this._waitSaves();
  }

  async _waitSaves() {
    while (this._saving || this._again) {
      try { await (this._again?.promise ?? this._saving); } catch { /* reported by saveTo */ }
    }
  }

  /**
   * Before leaving the open project: save it (autosave on) or ask Save / Don't save / Cancel when changes
   * would be lost. Resolves true to go ahead, false to stay.
   */
  async confirmLeave(actionLabel = 'continue') {
    try {
      if (this.prefs.autosave !== false || this._saving) await this.flushSave();
      if (!this._hasUnsaved()) return true;
      const choice = await this._askSave(actionLabel);
      if (choice === 'save') return await this.saveTo(this.project.location?.provider ?? this.defaultProvider);
      if (choice === 'discard') { this._clearRecovery(this.project); return true; }
      return false;
    } catch (e) {
      toast(e.message, { type: 'error' });
      return false;
    }
  }

  _askSave(actionLabel) {
    const name = this.project.name;
    const why = this.saveState === 'error' && this.saveDetail ? ` The last save failed: ${this.saveDetail}.` : '';
    return new Promise((resolve) => {
      dialog({
        title: `Save changes to “${name}”?`,
        body: h('p', `This project has changes that are not saved yet.${why} Save them before you ${actionLabel}?`),
        actions: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Don’t save', value: 'discard', danger: true },
          { label: 'Save', value: 'save', primary: true },
        ],
        onClose: (v) => resolve(v ?? 'cancel'),
      });
    });
  }

  /** Open a stored project. Asks about unsaved changes first unless {force:true}. Resolves false if cancelled. */
  async openProject(providerId, id, { force = false } = {}) {
    const prov = this.storage.get(providerId);
    if (!prov) throw new Error('That storage location is not available here.');
    if (!force && !(await this.confirmLeave('open another project'))) return false;
    const doc = await prov.get(id);
    const loc = { provider: providerId, id };
    if (providerId === 'server' && this.serverStore.info?.mode === 'cloud') loc.user = this.serverStore.user?.id ?? null;
    this.loadProjectJSON(doc, loc);
    toast(`Opened “${this.project.name}”`);
    return true;
  }

  /** Delete a stored project. Resolves to the deleted document (for Undo via restoreProject), or null. */
  async deleteProject(providerId, id) {
    const prov = this.storage.get(providerId);
    if (!prov) throw new Error('That storage location is not available here.');
    const isOpen = () => this.project.location?.provider === providerId && this.project.location?.id === id;
    if (isOpen()) { this._autosave.cancel(); await this._waitSaves(); }
    let doc = null;
    try { doc = await prov.get(id); } catch { /* unreadable: delete anyway */ }
    await prov.remove(id);
    if (isOpen()) {
      this._autosave.cancel(); this._cancelRetry(); this._clearRecovery(this.project);
      this.project.location = null;
      this.dirty = false;
      this.setSaveState('idle');
    }
    this.emit('providers'); this.emit('project');
    return doc;
  }

  /** Store a deleted project again (Undo after delete). Re-links the open project when it is that project. */
  async restoreProject(providerId, doc) {
    const prov = this.storage.get(providerId);
    if (!prov || !doc) throw new Error('That project cannot be restored here.');
    const { location: _l, ...body } = doc;
    const saved = await prov.save(body);
    const p = this.project;
    if (!p.location && p.id === doc.id) {
      p.location = { provider: providerId, id: saved?.__locationId ?? saved?.id ?? doc.id };
      if (providerId === 'server' && this.serverStore.info?.mode === 'cloud') p.location.user = this.serverStore.user?.id ?? null;
      if (providerId === 'server' && saved?.id) p.id = saved.id;
      p.updated = saved?.updated ?? p.updated;
      this.setSaveState(this.dirty ? 'dirty' : 'saved');
      if (this.dirty) this.markDirty();
      this.emit('project');
    }
    this.emit('providers');
    return saved;
  }

  async duplicateProject(providerId, id) {
    const prov = this.storage.get(providerId);
    const doc = await prov.get(id);
    const now = new Date().toISOString();   // a new project: never "updated" before it was created (the server keeps both)
    const copy = { ...doc, id: uid('p'), name: `${doc.name} (copy)`, created: now, updated: now };
    delete copy.location;
    const saved = await prov.save(copy);
    this.emit('providers');
    return saved;
  }

  async downloadProject() {
    const doc = this.projectToJSON();
    return saveFile(`${slug(this.project.name)}.crystallume.json`, JSON.stringify(doc, null, 1), 'application/json');
  }

  // ------------------------------------------------------------------ save retries + recovery draft
  _scheduleRetry(proj, providerId) {
    if (this._retry?.proj !== proj) { this._cancelRetry(); this._retry = { proj, providerId, n: 0, timer: 0 }; }
    const r = this._retry;
    r.providerId = providerId;
    clearTimeout(r.timer);
    if (r.n < RETRY_DELAYS.length) r.timer = setTimeout(() => this._runRetry(r), RETRY_DELAYS[r.n++]);
  }
  _runRetry(r) {
    if (this._retry !== r) return;
    clearTimeout(r.timer);
    if (this.project !== r.proj || !this.dirty || r.proj._conflict) { this._cancelRetry(); return; }
    this.saveTo(r.providerId, { quiet: true });
  }
  _cancelRetry() { if (this._retry) clearTimeout(this._retry.timer); this._retry = null; }

  _writeRecovery(proj, doc = null) {
    try {
      if (typeof this.browserStore.kvSet !== 'function') return;
      if (!doc && this.project !== proj) return;
      const d = { ...(doc ?? this.projectToJSON({ thumbnail: false })), thumbnail: null };
      delete d.location; delete d.baseUpdated;
      if (proj.updated) d.updated = proj.updated;   // the stored version this draft is based on
      this._recovery = { proj, id: d.id };
      Promise.resolve(this.browserStore.kvSet(RECOVERY_KEY, { location: proj.location ?? null, doc: d, at: new Date().toISOString() })).catch(() => {});
    } catch (e) { console.warn('could not keep a recovery copy', e); }
  }
  _clearRecovery(proj) {
    const r = this._recovery;
    if (!r || (r.proj !== proj && r.id !== proj.id)) return;
    this._recovery = null;
    try { Promise.resolve(this.browserStore.kvSet?.(RECOVERY_KEY, null)).catch(() => {}); } catch { /* ignore */ }
  }

  /** Offer changes that were never stored (save failed, tab closed) when they are newer than the stored copy. */
  async _checkRecovery() {
    if (typeof this.browserStore.kvGet !== 'function') return;
    const draft = await this.browserStore.kvGet(RECOVERY_KEY);
    if (!draft?.doc || !Array.isArray(draft.doc.structures)) return;
    const loc = draft.location;
    const prov = loc?.provider ? this.storage.get(loc.provider) : null;
    if (prov) {
      let stored = null;
      try { stored = await prov.get(loc.id); } catch { /* missing or unreachable: offer the draft */ }
      if (stored && (Date.parse(stored.updated ?? '') || 0) >= (Date.parse(draft.at) || 0)) {
        await this.browserStore.kvSet(RECOVERY_KEY, null);
        return;
      }
    }
    // offered on at most three startups, so an ignored draft does not nag forever
    draft.offered = (draft.offered ?? 0) + 1;
    await this.browserStore.kvSet(RECOVERY_KEY, draft.offered >= 3 ? null : draft);
    this._recovery = { proj: null, id: draft.doc.id };
    toast(`Unsaved changes from ${relativeTime(draft.at).replace('just now', 'a moment ago')} were recovered`, {
      timeout: 15000,
      action: { label: 'Restore', run: () => { this.restoreRecovery(draft).catch((e) => toast(e.message, { type: 'error' })); } },
    });
  }

  async restoreRecovery(draft) {
    if (!(await this.confirmLeave('restore the recovered changes'))) return false;
    this.loadProjectJSON(draft.doc, draft.location ?? null);
    this._recovery = { proj: this.project, id: this.project.id };
    this.markDirty();
    toast(`Restored “${this.project.name}”`);
    return true;
  }

  // ------------------------------------------------------------------ busy state
  /** Mark a long task; returns {set(label), end()}. Emits 'busy' {busy, label}. */
  _busyStart(label) {
    const tok = { label };
    this._busyOps.push(tok);
    this._emitBusy();
    let ended = false;
    return {
      set: (l) => { tok.label = l; this._emitBusy(); },
      end: () => { if (ended) return; ended = true; const i = this._busyOps.indexOf(tok); if (i >= 0) this._busyOps.splice(i, 1); this._emitBusy(); },
    };
  }
  _emitBusy() {
    const top = this._busyOps.at(-1);
    this.busy = !!top;
    this.busyLabel = top?.label ?? '';
    this.emit('busy', { busy: this.busy, label: this.busyLabel });
  }

  // ------------------------------------------------------------------ export
  async exportImage({ scale = 2, transparent = false } = {}) {
    if (!this.structure) throw new Error('Nothing to export yet.');
    if (this._exporting) return false;   // one image at a time
    this._exporting = true;
    const busy = this._busyStart(`Rendering ${scale}× image…`);
    try {
      await pause();   // let the busy indicator paint before the heavy render
      const blob = await this.viewer.screenshot({ scale, transparent });
      busy.set('Saving image…');
      const ok = await saveFile(`${slug(this.structure.name)}${transparent ? '-transparent' : ''}@${scale}x.png`, blob, 'image/png');
      if (ok) toast(`Image saved (${Math.round(this.viewer.width * scale)}×${Math.round(this.viewer.height * scale)} px)`);
      return ok;
    } finally { busy.end(); this._exporting = false; }
  }

  async exportGLB() {
    if (!this.structure) throw new Error('Nothing to export yet.');
    const busy = this._busyStart('Building 3D model…');
    try {
      await pause();
      const blob = await this.viewer.exportGLB();
      const name = `${slug(this.structure.name)}.glb`;
      // sandboxed viewers only save common file types, so the model travels inside a .zip there
      const ok = isArtifact() ? await saveFile(`${name}.zip`, await makeZip([{ name, data: blob }]), 'application/zip') : await saveFile(name, blob, 'model/gltf-binary');
      if (ok) toast(isArtifact() ? `Saved ${name} inside a .zip` : `Saved ${name}`);
      return ok;
    } finally { busy.end(); }
  }

  async exportStructureFile(formatId) {
    if (!this.structure) throw new Error('Nothing to export yet.');
    const busy = this._busyStart(`Exporting ${formats.get(formatId)?.name ?? formatId}…`);
    try {
      const out = await exportStructure(this.structure, formatId);
      const text = await out.text;
      const { filename, mime } = out;
      const direct = !isArtifact() || /\.(txt|json|csv|md)$/.test(filename);
      const ok = direct ? await saveFile(filename, text, mime) : await saveFile(`${filename}.zip`, await makeZip([{ name: filename, data: text }]), 'application/zip');
      if (ok) toast(direct ? `Saved ${filename}` : `Saved ${filename} inside a .zip`);
      return ok;
    } finally { busy.end(); }
  }

  // ------------------------------------------------------------------ prefs
  setPref(k, v) { this.prefs[k] = v; savePrefs(this.prefs); this.emit('prefs'); }
}

export { formats, samples };
