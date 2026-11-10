/**
 * Public JavaScript API — `window.crystallume`. Also the object handed to plugins' `activate(api)`.
 * Everything the UI can do is reachable from here; registries let plugins add formats, builders,
 * representations, materials, colour schemes, lighting rigs, looks, samples, analyses, storage
 * backends, panels and commands. Every `register*` call checks the entry's required fields, warns
 * when it replaces an entry with the same id (unless { replace: true }), updates the command palette
 * and the panels, and returns a function that removes the entry again (bringing back the entry it
 * replaced, if any). `crystallume.help()` lists it all.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { Structure } from '../core/structure.js';
import { formats, parseStructure, exportStructure } from '../io/index.js';
import { prototypes, buildCrystal } from '../build/crystal.js';
import { clusters, buildCluster } from '../build/cluster.js';
import { buildMolecule, MOLECULES } from '../build/molecules.js';
import { samples } from '../build/samples.js';
import { styles, atomRadius } from '../render/styles.js';
import { materials, createMaterial } from '../render/materials.js';
import { colorSchemes, COLORMAPS } from '../render/colors.js';
import { lightingPresets, environmentMaps } from '../render/lighting.js';
import { looks } from '../render/looks.js';
import { DEFAULT_SCENE } from '../render/settings.js';
import { bondedFragment } from '../render/display.js';
import { commands } from '../core/commands.js';
import { uid } from '../core/util.js';
import { analyses } from '../core/analyses.js';
import { rdf, coordinationStats } from '../core/analysis.js';
import { registerLeftPanel, registerInspectorTab, leftPanels, inspectorTabs } from '../ui/shell.js';
import { registerPanelSection } from '../ui/sections.js';
import { registerSelectionAction } from '../ui/selectioncard.js';
import { registerAtomInfo } from '../ui/atominfo.js';
import { toast } from '../ui/overlays.js';
import { analysisContext } from '../ui/paramform.js';
import { sceneScript } from '../ui/apidialog.js';
import { findBonds, findPeriodicNeighbors } from '../core/bonds.js';
import { syncRegistryCommands, refreshShell } from './extensions.js';
import { VERSION } from '../app.js';

/** Events reachable through crystallume.on(name, fn): [name, source, payload, description]. */
export const EVENTS = [
  ['project', 'app', '—', 'The open project changed: opened, renamed, structures added or removed'],
  ['structure', 'app', '—', 'The active structure was switched or edited'],
  ['selection', 'app + viewer', 'viewer: source indices', 'The atom selection changed'],
  ['scene', 'app', '—', 'Scene settings changed (look, style, lighting, effects, display)'],
  ['tool', 'app', '—', 'The tool changed (app.tool: select | measure)'],
  ['measure', 'app + viewer', 'viewer: measurement list', 'A measurement was added or removed'],
  ['history', 'app', '—', 'The undo/redo stacks changed'],
  ['saveState', 'app', "'idle' | 'dirty' | 'saving' | 'saved' | 'error'", 'Save state of the open project'],
  ['saved', 'app', '—', 'The open project was stored'],
  ['busy', 'app', '{busy, label}', 'A long task started or ended'],
  ['providers', 'app', '—', 'Storage providers or their sign-in state changed'],
  ['auth', 'app', 'user | null', 'The server account changed'],
  ['needAuth', 'app', '—', 'A save needs the user to sign in'],
  ['prefs', 'app', '—', 'A user preference changed'],
  ['plugins', 'app', '—', 'A frontend plugin was loaded or failed to load'],
  ['registry', 'app', '{kind, id, removed}', 'An entry was added to or removed from a registry through the API'],
  ['hover', 'viewer', '{index, x, y}', 'Pointer over a drawn atom (index −1: none)'],
  ['atomclick', 'viewer', '{index, mode, shiftKey, x, y}', "Click on a drawn atom (index −1: empty space); mode 'replace', 'add' (Shift) or 'toggle' (Ctrl/⌘)"],
  ['atomdblclick', 'viewer', '{index, mode, altKey, x, y}', 'Double-click on a drawn atom (selects its bonded fragment; Alt: its element)'],
  ['atomcontext', 'viewer', '{index, x, y, clientX, clientY}', 'Right-click on a drawn atom'],
  ['boxselect', 'viewer', '{indices, mode, add, shape}', "Rectangle (drag) or lasso (Q+drag) selection finished; shape 'rect' | 'lasso'"],
  ['overlayhover', 'viewer', '{layer, index, item, x, y}', 'Pointer over an item of a pickable overlay layer (index −1: it left the layer)'],
  ['overlayclick', 'viewer', '{layer, index, item, x, y, mode}', 'Click on an item of a pickable overlay layer (sent instead of atomclick)'],
  ['overlaydblclick', 'viewer', '{layer, index, item, x, y, mode}', 'Double-click on an item of a pickable overlay layer (sent instead of atomdblclick)'],
  ['overlaycontext', 'viewer', '{layer, index, item, x, y, mode, clientX, clientY}', 'Right-click on an item of a pickable overlay layer (sent instead of atomcontext)'],
  ['frame', 'viewer', 'frame index', 'The trajectory frame changed'],
  ['play', 'viewer', 'boolean', 'Trajectory playback started or stopped'],
  ['camera', 'viewer', '—', 'The camera moved'],
  ['model', 'viewer', 'display model', 'The drawn model was rebuilt'],
  ['render', 'viewer', '—', 'A frame was rendered'],
  ['error', 'viewer', 'Error', 'Drawing failed or the graphics context was lost'],
].map(([name, source, payload, description]) => ({ name, source, payload, description }));

