/**
 * The menu bar (File, Edit, View, Modify, Build, Tools, Window, Help), laid out as in Materials Studio.
 *
 * What is in each menu comes from ui/menumodel.js (MENUS) and the command registry, read when a menu opens: a
 * command registered later is there the next time. This module adds what only the running app knows (storage
 * providers, file formats, panels, the structures of the project, samples, analyses: menuEnv) and draws the bar.
 *
 * Mouse: a click opens a menu; while one is open, moving over another title switches to it; items with ▸ open a
 * submenu beside them. Keyboard: F10 goes to the bar, ← → move along it, ↓, Enter or Space open a menu; in a menu
 * ↑ ↓ Home End move, → opens a submenu (else the next menu), ← closes it (else the previous menu), letters jump
 * to an item, Esc closes (ui/overlays.js showMenu).
 */
import { h } from './dom.js';
import { showMenu, toast } from './overlays.js';
import { commands } from '../core/commands.js';
import { analyses } from '../core/analyses.js';
import { formats } from '../io/index.js';
import { samples } from '../build/samples.js';
import { keyLabel } from './keys.js';
import { canDownload, NO_DOWNLOADS } from '../storage/files.js';
import { panelSections } from './sections.js';
import { MENUS, buildMenus } from './menumodel.js';

const LABEL_MODES = [['none', 'None'], ['element', 'Element'], ['index', 'Index'], ['both', 'Element and Index']];

/**
 * The environment of buildMenus for the running app: the command registry, which panel sections exist, the scene
 * and panel state behind the check marks, and the lists that are not commands (`panels` is the map of registered
 * left panels, ui/shell.js leftPanels).
 */
