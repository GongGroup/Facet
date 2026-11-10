// Selection actions: card buttons and atom menus (facet/web/js/ui/selectioncard.js, F0-A §5.4, ledger L-F0-50).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import(new URL('../../facet/web/js/ui/selectioncard.js', import.meta.url));
const { registerSelectionAction, selectionActions, actionView, actionRows, actionMenuItems, menuTarget, splitCardActions, CARD_LIMITS } = S;

const app = { structure: { symbols: ['Pt', 'Pt', 'Pt', 'C', 'O'], length: 5 } };
const ids = (list) => list.map((a) => a.id);
const BUILT_IN = ['sel.centre', 'sel.sameElement', 'sel.measure', 'sel.replace', 'sel.delete'];
const quiet = (fn) => { const orig = console.warn, logged = []; console.warn = (...a) => logged.push(a); try { fn(); } finally { console.warn = orig; } return logged; };

test('the five built-in actions keep their places on the card and stay out of the atom menus', () => {
  const card = selectionActions(app, [0], 'card');
  assert.deepEqual(ids(card), ['sel.centre', 'sel.sameElement', 'sel.measure', 'sel.replace', 'sel.delete']);
  assert.deepEqual(card.map((a) => a.order), [10, 20, 30, 40, 50]);
  assert.deepEqual(selectionActions(app, [0], 'menu'), []);
  assert.deepEqual(selectionActions(app, [], 'blank'), []);
  // Measure: 1–4 atoms
  assert.ok(!ids(selectionActions(app, [0, 1, 2, 3, 4], 'card')).includes('sel.measure'));
  assert.ok(ids(selectionActions(app, [0, 1, 2, 3], 'card')).includes('sel.measure'));
  const views = Object.fromEntries(card.map((a) => [a.id, actionView(a, app, [3])]));
  assert.deepEqual([views['sel.centre'].label, views['sel.centre'].icon, views['sel.centre'].tip], ['Centre', 'crosshair', 'Centre the view on this atom']);
  assert.equal(views['sel.sameElement'].short, 'All C');
  assert.equal(views['sel.sameElement'].tip, 'Select every C atom');
  assert.equal(actionView(card[1], app, [0, 3]).short, 'Same element');
  assert.equal(views['sel.measure'].tip, 'Measure from this atom: click 1 more atom');
  assert.equal(actionView(card[2], app, [0, 1, 3]).tip, 'Keep this angle as a measurement in the view');
  assert.deepEqual([views['sel.replace'].label, views['sel.replace'].short], ['Replace…', 'Replace']);
  assert.deepEqual([views['sel.delete'].label, views['sel.delete'].danger, views['sel.delete'].kbd], ['Delete', true, 'Del']);
  assert.equal(actionView(card[4], app, [0, 1]).tip, 'Delete 2 atoms');
});

test('registerSelectionAction checks the action', () => {
  const bad = [
    [null, 'registerSelectionAction: expected an action object'],
    [{ label: 'X', run() {} }, 'registerSelectionAction: missing id'],
    [{ id: 'x', run() {} }, 'registerSelectionAction: “x” needs a label'],
    [{ id: 'x', label: 'X' }, 'registerSelectionAction: “x” needs run(app, sel, ctx) or items(app, sel)'],
    [{ id: 'x', label: 'X', run() {}, when: true }, 'registerSelectionAction: “x”: when must be a function (app, sel)'],
    [{ id: 'x', label: 'X', run() {}, menu: 'atom' }, "registerSelectionAction: “x”: menu must be true, false, 'blank' or 'both'"],
    [{ id: 'x', label: 'X', run() {}, order: '35' }, 'registerSelectionAction: “x”: order must be a number'],
  ];
  for (const [a, message] of bad) assert.throws(() => registerSelectionAction(a), { name: 'TypeError', message });
});

