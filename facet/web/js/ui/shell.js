/**
 * Application shell, laid out as Materials Studio is (ui/workbench.js): a menu bar (ui/menubar.js) and toolbars at the
 * top, the Project and Properties explorers on the left, document windows in the workspace, a tool window for each
 * panel and each appearance tab floating over it, and a status bar; plus the viewport overlays,
 * shortcuts, the command palette and the tour. On phones the menu bar and the toolbars give way to a compact top bar
 * whose More menu holds the same menus, and the panels open as sheets.
 */
import { h, ic, btn } from './dom.js';
import { MenuBar, appMenus, menuItems, compactMenu } from './menubar.js';
import { MENU_ICONS, MENU_LABELS, commandShown, flattenMenus } from './menumodel.js';
import { styles } from '../render/styles.js';
import { looks } from '../render/looks.js';
import { LOGO } from './icons.js';
import { toast, showMenu, closeMenu, menuOpen, dialog, openModal, modalOpen, installTooltips, confirmDialog } from './overlays.js';
import { commands } from '../core/commands.js';
import { relativeTime, debounce } from '../core/util.js';
import { element } from '../core/elements.js';
import { elementColorHex } from '../render/colors.js';
import { tools, toolHint, genericHud, toolKeyProblems } from '../render/tools/index.js';
import { formats } from '../io/index.js';
import { samples } from '../build/samples.js';
import { VERSION } from '../app.js';
import { keyLabel, matchKey, parseKey, hasMod, isMac, MOD, ALT } from './keys.js';
import { canDownload, NO_DOWNLOADS } from '../storage/files.js';
import { SelectionCard, selectSameElement, selectNeighbours, selectFragment, selectAll, measureFrom, selectionActions, actionMenuItems, menuTarget, deleteSelection } from './selectioncard.js';
import { attachSections, openSection, panelSections } from './sections.js';
import { atomInfoRows } from './atominfo.js';
import { Workbench } from './workbench.js';
import { pasteFromClip } from './mscommands.js';

export const leftPanels = new Map();
export const inspectorTabs = new Map();
let current = null;   // the Shell once built: panels registered later (plugins) are added to it right away

/**
 * Register a panel {id, title, icon, tip, render(app, el, shell), headActions?, refreshOn?, signature?}: a tool
 * window of its own on desktops, the drawer sheet on phones.
 */
export function registerLeftPanel(p) {
  leftPanels.set(p.id, p);
  current?.renderRail();
  return () => {
    leftPanels.delete(p.id);
    if (!current) return;
    current.bench?.tools.forget('panel', p.id);
    current.renderRail();
    if (current.leftId === p.id) { current.leftId = leftPanels.keys().next().value; current.renderDrawer(); }
  };
}
/**
 * Register an appearance tab {id, title, icon, tip, render(app, el, shell), windowTitle?}: a tool window of its own
 * on desktops (titled `windowTitle`, else as ui/workbench.js TAB_TITLES says), a tab of the inspector sheet on phones.
 */