/** Required fields per registry kind (beyond `id`); returns a problem or null. */
const CHECKS = {
  formats: (f) => (typeof f.read === 'function' || typeof f.write === 'function' ? null : 'missing read() or write()'),
  styles: (s) => (typeof s.build === 'function' ? null : 'missing build()'),
  looks: (l) => (l.scene && typeof l.scene === 'object' ? null : 'missing scene'),
  samples: (s) => (typeof s.build === 'function' ? null : 'missing build()'),
  colorSchemes: (c) => (typeof c.colorFor === 'function' ? null : 'missing colorFor()'),
  lighting: () => null,
  environmentMaps: (m) => (typeof m.build === 'function' ? null : 'missing build()'),
  materials: (m) => (typeof m.create === 'function' ? null : 'missing create()'),
  analyses: (a) => (typeof a.run === 'function' ? null : 'missing run()'),
  commands: (c) => (typeof c.run === 'function' ? null : 'missing run()'),
  storage: (p) => (['list', 'get', 'save'].every((k) => typeof p[k] === 'function') ? null : 'missing list(), get() or save()'),
  panels: (p) => (typeof p.render === 'function' ? null : 'missing render()'),
  inspector: (p) => (typeof p.render === 'function' ? null : 'missing render()'),
};
/** Default representation icon (styles carry inline SVG markup in `icon`). */
const STYLE_ICON = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="12" r="5" fill="currentColor" fill-opacity=".25"/><circle cx="21" cy="20" r="5" fill="currentColor" fill-opacity=".25"/><path d="M14.5 15.5l3 1.5" stroke-dasharray="2 2"/></svg>';
const UNSAFE = /(^|\.)(__proto__|constructor|prototype)(\.|$)/;
/** Throws for scene paths or patch keys that could reach Object.prototype. */
export function assertSafePath(path) {
  if (typeof path !== 'string' || !path || UNSAFE.test(path)) throw new Error(`Invalid scene path “${String(path)}”`);
}
function assertSafeObject(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 12) return;
  for (const k of Object.keys(o)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`Invalid scene key “${k}”`); assertSafeObject(o[k], depth + 1); }
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
/** [path, default] for every leaf of the default scene. */
export function scenePaths(o = DEFAULT_SCENE, pre = '') {
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out.push(...scenePaths(v, p));
    else out.push([p, v]);
  }
  return out;
}

