/**
 * App controller: owns the project, the active structure, scene settings, history, storage and the
 * viewer, and exposes the actions that the UI, the command palette, shortcuts and plugins call.
 *
 * Events (app.on):
 *   'project' | 'structure' | 'selection' | 'scene' | 'tool' | 'measure' | 'providers' | 'prefs'
 *   'saveState' state            — 'idle' | 'dirty' | 'saving' | 'saved' | 'error' (detail in app.saveDetail)
 *   'saved'                      — the open project was stored
 *   'history'                    — undo/redo stacks changed (see undoLabel(), redoLabel(), canUndo())
 *   'busy' {busy, label, cancel} — a long task started or ended (export, import, explicit save, startTask);
 *                                  cancel stops the newest task (startTask with cancel), else null
 *   'auth' user|null             — the server account changed (sign in, sign out, expired session)
 *   'needAuth'                   — a save needs the user to sign in (again)
 */
import { Emitter } from './core/events.js';
import { Structure, getWarnings, newWarnings, invertSourceMap, composeSourceMaps } from './core/structure.js';
import { structureDigest } from './core/analyses.js';
import { uid, deepClone, deepMerge, setPath, getPath, debounce, relativeTime } from './core/util.js';
import { parseStructure, exportStructure, formats, detectFormat } from './io/index.js';
import { samples } from './build/samples.js';
import { Viewer } from './render/viewer.js';
import { tools } from './render/tools/index.js';
import './render/tools/select.js';
import './render/tools/measure.js';
import { bondedFragment } from './render/display.js';
import { makeScene, DEFAULT_SCENE } from './render/settings.js';
import { colorExtrasFrom } from './render/colors.js';
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
import { keyLabel } from './ui/keys.js';
import { h } from './ui/dom.js';
import { makeZip } from './core/zip.js';
import { HistoryStore, historyBudget, snapStructure, snapPositions, structureFromSnap, applyPositionsSnap, patchPositions, mergePositions, BUDGET_NOTICE, INCONSISTENT, HistoryError } from './core/history.js';
import { cleanMeasurementList, remapMeasurementList, migrateMeasurementKeys, newMeasurementId, wholeCellShifts, measurementsRemovedNote } from './core/measure.js';

export const VERSION = '0.3.2';
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
  ['post.vignette', 'Vignette'], ['post.fog', 'Depth cueing'], ['post.dropShadow', 'Drop shadows'], ['post.paper', 'Paper texture'], ['post', 'Effects'],
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
/**
 * Saved measurements that can be shown, as {id, type, refs} (core/measure.js): a known type with its number of atoms
 * (others are dropped). The `keys` of projects saved before references existed are migrated against `structure` and
 * the display.wrap of `scene`. Ids are kept (undo snapshots) unless `newIds` (an opened project: ids are not saved).
 */
const cleanMeasurements = (list, structure = null, scene = null, { newIds = false } = {}) =>
  cleanMeasurementList(list, structure, { wrap: scene?.display?.wrap !== false, newIds });