test('order, when, enabled and where decide what shows', () => {
  const offs = [
    registerSelectionAction({ id: 't.fix', label: 'Fix', icon: 'lock', order: 35, run() {}, items: () => [{ id: 'z', label: 'Fix z only' }] }),
    registerSelectionAction({ id: 't.move', label: 'Move…', order: 60, menu: 'both', run() {} }),
    registerSelectionAction({ id: 't.rotate', label: 'Rotate…', order: 60, enabled: () => false, run() {} }),   // same order: registration order
    registerSelectionAction({ id: 't.mark', label: 'Mark as adsorbate', order: 70, menu: 'blank', when: (a, sel) => sel.length > 0, run() {} }),
    registerSelectionAction({ id: 't.origin', label: 'Atom to origin', card: false, run() {} }),
    registerSelectionAction({ id: 't.none', label: 'Hidden', menu: false, when: () => false, run() {} }),
    registerSelectionAction({ id: 't.broken', label: 'Broken', when: () => { throw new Error('x'); }, run() {} }),
  ];
  const logged = [], orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    assert.deepEqual(ids(selectionActions(app, [0], 'card')), [...BUILT_IN.slice(0, 3), 't.fix', ...BUILT_IN.slice(3), 't.move', 't.rotate', 't.mark']);
    assert.deepEqual(ids(selectionActions(app, [0], 'menu')), ['t.fix', 't.move', 't.rotate', 't.origin']);
    assert.deepEqual(ids(selectionActions(app, [0], 'blank')), ['t.move', 't.mark']);
    assert.deepEqual(ids(selectionActions(app, [], 'blank')), ['t.move']);
    assert.equal(actionView(selectionActions(app, [0], 'card').find((a) => a.id === 't.rotate'), app, [0]).enabled, false);
    assert.equal(logged.length, 1, 'a `when` that throws hides its action and is reported once');
  } finally { console.error = orig; offs.forEach((off) => off()); }
  assert.deepEqual(ids(selectionActions(app, [0], 'card')), BUILT_IN);
});

test('an action with the id of another replaces it until it is removed', () => {
  const first = registerSelectionAction({ id: 't.same', label: 'First', run() {} });
  let second;
  const warned = quiet(() => { second = registerSelectionAction({ id: 't.same', label: 'Second', run() {} }); });
  assert.equal(warned.length, 1);
  assert.match(String(warned[0][0]), /“t\.same” already exists and is replaced/);
  assert.equal(quiet(() => registerSelectionAction({ id: 't.same', label: 'Third', run() {} }, { replace: true })()).length, 0);
  const label = () => actionView(selectionActions(app, [0], 'card').find((a) => a.id === 't.same'), app, [0]).label;
  assert.equal(label(), 'Second');
  second();
  assert.equal(label(), 'First');
  first();
  assert.ok(!ids(selectionActions(app, [0], 'card')).includes('t.same'));
});

test('actionView resolves functions and falls back when they throw', () => {
  const logged = [], orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    const a = { id: 't.view', label: (app, sel) => `Fix ${sel.length}`, short: () => 'Fix', icon: () => 'lock', tip: () => { throw new Error('tip'); }, kbd: 'shift+l', items: () => [], run() {} };
    const v = actionView(a, app, [0, 1]);
    assert.deepEqual(v, { id: 't.view', label: 'Fix 2', short: 'Fix', icon: 'lock', tip: null, kbd: 'Shift L', enabled: true, danger: false, items: null });
    const b = { id: 't.bad', label: () => { throw new Error('label'); }, run() {} };
    assert.equal(actionView(b, app, [0]).label, 't.bad');
    assert.equal(actionView(b, app, [0]).short, 't.bad');
    assert.equal(logged.length, 2);
  } finally { console.error = orig; }
});

test('actionRows collects the card lines of the shown actions', () => {
  const list = [
    { id: 'a', rows: (app, sel) => [{ label: 'constraint', value: 'F F T · fixed along c (z)' }, { label: 'n', value: sel.length }] },
    { id: 'b' },
    { id: 'c', rows: () => null },
    { id: 'd', rows: () => [null, { value: 'no label' }, { label: 'mark', value: null }] },
  ];
  assert.deepEqual(actionRows(list, app, [0, 1]), [
    { label: 'constraint', value: 'F F T · fixed along c (z)' }, { label: 'n', value: '2' }, { label: 'mark', value: '' },
  ]);
});

test('menuTarget: the selection when the clicked atom is in a selection of several, else that atom', () => {
  assert.deepEqual(menuTarget([3, 4, 1], 4), [3, 4, 1]);
  assert.deepEqual(menuTarget([3, 4, 1], 2), [2]);
  assert.deepEqual(menuTarget([4], 4), [4]);
  assert.deepEqual(menuTarget([], 0), [0]);
  assert.deepEqual(menuTarget(new Set([1, 2]), 2), [1, 2]);
});

