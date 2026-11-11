/**
 * The menus of the menu bar as data (no DOM: tested in node). The bar follows Materials Studio: File, Edit, View,
 * Modify, Build, Tools, Window and Help, with MS's wording and grouping where a command has a counterpart there
 * (Build › Surfaces › Cleave Surface…, Build › Symmetry › Supercell…, Modify › Constraints…).
 *
 * MENUS says where things go; buildMenus(env) turns it into the item lists of showMenu (ui/overlays.js) from the
 * command registry as it is at that moment, so a command registered later (a module, a plugin) is in its menu the
 * next time the menu opens. An entry of a menu is
 * - '-': a separator;
 * - 'file.open' or {cmd: 'file.open', label, icon, checked(c, state), radio, disabled(c, state), onlyAvailable}: a
 *   command. It is left out while no command has that id, while it is hidden, and while it is a section fallback
 *   (core/commands.js SECTION_COMMANDS: `fallback: true`) whose panel section no module has registered yet, so the
 *   menus have no dead items. A command that cannot run now is greyed, with the reason as its tooltip;
 * - {family: 'look.', …}: every command whose id starts with the prefix, in registry order (representations, looks,
 *   lighting presets, colour schemes, effects: the registries behind them, plugins included);
 * - {dyn: 'writers'}: items made by env.dynamic.writers(env) (lists that are not commands: storage providers, the
 *   structures of the project, samples by category);
 * - {rest: ['Surface']}: the commands of those categories that no menu has placed, {rest: '*'}: all that is left,
 *   one submenu per category (how commands of plugins get in without anyone editing MENUS);
 * - {label, icon, items: [entries]}: a submenu (left out when it ends up empty), {header: 'text'}: a heading.
 *
 * env = {commands: {list, get, available, unavailableReason}, hasSection(panel, section), hideCommand(c)?,
 *        keyLabel(spec), run(c), state, dynamic: {name: (env) => items}}.
 */
import { SECTION_COMMANDS } from '../core/commands.js';
import { cleanItems } from './overlays.js';

export const SEP = '-';

/** The Materials Studio wording (Title Case, as its menus have it) of the commands the menus name themselves. */
export const MENU_LABELS = Object.freeze({
  'project.new': 'New Project', 'file.open': 'Open…', 'file.paste': 'Paste Structure Text…', 'project.save': 'Save Project', 'project.download': 'Download Project File',
  'export.png1': 'PNG — Screen Size', 'export.png2': 'PNG — 2× (Print)', 'export.png4': 'PNG — 4× (Poster)', 'export.pngT': 'PNG — Transparent Background', 'export.glb': '3D Model (.glb)',
  'edit.undo': 'Undo', 'edit.redo': 'Redo', 'edit.cancelPreview': 'Cancel Preview',
  'sel.delete': 'Delete', 'sel.all': 'Select All', 'sel.invert': 'Invert Selection', 'sel.sameElement': 'Same Element', 'sel.grow': 'Bonded Neighbours', 'sel.fragment': 'Bonded Fragment',
  'sel.query': 'Atom Selection…', 'sel.clear': 'Clear Selection',
  'view.cell': 'Unit Cell', 'view.turntable': 'Turntable', 'view.projection': 'Switch Perspective / Orthographic', 'view.labels': 'Cycle Labels',
  'view.normal': 'Surface Normal (Top)', 'view.normalBelow': 'Surface Normal (Bottom)', 'view.a': 'a Axis', 'view.b': 'b Axis', 'view.c': 'c Axis',
  'view.x': 'x Axis', 'view.y': 'y Axis', 'view.z': 'z Axis', 'view.along': 'Direction or Plane…',
  'view.reset': 'Reset View', 'view.fit': 'Fit to View', 'view.zoomIn': 'Zoom In', 'view.zoomOut': 'Zoom Out', 'view.showAll': 'Show All Atoms', 'view.fullscreen': 'Full Screen',
  'traj.play': 'Play / Pause', 'traj.prev': 'Previous Frame', 'traj.next': 'Next Frame',
  'ui.left': 'Explorer Panel', 'ui.right': 'Appearance Panel', 'ui.theme': 'Switch Light / Dark',
  'sel.replace': 'Modify Element…', 'constraints.edit': 'Constraints…', 'sel.fix': 'Fix Selected Atoms', 'sel.free': 'Free Selected Atoms', 'cell.parameters': 'Lattice Parameters…',
  'build.crystal': 'Build Crystal…', 'surface.vacuum': 'Build Vacuum Slab…', 'surface.cleave': 'Cleave Surface…', 'surface.setVacuum': 'Set Vacuum…', 'surface.flip': 'Flip Slab', 'surface.center': 'Centre Slab',
  'cell.supercell': 'Supercell…', 'cell.redefine': 'Redefine Lattice…', 'cell.reorient': 'Re-orient to Standard', 'build.cluster': 'Nanocluster…', 'build.molecule': 'Molecule…',
  'adsorbate.add': 'Add Adsorbate…', 'sites.find': 'Find Adsorption Sites', 'build.layers': 'Build Layers…',
  'tool.select': 'Selection Tool', 'tool.measure': 'Distance', 'tool.angle': 'Angle', 'tool.dihedral': 'Dihedral', 'tool.clearMeasurements': 'Clear Measurements',
  'tool.move': 'Move Tool', 'tool.sitePick': 'Pick Adsorption Site',
  'ui.palette': 'Command Palette…', 'ui.api': 'Scripting & API…', 'api.copyScene': 'Copy Scene as Script', 'ui.shortcuts': 'Keyboard Shortcuts', 'ui.tour': 'Take the Tour', 'ui.about': 'About Facet',
});