/** A measurement as entries and snapshots keep it: {id, type, refs}. */
const measurementRecord = (m) => ({ id: m.id, type: m.type, refs: Array.isArray(m.refs) ? m.refs.slice() : m.refs });
const toStructure = (s) => (s instanceof Structure ? s : Structure.fromJSON(s));
const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ edit helpers (editActive, replaceActiveStructure)
/** How an edit redraws: everything, colours and halos only (atoms, positions, cell and elements unchanged), or nothing (info only). */
const REBUILDS = Object.freeze(['full', 'appearance', 'none']);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** A note as a sentence for the interface: first letter upper case, ending in a full stop (ledger-F0 §0.3). */
const sentence = (t) => { const s = String(t).trim(); return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?…]$/.test(s) ? '' : '.'}` : s; };
/** An edit's toast text: the caller's message as given, then the notes (dropped frames, removed measurements…) as sentences. */
function editToastText(message, notes) {
  const extra = notes.filter((n) => typeof n === 'string' && n.trim()).map(sentence);
  if (!message) return extra.join(' ');
  return extra.length ? [sentence(message), ...extra].join(' ') : String(message);
}
/** The rebuild modes by how much they draw: an edit with edits inside its fn draws as much as the widest of them. */
const REBUILD_RANK = Object.freeze({ none: 0, appearance: 1, full: 2 });
const widerRebuild = (a, b) => (REBUILD_RANK[b] > REBUILD_RANK[a] ? b : a);

/**
 * The source map (new → old) of a change the change tracker could not follow (an edit that lost the lineage): the same
 * atoms, or the extra ones appended at the end. Fewer atoms are refused, as resolveIndexMap refuses them — unless
 * `guess` (an edit that failed inside another one, whose step goes on): then the first atoms count as the ones kept.
 */
function untrackedSource(n0, n1, label, { guess = false } = {}) {
  if (n1 < n0 && !guess) throw new Error(`editActive “${label}”: atoms were removed, so pass indexMap or src.`);
  const out = new Int32Array(n1);
  for (let j = 0; j < n1; j++) out[j] = j < n0 ? j : -1;
  return out;
}

/** The source map (new → old) of an old → new map onto n1 atoms: each comes from the first old atom mapped to it (−1: none). */
function sourceOfMap(map, n1) {
  const out = new Int32Array(n1).fill(-1);
  for (let i = 0; i < map.length; i++) { const j = map[i]; if (j >= 0 && j < n1 && out[j] < 0) out[j] = i; }
  return out;
}

/** Two changes in a row as one source map (new → old); `first` null: nothing changed before `second`. */
const chainSources = (first, second) => (first ? composeSourceMaps(first, second) : Int32Array.from(second, (v) => v ?? -1));

/**
 * The old → new atom map of an edit (F0-A §3.2) as {map: Int32Array(n0), changed}. From `indexMap` (old → new: a list,
 * an Int32Array or a function; values that are not whole numbers in [0, n1) become −1), else from `src` (new → old, one
 * entry per new atom, −1 or null for a new atom; an old atom with several new ones maps to the first), else by the
 * fallback rule: the same number of atoms keeps every atom, more atoms count as appended at the end, fewer throw
 * `<what> “<label>”: atoms were removed, so pass indexMap or src.` `changed`: not the identity on the same atoms.
 */
export function resolveIndexMap({ indexMap = null, src = null, n0, n1, label = 'Edit structure', what = 'editActive' } = {}) {
  const map = new Int32Array(n0);
  if (indexMap != null) {
    const fn = typeof indexMap === 'function' ? indexMap : null;
    if (!fn && !Array.isArray(indexMap) && !ArrayBuffer.isView(indexMap)) throw new TypeError(`${what}: indexMap must be a list, an Int32Array or a function (old index → new index).`);
    for (let i = 0; i < n0; i++) {
      const j = fn ? fn(i) : indexMap[i];
      map[i] = Number.isInteger(j) && j >= 0 && j < n1 ? j : -1;
    }
  } else if (src != null) {
    if (!Array.isArray(src) && !ArrayBuffer.isView(src)) throw new TypeError(`${what}: src must be a list or an Int32Array (new index → old index).`);
    if (src.length !== n1) throw new RangeError(`${what} “${label}”: src has ${src.length} entries for ${n1} atoms.`);
    map.set(invertSourceMap(src, n0));
  } else if (n1 < n0) {
    throw new Error(`${what} “${label}”: atoms were removed, so pass indexMap or src.`);
  } else {
    for (let i = 0; i < n0; i++) map[i] = i;
  }
  let changed = n0 !== n1;
  for (let i = 0; i < n0 && !changed; i++) changed = map[i] !== i;
  return { map, changed };
}

export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; } }
export function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

export class App extends Emitter {
  constructor(viewportEl) {
    super();
    this.prefs = loadPrefs();
    this.viewer = new Viewer(viewportEl);
    this.viewer.toolProvider = () => this.tool;   // box and lasso selection (left-drag) only with the Select tool
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
    this.history = this._newHistory();
    this._authUser = null;
    this._rev = 0;               // bumped on every edit; tells a finished save whether newer edits exist
    this._sceneBefore = null; this._sceneLabel = null; this._tx = null;
    this._editScope = null;      // the editActive whose fn is running (edits made inside it join it)
    this._saving = null; this._savingFor = null; this._again = null; this._retry = null; this._recovery = null;
    this._busyOps = [];
    this._measGuard = 0;
    this._exporting = false;
    this._commitScene = debounce(() => this._pushSceneHistory(), 650);
    this._autosave = debounce(() => this.autosave(), 2500);
    this.serverStore.onAuth = (u) => this._onAuth(u);
    this.viewer.on('atomclick', (e) => this._onAtomClick(e));
    this.viewer.on('atomdblclick', (e) => this._onAtomDblClick(e));
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
    // a server that wants a token (local mode with FACET_TOKEN, or cloud) is used once signed in (see _onAuth)
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
   * The project as a `facet.project/1` document.
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
      schema: 'facet.project/1', id: p.id, name: p.name, description: p.description, tags: p.tags, created: p.created, updated: p.updated ?? p.created,
      thumbnail: thumb,
      activeStructure: p.activeStructure,
      structures: p.structures.map((s) => {
        // {type, refs}: ids belong to the session and are not saved
        const ms = (s === active ? this._viewerMeasurements() : (s.measurements ?? [])).filter((m) => Array.isArray(m.refs)).map((m) => ({ type: m.type, refs: m.refs.slice() }));
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
    if (!doc || !Array.isArray(doc.structures)) throw new Error('This file is not a Facet project.');
    const scene = makeScene(doc.scene);
    // measurements saved as {type, keys} (before 0.4) become {type, refs} against the structure and the project's wrapping
    const entryOf = (s) => {
      const structure = Structure.fromJSON(s.structure);
      return { id: s.id ?? uid('s'), name: s.name ?? s.structure?.name ?? 'Structure', structure, measurements: cleanMeasurements(s.measurements, structure, scene, { newIds: true }) };
    };
    const p = {
      id: doc.id ?? uid('p'), name: doc.name ?? 'Untitled project', description: doc.description ?? '', tags: doc.tags ?? [], created: doc.created ?? new Date().toISOString(), updated: doc.updated ?? null,
      structures: doc.structures.map(entryOf),
      activeStructure: doc.activeStructure, scene, location, thumbnail: doc.thumbnail ?? null,
    };
    if (doc.importedFrom) p.importedFrom = doc.importedFrom;
    // projects saved before lookBase existed: the look they show, not the default's ('studio')
    if (doc.scene && !('lookBase' in doc.scene)) p.scene.lookBase = doc.scene.look ?? null;
    if (!p.structures.find((s) => s.id === p.activeStructure)) p.activeStructure = p.structures[0]?.id ?? null;
    const prev = { project: this.project, history: this.history.detach(), dirty: this.dirty, state: this.saveState, camera: this.structure ? this.viewer.getCameraState() : null, selection: this.selection };
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
    this.history.clear();
    this.dirty = false;
    this.measurePicks = [];
    this.viewer.selection?.clear?.();   // the old project's atoms; _activate redraws the halos and emits 'selection'
    this.emit('history');
  }

  _restorePrevious(prev) {
    this.project = prev.project; this.history.attach(prev.history); this.dirty = prev.dirty;
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
    this._switchOverlays(entry);
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
   * Add a structure to the project (F0-A §3.3). replaceProject: 'auto' (the default) replaces a pristine scratch project
   * (an empty one or an untouched sample) by a new project holding the structure, as opening a file does; true always
   * replaces (newProject: true is the same); false always adds to the open project, as one undo step — the choice of
   * tools that make a new structure next to the one they start from (Duplicate, cleaving), which must not lose it.
   * `look` only applies to a new project: adding to existing work keeps the user's look. `name` names a new project
   * (and a structure without a name), `label` the undo step (default "Add <name>"), `activate: false` adds it to the
   * open project without showing it (a new project always shows it). If the viewer cannot show the structure, nothing
   * changes and the error is rethrown.
   * Returns {entry, historyEntry}: the project entry, and the undo step (null when the project was replaced, or inside
   * an open transaction, whose step it joins) — for app.toastUndo, also after an await.
   */
  addStructure(structure, { look = null, scene = null, newProject = false, replaceProject = newProject ? true : 'auto', name = null, label = null, activate = true } = {}) {
    if (replaceProject !== 'auto' && replaceProject !== true && replaceProject !== false) throw new TypeError("addStructure: replaceProject must be 'auto', true or false.");
    if (replaceProject === true || (replaceProject === 'auto' && this.pristine)) {
      const prev = { project: this.project, history: this.history.detach(), dirty: this.dirty, state: this.saveState, camera: this.structure ? this.viewer.getCameraState() : null, selection: this.selection, scene: JSON.stringify(this.project.scene) };
      const proj = this._blankProject(name ?? structure.name ?? 'Untitled project');
      // replacing a pristine scratch project keeps the settings chosen so far (an untouched sample's are not the
      // user's); a new project asked for (true, or newProject: true) starts from the default look
      if (replaceProject === 'auto' && !this.project._fromSample) proj.scene = this.project.scene;
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
      return { entry, historyEntry: null };   // a new project starts with an empty history
    }
    if (name && !structure.name) structure.name = name;
    let entry;
    this.transaction(label ?? `Add ${structure.name || 'structure'}`, () => {
      this._pushStructureHistory(null, null);   // the layout only: no existing structure changes
      entry = this._newEntry(structure);
      this.project.structures.push(entry);
      if (scene) deepMerge(this.scene, deepClone(scene));
      if (activate) this._activate(entry.id);
    });
    const historyEntry = this._tx ? null : this.history.lastRecorded?.entry ?? null;
    this.markDirty();
    this.emit('project');
    return { entry, historyEntry };
  }

  removeStructure(sid) {
    const i = this.project.structures.findIndex((s) => s.id === sid);
    if (i < 0) return;
    this._pushStructureHistory(`Remove ${this.project.structures[i].name}`, { id: sid, how: 'full' });
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
  // app.history (core/history.js) holds the steps. A structure step keeps a ProjectSnap: the project layout
  // plus binary snapshots of only the entries the step changes; the other entries keep their Structure
  // objects (and analysis caches) through undo and redo.
  /** Label of the step Undo would revert (e.g. 'Delete 2 atoms'), or null. */
  undoLabel() { return this._sceneBefore != null ? this._sceneLabel : (this.history.top()?.label ?? null); }
  redoLabel() { return this._sceneBefore != null ? null : (this.history.redoTop()?.label ?? null); }
  canUndo() { return this._sceneBefore != null || this.history.length > 0; }
  canRedo() { return this._sceneBefore == null && this.history.redoLength > 0; }
  /** Deprecated, use app.history: read-only copies of the undo and redo steps, oldest first. */
  get undoStack() { return this.history.stacks().undo; }
  get redoStack() { return this.history.stacks().redo; }
  /** The undo store: 80 steps within this device's byte budget; says once when the budget costs steps. */
  _newHistory(budget = historyBudget()) { return new HistoryStore({ ...budget, onBudget: () => toast(BUDGET_NOTICE) }); }

  /**
   * Run fn as one undo step: scene and structure changes made inside are recorded together under `label`.
   * Nested transactions join the outer one. If fn throws, its changes are rolled back and the error rethrown
   * (with the visibility masks and named highlights its edits renumbered: tx.indexed, _followAtoms).
   * fn must be synchronous: the step closes when fn returns, so other edits made while a returned Promise
   * is pending are never folded into it (changes made after an await are recorded as their own steps).
   */
  transaction(label, fn) {
    if (this._tx) return fn();
    this._commitScene.flush();
    const tx = this._tx = { label, sceneBefore: this._sceneJSON(), snap: null, selBefore: null, indexed: undefined };
    const finish = () => {
      this._tx = null;
      const sceneAfter = this._sceneJSON();
      const sc = sceneAfter !== tx.sceneBefore;
      const snap = tx.snap ? { before: tx.snap, after: null } : null;
      if (snap && sc) this._record({ kind: 'both', label, sceneBefore: tx.sceneBefore, sceneAfter, snap, selBefore: tx.selBefore });
      else if (snap) this._record({ kind: 'structure', label, snap, selBefore: tx.selBefore });
      else if (sc) this._record({ kind: 'scene', label, before: tx.sceneBefore, after: sceneAfter });
    };
    const fail = (err) => {
      this._tx = null;
      try {
        if (this._sceneJSON() !== tx.sceneBefore) this._restoreScene(tx.sceneBefore);
        // before the structures are rebuilt: masks of the restored atoms count are kept by setStructure
        if (tx.indexed) this.viewer.restoreIndexedState?.(tx.indexed);
        if (tx.snap) this._applySnap(tx.snap, tx.selBefore);
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
    this.history.record(e);
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
    const top = this.history.top();
    if (label === 'View' && top && top === this.history.lastRecorded?.entry && top.kind === 'scene' && top.label === 'View') {
      if (top.before === after) this.history.popTop();
      else { top.after = after; this.history.replaceTop(top); }
      this.emit('history');
      return;
    }
    if (after !== before) this._record({ kind: 'scene', label, before, after });
    else this.emit('history');
  }

  /** Measurements of project entry `e` for a snapshot (the viewer holds the active entry's). */
  _measOf(e) { return e === this._activeEntry() ? this._viewerMeasurements() : deepClone(e.measurements ?? []); }

  /** The project layout (which structures, in which order, under which names, which one is shown), no structure data. */
  _snapBegin() {
    const p = this.project;
    return { v: 2, active: p.activeStructure, order: p.structures.map((e) => e.id),
      names: Object.fromEntries(p.structures.map((e) => [e.id, e.name])), entries: Object.create(null) };
  }

  /**
   * Record entry `id` in `snap` as it is now, before a change: how = 'full' or { positions: atom indices | null }
   * (null = every atom). The first call for an entry wins; a later call in the same step only widens it.
   */
  _snapTouch(snap, id, how = 'full') {
    const e = this.project.structures.find((x) => x.id === id);
    if (!e) return;
    const s = e.structure, has = snap.entries[id];
    const full = !(how && typeof how === 'object' && 'positions' in how) || s.nFrames > 1;   // several frames: always the whole structure
    if (!has) {
      snap.entries[id] = full ? { full: snapStructure(s), meas: this._measOf(e) } : { positions: snapPositions(s, how.positions), meas: this._measOf(e) };
    } else if (has.positions && full) {
      // positions first, then another edit in the same step: the structure now, with the earlier positions put back
      snap.entries[id] = { full: patchPositions(snapStructure(s), has.positions), meas: has.meas };
    } else if (has.positions) {
      snap.entries[id] = { positions: mergePositions(has.positions, snapPositions(s, how.positions)), meas: has.meas };
    }
  }

  /**
   * Start a structure step (or join the open transaction). `touch` names the entry the step changes and how
   * to snapshot it: { id, how: 'full' | { positions } }, by default the active structure in full; null records
   * the layout only (adding a structure).
   */
  _pushStructureHistory(label = 'Edit structure', touch = { id: this.project.activeStructure, how: 'full' }) {
    this._commitScene.flush();
    if (this._tx) {
      this._tx.snap ??= this._snapBegin();
      this._tx.selBefore ??= this.selection;
      if (touch?.id) this._snapTouch(this._tx.snap, touch.id, touch.how);
      return;
    }
    const snap = this._snapBegin();
    if (touch?.id) this._snapTouch(snap, touch.id, touch.how);
    this._record({ kind: 'structure', label, snap: { before: snap, after: null }, selBefore: this.selection });
  }

  /** The other side of a step: the entries `before` recorded, as they are now, plus the entries added since. */
  _snapAfter(before) {
    const after = this._snapBegin(), had = new Set(before.order);
    for (const [id, es] of Object.entries(before.entries)) this._snapTouch(after, id, es.positions ? { positions: es.positions.indices } : 'full');
    for (const id of after.order) if (!had.has(id)) this._snapTouch(after, id, 'full');
    return after;
  }

  /** Throws HistoryError when `snap` cannot be applied to the project as it is (an entry is missing or has other atoms). */
  _checkSnap(snap) {
    if (!Array.isArray(snap?.order) || !snap.entries) throw new HistoryError();
    const live = new Map(this.project.structures.map((e) => [e.id, e]));
    for (const id of snap.order) {
      const es = snap.entries[id];
      if (es?.full) continue;
      const cur = live.get(id), ps = es?.positions;
      if (!cur || (ps && (cur.structure.length !== ps.n || ps.frame >= cur.structure.nFrames))) throw new HistoryError();
    }
  }

  /** Make the project look like `snap`: snapshot entries are rebuilt or patched, the others are kept as they are. */
  _applySnap(snap, selection = null) {
    this._checkSnap(snap);
    const live = new Map(this.project.structures.map((e) => [e.id, e]));
    this.project.structures = snap.order.map((id) => {
      const es = snap.entries[id];
      // snapshot measurements keep their ids, so a toast's Remove still finds its measurement after undo and redo
      if (es?.full) { const structure = structureFromSnap(es.full); return { id, name: snap.names[id] ?? es.full.name, structure, measurements: cleanMeasurements(es.meas, structure, this.scene) }; }
      const cur = live.get(id), name = snap.names[id] ?? cur.name;
      if (es?.positions) {
        applyPositionsSnap(cur.structure, es.positions);
        cur.structure.touch();
        cur.measurements = cleanMeasurements(es.meas, cur.structure, this.scene);
      }
      // renaming is not an undo step, but a step taken before a rename puts the old name back (as it always has)
      if (cur.name !== name) { if (cur.structure.name === cur.name) cur.structure.name = name; cur.name = name; }
      return cur;
    });
    this._activate(snap.active, { resetCamera: false });
    const n = this.structure?.length ?? 0;
    this.viewer.setSelection((selection ?? []).filter((i) => i >= 0 && i < n));
    this.measurePicks = [];
    this.emit('selection'); this.emit('measure');
    this.emit('project');
  }

  /** A step that no longer fits the project: the history is dropped (nothing was changed yet). */
  _historyBroken(err) {
    console.error(INCONSISTENT, err);
    this.history.clear();
    this.emit('history');
    toast(INCONSISTENT, { type: 'error' });
    return null;
  }

  /** Undo the last step. Returns its label (or null when there is nothing to undo). */
  undo() {
    this._commitScene.flush();
    const e = this.history.popUndo();
    if (!e) { toast('Nothing to undo'); return null; }
    if (e.kind !== 'scene') {
      try { e.snap.after = this._snapAfter(e.snap.before); this._checkSnap(e.snap.before); } catch (err) { return this._historyBroken(err); }
      e.selAfter = this.selection;
    }
    try {
      if (e.kind === 'scene') this._restoreScene(e.before);
      else {
        if (e.kind === 'both') this._restoreScene(e.sceneBefore);
        this._applySnap(e.snap.before, e.selBefore);
      }
    } finally {
      this.history.pushRedo(e);
      this.markDirty(); this.emit('history');
    }
    return e.label ?? null;
  }

  redo() {
    this._commitScene.flush();
    const e = this.history.popRedo();
    if (!e) { toast('Nothing to redo'); return null; }
    if (e.kind !== 'scene') {
      try { e.snap.before = this._snapAfter(e.snap.after); this._checkSnap(e.snap.after); } catch (err) { return this._historyBroken(err); }
      e.selBefore = this.selection;
    }
    try {
      if (e.kind === 'scene') this._restoreScene(e.after);
      else {
        if (e.kind === 'both') this._restoreScene(e.sceneAfter);
        this._applySnap(e.snap.after, e.selAfter);
      }
    } finally {
      this.history.pushUndo(e);
      this.markDirty(); this.emit('history');
    }
    return e.label ?? null;
  }

  // ------------------------------------------------------------------ selection + editing
  get selection() { return [...this.viewer.selection]; }
  /**
   * Select source atoms. mode: 'replace' (default), 'add', 'toggle' (each atom in or out) or 'remove';
   * `add: true` without a mode toggles, as it always has.
   */
  select(indices, { add = false, mode = add ? 'toggle' : 'replace' } = {}) {
    const n = this.structure?.length ?? 0;
    const s = mode === 'replace' ? new Set() : new Set(this.viewer.selection);
    for (const v of indices) {
      const i = Number(v);
      if (!Number.isInteger(i) || i < 0 || i >= n) continue;
      if (mode === 'remove' || (mode === 'toggle' && s.has(i))) s.delete(i); else s.add(i);
    }
    this.viewer.setSelection([...s]);
    this.emit('selection');
  }
  selectElement(sym, add = false, mode = undefined) { if (!this.structure) return; this.select(this.structure.symbols.map((s, i) => (s === sym ? i : -1)).filter((i) => i >= 0), { add, mode }); }
  /**
   * Select the atoms that are not selected. While visibility masks hide atoms (viewer.setVisibility), only the visible
   * ones are inverted: hidden atoms end up unselected, and a toast says how many are hidden.
   */
  invertSelection() {
    if (!this.structure) return;
    const v = this.viewer, s = v.selection, hidden = v.hiddenCount ?? 0;
    const out = this.structure.symbols.map((_, i) => i).filter((i) => !s.has(i) && (!hidden || v.isVisible(i)));
    this.select(out);
    if (hidden) toast(`Selected ${plural(out.length, 'visible atom')} (${hidden} hidden).`);
  }
  clearSelection() { this.viewer.setSelection([]); this.measurePicks = []; this.emit('selection'); }

  /**
   * Delete the selected atoms (in every frame) as one undo step, with a toast whose Undo reverts that step.
   * Returns the EditResult of editActive, or null when nothing is selected.
   */
  deleteSelected() {
    this._flushEdit();   // inside an edit's fn: the selection counts the atoms as they are now
    const sel = this.selection;
    if (!sel.length || !this.structure) return null;
    const n = this.structure.length, gone = new Set(sel), map = new Int32Array(n);
    for (let i = 0, k = 0; i < n; i++) map[i] = gone.has(i) ? -1 : k++;
    const what = plural(sel.length, 'atom');
    // deleteAtoms marks the edit 'atoms': the space group and calculated results go (brief C7)
    return this.editActive(`Delete ${what}`, (s) => { s.deleteAtoms(sel); }, { indexMap: map, toast: `Deleted ${what}` });
  }

  /**
   * Change the selected atoms to element `symbol` as one undo step (the space group goes, C7). `toast`: the message of
   * the toast, which has an Undo for this step and the notes the change added (calculated results that went), as
   * Delete's has; without it no toast is shown. Returns the EditResult, or null when nothing is selected.
   */
  replaceSelected(symbol, opts = {}) {
    const { toast: message = null } = opts ?? {};
    this._flushEdit();
    const sel = this.selection;
    if (!sel.length || !this.structure) return null;
    return this.editActive(`Change ${plural(sel.length, 'atom')} to ${symbol}`, (s) => { s.setSymbols(sel, symbol); }, { toast: message });
  }

  /**
   * Edit the active structure in place as one undo step (F0-A §3.2, ledger L-F0-30): fn(structure, {app, entry}) runs
   * synchronously on the structure itself, after a snapshot for undo. Options:
   * - indexMap (old → new) or src (new → old, −1 for a new atom): how atoms were renumbered; without either, the
   *   structure's change tracker works it out from the edit (deleteAtoms, addAtom, extend, remap…). The selection,
   *   measurements, visibility masks and named highlights follow the atoms.
   * - imageShift(oldIndex) → [ka, kb, kc] | null: stored positions moved by whole cell vectors (wrapping, centring);
   *   latticeChanged: the cell changed (measurements across cells are dropped).
   * - rebuild: 'full' (default), 'appearance' (colours and halos only: same atoms, positions, cell and elements — an
   *   edit that changes them is redrawn in full, with a console warning) or 'none' (info only); refit (default true).
   * - singleFrame: keep only the current frame first (brief C11; the toast says so); snapshot: 'full' (default) or
   *   {positions: indices} for an edit that only moves those atoms; cameraTransform: a 3×3 rotation (r' = r @ Rᵀ)
   *   the camera turns with.
   * - toast: a message shown with an Undo button bound to this step; notes the edit added to info.warnings, dropped
   *   frames and removed measurements are appended (and shown even without a message).
   * fn may return {select: indices}, which becomes the selection. If fn throws, returns a Promise or the view cannot
   * show the result, everything is put back, no undo step is left and the error is rethrown.
   * Edits made inside fn (an edit.* member called in facet.edit.run, deleteSelected…) are part of this one: they
   * change the structure and return their map ({entry: null, value, map}), and the selection, measurements, masks and
   * highlights follow each change once, in order; this edit makes the one undo step, draws once and shows one toast
   * (its message, then theirs, then the notes). An edit given indexMap or src covers the edits inside its fn with that
   * map. Inside fn, replaceActiveStructure puts the new structure's content into this one, which stays fn's and the
   * active structure. An edit inside fn that throws keeps what it changed (followed as the rest): the step goes on, or
   * is put back as a whole when the error leaves the outermost fn.
   * Returns {entry, value, map}: the undo step (null inside an open transaction, whose step it joins), fn's return
   * value and the old → new map (Int32Array, −1 = removed).
   */
  editActive(label, fn, opts = {}) {
    const { indexMap = null, src = null, imageShift = null, rebuild = 'full', refit = true, latticeChanged = false,
      singleFrame = false, snapshot = 'full', toast: message = null, cameraTransform = null } = opts ?? {};
    const e = this._activeEntry();
    if (!e) throw new Error('Load a structure first.');
    if (typeof fn !== 'function') throw new TypeError('editActive: fn must be a function.');
    if (!REBUILDS.includes(rebuild)) throw new TypeError("editActive: rebuild must be 'full', 'appearance' or 'none'.");
    const parent = this._editScope ?? null;
    if (parent && parent.e !== e) throw new Error(`editActive “${label}”: “${parent.label}” is editing another structure.`);
    if (parent) this._pauseEdit(parent);   // what the enclosing edit changed so far is followed first
    const s = e.structure, n0 = s.length, frames0 = s.nFrames, frame0 = s.frame, selBefore = this.selection, name0 = s.name;
    const explicit = indexMap != null || src != null;
    // the edit being made: the outermost one (root) draws, the ones inside its fn only follow their atoms
    const scope = { parent, e, s, label, explicit, quiet: !!parent && (parent.quiet || parent.explicit), tracker: null, nPiece: n0, src: null, last: null, need: 'none' };
    const root = scope.root = parent ? parent.root : Object.assign(scope, { messages: [], cameras: [], removed: 0, measure: false, resetCamera: false });
    const notes0 = parent ? null : getWarnings(s.info);
    let value, map, done = false;
    try {
      this.transaction(label, () => {
        this._pushStructureHistory(label, { id: e.id, how: singleFrame && frames0 > 1 ? 'full' : snapshot });
        if (singleFrame && s.nFrames > 1) s.keepFrame();
        const before = rebuild === 'full' ? null : structureDigest(s);
        if (!explicit || parent) this._beginPiece(scope);   // an explicit edit inside another one: only if fn fails
        this._editScope = scope;   // edits made in fn join this one
        try { value = fn(s, { app: this, entry: e }); } finally { this._editScope = parent; scope.last = this._stopPiece(scope); }
        if (value && typeof value.then === 'function') throw new Error('editActive: fn must not be async.');
        if (this._activeEntry() !== e || e.structure !== s) throw new Error(`editActive “${label}”: fn must change the structure it is given, not show or put in another one.`);
        s.touch();
        // the map of the whole edit, and `rest`: the part after the last edit made inside fn (not followed yet)
        let rest, prior = null, whole = null;
        if (explicit) map = rest = resolveIndexMap({ indexMap, src, n0, n1: s.length, label });
        else {
          const piece = scope.last ?? untrackedSource(scope.nPiece, s.length, label);
          prior = scope.src;
          whole = chainSources(prior, piece);
          map = resolveIndexMap({ src: whole, n0, n1: s.length, label });
          rest = prior ? resolveIndexMap({ src: piece, n0: scope.nPiece, n1: s.length, label }) : map;
        }
        // 'appearance' and 'none' promise the same geometry: checked every time (cheap next to a redraw)
        let mode = widerRebuild(s.nFrames !== frames0 ? 'full' : rebuild, scope.need), digest = null;
        if (mode !== 'full') {
          digest = structureDigest(s);
          if (digest !== before) { console.warn(`editActive “${label}”: rebuild '${rebuild}' changed positions, cell or elements; rebuilt in full.`); mode = 'full'; }
        }
        // imageShift counts fn's atoms: through the edits made inside fn to the atoms `rest` starts from
        const shift = imageShift && prior ? (k) => (prior[k] >= 0 ? imageShift(prior[k]) : null) : imageShift;
        this._followScope(scope, rest, s.length, { imageShift: shift, latticeChanged, select: value?.select });
        if (whole) scope.src = whole;
        if (cameraTransform) root.cameras.push(cameraTransform);
        if (parent) {
          parent.need = widerRebuild(parent.need, mode);
          if (message) root.messages.push(message);
          return;
        }
        if (s.name !== name0) e.name = s.name;   // an edit that renames (an automatic name) renames the entry too
        this._showEdit(e, { rebuild: mode, refit, resetCamera: root.resetCamera, digest, cameras: root.cameras });
      });
      done = true;
    } finally {
      if (parent) this._endInnerEdit(scope, done, done && explicit ? (src ?? sourceOfMap(map.map, s.length)) : null);
    }
    if (parent) return { entry: null, value, map: map.map };
    const entry = this._tx ? null : this.history.lastRecorded?.entry ?? null;
    this.markDirty();
    if (s.name !== name0) this.emit('project');
    this.emit('structure');
    if (!sameList(selBefore, this.selection)) this.emit('selection');
    if (root.measure) this.emit('measure');
    const dropped = s.nFrames < frames0 ? `Kept frame ${frame0 + 1} of ${frames0} and dropped the others.` : null;
    const [lead = null, ...more] = [message, ...root.messages].filter((t) => t && String(t).trim());
    const text = editToastText(lead, [...more, dropped, measurementsRemovedNote(root.removed), ...newWarnings(notes0, getWarnings(s.info))]);
    if (text) this.toastUndo(text, { entry });
    return { entry, value, map: map.map };
  }

  // -- edits inside an edit's fn. An edit follows its atoms in pieces (the structure's change tracker), split where an
  //    edit made inside its fn begins and ends: each change is followed once, in the order made (_followScope).
  /** Start following scope's atoms from here (closed by _stopPiece). */
  _beginPiece(scope) { scope.nPiece = scope.s.length; scope.tracker = scope.s.trackChanges(); }

  /** Close the piece being followed: its change (new → old), or null when the tracker lost the lineage or none was open. */
  _stopPiece(scope) {
    const t = scope.tracker;
    scope.tracker = null;
    return t ? t.stop(scope.s) : null;
  }

  /**
   * An edit begins inside `scope`'s fn (or reads the selection there): what scope changed so far is followed now. An
   * edit given indexMap or src follows its whole fn by that map when it ends instead. Throws as resolveIndexMap does
   * when scope removed atoms the tracker could not follow.
   */
  _pauseEdit(scope) {
    if (scope.explicit) return;
    const n1 = scope.s.length;
    const piece = this._stopPiece(scope) ?? untrackedSource(scope.nPiece, n1, scope.label);
    if (!scope.quiet) this._followScope(scope, resolveIndexMap({ src: piece, n0: scope.nPiece, n1, label: scope.label }), n1);
    scope.src = chainSources(scope.src, piece);
  }

  /** The edit made inside scope's fn ended, having changed the atoms by `change` (new → old; null: not at all). */
  _resumeEdit(scope, change) {
    if (scope.explicit) return;
    if (change) scope.src = chainSources(scope.src, change);
    this._beginPiece(scope);
  }

  /**
   * End of an edit made inside another one's fn (scope.parent's): the parent follows its atoms again, counting this
   * edit's change (`change` for an edit given indexMap or src, else its pieces). An edit that failed keeps what its fn
   * changed so far, which is followed now (the step goes on from there, or is put back as a whole).
   */
  _endInnerEdit(scope, done, change = null) {
    if (done) { this._resumeEdit(scope.parent, change ?? scope.src); return; }
    const n1 = scope.s.length;
    const piece = this._stopPiece(scope) ?? scope.last ?? untrackedSource(scope.nPiece, n1, scope.label, { guess: true });
    try {
      if (!scope.quiet) this._followScope(scope, resolveIndexMap({ src: piece, n0: scope.nPiece, n1, label: scope.label }), n1);
    } catch (err) { console.error(`editActive “${scope.label}”: the atoms could not be followed after it failed`, err); }
    scope.parent.need = 'full';
    this._resumeEdit(scope.parent, chainSources(scope.src, piece));
  }

  /** Follow the atoms through `m` ({map, changed}; n1 atoms now) unless scope is quiet; counted on the outermost edit. */
  _followScope(scope, m, n1, opts = {}) {
    if (scope.quiet) return;
    const removed = this._followAtoms(m, n1, opts), root = scope.root;
    root.removed += removed;
    if (m.changed || opts.latticeChanged || opts.imageShift || removed) root.measure = true;
  }

  /** Inside an edit's fn: follow what it changed so far now, so the selection counts the atoms as they are. */
  _flushEdit() {
    const scope = this._editScope;
    if (!scope || scope.explicit || scope.quiet) return;
    this._pauseEdit(scope);
    this._resumeEdit(scope, null);
  }

  /**
   * The atoms of the active structure changed by `m` ({map: old → new, −1 = removed; changed}; n1 atoms now): the
   * selection (`select`, else the current one through the map), the measurements (imageShift, latticeChanged; else
   * whole-cell moves read off `before` → `after`), visibility masks and named highlights follow. The data only: the
   * caller draws. The step's masks and highlights are kept first (tx.indexed), so a step that fails puts them back.
   * Returns the number of measurements removed.
   */
  _followAtoms({ map, changed }, n1, { imageShift = null, latticeChanged = false, select = null, before, after } = {}) {
    const v = this.viewer;
    // first: imageShift is the caller's, and if it throws nothing has changed yet
    const removed = this._remapMeasurements(map, { imageShift, latticeChanged, before, after });
    const sel = Array.isArray(select) || ArrayBuffer.isView(select)
      ? [...new Set(Array.from(select).filter((i) => Number.isInteger(i) && i >= 0 && i < n1))]
      : [...v.selection].map((i) => (i < map.length ? map[i] : -1)).filter((j) => j >= 0);
    v.selection = new Set(sel);
    if (changed) {
      if (this._tx && this._tx.indexed === undefined) this._tx.indexed = v.indexedState?.() ?? null;
      v.remapIndexed?.(map, n1);
    }
    return removed;
  }

  /** Draw edited entry `e` (the active one) again, turn the camera, show its measurements and the selection's halos. */
  _showEdit(e, { rebuild = 'full', refit = true, resetCamera = false, digest = null, cameras = [] } = {}) {
    const v = this.viewer, sel = [...v.selection];   // a redraw that resets the camera clears the viewer's selection
    this._redraw(e.structure, rebuild, { refit, resetCamera, digest });
    for (const R of cameras) v.transformCamera?.(R);
    this._showMeasurements(e);
    v.setSelection(sel);
  }

  /**
   * The common end of a change of entry `e` (the active one) inside its transaction: the atoms are followed by `m`
   * (_followAtoms: the selection is set before the view is rebuilt, which 'model' listeners read), then the view is
   * redrawn (`rebuild`) and the camera turned. Returns the number of measurements removed.
   */
  _afterEdit(e, m, { rebuild = 'full', refit = true, latticeChanged = false, imageShift = null, cameraTransform = null, select = null, resetCamera = false, digest = null } = {}) {
    const removed = this._followAtoms(m, e.structure.length, { imageShift, latticeChanged, select });
    this._showEdit(e, { rebuild, refit, resetCamera, digest, cameras: cameraTransform ? [cameraTransform] : [] });
    return removed;
  }

  /**
   * Draw structure `s` again: 'full' rebuilds the view's model (bonds and all), 'appearance' only its colours and halos
   * (the viewer's refreshAppearance, a full rebuild where the viewer has none), 'none' nothing. Remembers the content
   * digest the model was built from (`digest`, computed when not given) for notifyStructureChanged.
   */
  _redraw(s, mode, { refit = true, resetCamera = false, digest = null } = {}) {
    if (mode === 'none') return;
    const v = this.viewer;
    if (mode === 'appearance' && typeof v.refreshAppearance === 'function') v.refreshAppearance();
    else {
      this._measGuard++;
      try { v.setStructure(s, { resetCamera, refit }); } finally { this._measGuard--; }
    }
    if (v.model) (this._drawnDigests ??= new WeakMap()).set(v.model, digest ?? structureDigest(s));
  }

  /** {entry, label, at} of the step recorded last; null once it is undone, or after the history was cleared or swapped. */
  get lastEdit() { return this.history.lastRecorded; }

  /**
   * A toast whose Undo reverts history step `entry` — that step, not whatever is on top when the button is pressed
   * (F0-A §3.4). Without `entry`, the step recorded last: only reliable in the same synchronous step as the edit, so
   * asynchronous callers (paste, import, server replies) pass the entry their edit returned; null shows no Undo.
   * `actions` [{label, run}] come after Undo. Returns the toast element.
   */
  toastUndo(message, { entry, actions = [], timeout, type } = {}) {
    const e = entry === undefined ? this.lastEdit?.entry ?? null : entry;
    const acts = [...(e ? [{ label: 'Undo', run: () => this.undoEntry(e) }] : []), ...(actions ?? [])];
    return toast(message, { timeout, type, actions: acts });
  }

  /**
   * Undo history step `entry` if it is the latest one; otherwise say why not (a later step comes first, it is already
   * undone, or the history no longer holds it). Pending scene changes are recorded first, as their own step.
   * Returns the label undone, or null.
   */
  undoEntry(entry) {
    if (this.session) this.session.cancel('undo');   // a preview (F0-A §3.6) ends before the history changes
    this._commitScene.flush();
    const where = this.history.has(entry);
    if (where === 'undo' && this.history.top() === entry) return this.undo();
    if (where === 'redo') toast('That change is already undone.');
    else if (where === 'undo') toast(`Undo the later changes first (press ${keyLabel('mod+z')}).`);
    else toast('That change can no longer be undone.');
    return null;
  }

  /**
   * After a script changed the active structure directly (facet.edit.touch()): count the change (touch()) and
   * redraw — in full when positions, the cell, the elements or the number of atoms differ from what the view was last
   * built from, else only colours and halos — then mark the project unsaved and emit 'structure'. Not an undo step:
   * scripts that want one use editActive. Returns the redraw done, 'full' or 'appearance'; inside an edit's fn 'none'
   * (only the count: the edit draws when its fn returns).
   */
  notifyStructureChanged() {
    const e = this._activeEntry();
    if (!e) throw new Error('Load a structure first.');
    if (this._editScope) { e.structure.touch(); return 'none'; }
    const s = e.structure, v = this.viewer, selBefore = this.selection;
    s.touch();
    const digest = structureDigest(s);
    const mode = v.model && this._drawnDigests?.get(v.model) === digest ? 'appearance' : 'full';
    const sel = selBefore.filter((i) => i < s.length);
    v.selection = new Set(sel);
    this._redraw(s, mode, { digest });
    this._showMeasurements(e);
    v.setSelection(sel);
    this.markDirty();
    this.emit('structure');
    if (!sameList(selBefore, sel)) this.emit('selection');
    return mode;
  }

  /**
   * Put structure `newStructure` in place of the active one (Wrap into cell, a supercell, a preview's result) as one
   * undo step, like editActive: the selection, measurements, masks and highlights follow the atoms by `indexMap`
   * (old → new), else `src` (new → old, e.g. a builder's r.sourceMap — never read from the structure by itself, whose
   * lineage need not be the active structure's), else atom i stays atom i (more atoms: appended; fewer: an error).
   * imageShift, latticeChanged and refit as for editActive; resetCamera frames the new structure. Without an active
   * structure it is added (addStructure). If the view cannot show it, everything is put back and the error rethrown.
   * Inside an editActive fn the active structure takes the new one's content instead (Structure._adopt: `newStructure`
   * must not be used afterwards), so fn's structure stays the active one, and the edit draws when fn returns.
   * Returns {entry, value: undefined, map}.
   */
  replaceActiveStructure(newStructure, { resetCamera = false, label = 'Edit structure', indexMap = null, src = null, imageShift = null, refit = true, latticeChanged = false } = {}) {
    const e = this._activeEntry();
    if (!e) {
      const { historyEntry } = this.addStructure(newStructure);
      return { entry: historyEntry, value: undefined, map: new Int32Array(0) };
    }
    const map = resolveIndexMap({ indexMap, src, n0: e.structure.length, n1: newStructure.length, label, what: 'replaceActiveStructure' });
    const parent = this._editScope ?? null;
    if (parent) return this._replaceInEdit(parent, e, newStructure, map, { label, src, imageShift, latticeChanged, resetCamera });
    let removed = 0;
    this.transaction(label, () => {
      this._pushStructureHistory(label, { id: e.id, how: 'full' });
      e.structure = newStructure; e.name = newStructure.name;
      this.structure = newStructure;
      removed = this._afterEdit(e, map, { refit, latticeChanged, imageShift, resetCamera });
    });
    const entry = this._tx ? null : this.history.lastRecorded?.entry ?? null;
    this.markDirty();
    this.emit('structure'); this.emit('project'); this.emit('selection');
    if (map.changed || latticeChanged || imageShift || removed) this.emit('measure');
    return { entry, value: undefined, map: map.map };
  }

  /** replaceActiveStructure inside the fn of edit `parent`: the active structure takes `next`'s content in place. */
  _replaceInEdit(parent, e, next, m, { label, src, imageShift, latticeChanged, resetCamera }) {
    if (parent.e !== e) throw new Error(`replaceActiveStructure “${label}”: “${parent.label}” is editing another structure.`);
    const s = e.structure, n1 = next.length, change = src ?? sourceOfMap(m.map, n1);
    this._pauseEdit(parent);
    let done = false;
    try {
      this.transaction(label, () => {
        this._pushStructureHistory(label, { id: e.id, how: 'full' });
        // whole-cell moves are read off the two structures, before the active one takes the new content
        this._followScope({ root: parent.root, quiet: parent.quiet || parent.explicit }, m, n1, { imageShift, latticeChanged, before: s, after: next });
        s._adopt(next, { src: change });
      });
      done = true;
    } finally { this._resumeEdit(parent, done ? change : null); }
    parent.need = 'full';
    if (resetCamera) parent.root.resetCamera = true;
    return { entry: null, value: undefined, map: m.map };
  }

  /**
   * Switch tools (F0-A §3.13.2): 'select' (the default), 'measure' or a tool registered with tools.register
   * (render/tools/index.js); `opts` go to the tool, and setTool('measure', 'angle') still means
   * setTool('measure', { measureType: 'angle' }). An unknown id falls back to Select (with a console warning); a tool
   * whose when(app) is false stays off, a toast says why, and the result is false. A press of the old tool in the view
   * is cancelled ('switch'), the old tool is deactivated, the new one gets a fresh handler, its cursor and activate(app,
   * opts); 'tool' is emitted and the result is true. app.tool stays the tool's id; app.toolDef is its definition.
   */
  setTool(id = 'select', opts = {}) {
    if (typeof opts === 'string') opts = { measureType: opts };
    if (!opts || typeof opts !== 'object') opts = {};
    let t = tools.get(id);
    if (!t) { console.warn(`Unknown tool “${id}”; using Select.`); t = tools.get('select'); }
    let ok = true;
    try { ok = !t.when || !!t.when(this); } catch (e) { console.error(e); ok = false; }
    if (!ok) {
      let why = null;
      try { why = t.whyNot?.(this) ?? null; } catch (e) { console.error(e); }
      toast(why || `${t.title} is not available now.`);
      return false;
    }
    const prev = this.toolDef;
    this.viewer.cancelToolPress?.('switch');
    if (prev && prev !== t) { try { prev.deactivate?.(this, 'switch'); } catch (e) { console.error(e); } }
    this.tool = t.id; this._toolDef = t; this.toolOpts = opts;
    if (opts.measureType) this.measureType = opts.measureType;
    this.measurePicks = [];
    let handler = null;
    try { handler = t.handler?.(this, this.viewer, opts) ?? null; } catch (e) { console.error(`${t.title}: its pointer handler failed to start`, e); }
    this.viewer.toolHandler = handler;
    const canvas = this.viewer.renderer?.domElement;
    if (canvas) canvas.style.cursor = t.cursor ?? '';
    try { t.activate?.(this, opts); } catch (e) { console.error(e); }
    this.emit('tool');
    return true;
  }

  /** The active tool's definition: the one setTool switched on, else the registered one for app.tool (Select for an unknown id). */
  get toolDef() {
    const t = this._toolDef;
    return t && t.id === this.tool ? t : (tools.get(this.tool) ?? tools.get('select'));
  }

  /** The tool registry changed (the shell passes it on): an active tool that went away gives way to Select, a replaced one restarts. */
  _toolsChanged() {
    const cur = tools.get(this.tool);
    if (!cur) this.setTool('select');
    else if (this._toolDef && this._toolDef.id === this.tool && cur !== this._toolDef) this.setTool(this.tool, this.toolOpts);
  }

  _onAtomClick({ index, shiftKey, mode }) {
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
    // a tool that does not select atoms (Pick site…) leaves the selection alone; Select and Move select (ToolDef.selects)
    if (!this.toolDef?.selects) return;
    // as in Materials Studio: a click replaces the selection (on empty space: clears it), Shift adds, Ctrl/⌘ toggles
    const m = mode ?? (shiftKey ? 'toggle' : 'replace');
    if (index < 0) { if (m === 'replace') this.clearSelection(); return; }
    this.select([this.viewer.model.src[index]], { mode: m });
  }

  /**
   * Double-click on an atom with a tool that selects atoms (Select, Move): its bonded fragment (Alt: every atom of its
   * element), replacing the selection, added with Shift, or with Ctrl/⌘ added — or removed when the atom was selected.
   */
  _onAtomDblClick({ index, mode = 'replace', altKey = false }) {
    const m = this.viewer.model;
    if (!this.toolDef?.selects || !m || index < 0 || index >= m.n) return;
    const src = m.src[index];
    // the two clicks before this one toggled the atom twice: its state is what it was before the double-click
    const how = mode === 'toggle' ? (this.viewer.selection.has(src) ? 'remove' : 'add') : mode;
    if (altKey) this.selectElement(m.symbols[index], false, how);
    else this.select(bondedFragment(m, src), { mode: how });
  }

  // ------------------------------------------------------------------ measurements (saved per structure)
  /**
   * The viewer's measurements as the entry keeps them, {id, type, refs} (core/measure.js); an entry a script added with
   * the old `keys` is migrated against the shown structure.
   */
  _viewerMeasurements() {
    const wrap = this.scene?.display?.wrap !== false;
    return (this.viewer.measurements ?? []).map((m) => {
      if (Array.isArray(m.refs) || !Array.isArray(m.keys)) return measurementRecord(m);
      return { id: m.id, type: m.type, refs: migrateMeasurementKeys(this.structure, m.keys, { wrap }) };
    }).filter((m) => Array.isArray(m.refs));
  }

  /** Show an entry's measurements in the viewer, with their ids (stable for the session: undo and redo keep them). */
  _showMeasurements(entry) {
    this._measGuard++;
    try {
      this.viewer.measurements = (entry?.measurements ?? []).map((m) => {
        if (typeof m.id !== 'string' || !m.id) m.id = newMeasurementId();
        return measurementRecord(m);
      });
      this.viewer._buildMeasurements?.();
    } finally { this._measGuard--; }
  }

  /** Measurements added or removed in the viewer (tool, panel, API) belong to the active structure. */
  _onViewerMeasure() {
    if (this._measGuard) return;
    const e = this._activeEntry();
    if (!e || this.viewer.structure !== e.structure) return;
    // the same measurements drawn differently (an atom hidden or shown again): panels that list them redraw
    const drawn = (this.viewer.measurements ?? []).map((m) => m.drawn ?? '-').join();
    const redrawn = drawn !== this._measDrawn;
    this._measDrawn = drawn;
    const cur = this._viewerMeasurements();
    if (JSON.stringify(cur) === JSON.stringify(e.measurements ?? [])) { if (redrawn) this.emit('measure'); return; }
    e.measurements = cur;
    this.markDirty();
  }

  /**
   * Measurements after an edit (F0-A §3.9.4, core/measure.js remapMeasurementList): atom indices through `map`
   * (map[old] = new, −1 = removed: a measurement on a removed atom is dropped); `latticeChanged` (a supercell, a
   * redefined lattice) drops those with a non-zero image; `imageShift(oldIndex) → [ka, kb, kc]` rewrites the images of
   * atoms whose stored positions the edit moved by whole cells (wrapping into the cell). Without it, when the edit put
   * another structure in place of the one before (`before`, by default the one the viewer still shows; `after`, by
   * default the active one), as Wrap into cell does, whole-cell moves are read off the two (wholeCellShifts). Atoms
   * moved any other way need nothing: references follow the stored positions. Returns the number of measurements
   * dropped (for the toast: measurementsRemovedNote).
   */
  _remapMeasurements(map, { imageShift = null, latticeChanged = false, before = this.viewer.structure, after = this.structure } = {}) {
    const shift = imageShift ?? (latticeChanged ? null : wholeCellShifts(before, after, map));
    const { list, removed } = remapMeasurementList(this.viewer.measurements ?? [], map, { imageShift: shift, latticeChanged });
    this.viewer.measurements = list;
    const e = this._activeEntry();
    if (e) e.measurements = list.filter((m) => Array.isArray(m.refs)).map(measurementRecord);
    return removed;
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
    this.history.clear();
    this.emit('history');
    return structure;
  }

  _addSample(s) {
    const structure = s.build();
    const { historyEntry } = this.addStructure(structure, { replaceProject: false });
    // a new structure's notes are all new (ledger L-F0-32)
    this.toastUndo(editToastText(`Added ${s.name} to this project (${plural(this.project.structures.length, 'structure')})`, getWarnings(structure.info)), { entry: historyEntry });
    return structure;
  }

  async _openSampleAsNew(s, { offerAdd, adaptBackground }) {
    if (!(await this.confirmLeave(`open ${s.name}`))) return null;
    const prev = { project: this.project, history: this.history.detach(), dirty: this.dirty, camera: this.structure ? this.viewer.getCameraState() : null };
    let structure;
    try { structure = this._openSample(s, { adaptBackground }); }
    catch (err) {   // the current project stayed open: give it its history back
      if (this.project === prev.project) { this.history.attach(prev.history); this.emit('history'); }
      throw err;
    }
    const fresh = this.project;
    const back = () => {
      if (this.project !== fresh || !this.pristine) { toast('The sample has been changed since, so it stays a separate project.'); return; }
      this._switchProject(prev.project);
      this.history.attach(prev.history); this.dirty = prev.dirty;
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
        if (/\.json$/i.test(f.name) && /"(facet|crystallume|atomscope)\.project/.test(text.slice(0, 400))) {
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
    return saveFile(`${slug(this.project.name)}.facet.json`, JSON.stringify(doc, null, 1), 'application/json');
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
  /**
   * Mark a long task; returns {set(label), end()}. Emits 'busy' {busy, label, cancel}: the newest task's label and, when
   * it was started with `cancel`, a function that cancels it (else null) — the busy indicator shows it as a Cancel
   * button. Cancelling runs `cancel` once; the task stays busy until it ends.
   */
  _busyStart(label, { cancel = null } = {}) {
    const tok = { label, cancel: null };
    if (typeof cancel === 'function') tok.cancel = () => { if (!tok.cancel) return; tok.cancel = null; this._emitBusy(); cancel(); };
    this._busyOps.push(tok);
    this._emitBusy();
    let ended = false;
    return {
      set: (l) => { tok.label = l; this._emitBusy(); },
      end: () => { if (ended) return; ended = true; tok.cancel = null; const i = this._busyOps.indexOf(tok); if (i >= 0) this._busyOps.splice(i, 1); this._emitBusy(); },
    };
  }
  _emitBusy() {
    const top = this._busyOps.at(-1);
    this.busy = !!top;
    this.busyLabel = top?.label ?? '';
    this.emit('busy', { busy: this.busy, label: this.busyLabel, cancel: top?.cancel ?? null });
  }

  /**
   * Show progress of a task the user started and waits for (ledger L-F0-54): until end(), app.busy is true (edits and
   * exports wait) and the busy indicator shows `label`. set(0.42) shows "<label> 42%", set('Text') changes the label;
   * with `cancel`, the indicator has a Cancel button that calls cancel() once and makes `cancelled` true (the task
   * checks it and ends). Returns {set(labelOrFraction), end(), cancelled}.
   */
  startTask(label, { cancel = null } = {}) {
    if (cancel != null && typeof cancel !== 'function') throw new TypeError('startTask: cancel must be a function.');
    let text = String(label ?? '').trim() || 'Working…', cancelled = false, ended = false;
    const stop = cancel && (() => {
      cancelled = true;
      try { cancel(); } catch (err) { console.error('startTask: cancel failed', err); }
    });
    const busy = this._busyStart(text, { cancel: stop });
    return {
      set: (v) => {
        if (ended) return;
        if (typeof v === 'number' && Number.isFinite(v)) { busy.set(`${text} ${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`); return; }
        text = String(v ?? '').trim() || text;
        busy.set(text);
      },
      end: () => { ended = true; busy.end(); },
      get cancelled() { return cancelled; },
    };
  }

  // ------------------------------------------------------------------ export
  /**
   * Save a PNG of the view. `selection` keeps the selection halo and `markers` adds marker overlays (site markers,
   * fixed-atom halos…); they default to the export menu's "Include selection highlight" (on) and "Include markers"
   * (off) preferences. The hover halo is never in the picture.
   */
  async exportImage({ scale = 2, transparent = false, selection = this.prefs.exportSelection !== false, markers = this.prefs.exportMarkers === true } = {}) {
    if (!this.structure) throw new Error('Nothing to export yet.');
    if (this._exporting) return false;   // one image at a time
    this._exporting = true;
    const busy = this._busyStart(`Rendering ${scale}× image…`);
    try {
      await pause();   // let the busy indicator paint before the heavy render
      const blob = await this.viewer.screenshot({ scale, transparent, selection: !!selection, markers: !!markers });
      busy.set('Saving image…');
      const ok = await saveFile(`${slug(this.structure.name)}${transparent ? '-transparent' : ''}@${scale}x.png`, blob, 'image/png');
      if (ok) toast(`Image saved (${Math.round(this.viewer.width * scale)}×${Math.round(this.viewer.height * scale)} px)`);
      return ok;
    } finally { busy.end(); this._exporting = false; }
  }

  // ------------------------------------------------------------------ colour-scheme extras and overlays
  /**
   * Give colour schemes a value they cannot find in the scene settings, e.g. the layer parameters a structure
   * entry keeps: before every viewer settings pass `provider(app)` runs and its JSON value (undefined: left
   * out) appears as ctx.extras[key] in colorFor and legend; colours are recomputed when it changes. A later
   * registration of the same key replaces the provider. Returns a function that removes it.
   */
  registerColorExtra(key, provider) {
    if (typeof key !== 'string' || !key.trim()) throw new TypeError('registerColorExtra: key must be a non-empty string.');
    if (typeof provider !== 'function') throw new TypeError('registerColorExtra: provider must be a function (app) → value.');
    const fns = (this._colorExtraFns ??= new Map());
    fns.set(key, provider);
    this.viewer.extrasProvider = () => this.colorExtras();
    this.viewer.applySettings(this.scene);
    return () => {
      if (fns.get(key) !== provider) return;
      fns.delete(key);
      this.viewer.applySettings(this.scene);
    };
  }

  /** The current colour-scheme extras: {key: value} of the registered providers (see registerColorExtra). */
  colorExtras() { return colorExtrasFrom(this._colorExtraFns, this); }

  /**
   * Overlay layers marked clearOnSwitch and named highlights belong to one structure: they go when another entry
   * is shown, or another project document (opening the open project again gives new Structure objects under the
   * same ids). Undo and redo keep the project object and the entry ids, so they keep the overlays.
   */
  _switchOverlays(entry) {
    const project = entry ? this.project : null, id = entry?.id ?? null;
    const was = this._overlayOwner;
    if (was && was.project === project && was.id === id) return;
    this._overlayOwner = { project, id };
    this.viewer.structureSwitched?.();
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

  // --- surface-modeling M2 ---
  // --- end M2 ---

  // --- surface-modeling M3 ---
  // --- end M3 ---

  // --- surface-modeling M4 ---
  // --- end M4 ---
}

export { formats, samples };
