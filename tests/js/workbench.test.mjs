// The workbench laid out as Materials Studio is (facet/web/js/ui/workbench.js, ui/mscommands.js, ui/properties.js):
// what kind of document a structure is (its icon in the Project explorer and on its window), the toolbars of
// View › Toolbars and where they are moved to, where tool windows open, and Modify › Lattice Parameters…, which keeps
// the cell's orientation and the atoms' fractional positions. The windows and explorers themselves need a browser.
// Run: node --test tests/js/workbench.test.mjs (or through pytest: tests/test_js_unit.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { docKind, KIND_ICON, TOOLBARS, normalizeToolbarLayout, moveToolbar, cascadeSpot, TAB_TITLES } = await import(web('ui/workbench.js'));
const { setLatticeParameters } = await import(web('ui/mscommands.js'));
const { CATEGORIES } = await import(web('ui/properties.js'));
const { Structure } = await import(web('core/structure.js'));
const { cellParams } = await import(web('core/util.js'));

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const rot = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const turn = (cell, R) => cell.map((v) => [0, 1, 2].map((j) => v[0] * R[j][0] + v[1] * R[j][1] + v[2] * R[j][2]));
/** An app with just what setLatticeParameters uses: the structure, and editActive running fn on it. */
const appOf = (s) => ({ structure: s, editActive(label, fn) { this.label = label; fn(s); s.touch?.(); return { label }; } });

test('docKind: crystals, surface slabs, molecules and trajectories each have an icon', () => {
  const cell = [[4, 0, 0], [0, 4, 0], [0, 0, 4]];
  assert.equal(docKind(new Structure({ symbols: ['Cu'], positions: [[0, 0, 0]], cell })), 'crystal');
  assert.equal(docKind(new Structure({ symbols: ['Cu'], positions: [[0, 0, 0]], cell, info: { surface: { hkl: [1, 1, 1] } } })), 'surface');
  assert.equal(docKind(new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0.74, 0, 0]] })), 'molecule');
  assert.equal(docKind(new Structure({ symbols: ['H'], positions: [[0, 0, 0]], frames: [{ positions: [[0.1, 0, 0]] }] })), 'trajectory');
  assert.equal(docKind(null), 'molecule');
  for (const k of ['crystal', 'surface', 'molecule', 'trajectory']) assert.ok(KIND_ICON[k], k);
});

test('View › Toolbars lists the toolbars in the order of the strip', () => {
  assert.deepEqual(TOOLBARS.map(([id]) => id), ['standard', 'view', 'display', 'build', 'modify', 'measure', 'animation', 'image']);
  assert.ok(TOOLBARS.every(([, label]) => typeof label === 'string' && label));
});

test('toolbar layout: every toolbar once, docked in a row or floating; new ones end the last row', () => {
  const ids = TOOLBARS.map(([id]) => id);
  assert.deepEqual(normalizeToolbarLayout(undefined), { rows: [ids], float: {} }, 'at first: one row in the order of View › Toolbars');
  const L = normalizeToolbarLayout({ rows: [['view', 'standard', 'view', 'nope'], [], ['display']], float: { image: { x: 10.4, y: 20 }, bad: { x: 1, y: 1 }, build: { x: 'a' } } });
  assert.deepEqual(L.rows[0], ['view', 'standard'], 'repeats and unknown ids go');
  assert.deepEqual(L.rows[1], ['display', 'build', 'modify', 'measure', 'animation'], 'what no row places ends the last one (a bad float too)');
  assert.deepEqual(L.float, { image: { x: 10, y: 20 } });
  const all = [...L.rows.flat(), ...Object.keys(L.float)].sort();
  assert.deepEqual(all, [...ids].sort());
});

test('moving a toolbar: along a row, into another row, as a new row, floating and back', () => {
  const L0 = normalizeToolbarLayout(undefined);
  // before another toolbar of the same row
  assert.deepEqual(moveToolbar(L0, 'image', { row: 0, before: 'standard' }).rows[0].slice(0, 2), ['image', 'standard']);
  // as a row of its own below, then into that row from the first
  const L1 = moveToolbar(L0, 'modify', { row: 1, newRow: true });
  assert.deepEqual(L1.rows.map((r) => r.includes('modify')), [false, true]);
  assert.deepEqual(L1.rows[1], ['modify']);
  const L2 = moveToolbar(L1, 'build', { row: 1, before: null });
  assert.deepEqual(L2.rows[1], ['modify', 'build']);
  // the last toolbar of a row leaves: the row goes, and indices are those before the move
  const L3 = moveToolbar(moveToolbar(L2, 'modify', { row: 0, before: 'view' }), 'build', { row: 0, before: null });
  assert.equal(L3.rows.length, 1);
  assert.deepEqual(L3.rows[0].slice(0, 2), ['standard', 'modify']);
  assert.equal(L3.rows[0].at(-1), 'build');
  // a new row above the first
  assert.deepEqual(moveToolbar(L0, 'view', { row: 0, newRow: true }).rows[0], ['view']);
  // floating remembers where it stood, to dock back there
  const F = moveToolbar(L0, 'display', { float: true, x: 400.6, y: 300 });
  assert.equal(F.rows[0].includes('display'), false);
  assert.deepEqual(F.float.display, { x: 401, y: 300, from: { row: 0, before: 'build' } });
  const G = moveToolbar(F, 'display', { float: true, x: 50, y: 60 });
  assert.deepEqual(G.float.display.from, { row: 0, before: 'build' }, 'moved while floating: still from there');
  const D = moveToolbar(G, 'display', { row: 0, before: 'build' });
  assert.deepEqual(D, L0, 'docked back where it was');
  // a move to where it is changes nothing; an unknown toolbar neither
  assert.deepEqual(moveToolbar(L0, 'standard', { row: 0, before: 'view' }), L0);
  assert.deepEqual(moveToolbar(L0, 'nope', { row: 0, newRow: true }), L0);
});