/** The icons of commands in the menus and on the toolbar. */
export const MENU_ICONS = Object.freeze({
  'project.new': 'filePlus', 'file.open': 'open', 'file.paste': 'clipboard', 'project.save': 'save', 'project.download': 'download', 'export.glb': 'cube',
  'export.png1': 'image', 'export.png2': 'image', 'export.png4': 'image', 'export.pngT': 'image',
  'edit.undo': 'undo', 'edit.redo': 'redo', 'sel.delete': 'trash', 'sel.all': 'atom', 'sel.clear': 'x',
  'view.reset': 'reset', 'view.fit': 'fit', 'view.zoomIn': 'zoom-in', 'view.zoomOut': 'zoom-out', 'view.showAll': 'eye', 'view.fullscreen': 'maximize',
  'sel.replace': 'edit', 'constraints.edit': 'lock', 'sel.fix': 'lock', 'sel.free': 'unlock', 'cell.parameters': 'cell',
  'build.crystal': 'build', 'surface.vacuum': 'layers', 'surface.cleave': 'surface', 'surface.setVacuum': 'layers', 'surface.flip': 'swap', 'surface.center': 'crosshair',
  'cell.supercell': 'grid', 'cell.redefine': 'matrix', 'cell.reorient': 'axes', 'build.cluster': 'atom', 'build.molecule': 'share',
  'adsorbate.add': 'target', 'sites.find': 'target', 'build.layers': 'layers',
  'tool.select': 'pointer', 'tool.measure': 'ruler', 'tool.angle': 'ruler', 'tool.dihedral': 'ruler', 'tool.clearMeasurements': 'trash', 'tool.move': 'move', 'tool.sitePick': 'target',
  'ui.palette': 'command', 'ui.api': 'plug', 'api.copyScene': 'copy', 'ui.shortcuts': 'keyboard', 'ui.tour': 'sparkles', 'ui.about': 'info',
});

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from', 'per', 'into']);
/**
 * A command title in the Title Case of the menus ('Copy current scene as script' → 'Copy Current Scene as Script').
 * Words that already have a capital or a digit (PNG, glTF, 2×), what is in brackets ('(screen size)'), small words
 * and single letters (the axes a, b, c) stay as they are.
 */
