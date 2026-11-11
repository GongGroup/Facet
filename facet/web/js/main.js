/** Bootstrap: build the app, register commands and shortcuts, load plugins and the first structure. */
import { App } from './app.js';
import { Shell } from './ui/shell.js';
import './api/latticeapi.js';
import './ui/panels/projects.js';
import './ui/panels/library.js';
import './ui/panels/build.js';
import './ui/panels/structure.js';
import './ui/panels/surface.js';
import './ui/panels/appearance.js';

// --- surface-modeling M1-sections ---
// --- end M1-sections ---

// --- surface-modeling M1-commands ---
// --- end M1-commands ---

// --- surface-modeling M2-cleave ---
// --- end M2-cleave ---

// --- surface-modeling M2-slab ---
// --- end M2-slab ---

// --- surface-modeling M3-commands ---
// --- end M3-commands ---

// --- surface-modeling M3-layers ---
// --- end M3-layers ---

// --- surface-modeling M3-constraints ---
// --- end M3-constraints ---

// --- surface-modeling M3-atomselection ---
// --- end M3-atomselection ---

// --- surface-modeling M4-move ---
// --- end M4-move ---

// --- surface-modeling M4-commands ---
// --- end M4-commands ---

// --- surface-modeling M4-transform ---
// --- end M4-transform ---

// --- surface-modeling M4-clipboard ---
// --- end M4-clipboard ---

// --- surface-modeling M4-place ---
// --- end M4-place ---

// --- surface-modeling M5-adsorbates ---
// --- end M5-adsorbates ---

// --- surface-modeling M5-sitepick ---
// --- end M5-sitepick ---

// --- surface-modeling M6-interface ---
// --- end M6-interface ---

import { commands } from './core/commands.js';
import { sectionFallbacks, CANCEL_PREVIEW } from './core/commands.js';
import { openSection, requireCell, requireVacuumGap } from './ui/sections.js';
import { confirmDialog } from './ui/overlays.js';
import * as vacuumGaps from './core/vacuum.js';
import { samples } from './build/samples.js';
import { pickFiles, probeDownloads, canDownload, NO_DOWNLOADS, isArtifact } from './storage/files.js';
import { toast } from './ui/overlays.js';
import { selectAll, selectNeighbours, selectSameElement, selectFragment } from './ui/selectioncard.js';
import { deleteSelection, replaceSelection } from './ui/selectioncard.js';
import { createAPI } from './api/public.js';
import { installEmbedAPI } from './api/embed.js';
import { installExtensions, syncRegistryCommands } from './api/extensions.js';
import { bootTasks, bootFailureMessage } from './core/boot.js';

async function boot() {
  // start-up data that the imported modules registered (core/boot.js) loads while the app starts
  const booting = bootTasks();
  const root = document.querySelector('.app');
  let app;
  try { app = new App(root.querySelector('.viewport')); }
  catch (e) {
    root.querySelector('.viewport').innerHTML = `<div style="padding:24px;max-width:520px;margin:10vh auto;font:14px/1.5 system-ui"><h2>3D graphics are not available</h2><p>Facet needs WebGL 2. Turn on hardware acceleration in your browser settings, or try a recent Chrome, Edge, Firefox or Safari.</p><p style="color:#888">${e.message}</p></div>`;
    return;
  }
  const shell = new Shell(app, root);
  registerCommands(app, shell);
  shell.renderRail();   // rail tooltips show the panel shortcuts registered above
  await app.init();
  await probeDownloads();
  shell.syncDownloads();
  // the API, the embed handshake and the first structure wait for that data; a part that fails is reported once
  const missing = bootFailureMessage(await booting);
  if (missing) toast(missing, { type: 'error' });
  const api = createAPI(app, shell);
  window.facet = api;
  window.crystallume = api;   // the app's former names, for scripts written before the renames
  window.atomscope = api;
  const announceReady = installEmbedAPI(api);   // 'facet:ready' goes out after the first content below
  // server presets, plugin analyses and formats, plugin frontends (server, plugins.json, ?plugin=); never throws
  await installExtensions(app, api, shell);

  // first content: #sample-id, last project, or a sample
  const hash = decodeURIComponent(location.hash.slice(1));
  let opened = false;
  if (hash.startsWith('project=') && app.storage.get('server')) {
    try { await app.openProject('server', hash.slice(8)); opened = true; } catch (e) { toast(e.message, { type: 'error' }); }
  } else if (hash && samples.get(hash)) {
    app.loadSample(hash); opened = true;
  }
  // a page that embeds Facet in an <iframe> starts clean: no restored project, nothing remembered for next time
  let embedded = false;
  try { embedded = window.parent !== window && !isArtifact(); } catch { embedded = true; }
  const last = embedded ? null : app.prefs.last;
  if (!opened && last && last.provider !== 'folder' && app.storage.get(last.provider)) {
    try { await app.openProject(last.provider, last.id); opened = true; } catch { /* gone */ }
  }
  if (!opened) {
    app.loadSample('perovskite');
    app.dirty = false; app.setSaveState('idle'); app.history.clear();
  }
  if (!embedded) {
    app.on('saved', () => app.setPref('last', app.project.location));
    app.on('project', () => { if (app.project.location) app.setPref('last', app.project.location); });
  }
  shell.renderDrawer();
  shell.welcome();
  shell.gestureHint();
  document.body.dataset.ready = 'true';
  announceReady();
}

