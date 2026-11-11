// The menu bar (facet/web/js/ui/menumodel.js, ui/menubar.js) and menus with submenus (ui/overlays.js showMenu):
// the Materials Studio layout File, Edit, View, Modify, Build, Tools, Window, Help built from the command registry
// (fallbacks of surface-tool commands only once their panel section exists, commands of plugins by category), the
// item lists (separators, empty submenus), and how a menu with submenus opens, closes and takes the keyboard.
// A small DOM stands in for the page. Run: node --test tests/js/menus.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ a small DOM (what ui/dom.js h() and showMenu use)
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.data = String(t); } get textContent() { return this.data; } }
/** '.mi', '.menu.sub', '.mi:not([aria-disabled="true"])': classes and one :not([attr="value"]). */
function matcher(sel) {
  const not = /:not\(\[([\w-]+)="([^"]*)"\]\)/.exec(sel);
  const classes = sel.replace(/:not\(.*\)/, '').split('.').filter(Boolean);
  return (el) => classes.every((c) => el.classList.contains(c)) && (!not || el.getAttribute(not[1]) !== not[2]);
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), childNodes: [], listeners: [], attrs: new Map(), style: {}, dataset: {}, parentNode: null, hidden: false, rect: null });
    const set = new Set();
    this.classList = { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)) };
  }
  get isConnected() { for (let x = this; x; x = x.parentNode) if (x === document.body) return true; return false; }
  get children() { return this.childNodes.filter((n) => n instanceof FakeElement); }
  get content() { return { firstChild: new FakeElement('svg') }; }   // <template> of ui/dom.js ic()
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  append(...ns) { for (const n of ns) { const node = n instanceof FakeNode ? n : new FakeText(n); node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); } }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
  querySelectorAll(sel) { const m = matcher(sel); return [...this.descendants()].filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || !!opts?.capture }); }
  removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); }
  fire(type, init = {}) {
    const e = { type, target: this, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
    for (const l of [...this.listeners]) if (l.type === type) l.fn.call(this, e);
    return e;
  }
  click() { return this.fire('click'); }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { const r = this.rect ?? { left: 0, top: 0, width: 0, height: 0 }; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; }
}
const body = new FakeElement('body');
const docListeners = [];
globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
globalThis.document = {
  body, documentElement: new FakeElement('html'), fullscreenElement: null, activeElement: body,
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(t),
  addEventListener: (type, fn) => docListeners.push({ type, fn }),
  removeEventListener: (type, fn) => { const i = docListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
};
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
const realSetTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { showMenu, closeMenu, menuOpen, menuContains, cleanItems } = await import(web('ui/overlays.js'));
const M = await import(web('ui/menumodel.js'));
const { MENUS, MENU_LABELS, MENU_ICONS, SEP, buildMenus, commandItem, commandShown, flattenMenus, menuCase } = M;
const { SECTION_COMMANDS, sectionFallbacks } = await import(web('core/commands.js'));
const { keyLabel } = await import(web('ui/keys.js'));

const menus = () => body.children.filter((el) => el.classList.contains('menu'));
const itemsOf = (m) => m.querySelectorAll('.mi');
const labelsOf = (m) => itemsOf(m).map((b) => b._item.label);
const item = (m, label) => itemsOf(m).find((b) => b._item.label === label);
const key = (m, k, init = {}) => m.fire('keydown', { key: k, ...init });
afterEach(() => { closeMenu(); globalThis.innerWidth = 1280; document.activeElement = body; });

// ------------------------------------------------------------------ item lists
describe('cleanItems', () => {
  const S = { separator: true };
  const labels = (list) => list.map((it) => (it.separator ? '-' : it.header ? `#${it.header}` : it.items ? `${it.label}>[${labels(it.items)}]` : it.label)).join(' ');
  test('drops empty entries, separators at the ends and doubled separators', () => {
    assert.equal(labels(cleanItems([null, S, { label: 'a' }, S, S, false, { label: 'b' }, undefined, S])), 'a - b');
    assert.deepEqual(cleanItems([S, S]), []);
    assert.deepEqual(cleanItems(null), []);
  });
  test('a header needs an item under it', () => {
    assert.equal(labels(cleanItems([{ header: 'A' }, { label: 'a' }, { header: 'B' }])), '#A a');
    assert.equal(labels(cleanItems([{ header: 'A' }, S, { header: 'B' }, { label: 'b' }])), '#B b');
    assert.equal(labels(cleanItems([{ header: 'A' }, { header: 'B' }, { label: 'b' }])), '#B b');
  });
  test('a submenu without items goes, with the separator it leaves behind; submenus are cleaned too', () => {
    const list = cleanItems([{ label: 'a' }, S, { label: 'Empty', items: [S, null] }, S, { label: 'Sub', items: [S, { label: 'x' }, S, { label: 'Deep', items: [] }] }]);
    assert.equal(labels(list), 'a - Sub>[x]');
  });
  test('a function is called for the list; a submenu given as a function is kept for when it opens', () => {
    let calls = 0;
    const lazy = () => { calls++; return [{ label: 'late' }]; };
    const list = cleanItems(() => [{ label: 'a' }, { label: 'Lazy', items: lazy }]);
    assert.equal(list.length, 2);
    assert.equal(list[1].items, lazy);
    assert.equal(calls, 0);
  });
  test('the input is not changed', () => {
    const sub = [S, { label: 'x' }];
    const src = [S, { label: 'Sub', items: sub }];
    cleanItems(src);
    assert.equal(src.length, 2);
    assert.equal(sub.length, 2);
  });
});

test('menuCase: the Title Case of the menus, leaving capitals, digits, brackets, small words and axis letters alone', () => {
  assert.equal(menuCase('Copy current scene as script'), 'Copy Current Scene as Script');
  assert.equal(menuCase('Export PNG 2×'), 'Export PNG 2×');
  assert.equal(menuCase('Export PNG (screen size)'), 'Export PNG (screen size)');
  assert.equal(menuCase('Look along a'), 'Look Along a');
  assert.equal(menuCase('glTF model for the web'), 'glTF Model for the Web');
  assert.equal(menuCase('fix bottom layers…'), 'Fix Bottom Layers…');
  assert.equal(menuCase(''), '');
});

// ------------------------------------------------------------------ the model
/** A command registry of its own, and the env of buildMenus around it. */
function world(list, { sections = [], state = {}, dynamic = {}, hide = null } = {}) {
  const ran = [];
  const reg = {
    list: () => list, get: (id) => list.find((c) => c.id === id),
    available: (c) => { try { return !c.when || !!c.when(); } catch { return false; } },
    unavailableReason: (c) => c.whyNot?.() ?? 'Load a structure first.',
  };
  const env = {
    commands: reg, keyLabel, run: (c) => ran.push(c.id), state, dynamic,
    hasSection: (panel, section) => sections.includes(`${panel}.${section}`),
    ...(hide ? { hideCommand: hide } : {}),
  };
  return { env, ran };
}
const C = (id, title, category, extra = {}) => ({ id, title, category, run() {}, ...extra });
/** The fallbacks main.js registers for the surface-tool commands (they open a panel section). */
const fallbacks = () => sectionFallbacks({ open: () => false });
const find = (tree, id) => flattenMenus(tree).find((x) => x.item.id === id);
const pathOf = (tree, id) => { const x = find(tree, id); return x ? [...x.path, x.item.label].join(' › ') : null; };
const menuOf = (tree, id) => tree.find((m) => m.id === id);

describe('MENUS', () => {
  test('File, Edit, View, Modify, Build, Tools, Window, Help, in the order of Materials Studio', () => {
    assert.deepEqual(MENUS.map((m) => m.label), ['File', 'Edit', 'View', 'Modify', 'Build', 'Tools', 'Window', 'Help']);
    assert.deepEqual(MENUS.map((m) => m.id), ['file', 'edit', 'view', 'modify', 'build', 'tools', 'window', 'help']);
  });
  test('every command of SECTION_COMMANDS has a place of its own (not only the catch-all)', () => {
    const named = new Set();
    const walk = (entries) => { for (const e of entries) { if (typeof e === 'string' && e !== SEP) named.add(e); else if (e?.cmd) named.add(e.cmd); else if (e?.items) walk(e.items); } };
    for (const m of MENUS) walk(m.items);
    for (const r of SECTION_COMMANDS) assert.ok(named.has(r.id), `${r.id} is not in MENUS`);
  });
  test('every command main.js registers by a literal id is named in MENUS, comes from a family or a list, or is hidden', () => {
    const named = new Set(), prefixes = [];
    const walk = (entries) => { for (const e of entries) { if (typeof e === 'string' && e !== SEP) named.add(e); else if (e?.cmd) named.add(e.cmd); else if (e?.family) prefixes.push(e.family); else if (e?.items) walk(e.items); } };
    for (const m of MENUS) walk(m.items);
    const src = readFileSync(web('main.js'), 'utf8');
    const ids = [...src.matchAll(/\bR\(\{\s*id: '([\w.]+)'/g)].map((m) => m[1]);
    assert.ok(ids.length > 40, `found ${ids.length} commands in main.js`);
    // hidden: the Backspace twin of sel.delete; Help › Take the Tour is made by the list `tour` (it may offer to resume)
    const elsewhere = new Set(['sel.delete2', 'ui.tour']);
    const missing = ids.filter((id) => !named.has(id) && !prefixes.some((p) => id.startsWith(p)) && !elsewhere.has(id));
    assert.deepEqual(missing, []);
  });
  test('the labels and icons name commands, in the wording of Materials Studio', () => {
    assert.equal(MENU_LABELS['surface.cleave'], 'Cleave Surface…');
    assert.equal(MENU_LABELS['surface.vacuum'], 'Build Vacuum Slab…');
    assert.equal(MENU_LABELS['cell.supercell'], 'Supercell…');
    assert.equal(MENU_LABELS['constraints.edit'], 'Constraints…');
    for (const id of Object.keys(MENU_ICONS)) assert.ok(MENU_LABELS[id], `${id} has an icon but no label`);
  });
});

describe('commandItem', () => {
  test('label, shortcut, icon and run', () => {
    const { env, ran } = world([]);
    const it = commandItem(C('file.open', 'Open files…', 'File', { kbd: 'mod+o' }), env);
    assert.deepEqual([it.id, it.label, it.icon, it.disabled, it.tip], ['file.open', 'Open…', 'open', false, null]);
    assert.equal(it.kbd, keyLabel('mod+o'));
    it.run();
    assert.deepEqual(ran, ['file.open']);
    // the first key of several; a title of its own in Title Case
    const other = commandItem(C('my.thing', 'Do the thing now', 'Tools', { key: ['Home', 'r'] }), env);
    assert.deepEqual([other.label, other.kbd, other.icon], ['Do the Thing Now', 'Home', null]);
    assert.equal(commandItem(C('x.y', 'Plain', 'Tools'), env).kbd, null);
  });
  test('a command that cannot run now is greyed, with the reason as its tooltip', () => {
    const { env } = world([]);
    const it = commandItem(C('sel.delete', 'Delete selected atoms', 'Edit', { when: () => false, whyNot: () => 'Select atoms first.' }), env);
    assert.deepEqual([it.label, it.disabled, it.tip], ['Delete', true, 'Select atoms first.']);
    assert.equal(commandItem(C('view.fit', 'Fit to screen', 'View', { when: () => { throw new Error('boom'); } }), env).disabled, true);
  });
  test('check marks, radio groups, and labels and greying of the menu entry itself', () => {
    const { env } = world([], { state: { cell: true, undoLabel: 'Delete 2 atoms', canUndo: false } });
    const check = commandItem(C('view.cell', 'Toggle unit cell', 'View'), env, { icon: 'cell', checked: (c, st) => !!st.cell });
    assert.deepEqual([check.checked, check.radio, check.icon], [true, undefined, null], 'the mark takes the place of the icon');
    const radio = commandItem(C('look.ms', 'MS', 'Look'), env, { radio: true, checked: () => false });
    assert.deepEqual([radio.checked, radio.radio, radio.label], [false, true, 'MS']);
    const undo = commandItem(C('edit.undo', 'Undo', 'Edit'), env, { label: (c, st) => `Undo ${st.undoLabel}`, disabled: (c, st) => !st.canUndo });
    assert.deepEqual([undo.label, undo.disabled, undo.tip], ['Undo Delete 2 atoms', true, null]);
  });
});

describe('buildMenus', () => {
  test('the fallback of a surface-tool command is left out until its panel section exists; the real command is in at once', () => {
    const fb = fallbacks();
    assert.ok(fb.every((c) => c.fallback === true) && fb.length === SECTION_COMMANDS.length);
    let tree = buildMenus(world(fb).env);
    assert.deepEqual(tree, [], 'no dead items: nothing but fallbacks gives no menu at all');
    for (const c of fb) assert.equal(commandShown(c, world(fb).env), false, c.id);

    // the section exists (a module registered it): its fallback opens it, so the item is there
    tree = buildMenus(world(fb, { sections: ['surface.cleave', 'structure.cell'] }).env);
    assert.equal(pathOf(tree, 'surface.cleave'), 'Build › Surfaces › Cleave Surface…');
    assert.equal(pathOf(tree, 'cell.supercell'), 'Build › Symmetry › Supercell…');
    assert.equal(pathOf(tree, 'cell.parameters'), 'Modify › Lattice Parameters…');
    assert.equal(find(tree, 'surface.setVacuum'), undefined, 'the Slab section is not there');
    assert.equal(find(tree, 'sel.query'), undefined, 'a fallback that only opens a panel is never an item');

    // a module registers the command itself (no `fallback`): shown without any section
    const real = fb.map((c) => (['surface.cleave', 'surface.vacuum', 'surface.setVacuum', 'surface.flip', 'surface.center', 'sel.fix', 'sel.free'].includes(c.id) ? C(c.id, c.title, c.category) : c));
    tree = buildMenus(world(real).env);
    assert.deepEqual(flattenMenus(tree).map((x) => [...x.path, x.item.label].join(' › ')), [
      'Modify › Fix Selected Atoms', 'Modify › Free Selected Atoms',
      'Build › Crystals › Build Vacuum Slab…',
      'Build › Surfaces › Cleave Surface…', 'Build › Surfaces › Set Vacuum…', 'Build › Surfaces › Flip Slab', 'Build › Surfaces › Centre Slab',
    ]);
  });

  test('commands nobody placed go to the menu of their category; other categories get a submenu of Tools', () => {
    const list = [
      C('file.open', 'Open files…', 'File'), C('plug.file', 'Import from the database…', 'File'),
      C('plug.surface', 'Passivate surface', 'Surface'), C('plug.cell', 'Niggli reduce', 'Cell'), C('plug.edit', 'Wrap atoms', 'Edit'),
      C('plug.view', 'Show bond orders', 'View'), C('plug.build', 'Build nanotube…', 'Build'), C('plug.tools', 'Check geometry', 'Tools'),
      C('plug.win', 'Tile views', 'Window'), C('plug.help', 'Plugin manual', 'Help'), C('plug.export', 'Export to LAMMPS', 'Export'),
      C('plug.a1', 'Radial distribution', 'Analysis'), C('plug.a2', 'Bader charges', 'Analysis'), C('plug.none', 'No category at all'),
      C('plug.hidden', 'Not for menus', 'Tools', { hidden: true }),
    ];
    const tree = buildMenus(world(list).env);
    assert.equal(pathOf(tree, 'plug.file'), 'File › Import from the Database…');
    assert.equal(pathOf(tree, 'plug.export'), 'File › Export › Export to LAMMPS');
    assert.equal(pathOf(tree, 'plug.surface'), 'Build › Surfaces › Passivate Surface');
    assert.equal(pathOf(tree, 'plug.cell'), 'Modify › Niggli Reduce');
    assert.equal(pathOf(tree, 'plug.edit'), 'Edit › Wrap Atoms');
    assert.equal(pathOf(tree, 'plug.view'), 'View › Show Bond Orders');
    assert.equal(pathOf(tree, 'plug.build'), 'Build › Build Nanotube…');
    assert.equal(pathOf(tree, 'plug.tools'), 'Tools › Check Geometry');
    assert.equal(pathOf(tree, 'plug.win'), 'Window › Tile Views');
    assert.equal(pathOf(tree, 'plug.help'), 'Help › Plugin Manual');
    assert.equal(pathOf(tree, 'plug.a1'), 'Tools › Analysis › Radial Distribution');
    assert.equal(pathOf(tree, 'plug.a2'), 'Tools › Analysis › Bader Charges');
    assert.equal(pathOf(tree, 'plug.none'), 'Tools › Other › No Category at All');
    assert.equal(find(tree, 'plug.hidden'), undefined);
    // every command is in the menus exactly once (file.open also under Import, as MENUS says)
    const count = new Map();
    for (const x of flattenMenus(tree)) count.set(x.item.id, (count.get(x.item.id) ?? 0) + 1);
    for (const c of list.filter((x) => !x.hidden)) assert.equal(count.get(c.id), c.id === 'file.open' ? 2 : 1, c.id);
  });

  test('families list the registry in its order, the current one checked; effects are check items', () => {
    const list = [
      C('look.studio', 'Studio', 'Look'), C('look.poster', 'Poster', 'Look'), C('look.lab', 'Lab night', 'Look'),
      C('rep.ballstick', 'Ball & stick', 'Representation', { key: '1' }), C('rep.spacefill', 'Space-filling', 'Representation', { key: '2' }),
      C('light.studio', 'Studio', 'Lighting'), C('color.jmol', 'Jmol', 'Colours'),
      C('toggle.post.ao.enabled', 'Toggle ambient occlusion', 'Effects'), C('toggle.post.bloom.enabled', 'Toggle bloom', 'Effects'),
    ];
    const state = { look: 'poster', rep: 'spacefill', lighting: 'studio', colorScheme: 'cpk', get: (p) => p === 'post.ao.enabled' };
    const view = menuOf(buildMenus(world(list, { state }).env), 'view');
    const sub = (label) => view.items.find((it) => it.label === label).items;
    assert.deepEqual(sub('Looks').map((it) => [it.label, it.checked, it.radio]), [['Studio', false, true], ['Poster', true, true], ['Lab night', false, true]]);
    assert.deepEqual(sub('Display Style').map((it) => [it.label, it.checked, it.kbd]), [['Ball & stick', false, '1'], ['Space-filling', true, '2']]);
    assert.deepEqual(sub('Lighting').map((it) => it.checked), [true]);
    assert.deepEqual(sub('Colour Scheme').map((it) => it.checked), [false]);
    assert.deepEqual(sub('Effects').map((it) => [it.label, it.checked, it.radio]), [['Ambient Occlusion', true, undefined], ['Bloom', false, undefined]]);
  });

  test('lists that are not commands come from env.dynamic; their items count as placed, in submenus too', () => {
    const list = [C('sample.c60', 'C₆₀ fullerene', 'Sample'), C('sample.au55', 'Au₅₅', 'Sample'), C('export.cif', 'Export CIF', 'Export'), C('panel.library', 'Show Library panel', 'Window')];
    const dynamic = {
      samples: () => [{ label: 'Molecules', items: [{ id: 'sample.c60', label: 'C₆₀ fullerene' }] }, { label: 'Clusters', items: [{ id: 'sample.au55', label: 'Au₅₅' }] }],
      writers: () => [{ id: 'export.cif', label: 'CIF', hint: '.cif' }],
      panels: () => [{ id: 'panel.library', label: 'Library', checked: true }],
      structures: () => [{ header: 'Structures in this project' }, { label: '1  Pt', radio: true, checked: true }],
    };
    const tree = buildMenus(world(list, { dynamic }).env);
    assert.equal(pathOf(tree, 'sample.c60'), 'Build › Samples › Molecules › C₆₀ fullerene');
    assert.equal(pathOf(tree, 'export.cif'), 'File › Export › Structure File › CIF');
    assert.deepEqual(flattenMenus(tree).filter((x) => x.item.id === 'panel.library').map((x) => x.path.join(' › ')), ['View › Explorers', 'Window']);
    assert.equal(menuOf(tree, 'tools'), undefined, 'nothing is left over for Tools');
    assert.deepEqual(menuOf(tree, 'window').items.map((it) => it.header ?? it.label ?? '-'), ['Library', '-', 'Structures in this project', '1  Pt']);
  });

  test('a command the environment hides (a download where files cannot be saved) is left out', () => {
    const list = [C('export.png2', 'Export PNG 2×', 'Export'), C('project.download', 'Download project file', 'File'), C('project.save', 'Save project', 'File')];
    const tree = buildMenus(world(list, { hide: (c) => c.id !== 'project.save' }).env);
    assert.deepEqual(flattenMenus(tree).map((x) => x.item.id), ['project.save']);
  });

  test('Cancel preview is there only while a preview is open, and never among the leftovers', () => {
    let open = false;
    const list = [C('sel.all', 'Select all atoms', 'Edit'), C('edit.cancelPreview', 'Cancel preview', 'Edit', { when: () => open })];
    assert.deepEqual(flattenMenus(buildMenus(world(list).env)).map((x) => x.item.id), ['sel.all']);
    open = true;
    assert.deepEqual(flattenMenus(buildMenus(world(list).env)).map((x) => x.item.label), ['Cancel Preview', 'Select All']);
  });

  test('submenus and menus that end up empty are left out, and no separator is left hanging', () => {
    const tree = buildMenus(world([C('view.fit', 'Fit to screen', 'View'), C('ui.shortcuts', 'Keyboard shortcuts', 'Help', { key: ['?', 'F1'] })]).env);
    assert.deepEqual(tree.map((m) => m.id), ['view', 'help']);
    assert.deepEqual(menuOf(tree, 'view').items.map((it) => it.label), ['Fit to View']);
    assert.deepEqual(menuOf(tree, 'help').items.map((it) => [it.label, it.kbd]), [['Keyboard Shortcuts', '?']]);
  });

  test('a menu of one’s own entries (a toolbar button): buildMenus(env, [{items}])', () => {
    const list = [C('look.a', 'A', 'Look'), C('look.b', 'B', 'Look')];
    const [m] = buildMenus(world(list, { state: { look: 'b' } }).env, [{ id: 'x', label: 'x', items: [{ family: 'look.', radio: true, checked: (c, st) => st.look === c.id.slice(5) }] }]);
    assert.deepEqual(m.items.map((it) => [it.label, it.checked]), [['A', false], ['B', true]]);
  });
});

// ------------------------------------------------------------------ showMenu with submenus
describe('showMenu', () => {
  const tree = (ran = []) => [
    { label: 'Open…', kbd: 'Ctrl O', run: () => ran.push('open') },
    { label: 'Export', icon: 'download', items: [
      { label: 'Image', items: [{ label: 'PNG', run: () => ran.push('png') }, { label: 'Off', disabled: true, tip: 'Not now', run: () => ran.push('off') }] },
      { label: '3D Model', run: () => ran.push('glb') },
    ] },
    { separator: true },
    { label: 'Autosave', checked: true, run: () => ran.push('autosave') },
    { label: 'Dark', checked: false, radio: true },
    { label: 'Empty', items: [] },
  ];
  const anchor = () => { const a = new FakeElement('button'); a.rect = { left: 100, top: 10, width: 40, height: 28 }; body.append(a); return a; };

  test('items: roles, check marks, the submenu arrow; an empty submenu is not shown', () => {
    const m = showMenu(anchor(), tree(), { label: 'File' });
    assert.equal(menuOpen(), m);
    assert.deepEqual([m.getAttribute('role'), m.getAttribute('aria-label')], ['menu', 'File']);
    assert.deepEqual(labelsOf(m), ['Open…', 'Export', 'Autosave', 'Dark']);
    const [open, exp, auto, dark] = itemsOf(m);
    assert.deepEqual([open.getAttribute('role'), open.getAttribute('aria-haspopup'), open.getAttribute('aria-checked')], ['menuitem', null, null]);
    assert.deepEqual([exp.getAttribute('aria-haspopup'), exp.getAttribute('aria-expanded')], ['menu', 'false']);
    assert.deepEqual([auto.getAttribute('role'), auto.getAttribute('aria-checked')], ['menuitemcheckbox', 'true']);
    assert.deepEqual([dark.getAttribute('role'), dark.getAttribute('aria-checked')], ['menuitemradio', 'false']);
    assert.equal(document.activeElement, open, 'the first item takes the focus');
  });

  test('a click on an item with a submenu opens it and moves the focus in; a click on a leaf runs it and closes everything', () => {
    const ran = [];
    let closed = 0;
    const a = anchor();
    const m = showMenu(a, tree(ran), { onClose: () => closed++ });
    item(m, 'Export').click();
    assert.equal(menus().length, 2);
    const sub = menus()[1];
    assert.ok(sub.classList.contains('sub'));
    assert.deepEqual(labelsOf(sub), ['Image', '3D Model']);
    assert.equal(item(m, 'Export').getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, item(sub, 'Image'));
    assert.ok(menuContains(item(sub, 'Image')) && menuContains(item(m, 'Open…')) && !menuContains(a));
    item(sub, 'Image').click();
    assert.equal(menus().length, 3);
    item(menus()[2], 'Off').click();
    assert.equal(menus().length, 3, 'a greyed item does nothing');
    item(menus()[2], 'PNG').click();
    assert.deepEqual(ran, ['png']);
    assert.equal(menus().length, 0);
    assert.equal(menuOpen(), null);
    assert.equal(closed, 1);
    assert.equal(document.activeElement, a, 'the focus is back on the button that opened the menu');
  });

  test('the keyboard: → opens a submenu, ← and Esc close it, Esc on the menu closes it; arrows wrap; letters jump', () => {
    const a = anchor();
    const m = showMenu(a, tree());
    key(m, 'ArrowDown');
    assert.equal(document.activeElement._item.label, 'Export');
    assert.equal(key(m, 'ArrowRight').prevented, true);
    let sub = menus()[1];
    assert.equal(document.activeElement, item(sub, 'Image'));
    key(sub, 'ArrowDown'); key(sub, 'ArrowDown');
    assert.equal(document.activeElement._item.label, 'Image', 'wraps around');
    key(sub, 'ArrowRight');
    assert.equal(menus().length, 3);
    assert.equal(document.activeElement._item.label, 'PNG', 'the greyed item is skipped');
    key(menus()[2], 'ArrowLeft');
    assert.equal(menus().length, 2);
    assert.equal(document.activeElement, item(sub, 'Image'));
    key(sub, 'Escape');
    assert.equal(menus().length, 1, 'Esc leaves the submenu first');
    assert.equal(document.activeElement, item(m, 'Export'));
    assert.equal(item(m, 'Export').getAttribute('aria-expanded'), 'false');
    key(m, 'End');
    assert.equal(document.activeElement._item.label, 'Dark');
    key(m, 'ArrowDown');
    assert.equal(document.activeElement._item.label, 'Open…');
    key(m, 'ArrowUp');
    assert.equal(document.activeElement._item.label, 'Dark');
    key(m, 'a');
    assert.equal(document.activeElement._item.label, 'Autosave');
    assert.equal(key(m, 'a', { ctrlKey: true }).prevented, false, 'Ctrl+A is not type-ahead');
    assert.equal(key(m, 'ArrowLeft').prevented, false, 'without a menu bar, ← on the menu is not handled');
    key(m, 'Escape');
    assert.equal(menus().length, 0);
    assert.equal(document.activeElement, a);
  });

  test('a menu of the menu bar: ← and →, where no submenu takes them, go to the neighbouring menu (onNav)', () => {
    const nav = [];
    const m = showMenu(anchor(), tree(), { onNav: (d) => nav.push(d) });
    key(m, 'ArrowRight');            // Open…: a leaf
    key(m, 'ArrowLeft');
    key(m, 'ArrowDown'); key(m, 'ArrowRight');   // Export: its submenu
    assert.deepEqual(nav, [1, -1]);
    const sub = menus()[1];
    key(sub, 'ArrowDown'); key(sub, 'ArrowRight');   // 3D Model, a leaf of the submenu
    assert.deepEqual(nav, [1, -1, 1]);
    key(sub, 'ArrowLeft');
    assert.deepEqual(nav, [1, -1, 1], '← in a submenu closes it');
    assert.equal(menus().length, 1);
  });

  test('the mouse: resting on an item with a submenu opens it, resting on another item closes it', async () => {
    // (the menus' own delays are 130 ms to open and 240 ms to close; timers fire in the order they are due)
    const m = showMenu(anchor(), tree());
    item(m, 'Export').fire('pointerenter', { pointerType: 'mouse' });
    assert.equal(menus().length, 1, 'not at once');
    await sleep(150);
    assert.equal(menus().length, 2);
    assert.equal(document.activeElement, item(m, 'Open…'), 'the focus stays where it was');
    // on the way to the submenu the pointer crosses another item: the submenu stays when it gets there in time
    item(m, 'Autosave').fire('pointerenter', { pointerType: 'mouse' });
    await sleep(60);
    menus()[1].fire('pointerenter', { pointerType: 'mouse' });
    await sleep(260);
    assert.equal(menus().length, 2);
    item(m, 'Autosave').fire('pointerenter', { pointerType: 'mouse' });
    await sleep(260);
    assert.equal(menus().length, 1);
    // a touch never opens by hover
    item(m, 'Export').fire('pointerenter', { pointerType: 'touch' });
    await sleep(160);
    assert.equal(menus().length, 1);
  });

  test('where a submenu opens: beside its item, on the other side when there is no room, inside the window', () => {
    const m = showMenu(anchor(), tree());
    const b = item(m, 'Export');
    const place = (rect, size) => {
      b.rect = rect;
      const orig = FakeElement.prototype.getBoundingClientRect;
      // the new submenu measures `size`; every other element its own rect
      FakeElement.prototype.getBoundingClientRect = function () { return this === b || this.rect ? orig.call(this) : { left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h }; };
      try { key(m, 'Home'); key(m, 'ArrowDown'); key(m, 'ArrowRight'); } finally { FakeElement.prototype.getBoundingClientRect = orig; }
      const sub = menus()[1];
      const at = [parseFloat(sub.style.left), parseFloat(sub.style.top)];
      key(sub, 'ArrowLeft');
      return at;
    };
    assert.deepEqual(place({ left: 100, top: 200, width: 220, height: 30 }, { w: 220, h: 120 }), [317, 194], 'to the right of the item');
    assert.deepEqual(place({ left: 1000, top: 200, width: 220, height: 30 }, { w: 220, h: 120 }), [783, 194], 'no room on the right: to its left');
    assert.deepEqual(place({ left: 100, top: 760, width: 220, height: 30 }, { w: 220, h: 300 }), [317, 492], 'kept inside the window');
  });

  test('phones: a submenu takes the place of its menu, with a way back', () => {
    globalThis.innerWidth = 390;
    const ran = [];
    const a = anchor();
    const m = showMenu(a, tree(ran));
    item(m, 'Export').click();
    const sub = menus()[1];
    assert.equal(m.hidden, true);
    assert.deepEqual(labelsOf(sub), ['Export', 'Image', '3D Model']);
    assert.ok(item(sub, 'Export').classList.contains('back'));
    assert.equal(document.activeElement, item(sub, 'Image'), 'the focus goes to the first real item');
    item(sub, 'Image').click();
    assert.equal(menus().length, 3);
    assert.equal(sub.hidden, true);
    item(menus()[2], 'Image').click();   // back
    assert.equal(menus().length, 2);
    assert.equal(sub.hidden, false);
    item(sub, 'Export').click();         // back to the menu
    assert.equal(menus().length, 1);
    assert.equal(m.hidden, false);
    item(m, 'Export').click();
    item(menus()[1], '3D Model').click();
    assert.deepEqual(ran, ['glb']);
    assert.equal(menus().length, 0);
  });

  test('closeMenu closes every level and tells onClose once; a new menu closes the one before', () => {
    let closed = 0;
    const m = showMenu(anchor(), tree(), { onClose: () => closed++ });
    item(m, 'Export').click();
    item(menus()[1], 'Image').click();
    assert.equal(menus().length, 3);
    closeMenu(); closeMenu();
    assert.deepEqual([menus().length, closed, menuOpen()], [0, 1, null]);
    showMenu(anchor(), tree(), { onClose: () => closed++ });
    showMenu(anchor(), [{ label: 'Other' }]);
    assert.equal(closed, 2);
    assert.deepEqual(menus().map(labelsOf), [['Other']]);
  });

  test('a press outside every level closes the menu; a press in a submenu does not', async () => {
    const a = anchor();
    const m = showMenu(a, tree());
    item(m, 'Export').click();
    await sleep(5);   // the outside listener starts after the click that opened the menu
    const down = (target) => docListeners.filter((l) => l.type === 'pointerdown').forEach((l) => l.fn({ target }));
    down(item(menus()[1], 'Image'));
    assert.equal(menus().length, 2);
    down(body);
    assert.equal(menus().length, 0);
    assert.equal(docListeners.filter((l) => l.type === 'pointerdown').length, 0, 'the listener is gone with the menu');
    // a second click on the button that opened the menu closes it and does not open it again
    showMenu(a, tree());
    await sleep(5);
    down(a);
    assert.equal(menus().length, 0);
    assert.equal(showMenu(a, tree()), null);
    assert.notEqual(showMenu(a, tree()), null, 'the click after that opens it');
  });

  test('returnFocus says where the keyboard goes once an item has run; Esc still gives it back to the anchor', () => {
    const a = anchor(), field = new FakeElement('input');
    body.append(field);
    let m = showMenu(a, tree(), { returnFocus: () => field });
    item(m, 'Open…').click();
    assert.equal(document.activeElement, field);
    m = showMenu(a, tree(), { returnFocus: () => field });
    key(m, 'Escape');
    assert.equal(document.activeElement, a);
    // nowhere to go back to: the focus is left alone (not put on the anchor)
    document.activeElement = body;
    m = showMenu(a, tree(), { returnFocus: () => null });
    document.activeElement = body;
    item(m, 'Open…').click();
    assert.equal(document.activeElement, body);
  });

  test('a menu with nothing in it says so', () => {
    const m = showMenu(anchor(), [{ separator: true }, null]);
    assert.deepEqual(labelsOf(m), ['Nothing here yet']);
    assert.equal(itemsOf(m)[0].getAttribute('aria-disabled'), 'true');
  });

  test('below: true keeps the menu under its anchor and lets it scroll', () => {
    const a = anchor();
    a.rect = { left: 300, top: 5, width: 40, height: 28 };
    const m = showMenu(a, tree(), { below: true, gap: 4, className: 'from-bar' });
    assert.deepEqual([m.style.left, m.style.top, m.style.maxHeight], ['300px', '37px', `${800 - 37 - 8}px`]);
    assert.ok(m.classList.contains('from-bar'));
  });
});