export function registerInspectorTab(t) {
  inspectorTabs.set(t.id, t);
  current?.renderInspector();
  return () => { inspectorTabs.delete(t.id); current?.bench?.tools.forget('tab', t.id); current?.renderInspector(); };
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

// palette ranking (titles and the Materials Studio aliases) and the category order: ui/rank.js, re-exported here
import { rankCommands, byCategory } from './rank.js';
export { rankCommands, CATEGORY_ORDER } from './rank.js';
/** The grey alias after a palette result's title, when the query matched that alias rather than the title. */
const ALIAS_STYLE = { color: 'var(--muted)', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' };

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

/** Whether app event `reason` may change panel `p` (its refreshOn, or the rule for panels without one). */
const LEGACY_REFRESH = { project: null, structure: ['structure', 'build'], selection: ['structure'], measure: ['structure'], providers: ['projects'], auth: ['projects'] };
function wantsRefresh(p, reason) {
  return Array.isArray(p.refreshOn) ? p.refreshOn.includes(reason) : (LEGACY_REFRESH[reason] === null || !!LEGACY_REFRESH[reason]?.includes(p.id));
}

const ident = (el) => (el.dataset?.key ? `k:${el.dataset.key}` : `${el.tagName}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 60)}`);

export class Shell {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.registries = { panel: leftPanels, tab: inspectorTabs };
    // desktops: every panel and every appearance tab has a tool window of its own, floating over the workspace as
    // Materials Studio's dialogs do (ui/workbench.js ToolWindows: any number open at once, where they were left);
    // phones: the panels take turns in the drawer sheet and the tabs in the inspector sheet, both closed at the start
    this.leftId = app.prefs.leftPanel ?? 'library';   // the panel shown or opened last
    this.tabId = app.prefs.inspectorTab ?? 'style';   // the tab shown or opened last
    this.leftOpen = false;        // the sheets (phones)
    this.inspectorOpen = false;
    this._drawerScroll = {};      // scroll positions, by panel and by tab
    this._inspectorScroll = {};
    attachSections(this);   // panel sections (Surface panel, Structure panel slots) follow app events and open through openSection()
    this.build();
    current = this;
    installTooltips(document.body);
    this.bindShortcuts();
    this.bindDrop();
    this.bindApp();
    this.bindViewer();
    // crossing the phone breakpoint: the sheets close; the tool windows go, and come back as they were on a desktop.
    // What one layout drew is dropped, so a panel is drawn in one place at a time (panels keep state of their own)
    matchMedia('(max-width: 920px)').addEventListener?.('change', () => {
      app.viewer.fitMargins = fitMargins();
      closeMenu();
      this._placeChrome();   // the toolbar groups move between the strip and the phone layout
      this.leftOpen = false; this.inspectorOpen = false;
      for (const ho of [this.drawerHost, this.inspectorHost, ...(this.bench?.tools.hosts() ?? [])]) this._clearHost(ho);
      this.syncPanels();   // (bench.place() draws the tool windows that are open again)
    });
    app.viewer.fitMargins = fitMargins();
  }

  // ------------------------------------------------------------------ layout
  build() {
    const app = this.app;
    this.titleInput = h('input', { id: 'project-name', value: app.project.name, 'aria-label': 'Project name', spellcheck: false, 'data-tip': 'Click to rename the project' });
    this.titleInput.addEventListener('change', () => app.rename(this.titleInput.value.trim()));
    this.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.titleInput.blur(); if (e.key === 'Escape') { this.titleInput.value = app.project.name; this.titleInput.blur(); } });
    this.saveChip = h('button.save-chip', { type: 'button', 'data-state': 'idle', 'aria-haspopup': 'menu' }, h('span.dot'), h('span.lbl', 'Not saved yet'));
    this.saveChip.addEventListener('click', () => this.saveMenu(this.saveChip));
    // the Standard toolbar: New, Open, Save, Export | Undo, Redo (on phones it sits in the top bar)
    this.undoBtn = btn('', { icon: 'undo', cls: 'ghost icon hist', tip: 'Undo', kbd: keyLabel('mod+z'), on: () => app.undo() });
    this.redoBtn = btn('', { icon: 'redo', cls: 'ghost icon hist', tip: 'Redo', kbd: keyLabel('mod+shift+z'), on: () => app.redo() });
    const newBtn = btn('', { icon: 'filePlus', cls: 'ghost icon desktop-only', tip: 'New project', on: () => this.runCommand('project.new') });
    const openBtn = btn('', { icon: 'open', cls: 'ghost icon desktop-only', tip: 'Open structure or project files (CIF, POSCAR, XYZ, PDB, XSD, JSON)', kbd: keyLabel('mod+o'), on: () => commands.run('file.open') });
    const saveBtn = btn('', { icon: 'save', cls: 'ghost icon', tip: 'Save the project', kbd: keyLabel('mod+s'), on: (e) => this.saveMenu(e.currentTarget) });
    saveBtn.setAttribute('aria-haspopup', 'menu');
    this.exportBtn = btn('Export', { icon: 'download', cls: 'primary export', tip: 'Export an image, 3D model or structure file', on: (e) => this.exportMenu(e.currentTarget) });
    this.exportBtn.setAttribute('aria-haspopup', 'menu');
    this.stdGroup = h('div.tgroup.std', { role: 'group', 'aria-label': 'Standard' }, newBtn, openBtn, saveBtn, this.exportBtn, h('span.sep.desktop-only'), this.undoBtn, this.redoBtn);
    const paletteBtn = btn('', { icon: 'search', cls: 'ghost icon desktop-only', tip: 'Command palette — find any action, also by its Materials Studio name', kbd: keyLabel('mod+k'), on: () => this.openPalette() });
    const helpBtn = btn('', { icon: 'help', cls: 'ghost icon mobile-only', tip: 'Help, shortcuts and tour', kbd: '?', on: (e) => this.helpMenu(e.currentTarget) });
    this.themeBtn = btn('', { icon: 'moon', cls: 'ghost icon desktop-only', tip: 'Switch light / dark interface', on: () => this.cycleTheme() });
    const moreBtn = btn('', { icon: 'more', cls: 'ghost icon mobile-only', tip: 'Menus', on: (e) => this.moreMenu(e.currentTarget) });
    moreBtn.setAttribute('aria-haspopup', 'menu');
    this.userSlot = h('span.user-slot');
    // the menu bar: File, Edit, View, Modify, Build, Tools, Window, Help (phones: the More menu holds them)
    this.menubar = new MenuBar(this, leftPanels);
    this.topActions = h('div.top-actions', this.userSlot, paletteBtn, helpBtn, this.themeBtn, moreBtn);
    this.top = h('header.topbar',
      h('div.brand', { html: LOGO }, h('span.name', 'Facet'), h('span.ver', `v${VERSION}`)),
      this.menubar.el,
      h('div.proj-title', this.titleInput, this.saveChip),
      this.topActions,
    );
    // the toolbar strip under it: Standard | 3D Viewer | display style and look | Build … image and full screen
    this.repPick = this._picker('Display style', 'style', () => this.familyMenu('rep.', 'Display style'));
    this.lookPick = this._picker('Look', 'sparkles', () => this.familyMenu('look.', 'Look'));
    this.buildGroup = h('div.tgroup.buildg', { role: 'group', 'aria-label': 'Build' });
    this.stdSlot = h('div.tslot');
    this.viewSlot = h('div.tslot');
    this.shotSlot = h('div.tslot');
    this.strip = h('div.toolstrip', { role: 'toolbar', 'aria-label': 'Toolbars' },
      this.stdSlot, h('span.sep'), this.viewSlot, h('span.sep'),
      h('div.tgroup.display', { role: 'group', 'aria-label': 'Display' }, this.repPick, this.lookPick), h('span.sep.build-sep'),
      this.buildGroup, h('span.grow'), this.shotSlot);

    this.rail = h('nav.rail', { 'aria-label': 'Explorers' });
    this.drawer = h('aside.drawer', { 'aria-label': 'Side panel' });
    this.inspector = h('aside.inspector', { 'aria-label': 'Appearance' });
    this.viewport = this.root.querySelector('.viewport');
    this.stage = this.root.querySelector('.stage');
    this.root.prepend(this.top, this.strip);
    this.root.append(this.rail, this.drawer, this.inspector);
    // a re-render waiting for the user to leave a text field runs when they do (_host); the pointer's last press says
    // which window a control that changes the scene is in (quiet)
    this._pointerDown = false;
    this._changeIn = null;
    addEventListener('pointerdown', (e) => { this._pointerDown = true; this._pointerHost = this._hostAt(e.target); }, true);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { this._pointerDown = false; }, true);
    this.drawerHost = this._host('panel', this.drawer, { isOpen: () => this.leftOpen });
    this.inspectorHost = this._host('tab', this.inspector, { isOpen: () => this.inspectorOpen });
    this.buildOverlays();
    this.bench = new Workbench(this);   // explorers, document windows, tool windows, toolbars, status bar
    this._placeChrome();
    this.renderToolstrip();
    this.renderRail();
    this.renderDrawer();
    this.renderInspector();
    this.bench.tools.restore();   // desktops: the tool windows that were open last time
    this.applyTheme(this.app.prefs.theme ?? 'system');
    this.syncDownloads();
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
    this.renderToolstrip();   // what brings a new panel (start-up, a plugin) may bring commands for the strip too
    this.syncPanels();
  }
  buildRail() { this.renderRail(); }

  // ------------------------------------------------------------------ panels and appearance tabs: opening and closing
  /**
   * Phones: show panel `id` in the drawer sheet, or close the sheet when it shows it. Desktops: open the panel's tool
   * window, or close it when it is open (View › Explorers).
   */
  toggleLeft(id = this.leftId) {
    if (this.bench?.desktop) {
      if (this.bench.tools.isOpen('panel', id)) this.bench.tools.close('panel', id);
      else this._openWindow('panel', id);
      return;
    }
    if (this.leftOpen && this.leftId === id) this.leftOpen = false;   // closing the only panel: a clear view is wanted
    else { this.leftOpen = true; this.leftId = id ?? this.leftId; this.inspectorOpen = false; }
    this.app.setPref('leftPanel', this.leftId);
    this.syncPanels();
    this.renderDrawer();
  }

  /**
   * Open a panel: its tool window on desktops (drawn afresh, to the front), the drawer on phones. `args` are handed
   * once to its render through panelArgs(), e.g. {provider: 'server'} for Projects; {section, focus, tab} opens the
   * panel at one of its sections instead (openSection in ui/sections.js).
   */
  openLeft(id, args) {
    if (args?.section) return openSection(id, args.section, { focus: args.focus, tab: args.tab });
    this._panelArgs = args ? { id, args } : null;
    if (this.bench?.desktop) { this._openWindow('panel', id); return; }
    this.leftOpen = false; this.toggleLeft(id);
  }
  /** The args openLeft() passed for panel `id`, or null; each set is read once. */
  panelArgs(id) { const a = this._panelArgs; if (a?.id !== id) return null; this._panelArgs = null; return a.args; }
  /** Projects panel on the server's sign-in form (or project list once signed in). */
  openSignIn() { this.openLeft('projects', { provider: 'server' }); }

  /** Desktops: the tool window of panel / tab `id`, drawn afresh, to the front, with the keyboard in it. */
  _openWindow(kind, id) {
    if (!this.registries[kind].has(id)) return;
    if (kind === 'panel') { this.leftId = id; this.app.setPref('leftPanel', id); }
    else { this.tabId = id; this.app.setPref('inspectorTab', id); }
    this.bench.tools.open(kind, id);
  }

  /**
   * Phones: show or hide the inspector sheet. Desktops (]): close the appearance windows that are open, or bring
   * back the ones closed so (none: the window of the tab opened last, Display Style at first).
   */
  toggleInspector(open) {
    if (this.bench?.desktop) { this.bench.tools.toggleKind('tab', open, this.tabId); return; }
    open = open ?? !this.inspectorOpen;
    this.inspectorOpen = open;
    if (open) this.leftOpen = false;
    this.syncPanels();
    if (open) this.renderInspector();
  }
  /** Open appearance tab `tab` (else the one opened last): its window on desktops, the inspector sheet at it on phones. */
  openInspector(tab) {
    const id = tab && inspectorTabs.has(tab) ? tab : this.tabId;
    if (this.bench?.desktop) { this._openWindow('tab', id); return; }
    this.tabId = id; this.app.setPref('inspectorTab', id);
    this.toggleInspector(true);
  }
  /** [ on desktops: close the panel windows that are open, or bring back the ones closed so; phones: the drawer. */
  togglePanels() {
    if (this.bench?.desktop) { this.bench.tools.toggleKind('panel', undefined, this.leftId); return; }
    this.toggleLeft(this.leftId);
  }
  /** Close the drawer and inspector sheets (phones). */
  closeSheets() { this.leftOpen = false; this.inspectorOpen = false; this.syncPanels(); }

  /** Whether panel `id` is on screen: its window (desktops), the drawer showing it (phones). */
  panelOpen(id) { return this.bench?.desktop ? this.bench.tools.isOpen('panel', id) : this.leftOpen && this.leftId === id; }
  /** Whether appearance tab `id` is on screen: its window (desktops), the inspector showing it (phones). */
  tabOpen(id) { return this.bench?.desktop ? this.bench.tools.isOpen('tab', id) : this.inspectorOpen && this.tabId === id; }
  /** Whether a panel window is open (phones: the drawer), for the check mark of Window › Panel Windows. */
  panelsShown() { return this.bench?.desktop ? this.bench.tools.anyOpen('panel') : !!this.leftOpen; }
  /** Whether an appearance window is open (phones: the inspector), for Window › Display Windows. */
  tabsShown() { return this.bench?.desktop ? this.bench.tools.anyOpen('tab') : !!this.inspectorOpen; }
  /** The element panel `id` is drawn in (its window, else the drawer), to find a part of it. */
  panelEl(id) { return this._hostOf('panel', id)?.el ?? this.drawer; }
  /** The element appearance tab `id` is drawn in (its window, else the inspector). */
  tabEl(id) { return this._hostOf('tab', id)?.el ?? this.inspector; }

  syncPanels() {
    this.drawer.dataset.collapsed = String(!this.leftOpen);
    this.inspector.dataset.collapsed = String(!this.inspectorOpen);
    this.rail.querySelectorAll('button[data-panel]').forEach((b) => {
      const id = b.dataset.panel;
      b.setAttribute('aria-pressed', String(id === '__inspector' ? this.inspectorOpen : this.leftOpen && this.leftId === id));
    });
    if (this.revealBtn) this.revealBtn.hidden = this.inspectorOpen;
    // a sheet that opens after events came while it was closed is drawn again
    if (this.leftOpen && this.drawerHost?.stale) this.drawerHost.soon();
    if (this.inspectorOpen && this.inspectorHost?.stale) this.inspectorHost.soon();
    this.bench?.place();
    requestAnimationFrame(() => this.app.viewer.resize());
  }

  // ------------------------------------------------------------------ hosts: where a panel or a tab is drawn
  /**
   * A host is a place a panel (`kind` 'panel') or an appearance tab ('tab') is drawn in: the drawer and inspector
   * sheets of phones, which show the panel / tab opened last (leftId, tabId), or a tool window of the desktop, which
   * always shows the same one (`id`). It keeps what it drew (body, shown, sig) and whether a re-render waits for the
   * user to leave a field (pending) or for it to be on screen (stale); `el` gets the listeners for that.
   */
  _host(kind, el, { id = null, isOpen }) {
    const ho = { kind, el, fixed: id != null, isOpen, body: null, shown: null, sig: undefined, pending: false, stale: false };
    if (ho.fixed) ho.id = id;
    else Object.defineProperty(ho, 'id', { enumerable: true, get: () => (kind === 'panel' ? this.leftId : this.tabId) });
    const draw = () => {
      if (this._deferRender(ho)) return;
      if (ho.fixed && !ho.isOpen()) { ho.stale = true; return; }
      this._render(ho);
    };
    ho.soon = debounce(draw, 30);     // after an app event
    ho.later = debounce(draw, 160);   // after a control of another window (a slider being dragged): once it rests
    el.addEventListener('focusout', () => this._flushLater(ho));
    // a field that loses focus (Tab, click elsewhere) fires 'change' while the focus is between elements;
    // rebuilding the panel right then would drop the focus on <body>, so such a re-render waits for it to land
    el.addEventListener('change', () => { this._changeIn = el; setTimeout(() => { if (this._changeIn === el) this._changeIn = null; }, 0); }, true);
    return ho;
  }
  /** The hosts of the layout in use (phones: the two sheets; desktops: the tool windows made so far), of `kind`. */
  _hosts(kind) {
    const all = !this.bench || isMobile() ? [this.drawerHost, this.inspectorHost].filter(Boolean) : this.bench.tools.hosts();
    return kind ? all.filter((ho) => ho.kind === kind) : all;
  }
  /** The host that shows (or would show) panel / tab `id` in the layout in use, else null. */
  _hostOf(kind, id) { return this._hosts(kind).find((ho) => ho.id === id) ?? null; }
  /** The host element `el` is in, else null. */
  _hostAt(el) { return el?.nodeType === 1 ? this._hosts().find((ho) => ho.el.contains(el)) ?? null : null; }
  /** Forget what host `ho` drew (the layout changed): it is drawn afresh when it is on screen again. */
  _clearHost(ho) {
    if (!ho) return;
    ho.soon?.cancel?.(); ho.later?.cancel?.();
    if (ho.body && ho.shown) (ho.kind === 'panel' ? this._drawerScroll : this._inspectorScroll)[ho.shown] = ho.body.scrollTop;
    ho.el.replaceChildren();
    ho.body = null; ho.shown = null; ho.sig = undefined; ho.pending = false; ho.stale = true;
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
  /** Defer a re-render of host `ho` until the user leaves the field they are typing in (or the focus has moved). */
  _deferRender(ho) {
    const box = ho.el;
    if (!this._typingIn(box) && !this._focusMoving(box)) return false;
    ho.pending = true;
    if (this._focusMoving(box)) setTimeout(() => this._flushLater(ho), 0);   // in case no focusout follows
    return true;
  }
  _flushLater(ho) {
    if (!ho.pending) return;
    const run = () => setTimeout(() => {
      if (!ho.pending || this._typingIn(ho.el)) return;
      ho.pending = false;
      if (ho.fixed && !ho.isOpen()) { ho.stale = true; return; }
      this._render(ho);
    }, 0);
    // wait for the click that moved focus (e.g. on "Apply") to land before the panel is rebuilt
    if (this._pointerDown) addEventListener('pointerup', run, { once: true, capture: true }); else run();
  }

  /** Draw host `ho` afresh: its panel or its tab. */
  _render(ho) { if (ho) (ho.kind === 'panel' ? this._renderPanel(ho) : this._renderTab(ho)); }

  _renderPanel(ho) {
    const p = leftPanels.get(ho.id) ?? (ho.fixed ? null : leftPanels.values().next().value);
    if (!p) return;
    if (!ho.fixed) this.leftId = p.id;
    const box = ho.el;
    const focus = this._captureFocus(box);
    if (ho.body && ho.shown) this._drawerScroll[ho.shown] = ho.body.scrollTop;
    box.replaceChildren();
    const body = h('div.panel-body');
    box.setAttribute('aria-label', p.title);
    if (ho.fixed) box.append(...this.bench.tools.bar(ho, p), body);
    else {
      const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close panel', on: () => { this.leftOpen = false; this.syncPanels(); } });
      box.append(h('div.panel-head', p.icon ? ic(p.icon, 'sm tw-ic') : null, h('h2', p.title), ...(p.headActions?.(this.app, this) ?? []), close), body);
    }
    ho.body = body;
    ho.shown = p.id;
    // this render shows the current state, so a refresh queued before it (e.g. by the event that caused it) is
    // done; left queued it would rebuild the panel again later, under a click on the freshly drawn controls
    ho.soon.cancel(); ho.later.cancel();
    ho.pending = false;
    ho.stale = false;
    const was = this._rendering;
    this._rendering = ho;
    try { p.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This panel failed to load: ${e.message}`)); }
    finally { this._rendering = was; }
    try { ho.sig = p.signature?.(this.app); } catch { ho.sig = undefined; }
    const y = this._drawerScroll[p.id] ?? 0;
    body.scrollTop = y;
    if (y && body.scrollTop < y) requestAnimationFrame(() => { if (ho.body === body) body.scrollTop = y; });
    body.addEventListener('scroll', () => { this._drawerScroll[p.id] = body.scrollTop; }, { passive: true });
    this._restoreFocus(box, focus);
  }

  /** Draw panel `id` again now wherever it is shown (every panel on screen when `id` is left out). */
  renderDrawer(id) {
    for (const ho of this._hosts('panel')) {
      if (id != null && ho.id !== id) continue;
      if (ho.fixed && !ho.isOpen()) { ho.stale = true; continue; }   // a closed window is drawn when it opens
      this._render(ho);
    }
  }

  /**
   * Re-render the panels after an app event. A panel may declare `refreshOn: ['project', …]` and a
   * `signature(app)` string; it is skipped when the signature did not change. While the user types in
   * a panel the refresh waits until they leave the field.
   */
  refreshDrawer(reason) {
    for (const ho of this._hosts('panel')) {
      const p = leftPanels.get(ho.id);
      if (!p || !wantsRefresh(p, reason)) continue;
      if (typeof p.signature === 'function' && ho.shown === p.id) { let sig; try { sig = p.signature(this.app); } catch { sig = NaN; } if (sig === ho.sig) continue; }
      if (!ho.isOpen()) { ho.stale = true; continue; }
      if (this._deferRender(ho)) continue;
      ho.soon();
    }
  }

  /** Draw panel `id` again soon where it is shown (after the user leaves a field they type in), e.g. when its sections change. */
  refreshPanel(id) {
    this.renderToolstrip();   // a section that came or went may bring or take the command of a strip button
    const ho = this._hostOf('panel', id);
    if (!ho) return;
    if (!ho.isOpen()) { ho.stale = true; return; }
    if (this._deferRender(ho)) return;
    ho.soon();
  }

  /**
   * For the panel sections (ui/sections.js): 'hidden' when panel `id` is not on screen, 'rebuild' when the events
   * `reasons` (or a pending refresh) draw it again as a whole, else 'current' (its sections refresh one by one).
   */
  panelState(id, reasons = []) {
    const p = leftPanels.get(id);
    const ho = p ? this._hostOf('panel', id) : null;
    if (!ho || !ho.isOpen() || ho.shown !== id || !ho.body?.isConnected) return 'hidden';
    if (ho.stale || ho.pending) return 'rebuild';
    if (!reasons.some((r) => wantsRefresh(p, r))) return 'current';
    if (typeof p.signature !== 'function') return 'rebuild';
    let sig; try { sig = p.signature(this.app); } catch { sig = NaN; }
    return sig === ho.sig ? 'current' : 'rebuild';
  }

  _renderTab(ho) {
    const tabs = [...inspectorTabs.values()];
    if (!tabs.length) return;
    const t = inspectorTabs.get(ho.id) ?? (ho.fixed ? null : tabs[0]);
    if (!t) return;
    if (!ho.fixed) this.tabId = t.id;
    const box = ho.el;
    const focus = this._captureFocus(box);
    if (ho.body && ho.shown) this._inspectorScroll[ho.shown] = ho.body.scrollTop;
    box.replaceChildren();
    let body;
    if (ho.fixed) {
      body = h('div.panel-body');
      box.append(...this.bench.tools.bar(ho, t), body);
    } else {
      // the inspector sheet (phones): the tabs over the one shown
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
        box.querySelector(`[data-key="tab:${CSS.escape(next.id)}"]`)?.focus();
      });
      const close = btn('', { icon: 'x', cls: 'ghost icon close-mobile', tip: 'Close', on: () => this.toggleInspector(false) });
      body = h('div.panel-body', { role: 'tabpanel', id: 'inspector-panel', 'aria-labelledby': `itab-${t.id}` });
      box.append(h('div.insp-head', tabBar, close), body);
    }
    ho.body = body;
    ho.shown = t.id;
    ho.soon.cancel(); ho.later.cancel();
    ho.pending = false;
    ho.stale = false;
    const y = this._inspectorScroll[t.id] ?? 0;
    const was = this._rendering;
    this._rendering = ho;
    try { t.render(this.app, body, this); } catch (e) { console.error(e); body.append(h('p.err-text', `This tab failed to load: ${e.message}`)); }
    finally { this._rendering = was; }
    body.scrollTop = y;
    body.addEventListener('scroll', () => { this._inspectorScroll[t.id] = body.scrollTop; }, { passive: true });
    this._restoreFocus(box, focus);
  }

  /** Draw appearance tab `id` again now wherever it is shown (every tab on screen when `id` is left out). */
  renderInspector(id) {
    for (const ho of this._hosts('tab')) {
      if (id != null && ho.id !== id) continue;
      if (ho.fixed && !ho.isOpen()) { ho.stale = true; continue; }
      this._render(ho);
    }
  }

  /** The tab bar of the inspector sheet: show tab `id` there (desktops: open its window). */
  selectTab(id) {
    if (this.bench?.desktop) { this.openInspector(id); return; }
    this.tabId = id; this.app.setPref('inspectorTab', id); this.renderInspector();
  }

  /**
   * The appearance tabs follow the scene: each one on screen is drawn again, except the one whose control made the
   * change (quiet); the tabs of other windows catch up once that control rests (a slider being dragged).
   */
  refreshInspector() {
    const src = this._quietHost;
    if (src === true) return;   // a control in no known window: no tab is drawn again (as before there were windows)
    for (const ho of this._hosts('tab')) {
      if (ho === src) continue;
      if (!ho.isOpen()) { ho.stale = true; continue; }
      if (this._deferRender(ho)) continue;
      (src ? ho.later : ho.soon)();
    }
  }
  /**
   * Wrap a control callback so the change it makes does not draw again the window (or sheet) it lives in: the one
   * being drawn when the callback was made, else the one with the focus or the last press of the pointer.
   */
  quiet(fn) {
    const at = this._rendering ?? null;
    return (...a) => {
      const prev = this._quietHost;
      this._quietHost = at ?? this._hostAt(document.activeElement) ?? (this._pointerDown ? this._pointerHost : null) ?? true;
      try { return fn(...a); } finally { this._quietHost = prev; }
    };
  }

  // ------------------------------------------------------------------ viewport overlays
  buildOverlays() {
    const app = this.app;
    this.infoCard = h('div.float.info-card', { 'aria-live': 'polite' });
    this.hover = h('div.float.hovercard', { hidden: true });
    this.hintText = h('span.hint-text.pill');
    this.statText = h('span.stat.pill');
    this.statusbar = h('div.float.statusbar', this.hintText, this.statText);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this._fitHint()).observe(this.statusbar);   // panels opened or closed
    // toolbar: Select and Measure (a menu), then the registered tools with toolbar: true (renderToolButtons); a tool's
    // key is only shown here, its command binds it (M7 KC-03)
    const toolKey = (id) => { const k = tools.get(id)?.key; return k ? keyLabel(k) : null; };
    this.selectBtn = btn('', { icon: 'pointer', cls: 'icon', tip: 'Select and inspect atoms', kbd: toolKey('select'), on: () => app.setTool('select') });
    this.measureBtn = btn('', { icon: 'ruler', cls: 'icon', tip: 'Measure distance, angle or dihedral', kbd: toolKey('measure'), on: (e) => this.measureMenu(e.currentTarget) });
    const viewBtn = btn('', { icon: 'axes', cls: 'icon', tip: 'View along an axis', kbd: 'A B C · X Y Z', on: (e) => this.viewMenu(e.currentTarget) });
    this.projBtn = btn('', { icon: 'projection', cls: 'icon', tip: 'Perspective / orthographic', kbd: 'P', on: () => commands.run('view.projection') });
    this.spinBtn = btn('', { icon: 'turntable', cls: 'icon', tip: 'Turntable (auto-rotate)', kbd: 'T', on: () => commands.run('view.turntable') });
    this.cameraBtn = btn('', { icon: 'camera', cls: 'icon', tip: 'Save a 2× PNG image', kbd: keyLabel('mod+e'), on: () => this.runCommand('export.png2') });
    this.fsBtn = btn('', { icon: 'maximize', cls: 'icon', tip: 'Full screen', kbd: keyLabel('shift+f'), pressed: false, on: () => this.fullscreen() });
    viewBtn.setAttribute('aria-haspopup', 'menu');
    this.measureBtn.setAttribute('aria-haspopup', 'menu');
    // the 3D Viewer tools and the image / full-screen pair: in the toolbar strip on desktop, in the floating
    // toolbar of the view on phones and in full screen, where there is no strip (_placeChrome)
    this.viewGroup = h('div.tgroup.view-tools', { role: 'group', 'aria-label': '3D Viewer' },
      this.selectBtn, this.measureBtn, h('span.sep'),
      btn('', { icon: 'reset', cls: 'icon', tip: 'Reset view', kbd: keyLabel('Home'), on: () => app.viewer.resetView() }),
      btn('', { icon: 'fit', cls: 'icon', tip: 'Fit to screen', kbd: 'F', on: () => app.viewer.fitView() }),
      viewBtn, this.projBtn, this.spinBtn);
    this.shotGroup = h('div.tgroup.shot', { role: 'group', 'aria-label': 'Image and full screen' }, this.cameraBtn, this.fsBtn);
    this.toolbar = h('div.float.toolbar.tb-top', { role: 'toolbar', 'aria-label': 'View tools', 'aria-orientation': 'vertical' });
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
      (this.emptyHead = h('h2', 'Start with a structure')),
      this.emptyText,
      this.emptyTiles,
      h('div.acts',
        btn('Open file', { icon: 'open', cls: 'primary', kbd: keyLabel('mod+o'), tip: 'Open CIF, POSCAR, XYZ, PDB, Materials Studio XSD or Facet files', on: () => commands.run('file.open') }),
        btn('Browse samples', { icon: 'library', on: () => this.browseSamples() }),
        btn('Build', { icon: 'build', on: () => this.openLeft('build') }),
        btn('Paste text', { icon: 'clipboard', cls: 'desktop-only', on: () => this.runCommand('file.paste') })),
    ));
    this.drop = h('div.float.dropzone', { hidden: true }, h('div', h('b', 'Drop structure or project files to open them'), h('small', `CIF, POSCAR, XYZ, PDB, XSD or .facet.json · you can also paste file text with ${keyLabel('mod+v')}`)));
    // the tool HUD (class kept from when only Measure had one): toolDef.hud(app, env), or the generic one
    this.measureHud = h('div.float.measure-hud', { hidden: true, role: 'status' });
    this.stage.append(this.infoCard, this.toolbar, this.revealBtn, this.statusbar, this.hover, this.trajbar, this.empty, this.drop, this.measureHud);
    this.selCard = new SelectionCard(this);
    this.toolBtns = new Map();   // tool id → toolbar button, for the registered tools after Select and Measure
    this.renderToolButtons();
    // tools that come or go later (plugins): new buttons, and the app leaves a tool that went away
    tools.onChange(() => { this.renderToolButtons(); app._toolsChanged?.(); this.updateHint(); this._checkToolKeysSoon(); });
    this._checkToolKeysSoon();   // once the start-up has registered the commands
  }

  // ------------------------------------------------------------------ toolbar strip
  /** A drop-down button of the toolbar strip that shows a current choice (the display style, the look). */
  _picker(caption, icon, open) {
    const label = h('span.lbl');
    const b = h('button.btn.ghost.pick', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': caption, 'data-tip': caption }, ic(icon), label, ic('chevronDown', 'sm caret'));
    b._label = label;
    b.addEventListener('click', () => open(b));
    return b;
  }

  /** The menu of a command family (rep., look., light., color.) under a toolbar button, the current one checked. */
  familyMenu(prefix, label, anchor = prefix === 'rep.' ? this.repPick : this.lookPick) {
    const key = { 'rep.': 'rep', 'look.': 'look', 'light.': 'lighting', 'color.': 'colorScheme' }[prefix];
    const entry = { family: prefix, label: (c) => c.title ?? c.id, radio: true, checked: (c, st) => st[key] === c.id.slice(prefix.length) };
    return showMenu(anchor, [{ header: label }, ...menuItems(this.app, this, leftPanels, [entry])], { label });
  }

  /**
   * Put the toolbar groups where this layout shows them: the Standard group in the strip, or in the top bar on
   * phones; the 3D Viewer tools and the image / full-screen pair in the strip, or in the floating toolbar of the
   * view on phones and in full screen. One set of buttons, so their state is kept in one place.
   */
  _placeChrome() {
    const mobile = isMobile(), floating = mobile || !!this.root.dataset.fullscreen;
    (mobile ? this.topActions : this.stdSlot).prepend(this.stdGroup);
    if (floating) this.toolbar.replaceChildren(this.viewGroup, h('span.sep'), this.shotGroup);
    else { this.toolbar.replaceChildren(); this.viewSlot.append(this.viewGroup); this.shotSlot.append(this.shotGroup); }
    this._syncViewTools();
    this.bench?.place();
  }

  /** Without a structure the view tools have nothing to work on: greyed in the strip, the floating toolbar hidden. */
  _syncViewTools() {
    if (!this.toolbar) return;
    const s = !!this.app.structure;
    this.toolbar.hidden = !s || !this.toolbar.childElementCount;
    for (const b of this.viewGroup?.querySelectorAll?.('button') ?? []) b.disabled = !s;
  }

  /**
   * The Build group of the strip: Build crystal, Cleave surface, Build vacuum slab, Supercell, each only once its
   * command is there for real (not the fallback of a section nobody has registered). Called again when commands or
   * panel sections come or go.
   */
  renderToolstrip() {
    if (!this.buildGroup) return;
    const env = { hasSection: (panel, section) => panelSections(panel).some((x) => x.id === section && !x.placeholder) };
    const made = [];
    for (const id of ['build.crystal', 'build.cluster', 'build.molecule', 'build.addAtom', 'surface.cleave', 'surface.vacuum', 'cell.supercell', 'cell.parameters']) {
      const c = commands.get(id);
      if (!c || !commandShown(c, env)) continue;
      const key = c.kbd ?? c.key;
      const b = btn('', { icon: MENU_ICONS[id] ?? 'build', cls: 'ghost icon', tip: (MENU_LABELS[id] ?? c.title).replace(/…$/, ''), kbd: key ? keyLabel(Array.isArray(key) ? key[0] : key) : null, on: () => this.runCommand(id) });
      b.dataset.command = id;
      b.dataset.label = b.dataset.tip;
      made.push(b);
    }
    this.buildGroup.replaceChildren(...made);
    const sep = this.strip.querySelector('.build-sep');
    if (sep) sep.hidden = !made.length;
    this.updateToolstrip();
  }

  /** The strip follows the scene and the structure: the names on the two pickers, and which Build buttons can run now. */
  updateToolstrip() {
    if (!this.repPick) return;
    const sc = this.app.scene;
    const rep = styles.get(sc?.style?.rep), look = looks.get(sc?.look);
    this.repPick._label.textContent = rep?.name ?? 'Display style';
    this.repPick.dataset.tip = `Display style: ${rep?.name ?? sc?.style?.rep ?? '—'}`;
    this.lookPick._label.textContent = look?.name ?? (sc?.lookBase && looks.get(sc.lookBase) ? `${looks.get(sc.lookBase).name} · edited` : 'Custom look');
    this.lookPick.dataset.tip = look ? `Look: ${look.name}` : 'Look: customised (pick one to restyle)';
    // a Build button that cannot run now is greyed and says why (in its tooltip, and in a toast when clicked)
    for (const b of this.buildGroup.children) {
      const c = commands.get(b.dataset.command);
      const ok = !!c && commands.available(c);
      b.classList.toggle('off', !ok);
      b.setAttribute('aria-disabled', String(!ok));
      b.dataset.tip = ok || !c ? b.dataset.label : `${b.dataset.label}: ${commands.unavailableReason(c)}`;
    }
  }

  /** The toolbar buttons of the registered tools with toolbar: true (not Select and Measure), by order, after Measure. */
  renderToolButtons() {
    const app = this.app;
    for (const b of this.toolBtns.values()) b.remove();
    this.toolBtns.clear();
    let after = this.measureBtn, nav = this.selectBtn;
    for (const t of tools.list()) {
      if (!t.toolbar || t.id === 'select' || t.id === 'measure') continue;
      const b = btn('', { icon: t.icon, cls: 'icon', tip: t.tip, kbd: t.key ? keyLabel(t.key) : null, on: () => app.setTool(t.id) });
      b.dataset.tool = t.id;
      b.setAttribute('aria-pressed', String(app.tool === t.id));
      if (t.nav) { nav.after(b); nav = b; } else { after.after(b); after = b; }
      this.toolBtns.set(t.id, b);
    }
    this._syncViewTools();
  }

  /** Warn in the console (once each) about tools whose shown key is not the key of their command (M7 KC-03). */
  _checkToolKeysSoon() {
    if (this._toolKeyCheck) return;
    this._toolKeyCheck = true;
    queueMicrotask(() => {
      this._toolKeyCheck = false;
      this._toolKeyWarned ??= new Set();
      for (const msg of toolKeyProblems(tools.list(), commands.list())) {
        if (!this._toolKeyWarned.has(msg)) { this._toolKeyWarned.add(msg); console.warn(`Tool keys: ${msg}`); }
      }
    });
  }

  onHover({ index, x, y }) {
    const info = this.app.viewer.atomInfo(index);
    // off an atom the canvas takes the tool's cursor again (a tool's own hover may set another one after this)
    if (!info) { this.hover.hidden = true; this.app.viewer.renderer.domElement.style.cursor = this.app.toolDef?.cursor ?? ''; return; }
    this.app.viewer.renderer.domElement.style.cursor = 'pointer';
    const color = elementColorHex(info.symbol, this.app.scene.style);
    const f = (a) => a.map((v) => v.toFixed(3)).join('  ');
    // lines that modules add (registerAtomInfo), after the bonds line
    const extra = atomInfoRows(this.app, info.index, 'hover').flatMap((r) => [h('br'), `${r.label}  ${r.value}`]);
    this.hover.replaceChildren(
      h('div.h', h('span.dot', { style: { background: color } }), `${info.symbol}`, h('small', `#${info.index} · ${info.name}`)),
      h('div.m', `xyz  ${f(info.position)} Å`, info.frac ? h('br') : null, info.frac ? `frac ${f(info.frac)}` : null, h('br'), `bonds ${info.cn}`,
        info.image.some(Boolean) ? [h('br'), `Drawn image (${info.image.map((v) => (v < 0 ? `−${-v}` : v)).join(', ')})`] : null, ...extra),
    );
    this.hover.hidden = false;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const hx = Math.min(x, W - 200), hy = Math.min(y, H - 110);
    this.hover.style.left = `${hx}px`; this.hover.style.top = `${hy}px`;
  }

  updateInfo() {
    const s = this.app.structure;
    this.empty.hidden = !!s;
    this.infoCard.hidden = !s || (!isMobile() && !this.app.prefs.infoCard);
    this._syncViewTools();
    this.statusbar.classList.toggle('no-structure', !s);
    if (!s) { this.renderEmpty(); this.bench?.updateEmpty(); this.updateStats(); this.updateTraj(); return; }
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
      ? 'Open a CIF, POSCAR, XYZ, PDB or XSD file, pick a sample below, or build a crystal or nanocluster.'
      : 'Open a CIF, POSCAR, XYZ, PDB or XSD file, drop it anywhere on this window, paste its text, or start from a sample below.';
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
      // a project with documents (their windows closed) gets the sample as one more document, as Project › New › From Sample
      b.addEventListener('click', () => { try { const r = this.app.loadSample(id, { newProject: false }); r?.catch?.((e) => toast(e.message, { type: 'error' })); } catch (e) { toast(e.message, { type: 'error' }); } });
      this.emptyTiles.append(b);
    }
  }

  browseSamples() {
    this.openLeft('library');
    if (!isTouch()) requestAnimationFrame(() => this.panelEl('library').querySelector('input[type="search"], input')?.focus());
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
    const hidden = m && s ? this.app.viewer.hiddenCount ?? 0 : 0;
    this._updateHiddenPill(hidden);
    if (!m || !s) { st.textContent = ''; st.hidden = true; delete st.dataset.tip; return; }
    st.hidden = false;
    const n = s.length, drawn = m.n;
    const atoms = drawn !== n ? `${plural(n, 'atom')} (${drawn.toLocaleString()} drawn)` : plural(n, 'atom');
    const showFps = this.fps != null && (this.fps < 30 || this.app.prefs.debug);
    st.textContent = [atoms, m.bondsSkipped ? 'bonds off (too many atoms)' : plural(m.bonds?.count ?? 0, 'bond'), showFps ? `${this.fps} fps` : null].filter(Boolean).join(' · ');
    if (drawn > n) st.dataset.tip = 'Includes boundary and periodic image atoms (Scene → Repeat & boundaries)';
    else if (drawn < n && !hidden) st.dataset.tip = 'Hidden elements are not drawn (Style → Colour & size per element)';
    else if (drawn < n) st.dataset.tip = 'Hidden atoms are not drawn';
    else delete st.dataset.tip;
  }

  /** "216 hidden · Show all" after the stats while visibility masks hide atoms (view.showAll brings them back). */
  _updateHiddenPill(hidden) {
    let pill = this._hiddenPill;
    if (!hidden) { pill?.remove(); return; }
    if (!pill) {
      const count = h('span.n');
      const show = h('button', { type: 'button', style: { border: 0, padding: 0, background: 'none', color: 'var(--accent-strong)', font: 'inherit', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }, on: { click: () => this.runCommand('view.showAll') } }, 'Show all');
      pill = this._hiddenPill = h('span.pill.hidden-atoms', {
        'data-tip': 'Atoms hidden by surface tools (Surface › Layers). Show all brings them back.',
        style: { pointerEvents: 'auto', flex: 'none', whiteSpace: 'nowrap', display: 'inline-flex', gap: '6px', alignItems: 'center' },
      }, count, h('span', { 'aria-hidden': 'true' }, '·'), show);
      pill._count = count;
    }
    pill._count.textContent = `${hidden.toLocaleString()} hidden`;
    if (pill.previousElementSibling !== this.statText) this.statText.after(pill);
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

  /**
   * The status-bar hint, the tool HUD and the pressed state of the toolbar buttons. Select has the hint below (it
   * follows the selection) and no HUD; every other tool its hint(app, env) and hud(app, env) (render/tools/index.js),
   * or the generic "<b>Title</b> · <b>Esc</b> to finish" and "Title · Esc to finish" with Done.
   */
  updateHint() {
    const app = this.app;
    const touch = isTouch();
    const def = app.toolDef;
    let parts;
    if (def && def.id !== 'select') {
      const env = { touch, mac: isMac, MOD, ALT };
      parts = toolHint(def, app, env);
      let hud;
      if (typeof def.hud === 'function') {
        try { hud = def.hud(app, env); } catch (e) { console.error(`The HUD of the ${def.title} failed`, e); hud = null; }
      } else hud = [h('span', genericHud(def)), h('button', { type: 'button', on: { click: () => app.setTool('select') } }, 'Done')];
      const nodes = [hud].flat().filter((x) => x != null);
      this.measureHud.hidden = !nodes.length;
      // a HUD that returns the nodes it already shows keeps them in place (and the focus in its controls)
      const shown = this.measureHud.childNodes;
      if (nodes.length !== shown.length || nodes.some((n, i) => shown[i] !== n)) this.measureHud.replaceChildren(...nodes);
    } else {
      this.measureHud.hidden = true;
      this.measureHud.replaceChildren();
      const n = app.selection.length;
      let html;
      if (!app.structure) html = touch ? 'Open a file or pick a sample' : `Open a file (<b>${keyLabel('mod+o')}</b>), drop one here, paste text, or pick a sample`;
      else if (touch) html = n ? `<b>${n}</b> selected · ${this.selCard?.multi ? 'tap atoms to add or remove · ' : ''}tap empty space to clear` :'One finger rotates, two fingers pan and pinch to zoom, tap an atom to select it';
      else html = n ? `<b>${n}</b> selected · <b>Del</b> delete · <b>Shift-click</b> add · <b>${MOD}-click</b> add/remove · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>Esc</b> clear`
        : isMac ? '<b>⌃-drag</b> or <b>right-drag</b> rotate · <b>⌥-drag</b> or <b>middle-drag</b> pan · <b>Scroll</b> zoom · <b>Click</b> select · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>⌃-click</b> atom menu'
          : '<b>Right-drag</b> rotate · <b>Middle-drag</b> or <b>Alt-drag</b> pan · <b>Scroll</b> zoom · <b>Click</b> select · <b>Drag</b> box select · <b>Double-click</b> fragment · <b>Right-click</b> atom menu';
      parts = html.split(' · ');
    }
    this._hintParts = parts;
    this._fitHint();
    this.selectBtn.setAttribute('aria-pressed', String(app.tool === 'select'));
    this.measureBtn.setAttribute('aria-pressed', String(app.tool === 'measure'));
    for (const [id, b] of this.toolBtns) b.setAttribute('aria-pressed', String(app.tool === id));
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
    this.undoBtn.disabled = !app.canUndo();
    this.redoBtn.disabled = !app.canRedo();
    this.undoBtn.dataset.tip = u ? `Undo ${u}` : 'Undo';
    this.redoBtn.dataset.tip = r ? `Redo ${r}` : 'Redo';
    this.undoBtn.setAttribute('aria-label', this.undoBtn.dataset.tip);
    this.redoBtn.setAttribute('aria-label', this.redoBtn.dataset.tip);
  }

  /** app 'busy' {busy, label, cancel}: a spinner toast (with Cancel when the task can be cancelled), Export disabled and the stage marked busy. */
  onBusy({ busy, label, cancel = null } = {}) {
    this.stage.setAttribute('aria-busy', String(!!busy));
    this.exportBtn.disabled = !!busy;
    this.cameraBtn.disabled = !!busy;
    if (busy) {
      if (this._busyToast?.isConnected && this._busyCancel === cancel) this._busyToast.update(label || 'Working…');
      else {
        this._busyToast?.close();
        this._busyToast = toast(label || 'Working…', { timeout: 0, spinner: true, actions: cancel ? [{ label: 'Cancel', run: cancel }] : [] });
        this._busyCancel = cancel;
      }
    } else { this._busyToast?.close(); this._busyToast = null; this._busyCancel = null; }
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
    if (canDownload()) items.push({ label: 'Download project file (.facet.json)', icon: 'download', run: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) });
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
    // what PNG exports draw besides the structure (preferences; the hovered atom's halo is never drawn)
    const sel = app.prefs.exportSelection !== false, marks = app.prefs.exportMarkers === true;
    const items = [
      { header: 'Image' },
      img('PNG — screen size', { scale: 1 }),
      img('PNG — 2× (print)', { scale: 2 }, keyLabel('mod+e')),
      img('PNG — 4× (poster)', { scale: 4 }),
      img('PNG — transparent background', { scale: 2, transparent: true }),
      { label: 'Include selection highlight', icon: 'check', checked: sel, tip: 'Draw the rings around selected atoms into PNG images', run: () => app.setPref('exportSelection', !sel) },
      { label: 'Include markers (sites, fixed atoms)', icon: 'check', checked: marks, tip: 'Draw site markers, fixed-atom rings and other markers into PNG images', run: () => app.setPref('exportMarkers', !marks) },
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
    const cmd = (id) => () => this.runCommand(id);
    showMenu(anchor, [
      { header: 'Look along' },
      // the surface normal (N, Shift+N) is offered for every structure with a cell: without a vacuum gap it is c* (U1)
      ...(per ? [{ label: 'Surface normal (top)', kbd: keyLabel('n'), run: cmd('view.normal') }, { label: 'Surface normal (bottom)', kbd: keyLabel('shift+n'), run: cmd('view.normalBelow') }, { separator: true }] : []),
      ...(per ? [{ label: 'a axis', kbd: 'A', run: v('a') }, { label: 'b axis', kbd: 'B', run: v('b') }, { label: 'c axis', kbd: 'C', run: v('c') }, { separator: true }] : []),
      { label: 'x axis', kbd: 'X', run: v('x') }, { label: 'y axis', kbd: 'Y', run: v('y') }, { label: 'z axis', kbd: 'Z', run: v('z') },
      { separator: true },
      { label: per ? 'Direction or plane…' : 'Direction…', run: cmd('view.along') },
      { label: 'Default view', kbd: keyLabel('Home'), run: () => app.viewer.resetView() },
    ], { label: 'Look along' });
  }

  /**
   * The dialog of Look along a direction or plane… (command view.along without parameters): the normal of a plane
   * (h k l) of the current cell (four boxes h k i l on a hexagonal cell), a lattice direction [u v w] or a Cartesian
   * vector (the only choice without a cell). The choice and the values are kept for the session.
   */
  async viewAlongDialog() {
    const app = this.app;
    const [{ millerInput, vec3Input }, { hklToHkil }] = await Promise.all([import('./inputs.js'), import('../core/lattice.js')]);
    const cell = app.structure?.cell ?? null;
    const last = (this._alongLast ??= { mode: null, hkl: [1, 1, 1], uvw: [1, 1, 0], vector: [0, 0, 1] });
    const modes = cell ? ['hkl', 'uvw', 'vector'] : ['vector'];
    const NAMES = { hkl: 'Plane normal', uvw: 'Direction', vector: 'Vector' };
    const make = {
      hkl: () => millerInput({ label: 'Plane (h k l)', cell, value: last.hkl, app, required: true, key: 'along:hkl' }),
      uvw: () => vec3Input({ label: 'Direction [u v w]', labels: ['u', 'v', 'w'], integer: true, nonzero: true, unit: '', value: last.uvw, required: true, key: 'along:uvw' }),
      vector: () => vec3Input({ label: 'Vector', nonzero: true, unit: '', value: last.vector, required: true, key: 'along:vector' }),
    };
    let mode = modes.includes(last.mode) ? last.mode : modes[0];
    let ctl = null;
    const slot = h('div');
    const err = h('p.err-text', { hidden: true, role: 'alert' });
    const show = (m) => { mode = m; ctl = make[m](); slot.replaceChildren(ctl.el); err.hidden = true; };
    const seg = modes.length > 1 ? h('div.seg', { role: 'group', 'aria-label': 'Look along' }, modes.map((m) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(m === mode) }, NAMES[m]);
      b.addEventListener('click', () => {
        if (m === mode) return;
        for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b));
        show(m);
        ctl.focus();
      });
      return b;
    })) : null;
    show(mode);
    const go = () => {
      if (ctl.validate()) { ctl.focus(); return false; }
      const value = ctl.value;
      last.mode = mode; last[mode] = value;
      // four indices on screen (a hexagonal cell) are said in four in the direction label too
      const four = mode === 'hkl' && ctl.el.querySelector('.triple')?.dataset.n === '4';
      const target = mode === 'vector' ? value : mode === 'uvw' ? { uvw: value } : four ? { hkil: hklToHkil(value) } : { hkl: value };
      try {
        const r = app.viewer.viewAlong(target);
        if (r.note) toast(r.note);
        return true;
      } catch (e) { err.hidden = false; err.textContent = e.message; return false; }
    };
    const d = dialog({
      title: 'Look along a direction or plane',
      body: h('div', { style: { display: 'grid', gap: '10px' } }, seg, slot,
        h('p.hint', `The view turns to look down this direction. ${keyLabel('n')} looks along the surface normal.`), err),
      actions: [{ label: 'Cancel' }, { label: 'Look along', primary: true, run: go }],
    });
    // Enter in a box looks along it at once
    d.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target?.tagName !== 'INPUT') return;
      e.preventDefault();
      if (go()) d.close();
    });
    return d;
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
      { label: 'About Facet', icon: 'info', run: () => this.aboutDialog() },
    ], { align: 'end', label: 'Help' });
  }

  /**
   * The More menu of phones, where the menu bar does not fit: the everyday actions, then every menu of the bar
   * (File … Help) as a submenu, with the same items as on a desktop.
   */
  moreMenu(anchor) {
    const app = this.app;
    const s = app.storage.get('server');
    const dark = this._darkUI();
    showMenu(anchor, compactMenu(app, this, leftPanels, [
      { label: 'Open files…', icon: 'open', run: () => commands.run('file.open') },
      { label: 'Paste structure text…', icon: 'clipboard', run: () => this.runCommand('file.paste') },
      { label: 'New project', icon: 'filePlus', run: () => commands.run('project.new') },
      { separator: true },
      { label: dark ? 'Light interface' : 'Dark interface', icon: dark ? 'sun' : 'moon', run: () => this.cycleTheme() },
      s?.info?.mode === 'cloud' && s.user ? { label: `Sign out (${s.user.username})`, icon: 'logout', run: () => this.signOut() } : null,
      s?.info && s.needsAuth ? { label: 'Sign in to the server', icon: 'user', run: () => this.openSignIn() } : null,
    ]), { align: 'end', label: 'Menus' });
  }

  /** Structure panel at its Analyses (Tools › Analyses). */
  showAnalyses() {
    this.openLeft('structure');
    requestAnimationFrame(() => {
      const head = [...this.panelEl('structure').querySelectorAll('.section > h3')].find((x) => /^Analyses/.test(x.textContent.trim()));
      head?.scrollIntoView?.({ block: 'start' });
    });
  }

  /** The items of a command for the view's context menu (greyed with the reason when it cannot run now). */
  _cmdItem(id, extra = {}) {
    const c = commands.get(id);
    if (!c) return null;
    const ok = commands.available(c);
    const key = c.kbd ?? c.key;
    return { id, label: MENU_LABELS[id] ?? c.title, icon: MENU_ICONS[id] ?? null, kbd: key ? keyLabel(Array.isArray(key) ? key[0] : key) : null, disabled: !ok, tip: ok ? null : commands.unavailableReason(c), run: () => this.runCommand(c), ...extra };
  }

  /** Display Style…, Display Options…, Lighting… and Label ▸ (the view's context menu, as in Materials Studio). */
  _displayItems() {
    const app = this.app, cur = app.scene.display.labels ?? 'none';
    return [
      this._cmdItem('view.displayStyle'), this._cmdItem('view.displayOptions'), this._cmdItem('view.lighting'),
      { label: 'Label', icon: 'label', items: [['none', 'None'], ['element', 'Element'], ['index', 'Index'], ['both', 'Element and Index']].map(([v, l]) => ({ label: l, radio: true, checked: cur === v, run: () => app.set('display.labels', v) })) },
    ];
  }

  /**
   * Right-click on an atom (or on empty space) in the view, laid out as in Materials Studio: Cut, Copy, Paste, Delete;
   * Display Style, Display Options, Lighting, Label; Lattice Parameters; then the view and selection actions. Registered
   * selection actions follow "Measure from here" (menu: true | 'both', on the clicked atom or the selection it is part
   * of) and "Clear selection" (menu: 'blank' | 'both').
   */
  onAtomContext({ index, clientX, clientY }) {
    const app = this.app, v = app.viewer, m = v.model;
    if (!app.structure || !m) return;
    const at = { x: clientX, y: clientY };
    const registered = (sel, where, ctx) => selectionActions(app, sel, where).flatMap((a) => actionMenuItems(a, app, sel, ctx));
    const clipItems = [this._cmdItem('edit.cut'), this._cmdItem('edit.copy'), this._cmdItem('edit.paste'), this._cmdItem('sel.delete')];
    const props = { label: 'Properties', icon: 'props', run: () => this.bench?.focusProperties() };
    if (index < 0 || index >= m.n) {
      const blank = registered(app.selection, 'blank', { source: 'blank', atom: -1, display: -1 });
      const hidden = (v.hiddenCount ?? 0) > 0 && commands.get('view.showAll');
      showMenu(at, [
        ...clipItems,
        { separator: true },
        ...this._displayItems(),
        { separator: true },
        app.structure.cell ? this._cmdItem('cell.parameters') : null,
        app.structure.cell ? this._cmdItem('cell.supercell') : null,
        { separator: true },
        { label: 'Fit to screen', icon: 'fit', kbd: 'F', run: () => v.fitView() },
        { label: 'Reset view', icon: 'reset', kbd: keyLabel('Home'), run: () => v.resetView() },
        hidden ? { label: 'Show all atoms', icon: 'eye', run: () => this.runCommand('view.showAll') } : null,
        { separator: true },
        { label: 'Select all atoms', icon: 'atom', kbd: keyLabel('mod+a'), run: () => selectAll(app) },
        { label: 'Clear selection', icon: 'x', kbd: 'Esc', disabled: !app.selection.length, run: () => app.clearSelection() },
        ...(blank.length ? [{ separator: true }, ...blank] : []),
        { separator: true },
        props,
      ], { label: 'View' });
      return;
    }
    const src = m.src[index], sym = m.symbols[index], el = element(sym);
    const sel = app.selection, inSel = sel.includes(src);
    // the menu works on the clicked atom: one that is not selected becomes the selection (as a right-click does in MS)
    if (!inSel) app.select([src]);
    const extra = registered(menuTarget(app.selection, src), 'menu', { source: 'menu', atom: src, display: index });
    const many = inSel && sel.length > 1;
    showMenu(at, [
      { header: `${sym} #${src} · ${el.name}${many ? ` · ${sel.length} selected` : ''}` },
      ...clipItems,
      { separator: true },
      { label: `Select all ${sym}`, icon: 'atom', run: () => selectSameElement(app, sym) },
      { label: 'Select with neighbours', icon: 'neighbors', run: () => selectNeighbours(app, [src]) },
      { label: 'Select bonded fragment', icon: 'neighbors', kbd: 'Double-click', run: () => selectFragment(app, [src]) },
      { label: 'Modify Element', icon: 'edit', items: this.bench ? this.bench.elementItems() : [] },
      { label: 'Centre here', icon: 'crosshair', run: () => v.focusAtom(index) },
      { label: 'Measure from here', icon: 'ruler', run: () => measureFrom(app, index) },
      ...(extra.length ? [{ separator: true }, ...extra] : []),
      { separator: true },
      ...this._displayItems(),
      { separator: true },
      this._cmdItem('view.hideSelected', { label: many ? `Hide ${sel.length} Selected Atoms` : 'Hide Atom' }),
      { label: `Hide ${el.name}`, icon: 'eyeOff', run: () => this.hideElement(sym) },
      { separator: true },
      props,
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
    closeMenu();
    this._placeChrome();   // in full screen the view tools float in the view: the strip is hidden
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
  /** Set the interface theme: 'light', 'dark' or 'system' (View › Theme). */
  setTheme(t) {
    const next = t === 'light' || t === 'dark' ? t : 'system';
    this._syncHostTheme();
    this.app.setPref('theme', next);
    this.applyTheme(next);
    toast(next === 'system' ? `Interface: follows ${this._hostTheme ? 'the page' : 'your system'}` : `Interface: ${next}`);
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
      // F10 puts the keyboard on the menu bar (← → along it, ↓ opens a menu), as in desktop programs
      if (k === 'F10' && !ctrl && !e.altKey && !e.shiftKey && !modal && !touring && this.menubar?.visible) { e.preventDefault(); closeMenu(); this.menubar.focus(); return; }
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
      if (pasteFromClip(this.app, this, text)) return;
      this.pasteText(text);
    });
  }

  /**
   * Import pasted text as a structure (app.importText's two steps); failures become a toast (never an unhandled
   * rejection). Reading may wait (formats the server reads), so the toast's Undo is bound to the step that added this
   * structure (addStructure's historyEntry), not to whatever step is newest by then.
   */
  async pasteText(text, format = null) {
    const app = this.app;
    let st, historyEntry;
    try {
      st = await app._parse(text, 'pasted', format);
      ({ historyEntry } = app.addStructure(st));
    } catch (err) { toast(`Pasted text is not a structure file (${pasteReason(err)})`, { type: 'error' }); return null; }
    app.toastUndo(`Pasted ${plural(st.length, 'atom')} — ${st.formula()}`, { entry: historyEntry });
    return st;
  }

  /** A dialog to paste structure-file text (works where clipboard events are not available, e.g. phones). */
  pasteDialog() {
    const area = h('textarea.field.mono', { rows: 10, autofocus: true, spellcheck: false, 'aria-label': 'Structure file text', placeholder: 'Paste the contents of a CIF, POSCAR, XYZ, PDB, XSD or Facet JSON file…', style: { minHeight: '200px', fontSize: '12px' } });
    const readers = formats.readers();
    // as in the Build panel: formats the browser cannot read are parsed by the server (incl. plugin formats)
    const fmt = h('select.field', { 'aria-label': 'Format' }, h('option', { value: '' }, 'Detect format'), ...readers.map((f) => h('option', { value: f.id }, f.server ? `${f.id} (server)` : f.name)));
    const hint = readers.some((f) => f.server) ? h('p.hint', 'Formats marked (server) are read by the Facet server, including formats added by its plugins.') : null;
    const err = h('p.err-text', { hidden: true, role: 'alert' });
    dialog({
      title: 'Paste structure text', wide: true,
      body: h('div', { style: { display: 'grid', gap: '10px' } }, area, h('div.ctl.wide', h('label', 'Format'), fmt), hint, err),
      actions: [{ label: 'Cancel' }, {
        label: 'Open', primary: true,
        run: async () => {
          if (!area.value.trim()) { err.hidden = false; err.textContent = 'Paste some file text first.'; area.focus(); return false; }
          try { await this.app.importText(area.value, 'pasted', fmt.value || null); toast(`Opened ${plural(this.app.structure.length, 'atom')} — ${this.app.structure.formula()}`); return true; }
          catch (e) { err.hidden = false; err.textContent = `This text is not a structure file Facet can read (${pasteReason(e)}).`; return false; }
        },
      }],
    });
  }

  bindApp() {
    const app = this.app;
    app.on('project', () => { if (document.activeElement !== this.titleInput) this.titleInput.value = app.project.name; this.updateSaveChip(); this.refreshDrawer('project'); });
    app.on('structure', () => { this.updateInfo(); this.updateHint(); this.updateToolstrip(); this.refreshDrawer('structure'); this.refreshInspector(); });
    app.on('selection', () => { this.updateHint(); this.refreshDrawer('selection'); });
    app.on('measure', () => this.refreshDrawer('measure'));
    app.on('tool', () => { this.updateHint(); this.selCard.update(); });
    app.on('scene', () => { this.refreshInspector(); this.updateHint(); this.updateToolstrip(); this.updateTone(); this.refreshDrawer('scene'); });
    app.on('busy', () => this.updateToolstrip());
    app.on('registry', () => { this.refreshDrawer('registry'); this.renderToolstrip(); });
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
    // box and lasso selection, and the touch multi-select below, work with every tool that selects atoms (Select, Move)
    v.on('boxselect', ({ indices = [], add, mode } = {}) => { if (!app.toolDef?.selects || !app.structure) return; app.select(indices, { mode: mode ?? (add ? 'add' : 'replace') }); });
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
      if (!this._multiAtDown || !app.toolDef?.selects || !v.model) return;
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
      if (!this._multiAtDown || !app.toolDef?.selects) return;
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
      this.userSlot.append(btn(s.user.username, { icon: 'user', cls: 'ghost small desktop-only', tip: 'Signed in to the Facet server', on: (e) => showMenu(e.currentTarget, [{ label: 'Sign out', icon: 'logout', run: () => this.signOut() }], { align: 'end' }) }));
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
    // a result found by one of its Materials Studio names shows that name in grey; the MS menu path (`ms`) is its tooltip
    const row = (c, cat = true, alias = null) => {
      const k = c.kbd ?? c.key;
      const r = h('div.res', { role: 'option', id: `pal-opt-${opts.length}`, 'aria-selected': 'false', title: c.ms || null, dataset: { i: opts.length } },
        cat ? h('span.cat', c.category ?? '') : null, h('span.tt', c.title), alias ? h('span.alias', { style: ALIAS_STYLE }, alias) : null,
        k ? h('span.kbd.k', keyLabel(Array.isArray(k) ? k[0] : k)) : null);
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
      } else rankCommands(list, q).slice(0, 50).forEach(({ cmd, alias }) => nodes.push(row(cmd, true, alias)));
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
      // then the rows of the registered tools (ToolDef.mouse), in tool order
      ...tools.list().flatMap((t) => t.mouse),
    ];
    sections.push(h('section.sc-sec', h('h3.sub-h', 'Mouse'), h('div.shortcut-grid', mouse.map(([k, d]) => h('div', h('span', d), h('span.kbd', k))))));
    dialog({ title: 'Keyboard shortcuts', wide: true, className: 'shortcuts', body: h('div.sc-wrap', sections) });
  }

  aboutDialog() {
    const app = this.app;
    const provs = app.storage.list().map((p) => p.label).join(', ');
    dialog({
      title: 'About Facet',
      body: h('div', { style: { display: 'grid', gap: '10px' } },
        h('p.hint', { style: { fontSize: '13.5px' } }, 'Facet renders atoms, clusters and crystals with physically based materials, studio lighting and post effects. Everything is modular: formats, builders, colour schemes, materials, lighting rigs, looks, storage backends, panels and commands are registries that plugins extend.'),
        h('dl.kv', h('dt', 'Version'), h('dd', VERSION), h('dt', 'Runs as'), h('dd', app.serverStore.info ? `${app.serverStore.info.mode} server` : 'standalone web app'), h('dt', 'Project storage'), h('dd', provs), h('dt', 'Renderer'), h('dd', 'three.js r170 (WebGL 2)')),
      ),
    });
  }

  /** Scripting & API help: the extensibility package's dialog when present, else a short example. */
  async apiDialog() {
    try {
      const m = await import('./apidialog.js');
      if (typeof m.openApiDialog === 'function') return m.openApiDialog(this, window.facet);
    } catch (e) { if (!/Failed to fetch|Importing a module|error loading dynamically/i.test(String(e?.message))) console.warn(e); }
    return this._basicApiDialog();
  }

  _basicApiDialog() {
    const code = `// In the browser console (or a plugin):
const s = facet.build.crystal('perovskite', { elements: ['Ba','Ti','O'], a: 4.01, repeat: [3,3,3] });
facet.load(s);                      // show it
facet.applyLook('poster');           // restyle
facet.set('post.outline.enabled', true);
facet.view('c');                     // look along c
const png = await facet.screenshot({ scale: 3 });

// Extend: register a colour scheme
facet.registry.colorSchemes.register({
  id: 'oxygen-red', name: 'Oxygen highlight',
  colorFor: (sym) => sym === 'O' ? '#ff2244' : '#b0b6bd',
});

// Python (server), in a Facet checkout: pip install . && facet serve
//   import facet as cl
//   cl.view(cl.build.crystal('fcc', ['Au'], a=4.08).repeat(4,4,4))`;
    return dialog({ title: 'Scripting & API', wide: true, body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.hint', 'The whole app is scriptable through window.facet. When Facet runs on its Python server, the same features are available as a REST API (see /docs on the server) and a Python package.'),
      h('pre', { style: { margin: 0, padding: '12px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '9px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.55' } }, code)) });
  }

  // ------------------------------------------------------------------ onboarding
  welcome() {
    if (this.app.prefs.welcomed) return;
    const touch = isTouch();
    // the Library, the Build panel and the looks are in tool windows that may be closed: the words open them
    const link = (label, run) => h('button.linkish', { type: 'button', on: { click: (e) => run(e.currentTarget) } }, label);
    const card = h('div.float.welcome', { role: 'dialog', 'aria-label': 'Getting started' },
      h('h3', 'Welcome to Facet'),
      h('ol',
        h('li', 'Pick a structure from the ', link('Library', () => this.openLeft('library')), ', ', link('build one', () => this.openLeft('build')), touch ? ', or open your own file.' : ', or drop your own file here.'),
        h('li', 'Restyle it with one click in ', link('Looks', () => this.openInspector('style')), ', then fine-tune light and effects.'),
        h('li', canDownload() ? [link('Export', (b) => this.exportMenu(b)), ' a high-resolution image or save the project.'] : 'Export a high-resolution image or save the project.')),
      h('p.hint', touch ? 'Coming from Materials Studio? Its menus (File, Edit, View, Modify, Build, Tools) are under ⋯ at the top right.' : 'Coming from Materials Studio? The window is laid out the same way: Project and Properties explorers on the left, document windows in the middle, the same menus, toolbars, right-click menu and mouse.'),
      h('div.acts', btn('Take the 1-minute tour', { cls: 'primary small', on: () => { card.remove(); this.app.setPref('welcomed', true); this.tour(); } }), btn('Dismiss', { cls: 'ghost small', on: () => { card.remove(); this.app.setPref('welcomed', true); this.gestureHint(); } })));
    // on a desktop the card sits over the explorers (the Properties explorer has little to say on a first visit), so it
    // never covers the structure however narrow the workspace is; on phones, or with the explorers hidden, in the view
    const dock = !isMobile() && this.bench?.dock;
    (dock && this.root.dataset.dock !== 'false' ? dock : this.stage).append(card);
  }

  /**
   * One-time gesture hint for touch screens, at the top of the view. It waits while the welcome card or the
   * tour is up (both call it again when they close), so only one onboarding layer shows at a time.
   */
  gestureHint() {
    if (!isTouch() || this.app.prefs.gestureHintShown || !this.app.structure) return;
    if (document.querySelector('.welcome') || document.querySelector('.coach')) return;
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
    // the menus follow Materials Studio: name a few paths that exist in this build
    const mobile = isMobile();
    const paths = this._menuExamples(['surface.cleave', 'cell.supercell', 'constraints.edit', 'build.crystal', 'sel.replace', 'export.cif'], 3);
    const eg = paths.length ? ` For example ${paths.join(', ')}.` : '';
    return [
      mobile
        ? { sel: '.top-actions [aria-label="Menus"]', title: 'Menus as in Materials Studio', text: `Every command is in this menu: File, Edit, View, Modify, Build, Tools, Window and Help, grouped as in Materials Studio.${eg}`, sheet: 'none' }
        : { sel: '.menubar', title: 'Menus as in Materials Studio', text: `File, Edit, View, Modify, Build and Tools hold what they hold in Materials Studio.${eg} ${MOD} K finds any command, also by its Materials Studio name.`, sheet: 'none' },
      ...(mobile ? [
        { sel: '.rail', title: 'Explorers', text: `Projects, the sample Library, the Builder, Structure details and Surface tools live here.${touch ? '' : ` ${keyLabel('shift+1')} – 5 open them.`}`, sheet: 'left', panel: 'library' },
        { sel: '.rail [data-panel="build"]', title: 'Build your own', text: 'Build crystals from prototypes, nanoclusters (icosahedra, decahedra, cuboctahedra) and molecules, or paste file text.', sheet: 'none' },
      ] : [
        { sel: '.dock .xpane.project', title: 'Project explorer', text: 'Every document of the project, with its kind (crystal, surface, molecule, trajectory). Double-click one to open its window; right-click to rename, duplicate, export or delete it. New adds a crystal, cluster, molecule, sample or file.', sheet: 'none' },
        { sel: '.dock .xpane.properties', title: 'Properties explorer', text: 'What is selected, as in Materials Studio: Filter by Atom, Lattice 3D, Physical System, Symmetry System or Display. Values that are not grey can be changed: click one, type, press Enter (an element, a position, a lattice parameter, a constraint).', sheet: 'none' },
        { sel: '.workspace', title: 'Document windows', text: 'Each document opens in its own window. Maximized they share tabs; Window › Tile Horizontally, Tile Vertically or Cascade puts them side by side, each with its own view.', sheet: 'none' },
        { sel: '.toolwin[data-tw="panel:build"]', title: 'Tool windows', text: `Library, Build, Structure, Surface and Projects each open in a window of their own (Build › Crystals › Build Crystal…, View › Explorers${touch ? '' : `, ${keyLabel('shift+1')} – 5`}). Like the dialogs of Materials Studio they float over the workspace: drag a title bar to move one, its lower right corner to resize it, and keep open as many as you need.`, sheet: 'left', panel: 'build' },
      ]),
      { sel: '.viewport', title: 'Rotate the view', try: 'camera', tryText: touch ? 'Drag one finger across the view' : isMac ? 'Hold ⌃ Control and drag in the view' : 'Right-drag in the view',
        text: touch ? 'One finger rotates, two fingers pan and pinch to zoom. Tap an atom to see its details.'
          : isMac ? 'As in Materials Studio: right-drag (or ⌃ Control+drag) rotates, middle-drag (or ⌥ Option+drag) pans, scrolling zooms. Hover an atom for details, click or drag to select, double-click for its fragment, ⌃-click for more.'
          : 'As in Materials Studio: right-drag rotates, middle-drag (or Alt+drag) pans, scroll zooms. Hover an atom for details, click or drag to select, double-click for its fragment, right-click for more.', sheet: 'none' },
      { sel: '.toolwin[data-tw="tab:style"] .aio-looks, .toolwin[data-tw="tab:style"] .grid-cards, .inspector .aio-looks, .inspector .grid-cards', title: 'Pick a look', try: 'look', tryText: touch ? 'Tap any look' : 'Click any look',
        text: 'One click sets the material, light and effects together. Below it, choose the representation, colours and sizes.', sheet: 'inspector', tab: 'style' },
      mobile
        ? { sel: '.inspector .tabs', title: 'Light, effects, scene', text: 'Shape the light rig, add ambient occlusion, ink outlines, bloom or depth of field, and set the unit cell, supercell, bonds and background.', sheet: 'inspector' }
        : { sel: '.tband[data-band="display"]', title: 'Display Style, Display Options, Lighting', text: 'View › Display Style…, Display Options… and Lighting… (also the last buttons of this toolbar), and View › Effects › Effects…, each open a window of their own, so you can keep them side by side: the representation and colours, the light rig, ambient occlusion, outlines or depth of field, the unit cell, supercell, bonds and background.', sheet: 'none' },
      mobile
        ? { sel: '.toolbar.tb-top', title: 'View tools', text: 'Measure distances and angles, align the view with a crystal axis, switch to orthographic, or start a turntable.', sheet: 'none' }
        : { sel: '.toolstrip', title: 'Toolbars', text: 'Standard (new, open, save, cut, copy, paste, print), 3D Viewer (select, rotate, zoom, translate, measure, look along an axis), Display, Build and Modify; Animation joins them while a trajectory is open. Every button says what it does when the pointer rests on it. Drag a toolbar by its dotted grip to another place or row, or out over the workspace to float it; right-click a toolbar (or View › Toolbars) to show or hide one.', sheet: 'none' },
      { sel: '.proj-title', title: 'Your work is saved', text: storage, sheet: 'none' },
      canDownload() ? { sel: '.btn.export', title: 'Export', text: `Save PNG images up to 4×, a glTF model for Blender or slides, or the structure as CIF, POSCAR, XYZ, PDB or Materials Studio XSD.${touch ? ' Tap ? in the top bar for help.' : ` Press ${MOD} K anytime to search every command.`}`, sheet: 'none' } : null,
    ].filter(Boolean);
  }

  /** Up to `n` menu paths that exist now, for the commands `ids` in that order: 'Build › Surfaces › Cleave Surface'. */
  _menuExamples(ids, n = 3) {
    let flat = [];
    try { flat = flattenMenus(appMenus(this.app, this, leftPanels)); } catch (e) { console.warn(e); }
    const out = [];
    for (const id of ids) {
      const hit = flat.find((x) => x.item.id === id);
      if (hit) out.push([...hit.path, String(hit.item.label).replace(/…$/, '')].join(' › '));
      if (out.length >= n) break;
    }
    return out;
  }

  _tourPrep(s) {
    if (this.bench?.desktop) {
      // desktops: the window a step points at opens without taking the keyboard; the ones the tour opened close again
      // once a step no longer needs them, and when the tour ends (_tourClose)
      const want = s.sheet === 'left' ? ['panel', s.panel ?? this.leftId] : s.sheet === 'inspector' ? ['tab', s.tab ?? this.tabId] : null;
      const key = want ? want.join(':') : null;
      this._tourClose(key);
      if (!want) return;
      if (this.bench.tools.isOpen(...want)) this.bench.tools.raise(...want);
      else if (this.bench.tools.open(want[0], want[1], { focus: false })) (this._tourOpened ??= new Set()).add(key);
      return;
    }
    if (s.sheet === 'left') { this.leftId = s.panel ?? this.leftId; this.leftOpen = true; this.inspectorOpen = false; this.renderDrawer(); }
    else if (s.sheet === 'inspector') { if (s.tab) this.tabId = s.tab; this.inspectorOpen = true; this.leftOpen = false; if (s.tab || !this.inspectorHost.body?.isConnected) this.renderInspector(); }
    else if (s.sheet === 'none') { this.leftOpen = false; this.inspectorOpen = false; }
    this.syncPanels();
  }
  /** Close the tool windows the tour opened (but the one `keep`, 'panel:build' …). */
  _tourClose(keep = null) {
    for (const k of [...(this._tourOpened ?? [])]) {
      if (k === keep) continue;
      this._tourOpened.delete(k);
      const i = k.indexOf(':');
      this.bench?.tools.close(k.slice(0, i), k.slice(i + 1));
    }
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
      this._tourClose();
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
