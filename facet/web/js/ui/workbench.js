/**
 * The desktop workbench, laid out as Materials Studio is:
 *
 *   ┌ menu bar ─────────────────────────────────────────────────────────────────────────────┐
 *   ├ toolbars (Standard | 3D Viewer | Display | Build | Modify | Animation | Image), each one ┤
 *   │ moved by its grip: along a row, to another row, or off the strip to float               │
 *   ├────────────────────┬────────────────────────────────────────────────────────────────────┤
 *   │ Project explorer   ║ workspace: document windows (MDI), maximized with tabs, or tiled,   │
 *   │ (project tree)     ║ cascaded and minimized like desktop windows. Tool windows float     │
 *   │────────────────────║ over it as the dialogs of Materials Studio do, one for each panel   │
 *   │ Properties explorer║ (Library, Build, Structure, Surface, Projects) and one for each     │
 *   │ (filter + grid)    ║ appearance tab (Display Style, Lighting, Effects, Display Options)  │
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

/**
 * The scene's background as CSS, for the margins around the picture of an inactive window (the picture keeps its
 * proportions, so a window of another shape shows the whole structure). Only plain hex colours are used.
 */
export function backgroundCSS(bg) {
  const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : null);
  if (!bg || bg.mode === 'transparent') return '#ffffff';   // (pictures of a transparent view are drawn on white)
  const a = hex(bg.color1), b = hex(bg.color2);
  if (!a) return '#6b7179';
  if (bg.mode === 'solid' || !b) return a;
  return bg.mode === 'radial' ? `radial-gradient(circle at 50% 45%, ${a}, ${b})` : `linear-gradient(${a}, ${b})`;
}

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

/**
 * Whether a toolbar that View › Toolbars has not set is shown: Measure is off (the 3D Viewer toolbar has Measure
 * too), Animation shows while the active document is a trajectory; the others are on. Keeps the strip one row on
 * a laptop screen.
 */
export const TOOLBAR_DEFAULTS = Object.freeze({
  measure: () => false,
  animation: (app) => (app?.structure?.nFrames ?? 1) > 1,
});

const TOOLBAR_IDS = TOOLBARS.map(([id]) => id);

/**
 * A toolbar layout as kept in app.prefs.toolbarLayout, made whole: {rows: [[id, …], …] top to bottom, float: {id:
 * {x, y, from?}}}. Every toolbar of `ids` is in it once, docked in a row or floating; unknown ids, repeats and empty
 * rows go, a toolbar it does not place (a new one) ends the last row. `from` is the row and the toolbar it stood
 * before when it was floated, where a double-click docks it back. Pure.
 */
export function normalizeToolbarLayout(saved, ids = TOOLBAR_IDS) {
  const known = new Set(ids), seen = new Set();
  const take = (id) => typeof id === 'string' && known.has(id) && !seen.has(id) && !!seen.add(id);
  const float = {};
  for (const [id, p] of Object.entries(saved?.float ?? {})) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !take(id)) continue;
    const from = p.from && Number.isInteger(p.from.row) && p.from.row >= 0 ? { row: p.from.row, before: typeof p.from.before === 'string' ? p.from.before : null } : null;
    float[id] = { x: Math.round(p.x), y: Math.round(p.y), ...(from ? { from } : {}) };
  }
  const rows = (Array.isArray(saved?.rows) ? saved.rows : []).map((r) => (Array.isArray(r) ? r.filter(take) : [])).filter((r) => r.length);
  const rest = ids.filter((id) => !seen.has(id));
  if (rest.length) { if (rows.length) rows[rows.length - 1].push(...rest); else rows.push(rest); }
  return { rows, float };
}

/**
 * Layout `layout` with toolbar `id` moved `to`: {row, before} into row `row` before toolbar `before` (null: at its
 * end), {row, newRow: true} as a row of its own at that index, {float: true, x, y} floating there. Row indices are
 * those of `layout` as it is (the toolbar still in its row). Pure.
 */
export function moveToolbar(layout, id, to, ids = TOOLBAR_IDS) {
  const L = normalizeToolbarLayout(layout, ids);
  if (!ids.includes(id)) return L;
  const r = L.rows.findIndex((row) => row.includes(id));
  const from = r >= 0 ? { row: r, before: L.rows[r][L.rows[r].indexOf(id) + 1] ?? null } : L.float[id]?.from ?? null;
  const rows = L.rows.map((row) => row.filter((x) => x !== id));   // (an emptied row keeps its place until the end)
  const float = { ...L.float };
  delete float[id];
  const at = (v, n) => clampN(Number.isFinite(+v) ? Math.trunc(+v) : 0, 0, n);
  if (to?.float) float[id] = { x: Math.round(+to.x || 0), y: Math.round(+to.y || 0), ...(from ? { from } : {}) };
  else if (to?.newRow) rows.splice(at(to.row, rows.length), 0, [id]);
  else {
    if (!rows.length) rows.push([]);
    const row = rows[at(to?.row, rows.length - 1)];
    const k = to?.before != null ? row.indexOf(to.before) : -1;
    if (k >= 0) row.splice(k, 0, id); else row.push(id);
  }
  return normalizeToolbarLayout({ rows, float }, ids);
}