export function menuEnv(app, shell, panels = new Map()) {
  const sc = app.scene ?? {};
  const noDownloads = (c) => { if (canDownload()) return false; try { return c.whyNot?.(app) === NO_DOWNLOADS; } catch { return false; } };
  const fail = (p) => p?.catch?.((e) => toast(e.message, { type: 'error' }));
  const why = !app.structure ? 'Load a structure first' : app.busy ? 'Wait for the current task to finish' : null;
  const dynamic = {
    importSamples: () => [{ label: 'Sample Structures…', icon: 'library', run: () => shell.browseSamples() }],
    providers: () => app.storage.list().map((p) => {
      const here = app.project.location?.provider === p.id;
      return { label: p.label, icon: p.icon, tip: p.description ?? null, hint: here ? 'current' : p.id === 'folder' && !p.connected ? 'choose folder' : '', run: () => shell.saveToProvider(p.id) };
    }),
    autosave: () => {
      const on = app.prefs.autosave !== false;
      return [{ label: 'Autosave', checked: on, run: () => { app.setPref('autosave', !on); shell.updateSaveChip(); toast(!on ? 'Autosave is on' : 'Autosave is off'); } }];
    },
    exportOptions: () => {
      if (!canDownload()) return [];
      const sel = app.prefs.exportSelection !== false, marks = app.prefs.exportMarkers === true;
      return [
        { label: 'Include Selection Highlight', checked: sel, tip: 'Draw the rings around selected atoms into PNG images', run: () => app.setPref('exportSelection', !sel) },
        { label: 'Include Markers (Sites, Fixed Atoms)', checked: marks, tip: 'Draw site markers, fixed-atom rings and other markers into PNG images', run: () => app.setPref('exportMarkers', !marks) },
      ];
    },
    // one item per file format that can be written (the registry: built-in, plugin and server formats)
    writers: () => (canDownload() ? formats.writers().map((f) => {
      const noCell = (f.id === 'poscar' || f.id === 'cif') && app.structure && !app.structure.cell;
      return { id: `export.${f.id}`, label: f.name ?? f.id, icon: 'file', hint: `.${f.extensions?.[0] ?? f.id}`, disabled: !!why || noCell, tip: why ?? (noCell ? `${f.name} needs a unit cell` : f.description ?? null),
        run: () => fail(app.exportStructureFile(f.id)) };
    }) : []),
    account: () => {
      const s = app.storage.get('server');
      if (s?.info?.mode === 'cloud' && s.user) return [{ label: `Sign Out (${s.user.username})`, icon: 'logout', run: () => shell.signOut() }];
      if (s?.info && s.needsAuth) return [{ label: 'Sign In to the Server…', icon: 'user', run: () => shell.openSignIn() }];
      return [];
    },
    labels: () => LABEL_MODES.map(([v, label]) => ({ label, radio: true, checked: (sc.display?.labels ?? 'none') === v, run: () => app.set('display.labels', v) })),
    projection: () => [['perspective', 'Perspective'], ['orthographic', 'Orthographic']].map(([v, label]) => (
      { label, radio: true, checked: (sc.display?.projection ?? 'perspective') === v, run: () => app.set('display.projection', v) })),
    // the explorers: every registered left panel (plugins included), checked while it is the one on screen
    panels: () => [...panels.values()].map((p) => {
      const key = commands.get(`panel.${p.id}`)?.key ?? p.kbd ?? null;
      return { id: `panel.${p.id}`, label: p.title, kbd: key ? keyLabel(Array.isArray(key) ? key[0] : key) : null, checked: !!shell.leftOpen && shell.leftId === p.id, run: () => shell.toggleLeft(p.id) };
    }),
    theme: () => {
      const cur = app.prefs.theme ?? 'system';
      return [['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow the System']].map(([v, label]) => ({ label, radio: true, checked: cur === v, run: () => shell.setTheme(v) }));
    },
    // Build › Samples: one submenu per category of the sample library
    samples: () => {
      const groups = new Map();
      for (const s of samples.list()) { const g = s.category ?? 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
      return [...groups].map(([g, list]) => ({ label: g, items: list.map((s) => ({ id: `sample.${s.id}`, label: s.name ?? s.id, run: () => shell.runCommand(`sample.${s.id}`) })) }));
    },
    analyses: () => analyses.list().map((a) => ({ label: a.name ?? a.id, tip: a.description ?? null, disabled: !app.structure, run: () => shell.showAnalyses() })),
    structures: () => {
      const list = app.project?.structures ?? [];
      if (!list.length) return [];
      return [{ header: 'Structures in this project' }, ...list.map((e, i) => (
        { label: `${i + 1}  ${e.name || e.structure?.name || 'Structure'}`, radio: true, checked: e.id === app.project.activeStructure, run: () => { if (e.id !== app.project.activeStructure) app.setActiveStructure(e.id); } }))];
    },
    tour: () => {
      const resume = !app.prefs.tourDone && Number.isInteger(app.prefs.tourStep) && app.prefs.tourStep > 0;
      return [
        resume ? { label: 'Resume the Tour', icon: 'sparkles', hint: `step ${app.prefs.tourStep + 1}`, run: () => shell.tour(app.prefs.tourStep) } : null,
        { id: 'ui.tour', label: resume ? 'Start the Tour Again' : 'Take the Tour', icon: resume ? 'reset' : 'sparkles', run: () => shell.tour() },
      ];
    },
  };
  return {
    commands,
    hasSection: (panel, section) => panelSections(panel).some((s) => s.id === section && !s.placeholder),
    hideCommand: noDownloads,
    keyLabel,
    run: (c) => shell.runCommand(c),
    dynamic,
    state: {
      rep: sc.style?.rep, look: sc.look, lighting: sc.lighting?.preset, colorScheme: sc.style?.colorScheme,
      cell: sc.display?.cell?.show, turntable: sc.display?.turntable, get: (path) => app.get(path),
      leftOpen: !!shell.leftOpen, inspectorOpen: !!shell.inspectorOpen, fullscreen: !!shell.root?.dataset?.fullscreen,
      canUndo: !!app.canUndo?.(), canRedo: !!app.canRedo?.(), undoLabel: app.undoLabel?.() ?? null, redoLabel: app.redoLabel?.() ?? null,
    },
  };
}

/** The menus of the running app as showMenu item lists: [{id, label, items}] (ui/menumodel.js buildMenus). */
export function appMenus(app, shell, panels) {
  return buildMenus(menuEnv(app, shell, panels));
}

/** The item list of entries of MENUS' kind (e.g. [{family: 'look.'}]) for a toolbar button's own menu. */
export function menuItems(app, shell, panels, entries) {
  return buildMenus(menuEnv(app, shell, panels), [{ id: 'x', label: 'x', items: entries }])[0]?.items ?? [];
}

/**
 * The More menu of phones, where the bar itself does not fit: a few everyday actions, then every menu of the bar as
 * a submenu (on a phone a submenu takes the menu's place, with a way back).
 */
export function compactMenu(app, shell, panels, quick = []) {
  const menus = appMenus(app, shell, panels).map((m) => ({ label: m.label, items: m.items }));
  return [...quick, quick.length ? { separator: true } : null, { header: 'Menus' }, ...menus];
}

export class MenuBar {
  /** `panels`: the registered left panels (ui/shell.js leftPanels). */
  constructor(shell, panels) {
    this.shell = shell;
    this.panels = panels;
    this.openIndex = -1;   // the menu that is open, or -1
    this.current = 0;      // the title that takes Tab
    this._prev = null;     // what had the focus before the bar took it: it gets the focus back once a command has run
    this.buttons = MENUS.map((m, i) => {
      const b = h('button.mb', { type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: i === 0 ? '0' : '-1', dataset: { menu: m.id } }, m.label);
      b.addEventListener('click', () => this.openAt(i));
      // while a menu is open, the pointer moving onto another title opens that menu
      b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch' && this.openIndex >= 0 && this.openIndex !== i) this.openAt(i); });
      b.addEventListener('focus', () => this._setCurrent(i));
      b.addEventListener('keydown', (e) => this._key(i, e));
      return b;
    });
    this.el = h('nav.menubar', { role: 'menubar', 'aria-label': 'Menu bar', 'aria-orientation': 'horizontal' }, this.buttons);
    // a press on the bar: note what has the focus before the click moves it to a title (in the capture phase, and
    // registered before any menu's own listener, so an open menu is still there and keeps what was noted)
    document.addEventListener('pointerdown', (e) => { if (this.el.contains(e.target)) this._remember(); }, true);
    // Tab into the bar: remember where from; Tab out of it: nothing to go back to
    this.el.addEventListener('focusin', (e) => { const from = this._outside(e.relatedTarget); if (from) this._prev = from; });
    this.el.addEventListener('focusout', (e) => { if (this._outside(e.relatedTarget)) this._prev = null; });
  }

  /** `el` when it is a focusable place outside the bar and its menus, else null. */
  _outside(el) {
    return el && el !== document.body && el.isConnected !== false && !this.el.contains(el) && !el.closest?.('.menu') ? el : null;
  }
  /** Note what has the focus now, unless the bar or one of its menus has it (then what was noted stays). */
  _remember() {
    const a = document.activeElement;
    if (a && (this.el.contains(a) || a.closest?.('.menu'))) return;
    this._prev = this._outside(a);
  }

  _setCurrent(i) {
    this.current = i;
    this.buttons.forEach((b, k) => { b.tabIndex = k === i ? 0 : -1; });
  }

  _key(i, e) {
    const n = this.buttons.length;
    const go = (k) => { const j = (k + n) % n; this._setCurrent(j); this.buttons[j].focus(); };
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.openAt(i);
    else return;   // Enter and Space are the button's own click
    e.preventDefault(); e.stopPropagation();
  }

  /** The items of menu `id` now. */
  items(id) {
    return appMenus(this.shell.app, this.shell, this.panels).find((m) => m.id === id)?.items ?? [];
  }

  /** Open menu `i` (wrapping around the bar) under its title. Returns the menu element, or null when the click closed it. */
  openAt(i) {
    const n = this.buttons.length, j = ((i % n) + n) % n;
    const b = this.buttons[j], def = MENUS[j];
    const m = showMenu(b, this.items(def.id), {
      label: def.label, gap: 4, below: true, className: 'from-bar',
      onClose: () => { if (this.openIndex === j) this.openIndex = -1; b.setAttribute('aria-expanded', 'false'); },
      onNav: (d) => this.openAt(j + d),
      // once a command has run, the keyboard is back where it was (the view, a field), as in desktop programs;
      // from nowhere in particular it stays nowhere, so single-key shortcuts work at once
      returnFocus: () => this._prev,
    });
    if (!m) return null;
    this.openIndex = j;
    this._setCurrent(j);
    b.setAttribute('aria-expanded', 'true');
    return m;
  }

  /** Open the menu with this id ('file', 'build', …). */
  open(id) { const i = MENUS.findIndex((m) => m.id === id); return i < 0 ? null : this.openAt(i); }

  /** Put the keyboard on the bar, at File (F10). */
  focus() { this._remember(); this._setCurrent(0); this.buttons[0]?.focus(); }

  /** True when the bar is on screen (it is hidden on phones and in full screen). */
  get visible() { return this.el.getClientRects?.().length > 0; }
}
