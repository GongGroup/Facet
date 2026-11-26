/**
 * The desktop workbench, laid out as Materials Studio is:
 *
 *   ┌ menu bar ─────────────────────────────────────────────────────────────────────────────┐
 *   ├ toolbars (Standard | 3D Viewer | Display | Build | Modify | Animation | Image) ──────────┤
 *   │ Project explorer   ║ workspace: document windows (MDI), maximized with tabs, or tiled,   │
 *   │ (project tree)     ║ cascaded and minimized like desktop windows; tool windows (Display  │
 *   │────────────────────║ Style, Lighting, Display Options, the Build / Library / Structure / │
 *   │ Properties explorer║ Surface panels) float over it or dock on its right                  │
 *   │ (filter + grid)    ║                                                                     │
 *   ├ status bar: hints | selection | atoms and bonds | lattice | frame ──────────────────────┤
 *
 * One WebGL view serves every document window: the active window holds the view (the `.stage` of index.html), the
 * others show the picture they had when they were left. Each window keeps its camera and selection. Closing every
 * window leaves the documents in the project (the Project explorer opens them again).
 *
 * The shell (ui/shell.js) builds the parts that existed before (menu bar, toolbar groups, panels, overlays) and hands
 * them to the workbench, which places them; on phones (≤ 920 px) the shell's compact layout is used instead.
 */
import { h, ic, btn } from './dom.js';
import { toast, showMenu, closeMenu, dialog } from './overlays.js';
import { commands } from '../core/commands.js';
import { keyLabel } from './keys.js';
import { debounce } from '../core/util.js';
import { ProjectExplorer } from './explorer.js';
import { PropertiesExplorer } from './properties.js';

const isMobile = () => matchMedia('(max-width: 920px)').matches;
const clampN = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));

/** What kind of document a structure is, for its icon and description. */
export function docKind(s) {
  if (!s) return 'molecule';
  if ((s.nFrames ?? 1) > 1) return 'trajectory';
  if (!s.cell || !s.pbc?.some?.(Boolean)) return 'molecule';
  return s.info?.surface ? 'surface' : 'crystal';
}
export const KIND_ICON = Object.freeze({ crystal: 'crystal', surface: 'surface', molecule: 'molecule', trajectory: 'film' });
export const KIND_LABEL = Object.freeze({ crystal: '3D periodic structure', surface: 'Surface slab', molecule: 'Molecule or cluster', trajectory: 'Trajectory' });

/** The toolbars of View › Toolbars, in their order on the strip. */
export const TOOLBARS = Object.freeze([
  ['standard', 'Standard'], ['view', '3D Viewer'], ['display', 'Display'], ['build', 'Build'], ['modify', 'Modify'], ['measure', 'Measure'],
  ['animation', 'Animation'], ['image', 'Image'],
]);

/** Titles of the tool window that holds the appearance tabs, by tab. */
const TAB_TITLES = { style: 'Display Style', light: 'Lighting', effects: 'Effects', scene: 'Display Options' };