/** Titles of the windows of the appearance tabs, by tab (the names of Materials Studio; the phone tab bar keeps the tabs' own). */
export const TAB_TITLES = Object.freeze({ style: 'Display Style', light: 'Lighting', effects: 'Effects', scene: 'Display Options' });

/**
 * Where a tool window opens the first time: at `base`, else (another open window has its corner there) one `step`
 * further, and so on, so windows opened one after another cascade instead of covering each other. `taken`: the top
 * left corners of the other open windows. Pure.
 */
export function cascadeSpot(base, taken, step = { x: 26, y: 26 }, tries = 8) {
  let p = { x: base.x, y: base.y };
  for (let i = 0; i < tries && taken.some((t) => Math.abs(t.x - p.x) < 14 && Math.abs(t.y - p.y) < 14); i++) p = { x: p.x + step.x, y: p.y + step.y };
  return p;
}

// ------------------------------------------------------------------------------------------------- document windows
class MDI {
  constructor(bench) {
    this.bench = bench; this.app = bench.app; this.shell = bench.shell;
    this.wins = new Map();   // entry id → window
    this.order = [];         // ids in the order the windows were opened (tabs, Window menu)
    this.z = [];             // ids bottom → top
    this.max = this.app.prefs.mdiMax !== false;
    this.arranged = null;    // 'h' | 'v' while the windows are tiled: they are tiled again when the workspace changes size
    this.project = null;
    this.tabs = h('div.doctabs', { role: 'tablist', 'aria-label': 'Document windows' });
    this.restoreBtn = btn('', { icon: 'winRestore', cls: 'ghost icon tiny', tip: 'Restore the windows (Window › Tile puts them side by side)', on: () => this.setMax(false) });
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
    // the document that had the view keeps its picture, camera and selection whenever another one takes the view (a
    // new or imported document, the Project explorer, Undo, the API …), not only when a window is clicked
    this.app.on('leave', (id) => { if (!this._activating && this.wins.has(id)) this._leave(id); });
  }

