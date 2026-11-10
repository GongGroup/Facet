// Looking along any direction (F0-A §3.14.1, ledger L-F0-45): viewer.viewAlong's targets, its screen-up rules (a
// surface seen from the side has its top surface up, seen along its normal its first in-plane cell vector runs from
// left to right, otherwise the shortest perpendicular lattice vector is "right"), the direction labels and their
// status line, reduced motion, the temporary orthographic camera; and the public API of F0-A T7b: facet.view /
// viewAlong and the lattice helpers of api/latticeapi.js (facet.lattice.* and analysis.surfaceNormal, M7 N-15).
// The viewer methods run on a Viewer prototype instance holding only what they use (the constructor needs WebGL).
// Run: node --test tests/js/view_along.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../facet/web/vendor/three/three.module.js';
import { Viewer } from '../../facet/web/js/render/viewer.js';
import { Overlays } from '../../facet/web/js/render/overlays.js';
import { makeScene } from '../../facet/web/js/render/settings.js';
import { Structure } from '../../facet/web/js/core/structure.js';
import * as lattice from '../../facet/web/js/core/lattice.js';
import { surfaceNormal } from '../../facet/web/js/core/vacuum.js';
import { LATTICE_API, surfaceNormalOf } from '../../facet/web/js/api/latticeapi.js';
import { createAPI } from '../../facet/web/js/api/public.js';
import { apiMembers } from '../../facet/web/js/api/namespaces.js';
import { fake2d } from './fake2d.mjs';

const MINUS = '−';
const BAR = '̅';
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const comb = (cell, [u, v, w]) => [0, 1, 2].map((x) => u * cell[0][x] + v * cell[1][x] + w * cell[2][x]);
const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const assertNear = (got, want, tol = 1e-9, what = '') => assert.ok(near(Array.from(got), want, tol), `${what} ${JSON.stringify(Array.from(got))} ≠ ${JSON.stringify(want)}`);
/** The screen's "right" for a view along dir with `up`: right × up points to the camera (dir). */
const rightOf = (r) => cross(r.up, r.dir);

// ------------------------------------------------------------------------------------------------ structures
const PT_NN = 2.775;
const PT_D = PT_NN * Math.sqrt(2 / 3);
/**
 * Pt(111) p(n×n) with `layers` layers in ABC stacking (hollows at (2/3, 1/3) and (1/3, 2/3) of the 120° mesh), the
 * bottom layer at z = 0, `vacuum` Å above the top one; c is `cz` along z plus an optional tilt (a relaxed CONTCAR).
 */
function pt111({ n = 3, layers = 4, vacuum = 15, tilt = [0, 0], info = {} } = {}) {
  const a = [n * PT_NN, 0, 0], b = [-n * PT_NN / 2, n * PT_NN * Math.sqrt(3) / 2, 0];
  const c = [tilt[0], tilt[1], (layers - 1) * PT_D + vacuum];
  const shift = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]];
  const positions = [], symbols = [];
  for (let k = 0; k < layers; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const fa = (i + shift[k % 3][0]) / n, fb = (j + shift[k % 3][1]) / n, fc = (k * PT_D) / c[2];
    positions.push(comb([a, b, c], [fa, fb, fc]));
    symbols.push('Pt');
  }
  return new Structure({ symbols, positions, cell: [a, b, c], pbc: [true, true, true], info });
}

/** Conventional fcc Pt (a = 3.92 Å): no vacuum gap. */
const fccBulk = () => new Structure({
  symbols: ['Pt', 'Pt', 'Pt', 'Pt'], positions: [[0, 0, 0], [1.96, 1.96, 0], [1.96, 0, 1.96], [0, 1.96, 1.96]],
  cell: [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 3.92]],
});

/** hcp Ru (a = 2.706, c = 4.282 Å, γ = 120°): no vacuum gap. */
const hcpBulk = () => {
  const a = [2.706, 0, 0], b = [-1.353, 2.706 * Math.sqrt(3) / 2, 0], c = [0, 0, 4.282];
  return new Structure({ symbols: ['Ru', 'Ru'], positions: [comb([a, b, c], [1 / 3, 2 / 3, 0.25]), comb([a, b, c], [2 / 3, 1 / 3, 0.75])], cell: [a, b, c] });
};

const molecule = () => new Structure({ symbols: ['C', 'O'], positions: [[0, 0, 0], [0, 0, 1.13]] });

/**
 * A viewer without a renderer: a perspective camera 30 Å up the z axis, controls with a target, the scene settings
 * (axis views keep the perspective camera unless a test says otherwise), overlays, and `structure`.
 */