test('card quota: 7 buttons on desktop, 5 on touch or narrow screens, else the last place is More', () => {
  assert.deepEqual(CARD_LIMITS, { desktop: 7, narrow: 5 });
  const list = (n) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }));
  const cut = (n, narrow) => { const r = splitCardActions(list(n), { narrow }); return [r.shown.length, r.more.length]; };
  assert.deepEqual(cut(5, false), [5, 0]);
  assert.deepEqual(cut(7, false), [7, 0]);
  assert.deepEqual(cut(8, false), [6, 2]);
  assert.deepEqual(cut(9, false), [6, 3]);
  assert.deepEqual(cut(5, true), [5, 0]);
  assert.deepEqual(cut(6, true), [4, 2]);
  assert.deepEqual(cut(0, true), [0, 0]);
  const r = splitCardActions(list(8));
  assert.deepEqual([...r.shown, ...r.more].map((a) => a.id), list(8).map((a) => a.id), 'More keeps the order');
});

test('the contract orders put Fix ▾ among the first four buttons and Move…/Rotate… after Delete', () => {
  const offs = [
    registerSelectionAction({ id: 'constraints.fix', label: 'Fix', order: 35, run() {}, items: () => [{ id: 'z', label: 'Fix z only' }] }),
    registerSelectionAction({ id: 'atoms.move', label: 'Move…', order: 60, run() {} }),
    registerSelectionAction({ id: 'atoms.rotate', label: 'Rotate…', order: 61, run() {} }),
    registerSelectionAction({ id: 'sel.markAdsorbate', label: 'Mark as adsorbate', order: 70, run() {} }),
  ];
  try {
    const one = selectionActions(app, [0], 'card');   // 9 actions
    assert.deepEqual(ids(splitCardActions(one, { narrow: true }).shown), ['sel.centre', 'sel.sameElement', 'sel.measure', 'constraints.fix']);
    assert.deepEqual(ids(splitCardActions(one).shown), ['sel.centre', 'sel.sameElement', 'sel.measure', 'constraints.fix', 'sel.replace', 'sel.delete']);
    const many = selectionActions(app, [0, 1, 2, 3, 4], 'card');   // no Measure for 5 atoms
    assert.deepEqual(ids(splitCardActions(many, { narrow: true }).shown), ['sel.centre', 'sel.sameElement', 'constraints.fix', 'sel.replace']);
  } finally { offs.forEach((off) => off()); }
});

test('actionMenuItems: one item, or the action’s items with separators; disabled and locked grey them', () => {
  const calls = [];
  const plain = { id: 'p', label: 'Move…', icon: 'move', kbd: 'g', tip: 'Move the atoms', run: (a, sel, ctx) => calls.push(['p', sel, ctx]) };
  const items = actionMenuItems(plain, app, [1], { source: 'menu', atom: 1, display: 7 });
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0], run: undefined }, { label: 'Move…', icon: 'move', kbd: 'G', tip: 'Move the atoms', disabled: false, run: undefined });
  items[0].run();
  assert.deepEqual(calls.pop(), ['p', [1], { source: 'menu', atom: 1, display: 7 }]);
  assert.equal(actionMenuItems(plain, app, [1], {}, { locked: true })[0].disabled, true);
  assert.equal(actionMenuItems({ ...plain, enabled: () => false }, app, [1], {})[0].disabled, true);

  const split = {
    id: 's', label: 'Fix', run: (a, sel, ctx) => calls.push(['main', ctx.item]),
    items: () => [
      { id: 'all', label: 'Fix all axes', kbd: 'shift+l' },
      { id: 'z', label: 'Fix z only', tip: 'Atoms can still move in the surface plane', enabled: (a, sel) => sel.length > 1 },
      { separator: true },
      { id: 'free', label: 'Free', icon: 'unlock', enabled: false, run: (a, sel, ctx) => calls.push(['free', sel, ctx.source]) },
      null,
    ],
  };
  const m = actionMenuItems(split, app, [2], { source: 'card', atom: -1, display: -1 });
  assert.deepEqual(m.map((x) => (x.separator ? '---' : `${x.label}${x.kbd ? ` [${x.kbd}]` : ''}${x.disabled ? ' (off)' : ''}`)), ['Fix all axes [Shift L]', 'Fix z only (off)', '---', 'Free (off)']);
  m[0].run();
  assert.deepEqual(calls.pop(), ['main', 'all'], 'an item without run calls the action with ctx.item');
  m[3].run();
  assert.deepEqual(calls.pop(), ['free', [2], 'card']);
  assert.equal(actionMenuItems(split, app, [2, 3], {})[1].disabled, false);
  assert.ok(actionMenuItems(split, app, [2, 3], {}, { locked: true }).filter((x) => !x.separator).every((x) => x.disabled));
});
