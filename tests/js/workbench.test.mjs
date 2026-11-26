// The workbench laid out as Materials Studio is (facet/web/js/ui/workbench.js, ui/mscommands.js, ui/properties.js):
// what kind of document a structure is (its icon in the Project explorer and on its window), the toolbars of
// View › Toolbars, and Modify › Lattice Parameters…, which keeps the cell's orientation and the atoms' fractional
// positions. The windows and explorers themselves need a browser.
// Run: node --test tests/js/workbench.test.mjs (or through pytest: tests/test_js_unit.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { docKind, KIND_ICON, TOOLBARS } = await import(web('ui/workbench.js'));
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