function bareViewer(structure = null, { orthoAxisViews = false } = {}) {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();   // Emitter
  const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 1000);
  cam.position.set(0, 0, 30);
  Object.assign(v, {
    structure, model: null, camera: cam, persp: cam, ortho: new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000),
    controls: { target: new THREE.Vector3(), update() {} }, bounds: { center: new THREE.Vector3(1, 2, 3), radius: 6 }, maxRadius: 1,
    width: 400, height: 300, fitMargins: { x: 0, y: 0 }, settings: makeScene(), _tempOrtho: false, _camAnim: null, _dirty: false,
    container: { appendChild() {} }, gizmo: { size: 104 },
  });
  v.settings.display.orthoAxisViews = orthoAxisViews;
  v.overlays = new Overlays(v);
  return v;
}

/** Run fn with the page asking for reduced motion (matchMedia) or not; the global is put back afterwards. */
function withMotion(reduce, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  globalThis.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' && reduce, media: q });
  try { return fn(); } finally { if (had) Object.defineProperty(globalThis, 'matchMedia', had); else delete globalThis.matchMedia; }
}

const SIDE = [[0, 1, 0], [1, 1, 0], [1, 2, 0], [1, 0, 0], [1, -1, 0], [2, 1, 0], [-1, 0, 0]];

// --------------------------------------------------------------------------------------------- the up rules
describe('viewAlong: screen up', () => {
  test('a slab seen from the side has its top surface up, along all seven directions of the v1 report', () => {
    const s = pt111();
    const v = bareViewer(s);
    for (const uvw of SIDE) {
      const r = v.viewAlong({ uvw }, { animate: false });
      assertNear(r.dir, lattice.latticeDirection(s.cell, uvw), 1e-12, `dir of [${uvw}]`);
      assertNear(r.up, [0, 0, 1], 1e-12, `up of [${uvw}]`);
    }
    // the same with a tilted c (a relaxed CONTCAR): the normal is a × b, not c
    const t = pt111({ tilt: [1.5, 0.7] });
    assertNear(surfaceNormal(t).normal, [0, 0, 1], 1e-12);
    const vt = bareViewer(t);
    for (const uvw of SIDE) assertNear(vt.viewAlong({ uvw }, { animate: false }).up, [0, 0, 1], 1e-12, `tilted [${uvw}]`);
  });

  test('seen from the side along a plane normal or a vector: still the top surface up', () => {
    const v = bareViewer(pt111());
    for (const target of [{ hkl: [1, 0, 0] }, { hkil: [1, 1, -2, 0] }, [1, 1, 0], [0.3, -1, 0.4], [0, 1, -2]]) {
      const r = v.viewAlong(target, { animate: false });
      assert.ok(Math.abs(dot(r.up, r.dir)) < 1e-12, 'up ⊥ dir');
      assert.ok(r.up[2] > 0, `top up for ${JSON.stringify(target)}`);
      assertNear(r.up, unit([-r.dir[2] * r.dir[0], -r.dir[2] * r.dir[1], 1 - r.dir[2] ** 2]), 1e-12, 'the normal across dir');
    }
  });

  test('a slab whose vacuum is along a: up is its normal across the view', () => {
    const s = new Structure({ symbols: ['Cu', 'Cu'], positions: [[0, 0, 0], [1.8, 1.8, 1.8]], cell: [[20, 0, 0], [0, 3.6, 0], [0, 0, 3.6]] });
    const sn = surfaceNormal(s);
    assert.equal(sn.axis, 0);
    assert.equal(sn.surface, true);
    const r = bareViewer(s).viewAlong({ uvw: [0, 1, 0] }, { animate: false });
    assertNear(r.up, [1, 0, 0], 1e-12);
  });

  test('N looks down on the top surface with a running from left to right; Shift+N up at the bottom one, a still left to right', () => {
    for (const s of [pt111(), pt111({ tilt: [1.5, 0.7] })]) {
      const v = bareViewer(s);
      const top = v.viewAlong('normal', { animate: false });
      assertNear(top.dir, [0, 0, 1], 1e-12);
      assertNear(top.up, [0, 1, 0], 1e-12, 'camera up +y');
      assertNear(rightOf(top), [1, 0, 0], 1e-12, 'a to the right');
      const below = v.viewAlong('-normal', { animate: false });
      assertNear(below.dir, [0, 0, -1], 1e-12);
      assertNear(below.up, [0, -1, 0], 1e-12);
      assertNear(rightOf(below), [1, 0, 0], 1e-12, 'a to the right from below too');
    }
  });

  test('without a vacuum gap N looks along c* the same way (U1: no slab or bulk difference)', () => {
    for (const s of [fccBulk(), hcpBulk()]) {
      const r = bareViewer(s).viewAlong('normal', { animate: false });
      assertNear(r.dir, [0, 0, 1], 1e-12);
      assertNear(rightOf(r), [1, 0, 0], 1e-12, 'a to the right');
    }
  });

  test('no surface: the shortest lattice vector perpendicular to the view is "right"; of equal ones the largest (u, v, w)', () => {
    const v = bareViewer(fccBulk());
    // along [1 1 0]: c (3.92 Å) beats [1 1̅ 0] (5.54 Å); +c beats −c
    let r = v.viewAlong({ uvw: [1, 1, 0] }, { animate: false });
    assertNear(rightOf(r), [0, 0, 1], 1e-12);
    assertNear(r.up, unit([1, -1, 0]), 1e-12);
    // along [0 1 0]: a and c tie, a has the larger u
    r = v.viewAlong({ uvw: [0, 1, 0] }, { animate: false });
    assertNear(rightOf(r), [1, 0, 0], 1e-12);
    assertNear(r.up, [0, 0, -1], 1e-12);
    // along [1 0 0]: b and c tie, b has the larger v
    r = v.viewAlong({ uvw: [1, 0, 0] }, { animate: false });
    assertNear(rightOf(r), [0, 1, 0], 1e-12);
    assertNear(r.up, [0, 0, 1], 1e-12);
    // along the normal of (1 1 1): the shortest perpendicular vectors are the six ⟨1 1̅ 0⟩, [1 0 1̅] is the largest
    r = v.viewAlong({ hkl: [1, 1, 1] }, { animate: false });
    assertNear(rightOf(r), unit([1, 0, -1]), 1e-12);
  });

  test('no perpendicular lattice vector within ±3: the part of c across the view; without a cell z (y along z)', () => {
    const d = unit([1, 0.31, 0.17]);
    let r = bareViewer(fccBulk()).viewAlong([1, 0.31, 0.17], { animate: false });
    assertNear(r.dir, d, 1e-12);
    assertNear(r.up, unit([-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]]), 1e-12);
    const vm = bareViewer(molecule());
    assertNear(vm.viewAlong([1, 0, 0], { animate: false }).up, [0, 0, 1], 1e-12);
    assertNear(vm.viewAlong([0, 0, -2], { animate: false }).up, [0, 1, 0], 1e-12);
    r = vm.viewAlong([0, 1, 1], { animate: false });
    assertNear(r.up, unit([0, -1, 1]), 1e-12);
  });

  test('up given as a vector is used, made perpendicular to the view', () => {
    const v = bareViewer(pt111());
    const r = v.viewAlong({ hkl: [1, 1, 1] }, { up: [0, 1, 1], animate: false });
    const want = unit(((d, u) => u.map((x, i) => x - dot(u, d) * d[i]))(r.dir, [0, 1, 1]));
    assertNear(r.up, want, 1e-12);
    assertNear(v.camera.up.toArray(), want, 1e-12);
    // an axis name keeps setView's direction and takes the given up
    const a = v.viewAlong('a', { up: [0, 1, 0], animate: false });
    assertNear(a.dir, [1, 0, 0], 1e-12);
    assertNear(a.up, [0, 1, 0], 1e-12);
  });
});