export function menuCase(title) {
  let depth = 0;
  return String(title ?? '').split(' ').map((w, i) => {
    const inside = depth > 0;
    depth = Math.max(0, depth + (w.split('(').length - 1) - (w.split(')').length - 1));
    if (!w || inside || !/^[a-z]/.test(w) || /[A-Z0-9]/.test(w)) return w;
    if (i > 0 && (SMALL_WORDS.has(w) || w.length === 1)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join(' ');
}

const SECTION_OF = new Map(SECTION_COMMANDS.map((r) => [r.id, r.open]));

/**
 * Whether command `c` is in the menus now: not hidden, not one the environment hides (env.hideCommand: downloads
 * that this page cannot make), and, for the fallback of a surface-tool command, only once its panel section exists.
 */
export function commandShown(c, env) {
  if (!c || c.hidden) return false;
  if (c.fallback) {
    const [panel, section] = SECTION_OF.get(c.id) ?? [];
    if (!section || !env.hasSection?.(panel, section)) return false;
  }
  return !env.hideCommand?.(c);
}

const val = (v, ...a) => (typeof v === 'function' ? v(...a) : v);
const tail = (c, prefix) => c.id.slice(prefix.length);

/** The menu item of command `c`; `o` (a menu entry) may give label, icon, checked(c, state), radio and disabled(c, state). */
export function commandItem(c, env, o = {}) {
  const st = env.state ?? {};
  const key = c.kbd ?? c.key;
  const own = o.disabled != null;
  const off = own ? !!val(o.disabled, c, st) : !env.commands.available(c);
  const item = {
    id: c.id, label: val(o.label, c, st) ?? MENU_LABELS[c.id] ?? menuCase(c.title ?? c.id), icon: o.icon ?? MENU_ICONS[c.id] ?? null,
    kbd: key ? env.keyLabel(Array.isArray(key) ? key[0] : key) : null,
    disabled: off, tip: off && !own ? env.commands.unavailableReason(c) : null,
    run: () => env.run(c),
  };
  // a check item shows its mark where the icon would be
  if (typeof o.checked === 'function') { item.checked = !!o.checked(c, st); item.icon = null; if (o.radio) item.radio = true; }
  return item;
}

const family = (prefix, current) => ({ family: prefix, label: (c) => c.title ?? c.id, radio: true, checked: (c, st) => st[current] === tail(c, prefix) });

/** The menu bar: where every command goes (see the top of this file for the entries). */
export const MENUS = Object.freeze([
  { id: 'file', label: 'File', items: [
    'project.new', 'file.open',
    { label: 'Import', icon: 'upload', items: [{ cmd: 'file.open', label: 'Structure Files…', icon: 'file' }, 'file.paste', { dyn: 'importSamples' }] },
    SEP,
    'project.save',
    { label: 'Save Project To', icon: 'folder', items: [{ dyn: 'providers' }] },
    'project.download',
    { dyn: 'autosave' },
    SEP,
    { label: 'Export', icon: 'download', items: [
      { label: 'Image', icon: 'image', items: ['export.png1', 'export.png2', 'export.png4', 'export.pngT', SEP, { dyn: 'exportOptions' }] },
      'export.glb',
      { label: 'Structure File', icon: 'file', items: [{ dyn: 'writers' }] },
      { rest: ['Export'] },
    ] },
    { rest: ['File'] },
    SEP,
    { dyn: 'account' },
  ] },
  { id: 'edit', label: 'Edit', items: [
    { cmd: 'edit.undo', label: (c, st) => (st.undoLabel ? `Undo ${st.undoLabel}` : 'Undo'), disabled: (c, st) => !st.canUndo },
    { cmd: 'edit.redo', label: (c, st) => (st.redoLabel ? `Redo ${st.redoLabel}` : 'Redo'), disabled: (c, st) => !st.canRedo },
    { cmd: 'edit.cancelPreview', onlyAvailable: true },
    SEP,
    'sel.delete',
    SEP,
    'sel.all', 'sel.invert',
    { label: 'Select', icon: 'neighbors', items: ['sel.sameElement', 'sel.grow', 'sel.fragment'] },
    'sel.query', 'sel.clear',
    SEP,
    { rest: ['Edit'] },
  ] },
  { id: 'view', label: 'View', items: [
    { label: 'Display Style', icon: 'style', items: [family('rep.', 'rep')] },
    { label: 'Looks', icon: 'sparkles', items: [family('look.', 'look')] },
    { label: 'Lighting', icon: 'sun', items: [family('light.', 'lighting')] },
    { label: 'Colour Scheme', icon: 'palette', items: [family('color.', 'colorScheme')] },
    { label: 'Effects', icon: 'wand', items: [{ family: 'toggle.', label: (c) => menuCase(String(c.title ?? c.id).replace(/^Toggle /, '')), checked: (c, st) => !!st.get?.(tail(c, 'toggle.')) }] },
    SEP,
    { label: 'Labels', icon: 'info', items: [{ dyn: 'labels' }, SEP, 'view.labels'] },
    { cmd: 'view.cell', checked: (c, st) => !!st.cell },
    { label: 'Projection', icon: 'projection', items: [{ dyn: 'projection' }, SEP, 'view.projection'] },
    { cmd: 'view.turntable', checked: (c, st) => !!st.turntable },
    SEP,
    { label: 'Look Along', icon: 'axes', items: ['view.normal', 'view.normalBelow', SEP, 'view.a', 'view.b', 'view.c', SEP, 'view.x', 'view.y', 'view.z', SEP, 'view.along'] },
    'view.reset', 'view.fit', 'view.zoomIn', 'view.zoomOut', 'view.showAll',
    { label: 'Animation', icon: 'play', items: ['traj.play', 'traj.prev', 'traj.next', { rest: ['Trajectory'] }] },
    { rest: ['View'] },
    SEP,
    { label: 'Explorers', icon: 'panel-left', items: [{ dyn: 'panels' }, SEP, { cmd: 'ui.left', checked: (c, st) => !!st.leftOpen }] },
    { cmd: 'ui.right', checked: (c, st) => !!st.inspectorOpen },
    { label: 'Theme', icon: 'moon', items: [{ dyn: 'theme' }, SEP, 'ui.theme'] },
    { cmd: 'view.fullscreen', checked: (c, st) => !!st.fullscreen },
  ] },
  { id: 'modify', label: 'Modify', items: [
    'sel.replace',
    SEP,
    'constraints.edit', 'sel.fix', 'sel.free',
    SEP,
    'cell.parameters', { rest: ['Cell'] },
  ] },
  { id: 'build', label: 'Build', items: [
    { label: 'Crystals', icon: 'build', items: ['build.crystal', 'surface.vacuum'] },
    { label: 'Surfaces', icon: 'surface', items: ['surface.cleave', 'surface.setVacuum', 'surface.flip', 'surface.center', { rest: ['Surface'] }] },
    { label: 'Symmetry', icon: 'grid', items: ['cell.supercell', 'cell.redefine', 'cell.reorient'] },
    { label: 'Build Nanostructure', icon: 'atom', items: ['build.cluster', 'build.molecule'] },
    SEP,
    'adsorbate.add', 'sites.find', 'build.layers', { rest: ['Build'] },
    SEP,
    { label: 'Samples', icon: 'library', items: [{ dyn: 'samples' }] },
  ] },
  { id: 'tools', label: 'Tools', items: [
    'tool.select',
    { label: 'Measure', icon: 'ruler', items: ['tool.measure', 'tool.angle', 'tool.dihedral', SEP, 'tool.clearMeasurements'] },
    'tool.move', 'tool.sitePick', { rest: ['Tools'] },
    SEP,
    { label: 'Analyses', icon: 'chart', items: [{ dyn: 'analyses' }] },
    { rest: '*' },
    SEP,
    'ui.palette', 'ui.api', 'api.copyScene',
  ] },
  { id: 'window', label: 'Window', items: [
    { dyn: 'panels' },
    SEP,
    { cmd: 'ui.left', checked: (c, st) => !!st.leftOpen },
    { cmd: 'ui.right', checked: (c, st) => !!st.inspectorOpen },
    { cmd: 'view.fullscreen', checked: (c, st) => !!st.fullscreen },
    { rest: ['Window'] },
    SEP,
    { dyn: 'structures' },
  ] },
  { id: 'help', label: 'Help', items: [
    { dyn: 'tour' },
    'ui.shortcuts', 'ui.palette', 'ui.api',
    { rest: ['Help'] },
    SEP,
    'ui.about',
  ] },
]);

/**
 * The menus as showMenu item lists: [{id, label, items}] for MENUS (or `menus`) and the commands of env.commands now.
 * Each item made from a command carries its `id`. A menu that ends up empty is left out.
 */
export function buildMenus(env, menus = MENUS) {
  const placed = new Set();
  const shown = (c) => commandShown(c, env);
  const get = (id) => { const c = env.commands.get(id); return c && shown(c) ? c : null; };
  const item = (c, o) => { placed.add(c.id); return commandItem(c, env, o); };
  /** Items a dynamic list made: those that stand for a command (their `id`) count as placed, in submenus too. */
  const adopt = (items) => { for (const it of items ?? []) { if (!it) continue; if (it.id) placed.add(it.id); if (Array.isArray(it.items)) adopt(it.items); } return items ?? []; };

  const resolve = (entries) => {
    const out = [];
    for (const e of entries ?? []) {
      if (e === SEP) out.push({ separator: true });
      else if (typeof e === 'string') { const c = get(e); if (c) out.push(item(c)); }
      else if (!e || typeof e !== 'object') continue;
      else if (e.header) out.push({ header: e.header });
      else if (e.cmd) {
        const c = get(e.cmd);
        if (c && e.onlyAvailable && !env.commands.available(c)) placed.add(c.id);   // its place is here, when it can run
        else if (c) out.push(item(c, e));
      }
      else if (e.family) { for (const c of env.commands.list()) if (String(c.id).startsWith(e.family) && shown(c)) out.push(item(c, e)); }
      else if (e.dyn) out.push(...adopt(env.dynamic?.[e.dyn]?.(env)).filter(Boolean));
      else if (e.rest) out.push({ rest: e.rest });
      else if (e.items) out.push({ label: e.label, icon: e.icon ?? null, items: resolve(e.items) });
    }
    return out;
  };
  const tree = menus.map((m) => ({ id: m.id, label: m.label, items: resolve(m.items) }));

  // what no menu names: first the categories a menu asks for, then all that is left, one submenu per category
  const left = () => env.commands.list().filter((c) => !placed.has(c.id) && shown(c));
  const fill = (items, all) => items.flatMap((it) => {
    if (it.items) { it.items = fill(it.items, all); return [it]; }
    if (!it.rest) return [it];
    if (it.rest === '*') {
      if (!all) return [it];
      const groups = new Map();
      for (const c of left()) { const g = c.category ?? 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
      return [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b))).map((g) => ({ label: g, icon: null, items: groups.get(g).map((c) => item(c)) }));
    }
    if (all) return [];
    const cats = [].concat(it.rest);
    return left().filter((c) => cats.includes(c.category)).map((c) => item(c));
  });
  for (const m of tree) m.items = fill(m.items, false);
  for (const m of tree) m.items = fill(m.items, true);
  return tree.map((m) => ({ ...m, items: cleanItems(m.items) })).filter((m) => m.items.length);
}

/** Every item of a menu tree that runs something, with the labels of the menus above it: [{path: ['File', 'Export'], item}]. */
export function flattenMenus(tree) {
  const out = [];
  const walk = (items, path) => {
    for (const it of items ?? []) {
      if (!it || it.separator || it.header) continue;
      if (Array.isArray(it.items)) walk(it.items, [...path, it.label]);
      else out.push({ path, item: it });
    }
  };
  for (const m of tree) walk(m.items, [m.label]);
  return out;
}
