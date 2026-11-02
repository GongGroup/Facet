/** Application shell: top bar, rail, drawer, inspector, viewport overlays, shortcuts, palette and tour. */
import { h, ic, btn } from './dom.js';
import { LOGO } from './icons.js';
import { toast, showMenu, closeMenu, menuOpen, dialog, openModal, modalOpen, installTooltips, confirmDialog } from './overlays.js';
import { commands } from '../core/commands.js';
import { relativeTime, debounce } from '../core/util.js';
import { element } from '../core/elements.js';
import { elementColorHex } from '../render/colors.js';
import { formats } from '../io/index.js';
import { samples } from '../build/samples.js';
import { VERSION } from '../app.js';
import { keyLabel, matchKey, parseKey, hasMod, isMac, MOD, ALT } from './keys.js';
import { canDownload, NO_DOWNLOADS } from '../storage/files.js';
import { SelectionCard, selectSameElement, selectNeighbours, selectFragment, selectAll, measureFrom } from './selectioncard.js';

export const leftPanels = new Map();
export const inspectorTabs = new Map();
let current = null;   // the Shell once built: panels registered later (plugins) are added to it right away

/** Register a left-drawer panel {id, title, icon, tip, render(app, el, shell), headActions?, refreshOn?, signature?}. */
export function registerLeftPanel(p) {
  leftPanels.set(p.id, p);
  current?.renderRail();
  return () => {
    leftPanels.delete(p.id);
    if (!current) return;
    current.renderRail();
    if (current.leftId === p.id) { current.leftId = leftPanels.keys().next().value; current.renderDrawer(); }
  };
}
/** Register an inspector tab {id, title, icon, tip, render(app, el, shell)}. */
export function registerInspectorTab(t) {
  inspectorTabs.set(t.id, t);
  current?.renderInspector();
  return () => { inspectorTabs.delete(t.id); current?.renderInspector(); };
}