// ---------------------------------------------------------------------------------------- targets and labels
describe('viewAlong: targets and labels', () => {
  test('axis names go to setView: its directions, its up and the label "along a"', () => {
    const s = pt111();
    const v = bareViewer(s);
    const a = v.viewAlong('a', { animate: false });
    assert.deepEqual(a, { dir: [1, 0, 0], up: [0, 0, 1], label: 'along a', note: null });
    const c = v.viewAlong('-c', { animate: false });
    assertNear(c.dir, [0, 0, -1], 1e-12);
    assertNear(c.up, unit(s.cell[1]), 1e-12, "setView's up for c is b");
    assert.equal(c.label, `along ${MINUS}c`);
    assert.equal(v.viewAlong('y', { animate: false }).label, 'along y');
    // setView itself returns the same and shows the same label
    assert.deepEqual(v.setView('b', { animate: false }).label, 'along b');
    assert.equal(v.viewLabel, 'along b');
  });

  test('a Cartesian vector: the label has two decimals (no −0.00)', () => {
    const v = bareViewer(molecule());
    const r = v.viewAlong([1, -0.001, 0.5], { animate: false });
    assert.equal(r.label, 'along [1.00, 0.00, 0.50]');
    assertNear(r.dir, unit([1, -0.001, 0.5]), 1e-12);
    assert.equal(v.viewAlong(Float64Array.from([-2, 0, 0]), { animate: false }).label, 'along [-2.00, 0.00, 0.00]');
  });

  test('lattice directions and plane normals of the current cell, negative indices with an overbar', () => {
    const s = pt111();
    const v = bareViewer(s);
    let r = v.viewAlong({ uvw: [1, -1, 0] }, { animate: false });
    assert.equal(r.label, `along [1 1${BAR} 0] of the current cell`);
    assertNear(r.dir, lattice.latticeDirection(s.cell, [1, -1, 0]), 1e-15);
    r = v.viewAlong({ hkl: [1, 1, -1] }, { animate: false });
    assert.equal(r.label, `along the normal of (1 1 1${BAR}) of the current cell`);
    assertNear(r.dir, lattice.millerNormal(s.cell, [1, 1, -1]), 1e-15);
    // four indices: (h k i l) as given, [U V T W] in the smallest whole numbers
    r = v.viewAlong({ hkil: [1, 0, -1, 0] }, { animate: false });
    assert.equal(r.label, `along the normal of (1 0 1${BAR} 0) of the current cell`);
    assertNear(r.dir, lattice.millerNormal(s.cell, [1, 0, 0]), 1e-15);
    for (const uvtw of [[2, -1, -1, 0], [4, -2, -2, 0], [1, 0, 0, 0]]) {
      r = v.viewAlong({ uvtw }, { animate: false });
      assert.equal(r.label, `along [2 1${BAR} 1${BAR} 0] of the current cell`, `[${uvtw}]`);
      assertNear(r.dir, lattice.latticeDirection(s.cell, [1, 0, 0]), 1e-15);
    }
    r = v.viewAlong({ uvw: Int32Array.from([0, 0, 2]) }, { animate: false });
    assert.equal(r.label, 'along [0 0 2] of the current cell');
  });

  test('the surface normal: the label follows where the normal comes from', () => {
    const slab = pt111();
    assert.equal(surfaceNormal(slab).source, 'vacuum');
    const v = bareViewer(slab);
    assert.deepEqual(v.viewAlong('normal', { animate: false }), { dir: [0, 0, 1], up: [0, 1, 0], label: 'along the surface normal', note: null });
    assert.equal(v.viewAlong('-normal', { animate: false }).label, 'from below the surface');
    // a valid info.surface.axis hint, and a 2D structure whose only non-periodic axis has no 5 Å gap
    const hinted = pt111({ info: { surface: { axis: 2 } } });
    assert.equal(surfaceNormal(hinted).source, 'info');
    assert.equal(bareViewer(hinted).viewAlong('normal', { animate: false }).label, 'along the surface normal');
    const sheet = new Structure({ symbols: ['C', 'C'], positions: [[0, 0, 0], [1.23, 0.71, 0]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 3]], pbc: [true, true, false] });
    assert.equal(surfaceNormal(sheet).source, 'pbc');
    assert.equal(bareViewer(sheet).viewAlong('-normal', { animate: false }).label, 'from below the surface');
  });

  test('no vacuum gap: c*, and a note saying so (U1), from above and from below', () => {
    const v = bareViewer(fccBulk());
    const r = v.viewAlong('normal', { animate: false });
    assert.equal(r.label, 'along c* (normal to a and b)');
    assert.equal(r.note, 'No vacuum gap found: looking along c* (normal to a and b).');
    const below = v.viewAlong('-normal', { animate: false });
    assert.equal(below.label, `along ${MINUS}c* (normal to a and b)`);
    assert.equal(below.note, `No vacuum gap found: looking along ${MINUS}c* (normal to a and b).`);
    assertNear(below.dir, [0, 0, -1], 1e-12);
    for (const words of [r.label, r.note, below.note]) assert.doesNotMatch(words, /slab|bulk/i);
  });

  test('vacuum along two axes: along the widest one, said as such', () => {
    // a chain along a with 20 Å of vacuum along b and 15 Å along c
    const wire = new Structure({ symbols: ['Au', 'Au'], positions: [[0, 0, 0], [1.44, 0, 0]], cell: [[2.88, 0, 0], [0, 20, 0], [0, 0, 15]] });
    const sn = surfaceNormal(wire);
    assert.deepEqual([sn.source, sn.surface, sn.axis], ['vacuum', false, 1]);
    const v = bareViewer(wire);
    const r = v.viewAlong('normal', { animate: false });
    assert.equal(r.label, 'along the widest vacuum (b)');
    assert.equal(r.note, null);
    assertNear(r.dir, [0, 1, 0], 1e-12);
    assert.equal(v.viewAlong('-normal', { animate: false }).label, 'along the widest vacuum (b), from the other side');
  });

  test('the result: unit vectors, perpendicular, no negative zero, and the camera ends there (refit on the model)', () => {
    const v = bareViewer(pt111());
    for (const target of ['normal', '-normal', { uvw: [1, 2, 0] }, { hkl: [1, 1, 1] }, [0, -1, 0], 'c', '-a']) {
      const r = v.viewAlong(target, { animate: false });
      assert.ok(Math.abs(Math.hypot(...r.dir) - 1) < 1e-12 && Math.abs(Math.hypot(...r.up) - 1) < 1e-12);
      assert.ok(Math.abs(dot(r.dir, r.up)) < 1e-12);
      assert.ok([...r.dir, ...r.up].every((x) => !Object.is(x, -0)), JSON.stringify(r));
      const back = v.camera.position.clone().sub(v.controls.target).normalize().toArray();
      assertNear(back, r.dir, 1e-12, 'camera direction');
      assertNear(v.camera.up.toArray(), r.up, 1e-12, 'camera up');
      assertNear(v.controls.target.toArray(), [1, 2, 3], 0, 'the target is the model centre (refit)');
    }
    // refit: false keeps the target and the distance
    v.controls.target.set(0, 0, 0);
    v.camera.position.set(0, 0, 12);
    v.viewAlong({ uvw: [1, 0, 0] }, { animate: false, refit: false });
    assertNear(v.controls.target.toArray(), [0, 0, 0], 0);
    assert.ok(Math.abs(v.camera.position.length() - 12) < 1e-9);
  });
});

