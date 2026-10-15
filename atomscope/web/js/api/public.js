/**
 * Public JavaScript API — `window.atomscope`. Also the object handed to plugins' `activate(api)`.
 * Everything the UI can do is reachable from here; registries let plugins add formats, builders,
 * representations, materials, colour schemes, lighting rigs, looks, samples, storage backends,
 * panels and commands.
 */
import { Structure } from '../core/structure.js';
import { formats, parseStructure, exportStructure } from '../io/index.js';
import { prototypes, buildCrystal } from '../build/crystal.js';
import { clusters, buildCluster } from '../build/cluster.js';
import { buildMolecule, MOLECULES } from '../build/molecules.js';
import { samples } from '../build/samples.js';
import { styles } from '../render/styles.js';
import { materials } from '../render/materials.js';
import { colorSchemes } from '../render/colors.js';
import { lightingPresets } from '../render/lighting.js';
import { looks } from '../render/looks.js';
import { commands } from '../core/commands.js';
import { registerLeftPanel, registerInspectorTab } from '../ui/shell.js';
import { toast } from '../ui/overlays.js';
import { findBonds, findPeriodicNeighbors } from '../core/bonds.js';
import { VERSION } from '../app.js';

export function createAPI(app, shell) {
  const loaded = [];
  const toStructure = (input, opts = {}) => {
    if (input instanceof Structure) return input;
    if (typeof input === 'string') return parseStructure(input, opts.name ?? '', opts.format ?? null);
    if (input && typeof input === 'object') return Structure.fromJSON(input);
    throw new Error('load() expects a Structure, a structure JSON object or file text');
  };
  const api = {
    version: VERSION,
    app, viewer: app.viewer, shell,
    Structure,
    get structure() { return app.structure; },
    get scene() { return app.scene; },
    get project() { return app.projectToJSON({ thumbnail: false }); },

    /** Show a structure (Structure, JSON or file text). Returns the Structure. */
    load(input, opts = {}) {
      const s = toStructure(input, opts);
      if (opts.name) s.name = opts.name;
      app.addStructure(s, { look: opts.look ?? null, newProject: !!opts.newProject });
      return s;
    },
    async loadURL(url, opts = {}) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch ${url}: ${res.status}`);
      return api.load(await res.text(), { name: url.split('/').pop(), ...opts });
    },
    sample: (id) => app.loadSample(id),
    openProject: (doc) => app.loadProjectJSON(doc),

    build: {
      crystal: (prototype, params) => buildCrystal(prototype, params),
      cluster: (kind, params) => buildCluster(kind, params),
      molecule: (id) => buildMolecule(id),
      prototypes: () => prototypes.list().map(({ sites, ...p }) => p),
      clusters: () => clusters.list().map(({ build, ...c }) => c),
      molecules: () => Object.keys(MOLECULES),
    },
    analysis: {
      bonds: (s = app.structure, opt) => findBonds(s.positions, s.symbols, opt),
      neighbors: (s = app.structure, opt) => findPeriodicNeighbors(s.positions, s.symbols, s.cell, s.pbc, opt),
      summary: (s = app.structure) => s.summary(),
    },

    set: (path, value) => app.set(path, value),
    get: (path) => app.get(path),
    patch: (partial) => app.patch(partial),
    applyLook: (id) => app.applyLook(id),
    setRepresentation: (id) => app.setRepresentation(id),
    setLighting: (id) => app.setLightingPreset(id),
    view: (axis) => app.viewer.setView(axis),
    resetView: () => app.viewer.resetView(),
    fit: () => app.viewer.fitView(),
    getCamera: () => app.viewer.getCameraState(),
    setCamera: (c) => app.viewer.setCameraState(c),
    select: (indices, opt) => app.select(indices, opt),
    get selection() { return app.selection; },
    measure(type, indices) { app.viewer.addMeasurement(type, indices); app.emit('measure'); return app.viewer.measurements.at(-1); },
    frame: (i) => app.viewer.setFrame(i),
    play: (on = true) => app.viewer.play(on),

    screenshot: (opt) => app.viewer.screenshot(opt),
    exportText: (format, s = app.structure) => exportStructure(s, format).text,
    exportGLB: () => app.viewer.exportGLB(),
    save: (provider) => app.saveTo(provider),
    projects: {
      providers: () => app.storage.list().map((p) => ({ id: p.id, label: p.label })),
      list: (provider = app.defaultProvider) => app.storage.get(provider).list(),
      open: (provider, id) => app.openProject(provider, id),
    },

    on(event, fn) {
      const offA = app.on(event, fn), offV = app.viewer.on(event, fn);
      return () => { offA(); offV(); };
    },
    toast: (msg, opt) => toast(msg, opt),
    command: (id, ...a) => commands.run(id, ...a),

    registry: {
      formats, styles, materials, colorSchemes, lighting: lightingPresets, looks, samples, prototypes, clusters, commands,
      storage: app.storage,
      panels: { left: registerLeftPanel, inspector: registerInspectorTab },
    },
    // convenience registrars (plugin-friendly)
    registerFormat: (f) => formats.register(f),
    registerColorScheme: (s) => { const off = colorSchemes.register(s); shell.refreshInspector(); return off; },
    registerLightingPreset: (p) => { const off = lightingPresets.register({ swatch: [p.key?.color ?? '#fff', p.fill?.color ?? '#ddd', p.hemi?.ground ?? '#888'], hemi: { intensity: 0.3, sky: '#fff', ground: '#666' }, ambient: { intensity: 0.05, color: '#fff' }, key: { intensity: 2, color: '#fff', azimuth: -35, elevation: 35 }, fill: { intensity: 0.5, color: '#fff', azimuth: 45, elevation: 5 }, rim: { intensity: 1, color: '#fff', azimuth: 160, elevation: 30 }, extra: [], env: { enabled: true, intensity: 0.5 }, ...p }); shell.refreshInspector(); return off; },
    registerLook: (l) => { const off = looks.register(l); shell.refreshInspector(); return off; },
    registerMaterial: (m) => materials.register(m),
    registerStyle: (s) => styles.register(s),
    registerSample: (s) => samples.register(s),
    registerCommand: (c) => commands.register({ category: 'Plugin', ...c }),
    registerStorage: (p) => app.storage.register(p),

    plugins: {
      list: () => loaded.slice(),
      async load(url, meta = {}) {
        const mod = await import(/* @vite-ignore */ url);
        const activate = mod.default ?? mod.activate;
        if (typeof activate !== 'function') throw new Error(`${url} does not export an activate(api) function`);
        await activate(api);
        loaded.push({ url, ...meta });
        app.emit('plugins');
        return true;
      },
    },
  };
  return api;
}