  /** A picture of the view at the size of window `id`'s body. */
  _snap(id) {
    const w = this.wins.get(id), v = this.app.viewer;
    const r = w?.body.getBoundingClientRect();
    if (!r || r.width <= 24 || r.height <= 24 || !this.app.structure) return;
    // the view may not have followed this window yet (opened in the same task, e.g. Open All Windows, coming from
    // the parked 2 × 2 px canvas): size it to the window first, or the picture is a blur of the background
    const c = v.container?.getBoundingClientRect?.();
    if (c && w.body.contains(v.container) && (Math.abs(c.width - v.width) > 1 || Math.abs(c.height - v.height) > 1)) v.resize();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    try { w.snap = v.thumbnail(Math.round(r.width * dpr), Math.round(r.height * dpr), 0.86); w.snapBg = backgroundCSS(this.app.scene?.display?.background); } catch { /* keep the last one */ }
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
      if (dx || dy) this.arranged = null;   // placed by hand: no longer tiled
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
      // the picture is taken here, before showStructure clears the selection (its 'leave' event is not needed then)
      if (prev && this.wins.has(prev)) this._leave(prev);
      this._activating = true;
      try { this.app.showStructure(id, { camera: w.camera, selection: w.selection }); }
      catch (e) { toast(e.message, { type: 'error' }); }
      finally { this._activating = false; }
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

  /**
   * Window › Tile Horizontally (`h`: one above the other) or Tile Vertically (`v`: side by side). The windows stay
   * tiled while the workspace changes size (a tool window docked, the explorers hidden, the browser resized) and as
   * windows open or close, until one is moved or resized by hand, or the windows are cascaded.
   */
  tile(dir = 'h') {
    if (!this.order.some((id) => this.wins.has(id) && this.wins.get(id).state !== 'min')) return;
    this.arranged = dir === 'v' ? 'v' : 'h';
    this.setMax(false, { quiet: true });
    this.sync();   // layout() places them
  }

  /** The rects of the tiled windows (the minimized ones keep their row along the bottom). */
  _tileRects(dir) {
    const ids = this.order.filter((id) => this.wins.has(id) && this.wins.get(id).state !== 'min');
    if (!ids.length) return;
    const n = ids.length, L = this._size();
    const many = Math.ceil(Math.sqrt(n));
    const cols = dir === 'h' ? (n <= 3 ? 1 : many) : (n <= 3 ? n : Math.ceil(n / many));
    const rows = Math.ceil(n / cols);
    const W = L.w / cols, H = L.h / rows;
    ids.forEach((id, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = Math.round(c * W), y = Math.round(r * H);
      this.wins.get(id).rect = { x, y, w: Math.round((c + 1) * W) - x, h: Math.round((r + 1) * H) - y };
    });
  }

  cascade() {
    const ids = this.order.filter((id) => this.wins.get(id)?.state !== 'min');
    if (!ids.length) return;
    this.arranged = null;
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
      this.arranged = null;
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
      w.body.style.background = id !== a && w.snap ? (w.snapBg ?? '') : '';   // the background the picture was taken on
      if (id === a) continue;
      // an inactive window: the picture it had when it was left, else (not shown yet) its icon, formula and a hint
      const shown = w.body.firstChild;
      if (w.snap) {
        if (shown?.tagName === 'IMG') { if (shown.getAttribute('src') !== w.snap) shown.src = w.snap; }
        else w.body.replaceChildren(h('img.dw-snap', { src: w.snap, alt: '', draggable: false }));
      } else if (!shown?.classList?.contains('dw-empty')) {
        w.body.replaceChildren(h('div.dw-snap.dw-empty', ic(KIND_ICON[kind]), h('span', e?.structure ? `${e.structure.formula()} · ${e.structure.length.toLocaleString()} atoms` : ''), h('small', 'Click to show it here')));
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
    if (this.arranged && !max) this._tileRects(this.arranged);
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

// ------------------------------------------------------------------------------------------------- tool windows
/**
 * The tool windows of the desktop, kept as Materials Studio keeps its dialogs: one for each panel (Library, Build,
 * Structure, Surface, Projects, and the panels of plugins) and one for each appearance tab (Display Style, Lighting,
 * Effects, Display Options), any number open at once, floating over the workspace. A window moves by its title bar,
 * resizes by its lower right corner, comes to the front when clicked, and opens where it was left
 * (app.prefs.toolWindows: {'panel:build': {x, y, w, h}, 'tab:style': …}); the open ones come back with the next
 * visit (app.prefs.openTools, back to front). What is in a window is drawn by the shell (Shell._host, _render).
 */
class ToolWindows {
  constructor(bench) {
    this.bench = bench; this.shell = bench.shell; this.app = bench.app;
    this.wins = new Map();                 // 'panel:build' → {key, kind, id, el, host, open, slot, size}
    this.z = [];                           // keys of the open windows, back to front
    this.hidden = { panel: [], tab: [] };  // the windows [ and ] closed, to bring back
    this._saveSoon = debounce(() => this._save(), 400);
  }

  hosts() { return [...this.wins.values()].map((w) => w.host); }
  _get(kind, id) { return this.wins.get(`${kind}:${id}`) ?? null; }
  _def(kind, id) { return this.shell.registries?.[kind]?.get(id) ?? null; }
  isOpen(kind, id) { return !!this._get(kind, id)?.open; }
  anyOpen(kind) { return [...this.wins.values()].some((w) => w.open && w.kind === kind); }
  /** The keys of the open windows of `kind` (all when left out), back to front. */
  openKeys(kind) { return this.z.filter((k) => { const w = this.wins.get(k); return !!w?.open && (!kind || w.kind === kind); }); }
  /** The title of the window of panel or tab `def`: 'Build', 'Display Style' … */
  title(kind, def) { return kind === 'tab' ? (def.windowTitle ?? TAB_TITLES[def.id] ?? def.title) : def.title; }
  state(key) { return (this.app.prefs.toolWindows ?? {})[key] ?? {}; }
  setState(key, patch) {
    const all = { ...(this.app.prefs.toolWindows ?? {}) };
    all[key] = { ...(all[key] ?? {}), ...patch };
    this.app.setPref('toolWindows', all);
  }

  /** The window of panel / tab `id`, made the first time it is asked for. */
  _win(kind, id) {
    const key = `${kind}:${id}`;
    let w = this.wins.get(key);
    if (w) return w;
    const el = h('aside.toolwin', { role: 'dialog', tabindex: '-1', dataset: { tw: key, kind, collapsed: 'true' } });
    w = { key, kind, id, el, open: false, slot: null, size: null };
    w.host = this.shell._host(kind, el, { id, isOpen: () => w.open && this.bench.desktop });
    el.addEventListener('pointerdown', () => this._front(w), true);
    el.addEventListener('focusin', () => this._front(w));
    el.addEventListener('pointerdown', (e) => this._drag(e, w));
    // the size the user gave it by its corner is kept (not the sizes set here: a default, a smaller browser window)
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(debounce(() => {
        if (!w.open || !w.size || el.dataset.collapsed === 'true') return;
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 100 || (Math.abs(r.width - w.size.w) <= 2 && Math.abs(r.height - w.size.h) <= 2)) return;
        w.size = { w: Math.round(r.width), h: Math.round(r.height) };
        this.setState(key, w.size);
      }, 250)).observe(el);
    }
    this.wins.set(key, w);
    this.shell.root.append(el);
    return w;
  }

  /** The title bar of a tool window, drawn with what is in it: icon, title, the panel's own buttons, Close. */
  bar(ho, def) {
    const title = this.title(ho.kind, def);
    ho.el.setAttribute('aria-label', title);
    const close = btn('', { icon: 'x', cls: 'ghost icon tiny tw-close', tip: `Close ${title}`, on: () => this.close(ho.kind, ho.id) });
    const own = ho.kind === 'panel' ? (def.headActions?.(this.app, this.shell) ?? []) : [];
    return [h('div.tw-bar', def.icon ? ic(def.icon, 'sm') : null, h('span.tw-t', title), ...own, close)];
  }

  /**
   * Open the window of panel / tab `id` (made the first time), drawn afresh, at the front. `focus`: the keyboard goes
   * to it (its search field, if it has one), unless it is in it already. Returns the window, or null for an unknown id.
   */
  open(kind, id, { focus = true } = {}) {
    if (!this._def(kind, id)) return null;
    const w = this._win(kind, id);
    const was = w.open;
    w.open = true;
    this.z = [...this.z.filter((k) => k !== w.key), w.key];
    if (this.bench.desktop && !this.shell.root.dataset.fullscreen) {
      w.el.dataset.collapsed = 'false';
      if (!was) { w.slot = null; this._place(w); }   // (a window never moved opens where there is room now)
      this.shell._render(w.host);
      this._stack();
      if (focus && !w.el.contains(document.activeElement)) {
        requestAnimationFrame(() => { if (w.open) (w.el.querySelector('input[type="search"]') ?? w.el).focus({ preventScroll: true }); });
      }
    }
    this._save();
    return w;
  }

  /** Close the window of panel / tab `id`; what it shows is drawn afresh when it opens again. */
  close(kind, id) {
    const w = this._get(kind, id);
    if (!w?.open) return;
    const had = w.el.contains(document.activeElement);
    w.open = false;
    w.el.dataset.collapsed = 'true';
    this.z = this.z.filter((k) => k !== w.key);
    this._stack();
    this._save();
    if (had) this.app.viewer?.renderer?.domElement?.focus?.({ preventScroll: true });   // the keyboard goes back to the view
  }

  /** The panel or tab of a window is gone (a plugin took it back): the window goes too. */
  forget(kind, id) {
    const w = this._get(kind, id);
    if (!w) return;
    this.close(kind, id);
    w.el.remove();
    this.wins.delete(w.key);
  }

  raise(kind, id) { const w = this._get(kind, id); if (w) this._front(w); }

  /**
   * [ and ]: close the open windows of `kind` ('panel' | 'tab'), remembered, or (none open) bring back the ones closed
   * so, else open the window of `fallback`. `open` true only opens, false only closes.
   */
  toggleKind(kind, open, fallback) {
    const shown = this.openKeys(kind);
    if (open === undefined) open = !shown.length;
    if (!open) {
      if (!shown.length) return;
      this.hidden[kind] = shown;
      for (const k of shown) { const w = this.wins.get(k); this.close(w.kind, w.id); }
      return;
    }
    if (shown.length) return;
    const back = this.hidden[kind].map((k) => this.wins.get(k)).filter((w) => w && this._def(w.kind, w.id));
    this.hidden[kind] = [];
    if (back.length) { back.forEach((w, i) => this.open(w.kind, w.id, { focus: i === back.length - 1 })); return; }
    const id = this._def(kind, fallback) ? fallback : this.shell.registries?.[kind]?.keys().next().value;
    if (id != null) this.open(kind, id);
  }

  /** At start-up: the windows that were open last time (app.prefs.openTools; before, the one panel and appearance window). */
  restore() {
    const p = this.app.prefs;
    const keys = Array.isArray(p.openTools) ? p.openTools
      : [p.twLeftOpen ? `panel:${p.leftPanel ?? 'library'}` : null, p.twInspectorOpen ? `tab:${p.inspectorTab ?? 'style'}` : null].filter(Boolean);
    for (const k of keys) {
      const i = String(k).indexOf(':');
      const kind = String(k).slice(0, i), id = String(k).slice(i + 1);
      if ((kind === 'panel' || kind === 'tab') && this._def(kind, id)) this.open(kind, id, { focus: false });
    }
  }

  /** Window › Reset Window Layout: every window back to where it opens the first time. */
  resetPlaces() { for (const w of this.wins.values()) { w.slot = null; w.size = null; } this.place(); }

  /** Show the open windows (none on phones, nor in full screen) inside the browser window; draw what was not drawn. */
  place() {
    const show = this.bench.desktop && !this.shell.root.dataset.fullscreen;
    for (const w of this.wins.values()) {
      const on = show && w.open;
      w.el.dataset.collapsed = String(!on);
      if (!on) continue;
      this._place(w);
      if (w.host.stale || !w.host.body) this.shell._render(w.host);
    }
    this._stack();
  }

  /**
   * Where it was left, else where it opens (kept while it is open), inside the browser window: all of its height,
   * below the menus and toolbars unless it was put over them (while the browser window is smaller it moves up to
   * them, then gets shorter; the place it was left is kept), and at least 80 px of its width.
   */
  _place(w) {
    const st = this.state(w.key), W = innerWidth, H = innerHeight;
    const a = st.x == null || st.y == null || st.w == null || st.h == null ? this._auto(w) : {};
    const want = { x: st.x ?? a.x ?? 40, y: st.y ?? a.y ?? 90, w: st.w ?? a.w ?? 330, h: st.h ?? a.h ?? 480 };
    const top = Math.min(st.y ?? Infinity, this.bench.work.getBoundingClientRect().top || 0);
    const width = Math.round(clampN(want.w, 240, W - 16)), height = Math.round(clampN(want.h, 160, Math.min(H - top - 4, H - 16)));
    const x = Math.round(clampN(want.x, -width + 80, W - 80)), y = Math.round(clampN(want.y, top, H - height - 4));
    w.size = { w: width, h: height };
    Object.assign(w.el.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  }

  /**
   * Where a window that was never moved goes: the panels at the left of the workspace, the appearance windows at its
   * right, below the document tabs, `w.slot` steps further in (one for each window already there when it opened).
   * It follows the workspace (the toolbars get another row, the explorers are resized).
   */
  _auto(w) {
    const R = this.bench.work.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    const top = (R.height ? R.top : 64) + 37, bottom = (R.height ? R.bottom : H - 30) - 10;   // (below the document tabs)
    const ww = w.kind === 'tab' ? 340 : 330;
    const base = { x: w.kind === 'tab' ? (R.width ? R.right : W) - ww - 12 : (R.width ? R.left : 280) + 12, y: top };
    const step = { x: w.kind === 'tab' ? -26 : 26, y: 26 };
    if (w.slot == null) {
      const taken = this.openKeys().filter((k) => k !== w.key).map((k) => {
        const o = this.wins.get(k).el;
        return { x: parseFloat(o.style.left) || 0, y: parseFloat(o.style.top) || 0 };
      });
      w.slot = Math.round((cascadeSpot(base, taken, step).y - base.y) / step.y);
    }
    const x = base.x + w.slot * step.x, y = base.y + w.slot * step.y;
    return { x, y, w: ww, h: Math.round(clampN(Math.min(640, bottom - y), 240, Math.max(240, H - 16))) };
  }

  /** Move a window by its title bar (not by its buttons and fields). */
  _drag(e, w) {
    if (e.button !== 0 || !this.bench.desktop) return;
    const bar = e.target.closest?.('.tw-bar');
    if (!bar || !w.el.contains(bar) || e.target.closest('button, input, select, textarea, a, [role="tab"]')) return;
    e.preventDefault();
    const r0 = w.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 2) return;
      moved = true;
      w.el.classList.add('moving');
      const x = clampN(r0.left + ev.clientX - x0, -r0.width + 80, innerWidth - 80);
      const y = clampN(r0.top + ev.clientY - y0, 0, innerHeight - r0.height - 4);   // (all of it stays in, as _place keeps it)
      w.el.style.left = `${Math.round(x)}px`; w.el.style.top = `${Math.round(y)}px`;
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      w.el.classList.remove('moving');
      if (!moved) return;
      const r = w.el.getBoundingClientRect();
      this.setState(w.key, { x: Math.round(r.left), y: Math.round(r.top) });   // (its size is kept only when set by the corner)
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  _front(w) {
    if (!w.open || this.z.at(-1) === w.key) return;
    this.z = [...this.z.filter((k) => k !== w.key), w.key];
    this._stack();
    this._saveSoon();
  }
  /** Back to front above the document windows (under menus and dialogs); the title of the front one is lit. */
  _stack() {
    const front = this.openKeys().at(-1);
    this.z.forEach((k, i) => { const w = this.wins.get(k); if (w) w.el.style.zIndex = String(31 + Math.min(i, 20)); });
    for (const w of this.wins.values()) w.el.dataset.front = String(w.key === front);
  }
  _save() {
    this._saveSoon.cancel();
    const keys = this.openKeys();
    if (JSON.stringify(keys) !== JSON.stringify(this.app.prefs.openTools ?? null)) this.app.setPref('openTools', keys);
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
    this.statusline = h('footer.statusline');
    root.append(this.dock, this.vsplit, this.work, this.statusline);
    this.mdi = new MDI(this);
    this.tools = new ToolWindows(this);   // the panels and the appearance tabs, each in a window of its own
    // the empty state and the drop zone cover the workspace, not one window
    this.work.append(shell.empty, shell.drop);
    this._buildStatus();
    this._splitters();
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

  // ---------------------------------------------------------------- placing what depends on the layout
  /** Place what depends on the layout: the tool windows and floating toolbars (desktops), the status bar. */
  place() {
    const sh = this.shell, root = sh.root, desk = this.desktop && !root.dataset.fullscreen;
    if (this.desktop || sh.leftOpen || sh.inspectorOpen) this.dock.dataset.sheet = '';
    this.tools.place();
    this._placeFloats();
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

  /**
   * A toolbar: its grip (drag it to another place or row of the strip, or off it to float; double-click floats it),
   * then its buttons. View › Toolbars shows and hides it.
   */
  _band(id, label, ...children) {
    const grip = h('span.tb-grip', { 'aria-hidden': 'true', 'data-tip': `${label} toolbar: drag the grip to move it, double-click it to float it` });
    grip.addEventListener('pointerdown', (e) => this._dragToolbar(e, id));
    grip.addEventListener('dblclick', () => this.floatToolbar(id));
    return h('div.tband', { role: 'group', 'aria-label': label, dataset: { band: id } }, grip, ...children);
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
    this._rows = [];           // the rows of the strip, top to bottom
    this._floats = new Map();  // toolbar id → its floating window
    sh.strip.classList.add('toolbars');
    // a right-click on the toolbars lists them to show or hide, as in Materials Studio (also View › Toolbars)
    sh.strip.addEventListener('contextmenu', (e) => {
      if (!this.desktop) return;
      e.preventDefault();
      this.toolbarMenu({ x: e.clientX, y: e.clientY });
    });
    this.applyToolbarLayout();
  }

  /** One check item per toolbar (View › Toolbars, the toolbars' right-click menu). */
  toolbarItems() {
    return TOOLBARS.map(([id, label]) => ({ label, checked: this.toolbarOn(id), run: () => this.setToolbar(id) }));
  }
  /** The toolbars to show or hide, and Reset Toolbars (View › Toolbars, a right-click on a toolbar). */
  toolbarMenuItems() {
    return [...this.toolbarItems(), { separator: true }, { label: 'Reset Toolbars', icon: 'reset', tip: 'Every toolbar back in its place on one row, Measure hidden', run: () => this.resetToolbars() }];
  }
  toolbarMenu(at) { showMenu(at, [{ header: 'Toolbars' }, ...this.toolbarMenuItems()], { label: 'Toolbars' }); }

  /** Whether toolbar `id` is shown: as View › Toolbars set it, else as TOOLBAR_DEFAULTS says (Animation: with a trajectory). */
  toolbarOn(id) {
    const v = (this.app.prefs.toolbars ?? {})[id];
    if (typeof v === 'boolean') return v;
    return TOOLBAR_DEFAULTS[id]?.(this.app) ?? true;
  }
  setToolbar(id, on = !this.toolbarOn(id)) {
    this.app.setPref('toolbars', { ...(this.app.prefs.toolbars ?? {}), [id]: !!on });
    this.applyToolbars();
    if (on) this._placeFloats();   // a floating one shows where it was
  }
  /**
   * Show the toolbars that are on (again whenever the active document changes: Animation follows it), the rows with
   * one, the floating windows of those; the view is resized when the strip changes.
   */
  applyToolbars() {
    let changed = false;
    for (const [id, el] of Object.entries(this.bands ?? {})) {
      const hide = !this.toolbarOn(id);
      if (el.hidden !== hide) { el.hidden = hide; changed = true; }
    }
    for (const row of this._rows ?? []) {
      const empty = ![...row.children].some((b) => !b.hidden);
      if (row.hidden !== empty) { row.hidden = empty; changed = true; }
    }
    for (const [id, f] of this._floats ?? []) f.el.hidden = !!this.bands[id]?.hidden;
    if (changed) requestAnimationFrame(() => this.app.viewer.resize());
  }

  /** Where the toolbars are: app.prefs.toolbarLayout, made whole (normalizeToolbarLayout). */
  toolbarLayout() { return normalizeToolbarLayout(this.app.prefs.toolbarLayout); }

  /** Put every toolbar where the layout says: in its row of the strip (rows top to bottom), or floating. */
  applyToolbarLayout() {
    const L = this.toolbarLayout(), strip = this.shell.strip;
    // nodes move only when their place changes (a button that moves loses the focus)
    const rows = L.rows.map((ids, i) => {
      const row = this._rows[i] ?? h('div.tbrow');
      row.dataset.row = String(i);
      const want = ids.map((id) => this.bands[id]);
      if (want.length !== row.children.length || want.some((b, j) => row.children[j] !== b)) row.replaceChildren(...want);
      return row;
    });
    this._rows = rows;
    if (rows.length !== strip.children.length || rows.some((r, i) => strip.children[i] !== r)) strip.replaceChildren(...rows);
    for (const id of Object.keys(this.bands)) {
      const p = L.float[id];
      let f = this._floats.get(id);
      if (!p) { if (f) { f.el.remove(); this._floats.delete(id); } continue; }
      f ??= this._floatBox(id);
      if (this.bands[id].parentNode !== f.body) f.body.append(this.bands[id]);
      if (!f.el.isConnected) this.shell.root.append(f.el);
      f.pos = { x: p.x, y: p.y };
    }
    this.applyToolbars();
    this._placeFloats();
  }

  /**
   * The window of a floating toolbar: its name (drag it to move the toolbar, onto the strip to dock it again;
   * double-click it to dock it where it was) and a button that hides it.
   */
  _floatBox(id) {
    const label = TOOLBARS.find(([x]) => x === id)?.[1] ?? id;
    const close = h('button.tbf-x', { type: 'button', 'aria-label': `Hide the ${label} toolbar`, 'data-tip': 'Hide this toolbar (View › Toolbars shows it again)' }, ic('x', 'sm'));
    const head = h('div.tbf-head', { 'data-tip': 'Drag to move it, onto the toolbars to dock it; double-click to dock it' }, h('span', label), close);
    const body = h('div.tbf-body');
    const el = h('div.tbfloat.toolbars', { role: 'toolbar', 'aria-label': `${label} toolbar`, dataset: { band: id } }, head, body);
    close.addEventListener('click', () => this.setToolbar(id, false));
    head.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) this._dragToolbar(e, id); });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) this.dockToolbar(id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.toolbarMenu({ x: e.clientX, y: e.clientY }); });
    const f = { id, el, head, body, pos: null };
    this._floats.set(id, f);
    return f;
  }