// --------------------------------------------------------------------------------------------------- errors
describe('viewAlong: messages', () => {
  const BAD = 'viewAlong: use a direction like [1, 1, 0], {uvw: [1, 1, 0]}, {hkl: [1, 1, 1]} or "normal".';
  test('targets it does not take, and malformed ones', () => {
    const v = bareViewer(pt111());
    for (const t of [undefined, null, 42, 'up', 'A', 'normals', '', {}, [], [1, 0], [1, 0, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], ['1', 0, 0],
      { uvw: [1, 0] }, { uvw: '1 1 0' }, { hkl: [1, 1, 1, 1] }, { hkil: [1, 0, -1] }, { uvw: [1, 0, 0], hkl: [1, 1, 1] }, { normal: true }, { uvw: [1, NaN, 0] }]) {
      assert.throws(() => v.viewAlong(t, { animate: false }), { message: BAD }, JSON.stringify(t) ?? String(t));
    }
  });

  test('whole numbers, a direction that is not zero, a consistent i', () => {
    const v = bareViewer(pt111());
    for (const t of [{ uvw: [0.5, 0, 0] }, { hkl: [1, 1.5, 0] }, { uvtw: [1, 0, -1, 0.5] }, { hkil: [0.5, 0.5, -1, 0] }]) {
      assert.throws(() => v.viewAlong(t), { message: 'Lattice directions and Miller indices must be whole numbers.' }, JSON.stringify(t));
    }
    for (const t of [[0, 0, 0], [-0, 0, 0], { uvw: [0, 0, 0] }, { hkl: [0, 0, 0] }, { uvtw: [1, 1, 1, 0] }, { hkil: [0, 0, 0, 0] }]) {
      assert.throws(() => v.viewAlong(t), { message: 'That direction has zero length.' }, JSON.stringify(t));
    }
    assert.throws(() => v.viewAlong({ hkil: [1, 1, 1, 0] }), { message: `In (h k i l), i must be ${MINUS}(h + k) = -2.` });
  });

  test('what needs a cell, and a structure', () => {
    const vm = bareViewer(molecule());
    assert.throws(() => vm.viewAlong('normal'), { message: 'Looking along the surface normal needs a unit cell.' });
    assert.throws(() => vm.viewAlong('-normal'), { message: 'Looking along the surface normal needs a unit cell.' });
    for (const t of [{ uvw: [1, 0, 0] }, { hkl: [1, 1, 1] }, { uvtw: [2, -1, -1, 0] }, { hkil: [1, 0, -1, 0] }, 'a', '-c']) {
      assert.throws(() => vm.viewAlong(t), { message: 'Looking along a lattice direction needs a unit cell.' }, JSON.stringify(t));
    }
    const empty = bareViewer(null);
    for (const t of ['normal', { uvw: [1, 0, 0] }, 'b']) assert.throws(() => empty.viewAlong(t), { message: 'Load a structure first.' });
    // Cartesian views need nothing
    assert.equal(empty.viewAlong('x', { animate: false }).label, 'along x');
    assert.equal(empty.viewAlong([0, 0, 1], { animate: false }).label, 'along [0.00, 0.00, 1.00]');
  });

  test('options', () => {
    const v = bareViewer(pt111());
    for (const up of ['top', [0, 1], [0, NaN, 1], 5]) {
      assert.throws(() => v.viewAlong('normal', { up }), { name: 'TypeError', message: "viewAlong: up must be 'auto' or a vector [x, y, z]." });
    }
    for (const ortho of ['yes', 1, null]) {
      assert.throws(() => v.viewAlong('normal', { ortho }), { name: 'TypeError', message: "viewAlong: ortho must be 'auto', true or false." });
    }
    assert.doesNotThrow(() => v.viewAlong('normal', { up: null, animate: false }));
  });
});

