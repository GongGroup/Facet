/** Application shell: top bar, rail, drawer, inspector, viewport overlays, shortcuts, palette and tour. */
import { h, ic, btn } from './dom.js';
import { LOGO } from './icons.js';
import { toast, showMenu, dialog, installTooltips, confirmDialog } from './overlays.js';
import { commands } from '../core/commands.js';
import { relativeTime, debounce } from '../core/util.js';
import { element } from '../core/elements.js';
import { elementColorHex } from '../render/colors.js';
import { formats } from '../io/index.js';
import { pickFiles } from '../storage/files.js';
import { VERSION } from '../app.js';

export const leftPanels = new Map();
export const inspectorTabs = new Map();
export function registerLeftPanel(p) { leftPanels.set(p.id, p); return () => leftPanels.delete(p.id); }
export function registerInspectorTab(t) { inspectorTabs.set(t.id, t); return () => inspectorTabs.delete(t.id); }

const isTyping = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');
const mod = navigator.platform?.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

export function formulaHTML(f) { return String(f).replace(/(\d+)/g, '<sub>$1</sub>'); }

export class Shell {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.leftId = app.prefs.leftPanel ?? 'library';
    this.leftOpen = app.prefs.leftOpen ?? !matchMedia('(max-width: 920px)').matches;
    this.tabId = app.prefs.inspectorTab ?? 'style';
    this.inspectorOpen = !matchMedia('(max-width: 920px)').matches;
    this.build();
    installTooltips(document.body);
    this.bindShortcuts();
    this.bindDrop();
    this.bindApp();
  }

  // ------------------------------------------------------------------ layout
  build() {
    const app = this.app;
    this.titleInput = h('input', { id: 'project-name', value: app.project.name, 'aria-label': 'Project name', spellcheck: false, 'data-tip': 'Click to rename the project' });
    this.titleInput.addEventListener('change', () => app.rename(this.titleInput.value.trim()));
    this.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.titleInput.blur(); });
    this.saveChip = h('span.save-chip', { 'data-state': 'idle', role: 'status' }, h('span.dot'), h('span.lbl', 'Not saved yet'));
    this.undoBtn = btn('', { icon: 'undo', cls: 'ghost icon desktop-only', tip: 'Undo', kbd: `${mod} Z`, on: () => app.undo() });
    this.redoBtn = btn('', { icon: 'redo', cls: 'ghost icon desktop-only', tip: 'Redo', kbd: `${mod} ⇧ Z`, on: () => app.redo() });
    const openBtn = btn('Open', { icon: 'open', cls: 'ghost desktop-only', tip: 'Open structure or project files (CIF, POSCAR, XYZ, PDB, JSON)', kbd: `${mod} O`, on: () => commands.run('file.open') });
    const saveBtn = btn('Save', { icon: 'save', cls: 'ghost', tip: 'Save the project', kbd: `${mod} S`, on: (e) => this.saveMenu(e.currentTarget) });
    const exportBtn = btn('Export', { icon: 'download', cls: 'primary', tip: 'Export an image, 3D model or structure file', on: (e) => this.exportMenu(e.currentTarget) });
    const paletteBtn = btn('', { icon: 'command', cls: 'ghost icon desktop-only', tip: 'Command palette — find any action', kbd: `${mod} K`, on: () => this.openPalette() });
    const helpBtn = btn('', { icon: 'help', cls: 'ghost icon', tip: 'Help, shortcuts and tour', on: (e) => this.helpMenu(e.currentTarget) });
    this.themeBtn = btn('', { icon: 'moon', cls: 'ghost icon', tip: 'Switch light / dark interface', on: () => this.cycleTheme() });
    this.userSlot = h('span');
    this.top = h('header.topbar',
      h('div.brand', { html: LOGO }, h('span.name', 'AtomScope'), h('span.ver', `v${VERSION}`)),
      h('div.proj-title', this.titleInput, this.saveChip),
      h('div.top-actions', this.undoBtn, this.redoBtn, h('span.sep.desktop-only'), openBtn, saveBtn, exportBtn, h('span.sep.desktop-only'), this.userSlot, paletteBtn, helpBtn, this.themeBtn),
    );

    this.rail = h('nav.rail', { 'aria-label': 'Panels' });
    this.drawer = h('aside.drawer', { 'aria-label': 'Side panel' });
    this.inspector = h('aside.inspector', { 'aria-label': 'Appearance' });
    this.viewport = this.root.querySelector('.viewport');
    this.stage = this.root.querySelector('.stage');
    this.root.prepend(this.top);
    this.root.append(this.rail, this.drawer, this.inspector);
    this.buildRail();
    this.buildOverlays();
    this.renderDrawer();
    this.renderInspector();
    this.applyTheme(this.app.prefs.theme ?? 'system');
  }

  buildRail() {
    this.rail.innerHTML = '';
    for (const p of leftPanels.values()) {
      const b = h('button', { type: 'button', 'aria-label': p.title, 'aria-pressed': String(this.leftOpen && this.leftId === p.id), 'data-tip': p.tip ?? p.title, 'data-kbd': p.kbd ?? null, dataset: { panel: p.id } }, ic(p.icon));
      b.addEventListener('click', () => this.toggleLeft(p.id));
      this.rail.append(b);
    }
    this.rail.append(h('div.spacer'));
    const appear = h('button.mobile-only', { type: 'button', 'aria-label': 'Appearance', 'data-tip': 'Looks, lighting, effects', dataset: { panel: '__inspector' } }, ic('style'));
    appear.addEventListener('click', () => { this.inspectorOpen = !this.inspectorOpen; if (this.inspectorOpen && matchMedia('(max-width: 920px)').matches) { this.leftOpen = false; } this.syncPanels(); });
    this.rail.append(appear);
  }

  toggleLeft(id) {
    if (this.leftOpen && this.leftId === id) this.leftOpen = false;
    else { this.leftOpen = true; this.leftId = id; if (matchMedia('(max-width: 920px)').matches) this.inspectorOpen = false; }
    this.app.setPref('leftPanel', this.leftId); this.app.setPref('leftOpen', this.leftOpen);
    this.syncPanels();
    this.renderDrawer();
  }

  openLeft(id) { this.leftOpen = false; this.toggleLeft(id); }

  syncPanels() {
    this.drawer.dataset.collapsed = String(!this.leftOpen);
    this.inspector.dataset.collapsed = String(!this.inspectorOpen);
    this.rail.querySelectorAll('button[data-panel]').forEach((b) => {
      const id = b.dataset.panel;
      b.setAttribute('aria-pressed', String(id === '__inspector' ? this.inspectorOpen : this.leftOpen && this.leftId === id));
    });
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  renderDrawer() {
    const p = leftPanels.get(this.leftId) ?? [...leftPanels.values()][0];
    this.drawer.innerHTML = '';
    const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close panel', on: () => { this.leftOpen = false; this.syncPanels(); } });
    const head = h('div.panel-head', h('h2', p.title), ...(p.headActions?.(this.app, this) ?? []), close);
    const body = h('div.panel-body');
    this.drawer.append(head, body);
    this.drawerBody = body;
    try { p.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This panel failed to load: ${e.message}`)); }
    this.syncPanels();
  }

  renderInspector() {
    const tabs = [...inspectorTabs.values()];
    const t = inspectorTabs.get(this.tabId) ?? tabs[0];
    this.tabId = t.id;
    this.inspector.innerHTML = '';
    const tabBar = h('div.tabs', { role: 'tablist', 'aria-label': 'Appearance' });
    for (const x of tabs) {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(x.id === t.id), 'data-tip': x.tip ?? null }, ic(x.icon, 'sm'), x.title);
      b.addEventListener('click', () => { this.tabId = x.id; this.app.setPref('inspectorTab', x.id); this.renderInspector(); });
      tabBar.append(b);
    }
    const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close', on: () => { this.inspectorOpen = false; this.syncPanels(); } });
    const body = h('div.panel-body', { role: 'tabpanel' });
    this.inspector.append(h('div', { style: { display: 'flex', alignItems: 'end' } }, h('div', { style: { flex: '1' } }, tabBar), close), body);
    this.inspectorBody = body;
    const scroll = this._inspectorScroll?.[t.id] ?? 0;
    try { t.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This tab failed to load: ${e.message}`)); }
    body.scrollTop = scroll;
    body.addEventListener('scroll', () => { (this._inspectorScroll ??= {})[t.id] = body.scrollTop; });
    this.syncPanels();
  }

  /** Re-render the inspector unless one of its own controls caused the change. */
  refreshInspector() { if (!this.lockInspector) this.renderInspector(); }
  /** Wrap a control callback so it does not re-render the panel it lives in. */
  quiet(fn) { return (...a) => { this.lockInspector = true; try { fn(...a); } finally { this.lockInspector = false; } }; }

  // ------------------------------------------------------------------ viewport overlays
  buildOverlays() {
    const app = this.app, v = app.viewer;
    this.infoCard = h('div.float.info-card', { 'aria-live': 'polite' });
    this.hover = h('div.float.hovercard', { hidden: true });
    this.hintText = h('span.hint-text');
    this.statText = h('span.stat');
    this.statusbar = h('div.float.statusbar', this.hintText, this.statText);
    // toolbar
    this.selectBtn = btn('', { icon: 'pointer', cls: 'icon', tip: 'Select and inspect atoms', kbd: 'V', on: () => app.setTool('select') });
    this.measureBtn = btn('', { icon: 'ruler', cls: 'icon', tip: 'Measure distance, angle or dihedral', kbd: 'M', on: (e) => this.measureMenu(e.currentTarget) });
    const viewBtn = btn('', { icon: 'cube', cls: 'icon', tip: 'View along an axis', on: (e) => this.viewMenu(e.currentTarget) });
    this.projBtn = btn('', { icon: 'projection', cls: 'icon', tip: 'Perspective / orthographic', kbd: 'P', on: () => commands.run('view.projection') });
    this.spinBtn = btn('', { icon: 'turntable', cls: 'icon', tip: 'Turntable (auto-rotate)', kbd: 'T', on: () => commands.run('view.turntable') });
    this.toolbar = h('div.float.toolbar.tb-top', { role: 'toolbar', 'aria-label': 'View tools' },
      this.selectBtn, this.measureBtn, h('span.sep'),
      btn('', { icon: 'reset', cls: 'icon', tip: 'Reset view', kbd: 'R', on: () => app.viewer.resetView() }),
      btn('', { icon: 'fit', cls: 'icon', tip: 'Fit to screen', kbd: 'F', on: () => app.viewer.fitView() }),
      viewBtn, this.projBtn, this.spinBtn, h('span.sep'),
      btn('', { icon: 'camera', cls: 'icon', tip: 'Save a 2× PNG image', kbd: `${mod} E`, on: () => app.exportImage({ scale: 2 }).catch((e) => toast(e.message, { type: 'error' })) }),
      btn('', { icon: 'maximize', cls: 'icon desktop-only', tip: 'Full screen', on: () => this.fullscreen() }),
    );
    // trajectory
    this.playBtn = btn('', { icon: 'play', cls: 'icon ghost', tip: 'Play / pause', kbd: 'Space', on: () => app.viewer.play() });
    this.frameSlider = h('input', { type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Frame' });
    this.frameSlider.addEventListener('input', () => app.viewer.setFrame(+this.frameSlider.value));
    this.frameLabel = h('span.num.mono', '1 / 1');
    const fpsSel = h('select.field', { 'aria-label': 'Playback speed', style: { width: '86px', height: '28px' } }, ...[6, 12, 24, 48].map((f) => h('option', { value: f, selected: f === 12 }, `${f} fps`)));
    fpsSel.addEventListener('change', () => { app.viewer.fps = +fpsSel.value; });
    this.trajbar = h('div.float.trajbar', { hidden: true }, this.playBtn, this.frameSlider, this.frameLabel, fpsSel);
    // empty
    this.empty = h('div.float.empty', { hidden: true }, h('div.box',
      h('div', { html: LOGO, style: { transform: 'scale(1.6)', marginBottom: '6px' } }),
      h('h2', 'Start with a structure'),
      h('p', 'Open a CIF, POSCAR, XYZ or PDB file, pick a sample, or build a crystal or nanocluster. You can also drop files anywhere on this window.'),
      h('div.acts',
        btn('Open file', { icon: 'open', cls: 'primary', on: () => commands.run('file.open') }),
        btn('Browse samples', { icon: 'library', on: () => this.openLeft('library') }),
        btn('Build', { icon: 'build', on: () => this.openLeft('build') })),
    ));
    this.drop = h('div.float.dropzone', { hidden: true }, 'Drop structure or project files to open them');
    this.measureHud = h('div.float.measure-hud', { hidden: true });
    this.stage.append(this.infoCard, this.toolbar, this.statusbar, this.hover, this.trajbar, this.empty, this.drop, this.measureHud);

    v.on('hover', (e) => this.onHover(e));
    v.on('frame', () => this.updateTraj());
    v.on('play', (p) => { this.playBtn.replaceChildren(ic(p ? 'pause' : 'play')); });
    v.on('model', () => this.updateInfo());
    let frames = 0, t0 = performance.now();
    v.on('render', () => { frames++; const t = performance.now(); if (t - t0 > 1000) { this.fps = Math.round((frames * 1000) / (t - t0)); frames = 0; t0 = t; this.updateStats(); } });
  }

  onHover({ index, x, y }) {
    const info = this.app.viewer.atomInfo(index);
    if (!info) { this.hover.hidden = true; this.app.viewer.renderer.domElement.style.cursor = ''; return; }
    this.app.viewer.renderer.domElement.style.cursor = 'pointer';
    const color = elementColorHex(info.symbol, this.app.scene.style);
    const f = (a) => a.map((v) => v.toFixed(3)).join('  ');
    this.hover.replaceChildren(
      h('div.h', h('span.dot', { style: { background: color } }), `${info.symbol}`, h('small', `#${info.index} · ${info.name}`)),
      h('div.m', `xyz  ${f(info.position)} Å`, info.frac ? h('br') : null, info.frac ? `frac ${f(info.frac)}` : null, h('br'), `bonds ${info.cn}${info.image.some(Boolean) ? `  ·  image ${info.image.join(',')}` : ''}`),
    );
    this.hover.hidden = false;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const hx = Math.min(x, W - 200), hy = Math.min(y, H - 110);
    this.hover.style.left = `${hx}px`; this.hover.style.top = `${hy}px`;
  }

  updateInfo() {
    const s = this.app.structure;
    this.empty.hidden = !!s;
    this.infoCard.hidden = !s;
    this.toolbar.hidden = !s;
    if (!s) { this.updateStats(); this.updateTraj(); return; }
    const cp = s.cellParams();
    this.infoCard.replaceChildren(...[
      h('div.f', { html: formulaHTML(s.formula()) }),
      h('div.s', s.name !== s.formula() ? s.name : (s.periodic ? 'periodic' : 'cluster / molecule')),
      cp ? h('div.s', `a ${cp.a.toFixed(3)}  b ${cp.b.toFixed(3)}  c ${cp.c.toFixed(3)} Å`) : null,
      cp ? h('div.s', `α ${cp.alpha.toFixed(1)}°  β ${cp.beta.toFixed(1)}°  γ ${cp.gamma.toFixed(1)}°`) : null,
    ].filter(Boolean));
    this.updateStats(); this.updateTraj();
  }

  updateStats() {
    const m = this.app.viewer.model;
    this.statText.textContent = m ? `${m.n.toLocaleString()} atoms · ${m.bonds.count.toLocaleString()} bonds${this.fps ? ` · ${this.fps} fps` : ''}` : '';
  }

  updateTraj() {
    const s = this.app.structure;
    const n = s?.nFrames ?? 1;
    this.trajbar.hidden = n <= 1;
    if (n > 1) { this.frameSlider.max = n - 1; this.frameSlider.value = s.frame; this.frameLabel.textContent = `${s.frame + 1} / ${n}`; }
  }

  updateHint() {
    const app = this.app;
    let html;
    if (app.tool === 'measure') {
      const need = { distance: 2, angle: 3, dihedral: 4 }[app.measureType];
      html = `<b>${app.measureType[0].toUpperCase() + app.measureType.slice(1)}</b> — click ${need} atoms (${app.measurePicks.length}/${need}) · <b>Esc</b> to finish`;
      this.measureHud.hidden = false;
      this.measureHud.replaceChildren(h('span', { html: html.replace(/<\/?b>/g, '') }), h('button', { type: 'button', on: { click: () => app.setTool('select') } }, 'Done'));
    } else {
      this.measureHud.hidden = true;
      const n = app.selection.length;
      html = n ? `<b>${n}</b> selected · <b>Del</b> delete · <b>Shift-click</b> add/remove · <b>Esc</b> clear`
        : '<b>Drag</b> rotate · <b>Right-drag</b> pan · <b>Scroll</b> zoom · <b>Click</b> select · <b>Double-click</b> centre';
    }
    this.hintText.innerHTML = html;
    this.selectBtn.setAttribute('aria-pressed', String(app.tool === 'select'));
    this.measureBtn.setAttribute('aria-pressed', String(app.tool === 'measure'));
    this.projBtn.setAttribute('aria-pressed', String(app.scene.display.projection === 'orthographic'));
    this.spinBtn.setAttribute('aria-pressed', String(!!app.scene.display.turntable));
  }

  updateSaveChip() {
    const app = this.app;
    const st = app.saveState;
    const prov = app.storage.get(app.project.location?.provider ?? app.defaultProvider);
    const where = prov?.label ?? 'this browser';
    const label = {
      idle: app.structure ? 'Not saved yet' : 'Empty project',
      dirty: app.prefs.autosave !== false ? `Unsaved changes · autosave to ${where}` : 'Unsaved changes',
      saving: `Saving to ${where}…`,
      saved: `Saved · ${where}${app.project.updated ? ` · ${relativeTime(app.project.updated)}` : ''}`,
      error: `Save failed — ${app.saveDetail || 'try again'}`,
    }[st];
    this.saveChip.dataset.state = st;
    this.saveChip.querySelector('.lbl').textContent = label;
    this.saveChip.title = label;
  }

  // ------------------------------------------------------------------ menus
  saveMenu(anchor) {
    const app = this.app;
    const items = [{ header: 'Save project to' }];
    for (const p of app.storage.list()) {
      const here = app.project.location?.provider === p.id;
      items.push({ label: p.label, icon: p.icon, hint: here ? 'current' : p.id === 'folder' && !p.connected ? 'choose folder' : '', run: () => this.saveToProvider(p.id) });
    }
    items.push({ separator: true }, { label: 'Download project file (.atomscope.json)', icon: 'download', run: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) });
    items.push({ label: app.prefs.autosave !== false ? 'Turn autosave off' : 'Turn autosave on', icon: 'check', run: () => { app.setPref('autosave', app.prefs.autosave === false); this.updateSaveChip(); toast(app.prefs.autosave !== false ? 'Autosave is on' : 'Autosave is off'); } });
    showMenu(anchor, items);
  }

  async saveToProvider(id) {
    const app = this.app;
    const p = app.storage.get(id);
    if (id === 'folder' && !p.connected) { try { await p.connect(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, { type: 'error' }); return; } }
    if (id === 'server' && p.needsAuth) { this.openLeft('projects'); toast('Sign in to the server to save there.'); return; }
    await app.saveTo(id);
  }

  exportMenu(anchor) {
    const app = this.app;
    const run = (fn) => () => fn().catch((e) => toast(e.message, { type: 'error' }));
    const items = [
      { header: 'Image' },
      { label: 'PNG — screen size', icon: 'image', run: run(() => app.exportImage({ scale: 1 })) },
      { label: 'PNG — 2× (print)', icon: 'image', kbd: `${mod} E`, run: run(() => app.exportImage({ scale: 2 })) },
      { label: 'PNG — 4× (poster)', icon: 'image', run: run(() => app.exportImage({ scale: 4 })) },
      { label: 'PNG — transparent background', icon: 'image', run: run(() => app.exportImage({ scale: 2, transparent: true })) },
      { header: '3D model' },
      { label: 'glTF binary (.glb) for Blender, PowerPoint, AR', icon: 'cube', run: run(() => app.exportGLB()) },
      { header: 'Structure file' },
      ...formats.writers().map((f) => ({ label: f.name, icon: 'file', hint: `.${f.extensions[0]}`, disabled: !app.structure || ((f.id === 'poscar' || f.id === 'cif') && !app.structure?.cell), run: run(() => app.exportStructureFile(f.id)) })),
    ];
    showMenu(anchor, items, { align: 'end' });
  }

  measureMenu(anchor) {
    const app = this.app;
    showMenu(anchor, [
      { header: 'Measure' },
      { label: 'Distance (2 atoms)', icon: 'ruler', run: () => app.setTool('measure', 'distance') },
      { label: 'Angle (3 atoms)', icon: 'ruler', run: () => app.setTool('measure', 'angle') },
      { label: 'Dihedral (4 atoms)', icon: 'ruler', run: () => app.setTool('measure', 'dihedral') },
      { separator: true },
      { label: 'Clear all measurements', icon: 'trash', disabled: !app.viewer.measurements.length, run: () => { app.viewer.clearMeasurements(); this.app.emit('measure'); } },
    ]);
  }

  viewMenu(anchor) {
    const app = this.app;
    const per = !!app.structure?.cell;
    const v = (axis) => () => app.viewer.setView(axis);
    showMenu(anchor, [
      { header: 'Look along' },
      ...(per ? [{ label: 'a axis', kbd: 'A', run: v('a') }, { label: 'b axis', kbd: 'B', run: v('b') }, { label: 'c axis', kbd: 'C', run: v('c') }, { separator: true }] : []),
      { label: 'x axis', kbd: 'X', run: v('x') }, { label: 'y axis', kbd: 'Y', run: v('y') }, { label: 'z axis', kbd: 'Z', run: v('z') },
      { separator: true },
      { label: 'Default view', kbd: 'R', run: () => app.viewer.resetView() },
    ]);
  }

  helpMenu(anchor) {
    showMenu(anchor, [
      { label: 'Take the tour', icon: 'sparkles', run: () => this.tour() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: () => this.shortcutsDialog() },
      { label: 'Command palette', icon: 'command', kbd: `${mod} K`, run: () => this.openPalette() },
      { label: 'Scripting & API', icon: 'plug', run: () => this.apiDialog() },
      { label: 'About AtomScope', icon: 'info', run: () => this.aboutDialog() },
    ], { align: 'end' });
  }

  fullscreen() {
    const el = this.stage;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => toast('Full screen is not available in this view.'));
  }

  // ------------------------------------------------------------------ theme
  applyTheme(t) {
    const r = document.documentElement;
    if (this._hostTheme === undefined) this._hostTheme = r.dataset.theme ?? null;
    if (t === 'system') { if (this._hostTheme) r.dataset.theme = this._hostTheme; else delete r.dataset.theme; } else r.dataset.theme = t;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    this.themeBtn.replaceChildren(ic(dark ? 'sun' : 'moon'));
    this.themeBtn.dataset.tip = `Interface: ${t === 'system' ? 'follows system' : t} — click to change`;
    this.app.viewer._updateHalos?.();
  }
  cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.app.prefs.theme ?? 'system') + 1) % 3];
    this.app.setPref('theme', next);
    this.applyTheme(next);
    toast(`Interface theme: ${next === 'system' ? 'follow system' : next}`);
  }

  // ------------------------------------------------------------------ input
  bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k.toLowerCase() === 'k') { e.preventDefault(); this.openPalette(); return; }
      if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); commands.run('project.save'); return; }
      if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); commands.run('file.open'); return; }
      if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); commands.run('export.png2'); return; }
      if (isTyping(e) || document.querySelector('.scrim')) return;
      if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.app.redo() : this.app.undo(); return; }
      if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); this.app.redo(); return; }
      if (ctrl || e.altKey) return;
      const c = [...commands.list()].find((x) => x.key && (x.key === k || x.key === k.toLowerCase() && !e.shiftKey));
      if (c && (!c.when || c.when(this.app))) { e.preventDefault(); c.run(); }
    });
  }

  bindDrop() {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; this.drop.hidden = false; e.preventDefault(); });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) this.drop.hidden = true; });
    addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; this.drop.hidden = true;
      this.app.importFiles([...e.dataTransfer.files]);
    });
    addEventListener('paste', (e) => {
      if (isTyping(e)) return;
      const text = e.clipboardData?.getData('text');
      if (text && text.length > 20 && /\n/.test(text)) {
        try { const s = this.app.importText(text); s.then?.((st) => toast(`Pasted ${st.length} atoms`)); }
        catch (err) { toast(`Pasted text is not a structure: ${err.message}`, { type: 'error' }); }
      }
    });
  }

  bindApp() {
    const app = this.app;
    const refreshDrawer = debounce(() => this.renderDrawer(), 30);
    app.on('project', () => { this.titleInput.value = app.project.name; this.updateSaveChip(); refreshDrawer(); });
    app.on('structure', () => { this.updateInfo(); this.updateHint(); if (['structure', 'build'].includes(this.leftId)) refreshDrawer(); this.refreshInspector(); });
    app.on('selection', () => { this.updateHint(); if (this.leftId === 'structure') refreshDrawer(); });
    app.on('measure', () => { if (this.leftId === 'structure') refreshDrawer(); });
    app.on('tool', () => this.updateHint());
    app.on('scene', () => { this.refreshInspector(); this.updateHint(); });
    app.on('saveState', () => this.updateSaveChip());
    app.on('providers', () => { if (this.leftId === 'projects') refreshDrawer(); this.renderUser(); });
    app.on('history', () => { this.undoBtn.disabled = !app.undoStack.length; this.redoBtn.disabled = !app.redoStack.length; });
    app.on('needAuth', () => this.openLeft('projects'));
    setInterval(() => this.updateSaveChip(), 30000);
    this.updateInfo(); this.updateHint(); this.updateSaveChip(); this.renderUser();
    this.undoBtn.disabled = this.redoBtn.disabled = true;
  }

  renderUser() {
    const s = this.app.storage.get('server');
    this.userSlot.replaceChildren();
    if (s?.info?.mode === 'cloud' && s.user) {
      this.userSlot.append(btn(s.user.username, { icon: 'user', cls: 'ghost small desktop-only', tip: 'Signed in to the AtomScope server', on: (e) => showMenu(e.currentTarget, [{ label: 'Sign out', icon: 'logout', run: async () => { await s.logout(); this.app.emit('providers'); toast('Signed out'); } }], { align: 'end' }) }));
    }
  }

  // ------------------------------------------------------------------ palette
  openPalette() {
    if (document.querySelector('.palette')) return;
    const input = h('input', { placeholder: 'Type a command, sample, look or view…', 'aria-label': 'Search commands', autofocus: true });
    const results = h('div.results', { role: 'listbox' });
    const box = h('div.dialog.palette', { role: 'dialog', 'aria-label': 'Command palette' }, input, results);
    const scrim = h('div.scrim', box);
    let sel = 0, list = [];
    const close = () => { scrim.remove(); };
    const score = (c, q) => {
      if (!q) return 1;
      const t = `${c.category} ${c.title} ${c.keywords ?? ''}`.toLowerCase();
      let s = 0, i = 0;
      for (const ch of q.toLowerCase()) { const j = t.indexOf(ch, i); if (j < 0) return 0; s += j === i ? 2 : 1; i = j + 1; }
      return s + (t.includes(q.toLowerCase()) ? 10 : 0);
    };
    const render = () => {
      const q = input.value.trim();
      list = commands.list().filter((c) => !c.when || c.when(this.app)).map((c) => [score(c, q), c]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, c]) => c);
      sel = Math.min(sel, Math.max(0, list.length - 1));
      results.replaceChildren(...list.map((c, i) => {
        const r = h('div.res', { role: 'option', 'aria-selected': String(i === sel) }, h('span.cat', c.category), h('span', c.title), c.key ? h('span.kbd.k', c.key.toUpperCase()) : null);
        r.addEventListener('click', () => { close(); c.run(); });
        r.addEventListener('pointermove', () => { if (sel !== i) { sel = i; render(); } });
        return r;
      }));
      if (!list.length) results.append(h('p.hint', { style: { padding: '12px' } }, 'No matching command.'));
      results.children[sel]?.scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      if (e.key === 'Enter' && list[sel]) { close(); list[sel].run(); }
      if (e.key === 'Escape') close();
    });
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
    document.body.append(scrim);
    render();
    input.focus();
  }

  // ------------------------------------------------------------------ dialogs
  shortcutsDialog() {
    const rows = [
      [`${mod} K`, 'Command palette'], [`${mod} O`, 'Open files'], [`${mod} S`, 'Save project'], [`${mod} E`, 'Export 2× PNG'],
      [`${mod} Z`, 'Undo'], [`${mod} ⇧ Z`, 'Redo'], ['R', 'Reset view'], ['F', 'Fit to screen'], ['P', 'Perspective / orthographic'], ['T', 'Turntable'],
      ['A B C', 'Look along a, b, c'], ['X Y Z', 'Look along x, y, z'], ['1 – 6', 'Representations'], ['U', 'Unit cell on/off'], ['L', 'Cycle labels'],
      ['M', 'Measure tool'], ['V', 'Select tool'], ['Del', 'Delete selected atoms'], ['Esc', 'Clear selection / exit tool'], ['Space', 'Play / pause trajectory'],
      ['← →', 'Previous / next frame'], ['[', 'Toggle side panel'], [']', 'Toggle appearance panel'], ['?', 'This list'],
    ];
    dialog({ title: 'Keyboard shortcuts', wide: true, body: h('div.shortcut-grid', rows.map(([k, d]) => h('div', h('span', d), h('span.kbd', k)))) });
  }

  aboutDialog() {
    const app = this.app;
    const provs = app.storage.list().map((p) => p.label).join(', ');
    dialog({
      title: 'About AtomScope',
      body: h('div', { style: { display: 'grid', gap: '10px' } },
        h('p.hint', { style: { fontSize: '13.5px' } }, 'AtomScope renders atoms, clusters and crystals with physically based materials, studio lighting and post effects. Everything is modular: formats, builders, colour schemes, materials, lighting rigs, looks, storage backends, panels and commands are registries that plugins extend.'),
        h('dl.kv', h('dt', 'Version'), h('dd', VERSION), h('dt', 'Runs as'), h('dd', app.serverStore.info ? `${app.serverStore.info.mode} server` : 'standalone web app'), h('dt', 'Project storage'), h('dd', provs), h('dt', 'Renderer'), h('dd', 'three.js r170 (WebGL 2)')),
      ),
    });
  }

  apiDialog() {
    const code = `// In the browser console (or a plugin):
const s = atomscope.build.crystal('perovskite', { elements: ['Ba','Ti','O'], a: 4.01, repeat: [3,3,3] });
atomscope.load(s);                      // show it
atomscope.applyLook('qutemol');          // restyle
atomscope.set('post.outline.enabled', true);
atomscope.view('c');                     // look along c
const png = await atomscope.screenshot({ scale: 3 });

// Extend: register a colour scheme
atomscope.registry.colorSchemes.register({
  id: 'oxygen-red', name: 'Oxygen highlight',
  colorFor: (sym) => sym === 'O' ? '#ff2244' : '#b0b6bd',
});

// Python (server): pip install atomscope && atomscope serve
//   import atomscope as asc
//   asc.view(asc.build.crystal('fcc', ['Au'], a=4.08).repeat(4,4,4))`;
    dialog({ title: 'Scripting & API', wide: true, body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.hint', 'The whole app is scriptable through window.atomscope. When AtomScope runs on its Python server, the same features are available as a REST API (see /docs on the server) and a Python package.'),
      h('pre', { style: { margin: 0, padding: '12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '9px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.55' } }, code)) });
  }

  // ------------------------------------------------------------------ onboarding
  welcome() {
    if (this.app.prefs.welcomed) return;
    const card = h('div.float.welcome', { role: 'dialog', 'aria-label': 'Getting started' },
      h('h3', 'Welcome to AtomScope'),
      h('ol', h('li', 'Pick a structure from the Library, build one, or drop your own file.'), h('li', 'Restyle it with one click in Looks, then fine-tune light and effects.'), h('li', 'Export a high-resolution image or save the project.')),
      h('div.acts', btn('Take the 1-minute tour', { cls: 'primary small', on: () => { card.remove(); this.app.setPref('welcomed', true); this.tour(); } }), btn('Dismiss', { cls: 'ghost small', on: () => { card.remove(); this.app.setPref('welcomed', true); } })));
    this.stage.append(card);
  }

  tour() {
    const steps = [
      { sel: '.rail', title: 'Panels', text: 'Projects, the sample Library, the Builder for crystals and nanoclusters, and Structure details live here.', before: () => this.openLeft('library') },
      { sel: '.viewport', title: 'The viewport', text: 'Drag to rotate, right-drag to pan, scroll to zoom. Hover an atom for details, click to select, double-click to centre on it.' },
      { sel: '.inspector .panel-body', title: 'Looks and style', text: 'One click applies a complete look. Below it, choose the representation, colours, material and sizes.', before: () => { this.tabId = 'style'; this.inspectorOpen = true; this.renderInspector(); } },
      { sel: '.inspector .tabs', title: 'Light, effects, scene', text: 'Shape the light rig, add ambient occlusion, ink outlines, bloom or depth of field, and set the unit cell, supercell, bonds and background.' },
      { sel: '.toolbar.tb-top', title: 'View tools', text: 'Measure distances and angles, align the view with a crystal axis, switch to orthographic, or start a turntable.' },
      { sel: '.proj-title', title: 'Your work is saved', text: 'Changes autosave. Use Save to choose where projects live: this browser, a server folder, the cloud, or a folder on your computer.' },
      { sel: '.top-actions .btn.primary', title: 'Export', text: `Save PNG images up to 4×, a glTF model for Blender or slides, or the structure as CIF, POSCAR, XYZ or PDB. Press ${mod} K anytime to search every command.` },
    ];
    let i = 0;
    const ring = h('div.coach-ring');
    const card = h('div.coach', { role: 'dialog', 'aria-live': 'polite' });
    document.body.append(ring, card);
    const end = () => { ring.remove(); card.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') next(); };
    document.addEventListener('keydown', onKey);
    const show = () => {
      const s = steps[i];
      s.before?.();
      requestAnimationFrame(() => {
        const el = document.querySelector(s.sel);
        const r = el?.getBoundingClientRect() ?? { left: innerWidth / 2 - 100, top: innerHeight / 2 - 50, width: 200, height: 100, right: innerWidth / 2 + 100, bottom: innerHeight / 2 + 50 };
        Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
        card.replaceChildren(h('h3', s.title), h('p', s.text), h('div.foot', h('span.n', `${i + 1} / ${steps.length}`), btn('Skip', { cls: 'ghost small', on: end }), btn(i === steps.length - 1 ? 'Finish' : 'Next', { cls: 'primary small', on: next })));
        const cw = card.offsetWidth, ch = card.offsetHeight;
        let x = r.right + 14, y = r.top;
        if (x + cw > innerWidth - 12) x = r.left - cw - 14;
        if (x < 12) { x = Math.min(Math.max(12, r.left), innerWidth - cw - 12); y = r.bottom + 14; }
        if (y + ch > innerHeight - 12) y = Math.max(12, r.top - ch - 14);
        if (r.height > innerHeight * 0.6 && r.width > innerWidth * 0.4) { x = r.left + r.width / 2 - cw / 2; y = r.top + r.height / 2 - ch / 2; }
        card.style.left = `${Math.max(12, x)}px`; card.style.top = `${Math.max(12, y)}px`;
        card.querySelector('.btn.primary')?.focus();
      });
    };
    const next = () => { i++; if (i >= steps.length) { end(); toast('You are all set. Press ? for shortcuts.'); } else show(); };
    show();
  }
}

export { confirmDialog };