/** The structure to work on, or a clear error when none is loaded (instead of a TypeError further in). */
const need = (s) => { if (!s) throw new Error('Load a structure first.'); return s; };

export function createAPI(app, shell) {
  const records = [];          // frontend plugins: {name, url, status, error, source}
  let activating = null;       // the plugin record whose activate() is running
  const toStructure = (input, opts = {}) => {
    if (input instanceof Structure) return input;
    if (typeof input === 'string') return parseStructure(input, opts.name ?? '', opts.format ?? null);
    if (input && typeof input === 'object') return Structure.fromJSON(input);
    throw new Error('load() expects a Structure, a structure JSON object or file text');
  };

  /** Validated registration shared by every register* member. */
  const UI_PARTS = { formats: ['drawer'], samples: ['drawer'], analyses: ['drawer'], panels: ['rail', 'drawer'], inspector: ['inspector'], storage: ['drawer'], commands: [] };
  /** Stored entry → its registration { entry, off, prev, retired, stored }; `prev` is the entry it replaced. */
  const owners = new WeakMap();
  function registerIn(kind, reg, entry, opts = {}) {
    if (!entry || typeof entry !== 'object') throw new Error(`${kind}.register: expected an object`);
    if (!entry.id || typeof entry.id !== 'string') throw new Error(`${kind}.register: missing id`);
    const problem = CHECKS[kind]?.(entry);
    if (problem) throw new Error(`${kind}.register: ${problem}`);
    const prev = reg.get(entry.id);
    if (prev && !opts.replace) console.warn(`${kind}.register: “${entry.id}” already exists and is replaced (pass { replace: true } to do this on purpose)`);
    if (activating && entry.plugin == null) { try { entry.plugin = activating.name; } catch { /* frozen entry */ } }
    // registries may store a copy of the entry: `stored` is what reg.get() returns while this one is active
    const rec = { entry, off: reg.register(entry), prev, retired: false, stored: null };
    rec.stored = reg.get(entry.id) ?? entry;
    if (prev === rec.stored) rec.prev = owners.get(prev)?.prev ?? null;   // the same object registered again
    owners.set(rec.stored, rec);
    const changed = (removed) => {
      syncRegistryCommands(app);
      refreshShell(shell, UI_PARTS[kind] ?? ['inspector']);
      app.emit('registry', { kind, id: entry.id, removed });
    };
    changed(false);
    let done = false;
    /** Remove this entry; when it is the active one, bring back the entry it replaced (if still wanted). */
    const dispose = () => {
      if (done) return;
      done = true;
      rec.retired = true;
      if (reg.get(entry.id) !== rec.stored) { changed(true); return; }   // replaced since: leave the newer entry
      let back = rec.prev;
      const seen = new Set([rec.stored]);
      while (back && (seen.has(back) || owners.get(back)?.retired)) {
        if (seen.has(back)) { back = null; break; }
        seen.add(back);
        back = owners.get(back).prev;
      }
      if (!back) rec.off?.();
      else {
        const r = owners.get(back);
        try {
          const off = reg.register(r ? r.entry : back);
          if (r) { r.off = off; r.stored = reg.get(entry.id) ?? r.entry; owners.set(r.stored, r); }
        } catch (e) { console.warn(`${kind}: could not restore “${entry.id}”`, e); rec.off?.(); }
      }
      changed(true);
    };
    activating?.disposers.push(dispose);
    return dispose;
  }
  const panelReg = (map, fn) => ({ get: (id) => map.get(id), register: fn });
  /** A remover from a UI registry; a plugin's are undone when its activation fails. */
  const owned = (dispose) => { activating?.disposers.push(dispose); return dispose; };
  const wrap = (reg, register) => { const w = Object.create(reg); w.register = register; return w; };

  const api = {
    version: VERSION,
    app, viewer: app.viewer, shell,
    Structure,
    /** The vendored three.js module (r170) — use it in styles and plugins instead of importing your own copy. */
    THREE,
    /** Building blocks for representations: the viewer's helpers plus atomRadius, createMaterial and COLORMAPS. */
    get render() { return { ...(app.viewer.helpers ?? {}), atomRadius, createMaterial, COLORMAPS, THREE }; },
    get structure() { return app.structure; },
    get scene() { return app.scene; },
    get project() { return app.projectToJSON({ thumbnail: false }); },

    /** Show a structure (Structure, JSON or file text). Returns the Structure (a Promise of it for formats the server reads). */
    load(input, opts = {}) {
      const show = (s) => {
        if (opts.name) s.name = opts.name;
        app.addStructure(s, { look: opts.look ?? null, newProject: !!opts.newProject });
        return s;
      };
      const s = toStructure(input, opts);
      return typeof s?.then === 'function' ? s.then(show) : show(s);   // formats read by the server parse asynchronously
    },
    async loadURL(url, opts = {}) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch ${url}: ${res.status}`);
      return api.load(await res.text(), { name: url.split('/').pop(), ...opts });
    },
    sample: (id) => app.loadSample(id),
    /**
     * Open a project document (as a .crystallume.json file holds) as a new project: like opening the file,
     * it gets a new id (the document's id is kept as importedFrom), so saving never replaces a stored project.
     */
    openProject: (doc) => {
      if (!doc || typeof doc !== 'object') throw new Error('openProject: expected a project document.');
      return app.loadProjectJSON({ ...doc, id: uid('p'), importedFrom: doc.id ?? doc.importedFrom ?? null }, null);
    },

    build: {
      crystal: (prototype, params) => buildCrystal(prototype, params),
      cluster: (kind, params) => buildCluster(kind, params),
      molecule: (id) => buildMolecule(id),
      prototypes: () => prototypes.list().map(({ sites, ...p }) => p),
      clusters: () => clusters.list().map(({ build, ...c }) => c),
      molecules: () => Object.keys(MOLECULES),
    },
    analysis: {
      bonds: (s = app.structure, opt) => { need(s); return findBonds(s.positions, s.symbols, opt); },
      neighbors: (s = app.structure, opt) => { need(s); return findPeriodicNeighbors(s.positions, s.symbols, s.cell, s.pbc, opt); },
      summary: (s = app.structure) => need(s).summary(),
      coordination: (s = app.structure, opt) => coordinationStats(need(s), opt ?? analysisContext(app, s).bondOptions),
      rdf: (s = app.structure, opt) => rdf(need(s), opt),
    },
    /** Run a registered analysis (built-in, JS plugin or server plugin) on the active structure. Returns a Promise. */
    analyze: (id, params = {}, s = app.structure) => analyses.run(id, s, params, analysisContext(app, s)),

    set: (path, value) => { assertSafePath(path); return app.set(path, value); },
    get: (path) => app.get(path),
    patch: (partial) => { assertSafeObject(partial); return app.patch(partial); },
    applyLook: (id) => app.applyLook(id),
    setRepresentation: (id) => app.setRepresentation(id),
    setLighting: (id) => app.setLightingPreset(id),
    view: (axis) => app.viewer.setView(axis),
    resetView: () => app.viewer.resetView(),
    fit: () => app.viewer.fitView(),
    /** Orbit the camera by dAz° (to the right) and dEl° (upwards). */
    orbit: (dAz = 0, dEl = 0) => app.viewer.orbitBy(dAz, dEl),
    /** Turn the model by deg° about a screen axis: 'x' (right), 'y' (up) or 'z' (towards the viewer), as the arrow keys do. */
    rotate: (axis, deg) => app.viewer.rotateScreen(axis, deg),
    /** Move the model on screen by (dx, dy) CSS pixels. */
    pan: (dx = 0, dy = 0) => app.viewer.panBy(dx, dy),
    /** Zoom by a factor (> 1 zooms in). */
    zoom: (f) => app.viewer.zoomBy(f),
    /** Source indices of the atoms drawn inside a client-space rectangle (as box selection uses). */
    atomsInRect: (x0, y0, x1, y1) => app.viewer.atomsInRect(x0, y0, x1, y1),
    /** Source indices of the atoms drawn inside a client-space polygon [[x, y], …] (as lasso selection uses). */
    atomsInPolygon: (points) => app.viewer.atomsInPolygon(points),
    getCamera: () => app.viewer.getCameraState(),
    setCamera: (c) => app.viewer.setCameraState(c),
    select: (indices, opt) => app.select(indices, opt),
    get selection() { return app.selection; },
    clearSelection: () => app.clearSelection(),
    /** A named halo around atoms (source indices; null clears it): opts {color, grow, opacity, strength, contrast, export}. */
    highlight: (name, indices, opts) => app.viewer.setHighlight(name, indices, opts),
    /** Hide atoms under a name: spec null (remove), {hide: indices}, {show: indices} or a Uint8Array (1 = drawn). Returns the number hidden. */
    setVisibility: (name, spec) => app.viewer.setVisibility(name, spec),
    /** Select every atom of the active structure. Returns the selection. */
    selectAll() { if (app.structure) app.select(app.structure.symbols.map((_, i) => i)); return app.selection; },
    /**
     * Select every atom of some elements: a symbol ('O'), symbols (['Ti', 'O']), or — without an
     * argument — the elements of the current selection. Returns the selection.
     */
    selectSameElement(which) {
      const s = app.structure;
      if (!s) return [];
      const syms = new Set(which == null ? app.selection.map((i) => s.symbols[i]) : [].concat(which));
      app.select(s.symbols.map((x, i) => (syms.has(x) ? i : -1)).filter((i) => i >= 0));
      return app.selection;
    },
    /** Add the bonded neighbours (as drawn) of `indices` (default: the selection). Returns the selection. */
    selectNeighbors(indices = app.selection, { add = true } = {}) {
      const s = app.structure;
      if (!s) return [];
      const base = new Set(indices);
      const out = new Set(add ? [...app.selection, ...base] : base);
      const m = app.viewer.model;
      const pairs = m?.bonds?.pairs;
      if (pairs && m.src) {
        for (let k = 0; k + 1 < pairs.length; k += 2) {
          const a = m.src[pairs[k]], b = m.src[pairs[k + 1]];
          if (base.has(a)) out.add(b);
          if (base.has(b)) out.add(a);
        }
      } else {
        const opt = analysisContext(app, s).bondOptions;
        const list = s.periodic ? findPeriodicNeighbors(s.positions, s.symbols, s.cell, s.pbc, opt) : null;
        if (list) for (const { i, j } of list) { if (base.has(i)) out.add(j); if (base.has(j)) out.add(i); }
        else { const b = findBonds(s.positions, s.symbols, opt); for (let k = 0; k < b.count; k++) { const i = b.pairs[2 * k], j = b.pairs[2 * k + 1]; if (base.has(i)) out.add(j); if (base.has(j)) out.add(i); } }
      }
      app.select([...out]);
      return app.selection;
    },
    /** Select the bonded fragments (as drawn) of `indices` (default: the selection), as a double-click does. Returns the selection. */
    selectFragment(indices = app.selection, { add = false } = {}) {
      const m = app.viewer.model;
      if (!app.structure || !m?.n) return [];
      app.select(bondedFragment(m, [...indices].map(Number)), { mode: add ? 'add' : 'replace' });
      return app.selection;
    },
    measure(type, indices) { need(app.structure); const m = app.viewer.addMeasurement(type, indices); app.emit('measure'); return m; },
    frame: (i) => app.viewer.setFrame(i),
    play: (on = true) => app.viewer.play(on),

    screenshot: (opt) => app.viewer.screenshot(opt),
    /** Structure file text in a format; a Promise for formats written by the server. */
    exportText: (format, s = app.structure) => exportStructure(need(s), format).text,
    exportGLB: () => app.viewer.exportGLB(),
    save: (provider) => app.saveTo(provider),
    projects: {
      providers: () => app.storage.list().map((p) => ({ id: p.id, label: p.label })),
      list: (provider = app.defaultProvider) => app.storage.get(provider).list(),
      open: (provider, id) => app.openProject(provider, id),
    },
    /** The current scene as a script of crystallume calls (what “Copy current scene as script” copies). */
    sceneScript: () => sceneScript(app),

    on(event, fn) {
      const offA = app.on(event, fn), offV = app.viewer.on(event, fn);
      return () => { offA(); offV(); };
    },
    toast: (msg, opt) => toast(msg, opt),
    command: (id, ...a) => commands.run(id, ...a),

    registry: {
      formats: wrap(formats, (f, o) => api.registerFormat(f, o)),
      styles: wrap(styles, (s, o) => api.registerStyle(s, o)),
      materials: wrap(materials, (m, o) => api.registerMaterial(m, o)),
      colorSchemes: wrap(colorSchemes, (s, o) => api.registerColorScheme(s, o)),
      lighting: wrap(lightingPresets, (p, o) => api.registerLightingPreset(p, o)),
      environmentMaps: wrap(environmentMaps, (m, o) => api.registerEnvironmentMap(m, o)),
      looks: wrap(looks, (l, o) => api.registerLook(l, o)),
      samples: wrap(samples, (s, o) => api.registerSample(s, o)),
      analyses: wrap(analyses, (a, o) => api.registerAnalysis(a, o)),
      prototypes, clusters, commands,
      storage: app.storage,
      panels: { left: (p, o) => api.registerPanel(p, o), inspector: (t, o) => api.registerInspectorTab(t, o) },
    },
    // convenience registrars (plugin-friendly); each returns a function that removes the entry
    registerFormat: (f, o) => registerIn('formats', formats, f, o),
    registerColorScheme: (s, o) => registerIn('colorSchemes', colorSchemes, { name: s?.id, ...s }, o),
    registerLightingPreset: (p, o) => registerIn('lighting', lightingPresets, { name: p?.id, swatch: [p?.key?.color ?? '#fff', p?.fill?.color ?? '#ddd', p?.hemi?.ground ?? '#888'], hemi: { intensity: 0.3, sky: '#fff', ground: '#666' }, ambient: { intensity: 0.05, color: '#fff' }, key: { intensity: 2, color: '#fff', azimuth: -35, elevation: 35 }, fill: { intensity: 0.5, color: '#fff', azimuth: 45, elevation: 5 }, rim: { intensity: 1, color: '#fff', azimuth: 160, elevation: 30 }, extra: [], env: { enabled: true, intensity: 0.5 }, ...p }, o),
    /** Add an image-based-lighting environment: { id, name, description?, build: () => THREE.Scene }. */
    registerEnvironmentMap: (m, o) => registerIn('environmentMaps', environmentMaps, { name: m?.id, ...m }, o),
    registerLook: (l, o) => registerIn('looks', looks, { name: l?.id, swatch: 'linear-gradient(135deg,#d7dbe0,#8d949c)', ...l }, o),
    registerMaterial: (m, o) => registerIn('materials', materials, m && !m.name ? Object.assign(m, { name: m.id }) : m, o),
    registerStyle: (s, o) => registerIn('styles', styles, { name: s?.id, description: '', icon: STYLE_ICON, defaults: {}, ...s }, o),
    registerSample: (s, o) => registerIn('samples', samples, { name: s?.id, category: 'Plugins', tags: [], ...s }, o),
    registerAnalysis: (a, o) => registerIn('analyses', analyses, a, o),
    registerCommand: (c, o) => registerIn('commands', commands, { category: 'Plugin', title: c?.id, ...c }, o),
    registerStorage: (p, o) => registerIn('storage', app.storage, p, o),
    /** Add a left-rail panel: { id, title, icon, tip?, render(app, el, shell) }. */
    registerPanel: (p, o) => registerIn('panels', panelReg(leftPanels, registerLeftPanel), { icon: 'plug', ...p }, o),
    /** Add an inspector tab: { id, title, icon, tip?, render(app, el, shell) }. */
    registerInspectorTab: (t, o) => registerIn('inspector', panelReg(inspectorTabs, registerInspectorTab), { icon: 'plug', ...t }, o),
    /** Add a section to the Surface panel ('surface') or a Structure panel slot ('structure', slot 'cell' | 'transform'). */
    registerPanelSection: (panelId, s, o) => owned(registerPanelSection(panelId, s, o)),
    /** Add a selection-card button and/or atom-menu item: { id, label, icon, order, when, run(app, sel, ctx), … }. */
    registerSelectionAction: (a, o) => owned(registerSelectionAction(a, o)),
    /** Add lines to the atom hover card and selection card: fn(app, index, { where }) → [{ label, value }] | null. */
    registerAtomInfo: (fn, o) => owned(registerAtomInfo(fn, o)),

    plugins: {
      /** Server plugins (name, version, status, error, frontend) and frontend plugins (name, url, status, error). */
      list() {
        const srv = (app.serverStore?.info?.plugins ?? []).map((p) => {
          const fe = records.filter((r) => r.source === 'server' && r.name === p.name);
          const feErr = fe.find((r) => r.status === 'error');
          return {
            name: p.name, version: p.version, description: p.description, server: true,
            status: p.status === 'error' || feErr ? 'error' : 'active', error: p.error ?? feErr?.error ?? null,
            frontend: fe.map(({ url, status, error }) => ({ url, status, error })),
          };
        });
        const names = new Set(srv.map((p) => p.name));
        return [...srv, ...records.filter((r) => !(r.source === 'server' && names.has(r.name))).map(({ disposers, ...r }) => ({ ...r }))];
      },
      /**
       * Import an ES module and call its default export (or `activate`) with this API. Each URL loads once;
       * failures are recorded (see list()) and rethrown. Registrations of a failed plugin are undone.
       */
      async load(url, meta = {}) {
        const href = new URL(url, document.baseURI).href;
        let rec = records.find((r) => r.url === href);
        if (rec?.status === 'active' || rec?.status === 'loading') return rec.promise ?? true;
        if (!rec) { rec = { name: meta.name ?? href.split('/').pop().replace(/\.m?js$/, ''), url: href, source: meta.source ?? 'script' }; records.push(rec); }
        Object.assign(rec, { ...meta, url: href, status: 'loading', error: null, disposers: [] });
        rec.promise = (async () => {
          try {
            const mod = await import(/* @vite-ignore */ href);
            const activate = mod.default ?? mod.activate;
            if (typeof activate !== 'function') throw new Error(`${url} does not export an activate(api) function`);
            const prev = activating;
            activating = rec;
            try { await activate(api); } finally { activating = prev; }
            rec.status = 'active';
            return true;
          } catch (e) {
            rec.status = 'error'; rec.error = e?.message ?? String(e);
            for (const d of rec.disposers.splice(0).reverse()) { try { d(); } catch { /* ignore */ } }
            throw e;
          } finally { delete rec.promise; app.emit('plugins'); }
        })();
        return rec.promise;
      },
    },

    /** Everything the API offers, as data: registries (with example calls), commands, scene paths and events. */
    reference() {
      const ids = (reg, f = () => true) => reg.list().filter(f).map((x) => x.id);
      const R = (name, label, list, example) => ({ name, label, count: list.length, ids: list, example });
      // a command's parameter schema as data: functions (option lists, presets of the structure) are left out
      const data = (v, depth = 0) => (typeof v === 'function' || depth > 8 ? undefined
        : Array.isArray(v) ? v.map((x) => data(x, depth + 1)).filter((x) => x !== undefined)
          : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, data(x, depth + 1)]).filter(([, x]) => x !== undefined)) : v);
      const command = (c) => ({
        id: c.id, title: c.title, category: c.category, key: c.key == null ? '' : [].concat(c.key).join(' / '),
        aliases: c.aliases == null ? [] : [].concat(c.aliases), ms: c.ms ?? null, params: Array.isArray(c.params) ? data(c.params) : null,
      });
      return {
        registries: [
          R('looks', 'Looks', ids(looks, (l) => !l.hidden), "crystallume.applyLook('{id}')"),
          R('styles', 'Representations', ids(styles), "crystallume.setRepresentation('{id}')"),
          R('lighting', 'Lighting presets', ids(lightingPresets), "crystallume.setLighting('{id}')"),
          R('environmentMaps', 'Environment maps', ids(environmentMaps), "crystallume.set('lighting.env.map', '{id}')"),
          R('colorSchemes', 'Colour schemes', ids(colorSchemes), "crystallume.set('style.colorScheme', '{id}')"),
          R('materials', 'Materials', ids(materials), "crystallume.set('style.material', '{id}')"),
          R('samples', 'Samples', ids(samples), "crystallume.sample('{id}')"),
          R('analyses', 'Analyses', ids(analyses), "await crystallume.analyze('{id}')"),
          R('formats', 'File formats', ids(formats), "await crystallume.exportText('{id}')"),
          R('prototypes', 'Crystal prototypes', ids(prototypes), "crystallume.load(crystallume.build.crystal('{id}'))"),
          R('clusters', 'Cluster shapes', ids(clusters), "crystallume.load(crystallume.build.cluster('{id}', { element: 'Au' }))"),
          R('molecules', 'Molecules', Object.keys(MOLECULES), "crystallume.load(crystallume.build.molecule('{id}'))"),
          R('storage', 'Project storage', app.storage.list().map((p) => p.id), "await crystallume.projects.list('{id}')"),
          R('panels', 'Side panels', [...leftPanels.keys()], "crystallume.shell.openLeft('{id}')"),
        ],
        // with the Materials Studio names (aliases), the MS menu path (ms) and the parameter schema (null: none)
        commands: commands.list().filter((c) => !c.hidden).map(command),
        scene: scenePaths().map(([path, def]) => ({ path, type: typeOf(def), default: def, current: app.get(path) })),
        events: EVENTS,
      };
    },
    /**
     * Print the API in the console: help() shows registries, commands, scene paths and events;
     * help('commands' | 'scene' | 'events' | 'registries' | <registry name>) shows one table.
     */
    help(topic) {
      const ref = api.reference();
      const fmt = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
      const tables = {
        registries: ref.registries.map((r) => ({ registry: r.name, count: r.count, example: r.example.replace('{id}', r.ids[0] ?? 'id'), ids: r.ids.slice(0, 12).join(', ') + (r.count > 12 ? ', …' : '') })),
        commands: ref.commands.map((c) => ({ id: c.id, title: c.title, category: c.category, key: c.key })),
        scene: ref.scene.map((s) => ({ path: s.path, type: s.type, default: fmt(s.default), current: fmt(s.current) })),
        events: ref.events.map((e) => ({ event: e.name, source: e.source, payload: e.payload, description: e.description })),
      };
      const show = (title, rows) => { console.log(`%c${title}`, 'font-weight:600;font-size:13px'); console.table(rows); };
      const t = topic == null ? null : String(topic);
      if (t && tables[t]) { show(t, tables[t]); return ref[t]; }
      const reg = t && ref.registries.find((r) => r.name.toLowerCase() === t.toLowerCase());
      if (reg) { show(reg.label, reg.ids.map((id) => ({ id, call: reg.example.replace('{id}', id) }))); return reg; }
      if (t) console.warn(`help: unknown topic “${t}”. Try ${['registries', 'commands', 'scene', 'events', ...ref.registries.map((r) => r.name)].join(', ')}.`);
      console.log(`%cCrystallume ${VERSION} — window.crystallume`, 'font-weight:700;font-size:14px', '\nhelp(topic) shows one table: registries, commands, scene, events, or a registry name such as looks.\nPlugins: export default function activate(api) { api.registerLook({...}) } — see docs/PLUGINS.md.');
      show('Registries', tables.registries); show('Commands', tables.commands); show('Scene paths', tables.scene); show('Events', tables.events);
      return ref;
    },
  };
  return api;
}