// --------------------------------------------------------------------------------------- motion and camera
describe('viewAlong: reduced motion and the camera', () => {
  test('the camera turns over 420 ms, unless the user prefers reduced motion: then it jumps', () => {
    withMotion(false, () => {
      const v = bareViewer(pt111());
      assert.equal(v.reducedMotion(), false);
      const r = v.viewAlong('normal');
      assert.ok(v._camAnim, 'animated');
      assert.equal(v._camAnim.dur, 420);
      assertNear(v._camAnim.p1.clone().sub(v._camAnim.c1).normalize().toArray(), r.dir, 1e-12);
      assertNear(v._camAnim.u1.toArray(), r.up, 1e-12);
      assert.equal(v.viewLabel, 'along the surface normal', 'the label belongs to where the camera goes');
    });
    withMotion(true, () => {
      const v = bareViewer(pt111());
      assert.equal(v.reducedMotion(), true);
      const r = v.viewAlong('normal');
      assert.equal(v._camAnim, null, 'no animation');
      assertNear(v.camera.position.clone().sub(v.controls.target).normalize().toArray(), r.dir, 1e-12);
      v.setView('a');
      assert.equal(v._camAnim, null, 'axis views jump too');
      // animate: true asks for the animation all the same
      v.viewAlong({ uvw: [1, 1, 0] }, { animate: true });
      assert.ok(v._camAnim);
    });
  });

  test('reducedMotion is false where matchMedia is missing or fails', () => {
    const v = bareViewer();
    const had = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    try {
      delete globalThis.matchMedia;
      assert.equal(v.reducedMotion(), false);
      globalThis.matchMedia = () => { throw new Error('no media queries'); };
      assert.equal(v.reducedMotion(), false);
    } finally { if (had) Object.defineProperty(globalThis, 'matchMedia', had); else delete globalThis.matchMedia; }
  });

  test("ortho: 'auto' takes the axis views' temporary orthographic camera, false leaves it, true takes it", () => {
    const v = bareViewer(pt111(), { orthoAxisViews: true });
    const calls = [];
    v._useCamera = (ortho) => { calls.push(ortho); };
    v._leaveTempOrtho = function () { calls.push('leave'); this._tempOrtho = false; };
    v.viewAlong('normal', { animate: false });
    assert.deepEqual(calls, [true]);
    assert.equal(v._tempOrtho, true);
    v.viewAlong({ uvw: [1, 0, 0] }, { animate: false, ortho: false });
    assert.deepEqual(calls, [true, 'leave']);
    assert.equal(v._tempOrtho, false);
    v.viewAlong([0, 1, 0], { animate: false, ortho: true });
    assert.deepEqual(calls, [true, 'leave', true]);
    // not in turntable mode or with orthoAxisViews off ('auto'), and never again for a camera that is orthographic
    calls.length = 0;
    v._tempOrtho = false;
    v.settings.display.turntable = true;
    v.viewAlong('normal', { animate: false });
    v.settings.display.turntable = false;
    v.settings.display.orthoAxisViews = false;
    v.viewAlong('-normal', { animate: false });
    v.camera = v.ortho;
    v.viewAlong('normal', { animate: false, ortho: true });
    assert.deepEqual(calls, []);
  });
});