function registerCommands(app, shell) {
  commands.setContext(app);
  const R = (c) => commands.register(c);
  const hasS = () => !!app.structure;
  const per = () => !!app.structure?.cell;
  const canExport = () => hasS() && !app.busy && canDownload();
  const whyNot = () => (canDownload() ? null : NO_DOWNLOADS);
  const hasSel = () => hasS() && app.selection.length > 0;
  const run = (p) => p?.catch?.((e) => toast(e.message, { type: 'error' }));
  // key: shortcut that runs the command (see ui/keys.js); kbd: shortcut handled elsewhere, shown only.
  // repeat: true lets a held key repeat; shortcutGroup: one row in the shortcuts dialog for several commands.
  R({ id: 'file.open', title: 'Open files…', category: 'File', kbd: 'mod+o', aliases: ['Import'], ms: 'File › Import', keywords: 'import load cif poscar xyz pdb xsd materials studio', run: async () => { const fs = await pickFiles({ accept: '.cif,.xyz,.extxyz,.vasp,.poscar,.pdb,.xsd,.json,.mcif,.ent,*', multiple: true }); if (fs.length) app.importFiles(fs); } });
  R({ id: 'file.paste', title: 'Paste structure text…', category: 'File', keywords: 'clipboard import text cif poscar xyz pdb xsd', run: () => shell.pasteDialog() });
  R({ id: 'project.save', title: 'Save project', category: 'File', kbd: 'mod+s', run: () => run(shell.saveToProvider(app.project.location?.provider ?? app.defaultProvider)) });
  R({ id: 'project.new', title: 'New project', category: 'File', run: () => run(app.newProject()) });
  R({ id: 'project.download', title: 'Download project file', category: 'File', when: canDownload, whyNot, run: () => run(app.downloadProject()) });
  R({ id: 'export.png1', title: 'Export PNG (screen size)', category: 'Export', keywords: 'image picture screenshot', when: canExport, whyNot, run: () => run(app.exportImage({ scale: 1 })) });
  R({ id: 'export.png2', title: 'Export PNG 2×', category: 'Export', kbd: 'mod+e', keywords: 'image picture screenshot', when: canExport, whyNot, run: () => run(app.exportImage({ scale: 2 })) });
  R({ id: 'export.png4', title: 'Export PNG 4× (poster)', category: 'Export', keywords: 'image picture high resolution', when: canExport, whyNot, run: () => run(app.exportImage({ scale: 4 })) });
  R({ id: 'export.pngT', title: 'Export PNG with transparent background', category: 'Export', keywords: 'image alpha', when: canExport, whyNot, run: () => run(app.exportImage({ scale: 2, transparent: true })) });
  R({ id: 'export.glb', title: 'Export 3D model (.glb)', category: 'Export', keywords: 'gltf blender', when: canExport, whyNot, run: () => run(app.exportGLB()) });

  // Home as in Materials Studio; R (also: hold R and drag to zoom into a box) runs on release
  R({ id: 'view.reset', title: 'Reset view', category: 'View', key: ['Home', 'r'], when: hasS, run: () => app.viewer.resetView() });
  R({ id: 'view.fit', title: 'Fit to screen', category: 'View', key: 'f', when: hasS, run: () => app.viewer.fitView() });
  R({ id: 'view.zoomIn', title: 'Zoom in', category: 'View', key: ['+', '='], repeat: true, when: hasS, run: () => app.viewer.zoomBy(1.2) });
  R({ id: 'view.zoomOut', title: 'Zoom out', category: 'View', key: '-', repeat: true, when: hasS, run: () => app.viewer.zoomBy(1 / 1.2) });
  for (const ax of ['a', 'b', 'c']) R({ id: `view.${ax}`, title: `Look along ${ax}`, category: 'View', key: ax, shortcutGroup: 'Look along a, b, c', when: per, whyNot: () => (app.structure ? 'This structure has no unit cell, so it has no a, b and c axes.' : null), run: () => app.viewer.setView(ax) });
  for (const ax of ['x', 'y', 'z']) R({ id: `view.${ax}`, title: `Look along ${ax}`, category: 'View', key: ax, shortcutGroup: 'Look along x, y, z', when: hasS, run: () => app.viewer.setView(ax) });
  // N looks down on the top surface, Shift+N up at the bottom one (surfaceNormal: the vacuum gap; without one c*, and
  // a note says so, U1); Look along… takes a lattice direction, the normal of a plane or a vector (one of them)
  const noCell = () => (app.structure ? 'Looking along the surface normal needs a unit cell.' : null);
  const lookAlong = (target) => { const r = app.viewer.viewAlong(target); if (r.note) toast(r.note); return r; };
  R({ id: 'view.normal', title: 'Look along the surface normal', category: 'View', key: 'n', keywords: 'top surface plane perpendicular from above', when: per, whyNot: noCell, run: () => lookAlong('normal') });
  R({ id: 'view.normalBelow', title: 'Look at the bottom surface', category: 'View', key: 'shift+n', keywords: 'bottom surface underside from below normal', when: per, whyNot: noCell, run: () => lookAlong('-normal') });
  R({
    id: 'view.along', title: 'Look along a direction or plane…', category: 'View', keywords: 'uvw hkl miller zone axis direction plane normal vector', when: hasS,
    params: [
      { name: 'uvw', label: 'Direction [u v w]', type: 'vector', integer: true, nonzero: true },
      { name: 'hkl', label: 'Plane (h k l)', type: 'miller' },
      { name: 'vector', label: 'Vector', type: 'vector', nonzero: true },
    ],
    run: (_, p) => {
      if (p === undefined) return shell.viewAlongDialog();
      const given = p && typeof p === 'object' && !Array.isArray(p) ? ['uvw', 'hkl', 'vector'].filter((k) => p[k] != null) : [];
      if (given.length !== 1) throw Object.assign(new Error('Look along: give exactly one of uvw, hkl or vector.'), { code: 'invalid-params' });
      const [k] = given, v = p[k];
      return lookAlong(k === 'vector' ? v : k === 'hkl' && v?.length === 4 ? { hkil: v } : { [k]: v });
    },
  });
  R({ id: 'view.projection', title: 'Toggle perspective / orthographic', category: 'View', key: 'p', run: () => app.set('display.projection', app.scene.display.projection === 'orthographic' ? 'perspective' : 'orthographic') });
  R({ id: 'view.turntable', title: 'Toggle turntable', category: 'View', key: 't', keywords: 'spin rotate animate', run: () => app.set('display.turntable', !app.scene.display.turntable) });
  R({ id: 'view.cell', title: 'Toggle unit cell', category: 'View', key: 'u', run: () => app.set('display.cell.show', !app.scene.display.cell.show) });
  R({ id: 'view.labels', title: 'Cycle atom labels', category: 'View', key: 'l', run: () => { const o = ['none', 'element', 'index', 'both']; app.set('display.labels', o[(o.indexOf(app.scene.display.labels) + 1) % 4]); toast(`Labels: ${app.scene.display.labels}`); } });
  R({ id: 'view.fullscreen', title: 'Full screen', category: 'View', key: 'shift+f', run: () => shell.fullscreen() });
  // tools (render/tools/): only these commands bind the keys; a ToolDef's key (V, M) is the same key, shown on the
  // toolbar (M7 KC-03). A module's tool gets its command tool.<camelCase id> with its key in the module (tool.move: G).
  R({ id: 'tool.measure', title: 'Measure distance', category: 'Tools', key: 'm', when: hasS, run: () => app.setTool('measure', { measureType: 'distance' }) });
  R({ id: 'tool.angle', title: 'Measure angle', category: 'Tools', when: hasS, run: () => app.setTool('measure', { measureType: 'angle' }) });
  R({ id: 'tool.dihedral', title: 'Measure dihedral', category: 'Tools', when: hasS, run: () => app.setTool('measure', { measureType: 'dihedral' }) });
  R({ id: 'tool.clearMeasurements', title: 'Clear measurements', category: 'Tools', when: () => (app.viewer.measurements?.length ?? 0) > 0, run: () => { app.viewer.clearMeasurements(); app.emit('measure'); } });
  R({ id: 'tool.select', title: 'Select tool', category: 'Tools', key: 'v', run: () => app.setTool('select') });
  // Esc does the first of these that applies (M7 KC-05): ① cancel a tool's drag in the view (the view's own Esc
  // handler gets there first while the button is down), ② close a floating card (M3), ③ cancel a preview,
  // ④ go back to Select from another tool, ⑤ clear the selection, ⑥ leave the panel-less view used where full
  // screen is blocked
  R({ id: 'sel.clear', title: 'Clear selection', category: 'Edit', key: 'Escape', keywords: 'deselect exit tool', run: () => {
    if (app.viewer.cancelToolPress('esc')) return;
    if (app.tool !== 'select') { app.setTool('select'); return; }
    if (app.selection.length) { app.clearSelection(); return; }
    if (shell.root.dataset.fullscreen === 'focus') shell.fullscreen();
  } });
  // while visibility masks hide atoms, Select all and Invert selection work on the visible atoms only (and say so)
  R({ id: 'sel.all', title: 'Select all atoms', category: 'Edit', key: 'mod+a', when: hasS, run: () => selectAll(app) });
  R({ id: 'sel.sameElement', title: 'Select same element', category: 'Edit', keywords: 'species all atoms of element', when: hasSel, run: () => selectSameElement(app) });
  R({ id: 'sel.grow', title: 'Select bonded neighbours', category: 'Edit', keywords: 'grow expand neighbors shell', when: hasSel, run: () => selectNeighbours(app) });
  R({ id: 'sel.fragment', title: 'Select bonded fragment', category: 'Edit', keywords: 'molecule connected double-click', when: hasSel, run: () => selectFragment(app) });
  // a selection with hidden atoms asks first whether they go too (deleteSelection)
  R({ id: 'sel.delete', title: 'Delete selected atoms', category: 'Edit', key: 'Delete', when: hasSel, run: () => deleteSelection(app) });
  R({ id: 'sel.delete2', title: 'Delete selected atoms', category: 'Edit', key: 'Backspace', when: hasSel, run: () => deleteSelection(app), hidden: true });
  R({ id: 'sel.invert', title: 'Invert selection', category: 'Edit', when: hasS, run: () => app.invertSelection() });
  // Modify › Modify Element…: asks for the element (the selection card's Replace does the same)
  R({ id: 'sel.replace', title: 'Change element of selected atoms…', category: 'Edit', aliases: ['Modify Element', 'Replace element'], ms: 'Modify › Modify Element', keywords: 'replace substitute dope species', edits: true, when: hasSel, whyNot: () => 'Select atoms first.', run: () => run(replaceSelection(app)) });
  // Build menu: the Build panel at one of its tabs
  const buildTab = (tab) => () => shell.openLeft('build', { tab });
  R({ id: 'build.crystal', title: 'Build crystal…', category: 'Build', aliases: ['Build Crystal'], ms: 'Build › Crystals › Build Crystal', keywords: 'prototype lattice fcc bcc hcp perovskite rutile new crystal', run: buildTab('crystal') });
  R({ id: 'build.cluster', title: 'Build nanocluster…', category: 'Build', aliases: ['Build Nanocluster', 'Nanostructure'], ms: 'Build › Build Nanostructure', keywords: 'nanoparticle icosahedron decahedron cuboctahedron cluster', run: buildTab('cluster') });
  R({ id: 'build.molecule', title: 'Build molecule…', category: 'Build', keywords: 'molecule gas phase water benzene', run: buildTab('molecule') });
  R({ id: 'view.showAll', title: 'Show all atoms', category: 'View', aliases: ['Unhide'], keywords: 'unhide hidden atoms visibility', when: () => (app.viewer.hiddenCount ?? 0) > 0, whyNot: () => 'No atoms are hidden.', run: () => app.viewer.showAll() });
  R({ id: 'edit.undo', title: 'Undo', category: 'Edit', kbd: 'mod+z', run: () => app.undo() });
  R({ id: 'edit.redo', title: 'Redo', category: 'Edit', kbd: 'mod+shift+z', run: () => app.redo() });
  R({ id: 'traj.play', title: 'Play / pause trajectory', category: 'Trajectory', key: ' ', when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.play() });
  // , and . step frames anywhere; ← and → do too unless the view has the focus (there they rotate it)
  R({ id: 'traj.prev', title: 'Previous frame', category: 'Trajectory', key: [',', 'ArrowLeft'], repeat: true, when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.setFrame((app.structure.frame - 1 + app.structure.nFrames) % app.structure.nFrames) });
  R({ id: 'traj.next', title: 'Next frame', category: 'Trajectory', key: ['.', 'ArrowRight'], repeat: true, when: () => (app.structure?.nFrames ?? 1) > 1, run: () => app.viewer.setFrame((app.structure.frame + 1) % app.structure.nFrames) });
  R({ id: 'ui.left', title: 'Toggle side panel', category: 'Window', key: '[', run: () => shell.toggleLeft(shell.leftId) });
  R({ id: 'ui.right', title: 'Toggle appearance panel', category: 'Window', key: ']', run: () => shell.toggleInspector() });
  R({ id: 'ui.palette', title: 'Command palette', category: 'Help', kbd: 'mod+k', palette: false, run: () => shell.openPalette() });
  R({ id: 'ui.shortcuts', title: 'Keyboard shortcuts', category: 'Help', key: ['?', 'F1'], run: () => shell.shortcutsDialog() });
  R({ id: 'ui.tour', title: 'Take the tour', category: 'Help', keywords: 'help guide onboarding', run: () => shell.tour() });
  R({ id: 'ui.theme', title: 'Switch interface theme', category: 'Window', keywords: 'dark light mode', run: () => shell.cycleTheme() });
  R({ id: 'ui.api', title: 'Scripting & API', category: 'Help', run: () => shell.apiDialog() });
  R({ id: 'ui.about', title: 'About Facet', category: 'Help', keywords: 'version', run: () => shell.aboutDialog() });
  ['projects', 'library', 'build', 'structure', 'surface'].forEach((p, i) => R({ id: `panel.${p}`, title: `Show ${p[0].toUpperCase() + p.slice(1)} panel`, category: 'Window', key: `shift+${i + 1}`, shortcutGroup: 'Projects, Library, Build, Structure, Surface panel', run: () => shell.openLeft(p) }));

  // representations (keys 1–9), looks, lighting presets, colour schemes, samples and Export <format>:
  // one command per registry entry, kept in step with plugin registrations by extensions.js
  syncRegistryCommands(app);
  for (const [path, title] of [['post.ao.enabled', 'ambient occlusion'], ['post.outline.enabled', 'ink outlines'], ['post.bloom.enabled', 'bloom'], ['post.dof.enabled', 'depth of field'], ['post.fog.enabled', 'depth cueing'], ['post.dropShadow.enabled', 'drop shadows'], ['post.paper.enabled', 'paper texture'], ['lighting.shadows.enabled', 'shadows']]) {
    R({ id: `toggle.${path}`, title: `Toggle ${title}`, category: 'Effects', run: () => { app.set(path, !app.get(path)); toast(`${title[0].toUpperCase() + title.slice(1)} ${app.get(path) ? 'on' : 'off'}`); } });
  }

  // F0-A's commands of the surface tools (F0-A §5.8). A command run from a panel with {interactive: true} asks
  // before it makes more than LIMITS.confirmAtoms atoms; scripts and embedding pages are not asked.
  commands.setConfirm((o) => confirmDialog(o));
  commands.registerFallback(CANCEL_PREVIEW);
  // the M1–M6 commands open their panel section until the module registers its own command under the same id
  // (registerFallback leaves an id that is already registered alone, so module code imported earlier wins too)
  for (const c of sectionFallbacks({
    open: (panel, section) => (section ? openSection(panel, section) : (shell.openLeft(panel), false)),
    notify: (m) => toast(m),
    guards: { cell: requireCell, gap: (a) => requireVacuumGap(a, vacuumGaps) },
  })) commands.registerFallback(c);
}

boot().catch((e) => { console.error(e); toast(`Facet failed to start: ${e.message}`, { type: 'error' }); });
