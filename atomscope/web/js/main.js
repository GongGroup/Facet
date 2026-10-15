/** Bootstrap: build the app, register commands and shortcuts, load plugins and the first structure. */
import { App } from './app.js';
import { Shell } from './ui/shell.js';
import './ui/panels/projects.js';
import './ui/panels/library.js';
import './ui/panels/build.js';
import './ui/panels/structure.js';
import './ui/panels/appearance.js';
import { commands } from './core/commands.js';
import { samples } from './build/samples.js';
import { looks } from './render/looks.js';
import { styles } from './render/styles.js';
import { lightingPresets } from './render/lighting.js';
import { colorSchemes } from './render/colors.js';
import { formats } from './io/index.js';
import { pickFiles } from './storage/files.js';
import { toast } from './ui/overlays.js';
import { createAPI } from './api/public.js';
import { installEmbedAPI } from './api/embed.js';

async function boot() {
  const root = document.querySelector('.app');
  let app;
  try { app = new App(root.querySelector('.viewport')); }
  catch (e) {
    root.querySelector('.viewport').innerHTML = `<div style="padding:24px;max-width:520px;margin:10vh auto;font:14px/1.5 system-ui"><h2>3D graphics are not available</h2><p>AtomScope needs WebGL 2. Turn on hardware acceleration in your browser settings, or try a recent Chrome, Edge, Firefox or Safari.</p><p style="color:#888">${e.message}</p></div>`;
    return;
  }
  const shell = new Shell(app, root);
  registerCommands(app, shell);
  await app.init();
  const api = createAPI(app, shell);
  window.atomscope = api;
  installEmbedAPI(api);
  await loadServerExtensions(app, api, shell);

  // first content: #sample-id, last project, or a sample
  const hash = decodeURIComponent(location.hash.slice(1));
  let opened = false;
  if (hash.startsWith('project=') && app.storage.get('server')) {
    try { await app.openProject('server', hash.slice(8)); opened = true; } catch (e) { toast(e.message, { type: 'error' }); }
  } else if (hash && samples.get(hash)) {
    app.loadSample(hash); opened = true;
  }
  const last = app.prefs.last;
  if (!opened && last && last.provider !== 'folder' && app.storage.get(last.provider)) {
    try { await app.openProject(last.provider, last.id); opened = true; } catch { /* gone */ }
  }
  if (!opened) {
    app.loadSample('perovskite');
    app.dirty = false; app.setSaveState('idle'); app.undoStack = [];
  }
  app.on('saved', () => app.setPref('last', app.project.location));
  app.on('project', () => { if (app.project.location) app.setPref('last', app.project.location); });
  shell.renderDrawer();
  shell.welcome();
  document.body.dataset.ready = 'true';
}

async function loadServerExtensions(app, api, shell) {
  const info = app.serverStore.info;
  if (!info) return;
  for (const p of info.presets?.lighting ?? []) api.registerLightingPreset(p);
  for (const c of info.presets?.colorSchemes ?? []) {
    api.registerColorScheme({ id: c.id, name: c.name, description: c.description ?? 'From a server plugin', colorFor: (sym) => c.colors?.[sym] ?? c.default ?? '#b0b6bd' });
  }
  for (const l of info.presets?.styles ?? []) if (l.scene) api.registerLook({ swatch: l.swatch ?? 'linear-gradient(#ccc,#999)', ...l });
  for (const p of info.plugins ?? []) {
    for (const url of p.frontend ?? []) {
      try { await api.plugins.load(url, { name: p.name }); }
      catch (e) { console.warn(`Plugin ${p.name} failed to load`, e); toast(`Plugin “${p.name}” failed to load: ${e.message}`, { type: 'error' }); }
    }
  }
  shell.renderInspector();
}