// ------------------------------------------------------------------------------------- the direction label
describe('the direction label', () => {
  /** Draw the canvas overlay layers as drawOverlay does (400 × 300 at `scale`); returns the fake context. */
  function drawLayers(v, { scale = 1, axes = true } = {}) {
    v.settings.display.axes = axes;
    const g = fake2d();
    const text = (t, x, y, size, color = '#14171b', weight = 500) => {
      g.font = `${weight} ${size * scale}px sans-serif`; g.fillStyle = color;
      g.aligned.push([t, g.textAlign, g.textBaseline, color, size]);
      g.fillText(t, x, y);
    };
    g.aligned = [];
    v.overlays.drawCanvas(g, { scale, w: 400 * scale, h: 300 * scale, dark: false, font: 'sans-serif', text, occupancy: null, export: false, markers: false, model: null, project: () => [0, 0, 0] });
    return g;
  }

  test('a canvas layer (tier C) draws it just above the axis gizmo, left-aligned; never in exports', () => {
    const v = bareViewer(pt111());
    v.viewAlong('normal', { animate: false });
    const layer = v.overlays.list().find((l) => l.id === 'view-direction');
    assert.deepEqual([layer.tier, layer.export, layer.owner], ['canvas', 'never', 'viewer']);
    let g = drawLayers(v);
    const call = g.calls.find((c) => c[0] === 'fillText');
    assert.deepEqual(call.slice(1, 4), ['along the surface normal', 12, 300 - 8 - 104 - 2]);
    assert.deepEqual(g.aligned, [['along the surface normal', 'left', 'bottom', '#14171b', 12]], 'left-aligned, in the overlay text colour, 12 px');
    assert.equal(g.depth, 0, 'the layer drew between save and restore');
    // twice the pixels: the same place, scaled
    g = drawLayers(v, { scale: 2 });
    assert.deepEqual(g.calls.find((c) => c[0] === 'fillText').slice(2, 4), [24, 600 - 2 * (8 + 104 + 2)]);
    // without the gizmo, in its corner
    g = drawLayers(v, { axes: false });
    assert.deepEqual(g.calls.find((c) => c[0] === 'fillText').slice(2, 4), [12, 300 - 8 - 2]);
  });

  test('it lasts until the camera turns: orbiting, turning about a screen axis or another view end it; zoom, pan and fit keep it', () => {
    const v = bareViewer(pt111());
    v.viewAlong({ hkl: [1, 1, 1] }, { animate: false });
    const label = 'along the normal of (1 1 1) of the current cell';
    assert.equal(v.viewLabel, label);
    v.zoomBy(1.5);
    v.panBy(20, -10);
    v.fitView(false);
    assert.equal(v.viewLabel, label);
    v.orbitBy(15, 0, { animate: false });
    assert.equal(v.viewLabel, null);
    assert.equal(drawLayers(v).texts().length, 0, 'not drawn');
    // turning about the line of sight changes only up: that ends it too
    v.viewAlong('normal', { animate: false });
    v.rotateScreen('z', 30, { animate: false });
    assert.equal(v.viewLabel, null);
    // a gizmo click (setViewDirection) to another direction; the same direction keeps it
    v.viewAlong('normal', { animate: false });
    v.setViewDirection([0, 0, 1], [0, 1, 0], false, true);
    assert.equal(v.viewLabel, 'along the surface normal');
    v.setViewDirection([1, 0, 0], null, false, true);
    assert.equal(v.viewLabel, null);
    // an animated orbit ends it at once (it compares with where the camera goes)
    v.viewAlong('normal', { animate: false });
    v.orbitBy(0, 10);
    assert.equal(v.viewLabel, null);
    // a damped controls update of a few hundredths of a degree does not
    v.viewAlong('normal', { animate: false });
    v.camera.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.0005);
    assert.equal(v.viewLabel, 'along the surface normal');
  });

  test('another structure entry takes the label away with its layer', () => {
    const v = bareViewer(pt111());
    v.viewAlong('normal', { animate: false });
    v.overlays.switched();
    assert.equal(v.viewLabel, null);
    assert.equal(v.overlays.get('view-direction'), null);
    v.viewAlong('-normal', { animate: false });
    assert.equal(v.viewLabel, 'from below the surface', 'the layer comes back with the next view');
    assert.ok(v.overlays.get('view-direction'));
  });

  test('a visually hidden role=status line says it for screen readers', (t) => {
    const made = [];
    const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = {
      createElement: (tag) => {
        const el = { tag, attrs: {}, className: '', textContent: '', setAttribute(k, val) { this.attrs[k] = val; } };
        made.push(el);
        return el;
      },
    };
    t.after(() => { if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document; });
    const v = bareViewer(pt111());
    const appended = [];
    v.container = { appendChild: (el) => appended.push(el) };
    v.viewAlong('normal', { animate: false });
    assert.equal(made.length, 1);
    const el = made[0];
    assert.deepEqual(appended, [el]);
    assert.deepEqual([el.tag, el.className, el.attrs.role, el.attrs['aria-live']], ['div', 'sr-only', 'status', 'polite']);
    assert.equal(el.textContent, 'Looking along the surface normal');
    // the same words again are announced again (they differ by a trailing no-break space)
    v.viewAlong('normal', { animate: false });
    assert.equal(el.textContent, 'Looking along the surface normal\u00a0');
    v.viewAlong('normal', { animate: false });
    assert.equal(el.textContent, 'Looking along the surface normal');
    // indices read as words, c* as "c star"
    v.viewAlong({ uvw: [1, -1, 0] }, { animate: false });
    assert.equal(el.textContent, 'Looking along the direction 1 minus 1 0 of the current cell');
    v.viewAlong({ hkil: [1, 0, -1, 0] }, { animate: false });
    assert.equal(el.textContent, 'Looking along the normal of the plane 1 0 minus 1 0 of the current cell');
    v.viewAlong('-c', { animate: false });
    assert.equal(el.textContent, 'Looking along minus c');
    v.structure = fccBulk();
    v.viewAlong('normal', { animate: false });
    assert.equal(el.textContent, 'Looking along c star, normal to a and b');
    // the camera turned: the line is emptied, no new element
    v.orbitBy(20, 0, { animate: false });
    assert.equal(v.viewLabel, null);
    assert.equal(el.textContent, '');
    assert.equal(made.length, 1);
  });
});