// ------------------------------------------------------------------------------------------------- document windows
class MDI {
  constructor(bench) {
    this.bench = bench; this.app = bench.app; this.shell = bench.shell;
    this.wins = new Map();   // entry id → window
    this.order = [];         // ids in the order the windows were opened (tabs, Window menu)
    this.z = [];             // ids bottom → top
    this.max = this.app.prefs.mdiMax !== false;
    this.project = null;
    this.tabs = h('div.doctabs', { role: 'tablist', 'aria-label': 'Document windows' });
    this.restoreBtn = btn('', { icon: 'winRestore', cls: 'ghost icon tiny', tip: 'Restore the windows (show them side by side)', on: () => this.setMax(false) });
    this.tabsWrap = h('div.doctabs-bar', this.tabs, this.restoreBtn);
    this.layer = h('div.mdi');
    this.park = h('div.mdi-park', { 'aria-hidden': 'true' });   // the view while no window is active
    bench.work.append(this.tabsWrap, this.layer, this.park);
    this.park.append(this.shell.stage);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.layout()).observe(this.layer);
    // the picture of the active window is kept fresh while other windows are open (once the view rests), so a
    // window shows its last view however another one took the view (a new document, Undo, the API …)
    let timer = 0;
    this.app.viewer.on('render', () => {
      if (this._snapping || this.wins.size < 2) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const a = this.active;
        if (!a || !this.wins.has(a) || this.app.viewer.playing) return;
        this._snapping = true;
        try { this._snap(a); } finally { this._snapping = false; }
      }, 1200);
    });
  }

  /** A picture of the view at the size of window `id`'s body. */
  _snap(id) {
    const w = this.wins.get(id), v = this.app.viewer;
    const r = w?.body.getBoundingClientRect();
    if (!r || r.width <= 24 || r.height <= 24 || !this.app.structure) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    try { w.snap = v.thumbnail(Math.round(r.width * dpr), Math.round(r.height * dpr), 0.86); } catch { /* keep the last one */ }
  }

  entry(id) { return this.app.project.structures.find((e) => e.id === id) ?? null; }
  get active() { return this.app.project.activeStructure; }
  /** The open windows as [{id, name, active}] in the order they were opened. */
  list() { return this.order.filter((id) => this.wins.has(id)).map((id) => ({ id, name: this.entry(id)?.name ?? 'Document', active: id === this.active, state: this.wins.get(id).state })); }
  isOpen(id) { return this.wins.has(id); }

  _make(id) {
    const n = this.wins.size;
    const head = h('div.dw-head');
    const title = h('span.dw-title');
    const icon = h('span.dw-icon');
    const minB = h('button.dw-b', { type: 'button', 'aria-label': 'Minimize', 'data-tip': 'Minimize' }, ic('winMin', 'sm'));
    const maxB = h('button.dw-b', { type: 'button', 'aria-label': 'Maximize', 'data-tip': 'Maximize' }, ic('winMax', 'sm'));
    const closeB = h('button.dw-b.close', { type: 'button', 'aria-label': 'Close window', 'data-tip': 'Close window (the document stays in the project)' }, ic('x', 'sm'));
    head.append(icon, title, h('span.dw-btns', minB, maxB, closeB));
    const body = h('div.dw-body');
    const grip = h('div.dw-grip', { 'aria-hidden': 'true' });
    const el = h('section.docwin', { 'aria-label': 'Document window', dataset: { id } }, head, body, grip);
    const w = { id, el, head, body, title, icon, maxB, state: 'normal', rect: null, snap: null, camera: null, selection: null };
    const L = this._size();
    const k = n % 8;
    w.rect = { x: 12 + 26 * k, y: 12 + 26 * k, w: Math.max(320, Math.round(L.w * 0.66)), h: Math.max(220, Math.round(L.h * 0.7)) };
    minB.addEventListener('click', (e) => { e.stopPropagation(); this.minimize(id); });
    maxB.addEventListener('click', (e) => { e.stopPropagation(); this.setMax(!this.max || w.state === 'min'); if (w.state === 'min') w.state = 'normal'; this.activate(id); });
    closeB.addEventListener('click', (e) => { e.stopPropagation(); this.close(id); });
    el.addEventListener('pointerdown', () => { if (id !== this.active) this.activate(id); else this._raise(id); }, true);
    head.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; if (w.state === 'min') { w.state = 'normal'; this.activate(id); } else this.setMax(!this.max); });
    head.addEventListener('pointerdown', (e) => this._drag(e, w, 'move'));
    grip.addEventListener('pointerdown', (e) => this._drag(e, w, 'size'));
    this.wins.set(id, w);
    this.order.push(id);
    this.z.push(id);
    this.layer.append(el);
    return w;
  }

  _size() { const r = this.layer.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500 }; }

  /** Move (`move`) or resize (`size`) a window with the pointer. */
  _drag(e, w, kind) {
    if (e.button !== 0 || (this.max && w.state !== 'min') || e.target.closest('button')) return;
    if (w.state === 'min' && kind === 'size') return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, r0 = { ...w.rect };
    const L = this._size();
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (kind === 'move') {
        if (w.state === 'min') return;
        w.rect.x = clampN(r0.x + dx, -r0.w + 80, L.w - 60);
        w.rect.y = clampN(r0.y + dy, 0, L.h - 26);
      } else {
        w.rect.w = clampN(r0.w + dx, 200, L.w - r0.x);
        w.rect.h = clampN(r0.h + dy, 140, L.h - r0.y);
      }
      this._place(w);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); w.el.classList.remove('dragging'); };
    w.el.classList.add('dragging');
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  _raise(id) {
    this.z = [...this.z.filter((x) => x !== id), id];
    this.layout();
  }

  /** Keep the picture of the active window, for when it is no longer the one with the view. */
  _leave(id) {
    const w = this.wins.get(id), v = this.app.viewer;
    if (!w || !this.app.structure) return;
    try { w.camera = v.getCameraState(); } catch { w.camera = null; }
    w.selection = this.app.selection;
    this._snapping = true;
    try { this._snap(id); } finally { this._snapping = false; }
  }

  /** Bring the window of document `id` to the front with the view in it (opening it when it is not open). */
  activate(id) {
    if (!this.entry(id)) return;
    const w = this.wins.get(id) ?? this._make(id);
    if (w.state === 'min') w.state = 'normal';
    if (id !== this.active) {
      const prev = this.active;
      if (prev && this.wins.has(prev)) this._leave(prev);
      try { this.app.showStructure(id, { camera: w.camera, selection: w.selection }); }
      catch (e) { toast(e.message, { type: 'error' }); }
    }
    this._raise(id);
    this.sync();
  }

  /** Close the window of document `id`; the next window takes the view (none: the workspace is empty). */
  close(id) {
    const w = this.wins.get(id);
    if (!w) return;
    const wasActive = id === this.active;
    w.el.remove();
    this.wins.delete(id);
    this.z = this.z.filter((x) => x !== id);
    this.order = this.order.filter((x) => x !== id);
    if (wasActive) {
      const next = [...this.z].reverse().find((x) => this.wins.get(x)?.state !== 'min') ?? this.z.at(-1);
      if (next) { this.activate(next); return; }
      try { this.app.showStructure(null); } catch (e) { console.error(e); }
    }
    this.sync();
  }

  closeAll() {
    const ids = [...this.wins.keys()];
    for (const id of ids) { this.wins.get(id).el.remove(); this.wins.delete(id); }
    this.z = []; this.order = [];
    if (this.active) { try { this.app.showStructure(null); } catch (e) { console.error(e); } }
    this.sync();
  }

  closeOthers(id) { for (const x of [...this.wins.keys()]) if (x !== id) { this.wins.get(x).el.remove(); this.wins.delete(x); } this.z = this.z.filter((x) => x === id); this.order = this.order.filter((x) => x === id); this.activate(id); }

  minimize(id) {
    const w = this.wins.get(id);
    if (!w) return;
    if (this.max) this.setMax(false, { quiet: true });
    w.state = 'min';
    if (id === this.active) {
      const next = [...this.z].reverse().find((x) => x !== id && this.wins.get(x)?.state !== 'min');
      if (next) { this.activate(next); return; }
    }
    this.layout();
  }

  setMax(on, { quiet = false } = {}) {
    this.max = !!on;
    if (this.app.prefs.mdiMax !== this.max) this.app.setPref('mdiMax', this.max);
    if (on) for (const w of this.wins.values()) if (w.state === 'min' && w.id === this.active) w.state = 'normal';
    if (!quiet) this.sync(); else this.layout();
  }

  /** Window › Tile Horizontally (`h`: one above the other) or Tile Vertically (`v`: side by side). */
  tile(dir = 'h') {
    const ids = this.order.filter((id) => this.wins.get(id)?.state !== 'min');
    if (!ids.length) return;
    this.setMax(false, { quiet: true });
    const n = ids.length, L = this._size();
    const many = Math.ceil(Math.sqrt(n));
    const cols = dir === 'h' ? (n <= 3 ? 1 : many) : (n <= 3 ? n : Math.ceil(n / many));
    const rows = Math.ceil(n / cols);
    const W = L.w / cols, H = L.h / rows;
    ids.forEach((id, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      this.wins.get(id).rect = { x: Math.round(c * W), y: Math.round(r * H), w: Math.round(W), h: Math.round(H) };
    });
    this.sync();
  }

  cascade() {
    const ids = this.order.filter((id) => this.wins.get(id)?.state !== 'min');
    if (!ids.length) return;
    this.setMax(false, { quiet: true });
    const L = this._size();
    const w = Math.max(320, Math.round(L.w * 0.62)), hgt = Math.max(220, Math.round(L.h * 0.62));
    ids.forEach((id, i) => { this.wins.get(id).rect = { x: 10 + 28 * (i % 10), y: 10 + 28 * (i % 10), w, h: hgt }; });
    // the active window ends on top, as the last of the cascade
    const a = this.active;
    this.z = [...ids.filter((x) => x !== a), ...(ids.includes(a) ? [a] : [])];
    this.sync();
  }

  /** Window › Arrange Icons: the minimized windows in a row along the bottom. */
  arrange() { this.layout(); }

  /** Keep the windows in step with the project: the active document always has a window, gone documents none. */
  sync() {
    const app = this.app, p = app.project, stage = this.shell.stage;
    if (p !== this.project) {
      for (const w of this.wins.values()) w.el.remove();
      this.wins.clear(); this.order = []; this.z = [];
      this.project = p;
      // the windows that were open when this project was last shown come back (behind the active one)
      for (const id of (app.prefs.openWindows ?? {})[p.id] ?? []) if (id !== p.activeStructure && this.entry(id)) this._make(id);
    }
    for (const id of [...this.wins.keys()]) {
      if (this.entry(id)) continue;
      this.wins.get(id).el.remove(); this.wins.delete(id);
      this.z = this.z.filter((x) => x !== id); this.order = this.order.filter((x) => x !== id);
    }
    const a = p.activeStructure && this.entry(p.activeStructure) ? p.activeStructure : null;
    if (a) {
      const w = this.wins.get(a) ?? this._make(a);
      if (w.state === 'min') w.state = 'normal';
      if (this.z.at(-1) !== a) this.z = [...this.z.filter((x) => x !== a), a];
      if (stage.parentNode !== w.body) w.body.replaceChildren(stage);
    } else if (stage.parentNode !== this.park) this.park.append(stage);
    for (const [id, w] of this.wins) {
      const e = this.entry(id);
      const kind = docKind(e?.structure);
      w.title.textContent = e?.name ?? 'Document';
      w.icon.replaceChildren(ic(KIND_ICON[kind], 'sm'));
      w.el.setAttribute('aria-label', `${e?.name ?? 'Document'} — document window`);
      w.el.setAttribute('aria-current', String(id === a));
      if (id === a) continue;
      // an inactive window: the picture it had when it was left, else its icon and formula
      const shown = w.body.firstChild;
      if (w.snap) {
        if (shown?.tagName === 'IMG') { if (shown.getAttribute('src') !== w.snap) shown.src = w.snap; }
        else w.body.replaceChildren(h('img.dw-snap', { src: w.snap, alt: '', draggable: false }));
      } else if (!shown?.classList?.contains('dw-empty')) {
        w.body.replaceChildren(h('div.dw-snap.dw-empty', ic(KIND_ICON[kind]), h('span', e?.structure ? `${e.structure.formula()} · ${e.structure.length.toLocaleString()} atoms` : '')));
      }
    }
    this._renderTabs();
    this.layout();
    this._remember();
  }

  /** Keep which windows of this project are open (app.prefs.openWindows, the last 20 projects). */
  _remember() {
    const p = this.app.project, ids = this.order.filter((id) => this.wins.has(id));
    const all = this.app.prefs.openWindows ?? {};
    if (JSON.stringify(all[p.id] ?? []) === JSON.stringify(ids)) return;
    const next = { ...all, [p.id]: ids };
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete next[k];
    this.app.prefs.openWindows = next;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.app.setPref('openWindows', this.app.prefs.openWindows), 400);
  }

  _renderTabs() {
    const a = this.active;
    this.tabs.replaceChildren(...this.list().map(({ id, name }) => {
      const e = this.entry(id);
      const on = id === a;
      const close = h('span.dt-x', { role: 'button', 'aria-label': `Close ${name}`, 'data-tip': 'Close window' }, ic('x', 'sm'));
      const t = h('button.doctab', { type: 'button', role: 'tab', 'aria-selected': String(on), tabindex: on ? '0' : '-1', 'data-tip': e?.structure ? `${e.structure.formula()} · ${KIND_LABEL[docKind(e.structure)]}` : null },
        ic(KIND_ICON[docKind(e?.structure)], 'sm'), h('span.dt-n', name), close);
      t.addEventListener('click', (ev) => { if (ev.target.closest('.dt-x')) { this.close(id); return; } this.activate(id); });
      t.addEventListener('auxclick', (ev) => { if (ev.button === 1) { ev.preventDefault(); this.close(id); } });
      t.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.bench.windowMenu({ x: ev.clientX, y: ev.clientY }, id); });
      return t;
    }));
  }

  _place(w) {
    const r = w.rect;
    Object.assign(w.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  layout() {
    const work = this.bench.work;
    const any = this.wins.size > 0;
    const max = this.max && any;
    work.dataset.max = String(max);
    this.tabsWrap.hidden = !max;
    const L = this._size();
    let k = 0;
    this.z.forEach((id, i) => {
      const w = this.wins.get(id);
      if (!w) return;
      w.el.style.zIndex = String(10 + i);
      w.el.dataset.state = w.state;
      w.maxB.replaceChildren(ic(this.max ? 'winRestore' : 'winMax', 'sm'));
      w.maxB.dataset.tip = this.max ? 'Restore' : 'Maximize';
      if (max) { w.el.style.cssText = `z-index:${10 + i}`; return; }
      if (w.state === 'min') {
        const per = 184;
        const cols = Math.max(1, Math.floor(L.w / per));
        const c = k % cols, r = Math.floor(k / cols);
        k++;
        Object.assign(w.el.style, { left: `${4 + c * per}px`, top: `${L.h - 30 - r * 30}px`, width: `${per - 6}px`, height: '26px' });
        return;
      }
      // keep the title bar reachable when the workspace got smaller
      w.rect.w = Math.min(w.rect.w, Math.max(200, L.w));
      w.rect.h = Math.min(w.rect.h, Math.max(140, L.h));
      w.rect.x = clampN(w.rect.x, -w.rect.w + 80, L.w - 60);
      w.rect.y = clampN(w.rect.y, 0, L.h - 26);
      this._place(w);
    });
  }
}

// ------------------------------------------------------------------------------------------------- workbench
export class Workbench {
  constructor(shell) {
    this.shell = shell;
    this.app = shell.app;
    const app = this.app, root = shell.root;
    root.classList.add('wb');
    this._cmdBtns = [];
    this.project = new ProjectExplorer(this);
    this.properties = new PropertiesExplorer(this);
    this.panes = {
      project: this._pane('project', 'Project', 'project', this.project.el),
      properties: this._pane('properties', 'Properties', 'props', this.properties.el),
    };
    this.hsplit = h('div.hsplit', { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the explorers', tabindex: 0 });
    this.dock = h('aside.dock', { 'aria-label': 'Explorers' }, this.panes.project, this.hsplit, this.panes.properties);
    this.vsplit = h('div.vsplit', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the explorer dock', tabindex: 0 });
    this.work = h('div.workspace');
    this.side = h('div.sidedock', { 'aria-label': 'Docked tool windows' });
    this.statusline = h('footer.statusline');
    root.append(this.dock, this.vsplit, this.work, this.side, this.statusline);
    this.mdi = new MDI(this);
    // the empty state and the drop zone cover the workspace, not one window
    this.work.append(shell.empty, shell.drop);
    this._buildStatus();
    this._splitters();
    this._toolWindows();
    this._buildToolbars();
    this.applyDock();
    // app events: explorers, windows, toolbars and the status bar follow
    const soon = (fn) => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };
    this._refreshSoon = soon(() => this.refresh());
    for (const ev of ['project', 'structure']) app.on(ev, () => this.sync());
    for (const ev of ['selection', 'scene', 'history', 'measure', 'busy', 'registry', 'tool', 'saveState', 'prefs']) app.on(ev, this._refreshSoon);
    app.viewer.on('frame', this._refreshSoon);
    // File › Recent Projects: the projects that were saved or opened from a storage location
    const remember = () => {
      const loc = app.project.location;
      if (!loc?.provider || !loc.id) return;
      const list = (app.prefs.recentProjects ?? []).filter((r) => !(r.provider === loc.provider && r.id === loc.id));
      const next = [{ provider: loc.provider, id: loc.id, name: app.project.name }, ...list].slice(0, 8);
      if (JSON.stringify(next) !== JSON.stringify(app.prefs.recentProjects ?? [])) app.setPref('recentProjects', next);
    };
    app.on('saved', remember);
    app.on('project', remember);
    app.viewer.on('visibility', this._refreshSoon);
    addEventListener('resize', debounce(() => this.place(), 60));
    this.sync();
  }

  get desktop() { return !isMobile(); }

  // ---------------------------------------------------------------- explorers (the dock on the left)
  _pane(id, title, icon, body) {
    const close = h('button.xh-b', { type: 'button', 'aria-label': `Close the ${title} explorer`, 'data-tip': `Close (View › Explorers › ${title})` }, ic('x', 'sm'));
    close.addEventListener('click', () => this.setExplorer(id, false));
    return h(`section.xpane.${id}`, { 'aria-label': `${title} explorer`, dataset: { pane: id } }, h('header.xhead', ic(icon, 'sm'), h('span', title), close), body);
  }

  explorerOpen(id) { return (this.app.prefs.explorers ?? {})[id] !== false; }
  /** Show (`on`), hide or (`on` left out) toggle explorer `id` ('project' | 'properties'). */
  setExplorer(id, on) {
    if (!this.desktop) {
      // phones: the explorer opens as a sheet over the view (one at a time), in place of the panel sheets
      const open = on === undefined ? this.dock.dataset.sheet !== id : !!on;
      this.dock.dataset.sheet = open ? id : '';
      if (open) { this.shell.closeSheets(); this.panes[id].hidden = false; this.refresh(); }
      return;
    }
    if (on === undefined) on = !this.explorerOpen(id);
    this.app.setPref('explorers', { ...(this.app.prefs.explorers ?? {}), [id]: !!on });
    this.applyDock();
    if (on) this.refresh();
  }
  /** Show or hide the explorers and the dock as View › Explorers says; on phones the dock is a sheet. */
  applyDock() {
    const p = this.explorerOpen('project'), q = this.explorerOpen('properties');
    this.panes.project.hidden = !p;
    this.panes.properties.hidden = !q;
    this.hsplit.hidden = !(p && q);
    const any = p || q;
    this.shell.root.dataset.dock = String(any);
    const w = clampN(this.app.prefs.dockWidth ?? 268, 180, 520);
    this.shell.root.style.setProperty('--dock', `${w}px`);
    const f = clampN(this.app.prefs.dockSplit ?? 0.42, 0.15, 0.85);
    this.panes.project.style.flex = `${f} 1 0`;
    this.panes.properties.style.flex = `${1 - f} 1 0`;
    requestAnimationFrame(() => this.app.viewer.resize());
  }
  focusProperties() { this.setExplorer('properties', true); this.properties.focus(); }

  _splitters() {
    const app = this.app;
    const dragX = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, w0 = this.dock.getBoundingClientRect().width;
      const move = (ev) => { const w = clampN(w0 + ev.clientX - x0, 180, Math.min(520, innerWidth - 360)); this.shell.root.style.setProperty('--dock', `${w}px`); this._dockW = w; };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (this._dockW) app.setPref('dockWidth', Math.round(this._dockW)); app.viewer.resize(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    this.vsplit.addEventListener('pointerdown', dragX);
    this.vsplit.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
      if (!d) return;
      e.preventDefault();
      app.setPref('dockWidth', clampN((app.prefs.dockWidth ?? 268) + d, 180, 520));
      this.applyDock();
    });
    const dragY = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = this.dock.getBoundingClientRect();
      const move = (ev) => {
        const f = clampN((ev.clientY - r.top) / Math.max(1, r.height), 0.15, 0.85);
        this.panes.project.style.flex = `${f} 1 0`; this.panes.properties.style.flex = `${1 - f} 1 0`; this._split = f;
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (this._split) app.setPref('dockSplit', +this._split.toFixed(3)); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    this.hsplit.addEventListener('pointerdown', dragY);
    this.hsplit.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' ? -0.04 : e.key === 'ArrowDown' ? 0.04 : 0;
      if (!d) return;
      e.preventDefault();
      app.setPref('dockSplit', clampN((app.prefs.dockSplit ?? 0.42) + d, 0.15, 0.85));
      this.applyDock();
    });
  }

  // ---------------------------------------------------------------- tool windows (the panels and the appearance tabs)
  /** Docked (on the right of the workspace) or floating, and where: app.prefs.toolWindows[drawer|inspector]. */
  twState(key) { return (this.app.prefs.toolWindows ?? {})[key] ?? {}; }
  setTwState(key, patch) {
    const all = { ...(this.app.prefs.toolWindows ?? {}) };
    all[key] = { ...(all[key] ?? {}), ...patch };
    this.app.setPref('toolWindows', all);
  }

  _toolWindows() {
    const pairs = [['drawer', this.shell.drawer, '.panel-head, .tw-bar'], ['inspector', this.shell.inspector, '.tw-bar']];
    for (const [key, el, headSel] of pairs) {
      el.classList.add('toolwin');
      el.dataset.tw = key;
      el.addEventListener('pointerdown', (e) => {
        if (!this.desktop || el.dataset.docked === 'true' || e.button !== 0) return;
        const head = e.target.closest(headSel);
        if (!head || e.target.closest('button, input, select, textarea, a, [role="tab"]')) return;
        e.preventDefault();
        const r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
        const move = (ev) => {
          const x = clampN(r0.left + ev.clientX - x0, -r0.width + 80, innerWidth - 80);
          const y = clampN(r0.top + ev.clientY - y0, 0, innerHeight - 40);
          el.style.left = `${x}px`; el.style.top = `${y}px`;
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          const r = el.getBoundingClientRect();
          this.setTwState(key, { x: Math.round(r.left), y: Math.round(r.top) });
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      // the window's size (CSS resize handle) is kept
      if (typeof ResizeObserver === 'function') {
        const save = debounce(() => {
          if (!this.desktop || el.dataset.docked === 'true' || el.dataset.collapsed === 'true') return;
          const r = el.getBoundingClientRect();
          if (r.width < 100 || r.height < 100) return;
          const s = this.twState(key);
          if (Math.abs((s.w ?? 0) - r.width) > 2 || Math.abs((s.h ?? 0) - r.height) > 2) this.setTwState(key, { w: Math.round(r.width), h: Math.round(r.height) });
        }, 300);
        new ResizeObserver(save).observe(el);
      }
    }
  }

  /** The title-bar buttons of a tool window: dock / float and close. */
  winControls(key) {
    if (!this.desktop) return [];
    const docked = !!this.twState(key).docked;
    const dockB = btn('', { icon: docked ? 'winRestore' : 'pin', cls: 'ghost icon tiny tw-dock', tip: docked ? 'Float this window over the workspace' : 'Dock this window on the right of the workspace', on: () => { this.setTwState(key, { docked: !docked }); this.place(); this.shell[key === 'drawer' ? 'renderDrawer' : 'renderInspector'](); } });
    const close = btn('', { icon: 'x', cls: 'ghost icon tiny tw-close', tip: 'Close', kbd: key === 'drawer' ? '[' : ']', on: () => (key === 'drawer' ? this.shell.toggleLeft(this.shell.leftId) : this.shell.toggleInspector(false)) });
    return [dockB, close];
  }

  /** The title bar of the appearance window ("Display Style", "Lighting" …) above its tabs. */
  inspectorBar(tabId) {
    return h('div.tw-bar', ic('style', 'sm'), h('span.tw-t', TAB_TITLES[tabId] ?? 'Display Style'), ...this.winControls('inspector'));
  }

  /** One small button per panel (Library, Build, Structure …) under the title of the panel window. */
  panelSwitcher(panels, currentId) {
    if (!this.desktop) return null;
    const row = h('div.tw-panels', { role: 'tablist', 'aria-label': 'Panels' });
    for (const p of panels.values()) {
      const b = h('button.twp', { type: 'button', role: 'tab', 'aria-selected': String(p.id === currentId), 'data-tip': p.tip ?? p.title }, ic(p.icon, 'sm'), h('span', p.short ?? p.title));
      b.addEventListener('click', () => this.shell.openLeft(p.id));
      row.append(b);
    }
    return row;
  }

  /** Place what depends on the layout: the tool windows (docked or floating), the status bar, the side dock. */
  place() {
    const sh = this.shell, root = sh.root, desk = this.desktop && !root.dataset.fullscreen;
    if (this.desktop || sh.leftOpen || sh.inspectorOpen) this.dock.dataset.sheet = '';
    for (const [key, el] of [['drawer', sh.drawer], ['inspector', sh.inspector]]) {
      const st = this.twState(key);
      const docked = desk && !!st.docked;
      el.dataset.docked = String(docked);
      el.dataset.floating = String(desk && !docked);
      if (docked) { if (el.parentNode !== this.side) this.side.append(el); el.style.cssText = ''; continue; }
      if (el.parentNode !== root) root.append(el);
      if (!desk) { el.style.cssText = ''; continue; }
      // a floating window: where it was left, else beside the explorers (panels) or at the right (appearance)
      const W = innerWidth, H = innerHeight;
      const wr = this.work.getBoundingClientRect();
      const w = clampN(st.w ?? 330, 260, W - 40), hh = clampN(st.h ?? Math.min(640, (wr.height || H) - 24), 220, H - 40);
      const x = st.x ?? (key === 'drawer' ? (wr.left || 280) + 14 : (wr.right || W) - w - 14);
      const y = st.y ?? (wr.top || 90) + 12;
      Object.assign(el.style, { left: `${clampN(x, -w + 80, W - 80)}px`, top: `${clampN(y, 0, H - 40)}px`, width: `${w}px`, height: `${hh}px` });
    }
    const sideUsed = desk && [sh.drawer, sh.inspector].some((el) => el.parentNode === this.side && el.dataset.collapsed !== 'true');
    root.dataset.side = String(sideUsed);
    // the status bar: the hints and counts in the bottom bar on desktops, floating in the view on phones and in full screen
    if (desk) { if (sh.statusbar.parentNode !== this.statusline) this.statusline.prepend(sh.statusbar); }
    else if (sh.statusbar.parentNode !== sh.stage) sh.stage.append(sh.statusbar);
    root.dataset.statusbar = String(this.app.prefs.statusBar !== false);
    requestAnimationFrame(() => { this.app.viewer.resize(); this.mdi.layout(); });
  }

  // ---------------------------------------------------------------- toolbars
  /** A toolbar button that runs command `id`, greyed (with the reason as its tip) while it cannot run. */
  cmdBtn(id, icon, tip) {
    const b = h('button.btn.ghost.icon', { type: 'button', 'aria-label': tip, dataset: { command: id, tip, label: tip } }, ic(icon));
    b.addEventListener('click', () => this.shell.runCommand(id));
    this._cmdBtns.push(b);
    return b;
  }
  /** A toolbar button with a ▾ that opens a menu (`open(button)`). */
  dropBtn(icon, tip, open) {
    const b = h('button.btn.ghost.drop', { type: 'button', 'aria-label': tip, 'aria-haspopup': 'menu', 'data-tip': tip }, ic(icon), ic('chevronDown', 'sm caret'));
    b.addEventListener('click', () => open(b));
    return b;
  }

  _band(id, label, ...children) {
    return h('div.tband', { role: 'group', 'aria-label': label, dataset: { band: id } }, h('span.grip', { 'aria-hidden': 'true' }), ...children);
  }

  _buildToolbars() {
    const sh = this.shell, app = this.app;
    const sep = () => h('span.sep');
    // Standard: New, Open, Save, Export | Undo, Redo (the shell's group) | Cut, Copy, Paste | Print
    const clip = [this.cmdBtn('edit.cut', 'scissors', 'Cut'), this.cmdBtn('edit.copy', 'copy', 'Copy'), this.cmdBtn('edit.paste', 'paste', 'Paste')];
    const std = this._band('standard', 'Standard', sh.stdSlot, sep(), ...clip, sep(), this.cmdBtn('file.print', 'printer', 'Print'));
    // 3D Viewer: Select, Rotate, Zoom, Translate, Measure … | Reset, Fit, Look along, Projection, Turntable
    const view = this._band('view', '3D Viewer', sh.viewSlot);
    // Display: display style, look, lighting, colours, labels | unit cell | the Display Style, Display Options and Lighting windows
    const labels = this.dropBtn('label', 'Labels', (b) => showMenu(b, [{ header: 'Label atoms by' }, ...[['none', 'None'], ['element', 'Element'], ['index', 'Index'], ['both', 'Element and index']].map(([v, l]) => ({ label: l, radio: true, checked: (app.scene.display.labels ?? 'none') === v, run: () => app.set('display.labels', v) }))], { label: 'Labels' }));
    const light = this.dropBtn('bulb', 'Lighting preset', (b) => sh.familyMenu('light.', 'Lighting', b));
    const colors = this.dropBtn('palette', 'Colour scheme', (b) => sh.familyMenu('color.', 'Colour scheme', b));
    this.cellBtn = this.cmdBtn('view.cell', 'cell', 'Unit cell');
    const display = this._band('display', 'Display', sh.repPick, sh.lookPick, light, colors, labels, sep(), this.cellBtn, sep(),
      this.cmdBtn('view.displayStyle', 'style', 'Display Style…'), this.cmdBtn('view.displayOptions', 'options', 'Display Options…'), this.cmdBtn('view.lighting', 'sun', 'Lighting…'));
    // Build: the shell's group (Build crystal, cleave …, lattice parameters)
    const build = this._band('build', 'Build', sh.buildGroup);
    // Modify: element, fix / free, hide / show, delete, atom selection
    const elem = this.dropBtn('edit', 'Modify element of the selected atoms', (b) => showMenu(b, this.elementItems(), { label: 'Modify element' }));
    this.elemBtn = elem;
    const modify = this._band('modify', 'Modify', elem, this.cmdBtn('sel.fix', 'lock', 'Fix selected atoms'), this.cmdBtn('sel.free', 'unlock', 'Free selected atoms'), sep(),
      this.cmdBtn('view.hideSelected', 'hideSel', 'Hide selected atoms'), this.cmdBtn('view.showAll', 'eye', 'Show all atoms'), sep(),
      this.cmdBtn('sel.query', 'search', 'Atom selection…'), this.cmdBtn('sel.delete', 'trash', 'Delete selected atoms'));
    // Measure: distance, angle, torsion, clear
    const measure = this._band('measure', 'Measure', this.cmdBtn('tool.measure', 'ruler', 'Measure distance'), this.cmdBtn('tool.angle', 'axes', 'Measure angle'), this.cmdBtn('tool.dihedral', 'normal', 'Measure dihedral'), this.cmdBtn('tool.clearMeasurements', 'x', 'Clear measurements'));
    // Animation: first, previous, play / pause, next, last
    this.playBtn = this.cmdBtn('traj.play', 'play', 'Play / pause');
    const anim = this._band('animation', 'Animation', this.cmdBtn('traj.first', 'first', 'First frame'), this.cmdBtn('traj.prev', 'prev', 'Previous frame'), this.playBtn, this.cmdBtn('traj.next', 'next', 'Next frame'), this.cmdBtn('traj.last', 'last', 'Last frame'));
    const image = this._band('image', 'Image', sh.shotSlot);
    this.bands = { standard: std, view, display, build, modify, measure, animation: anim, image };
    sh.strip.replaceChildren(...TOOLBARS.map(([id]) => this.bands[id]));
    sh.strip.classList.add('toolbars');
    this.applyToolbars();
  }

  toolbarOn(id) { return (this.app.prefs.toolbars ?? {})[id] !== false; }
  setToolbar(id, on = !this.toolbarOn(id)) { this.app.setPref('toolbars', { ...(this.app.prefs.toolbars ?? {}), [id]: !!on }); this.applyToolbars(); }
  applyToolbars() {
    for (const [id, el] of Object.entries(this.bands ?? {})) el.hidden = !this.toolbarOn(id);
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  /** Modify › Modify Element: the common elements, and Other… */
  elementItems() {
    const app = this.app;
    const sel = app.selection.length;
    const why = !app.structure ? 'Load a structure first' : !sel ? 'Select atoms first' : null;
    const common = ['H', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Ti', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ag', 'Pt', 'Au'];
    const run = (sym) => () => { try { app.replaceSelected(sym, { toast: `Changed ${sel} atom${sel === 1 ? '' : 's'} to ${sym}` }); } catch (e) { toast(e.message, { type: 'error' }); } };
    return [
      { header: sel ? `Change ${sel} selected atom${sel === 1 ? '' : 's'} to` : 'Select atoms to change them' },
      ...common.map((s) => ({ label: s, disabled: !!why, tip: why, run: run(s) })),
      { separator: true },
      { label: 'Other Element…', icon: 'edit', disabled: !!why, tip: why, run: () => this.shell.runCommand('sel.replace') },
    ];
  }

  // ---------------------------------------------------------------- status bar
  _buildStatus() {
    this.sfSel = h('span.sf', { 'data-tip': 'Selected atoms' });
    this.sfCell = h('span.sf.mono', { 'data-tip': 'Lattice parameters of the active document (a, b, c in Å)' });
    this.sfFrame = h('span.sf.mono', { 'data-tip': 'Frame of the trajectory' });
    this.sfDoc = h('span.sf', { 'data-tip': 'Document windows' });
    this.statusline.append(h('span.sf-fields', this.sfSel, this.sfCell, this.sfFrame, this.sfDoc));
  }

  _updateStatus() {
    const app = this.app, s = app.structure;
    const n = app.selection.length;
    this.sfSel.textContent = s ? (n ? `${n.toLocaleString()} selected` : 'No selection') : '';
    this.sfSel.hidden = !s;
    const cp = s?.cellParams?.();
    this.sfCell.textContent = cp ? `a ${cp.a.toFixed(3)}  b ${cp.b.toFixed(3)}  c ${cp.c.toFixed(3)}` : '';
    this.sfCell.hidden = !cp;
    const f = s?.nFrames ?? 1;
    this.sfFrame.textContent = f > 1 ? `Frame ${s.frame + 1} / ${f}` : '';
    this.sfFrame.hidden = f <= 1;
    const open = this.mdi.list().length, all = app.project.structures.length;
    this.sfDoc.textContent = all ? `${open} of ${all} document${all === 1 ? '' : 's'} open` : 'No documents';
  }

  // ---------------------------------------------------------------- menus the workbench owns
  /** The context menu of a document tab or window. */
  windowMenu(at, id) {
    const m = this.mdi;
    showMenu(at, [
      { label: 'Activate', icon: 'windows', run: () => m.activate(id) },
      { label: 'Close', icon: 'x', run: () => m.close(id) },
      { label: 'Close Others', disabled: m.list().length < 2, run: () => m.closeOthers(id) },
      { label: 'Close All', run: () => m.closeAll() },
      { separator: true },
      { label: 'Tile Horizontally', icon: 'tileH', run: () => m.tile('h') },
      { label: 'Tile Vertically', icon: 'tileV', run: () => m.tile('v') },
      { label: 'Cascade', icon: 'cascade', run: () => m.cascade() },
      { separator: true },
      { label: 'Show in Project Explorer', icon: 'project', run: () => { this.setExplorer('project', true); this.project.select(id, { focus: true }); } },
      { label: 'Properties', icon: 'props', run: () => { this.project.select(id); this.focusProperties(); } },
    ], { label: 'Window' });
  }

  /** Window › Windows…: every document, open or not, to activate or close. */
  windowsDialog() {
    const app = this.app, m = this.mdi;
    const list = h('div.win-list', { role: 'listbox', 'aria-label': 'Documents' });
    let pick = m.active ?? app.project.structures[0]?.id ?? null;
    const draw = () => {
      list.replaceChildren(...app.project.structures.map((e) => {
        const open = m.isOpen(e.id);
        const row = h('button.win-row', { type: 'button', role: 'option', 'aria-selected': String(e.id === pick) },
          ic(KIND_ICON[docKind(e.structure)], 'sm'), h('span.n', e.name), h('small', open ? (e.id === m.active ? 'active' : 'open') : 'closed'));
        row.addEventListener('click', () => { pick = e.id; draw(); });
        row.addEventListener('dblclick', () => { m.activate(e.id); d.close(); });
        return row;
      }));
    };
    draw();
    const d = dialog({
      title: 'Windows', body: h('div', { style: { display: 'grid', gap: '8px' } }, h('p.hint', 'The documents of this project. Double-click one to activate its window.'), list),
      actions: [
        { label: 'Close Window', run: () => { if (pick && m.isOpen(pick)) m.close(pick); draw(); return false; } },
        { label: 'Close', run: () => true },
        { label: 'Activate', primary: true, run: () => { if (pick) m.activate(pick); } },
      ],
    });
  }

  // ---------------------------------------------------------------- following the app
  /** The project or the active document changed: windows first, then everything that shows them. */
  sync() {
    this.mdi.sync();
    this.refresh();
  }

  refresh() {
    const app = this.app;
    this.project.render();
    this.properties.schedule();
    this._updateStatus();
    this.updateTitle();
    this.updateEmpty();
    for (const b of this._cmdBtns) {
      const c = commands.get(b.dataset.command);
      b.hidden = !c;
      if (!c) continue;
      const ok = commands.available(c);
      b.classList.toggle('off', !ok);
      b.setAttribute('aria-disabled', String(!ok));
      const key = c.kbd ?? c.key;
      if (key) b.dataset.kbd = keyLabel(Array.isArray(key) ? key[0] : key); else delete b.dataset.kbd;
      b.dataset.tip = ok ? b.dataset.label : `${b.dataset.label}: ${commands.unavailableReason(c)}`;
    }
    if (this.cellBtn) this.cellBtn.setAttribute('aria-pressed', String(!!app.scene?.display?.cell?.show));
    if (this.playBtn) { const on = !!app.viewer.playing; this.playBtn.setAttribute('aria-pressed', String(on)); this.playBtn.replaceChildren(ic(on ? 'pause' : 'play')); }
    if (this.elemBtn) { const ok = !!app.structure && app.selection.length > 0; this.elemBtn.classList.toggle('off', !ok); }
  }

  updateTitle() {
    const app = this.app, e = app.project.structures.find((x) => x.id === app.project.activeStructure);
    document.title = e ? `${app.project.name} - Facet - [${e.name}]` : `${app.project.name} - Facet`;
  }

  /** The workspace without windows: start here (no documents), or open a document from the Project explorer. */
  updateEmpty() {
    const sh = this.shell, app = this.app;
    const none = !app.structure;
    sh.empty.hidden = !none;
    if (!none) return;
    const docs = app.project.structures.length;
    sh.empty.dataset.docs = String(docs);
    if (docs && sh.emptyHead) {
      sh.emptyHead.textContent = 'No document windows are open';
      sh.emptyText.textContent = `This project has ${docs} document${docs === 1 ? '' : 's'}. Double-click one in the Project explorer to open its window, or start something new.`;
    } else if (sh.emptyHead) sh.emptyHead.textContent = 'Start with a structure';
  }

  /** State for the menus' check marks. */
  menuState() {
    return {
      statusBar: this.app.prefs.statusBar !== false,
      infoCard: !!this.app.prefs.infoCard,
      explorers: { project: this.explorerOpen('project'), properties: this.explorerOpen('properties') },
      mdiMax: this.mdi.max,
    };
  }

  /** Close menus and bring the keyboard to the Project explorer (View › Explorers › Project). */
  focusProject() { closeMenu(); this.setExplorer('project', true); this.project.focus(); }
}