function registerCommands(app, shell) {
  const R = (c) => commands.register(c);
  const hasS = () => !!app.structure;
  const per = () => !!app.structure?.cell;
  const run = (p) => p?.catch?.((e) => toast(e.message, { type: 'error' }));
  R({ id: 'file.open', title: 'Open files…', category: 'File', keywords: 'import cif poscar xyz pdb', run: async () => { const fs = await pickFiles({ accept: '.cif,.xyz,.extxyz,.vasp,.poscar,.pdb,.json,.mcif,.ent,*', multiple: true }); if (fs.length) app.importFiles(fs); } });
  R({ id: 'project.save', title: 'Save project', category: 'File', run: () => run(shell.saveToProvider(app.project.location?.provider ?? app.defaultProvider)) });
  R({ id: 'project.new', title: 'New project', category: 'File', run: () => app.newProject() });
  R({ id: 'project.download', title: 'Download project file', category: 'File', run: () => run(app.downloadProject()) });
  R({ id: 'export.png1', title: 'Export PNG (screen size)', category: 'Export', when: hasS, run: () => run(app.exportImage({ scale: 1 })) });
  R({ id: 'export.png2', title: 'Export PNG 2×', category: 'Export', when: hasS, run: () => run(app.exportImage({ scale: 2 })) });
  R({ id: 'export.png4', title: 'Export PNG 4× (poster)', category: 'Export', when: hasS, run: () => run(app.exportImage({ scale: 4 })) });
  R({ id: 'export.pngT', title: 'Export PNG with transparent background', category: 'Export', when: hasS, run: () => run(app.exportImage({ scale: 2, transparent: true })) });
  R({ id: 'export.glb', title: 'Export 3D model (.glb)', category: 'Export', keywords: 'gltf blender', when: hasS, run: () => run(app.exportGLB()) });
  for (const f of formats.writers()) R({ id: `export.${f.id}`, title: `Export ${f.name}`, category: 'Export', when: () => hasS() && (!['poscar', 'cif'].includes(f.id) || per()), run: () => run(app.exportStructureFile(f.id)) });

  R({ id: 'view.reset', title: 'Reset view', category: 'View', key: 'r', when: hasS, run: () => app.viewer.resetView() });
  R({ id: 'view.fit', title: 'Fit to screen', category: 'View', key: 'f', when: hasS, run: () => app.viewer.fitView() });
  for (const ax of ['a', 'b', 'c']) R({ id: `view.${ax}`, title: `Look along ${ax}`, category: 'View', key: ax, when: per, run: () => app.viewer.setView(ax) });
  for (const ax of ['x', 'y', 'z']) R({ id: `view.${ax}`, title: `Look along ${ax}`, category: 'View', key: ax, when: hasS, run: () => app.viewer.setView(ax) });
  R({ id: 'view.projection', title: 'Toggle perspective / orthographic', category: 'View', key: 'p', run: () => app.set('display.projection', app.scene.display.projection === 'orthographic' ? 'perspective' : 'orthographic') });
  R({ id: 'view.turntable', title: 'Toggle turntable', category: 'View', key: 't', run: () => app.set('display.turntable', !app.scene.display.turntable) });
  R({ id: 'view.cell', title: 'Toggle unit cell', category: 'View', key: 'u', run: () => app.set('display.cell.show', !app.scene.display.cell.show) });
  R({ id: 'view.labels', title: 'Cycle atom labels', category: 'View', key: 'l', run: () => { const o = ['none', 'element', 'index', 'both']; app.set('display.labels', o[(o.indexOf(app.scene.display.labels) + 1) % 4]); toast(`Labels: ${app.scene.display.labels}`); } });
  R({ id: 'view.fullscreen', title: 'Full screen', category: 'View', run: () => shell.fullscreen() });
  R({ id: 'tool.measure', title: 'Measure distance', category: 'Tools', key: 'm', when: hasS, run: () => app.setTool('measure', 'distance') });
  R({ id: 'tool.angle', title: 'Measure angle', category: 'Tools', when: hasS, run: () => app.setTool('measure', 'angle') });
  R({ id: 'tool.dihedral', title: 'Measure dihedral', category: 'Tools', when: hasS, run: () => app.setTool('measure', 'dihedral') });
  R({ id: 'tool.select', title: 'Select tool', category: 'Tools', key: 'v', run: () => app.setTool('select') });
  R({ id: 'sel.clear', title: 'Clear selection / exit tool', category: 'Edit', key: 'Escape', run: () => { app.setTool('select'); app.clearSelection(); } });
  R({ id: 'sel.delete', title: 'Delete selected atoms', category: 'Edit', key: 'Delete', when: () => app.selection.length > 0, run: () => app.deleteSelected() });
  R({ id: 'sel.delete2', title: 'Delete selected atoms', category: 'Edit', key: 'Backspace', when: () => app.selection.length > 0, run: () => app.deleteSelected(), hidden: true });
  R({ id: 'sel.invert', title: 'Invert selection', category: 'Edit', when: hasS, run: () => app.invertSelection() });
  R({ id: 'edit.undo', title: 'Undo', category: 'Edit', run: () => app.undo() });
  R({ id: 'edit.redo', title: 'Redo', category: 'Edit', run: () => app.redo() });
  R({ id: 'traj.play', title: 'Play / pause trajectory', category: 'Trajectory', key: ' ', when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.play() });
  R({ id: 'traj.prev', title: 'Previous frame', category: 'Trajectory', key: 'ArrowLeft', when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.setFrame((app.structure.frame - 1 + app.structure.nFrames) % app.structure.nFrames) });
  R({ id: 'traj.next', title: 'Next frame', category: 'Trajectory', key: 'ArrowRight', when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.setFrame((app.structure.frame + 1) % app.structure.nFrames) });
  R({ id: 'ui.left', title: 'Toggle side panel', category: 'Window', key: '[', run: () => shell.toggleLeft(shell.leftId) });
  R({ id: 'ui.right', title: 'Toggle appearance panel', category: 'Window', key: ']', run: () => { shell.inspectorOpen = !shell.inspectorOpen; shell.syncPanels(); } });
  R({ id: 'ui.shortcuts', title: 'Keyboard shortcuts', category: 'Help', key: '?', run: () => shell.shortcutsDialog() });
  R({ id: 'ui.tour', title: 'Take the tour', category: 'Help', run: () => shell.tour() });
  R({ id: 'ui.theme', title: 'Switch interface theme', category: 'Window', run: () => shell.cycleTheme() });
  R({ id: 'ui.api', title: 'Scripting & API', category: 'Help', run: () => shell.apiDialog() });
  for (const p of ['projects', 'library', 'build', 'structure']) R({ id: `panel.${p}`, title: `Show ${p} panel`, category: 'Window', run: () => shell.openLeft(p) });

  styles.list().forEach((s, i) => R({ id: `rep.${s.id}`, title: s.name, category: 'Representation', key: i < 9 ? String(i + 1) : undefined, keywords: s.description, run: () => app.setRepresentation(s.id) }));
  looks.list().filter((l) => !l.hidden).forEach((l) => R({ id: `look.${l.id}`, title: l.name, category: 'Look', keywords: l.description, run: () => app.applyLook(l.id) }));
  lightingPresets.list().forEach((l) => R({ id: `light.${l.id}`, title: l.name, category: 'Lighting', keywords: l.description, run: () => app.setLightingPreset(l.id) }));
  colorSchemes.list().forEach((c) => R({ id: `color.${c.id}`, title: c.name, category: 'Colours', keywords: c.description, run: () => app.set('style.colorScheme', c.id) }));
  samples.list().forEach((s) => R({ id: `sample.${s.id}`, title: s.name, category: 'Sample', keywords: `${s.category} ${(s.tags ?? []).join(' ')}`, run: () => app.loadSample(s.id) }));
  for (const [path, title] of [['post.ao.enabled', 'ambient occlusion'], ['post.outline.enabled', 'ink outlines'], ['post.bloom.enabled', 'bloom'], ['post.dof.enabled', 'depth of field'], ['post.fog.enabled', 'depth cueing'], ['lighting.shadows.enabled', 'shadows']]) {
    R({ id: `toggle.${path}`, title: `Toggle ${title}`, category: 'Effects', run: () => { app.set(path, !app.get(path)); toast(`${title[0].toUpperCase() + title.slice(1)} ${app.get(path) ? 'on' : 'off'}`); } });
  }
}

boot().catch((e) => { console.error(e); toast(`AtomScope failed to start: ${e.message}`, { type: 'error' }); });