// ------------------------------------------------------------------------------------------------ public API
describe('public API: facet.view, viewAlong, lattice.* and analysis.surfaceNormal', () => {
  /** What createAPI and reference() read of the app; viewer.viewAlong records its calls. */
  function fakeApp(structure = null) {
    const calls = [];
    return {
      calls, structure, storage: { list: () => [] }, on: () => () => {}, get: () => undefined,
      viewer: { viewAlong: (target, opts) => { calls.push([target, opts]); return { dir: [0, 0, 1], up: [0, 1, 0], label: 'along the surface normal', note: null }; } },
    };
  }

  test('view(target, opts) and viewAlong(target, opts) hand everything to viewer.viewAlong and return its result', () => {
    const app = fakeApp();
    const api = createAPI(app, null);
    assert.equal(api.view('a').label, 'along the surface normal');
    assert.deepEqual(api.viewAlong({ hkl: [1, 1, 1] }, { animate: false }), { dir: [0, 0, 1], up: [0, 1, 0], label: 'along the surface normal', note: null });
    api.view('normal', { up: [0, 1, 0] });
    assert.deepEqual(app.calls, [['a', undefined], [{ hkl: [1, 1, 1] }, { animate: false }], ['normal', { up: [0, 1, 0] }]]);
  });

  test('facet.lattice has the eight helpers of core/lattice.js, and no surfaceNormal (N-15)', () => {
    const api = createAPI(fakeApp(), null);
    const names = ['millerNormal', 'latticeDirection', 'isHexagonalCell', 'hklToHkil', 'hkilToHkl', 'uvwToUvtw', 'uvtwToUvw', 'centeredCellHint'];
    assert.deepEqual(Object.keys(LATTICE_API), names);
    for (const name of names) assert.equal(api.lattice[name], lattice[name], `lattice.${name}`);
    assert.equal('surfaceNormal' in api.lattice, false);
    assert.equal(api.lattice.surfaceNormal, undefined);
    assert.deepEqual(api.lattice.hkilToHkl([1, 0, -1, 0]), [1, 0, 0]);
    assert.deepEqual(api.lattice.uvwToUvtw([1, 0, 0], { integer: true }), [2, -1, -1, 0]);
  });

  test('facet.analysis.surfaceNormal(s?, opts): the vacuum module, the active structure by default', (t) => {
    const slab = pt111();
    const app = fakeApp(slab);
    const api = createAPI(app, null);
    assert.equal(api.analysis.surfaceNormal, surfaceNormalOf);
    const had = Object.getOwnPropertyDescriptor(globalThis, 'facet');
    t.after(() => { if (had) Object.defineProperty(globalThis, 'facet', had); else delete globalThis.facet; });
    globalThis.facet = api;
    assert.deepEqual(api.analysis.surfaceNormal(), surfaceNormal(slab));
    assert.equal(api.analysis.surfaceNormal().source, 'vacuum');
    assert.deepEqual(api.analysis.surfaceNormal(fccBulk()).normal, [0, 0, 1]);
    assert.equal(api.analysis.surfaceNormal(fccBulk(), { requireGap: true }), null);
    assert.equal(api.analysis.surfaceNormal(molecule()), null);
    app.structure = null;
    assert.throws(() => api.analysis.surfaceNormal(), { message: 'Load a structure first.' });
  });

  test('reference() lists them with their owner and signatures', () => {
    const api = createAPI(fakeApp(), null);
    const listed = new Map(api.reference().api.map((m) => [m.path, m]));
    for (const path of [...Object.keys(LATTICE_API).map((n) => `lattice.${n}`), 'analysis.surfaceNormal']) {
      const m = listed.get(path);
      assert.ok(m, path);
      assert.equal(m.owner, 'F0-A');
      assert.ok(m.sig && !/[\r\n]/.test(m.sig), `${path} has a one-line signature`);
    }
    assert.equal(listed.has('lattice.surfaceNormal'), false);
    assert.ok(apiMembers().some((m) => m.path === 'analysis.surfaceNormal' && m.owner === 'F0-A'));
  });
});