test('tool windows: opened one after another, they cascade instead of covering each other', () => {
  const base = { x: 900, y: 100 };
  assert.deepEqual(cascadeSpot(base, []), base);
  assert.deepEqual(cascadeSpot(base, [{ x: 500, y: 100 }]), base, 'a window elsewhere does not move it');
  assert.deepEqual(cascadeSpot(base, [{ x: 905, y: 98 }], { x: -26, y: 26 }), { x: 874, y: 126 });
  assert.deepEqual(cascadeSpot(base, [{ x: 900, y: 100 }, { x: 874, y: 126 }], { x: -26, y: 26 }), { x: 848, y: 152 });
  assert.equal(TAB_TITLES.style, 'Display Style');
  assert.equal(TAB_TITLES.scene, 'Display Options', 'the Scene tab is the Display Options window, as in Materials Studio');
});

test('the Properties filter has the categories of Materials Studio, then Display and Project', () => {
  assert.deepEqual(CATEGORIES.slice(0, 5), ['Atom', 'Lattice 3D', 'Physical System', 'Reciprocal Lattice 3D', 'Symmetry System']);
  assert.ok(CATEGORIES.includes('Display') && CATEGORIES.includes('Project'));
});

test('Lattice Parameters: the atoms keep their fractional positions and the cell its orientation', () => {
  const cell0 = turn([[4, 0, 0], [0, 5, 0], [0, 0, 6]], rot(30));   // a cell turned 30° about z
  const s = new Structure({ name: 'orth', symbols: ['O', 'Ti'], positions: [[0, 0, 0], [0, 0, 0]], cell: cell0 });
  const frac = [[0.25, 0.5, 0.75], [0.1, 0.2, 0.3]];
  s.setPositions(frac.map((f) => [0, 1, 2].map((j) => f[0] * cell0[0][j] + f[1] * cell0[1][j] + f[2] * cell0[2][j])));
  const app = appOf(s);
  setLatticeParameters(app, { a: 4.4, gamma: 100 }, { label: 'Set a and γ' });
  assert.equal(app.label, 'Set a and γ');
  const cp = cellParams(s.cell);
  assert.ok(close(cp.a, 4.4) && close(cp.b, 5) && close(cp.c, 6), JSON.stringify(cp));
  assert.ok(close(cp.alpha, 90, 1e-7) && close(cp.beta, 90, 1e-7) && close(cp.gamma, 100, 1e-7), JSON.stringify(cp));
  // orientation: a still points where it pointed (30° from x), c still along z
  const a = s.cell[0];
  assert.ok(close(Math.atan2(a[1], a[0]) * 180 / Math.PI, 30, 1e-7));
  assert.ok(close(s.cell[2][0], 0) && close(s.cell[2][1], 0));
  // fractional positions unchanged
  const fr = s.fracPositions();
  frac.forEach((f, i) => f.forEach((v, k) => assert.ok(close(fr[3 * i + k], v, 1e-9), `atom ${i} axis ${k}: ${fr[3 * i + k]}`)));
});

test('Lattice Parameters: impossible values and structures without a cell are refused', () => {
  const s = new Structure({ symbols: ['Cu'], positions: [[0, 0, 0]], cell: [[3.6, 0, 0], [0, 3.6, 0], [0, 0, 3.6]] });
  assert.throws(() => setLatticeParameters(appOf(s), { a: -1 }), /greater than 0/);
  assert.throws(() => setLatticeParameters(appOf(s), { alpha: 180 }), /between 0° and 180°/);
  assert.throws(() => setLatticeParameters(appOf(s), { alpha: 150, beta: 150, gamma: 150 }), /do not make a cell/);
  assert.throws(() => setLatticeParameters(appOf(new Structure({ symbols: ['H'], positions: [[0, 0, 0]] })), { a: 2 }), /no unit cell/);
  const traj = new Structure({ symbols: ['Cu'], positions: [[0, 0, 0]], cell: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], frames: [{ positions: [[0.1, 0, 0]] }] });
  assert.throws(() => setLatticeParameters(appOf(traj), { a: 4 }), /trajectory/);
});