const TEXT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', 'time', 'datetime-local', 'month', 'week']);
/** True for controls that take typed text (where single-key shortcuts must not fire). */
export function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TEXT_TYPES.has(el.type);
}
/** Controls that use Space, Enter or the arrow keys themselves. */
const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="slider"], input[type="range"], input[type="checkbox"], input[type="radio"], input[type="color"], input[type="button"], input[type="submit"]';
const NAV_KEYS = new Set([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/** Commands whose shortcuts work while the tour is open: panels, representations, view and panel toggles. */
const TOUR_SAFE = /^(panel|rep|view)\.|^ui\.(left|right)$/;
const isMobile = () => matchMedia('(max-width: 920px)').matches;
/** Narrowest 3D view (px) kept beside both side panels; in a narrower desktop window they open one at a time. */
const MIN_STAGE = 600;
/** Space (px) a fitted model keeps clear on each side: the view toolbar on the right, the status pills below (less on phones). */
const fitMargins = () => (isMobile() ? { x: 30, y: 24 } : { x: 58, y: 30 });
const isTouch = () => matchMedia('(pointer: coarse)').matches;
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export function formulaHTML(f) { return String(f).replace(/(\d+)/g, '<sub>$1</sub>'); }
/** A formula as a span with subscript counts, built from DOM nodes (safe for formulas read from storage). */
export function formulaEl(f) {
  return h('span.fml', String(f ?? '').split(/(\d+)/).filter(Boolean).map((t) => (/^\d+$/.test(t) ? h('sub', t) : t)));
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Palette ranking: title prefix/substring, then all words as word prefixes; subsequence only as a last resort. */
export function rankCommands(list, query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return list.slice();
  const words = q.split(/\s+/);
  const split = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const prefixes = (ws, pool) => ws.every((w) => pool.some((t) => t.startsWith(w)));
  const scored = [];
  list.forEach((c, order) => {
    const title = c.title.toLowerCase(), tw = split(c.title), cw = split(c.category), kw = split(c.keywords);
    let s = 0;
    if (title.startsWith(q)) s = 1000;
    else if (tw.some((_, i) => tw.slice(i).join(' ').startsWith(q))) s = 900;
    else if (title.includes(q)) s = 800;
    else if (prefixes(words, tw)) s = 700;
    else if (prefixes(words, [...tw, ...cw])) s = 600;
    else if (words.every((w) => w.length >= 3) && prefixes(words, [...tw, ...cw, ...kw])) s = 400;
    if (s) scored.push([s, c.title.length, order, c]);
  });
  if (!scored.length) {
    // nothing matched as words: fall back to letters in order within the category and title (never keywords)
    list.forEach((c, order) => {
      const t = `${c.category ?? ''} ${c.title}`.toLowerCase();
      let i = 0, gaps = 0;
      for (const ch of q.replace(/\s+/g, '')) { const j = t.indexOf(ch, i); if (j < 0) { i = -1; break; } gaps += j - i; i = j + 1; }
      if (i >= 0) scored.push([100 - Math.min(99, gaps), c.title.length, order, c]);
    });
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]).map((x) => x[3]);
}

const CATEGORY_ORDER = ['File', 'Edit', 'View', 'Tools', 'Window', 'Export', 'Look', 'Representation', 'Lighting', 'Colours', 'Effects', 'Sample', 'Trajectory', 'Help'];
const catRank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 100 : i; };
const byCategory = (a, b) => catRank(a) - catRank(b) || String(a).localeCompare(String(b));

/** Label for several shortcuts shown as one row: 'A B C', '1 – 7' or 'Shift 1 – 4'. */
function groupLabel(specs) {
  const parsed = specs.map((s) => parseKey(Array.isArray(s) ? s[0] : s));
  const digits = parsed.map((p) => p.key);
  const sameMods = parsed.every((p) => [...p.mods].join() === [...parsed[0].mods].join());
  if (sameMods && digits.length > 2 && digits.every((d, i) => /^\d$/.test(d) && (i === 0 || +d === +digits[i - 1] + 1))) {
    const prefix = keyLabel([...parsed[0].mods, digits[0]].join('+')).slice(0, -1);
    return `${prefix}${digits[0]} – ${digits.at(-1)}`;
  }
  return specs.map((s) => keyLabel(Array.isArray(s) ? s[0] : s)).join(' ');
}

/** Reader error without the generic "could not tell the format" lead-in. */
const pasteReason = (e) => String(e?.message ?? e).replace(/^Could not tell the format of "[^"]*"\.\s*/, '').replace(/\.$/, '');

const ident = (el) => (el.dataset?.key ? `k:${el.dataset.key}` : `${el.tagName}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 60)}`);

export class Shell {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    const mobile = isMobile();
    this.leftId = app.prefs.leftPanel ?? 'library';
    this.leftOpen = mobile ? false : (app.prefs.leftOpen ?? true);
    this.tabId = app.prefs.inspectorTab ?? 'style';
    this.inspectorOpen = mobile ? false : (app.prefs.inspectorOpen ?? true);
    this._lastPanel = app.prefs.lastPanel === 'left' ? 'left' : 'inspector';   // kept when only one panel fits
    this._autoHidden = null;   // 'left' | 'inspector': closed only to make room (the saved layout still has it open)
    this._fitPanels();
    this._drawerScroll = {};
    this._inspectorScroll = {};
    this.build();
    current = this;
    installTooltips(document.body);
    this.bindShortcuts();
    this.bindDrop();
    this.bindApp();
    this.bindViewer();
    // crossing the phone breakpoint: sheets close; back on desktop the saved panel layout returns
    matchMedia('(max-width: 920px)').addEventListener?.('change', (e) => {
      this._autoHidden = null;
      app.viewer.fitMargins = fitMargins();
      if (e.matches) { this.leftOpen = false; this.inspectorOpen = false; }
      else { this.leftOpen = app.prefs.leftOpen ?? true; this.inspectorOpen = app.prefs.inspectorOpen ?? true; this._fitPanels(); this.renderDrawer(); }
      this.syncPanels();
    });
    // a desktop window resized past the point where both panels fit: one closes, and returns when there is room again
    addEventListener('resize', () => {
      const back = this._autoHidden;
      if (!this._fitPanels()) return;
      if (back === 'left' && this.leftOpen) this.renderDrawer();
      else if (back === 'inspector' && this.inspectorOpen) this.renderInspector();
      this.syncPanels();
    });
    app.viewer.fitMargins = fitMargins();
  }

  /** Width (px) the 3D view would get with both side panels open. */
  _roomWithBoth() {
    const cs = getComputedStyle(document.documentElement);
    const px = (name, d) => parseFloat(cs.getPropertyValue(name)) || d;
    return innerWidth - px('--rail', 56) - px('--drawer', 312) - px('--inspector', 320);
  }
  /** True in a desktop window too narrow for both side panels beside a usable 3D view. */
  _tight() { return !isMobile() && this._roomWithBoth() < MIN_STAGE; }
  /**
   * Keep the desktop layout usable: when both panels are open and do not fit, close the one used less
   * recently; when there is room again, reopen it. Returns true when a panel was opened or closed.
   */
  _fitPanels() {
    if (isMobile()) { this._autoHidden = null; return false; }
    const tight = this._tight();
    if (tight && this.leftOpen && this.inspectorOpen) {
      this._autoHidden = this._lastPanel === 'left' ? 'inspector' : 'left';
      if (this._autoHidden === 'left') this.leftOpen = false; else this.inspectorOpen = false;
      return true;
    }
    if (!tight && this._autoHidden) {
      const back = this._autoHidden;
      this._autoHidden = null;
      if (back === 'left' && !this.leftOpen) { this.leftOpen = true; return true; }
      if (back === 'inspector' && !this.inspectorOpen) { this.inspectorOpen = true; return true; }
    }
    return false;
  }
  /** A panel was opened: remember it, and in a narrow window let it take the other panel's place (`quiet`: no tip). */
  _opened(which, quiet = false) {
    this._lastPanel = which;
    if (this.app.prefs.lastPanel !== which) this.app.setPref('lastPanel', which);
    if (this._autoHidden === which) this._autoHidden = null;
    if (!this._fitPanels() || this._tightHinted || quiet) return;
    this._tightHinted = true;
    toast(isTouch() ? 'This screen has room for one side panel at a time. Tap a panel button to switch.'
      : `The window is narrow, so the side panels take turns. Widen it to see both, or press ${which === 'left' ? ']' : '['} to switch.`);
  }

  // ------------------------------------------------------------------ layout
  build() {
    const app = this.app;
    this.titleInput = h('input', { id: 'project-name', value: app.project.name, 'aria-label': 'Project name', spellcheck: false, 'data-tip': 'Click to rename the project' });
    this.titleInput.addEventListener('change', () => app.rename(this.titleInput.value.trim()));
    this.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.titleInput.blur(); if (e.key === 'Escape') { this.titleInput.value = app.project.name; this.titleInput.blur(); } });
    this.saveChip = h('button.save-chip', { type: 'button', 'data-state': 'idle', 'aria-haspopup': 'menu' }, h('span.dot'), h('span.lbl', 'Not saved yet'));
    this.saveChip.addEventListener('click', () => this.saveMenu(this.saveChip));
    this.undoBtn = btn('', { icon: 'undo', cls: 'ghost icon', tip: 'Undo', kbd: keyLabel('mod+z'), on: () => app.undo() });
    this.redoBtn = btn('', { icon: 'redo', cls: 'ghost icon', tip: 'Redo', kbd: keyLabel('mod+shift+z'), on: () => app.redo() });
    const openBtn = btn('Open', { icon: 'open', cls: 'ghost desktop-only', tip: 'Open structure or project files (CIF, POSCAR, XYZ, PDB, JSON)', kbd: keyLabel('mod+o'), on: () => commands.run('file.open') });
    const saveBtn = btn('Save', { icon: 'save', cls: 'ghost', tip: 'Save the project', kbd: keyLabel('mod+s'), on: (e) => this.saveMenu(e.currentTarget) });
    this.exportBtn = btn('Export', { icon: 'download', cls: 'primary export', tip: 'Export an image, 3D model or structure file', on: (e) => this.exportMenu(e.currentTarget) });
    const paletteBtn = btn('', { icon: 'command', cls: 'ghost icon desktop-only', tip: 'Command palette — find any action', kbd: keyLabel('mod+k'), on: () => this.openPalette() });
    const helpBtn = btn('', { icon: 'help', cls: 'ghost icon', tip: 'Help, shortcuts and tour', kbd: '?', on: (e) => this.helpMenu(e.currentTarget) });
    this.themeBtn = btn('', { icon: 'moon', cls: 'ghost icon desktop-only', tip: 'Switch light / dark interface', on: () => this.cycleTheme() });
    const moreBtn = btn('', { icon: 'more', cls: 'ghost icon mobile-only', tip: 'More', on: (e) => this.moreMenu(e.currentTarget) });
    this.userSlot = h('span.user-slot');
    this.top = h('header.topbar',
      h('div.brand', { html: LOGO }, h('span.name', 'Crystallume'), h('span.ver', `v${VERSION}`)),
      h('div.proj-title', this.titleInput, this.saveChip),
      h('div.top-actions', this.undoBtn, this.redoBtn, h('span.sep.desktop-only'), openBtn, saveBtn, this.exportBtn, h('span.sep.desktop-only'), this.userSlot, paletteBtn, helpBtn, this.themeBtn, moreBtn),
    );

    this.rail = h('nav.rail', { 'aria-label': 'Panels' });
    this.drawer = h('aside.drawer', { 'aria-label': 'Side panel' });
    this.inspector = h('aside.inspector', { 'aria-label': 'Appearance' });
    this.viewport = this.root.querySelector('.viewport');
    this.stage = this.root.querySelector('.stage');
    this.root.prepend(this.top);
    this.root.append(this.rail, this.drawer, this.inspector);
    this.buildOverlays();
    this.renderRail();
    this.renderDrawer();
    this.renderInspector();
    this.applyTheme(this.app.prefs.theme ?? 'system');
    this.syncDownloads();
    // a re-render waiting for the user to leave a text field runs when they do
    this._pointerDown = false;
    addEventListener('pointerdown', () => { this._pointerDown = true; }, true);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { this._pointerDown = false; }, true);
    this.drawer.addEventListener('focusout', () => this._flushLater('drawer'));
    this.inspector.addEventListener('focusout', () => this._flushLater('inspector'));
    // a field that loses focus (Tab, click elsewhere) fires 'change' while the focus is between elements;
    // rebuilding the panel right then would drop the focus on <body>, so such a re-render waits for it to land
    this._changeIn = null;
    for (const box of [this.drawer, this.inspector]) {
      box.addEventListener('change', () => { this._changeIn = box; setTimeout(() => { if (this._changeIn === box) this._changeIn = null; }, 0); }, true);
    }
  }

  /** Rebuild the rail buttons from the registered panels (plugins may add panels after start-up). */
  renderRail() {
    const had = document.activeElement?.closest?.('.rail button')?.dataset.panel;
    this.rail.replaceChildren();
    for (const p of leftPanels.values()) {
      const key = commands.get(`panel.${p.id}`)?.key ?? p.kbd ?? null;
      const b = h('button', { type: 'button', 'aria-label': p.title, 'aria-pressed': String(this.leftOpen && this.leftId === p.id), 'data-tip': p.tip ?? p.title, 'data-kbd': key ? keyLabel(key) : null, dataset: { panel: p.id } },
        ic(p.icon), h('span.lbl', { 'aria-hidden': 'true' }, p.short ?? p.title));
      b.addEventListener('click', () => this.toggleLeft(p.id));
      this.rail.append(b);
    }
    this.rail.append(h('div.spacer'));
    const appear = h('button.mobile-only', { type: 'button', 'aria-label': 'Appearance', 'data-tip': 'Looks, lighting, effects', dataset: { panel: '__inspector' } }, ic('style'), h('span.lbl', { 'aria-hidden': 'true' }, 'Appearance'));
    appear.addEventListener('click', () => this.toggleInspector());
    this.rail.append(appear);
    if (had) this.rail.querySelector(`[data-panel="${CSS.escape(had)}"]`)?.focus();
    this.syncPanels();
  }
  buildRail() { this.renderRail(); }

  toggleLeft(id) {
    if (this.leftOpen && this.leftId === id) { this.leftOpen = false; this._autoHidden = null; }   // closing the only panel: a clear view is wanted
    else { this.leftOpen = true; this.leftId = id ?? this.leftId; if (isMobile()) this.inspectorOpen = false; else this._opened('left'); }
    this.app.setPref('leftPanel', this.leftId);
    this.syncPanels();
    this.renderDrawer();
  }

  /** Open a left panel. `args` are handed once to its render through panelArgs(), e.g. {provider: 'server'} for Projects. */
  openLeft(id, args) { this._panelArgs = args ? { id, args } : null; this.leftOpen = false; this.toggleLeft(id); }
  /** The args openLeft() passed for panel `id`, or null; each set is read once. */
  panelArgs(id) { const a = this._panelArgs; if (a?.id !== id) return null; this._panelArgs = null; return a.args; }
  /** Projects panel on the server's sign-in form (or project list once signed in). */
  openSignIn() { this.openLeft('projects', { provider: 'server' }); }

  /** Show or hide the appearance panel (on phones the sheets are exclusive). */
  toggleInspector(open = !this.inspectorOpen) {
    const was = this.inspectorOpen;
    this.inspectorOpen = open;
    if (open && isMobile()) this.leftOpen = false;
    else if (open && !was) this._opened('inspector');
    else if (!open && was) this._autoHidden = null;
    this.syncPanels();
    if (open) this.renderInspector();
  }
  openInspector(tab) { if (tab) { this.tabId = tab; this.app.setPref('inspectorTab', tab); } this.toggleInspector(true); }
  /** Close the drawer and inspector sheets (phones). */
  closeSheets() { this.leftOpen = false; this.inspectorOpen = false; this.syncPanels(); }

  syncPanels() {
    this.drawer.dataset.collapsed = String(!this.leftOpen);
    this.inspector.dataset.collapsed = String(!this.inspectorOpen);
    this.rail.querySelectorAll('button[data-panel]').forEach((b) => {
      const id = b.dataset.panel;
      b.setAttribute('aria-pressed', String(id === '__inspector' ? this.inspectorOpen : this.leftOpen && this.leftId === id));
    });
    if (this.revealBtn) this.revealBtn.hidden = this.inspectorOpen;
    if (!isMobile()) {
      // a panel closed only to make room stays open in the saved layout
      const insp = this.inspectorOpen || this._autoHidden === 'inspector', left = this.leftOpen || this._autoHidden === 'left';
      if (this.app.prefs.inspectorOpen !== insp) this.app.setPref('inspectorOpen', insp);
      if (this.app.prefs.leftOpen !== left) this.app.setPref('leftOpen', left);
    }
    if (this.leftOpen && this._drawerStale) { this._drawerStale = false; this._refreshDrawerSoon?.(); }
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  // ------------------------------------------------------------------ panel rendering (keeps focus, typing and scroll)
  _captureFocus(container) {
    const a = document.activeElement;
    if (!a || a === document.body || a === container || !container.contains(a)) return null;
    const id = ident(a);
    const same = [...container.querySelectorAll(a.tagName)].filter((x) => ident(x) === id);
    return { id, tag: a.tagName, nth: Math.max(0, same.indexOf(a)), sel: typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null };
  }
  _restoreFocus(container, f) {
    if (!f || (document.activeElement && document.activeElement !== document.body && !container.contains(document.activeElement))) return;
    const same = [...container.querySelectorAll(f.tag)].filter((x) => ident(x) === f.id);
    const el = same[Math.min(f.nth, same.length - 1)];
    if (!el) return;
    el.focus({ preventScroll: true });
    if (f.sel) { try { el.setSelectionRange(...f.sel); } catch { /* not a text input */ } }
  }
  /** True while the user types in a field of `container` (a select's change is a finished choice, so not one). */
  _typingIn(container) { const a = document.activeElement; return !!a && container.contains(a) && isTextField(a) && a.tagName !== 'SELECT'; }
  /** True while a field in `container` that just changed is handing the focus to the next control. */
  _focusMoving(container) { const a = document.activeElement; return this._changeIn === container && (!a || a === document.body); }
  /** Defer a re-render of `which` until the user leaves the field they are typing in (or the focus has moved). */
  _deferRender(which) {
    const box = which === 'drawer' ? this.drawer : this.inspector;
    if (!this._typingIn(box) && !this._focusMoving(box)) return false;
    this[which === 'drawer' ? '_drawerPending' : '_inspectorPending'] = true;
    if (this._focusMoving(box)) setTimeout(() => this._flushLater(which), 0);   // in case no focusout follows
    return true;
  }
  _flushLater(which) {
    const pending = which === 'drawer' ? '_drawerPending' : '_inspectorPending';
    if (!this[pending]) return;
    const run = () => setTimeout(() => {
      const box = which === 'drawer' ? this.drawer : this.inspector;
      if (!this[pending] || this._typingIn(box)) return;
      this[pending] = false;
      if (which === 'drawer') this.renderDrawer(); else this.renderInspector();
    }, 0);
    // wait for the click that moved focus (e.g. on "Apply") to land before the panel is rebuilt
    if (this._pointerDown) addEventListener('pointerup', run, { once: true, capture: true }); else run();
  }

  renderDrawer() {
    const p = leftPanels.get(this.leftId) ?? leftPanels.values().next().value;
    if (!p) return;
    this.leftId = p.id;
    const focus = this._captureFocus(this.drawer);
    if (this.drawerBody && this._drawerPanel) this._drawerScroll[this._drawerPanel] = this.drawerBody.scrollTop;
    this.drawer.replaceChildren();
    const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close panel', on: () => { this.leftOpen = false; this.syncPanels(); } });
    const head = h('div.panel-head', h('h2', p.title), ...(p.headActions?.(this.app, this) ?? []), close);
    const body = h('div.panel-body');
    this.drawer.setAttribute('aria-label', p.title);
    this.drawer.append(head, body);
    this.drawerBody = body;
    this._drawerPanel = p.id;
    // this render shows the current state, so a refresh queued before it (e.g. by the event that caused it) is
    // done; left queued it would rebuild the panel again later, under a click on the freshly drawn controls
    this._refreshDrawerSoon?.cancel?.();
    this._drawerPending = false;
    this._drawerStale = false;
    try { p.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This panel failed to load: ${e.message}`)); }
    try { this._drawerSig = p.signature?.(this.app); } catch { this._drawerSig = undefined; }
    const y = this._drawerScroll[p.id] ?? 0;
    body.scrollTop = y;
    if (y && body.scrollTop < y) requestAnimationFrame(() => { if (this.drawerBody === body) body.scrollTop = y; });
    body.addEventListener('scroll', () => { this._drawerScroll[p.id] = body.scrollTop; }, { passive: true });
    this._restoreFocus(this.drawer, focus);
    this.syncPanels();
  }

  /**
   * Re-render the drawer after an app event. A panel may declare `refreshOn: ['project', …]` and a
   * `signature(app)` string; it is skipped when the signature did not change. While the user types in
   * the drawer the refresh waits until they leave the field.
   */
  refreshDrawer(reason) {
    const p = leftPanels.get(this.leftId);
    if (!p) return;
    const legacy = { project: null, structure: ['structure', 'build'], selection: ['structure'], measure: ['structure'], providers: ['projects'], auth: ['projects'] };
    const want = Array.isArray(p.refreshOn) ? p.refreshOn.includes(reason) : (legacy[reason] === null || !!legacy[reason]?.includes(p.id));
    if (!want) return;
    if (typeof p.signature === 'function') { let sig; try { sig = p.signature(this.app); } catch { sig = NaN; } if (sig === this._drawerSig) return; }
    if (!this.leftOpen) { this._drawerStale = true; return; }
    if (this._deferRender('drawer')) return;
    this._refreshDrawerSoon();
  }

  renderInspector() {
    const tabs = [...inspectorTabs.values()];
    if (!tabs.length) return;
    const t = inspectorTabs.get(this.tabId) ?? tabs[0];
    this.tabId = t.id;
    const focus = this._captureFocus(this.inspector);
    if (this.inspectorBody && this._inspectorTab) this._inspectorScroll[this._inspectorTab] = this.inspectorBody.scrollTop;
    this.inspector.replaceChildren();
    const tabBar = h('div.tabs', { role: 'tablist', 'aria-label': 'Appearance' });
    for (const x of tabs) {
      const on = x.id === t.id;
      const b = h('button', { type: 'button', role: 'tab', id: `itab-${x.id}`, 'aria-selected': String(on), 'aria-controls': 'inspector-panel', tabindex: on ? '0' : '-1', 'data-key': `tab:${x.id}`, 'data-tip': x.tip ?? null }, ic(x.icon, 'sm'), h('span', x.title));
      b.addEventListener('click', () => this.selectTab(x.id));
      tabBar.append(b);
    }
    tabBar.addEventListener('keydown', (e) => {
      const i = tabs.findIndex((x) => x.id === this.tabId);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      const next = tabs[(j + tabs.length) % tabs.length];
      this.selectTab(next.id);
      this.inspector.querySelector(`[data-key="tab:${CSS.escape(next.id)}"]`)?.focus();
    });
    const hide = btn('', { icon: 'panel-right', cls: 'ghost icon desktop-only hide-insp', tip: 'Hide appearance panel', kbd: keyLabel(']'), on: () => this.toggleInspector(false) });
    const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close', on: () => this.toggleInspector(false) });
    const body = h('div.panel-body', { role: 'tabpanel', id: 'inspector-panel', 'aria-labelledby': `itab-${t.id}` });
    this.inspector.append(h('div.insp-head', tabBar, hide, close), body);
    this.inspectorBody = body;
    this._inspectorTab = t.id;
    this._inspectorPending = false;
    const y = this._inspectorScroll[t.id] ?? 0;
    try { t.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This tab failed to load: ${e.message}`)); }
    body.scrollTop = y;
    body.addEventListener('scroll', () => { this._inspectorScroll[t.id] = body.scrollTop; }, { passive: true });
    this._restoreFocus(this.inspector, focus);
    this.syncPanels();
  }

  selectTab(id) { this.tabId = id; this.app.setPref('inspectorTab', id); this.renderInspector(); }

  /** Re-render the inspector unless one of its own controls caused the change (or the user is typing in it). */
  refreshInspector() {
    if (this.lockInspector) return;
    if (this._deferRender('inspector')) return;
    this.renderInspector();
  }
  /** Wrap a control callback so it does not re-render the panel it lives in. */
  quiet(fn) { return (...a) => { this.lockInspector = true; try { fn(...a); } finally { this.lockInspector = false; } }; }

  // ------------------------------------------------------------------ viewport overlays
  buildOverlays() {
    const app = this.app;
    this.infoCard = h('div.float.info-card', { 'aria-live': 'polite' });
    this.hover = h('div.float.hovercard', { hidden: true });
    this.hintText = h('span.hint-text.pill');
    this.statText = h('span.stat.pill');
    this.statusbar = h('div.float.statusbar', this.hintText, this.statText);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this._fitHint()).observe(this.statusbar);   // panels opened or closed
    // toolbar
    this.selectBtn = btn('', { icon: 'pointer', cls: 'icon', tip: 'Select and inspect atoms', kbd: 'V', on: () => app.setTool('select') });
    this.measureBtn = btn('', { icon: 'ruler', cls: 'icon', tip: 'Measure distance, angle or dihedral', kbd: 'M', on: (e) => this.measureMenu(e.currentTarget) });
    const viewBtn = btn('', { icon: 'axes', cls: 'icon', tip: 'View along an axis', kbd: 'A B C · X Y Z', on: (e) => this.viewMenu(e.currentTarget) });
    this.projBtn = btn('', { icon: 'projection', cls: 'icon', tip: 'Perspective / orthographic', kbd: 'P', on: () => commands.run('view.projection') });
    this.spinBtn = btn('', { icon: 'turntable', cls: 'icon', tip: 'Turntable (auto-rotate)', kbd: 'T', on: () => commands.run('view.turntable') });
    this.cameraBtn = btn('', { icon: 'camera', cls: 'icon', tip: 'Save a 2× PNG image', kbd: keyLabel('mod+e'), on: () => this.runCommand('export.png2') });
    this.fsBtn = btn('', { icon: 'maximize', cls: 'icon', tip: 'Full screen', kbd: keyLabel('shift+f'), pressed: false, on: () => this.fullscreen() });
    this.toolbar = h('div.float.toolbar.tb-top', { role: 'toolbar', 'aria-label': 'View tools', 'aria-orientation': 'vertical' },
      this.selectBtn, this.measureBtn, h('span.sep'),
      btn('', { icon: 'reset', cls: 'icon', tip: 'Reset view', kbd: keyLabel('Home'), on: () => app.viewer.resetView() }),
      btn('', { icon: 'fit', cls: 'icon', tip: 'Fit to screen', kbd: 'F', on: () => app.viewer.fitView() }),
      viewBtn, this.projBtn, this.spinBtn, h('span.sep'),
      this.cameraBtn, this.fsBtn,
    );
    this.revealBtn = btn('Appearance', { icon: 'style', cls: 'float reveal-insp desktop-only', tip: 'Show appearance panel', kbd: keyLabel(']'), on: () => this.toggleInspector(true) });
    this.revealBtn.hidden = this.inspectorOpen;
    // trajectory
    this.playBtn = btn('', { icon: 'play', cls: 'icon ghost', tip: 'Play / pause', kbd: 'Space', on: () => app.viewer.play() });
    this.frameSlider = h('input', { type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Frame' });
    this.frameSlider.addEventListener('input', () => app.viewer.setFrame(+this.frameSlider.value));
    this.frameLabel = h('span.num.mono', '1 / 1');
    const fpsSel = h('select.field.fps', { 'aria-label': 'Playback speed', 'data-tip': 'Playback speed' }, ...[6, 12, 24, 48].map((f) => h('option', { value: f, selected: f === 12 }, `${f} fps`)));
    fpsSel.addEventListener('change', () => { app.viewer.fps = +fpsSel.value; });
    this.trajbar = h('div.float.trajbar', { hidden: true }, this.playBtn, this.frameSlider, this.frameLabel, fpsSel);
    // empty state
    this.emptyTiles = h('div.tiles', { role: 'group', 'aria-label': 'Samples' });
    this.emptyText = h('p');
    this.empty = h('div.float.empty', { hidden: true }, h('div.box',
      h('div.logo-wrap', { html: LOGO }),
      h('h2', 'Start with a structure'),
      this.emptyText,
      this.emptyTiles,
      h('div.acts',
        btn('Open file', { icon: 'open', cls: 'primary', kbd: keyLabel('mod+o'), tip: 'Open CIF, POSCAR, XYZ, PDB or Crystallume files', on: () => commands.run('file.open') }),
        btn('Browse samples', { icon: 'library', on: () => this.browseSamples() }),
        btn('Build', { icon: 'build', on: () => this.openLeft('build') }),
        btn('Paste text', { icon: 'clipboard', cls: 'desktop-only', on: () => this.runCommand('file.paste') })),
    ));
    this.drop = h('div.float.dropzone', { hidden: true }, h('div', h('b', 'Drop structure or project files to open them'), h('small', `CIF, POSCAR, XYZ, PDB or .crystallume.json · you can also paste file text with ${keyLabel('mod+v')}`)));
    this.measureHud = h('div.float.measure-hud', { hidden: true, role: 'status' });
    this.stage.append(this.infoCard, this.toolbar, this.revealBtn, this.statusbar, this.hover, this.trajbar, this.empty, this.drop, this.measureHud);
    this.selCard = new SelectionCard(this);
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
    this.statusbar.classList.toggle('no-structure', !s);
    if (!s) { this.renderEmpty(); this.updateStats(); this.updateTraj(); return; }
    const cp = s.cellParams();
    this.infoCard.replaceChildren(...[
      h('div.f', { html: formulaHTML(s.formula()) }),
      h('div.s', s.name !== s.formula() ? s.name : (s.periodic ? 'periodic' : 'cluster / molecule')),
      cp ? h('div.s', `a ${cp.a.toFixed(3)}  b ${cp.b.toFixed(3)}  c ${cp.c.toFixed(3)} Å`) : null,
      cp ? h('div.s', `α ${cp.alpha.toFixed(1)}°  β ${cp.beta.toFixed(1)}°  γ ${cp.gamma.toFixed(1)}°`) : null,
    ].filter(Boolean));
    this.updateStats(); this.updateTraj();
  }

  /** Empty state: copy for the input device and one-click sample tiles. */
  renderEmpty() {
    const touch = isTouch();
    this.emptyText.textContent = touch
      ? 'Open a CIF, POSCAR, XYZ or PDB file, pick a sample below, or build a crystal or nanocluster.'
      : 'Open a CIF, POSCAR, XYZ or PDB file, drop it anywhere on this window, paste its text, or start from a sample below.';
    if (this.emptyTiles.childElementCount) return;
    this._tileMeta ??= {};
    for (const id of ['perovskite', 'au55', 'graphene', 'c60']) {
      const s = samples.get(id);
      if (!s) continue;
      let meta = this._tileMeta[id];
      if (!meta) {
        try { const st = s.build(); meta = { formula: st.formula(st.periodic ? { reduce: true } : {}), n: st.length }; } catch { meta = { formula: '', n: 0 }; }
        this._tileMeta[id] = meta;
      }
      const words = s.name.split(' ');
      const nm = /[₀-₉]/.test(words[0]) && words.length > 1 ? words.slice(1).join(' ') : s.name;
      const b = h('button.sample-tile', { type: 'button', 'data-tip': `Open ${s.name}` },
        h('span.f', { html: formulaHTML(meta.formula) }), h('span.nm', nm[0].toUpperCase() + nm.slice(1)), h('span.n', plural(meta.n, 'atom')));
      b.addEventListener('click', () => { try { const r = this.app.loadSample(id); r?.catch?.((e) => toast(e.message, { type: 'error' })); } catch (e) { toast(e.message, { type: 'error' }); } });
      this.emptyTiles.append(b);
    }
  }

  browseSamples() {
    this.openLeft('library');
    if (!isTouch()) requestAnimationFrame(() => this.drawer.querySelector('input[type="search"], input')?.focus());
  }

  /** Show as many leading ' · '-separated parts of the hint as fit beside the stats (never a cut-off word). */
  _fitHint() {
    const el = this.hintText, parts = this._hintParts;
    if (!el || !parts?.length) return;
    let n = parts.length;
    el.hidden = false;
    el.innerHTML = parts.join(' · ');
    if (!el.clientWidth) return;   // hidden (phones) or not laid out yet
    while (n > 1 && el.scrollWidth > el.clientWidth + 1) el.innerHTML = parts.slice(0, --n).join(' · ');
    // not even the first tip fits beside the stats: leave the pill out rather than show a cut-off letter
    if (el.scrollWidth > el.clientWidth + 1) el.hidden = true;
  }

  updateStats() {
    this._updateStats();
    // the hint shares the status bar with the stats: refit it when they change length
    if (this.statText.textContent !== this._statShown) { this._statShown = this.statText.textContent; this._fitHint(); }
  }
  _updateStats() {
    const m = this.app.viewer.model, s = this.app.structure;
    const st = this.statText;
    if (!m || !s) { st.textContent = ''; st.hidden = true; delete st.dataset.tip; return; }
    st.hidden = false;
    const n = s.length, drawn = m.n;
    const atoms = drawn !== n ? `${plural(n, 'atom')} (${drawn.toLocaleString()} drawn)` : plural(n, 'atom');
    const showFps = this.fps != null && (this.fps < 30 || this.app.prefs.debug);
    st.textContent = [atoms, m.bondsSkipped ? 'bonds off (too many atoms)' : plural(m.bonds?.count ?? 0, 'bond'), showFps ? `${this.fps} fps` : null].filter(Boolean).join(' · ');
    if (drawn > n) st.dataset.tip = 'Includes boundary and periodic image atoms (Scene → Repeat & boundaries)';
    else if (drawn < n) st.dataset.tip = 'Hidden elements are not drawn (Style → Colour & size per element)';
    else delete st.dataset.tip;
  }

  updateTraj() {
    const s = this.app.structure;
    const n = s?.nFrames ?? 1;
    this.trajbar.hidden = n <= 1;
    if (n > 1) { this.frameSlider.max = n - 1; this.frameSlider.value = s.frame; this.frameLabel.textContent = `${s.frame + 1} / ${n}`; }
  }

  /** Background luminance decides whether viewport overlays use the dark or the light treatment. */
  updateTone() {
    const bg = this.app.scene?.display?.background;
    let tone;
    if (!bg || bg.mode === 'transparent') tone = this._darkUI() ? 'dark' : 'light';
    else {
      const ls = [bg.color1, bg.mode === 'solid' ? null : bg.color2].map(luminance).filter((v) => v != null);
      tone = ls.length && ls.reduce((a, b) => a + b, 0) / ls.length > 0.5 ? 'light' : 'dark';
    }
    this.stage.dataset.tone = tone;
  }
  _darkUI() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }

  updateHint() {
    const app = this.app;
    const touch = isTouch();
    let html;
    if (app.tool === 'measure') {
      const need = { distance: 2, angle: 3, dihedral: 4 }[app.measureType];
      html = `<b>${app.measureType[0].toUpperCase() + app.measureType.slice(1)}</b> — ${touch ? 'tap' : 'click'} ${need} atoms (${app.measurePicks.length}/${need}) · <b>Esc</b> to finish`;
      this.measureHud.hidden = false;
      this.measureHud.replaceChildren(h('span', `${app.measureType[0].toUpperCase() + app.measureType.slice(1)}: ${touch ? 'tap' : 'click'} ${need} atoms (${app.measurePicks.length}/${need})`), h('button', { type: 'button', on: { click: () => app.setTool('select') } }, 'Done'));
    } else {
      this.measureHud.hidden = true;
      const n = app.selection.length;
      if (!app.structure) html = touch ? 'Open a file or pick a sample' : `Open a file (<b>${keyLabel('mod+o')}</b>), drop one here, paste text, or pick a sample`;
      else if (touch) html = n ? `<b>${n}</b> selected · ${this.selCard?.multi ? 'tap atoms to add or remove · ' : ''}tap empty space to clear` :'One finger rotates, two fingers pan and pinch to zoom, tap an atom to select it';
      else html = n ? `<b>${n}</b> selected · <b>Del</b> delete · <b>Shift-click</b> add · <b>${MOD}-click</b> add/remove · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>Esc</b> clear`
        : isMac ? '<b>⌃-drag</b> or <b>right-drag</b> rotate · <b>⌥-drag</b> or <b>middle-drag</b> pan · <b>Scroll</b> zoom · <b>Click</b> select · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>⌃-click</b> atom menu'
          : '<b>Right-drag</b> rotate · <b>Middle-drag</b> or <b>Alt-drag</b> pan · <b>Scroll</b> zoom · <b>Click</b> select · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>Right-click</b> atom menu';
    }
    this._hintParts = html.split(' · ');
    this._fitHint();
    this.selectBtn.setAttribute('aria-pressed', String(app.tool === 'select'));
    this.measureBtn.setAttribute('aria-pressed', String(app.tool === 'measure'));
    this.projBtn.setAttribute('aria-pressed', String(app.scene.display.projection === 'orthographic'));
    this.spinBtn.setAttribute('aria-pressed', String(!!app.scene.display.turntable));
  }

  updateSaveChip() {
    const app = this.app;
    const st = app.saveState;
    const provId = app.project.location?.provider ?? app.defaultProvider;
    const prov = app.storage.get(provId);
    const where = prov?.where ?? (prov ? `in ${prov.label}` : 'in this browser');
    const auto = app.prefs.autosave !== false;
    const sample = !app.project.location && app.project._fromSample && !app.dirty;
    const label = {
      idle: !app.structure ? 'Empty project' : sample ? `Sample · edits autosave ${where}` : 'Not saved yet',
      dirty: auto ? `Unsaved changes · autosaves ${where}` : 'Unsaved changes · autosave is off',
      saving: `Saving ${where}…`,
      saved: `Saved ${where}${app.project.updated ? ` · ${relativeTime(app.project.updated)}` : ''}`,
      error: `Save failed — ${app.saveDetail || 'try again'}`,
    }[st] ?? '';
    const memory = provId === 'browser' && !!app.browserStore?.memory;
    this.saveChip.dataset.state = st;
    this.saveChip.dataset.warn = String(memory && st !== 'error');
    this.saveChip.querySelector('.lbl').textContent = label;
    const tip = memory ? `${label}. This browser blocks storage here, so projects only last until you close this tab — download the project file to keep it.` : `${label}. Click for save options.`;
    this.saveChip.dataset.tip = tip;
    this.saveChip.setAttribute('aria-label', `${label}. Save options`);
  }

  updateHistory() {
    const app = this.app;
    const u = app.undoLabel?.() ?? null, r = app.redoLabel?.() ?? null;
    this.undoBtn.disabled = !(app.canUndo?.() ?? app.undoStack.length > 0);
    this.redoBtn.disabled = !(app.canRedo?.() ?? app.redoStack.length > 0);
    this.undoBtn.dataset.tip = u ? `Undo ${u}` : 'Undo';
    this.redoBtn.dataset.tip = r ? `Redo ${r}` : 'Redo';
    this.undoBtn.setAttribute('aria-label', this.undoBtn.dataset.tip);
    this.redoBtn.setAttribute('aria-label', this.redoBtn.dataset.tip);
  }

  /** app 'busy' {busy, label}: a spinner toast, Export disabled and the stage marked busy. */
  onBusy({ busy, label } = {}) {
    this.stage.setAttribute('aria-busy', String(!!busy));
    this.exportBtn.disabled = !!busy;
    this.cameraBtn.disabled = !!busy;
    if (busy) {
      if (this._busyToast?.isConnected) this._busyToast.update(label || 'Working…');
      else this._busyToast = toast(label || 'Working…', { timeout: 0, spinner: true });
    } else { this._busyToast?.close(); this._busyToast = null; }
  }

  // ------------------------------------------------------------------ menus
  saveMenu(anchor) {
    const app = this.app;
    const items = [{ header: 'Save project to' }];
    for (const p of app.storage.list()) {
      const here = app.project.location?.provider === p.id;
      items.push({ label: p.label, icon: p.icon, tip: p.description, hint: here ? 'current' : p.id === 'folder' && !p.connected ? 'choose folder' : '', run: () => this.saveToProvider(p.id) });
    }
    items.push({ separator: true });
    if (canDownload()) items.push({ label: 'Download project file (.crystallume.json)', icon: 'download', run: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) });
    items.push({ label: 'Autosave', icon: 'check', checked: app.prefs.autosave !== false, hint: app.prefs.autosave !== false ? 'on' : 'off', run: () => { app.setPref('autosave', app.prefs.autosave === false); this.updateSaveChip(); toast(app.prefs.autosave !== false ? 'Autosave is on' : 'Autosave is off'); } });
    showMenu(anchor, items, { label: 'Save' });
  }

  async saveToProvider(id) {
    const app = this.app;
    const p = app.storage.get(id);
    if (!p) { toast('That storage location is not available here.', { type: 'error' }); return false; }
    if (id === 'folder' && !p.connected) { try { await p.connect(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, { type: 'error' }); return false; } }
    if (id === 'server' && p.needsAuth) { this.openSignIn(); toast('Sign in to the server to save there.'); return false; }
    return app.saveTo(id);
  }

  /** Export (and every download) is hidden where files cannot be saved: an artifact without the downloads capability. */
  syncDownloads() {
    const ok = canDownload();
    this.exportBtn.hidden = !ok;
    if (this.cameraBtn) this.cameraBtn.hidden = !ok;
  }

  exportMenu(anchor) {
    const app = this.app;
    const none = !app.structure, busy = !!app.busy;
    const why = none ? 'Load a structure first' : busy ? 'Wait for the current task to finish' : null;
    const run = (fn) => () => fn().catch((e) => toast(e.message, { type: 'error' }));
    const img = (label, opt, kbd) => ({ label, icon: 'image', kbd, disabled: !!why, tip: why, run: run(() => app.exportImage(opt)) });
    const items = [
      { header: 'Image' },
      img('PNG — screen size', { scale: 1 }),
      img('PNG — 2× (print)', { scale: 2 }, keyLabel('mod+e')),
      img('PNG — 4× (poster)', { scale: 4 }),
      img('PNG — transparent background', { scale: 2, transparent: true }),
      { header: '3D model' },
      { label: 'glTF binary (.glb) for Blender, PowerPoint, AR', icon: 'cube', disabled: !!why, tip: why, run: run(() => app.exportGLB()) },
      { header: 'Structure file' },
      ...formats.writers().map((f) => {
        const noCell = (f.id === 'poscar' || f.id === 'cif') && app.structure && !app.structure.cell;
        return { label: f.name, icon: 'file', hint: `.${f.extensions[0]}`, disabled: !!why || noCell, tip: why ?? (noCell ? `${f.name} needs a unit cell` : null), run: run(() => app.exportStructureFile(f.id)) };
      }),
    ];
    showMenu(anchor, items, { align: 'end', label: 'Export' });
  }

  measureMenu(anchor) {
    const app = this.app;
    showMenu(anchor, [
      { header: 'Measure' },
      { label: 'Distance (2 atoms)', icon: 'ruler', kbd: 'M', run: () => app.setTool('measure', 'distance') },
      { label: 'Angle (3 atoms)', icon: 'ruler', run: () => app.setTool('measure', 'angle') },
      { label: 'Dihedral (4 atoms)', icon: 'ruler', run: () => app.setTool('measure', 'dihedral') },
      { separator: true },
      { label: 'Clear all measurements', icon: 'trash', disabled: !app.viewer.measurements.length, run: () => { app.viewer.clearMeasurements(); this.app.emit('measure'); } },
    ], { label: 'Measure' });
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
      { label: 'Default view', kbd: keyLabel('Home'), run: () => app.viewer.resetView() },
    ], { label: 'View along an axis' });
  }

  helpMenu(anchor) {
    const app = this.app;
    const resume = !app.prefs.tourDone && Number.isInteger(app.prefs.tourStep) && app.prefs.tourStep > 0;
    showMenu(anchor, [
      resume ? { label: 'Resume tour', icon: 'sparkles', hint: `step ${app.prefs.tourStep + 1}`, run: () => this.tour(app.prefs.tourStep) } : null,
      { label: resume ? 'Start the tour again' : 'Take the tour', icon: resume ? 'reset' : 'sparkles', run: () => this.tour() },
      isTouch() ? null : { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: () => this.shortcutsDialog() },
      { label: 'Command palette', icon: 'command', kbd: isTouch() ? null : keyLabel('mod+k'), run: () => this.openPalette() },
      { label: 'Scripting & API', icon: 'plug', run: () => this.apiDialog() },
      { label: 'About Crystallume', icon: 'info', run: () => this.aboutDialog() },
    ], { align: 'end', label: 'Help' });
  }

  /** Phone overflow menu: actions that do not fit in the top bar. */
  moreMenu(anchor) {
    const app = this.app;
    const s = app.storage.get('server');
    const dark = this._darkUI();
    showMenu(anchor, [
      { label: 'Open files…', icon: 'open', run: () => commands.run('file.open') },
      { label: 'Paste structure text…', icon: 'clipboard', run: () => this.runCommand('file.paste') },
      { label: 'New project', icon: 'plus', run: () => commands.run('project.new') },
      { separator: true },
      { label: dark ? 'Light interface' : 'Dark interface', icon: dark ? 'sun' : 'moon', run: () => this.cycleTheme() },
      s?.info?.mode === 'cloud' && s.user ? { label: `Sign out (${s.user.username})`, icon: 'logout', run: () => this.signOut() } : null,
      s?.info && s.needsAuth ? { label: 'Sign in to the server', icon: 'user', run: () => this.openSignIn() } : null,
    ], { align: 'end', label: 'More' });
  }

  /** Right-click on an atom (or on empty space) in the view. */
  onAtomContext({ index, clientX, clientY }) {
    const app = this.app, v = app.viewer, m = v.model;
    if (!app.structure || !m) return;
    const at = { x: clientX, y: clientY };
    if (index < 0 || index >= m.n) {
      showMenu(at, [
        { label: 'Fit to screen', icon: 'fit', kbd: 'F', run: () => v.fitView() },
        { label: 'Reset view', icon: 'reset', kbd: keyLabel('Home'), run: () => v.resetView() },
        { separator: true },
        { label: 'Select all atoms', icon: 'atom', kbd: keyLabel('mod+a'), run: () => selectAll(app) },
        { label: 'Clear selection', icon: 'x', kbd: 'Esc', disabled: !app.selection.length, run: () => app.clearSelection() },
      ], { label: 'View' });
      return;
    }
    const src = m.src[index], sym = m.symbols[index], el = element(sym);
    const sel = app.selection, inSel = sel.includes(src);
    showMenu(at, [
      { header: `${sym} #${src} · ${el.name}` },
      { label: `Select all ${sym}`, icon: 'atom', run: () => selectSameElement(app, sym) },
      { label: 'Select with neighbours', icon: 'neighbors', run: () => selectNeighbours(app, [src]) },
      { label: 'Select bonded fragment', icon: 'neighbors', kbd: 'Double-click', run: () => selectFragment(app, [src]) },
      { label: 'Centre here', icon: 'crosshair', run: () => v.focusAtom(index) },
      { label: 'Measure from here', icon: 'ruler', run: () => measureFrom(app, index) },
      { separator: true },
      { label: `Hide ${el.name}`, icon: 'eyeOff', run: () => this.hideElement(sym) },
      { label: inSel && sel.length > 1 ? `Delete ${sel.length} selected atoms` : 'Delete atom', icon: 'trash', kbd: keyLabel('Delete'), run: () => { if (!inSel) app.select([src]); app.deleteSelected(); } },
    ], { label: `Atom ${sym} ${src}` });
  }

  hideElement(sym) {
    const app = this.app;
    const before = app.scene.display.hiddenElements ?? [];
    app.set('display.hiddenElements', [...new Set([...before, sym])]);
    toast(`${element(sym).name} hidden`, { action: { label: 'Show', run: () => app.set('display.hiddenElements', (app.scene.display.hiddenElements ?? []).filter((x) => x !== sym)) } });
  }

  // ------------------------------------------------------------------ full screen
  fullscreen() {
    const sync = () => this._syncFullscreen();
    if (document.fullscreenElement) { document.exitFullscreen?.().then(sync, sync); return; }
    if (this.root.dataset.fullscreen === 'focus') { this._setFullscreen(null); return; }
    const el = document.documentElement;
    const fallback = () => { this._setFullscreen('focus'); toast(`Full screen is blocked here, so the panels are hidden instead. Press ${keyLabel('shift+f')} to bring them back.`); };
    if (!document.fullscreenEnabled || !el.requestFullscreen) { fallback(); return; }
    el.requestFullscreen().then(sync, fallback);
  }
  /** Match the layout to the browser's full-screen state (also after Esc, which the page does not see). */
  _syncFullscreen() {
    const on = !!document.fullscreenElement;
    if (on && this.root.dataset.fullscreen !== 'screen') this._setFullscreen('screen');
    else if (!on && this.root.dataset.fullscreen === 'screen') this._setFullscreen(null);
  }
  _setFullscreen(mode) {
    if (mode) this.root.dataset.fullscreen = mode; else delete this.root.dataset.fullscreen;
    this.fsBtn.setAttribute('aria-pressed', String(!!mode));
    this.fsBtn.replaceChildren(ic(mode ? 'minimize' : 'maximize'));
    this.fsBtn.dataset.tip = mode ? 'Exit full screen' : 'Full screen';
    this.fsBtn.setAttribute('aria-label', this.fsBtn.dataset.tip);
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  // ------------------------------------------------------------------ theme
  applyTheme(t) {
    const r = document.documentElement;
    if (this._hostTheme === undefined) {
      this._hostTheme = r.dataset.theme ?? null;
      // the host page (claude.ai) may switch <html data-theme> while the app is open, and the system its scheme:
      // keep following the one in charge and refresh the button, halos and tone
      const follow = () => this.applyTheme(this.app.prefs.theme ?? 'system');
      if (typeof MutationObserver === 'function') {
        this._themeObs = new MutationObserver((recs) => { if (!recs.length) return; this._hostTheme = r.dataset.theme ?? null; follow(); });
        this._themeObs.observe(r, { attributes: true, attributeFilter: ['data-theme'] });
      }
      globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', follow);
    }
    this._syncHostTheme();
    if (t === 'system') { if (this._hostTheme) r.dataset.theme = this._hostTheme; else delete r.dataset.theme; } else r.dataset.theme = t;
    this._themeObs?.takeRecords();   // the app's own write is not the host's theme
    const dark = this._darkUI();
    this.themeBtn.replaceChildren(ic(dark ? 'sun' : 'moon'));
    this.themeBtn.dataset.tip = `Interface: ${t === 'system' ? (this._hostTheme ? 'follows the page' : 'follows system') : t} — click to change`;
    this.app.viewer._updateHalos?.();
    this.updateTone?.();
  }
  /** Take a host write to <html data-theme> that the observer has not delivered yet. */
  _syncHostTheme() { if (this._themeObs?.takeRecords().length) this._hostTheme = document.documentElement.dataset.theme ?? null; }
  /**
   * Flip what the user sees (light ↔ dark). Choosing the default theme — the one the host page sets on
   * <html data-theme> (claude.ai), else the system's — goes back to following it.
   */
  cycleTheme() {
    this._syncHostTheme();
    const want = this._darkUI() ? 'light' : 'dark';
    const sys = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const next = want === (this._hostTheme ?? sys) ? 'system' : want;
    this.app.setPref('theme', next);
    this.applyTheme(next);
    toast(next === 'system' ? `Interface: ${want} (follows ${this._hostTheme ? 'the page' : 'your system'})` : `Interface: ${want}`);
  }

  // ------------------------------------------------------------------ input
  /** Run a registered command (by id or object), respecting its `when`; errors become toasts. */
  runCommand(idOrCmd) {
    const c = typeof idOrCmd === 'string' ? commands.get(idOrCmd) : idOrCmd;
    if (!c) return;
    if (!commands.available(c)) { toast(commands.unavailableReason(c)); return; }
    try { const r = c.run(); r?.catch?.((e) => toast(e.message, { type: 'error' })); } catch (e) { console.error(e); toast(e.message, { type: 'error' }); }
  }

  bindShortcuts() {
    const app = this.app;
    const GLOBAL = { k: () => this.openPalette(), s: () => this.runCommand('project.save'), o: () => this.runCommand('file.open'), e: () => this.runCommand('export.png2') };
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.isComposing || !e.key) return;
      const k = e.key, lk = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      const modal = !!(modalOpen() || document.querySelector('.scrim'));
      // during the tour only commands that cannot cover it or take its keys (Esc, ←, →) run
      const touring = !modal && !!document.querySelector('.coach');
      if (ctrl && !e.altKey && !e.shiftKey && GLOBAL[lk]) {
        e.preventDefault();
        if (modal || touring || e.repeat) return;
        closeMenu();
        GLOBAL[lk]();
        return;
      }
      if (modal || menuOpen()) return;
      if (isTextField(e.target)) return;
      if (ctrl && !e.altKey && lk === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
      if (ctrl && !e.altKey && lk === 'y') { e.preventDefault(); app.redo(); return; }
      // buttons, tabs, switches and sliders keep Space, Enter and the arrow keys; letters and digits still work
      if (NAV_KEYS.has(k) && e.target.closest?.(ACTIVATABLE)) return;
      const usable = (x) => { try { return !x.when || x.when(app); } catch { return false; } };
      const matches = commands.list().filter((x) => x.key && matchKey(x.key, e));
      const c = matches.find((x) => usable(x) && (!touring || TOUR_SAFE.test(x.id)));
      if (!c) {
        // a Ctrl/⌘ shortcut that is not available now: keep the browser's own action (select all page text…) away and say why
        const m = matches.find((x) => [x.key].flat().some((spec) => hasMod(spec) && matchKey(spec, e)));
        if (m) { e.preventDefault(); if (!e.repeat && !touring) this.runCommand(m); }
        return;
      }
      e.preventDefault();
      if (e.repeat && !c.repeat) return;   // holding T, P, Space… must not flicker a toggle
      // keys held down to change what a drag does (X, Y, Z, R…) run their shortcut on release, and only
      // when no drag or click in the view used them meanwhile
      if (!ctrl && !e.altKey && app.viewer.holdKeys?.has(lk)) { held = { key: lk, command: c }; return; }
      this.runCommand(c);
    });
    let held = null;
    document.addEventListener('keyup', (e) => {
      const p = held;
      if (!p || e.key?.toLowerCase() !== p.key) return;
      held = null;
      if (app.viewer.heldKeyUsed?.(p.key) || modalOpen() || menuOpen() || document.querySelector('.scrim')) return;
      this.runCommand(p.command);
    });
    addEventListener('blur', () => { held = null; });
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
      if (isTextField(e.target) || modalOpen() || document.querySelector('.scrim')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); this.app.importFiles(files); return; }
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      this.pasteText(text);
    });
  }

  /** Import pasted text as a structure; failures become a toast (never an unhandled rejection). */
  pasteText(text, format = null) {
    const app = this.app;
    return Promise.resolve().then(() => app.importText(text, 'pasted', format)).then((st) => {
      const undo = app.canUndo?.() ? { action: { label: 'Undo', run: () => app.undo() } } : {};
      toast(`Pasted ${plural(st.length, 'atom')} — ${st.formula()}`, undo);
      return st;
    }, (err) => { toast(`Pasted text is not a structure file (${pasteReason(err)})`, { type: 'error' }); return null; });
  }

  /** A dialog to paste structure-file text (works where clipboard events are not available, e.g. phones). */
  pasteDialog() {
    const area = h('textarea.field.mono', { rows: 10, autofocus: true, spellcheck: false, 'aria-label': 'Structure file text', placeholder: 'Paste the contents of a CIF, POSCAR, XYZ, PDB or Crystallume JSON file…', style: { minHeight: '200px', fontSize: '12px' } });
    const readers = formats.readers();
    // as in the Build panel: formats the browser cannot read are parsed by the server (incl. plugin formats)
    const fmt = h('select.field', { 'aria-label': 'Format' }, h('option', { value: '' }, 'Detect format'), ...readers.map((f) => h('option', { value: f.id }, f.server ? `${f.id} (server)` : f.name)));
    const hint = readers.some((f) => f.server) ? h('p.hint', 'Formats marked (server) are read by the Crystallume server, including formats added by its plugins.') : null;
    const err = h('p.err-text', { hidden: true, role: 'alert' });
    dialog({
      title: 'Paste structure text', wide: true,
      body: h('div', { style: { display: 'grid', gap: '10px' } }, area, h('div.ctl.wide', h('label', 'Format'), fmt), hint, err),
      actions: [{ label: 'Cancel' }, {
        label: 'Open', primary: true,
        run: async () => {
          if (!area.value.trim()) { err.hidden = false; err.textContent = 'Paste some file text first.'; area.focus(); return false; }
          try { await this.app.importText(area.value, 'pasted', fmt.value || null); toast(`Opened ${plural(this.app.structure.length, 'atom')} — ${this.app.structure.formula()}`); return true; }
          catch (e) { err.hidden = false; err.textContent = `This text is not a structure file Crystallume can read (${pasteReason(e)}).`; return false; }
        },
      }],
    });
  }

  bindApp() {
    const app = this.app;
    this._refreshDrawerSoon = debounce(() => {
      if (this._deferRender('drawer')) return;
      this.renderDrawer();
    }, 30);
    app.on('project', () => { if (document.activeElement !== this.titleInput) this.titleInput.value = app.project.name; this.updateSaveChip(); this.refreshDrawer('project'); });
    app.on('structure', () => { this.updateInfo(); this.updateHint(); this.refreshDrawer('structure'); this.refreshInspector(); });
    app.on('selection', () => { this.updateHint(); this.refreshDrawer('selection'); });
    app.on('measure', () => this.refreshDrawer('measure'));
    app.on('tool', () => { this.updateHint(); this.selCard.update(); });
    app.on('scene', () => { this.refreshInspector(); this.updateHint(); this.updateTone(); this.refreshDrawer('scene'); });
    app.on('registry', () => this.refreshDrawer('registry'));
    app.on('saveState', () => this.updateSaveChip());
    app.on('providers', () => { this.refreshDrawer('providers'); this.renderUser(); this.updateSaveChip(); });
    app.on('auth', () => { this.renderUser(); this.updateSaveChip(); this.refreshDrawer('auth'); });
    app.on('history', () => this.updateHistory());
    app.on('busy', (b) => this.onBusy(b));
    app.on('needAuth', () => this.openSignIn());
    setInterval(() => this.updateSaveChip(), 30000);
    this.updateInfo(); this.updateHint(); this.updateSaveChip(); this.renderUser(); this.updateHistory(); this.updateTone();
  }

  bindViewer() {
    const app = this.app, v = app.viewer;
    v.on('hover', (e) => this.onHover(e));
    v.on('frame', () => this.updateTraj());
    v.on('play', (p) => { this.playBtn.replaceChildren(ic(p ? 'pause' : 'play')); });
    v.on('model', () => { this.updateInfo(); });
    v.on('atomcontext', (e) => this.onAtomContext(e));
    v.on('boxselect', ({ indices = [], add, mode } = {}) => { if (app.tool !== 'select' || !app.structure) return; app.select(indices, { mode: mode ?? (add ? 'add' : 'replace') }); });
    // multi-select (touch): a tap adds or removes an atom instead of replacing the selection
    // (both read at pointerdown: the app has already applied the plain click when 'atomclick' gets here)
    const cv = v.renderer.domElement;
    cv.addEventListener('pointerdown', () => { this._selAtDown = app.selection.slice(); this._multiAtDown = this.selCard.multi; }, true);
    // a click focuses the view for its keys; only focus that arrives by keyboard (Tab) draws the focus ring
    let downAt = -1e9;
    cv.addEventListener('pointerdown', () => { downAt = performance.now(); cv.dataset.pointerFocus = ''; }, true);
    cv.addEventListener('focus', () => { if (performance.now() - downAt > 1000) delete cv.dataset.pointerFocus; });
    cv.addEventListener('blur', () => { delete cv.dataset.pointerFocus; });
    v.on('atomclick', ({ index }) => {
      if (!this._multiAtDown || app.tool !== 'select' || !v.model) return;
      const before = this._selAtDown ?? [];
      if (index < 0) {
        // a tap on empty space clears the selection as usual (which also ends multi-select); offer it back
        const st = app.structure;
        if (before.length > 1 && !app.selection.length) toast(`Cleared ${plural(before.length, 'selected atom')}`, { action: { label: 'Restore', run: () => { if (app.structure !== st) return; this.selCard.multi = true; app.select(before.filter((i) => i < st.length)); } } });
        return;
      }
      const want = new Set(before);
      const s = v.model.src[index];
      if (want.has(s)) want.delete(s); else want.add(s);
      const cur = app.selection;
      if (cur.length !== want.size || cur.some((i) => !want.has(i))) app.select([...want]);
    });
    // multi-select (touch): a double tap adds the fragment (the app has just replaced the selection with it)
    v.on('atomdblclick', () => {
      if (!this._multiAtDown || app.tool !== 'select') return;
      app.select([...(this._selAtDown ?? []), ...app.selection], { mode: 'replace' });
    });
    // frame rate, measured only over continuous rendering (an idle view renders nothing)
    let frames = 0, t0 = 0, last = 0;
    v.on('render', () => {
      const t = performance.now();
      if (t - last > 200) { t0 = t; frames = 0; }
      last = t; frames++;
      if (t - t0 >= 1000) {
        this.fps = Math.round((frames * 1000) / (t - t0)); frames = 0; t0 = t;
        this.updateStats();
        clearTimeout(this._fpsTimer);
        this._fpsTimer = setTimeout(() => { this.fps = null; this.updateStats(); }, 2500);
      }
    });
    document.addEventListener('fullscreenchange', () => this._syncFullscreen());
    addEventListener('resize', () => this._syncFullscreen());
  }

  renderUser() {
    const s = this.app.storage.get('server');
    this.userSlot.replaceChildren();
    if (s?.info?.mode === 'cloud' && s.user) {
      this.userSlot.append(btn(s.user.username, { icon: 'user', cls: 'ghost small desktop-only', tip: 'Signed in to the Crystallume server', on: (e) => showMenu(e.currentTarget, [{ label: 'Sign out', icon: 'logout', run: () => this.signOut() }], { align: 'end' }) }));
    } else if (s?.info && s.needsAuth) {
      // signed out of a server with accounts: say so where people look, not only in the Projects panel
      this.userSlot.append(btn('Sign in', { icon: 'user', cls: 'ghost small desktop-only', tip: 'Sign in to save and open projects on this server', on: () => this.openSignIn() }));
    }
  }
  async signOut() {
    const s = this.app.storage.get('server');
    try { await s?.logout(); } catch (e) { toast(e.message, { type: 'error' }); }
    this.app.emit('providers');
    this.renderUser();
    toast('Signed out');
  }

  // ------------------------------------------------------------------ palette
  recordRecent(id) {
    const list = [id, ...(this.app.prefs.recentCommands ?? []).filter((x) => x !== id)].slice(0, 8);
    this.app.setPref('recentCommands', list);
  }

  openPalette() {
    if (this._palette) { this._palette.close(); return; }
    closeMenu();
    const app = this.app;
    const input = h('input', { type: 'text', role: 'combobox', placeholder: 'Type a command, sample, look or view…', 'aria-label': 'Search commands', 'aria-expanded': 'true', 'aria-controls': 'palette-results', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: false });
    const results = h('div.results', { role: 'listbox', id: 'palette-results', 'aria-label': 'Commands' });
    const foot = h('div.pal-foot', { 'aria-hidden': 'true' }, h('span', h('span.kbd', '↑'), h('span.kbd', '↓'), ' move'), h('span', h('span.kbd', 'Enter'), ' run'), h('span', h('span.kbd', 'Esc'), ' close'));
    const box = h('div.dialog.palette', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, h('div.pal-in', ic('search'), input), results, foot);
    const modal = openModal(box, { onClose: () => { this._palette = null; } });
    this._palette = modal;
    let sel = 0, opts = [];
    const available = () => commands.list().filter((c) => { if (c.hidden || c.palette === false) return false; try { return !c.when || c.when(app); } catch { return false; } });
    const row = (c, cat = true) => {
      const k = c.kbd ?? c.key;
      const r = h('div.res', { role: 'option', id: `pal-opt-${opts.length}`, 'aria-selected': 'false', dataset: { i: opts.length } }, cat ? h('span.cat', c.category ?? '') : null, h('span.tt', c.title), k ? h('span.kbd.k', keyLabel(Array.isArray(k) ? k[0] : k)) : null);
      opts.push(c);
      return r;
    };
    const highlight = (scroll = true) => {
      results.querySelectorAll('.res').forEach((r) => r.setAttribute('aria-selected', String(+r.dataset.i === sel)));
      const cur = results.querySelector(`#pal-opt-${sel}`);
      if (cur) { input.setAttribute('aria-activedescendant', cur.id); if (scroll) cur.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      const q = input.value.trim();
      const list = available();
      const nodes = [];
      opts = [];
      if (!q) {
        const recent = (app.prefs.recentCommands ?? []).map((id) => list.find((c) => c.id === id)).filter(Boolean).slice(0, 5);
        if (recent.length) { nodes.push(h('div.grp', { role: 'presentation' }, 'Recent')); recent.forEach((c) => nodes.push(row(c))); }
        const groups = new Map();
        for (const c of list) { const g = c.category ?? 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
        for (const g of [...groups.keys()].sort(byCategory)) { nodes.push(h('div.grp', { role: 'presentation' }, g)); groups.get(g).forEach((c) => nodes.push(row(c, false))); }
      } else rankCommands(list, q).slice(0, 50).forEach((c) => nodes.push(row(c)));
      results.replaceChildren(...nodes);
      if (!opts.length) results.append(h('p.hint.pal-empty', `No command matches “${q}”.`));
      sel = Math.min(sel, Math.max(0, opts.length - 1));
      highlight();
    };
    const runAt = (i) => {
      const c = opts[i];
      if (!c) return;
      modal.close();
      this.recordRecent(c.id);
      this.runCommand(c);
    };
    input.addEventListener('input', () => { sel = 0; render(); results.scrollTop = 0; });
    input.addEventListener('keydown', (e) => {
      const n = opts.length;
      if (e.key === 'ArrowDown') { sel = n ? (sel + 1) % n : 0; highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = n ? (sel - 1 + n) % n : 0; highlight(); e.preventDefault(); }
      else if (e.key === 'PageDown') { sel = Math.min(n - 1, sel + 8); highlight(); e.preventDefault(); }
      else if (e.key === 'PageUp') { sel = Math.max(0, sel - 8); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); runAt(sel); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); modal.close(); }
    });
    results.addEventListener('click', (e) => { const r = e.target.closest('.res'); if (r) runAt(+r.dataset.i); });
    results.addEventListener('pointermove', (e) => { const r = e.target.closest('.res'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; highlight(false); } });
    render();
    input.focus();
  }

  // ------------------------------------------------------------------ dialogs
  shortcutsDialog() {
    const rows = new Map();   // category → [{title, keys}]
    const grouped = new Map();
    // never available in this view (published without the downloads permission): not advertised
    const noDownloads = (c) => { if (canDownload()) return false; try { return c.whyNot?.(this.app) === NO_DOWNLOADS; } catch { return false; } };
    for (const c of commands.list()) {
      const spec = c.kbd ?? c.key;
      if (c.hidden || !spec || noDownloads(c)) continue;
      const cat = c.category ?? 'Other';
      if (!rows.has(cat)) rows.set(cat, []);
      if (c.shortcutGroup) {
        const id = `${cat}|${c.shortcutGroup}`;
        if (!grouped.has(id)) { const r = { title: c.shortcutGroup, specs: [] }; grouped.set(id, r); rows.get(cat).push(r); }
        grouped.get(id).specs.push(spec);
      } else rows.get(cat).push({ title: c.title, specs: [spec] });
    }
    const label = (r) => (r.specs.length > 1 ? groupLabel(r.specs) : keyLabel(r.specs[0]));
    const sections = [...rows.keys()].sort(byCategory).map((cat) => h('section.sc-sec', h('h3.sub-h', cat),
      h('div.shortcut-grid', rows.get(cat).map((r) => h('div', h('span', r.title), h('span.kbd', label(r)))))));
    // as in Materials Studio
    const mouse = [
      ['Right-drag', 'Rotate'], ...(isMac ? [['⌃ drag', 'Rotate (as right-drag)']] : []), ['X / Y / Z + right-drag', 'Rotate about the screen x, y or z axis'],
      ['Middle-drag', 'Pan'], [`${ALT} drag`, 'Pan (no middle button needed)'], [`${ALT} right-drag`, 'Pan'],
      ['Scroll', 'Zoom'], ['Left + right drag', 'Zoom'], ['R + drag', 'Zoom into a box'],
      ['Click', 'Select an atom (empty space: clear)'], ['Shift-click', 'Add an atom'], [`${MOD}-click`, 'Add or remove an atom'],
      ['Drag', `Box select (Shift adds, ${MOD} toggles)`], ['Q + drag', 'Lasso select'],
      ['Double-click', 'Select the bonded fragment'], [`${ALT} double-click`, 'Select all atoms of that element'], [isMac ? 'Right-click / ⌃ click' : 'Right-click', 'Atom menu'],
      ['Arrows', 'Rotate 45° (view focused)'], [`Shift or ${ALT} arrows`, 'Pan (view focused)'],
    ];
    sections.push(h('section.sc-sec', h('h3.sub-h', 'Mouse'), h('div.shortcut-grid', mouse.map(([k, d]) => h('div', h('span', d), h('span.kbd', k))))));
    dialog({ title: 'Keyboard shortcuts', wide: true, className: 'shortcuts', body: h('div.sc-wrap', sections) });
  }

  aboutDialog() {
    const app = this.app;
    const provs = app.storage.list().map((p) => p.label).join(', ');
    dialog({
      title: 'About Crystallume',
      body: h('div', { style: { display: 'grid', gap: '10px' } },
        h('p.hint', { style: { fontSize: '13.5px' } }, 'Crystallume renders atoms, clusters and crystals with physically based materials, studio lighting and post effects. Everything is modular: formats, builders, colour schemes, materials, lighting rigs, looks, storage backends, panels and commands are registries that plugins extend.'),
        h('dl.kv', h('dt', 'Version'), h('dd', VERSION), h('dt', 'Runs as'), h('dd', app.serverStore.info ? `${app.serverStore.info.mode} server` : 'standalone web app'), h('dt', 'Project storage'), h('dd', provs), h('dt', 'Renderer'), h('dd', 'three.js r170 (WebGL 2)')),
      ),
    });
  }

  /** Scripting & API help: the extensibility package's dialog when present, else a short example. */
  async apiDialog() {
    try {
      const m = await import('./apidialog.js');
      if (typeof m.openApiDialog === 'function') return m.openApiDialog(this, window.crystallume);
    } catch (e) { if (!/Failed to fetch|Importing a module|error loading dynamically/i.test(String(e?.message))) console.warn(e); }
    return this._basicApiDialog();
  }

  _basicApiDialog() {
    const code = `// In the browser console (or a plugin):
const s = crystallume.build.crystal('perovskite', { elements: ['Ba','Ti','O'], a: 4.01, repeat: [3,3,3] });
crystallume.load(s);                      // show it
crystallume.applyLook('poster');           // restyle
crystallume.set('post.outline.enabled', true);
crystallume.view('c');                     // look along c
const png = await crystallume.screenshot({ scale: 3 });

// Extend: register a colour scheme
crystallume.registry.colorSchemes.register({
  id: 'oxygen-red', name: 'Oxygen highlight',
  colorFor: (sym) => sym === 'O' ? '#ff2244' : '#b0b6bd',
});

// Python (server), in a Crystallume checkout: pip install . && crystallume serve
//   import crystallume as cl
//   cl.view(cl.build.crystal('fcc', ['Au'], a=4.08).repeat(4,4,4))`;
    return dialog({ title: 'Scripting & API', wide: true, body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.hint', 'The whole app is scriptable through window.crystallume. When Crystallume runs on its Python server, the same features are available as a REST API (see /docs on the server) and a Python package.'),
      h('pre', { style: { margin: 0, padding: '12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '9px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.55' } }, code)) });
  }

  // ------------------------------------------------------------------ onboarding
  welcome() {
    if (this.app.prefs.welcomed) return;
    const touch = isTouch();
    const card = h('div.float.welcome', { role: 'dialog', 'aria-label': 'Getting started' },
      h('h3', 'Welcome to Crystallume'),
      h('ol', h('li', touch ? 'Pick a structure from the Library, build one, or open your own file.' : 'Pick a structure from the Library, build one, or drop your own file.'), h('li', 'Restyle it with one click in Looks, then fine-tune light and effects.'), h('li', 'Export a high-resolution image or save the project.')),
      h('div.acts', btn('Take the 1-minute tour', { cls: 'primary small', on: () => { card.remove(); this.app.setPref('welcomed', true); this.tour(); } }), btn('Dismiss', { cls: 'ghost small', on: () => { card.remove(); this.app.setPref('welcomed', true); this.gestureHint(); } })));
    this.stage.append(card);
  }

  /**
   * One-time gesture hint for touch screens, at the top of the view. It waits while the welcome card or the
   * tour is up (both call it again when they close), so only one onboarding layer shows at a time.
   */
  gestureHint() {
    if (!isTouch() || this.app.prefs.gestureHintShown || !this.app.structure) return;
    if (this.stage.querySelector('.welcome') || document.querySelector('.coach')) return;
    const chip = h('div.float.gesture-chip', { role: 'status' }, ic('hand', 'sm'), h('span', 'One finger rotates · two fingers pan and pinch to zoom · tap an atom to select it'));
    const card = this.infoCard;
    const close = () => { chip.classList.add('out'); card.style.top = ''; setTimeout(() => chip.remove(), 250); };
    chip.append(h('button', { type: 'button', 'aria-label': 'Dismiss', on: { click: close } }, ic('x', 'sm')));
    this.stage.append(chip);
    this.app.setPref('gestureHintShown', true);
    // keep the structure card below the chip while it shows (on phones the chip wraps to two lines)
    requestAnimationFrame(() => {
      if (!chip.isConnected || chip.classList.contains('out') || card.hidden) return;
      const c = chip.getBoundingClientRect(), i = card.getBoundingClientRect();
      const bottom = chip.offsetTop + chip.offsetHeight + 6;
      if (c.right > i.left && c.left < i.right && bottom > card.offsetTop) card.style.top = `${bottom}px`;
    });
    setTimeout(close, 9000);
    this.app.viewer.renderer.domElement.addEventListener('pointerdown', () => setTimeout(close, 1500), { once: true });
  }

  tourSteps() {
    const app = this.app, touch = isTouch();
    const provs = app.storage.list();
    const def = app.storage.get(app.defaultProvider) ?? provs[0];
    const others = provs.filter((p) => p !== def).map((p) => p.label);
    const also = others.length ? ` Also available: ${others.join(', ')}.` : '';
    const storage = def?.memory
      ? `This browser blocks storage here, so projects only last until you close this tab. Use Save › Download project file to keep your work.${also}`
      : `Changes autosave to ${def?.label ?? 'This browser'} after your first edit.${also} Use Save to choose where a project lives.`;
    return [
      { sel: '.rail', title: 'Panels', text: `Projects, the sample Library, the Builder and Structure details live here.${touch ? '' : ` ${keyLabel('shift+1')} – 4 open them.`}`, sheet: 'left', panel: 'library' },
      { sel: '.rail [data-panel="build"]', title: 'Build your own', text: 'Build crystals from prototypes, nanoclusters (icosahedra, decahedra, cuboctahedra) and molecules, or paste file text.', sheet: 'none' },
      { sel: '.viewport', title: 'Rotate the view', try: 'camera', tryText: touch ? 'Drag one finger across the view' : isMac ? 'Hold ⌃ Control and drag in the view' : 'Right-drag in the view',
        text: touch ? 'One finger rotates, two fingers pan and pinch to zoom. Tap an atom to see its details.'
          : isMac ? 'As in Materials Studio: right-drag (or ⌃ Control+drag) rotates, middle-drag (or ⌥ Option+drag) pans, scrolling zooms. Hover an atom for details, click or drag to select, double-click for its fragment, ⌃-click for more.'
          : 'As in Materials Studio: right-drag rotates, middle-drag (or Alt+drag) pans, scroll zooms. Hover an atom for details, click or drag to select, double-click for its fragment, right-click for more.', sheet: 'none' },
      { sel: '.inspector .aio-looks, .inspector .grid-cards', title: 'Pick a look', try: 'look', tryText: touch ? 'Tap any look' : 'Click any look',
        text: 'One click sets the material, light and effects together. Below it, choose the representation, colours and sizes.', sheet: 'inspector', tab: 'style' },
      { sel: '.inspector .tabs', title: 'Light, effects, scene', text: 'Shape the light rig, add ambient occlusion, ink outlines, bloom or depth of field, and set the unit cell, supercell, bonds and background.', sheet: 'inspector' },
      { sel: '.toolbar.tb-top', title: 'View tools', text: 'Measure distances and angles, align the view with a crystal axis, switch to orthographic, or start a turntable.', sheet: 'none' },
      { sel: '.proj-title', title: 'Your work is saved', text: storage, sheet: 'none' },
      canDownload() ? { sel: '.top-actions .btn.primary', title: 'Export', text: `Save PNG images up to 4×, a glTF model for Blender or slides, or the structure as CIF, POSCAR, XYZ or PDB.${touch ? ' Tap ? in the top bar for help.' : ` Press ${MOD} K anytime to search every command.`}`, sheet: 'none' } : null,
    ].filter(Boolean);
  }

  _tourPrep(s) {
    const mobile = isMobile();
    if (s.sheet === 'left') { this.leftId = s.panel ?? this.leftId; this.leftOpen = true; if (mobile) this.inspectorOpen = false; else this._opened('left', true); this.renderDrawer(); }
    else if (s.sheet === 'inspector') { if (s.tab) this.tabId = s.tab; this.inspectorOpen = true; if (mobile) this.leftOpen = false; else this._opened('inspector', true); if (s.tab || !this.inspectorBody?.isConnected) this.renderInspector(); }
    else if (s.sheet === 'none' && mobile) { this.leftOpen = false; this.inspectorOpen = false; }
    this.syncPanels();
  }

  /** Guided tour; `start` resumes at a step. Escape skips (and remembers the step), ← and → move. */
  tour(start = 0) {
    if (document.querySelector('.coach')) return;
    closeMenu();
    const app = this.app;
    const steps = this.tourSteps();
    let i = Math.max(0, Math.min(start | 0, steps.length - 1)), seq = 0, offs = [];
    const ring = h('div.coach-ring');
    const card = h('div.coach', { role: 'dialog', 'aria-label': 'Tour', 'aria-live': 'polite' });
    document.body.append(ring, card);
    const unbind = () => { offs.forEach((f) => f()); offs = []; };
    const end = (finished) => {
      unbind(); seq++;
      ring.remove(); card.remove();
      document.removeEventListener('keydown', onKey);
      removeEventListener('resize', onResize);
      if (finished) { app.setPref('tourDone', true); app.setPref('tourStep', null); }
      else if (!app.prefs.tourDone) app.setPref('tourStep', i);
      if (isMobile()) this.closeSheets();
      this.gestureHint();   // (a no-op once the tour has shown the touch gestures)
      return finished;
    };
    const next = () => { if (i >= steps.length - 1) { end(true); toast(isTouch() ? 'You are all set. Tap ? in the top bar for help.' : 'You are all set. Press ? for shortcuts.'); } else { i++; show(); } };
    const back = () => { if (i > 0) { i--; show(); } };
    const skip = () => { end(false); toast(`Tour skipped. Resume it from Help (${isTouch() ? 'the ? button' : '?'}) any time.`); };
    const onKey = (e) => {
      if (modalOpen() || e.defaultPrevented || isTextField(e.target) || e.target.closest?.('input[type="range"]')) return;
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);
    const place = () => {
      const s = steps[i];
      const el = s.sel.split(',').map((q) => document.querySelector(q.trim())).find((x) => x && x.getClientRects().length);
      el?.scrollIntoView?.({ block: 'nearest' });
      const r = el?.getBoundingClientRect() ?? { left: innerWidth / 2 - 100, top: innerHeight / 2 - 50, width: 200, height: 100, right: innerWidth / 2 + 100, bottom: innerHeight / 2 + 50 };
      Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
      const cw = card.offsetWidth, ch = card.offsetHeight;
      let x = r.right + 14, y = r.top;
      if (x + cw > innerWidth - 12) x = r.left - cw - 14;
      if (x < 12) { x = Math.min(Math.max(12, r.left), innerWidth - cw - 12); y = r.bottom + 14; }
      if (y + ch > innerHeight - 12) y = Math.max(12, r.top - ch - 14);
      if (r.height > innerHeight * 0.6 && r.width > innerWidth * 0.4) { x = r.left + r.width / 2 - cw / 2; y = r.top + Math.min(r.height * 0.12, 60); }
      card.style.left = `${Math.max(12, Math.min(x, innerWidth - cw - 12))}px`; card.style.top = `${Math.max(12, Math.min(y, innerHeight - ch - 12))}px`;
    };
    const onResize = () => requestAnimationFrame(place);
    addEventListener('resize', onResize);
    const done = (token) => {
      if (token !== seq) return;
      unbind();
      card.querySelector('.try')?.replaceChildren(ic('check', 'sm'), h('span', 'Nice — that’s it'));
      card.querySelector('.try')?.classList.add('ok');
      setTimeout(() => { if (token === seq) next(); }, 900);
    };
    const show = () => {
      unbind();
      const token = ++seq;
      const s = steps[i];
      this._tourPrep(s);
      const last = i === steps.length - 1;
      card.replaceChildren(...[   // (replaceChildren would print a null as the text "null")
        s.try ? h('div.try', ic('pointer', 'sm'), h('span', `Try it: ${s.tryText}`)) : null,
        h('h3', s.title), h('p', s.text),
        h('div.foot', h('span.n', `${i + 1} / ${steps.length}`),
          btn('Skip tour', { cls: 'ghost small', on: skip }),
          btn('Back', { cls: 'small', disabled: i === 0, on: back }),
          btn(last ? 'Finish' : 'Next', { cls: 'primary small', on: next })),
      ].filter(Boolean));
      if (s.try === 'look') { const look0 = app.scene.look; offs.push(app.on('scene', () => { if (app.scene.look && app.scene.look !== look0) done(token); })); }
      if (s.try === 'camera' && isTouch()) app.setPref('gestureHintShown', true);   // this step teaches the gestures
      if (s.try === 'camera') { const t0 = performance.now(); offs.push(app.viewer.on('camera', () => { if (performance.now() - t0 > 500) done(token); })); }
      requestAnimationFrame(() => requestAnimationFrame(() => { if (token !== seq) return; place(); card.querySelector('.btn.primary')?.focus({ preventScroll: true }); }));
    };
    show();
  }
}

export { confirmDialog };