  /** The floating toolbars where they were put, kept inside the browser window. */
  _placeFloats() {
    for (const f of this._floats?.values() ?? []) {
      if (!f.pos || f.el.hidden) continue;
      const r = f.el.getBoundingClientRect();
      const x = clampN(f.pos.x, -(r.width || 120) + 40, innerWidth - 40), y = clampN(f.pos.y, 0, innerHeight - 24);
      f.el.style.left = `${Math.round(x)}px`; f.el.style.top = `${Math.round(y)}px`;
    }
  }

  /** Move toolbar `id` `to` a place (moveToolbar), keep the layout, show it. */
  moveToolbarTo(id, to) {
    const L0 = this.toolbarLayout(), L = moveToolbar(L0, id, to);
    if (JSON.stringify(L) === JSON.stringify(L0)) return;
    this.app.setPref('toolbarLayout', L);
    this.applyToolbarLayout();
    requestAnimationFrame(() => this.app.viewer.resize());
  }
  /** Float toolbar `id` just below where it is docked (a double-click on its grip). */
  floatToolbar(id) {
    const r = this.bands[id]?.getBoundingClientRect();
    if (r) this.moveToolbarTo(id, { float: true, x: r.left, y: r.bottom + 10 });
  }
  /** Dock floating toolbar `id` where it was before it floated, else at the end of the last row. */
  dockToolbar(id) {
    const L = this.toolbarLayout(), from = L.float[id]?.from, n = L.rows.length;
    this.moveToolbarTo(id, from && from.row < n ? { row: from.row, before: from.before } : from ? { row: n, newRow: true } : { row: n - 1, before: null });
  }
  /** View › Toolbars › Reset Toolbars: every toolbar docked in its first place, shown or hidden as at the start. */
  resetToolbars() {
    delete this.app.prefs.toolbarLayout;
    this.app.setPref('toolbars', {});
    this.applyToolbarLayout();
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  /**
   * Move toolbar `id` with the pointer, by its grip or the title of its floating window, as toolbars move in
   * Materials Studio: along a row or into another one (a bar marks the place), between two rows or below the last
   * (a line marks the new row), or anywhere else to float it there. Escape cancels.
   */
  _dragToolbar(e, id) {
    if (e.button !== 0 || !this.desktop) return;
    e.preventDefault();
    const band = this.bands[id], f = this._floats.get(id);
    const r0 = (f?.el ?? band).getBoundingClientRect(), br = band.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, gx = x0 - r0.left, gy = y0 - r0.top;   // where the pointer holds it
    const headH = f ? f.head.getBoundingClientRect().height : 19;
    const frame = h('div.tb-frame', { 'aria-hidden': 'true' }), mark = h('div.tb-mark', { 'aria-hidden': 'true', hidden: true });
    let started = false, drop = null, over = false;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        started = true;
        document.body.append(frame, mark);
        document.documentElement.classList.add('tb-dragging');
        band.classList.add('moving');
      }
      drop = this._toolbarDrop(id, ev.clientX, ev.clientY);
      // the outline: the toolbar's size docked, its window's size floating
      const fl = !!drop.float;
      Object.assign(frame.style, { left: `${ev.clientX - gx}px`, top: `${ev.clientY - gy}px`, width: `${br.width + (fl ? 6 : 0)}px`, height: `${br.height + (fl ? headH + 4 : 0)}px` });
      frame.dataset.float = String(fl);
      mark.hidden = !drop.mark;
      if (drop.mark) Object.assign(mark.style, drop.mark);
    };
    const end = (ev, apply) => {
      if (over) return;
      over = true;
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); removeEventListener('keydown', key, true);
      frame.remove(); mark.remove();
      document.documentElement.classList.remove('tb-dragging');
      band.classList.remove('moving');
      if (apply && started && drop) this.moveToolbarTo(id, drop.float ? { float: true, x: ev.clientX - gx, y: ev.clientY - gy } : drop);
    };
    const up = (ev) => end(ev, true);
    const cancel = (ev) => end(ev, false);
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(ev, false); } };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', cancel); addEventListener('keydown', key, true);
  }

  /**
   * Where toolbar `id` goes when dropped at (x, y): {row, before} into a row of the strip, {row, newRow} as a new row
   * there, or {float} away from the strip; with `mark`, the style of the bar that shows the place.
   */
  _toolbarDrop(id, x, y) {
    const S = this.shell.strip.getBoundingClientRect();
    if (x < S.left - 6 || x > S.right + 6 || y < S.top - 12 || y > S.bottom + 16) return { float: true };
    const line = (at) => ({ left: `${Math.round(S.left + 2)}px`, top: `${Math.round(at) - 1}px`, width: `${Math.round(S.width - 4)}px`, height: '3px' });
    const rows = this._rows.filter((r) => !r.hidden && r.isConnected).map((r) => ({ i: +r.dataset.row, el: r, rc: r.getBoundingClientRect() }));
    if (!rows.length) return { row: 0, newRow: true, mark: line(S.top + 2) };
    const edge = 5, last = rows.at(-1);
    // above the first row, between two rows, below the last: a row of its own there
    if (y < rows[0].rc.top + edge) return { row: rows[0].i, newRow: true, mark: line(rows[0].rc.top) };
    for (let k = 0; k < rows.length - 1; k++) {
      const b = (rows[k].rc.bottom + rows[k + 1].rc.top) / 2;
      if (Math.abs(y - b) <= edge) return { row: rows[k + 1].i, newRow: true, mark: line(b) };
    }
    if (y > last.rc.bottom - edge) return { row: last.i + 1, newRow: true, mark: line(last.rc.bottom) };
    // in the row under the pointer, before the first toolbar whose middle is past it (a row may wrap to more lines)
    const row = rows.find((r) => y >= r.rc.top && y <= r.rc.bottom) ?? last;
    const bands = [...row.el.children].filter((b) => b !== this.bands[id] && !b.hidden).map((b) => ({ id: b.dataset.band, rc: b.getBoundingClientRect() }));
    const next = bands.find((b) => y < b.rc.top || (y < b.rc.bottom && x < b.rc.left + b.rc.width / 2));
    const ref = next ?? bands.at(-1);
    const mx = next ? next.rc.left - 2 : ref ? ref.rc.right : row.rc.left + 2;
    const rc = ref?.rc ?? row.rc;
    return { row: row.i, before: next?.id ?? null, mark: { left: `${Math.round(mx - 1)}px`, top: `${Math.round(rc.top)}px`, width: '3px', height: `${Math.round(rc.height)}px` } };
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
    this.applyToolbars();   // Animation follows the active document
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
