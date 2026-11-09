// Interaction math of the Move tool (render/tools/movemath.js), M4 §7.2 items 1 and 2: axis, plane, centre and direct
// drags, the height of an atom dragged along the surface (D9), the edge-on fallbacks, ring angles and their
// accumulation past ±180°, fine and snapped increments with contravariant components in a hexagonal Lattice frame
// (D19), snap targets, and the screen-space hit test of the handles with its priority and hidden handles.
// The viewer's geometry (L-F0-40) comes from a synthetic camera with the formulas of render/viewer.js.
// Run: node --test tests/js/movemath.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_DEFAULTS } from '../../crystallume/web/js/core/defaults.js';
import * as MM from '../../crystallume/web/js/render/tools/movemath.js';
import {
  DRAG_KINDS, FRAMES, FRAME_LABELS, HANDLE_PRIORITY, HANDLE_SETS, MOVE_TOOL, PLANE_AXES,
  accumulateAngle, angleAbout, axisParam, beginDrag, directDragPlane, dragTo, frameAxes, frameComponents,
  handleVisibility, hitHandle, latticeSnapSteps, pressTarget, snapToStep, snapToTarget,
} from '../../crystallume/web/js/render/tools/movemath.js';

const DEG = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / norm(a));
/** a + Σ s_k·e_k */
const comb = (a, ...terms) => terms.reduce((p, [s, e]) => add(p, scale(e, s)), a);

function near(actual, expected, tol = 1e-9, msg = '') {
  const ok = Array.isArray(expected)
    ? actual.length === expected.length && expected.every((v, i) => Math.abs(actual[i] - v) <= tol)
    : Math.abs(actual - expected) <= tol;
  assert.ok(ok, `${msg}${msg ? ': ' : ''}expected ${JSON.stringify(expected)} ± ${tol}, got ${JSON.stringify(actual)}`);
}

/**
 * A synthetic camera with the viewer's ray geometry (L-F0-40, the formulas of render/viewer.js): the pick ray through
 * a pixel, the projection (pixels right and down from the top-left corner), pointOnPlane (null when |n·d| < 1e-6 or
 * behind the camera), pointOnLine ({point, s}, null when parallel) and worldPerPixel. It is the drag view as well.
 */
function camera({ eye, target = [0, 0, 0], up = [0, 0, 1], fov = 30, ortho = false, halfHeight = 6, width = 800, height = 600 }) {
  const f = unit(sub(target, eye));
  let r = cross(f, up);
  if (norm(r) < 1e-9) r = cross(f, [0, 1, 0]);
  r = unit(r);
  const u = cross(r, f);
  const aspect = width / height, tan = Math.tan((fov * DEG) / 2);
  const cam = {
    viewDir: f,
    up: u,
    right: r,
    ray(x, y) {
      const nx = (2 * x) / width - 1, ny = 1 - (2 * y) / height;
      if (ortho) return { origin: comb(eye, [nx * halfHeight * aspect, r], [ny * halfHeight, u]), direction: f };
      return { origin: eye.slice(), direction: unit(comb(f, [nx * tan * aspect, r], [ny * tan, u])) };
    },
    project(x, y, z) {
      const d = sub([x, y, z], eye), depth = dot(d, f);
      const sx = ortho ? halfHeight * aspect : depth * tan * aspect, sy = ortho ? halfHeight : depth * tan;
      return [((dot(d, r) / sx + 1) / 2) * width, ((1 - dot(d, u) / sy) / 2) * height, depth];
    },
    worldPerPixel(p) { return ortho ? (2 * halfHeight) / height : (2 * dot(sub(p, eye), f) * tan) / height; },
    pointOnPlane(x, y, point, normal) {
      const { origin, direction } = cam.ray(x, y);
      const n = unit(normal), den = dot(n, direction);
      if (Math.abs(den) < 1e-6) return null;
      const t = dot(sub(point, origin), n) / den;
      return t >= 0 ? add(origin, scale(direction, t)) : null;
    },
    pointOnLine(x, y, origin, dir) {
      const { origin: o, direction: d } = cam.ray(x, y);
      const a = dot(dir, dir), b = dot(dir, d), c = dot(d, d), den = a * c - b * b;
      if (!(den > 1e-12 * a * c)) return null;
      const w0 = sub(origin, o);
      const s = (b * dot(d, w0) - c * dot(dir, w0)) / den;
      return { point: add(origin, scale(dir, s)), s };
    },
  };
  return cam;
}

/** Screen position of a point. */
const scr = (cam, p) => cam.project(p[0], p[1], p[2]).slice(0, 2);
/** An orthographic camera 30 Å away looking down −z (screen x = world x, screen up = world y), 0.02 Å per px. */
const topView = (target = [0, 0, 0]) => camera({ eye: add(target, [0, 0, 30]), target, up: [0, 1, 0], ortho: true });
/** An orthographic camera whose line of sight makes `theta` degrees with +z's opposite, tilted towards +y; 0.02 Å per px. */
function tiltedView(theta, target = [0, 0, 0]) {
  const f = [0, Math.sin(theta * DEG), -Math.cos(theta * DEG)];
  return camera({ eye: sub(target, scale(f, 30)), target, up: [0, 0, 1], ortho: true });
}
/** A view whose camera can be swapped mid-drag. */
function swappable(cam) {
  return {
    cam,
    get viewDir() { return this.cam.viewDir; },
    pointOnPlane(...a) { return this.cam.pointOnPlane(...a); },
    pointOnLine(...a) { return this.cam.pointOnLine(...a); },
    project(...a) { return this.cam.project(...a); },
    worldPerPixel(p) { return this.cam.worldPerPixel(p); },
  };
}

const CART = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const Z = [0, 0, 1];
const SURFACE = Object.freeze({ surface: true, normal: Z, axis: 2, source: 'vacuum' });
const d111 = 3.92 / Math.SQRT2;
/** Pt(111) 1×1 surface cell (hexagonal, γ = 120°), 20 Å along c. */
const HEX = [[d111, 0, 0], [-d111 / 2, (d111 * Math.sqrt(3)) / 2, 0], [0, 0, 20]];
const HEX_AXES = frameAxes('lattice', { cell: HEX }).axes;

describe('module', () => {
  test('exports', () => {
    assert.deepEqual(Object.keys(MM).sort(), [
      'DRAG_KINDS', 'FRAMES', 'FRAME_LABELS', 'HANDLE_PRIORITY', 'HANDLE_SETS', 'MOVE_TOOL', 'PLANE_AXES', 'accumulateAngle',
      'angleAbout', 'axisParam', 'beginDrag', 'directDragPlane', 'dragTo', 'frameAxes', 'frameComponents', 'handleVisibility',
      'hitHandle', 'latticeSnapSteps', 'pressTarget', 'snapToStep', 'snapToTarget',
    ]);
  });

  test('MOVE_TOOL holds the handle sizes and tolerances of M4 §3.11.1, deeply frozen', () => {
    assert.deepEqual(MOVE_TOOL.arrow, { from: 14, shaftTo: 72, to: 88, shaftRadius: 1.5, coneRadius: 5, pick: 8, pickTouch: 16 });
    assert.deepEqual(MOVE_TOOL.square, { size: 14, offset: 24, pick: 3, pickTouch: 8 });
    assert.deepEqual(MOVE_TOOL.ring, { radius: 60, tube: 1.5, segments: 64, pick: 7, pickTouch: 14 });
    assert.deepEqual(MOVE_TOOL.center, { radius: 8, pick: 10, pickTouch: 18 });
    assert.equal(MOVE_TOOL.labelGap, 6);
    assert.equal(MOVE_TOOL.hoverScale, 1.6);
    assert.equal(MOVE_TOOL.hideArrowCos, 0.990);
    near(MOVE_TOOL.hideSquareCos, Math.cos(82 * DEG), 1e-15);
    assert.equal(MOVE_TOOL.axisParallelCos, 0.996);
    assert.equal(MOVE_TOOL.edgeOnCos, 0.2);
    assert.equal(MOVE_TOOL.snapRadius, 12);
    for (const o of [MOVE_TOOL, MOVE_TOOL.arrow, MOVE_TOOL.square, MOVE_TOOL.ring, MOVE_TOOL.center]) assert.ok(Object.isFrozen(o));
    assert.throws(() => { MOVE_TOOL.arrow.pick = 20; }, TypeError);
    // pixel constants are web-only: none of them is in SURFACE_DEFAULTS (M4 §3.1)
    for (const k of ['snapRadius', 'hideArrowCos', 'edgeOnCos']) assert.ok(!(k in SURFACE_DEFAULTS));
  });

  test('frames, labels, plane axes, priorities and drag kinds', () => {
    assert.deepEqual(FRAMES, ['auto', 'surface', 'cartesian', 'lattice']);
    assert.deepEqual(FRAME_LABELS, { surface: ['u', 'v', 'n'], cartesian: ['x', 'y', 'z'], lattice: ['a', 'b', 'c'] });
    assert.deepEqual(PLANE_AXES, [[1, 2], [0, 2], [0, 1]]);
    assert.deepEqual(HANDLE_PRIORITY, ['center', 'plane', 'axis', 'ring', 'atom']);
    assert.deepEqual(HANDLE_SETS, ['both', 'move', 'rotate']);
    assert.deepEqual(DRAG_KINDS, ['axis', 'plane', 'center', 'direct', 'ring']);
    for (const o of [FRAMES, FRAME_LABELS, FRAME_LABELS.surface, PLANE_AXES, PLANE_AXES[2], HANDLE_PRIORITY, DRAG_KINDS]) assert.ok(Object.isFrozen(o));
  });
});

describe('frames (M4 §3.3)', () => {
  test('auto is Surface with a surface (U1), else Cartesian; the result names the frame used', () => {
    const s = frameAxes('auto', { cell: HEX, surface: SURFACE });
    assert.equal(s.frame, 'surface');
    assert.deepEqual(s.labels, ['u', 'v', 'n']);
    near(s.axes.flat(), CART.flat(), 1e-15, 'standard slab: u = a, v = n × u, n = z');
    for (const surface of [null, { ...SURFACE, surface: false, source: 'ab-plane' }]) {
      const c = frameAxes('auto', { cell: HEX, surface });
      assert.equal(c.frame, 'cartesian');
      assert.deepEqual(c.axes, CART);
      assert.deepEqual(c.labels, ['x', 'y', 'z']);
    }
    assert.equal(frameAxes().frame, 'cartesian');
  });

  test('Surface frame on a tilted-c cell and with the vacuum along a', () => {
    // a CONTCAR-like cell with c tilted: the normal is along a × b, u along a (M4 §3.3), whatever c does
    const tilted = [[d111, 0, 0], [d111 / 2, (d111 * Math.sqrt(3)) / 2, 0], [1.2, 0.7, 20]];
    near(frameAxes('surface', { cell: tilted, surface: SURFACE }).axes.flat(), CART.flat(), 1e-15);
    // vacuum along a: n ∥ a, so u comes from b (the first other cell vector), v = n × u
    const alongA = { surface: true, normal: [1, 0, 0], axis: 0 };
    const f = frameAxes('surface', { cell: [[20, 0, 0], [0, 3, 0], [0, 0, 4]], surface: alongA });
    near(f.axes.flat(), [[0, 1, 0], [0, 0, 1], [1, 0, 0]].flat(), 1e-15);
    // axis unknown and a ∥ n: b, as M4 §3.3 says
    const g = frameAxes('surface', { cell: [[20, 0, 0], [0, 3, 0], [0, 0, 4]], surface: { surface: true, normal: [2, 0, 0] } });
    near(g.axes.flat(), [[0, 1, 0], [0, 0, 1], [1, 0, 0]].flat(), 1e-15, 'and the normal is made unit');
    // a tilted surface: u is a projected on the plane, the frame is right-handed and orthonormal
    const n = unit([0, 0.5, 1]);
    const h = frameAxes('surface', { cell: HEX, surface: { surface: true, normal: n, axis: 2 } }).axes;
    near(h[2], n, 1e-15);
    near(h[0], [1, 0, 0], 1e-15, 'a lies in that plane');
    near(dot(h[1], n), 0, 1e-15);
    near(dot(cross(h[0], h[1]), h[2]), 1, 1e-15);
    const skew = frameAxes('surface', { cell: [[3, 0, 1], [0, 3, 0], [0, 0, 20]], surface: SURFACE }).axes;
    near(skew[0], [1, 0, 0], 1e-15, 'a with a part along n: its projection');
    // no surface: Surface falls back to auto
    assert.equal(frameAxes('surface', { cell: HEX }).frame, 'cartesian');
  });

  test('Lattice frame: unit cell vectors; without a cell it falls back', () => {
    const l = frameAxes('lattice', { cell: HEX, surface: SURFACE });
    assert.equal(l.frame, 'lattice');
    assert.deepEqual(l.labels, ['a', 'b', 'c']);
    near(l.axes.flat(), [1, 0, 0, -0.5, Math.sqrt(3) / 2, 0, 0, 0, 1], 1e-15);
    assert.equal(frameAxes('lattice', { surface: SURFACE }).frame, 'surface');
    assert.equal(frameAxes('lattice').frame, 'cartesian');
    assert.equal(frameAxes('cartesian', { cell: HEX, surface: SURFACE }).frame, 'cartesian');
  });

  test('frameComponents are contravariant (D19), not projections', () => {
    const delta = comb([0, 0, 0], [0.3, HEX_AXES[0]], [0.3, HEX_AXES[1]]);
    near(frameComponents(delta, HEX_AXES), [0.3, 0.3, 0], 1e-15);
    near([dot(delta, HEX_AXES[0]), dot(delta, HEX_AXES[1])], [0.15, 0.15], 1e-15, 'the projections differ');
    // in the Lattice frame, the components are the fractional coordinates times the axis lengths
    const frac = [0.1, -0.25, 0.02];
    const cart = comb([0, 0, 0], [frac[0], HEX[0]], [frac[1], HEX[1]], [frac[2], HEX[2]]);
    near(frameComponents(cart, HEX_AXES), frac.map((f, k) => f * norm(HEX[k])), 1e-12);
    near(frameComponents([1, 2, 3], CART), [1, 2, 3], 0);
  });
});

describe('snapping (M4 §3.11.3)', () => {
  test('snapToStep: the prototype values, decimal steps exactly, halves away from zero, never −0', () => {
    assert.equal(snapToStep(0.537, 0.1), 0.5);
    assert.equal(snapToStep(37.4, 5), 35);
    assert.equal(snapToStep(0.31, 0.1), 0.3);                 // not 0.30000000000000004
    assert.equal(snapToStep(0.35, 0.1), 0.4);                 // 0.35 / 0.1 = 3.4999999999999996 would give 0.3
    assert.equal(snapToStep(0.25, 0.1), 0.3);
    assert.equal(snapToStep(-0.25, 0.1), -0.3);
    assert.ok(Object.is(snapToStep(-0.04, 0.1), 0));
    assert.equal(snapToStep(0.076, 0.05), 0.1);
    assert.equal(snapToStep(0.37, 0.25), 0.25);
    assert.equal(snapToStep(-47.5, 5), -50);
    assert.equal(snapToStep(1.2345, 0), 1.2345);
    assert.equal(snapToStep(1.2345, null), 1.2345);
    assert.equal(snapToStep(2.0, d111 / 3), 2 * (d111 / 3), 'other steps multiply');
  });

  test('latticeSnapSteps: 1/n of a and b is one 1×1 lattice vector on p(3×3) (D19)', () => {
    const p33 = [scale(HEX[0], 3), scale(HEX[1], 3), HEX[2]];
    near(latticeSnapSteps(p33, [[3, 0, 0], [0, 3, 0], [0, 0, 1]], 0.1), [d111, d111, 0.1], 1e-12);
    near(latticeSnapSteps(p33, [3, 3, 1]), [d111, d111, 0], 1e-12, 'the legacy info.supercell');
    assert.equal(latticeSnapSteps(p33, [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], 0.1), null, '(√3×√3)R30°: not diagonal');
    assert.equal(latticeSnapSteps(null, [3, 3, 1]), null);
    assert.equal(latticeSnapSteps(p33, null), null);
    assert.equal(latticeSnapSteps(p33, [[0, 0, 0], [0, 3, 0], [0, 0, 1]]), null);
    assert.throws(() => latticeSnapSteps(p33, 'p(3x3)'), /supercellMatrix must be a 3×3 integer matrix/);
  });

  test('snapToTarget: point and plane modes, radius, nearest, {position} objects', () => {
    const cam = topView();
    const opts = { project: cam.project };
    // point mode: P = (0.95, 0.05, 0) is 3.5 px from T, which is 0.3 Å deeper: the point is reached in 3D
    const r = snapToTarget([0, 0, 0], [0.95, 0.05, 0], [[1, 0.1, 0.3]], opts);
    assert.equal(r.target, 0);
    near(r.delta, [1, 0.1, 0.3], 1e-15);
    near(r.distance, Math.hypot(2.5, 2.5), 1e-9);
    // beyond 12 px nothing happens; a closer target wins over the first one
    assert.equal(snapToTarget([0, 0, 0], [0.75, 0, 0], [[1, 0, 0]], opts).target, null);
    assert.equal(snapToTarget([0, 0, 0], [1, 0, 0], [{ position: [1.2, 0, 0], label: 'far' }, { position: [1.05, 0, 0] }], opts).target, 1);
    assert.equal(snapToTarget([0, 0, 0], [1, 0, 0], [[1.2, 0, 0]], { ...opts, radius: 5 }).target, null);
    assert.deepEqual(snapToTarget([0, 0, 0], [1, 0, 0], null, opts), { delta: [1, 0, 0], target: null, distance: null });
    // plane mode from an oblique view: C 1.85 Å above the surface, the targets on it; only the in-plane position snaps
    const view = tiltedView(50, [1.4, 0, 1.85]);
    const P = [2.70, 0.05, 1.85], tops = [[0, 0, 0], [d111, 0, 0], [d111 / 2, 1.2, 0]];
    const plane = snapToTarget([0, 0, 1.85], sub(P, [0, 0, 1.85]), tops, { project: view.project, mode: 'plane', normal: Z });
    assert.equal(plane.target, 1);
    near(add([0, 0, 1.85], plane.delta), [d111, 0, 1.85], 1e-12, 'the height stays');
    // the same drag compared point to point: T is 72 px below P on screen, so a point snap would never capture it
    const [px, py] = scr(view, P), [tx, ty] = scr(view, tops[1]);
    near(Math.hypot(px - tx, py - ty), Math.hypot(0.072 / 0.02, (0.05 * Math.cos(50 * DEG) + 1.85 * Math.sin(50 * DEG)) / 0.02), 0.1);
    assert.equal(snapToTarget([0, 0, 1.85], sub(P, [0, 0, 1.85]), tops, { project: view.project }).target, null);
  });
});

describe('angles', () => {
  test('angleAbout: right-handed, projected on the plane normal to the axis, (−180, 180]', () => {
    const c30 = [Math.cos(30 * DEG), Math.sin(30 * DEG), 0];
    near(angleAbout([1, 0, 0], c30, Z), 30, 1e-12);
    near(angleAbout(c30, [1, 0, 0], Z), -30, 1e-12);
    near(angleAbout([1, 0, 0], c30, [0, 0, -2]), -30, 1e-12);
    near(angleAbout([1, 0, 5], add(c30, [0, 0, -3]), Z), 30, 1e-12);
    assert.equal(angleAbout([1, 0, 0], [-1, -0, 0], Z), 180);
    assert.equal(angleAbout([1, 0, 0], [-1, 0, 0], Z), 180);
    assert.equal(angleAbout([0, 0, 2], [1, 0, 0], Z), null);
    assert.equal(angleAbout([1, 0, 0], [0, 0, 0], Z), null);
  });

  test('accumulateAngle runs on past ±180° (the v1 prototype case)', () => {
    let total = 0, prev = 170;
    for (const raw of [175, -178, -170]) { total = accumulateAngle(total, prev, raw); prev = raw; }
    assert.equal(total, 20);
    total = 0; prev = 0;
    for (let k = 1; k <= 13; k++) { const raw = ((30 * k + 180) % 360) - 180; total = accumulateAngle(total, prev, raw); prev = raw; }
    assert.equal(total, 390);
    assert.equal(accumulateAngle(10, 170, -170), 30);
    assert.equal(accumulateAngle(10, -170, 170), -10);
  });
});

describe('axis drags (M4 §7.2-1)', () => {
  // the v1 prototype's camera: perspective at (0, 0, 20) looking down −z, fov 30°, 800 × 600
  const persp = () => camera({ eye: [0, 0, 20], target: [0, 0, 0], up: [0, 1, 0] });
  const C = [1, 0.5, 2];

  test('dragging the x arrow 1.5 Å gives 1.5 Å along x (perspective and orthographic)', () => {
    for (const cam of [persp(), topView(C)]) {
      const st = beginDrag({ kind: 'axis', axis: 0, pointer: scr(cam, C), view: cam, axes: CART, pivot: C });
      const r = dragTo(st, scr(cam, add(C, [1.5, 0, 0])));
      near(r.delta, [1.5, 0, 0], 1e-9);
      assert.equal(r.kind, 'axis');
      assert.ok(r.moved && !r.snapped && !r.kept && r.target === null);
      assert.equal(st.result, r);
    }
  });

  test('a pointer 40 px off the axis still moves along x only', () => {
    const cam = persp();
    const st = beginDrag({ kind: 'axis', axis: 0, pointer: scr(cam, C), view: cam, axes: CART, pivot: C });
    const [x, y] = scr(cam, add(C, [1.5, 0, 0]));
    const r = dragTo(st, [x, y + 40]);
    assert.equal(r.delta[1], 0);
    assert.equal(r.delta[2], 0);
    near(r.delta[0], 1.5, 0.01, 'perspective: within 0.01 Å of the on-axis value');
    const top = topView(C);
    const s2 = beginDrag({ kind: 'axis', axis: 0, pointer: scr(top, C), view: top, axes: CART, pivot: C });
    const [x2, y2] = scr(top, add(C, [1.5, 0, 0]));
    near(dragTo(s2, [x2, y2 + 40]).delta, [1.5, 0, 0], 1e-9, 'orthographic: exactly');
  });

  test('an axis along the line of sight gives null; mid-drag the last value is kept', () => {
    const cam = persp();
    assert.equal(axisParam(cam, [400, 300], [0, 0, 0], Z), null);
    assert.equal(axisParam(cam, [400, 300], [0, 0, 0], [0.05, 0, -1]), null, 'within about 5°');
    assert.ok(axisParam(cam, [400, 300], [0, 0, 0], [0.2, 0, -1]) !== null);
    assert.equal(handleVisibility(CART, cam.viewDir).axis[2], false, 'and its arrow is hidden');
    const view = swappable(topView(C));
    const st = beginDrag({ kind: 'axis', axis: 0, pointer: scr(view.cam, C), view, axes: CART, pivot: C });
    near(dragTo(st, scr(view.cam, add(C, [1, 0, 0]))).delta, [1, 0, 0], 1e-9);
    const top = view.cam;
    view.cam = camera({ eye: add(C, [20, 0, 0]), target: C, ortho: true });   // x now along the line of sight
    const kept = dragTo(st, [500, 250]);
    assert.ok(kept.kept && kept.moved);
    near(kept.delta, [1, 0, 0], 1e-9);
    view.cam = top;
    near(dragTo(st, scr(top, add(C, [2, 0, 0]))).delta, [2, 0, 0], 1e-9, 'then it carries on from the last reading');
  });

  test('a view whose pointOnLine gives only s, and THREE.Vector3-like points', () => {
    const cam = topView(C);
    const sOnly = { ...cam, pointOnLine: (...a) => ({ s: cam.pointOnLine(...a).s }) };
    const st = beginDrag({ kind: 'axis', axis: 1, pointer: scr(cam, C), view: sOnly, axes: CART, pivot: C });
    near(dragTo(st, scr(cam, add(C, [0.3, -0.7, 0]))).delta, [0, -0.7, 0], 1e-9);
    const v3 = { ...cam, pointOnLine: (...a) => { const q = cam.pointOnLine(...a); return { point: { x: q.point[0], y: q.point[1], z: q.point[2] }, s: q.s }; } };
    const s3 = beginDrag({ kind: 'axis', axis: 1, pointer: scr(cam, C), view: v3, axes: CART, pivot: C });
    near(dragTo(s3, scr(cam, add(C, [0.3, -0.7, 0]))).delta, [0, -0.7, 0], 1e-9);
  });
});

describe('plane and centre drags', () => {
  const C = [0.4, -0.3, 1.2];
  const oblique = () => camera({ eye: add(C, [9, 6, 14]), target: C });

  test('a square moves in its plane, following the pointer', () => {
    const cam = oblique();
    const grab = add(C, [0.2, 0.3, 0]);
    const st = beginDrag({ kind: 'plane', plane: 2, pointer: scr(cam, grab), view: cam, axes: CART, pivot: C });
    near(st.normal, Z, 1e-15);
    const r = dragTo(st, scr(cam, add(grab, [0.7, -0.4, 0])));
    near(r.delta, [0.7, -0.4, 0], 1e-9);
    assert.equal(r.delta[2], 0, 'exactly in the plane');
    // the x–z square
    const s1 = beginDrag({ kind: 'plane', plane: 1, pointer: scr(cam, C), view: cam, axes: CART, pivot: C });
    near(dragTo(s1, scr(cam, add(C, [-0.5, 0, 0.25]))).delta, [-0.5, 0, 0.25], 1e-9);
  });

  test('the handle index can come from the hit; Vector3-like plane points work', () => {
    const cam = oblique();
    const wpp = cam.worldPerPixel(C);
    const mid = comb(C, [24 * wpp, [1, 0, 0]], [24 * wpp, [0, 1, 0]]);
    const hit = hitHandle(scr(cam, mid), { pivot: C, axes: CART, viewDir: cam.viewDir, worldPerPixel: wpp, project: cam.project });
    assert.equal(hit.kind, 'plane');
    assert.equal(hit.plane, 2);
    const view = { ...cam, pointOnPlane: (...a) => { const p = cam.pointOnPlane(...a); return p && { x: p[0], y: p[1], z: p[2] }; } };
    const st = beginDrag({ hit, pointer: scr(cam, mid), view, axes: CART, pivot: C });
    assert.equal(st.kind, 'plane');
    near(dragTo(st, scr(cam, add(mid, [0.1, 0.2, 0]))).delta, [0.1, 0.2, 0], 1e-9);
  });

  test('the centre disc moves in the screen plane', () => {
    const cam = oblique();
    const st = beginDrag({ kind: 'center', pointer: scr(cam, C), view: cam, axes: CART, pivot: C });
    near(st.normal, scale(cam.viewDir, -1), 1e-15);
    const r = dragTo(st, add([...scr(cam, C), 0], [60, -25, 0]).slice(0, 2));
    near(dot(r.delta, cam.viewDir), 0, 1e-12);
    near(scr(cam, add(C, r.delta)), add([...scr(cam, C), 0], [60, -25, 0]).slice(0, 2), 1e-6, 'under the pointer');
    const top = topView(C);
    const s2 = beginDrag({ kind: 'center', pointer: scr(top, C), view: top, axes: CART, pivot: C });
    near(dragTo(s2, add([...scr(top, C), 0], [50, 0, 0]).slice(0, 2)).delta, [1, 0, 0], 1e-12, '50 px at 0.02 Å per px');
  });
});

describe('direct drags of a selected atom (D9, U1)', () => {
  const G = [1.385, 0.8, 7.5];
  const shift = (cam, dx, dy) => { const [x, y] = scr(cam, G); return [x + dx, y + dy]; };

  for (const theta of [30, 60]) {
    test(`line of sight ${theta}° from the normal: along the surface the height stays, in the screen plane it changes`, () => {
      const cam = tiltedView(theta, G);
      const st = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface: SURFACE });
      assert.equal(st.mode, 'surface');
      assert.equal(st.edgeOn, false);
      const r = dragTo(st, shift(cam, 37, -53));
      assert.equal(r.delta[2], 0, 'height unchanged');
      assert.ok(norm(r.delta) > 0.5);
      near(scr(cam, add(G, r.delta)), shift(cam, 37, -53), 1e-6, 'the atom stays under the pointer');
      // 50 px up is 1 Å up the screen: along the surface that is 1/cos θ Å along y at the same height
      near(dragTo(st, shift(cam, 0, -50)).delta, [0, 1 / Math.cos(theta * DEG), 0], 1e-9);
      // with Screen plane on, the same pointer motion changes the height by 1 Å × sin θ (0.50 Å at 30°)
      const sp = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface: SURFACE, screenPlane: true });
      assert.equal(sp.mode, 'screen');
      assert.equal(sp.edgeOn, false);
      const h = dragTo(sp, shift(cam, 0, -50)).delta;
      near(h[2], Math.sin(theta * DEG), 1e-9);
      near(h, [0, Math.cos(theta * DEG), Math.sin(theta * DEG)], 1e-9);
    });
  }

  test('edge-on views fall back to the screen plane (|n·d| < 0.2)', () => {
    const edge = tiltedView(85, G);                       // |n·d| = cos 85° = 0.087
    const st = beginDrag({ kind: 'direct', pointer: scr(edge, G), view: edge, axes: CART, grab: G, surface: SURFACE });
    assert.equal(st.mode, 'screen');
    assert.equal(st.edgeOn, true);
    near(st.normal, scale(edge.viewDir, -1), 1e-15);
    const r = dragTo(st, shift(edge, 20, -30));
    near(dot(r.delta, edge.viewDir), 0, 1e-12);
    const steep = tiltedView(78, G);                      // cos 78° = 0.208: still along the surface
    assert.equal(beginDrag({ kind: 'direct', pointer: scr(steep, G), view: steep, axes: CART, grab: G, surface: SURFACE }).mode, 'surface');
  });

  test('without a surface the screen plane is used, and directDragPlane says why', () => {
    const cam = tiltedView(30, G);
    for (const surface of [null, { ...SURFACE, surface: false, source: 'ab-plane' }]) {
      const st = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface });
      assert.equal(st.mode, 'screen');
      assert.equal(st.edgeOn, false);
    }
    assert.deepEqual(directDragPlane({ surface: SURFACE, viewDir: [0, 0, -1] }), { mode: 'surface', normal: Z, edgeOn: false });
    assert.deepEqual(directDragPlane({ surface: SURFACE, viewDir: [0, 0, -1], screenPlane: true }), { mode: 'screen', normal: [-0, -0, 1], edgeOn: false });
    assert.deepEqual(directDragPlane({ surface: SURFACE, viewDir: [1, 0, 0] }), { mode: 'screen', normal: [-1, -0, -0], edgeOn: true });
    assert.equal(directDragPlane({ surface: { surface: true, normal: [0, 0, 3] }, viewDir: unit([0, 1, -0.25]) }).mode, 'surface');
  });

  test('a press the view cannot place starts from the first reading; non-finite points count as none', () => {
    const cam = tiltedView(30, G);
    let calls = 0;
    const view = { ...cam, pointOnPlane: (...a) => (calls++ === 0 ? null : calls === 3 ? [NaN, 0, 0] : cam.pointOnPlane(...a)) };
    const st = beginDrag({ kind: 'direct', pointer: scr(cam, G), view, axes: CART, grab: G, surface: SURFACE });
    const first = dragTo(st, shift(cam, 20, 0));
    assert.deepEqual([first.delta, first.moved, first.kept], [[0, 0, 0], false, false]);
    assert.equal(dragTo(st, shift(cam, 30, 0)).kept, true, 'NaN from the view');
    near(dragTo(st, shift(cam, 70, 0)).delta, [1, 0, 0], 1e-9, '50 px after the first reading');
  });

  test('a pressTarget atom starts a direct drag', () => {
    const cam = tiltedView(30, G);
    const press = pressTarget(null, { kind: 'atom', atom: { index: 40, src: 12, t: 3 } }, new Set([12]));
    const st = beginDrag({ hit: press, pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface: SURFACE });
    assert.equal(st.kind, 'direct');
    assert.equal(dragTo(st, shift(cam, 10, 10)).delta[2], 0);
  });
});

describe('ring drags', () => {
  const C = [1, 0.5, 2];
  const persp = () => camera({ eye: [0, 0, 20], target: [0, 0, 0], up: [0, 1, 0] });
  const onRing = (t, r = 1) => add(C, [r * Math.cos(t * DEG), r * Math.sin(t * DEG), 0]);

  test('a ring dragged 30° gives 30° (plane method), the other way −30°', () => {
    const cam = persp();
    const st = beginDrag({ kind: 'ring', axis: 2, pointer: scr(cam, onRing(0)), view: cam, axes: CART, pivot: C });
    assert.equal(st.mode, 'plane');
    const r = dragTo(st, scr(cam, onRing(30)));
    assert.equal(r.kind, 'ring');
    near(r.angle, 30, 1e-9);
    near(r.axis, Z, 0);
    near(r.pivot, C, 0);
    assert.ok(r.moved && !r.kept);
    near(dragTo(st, scr(cam, onRing(-30, 0.6))).angle, -30, 1e-9, 'any point of the plane, any radius');
  });

  test('a full turn and more accumulates past ±180°', () => {
    const cam = persp();
    const st = beginDrag({ kind: 'ring', axis: 2, pointer: scr(cam, onRing(0)), view: cam, axes: CART, pivot: C });
    for (let t = 30; t <= 360; t += 30) dragTo(st, scr(cam, onRing(t)));
    near(st.result.angle, 360, 1e-9);
    near(dragTo(st, scr(cam, onRing(390))).angle, 390, 1e-9);
    for (let t = 360; t >= -200; t -= 40) dragTo(st, scr(cam, onRing(t)));
    near(st.result.angle, -200, 1e-9);
  });

  test('rings snap to the angle step and take fine increments', () => {
    const cam = persp();
    const st = beginDrag({ kind: 'ring', axis: 2, pointer: scr(cam, onRing(0)), view: cam, axes: CART, pivot: C });
    near(dragTo(st, scr(cam, onRing(37.4)), { snap: 5 }).angle, 35, 1e-9);
    near(dragTo(st, scr(cam, onRing(37.4))).angle, 37.4, 1e-9, 'snapping only filters the output');
    near(dragTo(st, scr(cam, onRing(57.4)), { fine: 0.1 }).angle, 39.4, 1e-9);
    const small = beginDrag({ kind: 'ring', axis: 2, pointer: scr(cam, onRing(0)), view: cam, axes: CART, pivot: C });
    const r = dragTo(small, scr(cam, onRing(2)), { snap: 5 });
    assert.equal(r.angle, 0);
    assert.equal(r.moved, false);
    assert.throws(() => dragTo(small, scr(cam, onRing(2)), { snap: [5, 5, 5] }), /a ring drag snaps to one angle step/);
  });

  test('an edge-on ring uses the screen tangent: 60 px along it is 1 rad', () => {
    // ring about x seen almost edge-on (|x̂·d̂| = 0.1 ≤ 0.2); grab its lower front point
    const P0 = [0, 0, 0];
    const f = [-0.1, 0, -Math.sqrt(0.99)];
    const cam = camera({ eye: sub(P0, scale(f, 30)), target: P0, up: [0, 1, 0], ortho: true });
    const wpp = cam.worldPerPixel(P0), R = 60 * wpp;
    const front = [0, -R * Math.SQRT1_2, R * Math.SQRT1_2];
    const opts = { pivot: P0, axes: CART, viewDir: cam.viewDir, worldPerPixel: wpp, project: cam.project };
    const hit = hitHandle(scr(cam, front), opts);
    assert.equal(hit.kind, 'ring');
    assert.equal(hit.axis, 0);
    near(hit.point, front, 1e-9);
    // +θ about x turns the lower front point down the screen: the tangent points that way
    const turned = [0, R * Math.cos(136 * DEG), R * Math.sin(136 * DEG)];
    const move = sub([...scr(cam, turned), 0], [...scr(cam, front), 0]);
    assert.ok(hit.tangent[0] * move[0] + hit.tangent[1] * move[1] > 0);
    near(Math.hypot(...hit.tangent), 1, 1e-12);
    for (const withHit of [true, false]) {
      const st = beginDrag({ kind: 'ring', axis: 0, ...(withHit ? { hit } : {}), pointer: scr(cam, front), view: cam, axes: CART, pivot: P0 });
      assert.equal(st.mode, 'tangent');
      const [x, y] = scr(cam, front);
      near(dragTo(st, [x + 60 * hit.tangent[0], y + 60 * hit.tangent[1]]).angle, 180 / Math.PI, 1e-6);
      near(dragTo(st, [x - 30 * hit.tangent[0] + 5 * hit.tangent[1], y - 30 * hit.tangent[1] - 5 * hit.tangent[0]]).angle, -90 / Math.PI, 1e-6, 'only the tangential part counts');
    }
    // just above the threshold the plane method is used
    const g = [-0.21, 0, -Math.sqrt(1 - 0.21 * 0.21)];
    const cam2 = camera({ eye: sub(P0, scale(g, 30)), target: P0, up: [0, 1, 0], ortho: true });
    assert.equal(beginDrag({ kind: 'ring', axis: 0, pointer: [400, 250], view: cam2, axes: CART, pivot: P0 }).mode, 'plane');
  });
});

describe('fine and snapped increments (M4 §3.11.2–3.11.3, D19)', () => {
  const C = [0, 0, 0];
  const at = (cam, dx, dy = 0) => { const [x, y] = scr(cam, C); return [x + dx, y - dy]; };

  test('Shift scales the increments, so switching it never jumps', () => {
    const cam = topView();
    const st = beginDrag({ kind: 'axis', axis: 0, pointer: at(cam, 0), view: cam, axes: CART, pivot: C });
    near(dragTo(st, at(cam, 50)).delta, [1, 0, 0], 1e-12);
    near(dragTo(st, at(cam, 50), { fine: 0.1 }).delta, [1, 0, 0], 1e-12, 'pressing Shift');
    near(dragTo(st, at(cam, 100), { fine: 0.1 }).delta, [1.1, 0, 0], 1e-12);
    near(dragTo(st, at(cam, 150)).delta, [2.1, 0, 0], 1e-12, 'released');
    near(dragTo(st, at(cam, 100), { fine: SURFACE_DEFAULTS.fineFactor ?? 0.1 }).delta, [2.0, 0, 0], 1e-12);
  });

  test('snapping filters the output: on the arrow, per axis, and to zero', () => {
    const cam = topView();
    const st = beginDrag({ kind: 'axis', axis: 0, pointer: at(cam, 0), view: cam, axes: CART, pivot: C });
    const r = dragTo(st, at(cam, 61.5), { snap: 0.1 });
    near(r.delta, [1.2, 0, 0], 1e-15);
    assert.ok(r.snapped);
    near(dragTo(st, at(cam, 61.5)).delta, [1.23, 0, 0], 1e-12, 'Ctrl released');
    near(dragTo(st, at(cam, 61.5), { snap: [0.5, 0, 0] }).delta, [1, 0, 0], 1e-15);
    assert.equal(dragTo(st, at(cam, 61.5), { snap: [0, 0.5, 0.5] }).snapped, false, 'no step along x');
    const z = beginDrag({ kind: 'axis', axis: 0, pointer: at(cam, 0), view: cam, axes: CART, pivot: C });
    const zero = dragTo(z, at(cam, 2), { snap: 0.1 });
    assert.deepEqual(zero.delta, [0, 0, 0]);
    assert.equal(zero.moved, false, 'nothing to apply: cancel on release');
    assert.equal(dragTo(z, at(cam, 2)).moved, true);
    assert.equal(dragTo(z, at(cam, 2e-4)).moved, false, `within positionTolerance (${SURFACE_DEFAULTS.positionTolerance} Å)`);
  });

  test('hexagonal Lattice frame: the a–b square snaps the contravariant components', () => {
    const cam = topView();
    const raw = comb(C, [0.26, HEX_AXES[0]], [0.33, HEX_AXES[1]]);
    const st = beginDrag({ kind: 'plane', plane: 2, pointer: scr(cam, C), view: cam, axes: HEX_AXES, pivot: C });
    const r = dragTo(st, scr(cam, raw), { snap: 0.1 });
    near(frameComponents(r.delta, HEX_AXES), [0.3, 0.3, 0], 1e-12);
    near(r.delta, [0.15, 0.3 * Math.sqrt(3) / 2, 0], 1e-12);
    // not the projections: those were 0.095 and 0.2 (they would snap to 0.1 and 0.2), and after snapping are off the grid
    near([dot(raw, HEX_AXES[0]), dot(raw, HEX_AXES[1])], [0.095, 0.2], 1e-12);
    near([dot(r.delta, HEX_AXES[0]), dot(r.delta, HEX_AXES[1])], [0.15, 0.15], 1e-12);
    // in the Cartesian frame the same drag snaps x and y instead
    const c = beginDrag({ kind: 'plane', plane: 2, pointer: scr(cam, C), view: cam, axes: CART, pivot: C });
    near(dragTo(c, scr(cam, raw), { snap: 0.1 }).delta, [0.1, 0.3, 0], 1e-12);
    // 1/n of a and b on p(3×3): one step is one 1×1 lattice vector
    const p33 = [scale(HEX[0], 3), scale(HEX[1], 3), HEX[2]];
    const steps = latticeSnapSteps(p33, [[3, 0, 0], [0, 3, 0], [0, 0, 1]], 0.1);
    const big = comb(C, [1.2 * d111, HEX_AXES[0]], [-0.9 * d111, HEX_AXES[1]]);
    near(frameComponents(dragTo(st, scr(cam, big), { snap: steps }).delta, HEX_AXES), [d111, -d111, 0], 1e-12);
  });

  test('an atom dragged along a hexagonal surface snaps α and β and keeps its height', () => {
    const G = [0.4, 0.2, 7.5];
    const cam = tiltedView(40, G);
    const axes = frameAxes('lattice', { cell: HEX, surface: SURFACE }).axes;
    const st = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes, grab: G, surface: SURFACE });
    const r = dragTo(st, scr(cam, comb(G, [0.42, axes[0]], [0.17, axes[1]])), { snap: 0.1 });
    near(frameComponents(r.delta, axes), [0.4, 0.2, 0], 1e-12);
    assert.equal(r.delta[2], 0);
    // a tilted surface in the Cartesian frame: x, y, z snap, then the height along n is restored
    const n = unit([0, 0.5, 1]);
    const tilt = { surface: true, normal: n, axis: 2 };
    const cam2 = camera({ eye: add(G, scale(n, 25)), target: G, up: [0, 1, 0], ortho: true });
    const s2 = beginDrag({ kind: 'direct', pointer: scr(cam2, G), view: cam2, axes: CART, grab: G, surface: tilt });
    assert.equal(s2.mode, 'surface');
    const r2 = dragTo(s2, add([...scr(cam2, G), 0], [47, -31, 0]).slice(0, 2), { snap: 0.1 });
    near(dot(r2.delta, n), 0, 1e-15);
    assert.ok(norm(r2.delta) > 0.5);
    // a screen-plane drag snaps all three components
    const s3 = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G });
    const r3 = dragTo(s3, add([...scr(cam, G), 0], [41, -17, 0]).slice(0, 2), { snap: 0.1 });
    for (const v of r3.delta) near(v * 10, Math.round(v * 10), 1e-9);
  });
});

describe('snap targets', () => {
  test('centre and screen-plane drags snap to the target point; Alt (no targets) does not', () => {
    const cam = topView();
    const T = [[3, 3, 0], [1, 0.1, 0.3]];
    const st = beginDrag({ kind: 'center', pointer: scr(cam, [0, 0, 0]), view: cam, axes: CART, pivot: [0, 0, 0] });
    const r = dragTo(st, scr(cam, [0.95, 0.05, 0]), { targets: T });
    assert.equal(r.target, 1);
    near(r.delta, [1, 0.1, 0.3], 1e-12);
    const alt = dragTo(st, scr(cam, [0.95, 0.05, 0]), { targets: null });
    assert.equal(alt.target, null);
    near(alt.delta, [0.95, 0.05, 0], 1e-12);
    assert.equal(dragTo(st, scr(cam, [0.95, 0.05, 0]), { targets: T, snapRadius: 3 }).target, null);
  });

  test('a CO dragged along the surface snaps to the site under it and keeps its height', () => {
    const G = [0.3, 0.2, 1.85];
    const cam = tiltedView(50, G);
    const tops = [[0, 0, 0], [d111, 0, 0], [d111 / 2, 1.2, 0]];
    const st = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface: SURFACE });
    const r = dragTo(st, scr(cam, [2.70, 0.05, 1.85]), { targets: tops.map((position) => ({ position, label: 'top' })) });
    assert.equal(r.target, 1);
    near(add(G, r.delta), [d111, 0, 1.85], 1e-12);
    // with Screen plane on the target point itself is the goal
    const sp = beginDrag({ kind: 'direct', pointer: scr(cam, G), view: cam, axes: CART, grab: G, surface: SURFACE, screenPlane: true });
    const p = dragTo(sp, scr(cam, [d111 + 0.05, 0, 0]), { targets: tops });
    assert.equal(p.target, 1);
    near(add(G, p.delta), [d111, 0, 0], 1e-12);
  });

  test('arrows, rings and squares off the surface plane have no targets; the surface square has', () => {
    const cam = camera({ eye: [9, 6, 14], target: [0, 0, 0] });
    const T = [[1, 0, 0]];
    const ax = beginDrag({ kind: 'axis', axis: 0, pointer: scr(cam, [0, 0, 0]), view: cam, axes: CART, pivot: [0, 0, 0] });
    assert.equal(dragTo(ax, scr(cam, [0.98, 0, 0]), { targets: T }).target, null);
    const ring = beginDrag({ kind: 'ring', axis: 2, pointer: scr(cam, [1, 0, 0]), view: cam, axes: CART, pivot: [0, 0, 0] });
    assert.equal(dragTo(ring, scr(cam, [0.9, 0.3, 0]), { targets: T }).target, null);
    const uv = beginDrag({ kind: 'plane', plane: 2, pointer: scr(cam, [0, 0, 0.5]), view: cam, axes: CART, pivot: [0, 0, 0.5], surface: SURFACE });
    const r = dragTo(uv, scr(cam, [0.97, 0.02, 0.5]), { targets: T });
    assert.equal(r.target, 0);
    near(add([0, 0, 0.5], r.delta), [1, 0, 0.5], 1e-12, 'in-plane position only');
    const un = beginDrag({ kind: 'plane', plane: 1, pointer: scr(cam, [0, 0, 0.5]), view: cam, axes: CART, pivot: [0, 0, 0.5], surface: SURFACE });
    assert.equal(dragTo(un, scr(cam, [0.97, 0, 0.5]), { targets: T }).target, null);
    assert.throws(() => dragTo({ ...uv, _view: { ...cam, project: undefined } }, [0, 0], { targets: T }), /view must have project/);
  });
});

describe('handles: screen-space hit test (M4 §7.2-2)', () => {
  // top view, pivot at the origin on screen (400, 300), 0.02 Å per px; px(dx, dy) is dx right, dy up
  const cam = topView();
  const px = (dx, dy = 0) => [400 + dx, 300 - dy];
  const opts = (extra = {}) => ({ pivot: [0, 0, 0], axes: CART, viewDir: cam.viewDir, worldPerPixel: cam.worldPerPixel([0, 0, 0]), project: cam.project, ...extra });
  const kindOf = (h) => (h ? `${h.kind}${h.kind === 'center' ? '' : h.kind === 'plane' ? h.plane : h.axis}` : null);

  test('visibility: arrows along the line of sight and edge-on squares hide; rings never do', () => {
    assert.deepEqual(handleVisibility(CART, cam.viewDir), { center: true, axis: [true, true, false], plane: [false, false, true], ring: [true, true, true] });
    assert.deepEqual(handleVisibility(CART, cam.viewDir, 'move'), { center: true, axis: [true, true, false], plane: [false, false, true], ring: [false, false, false] });
    assert.deepEqual(handleVisibility(CART, cam.viewDir, 'rotate'), { center: false, axis: [false, false, false], plane: [false, false, false], ring: [true, true, true] });
    const along = (deg) => [Math.sin(deg * DEG), 0, -Math.cos(deg * DEG)];
    assert.equal(handleVisibility(CART, along(7.9)).axis[2], false, 'z within 8° of the line of sight');
    assert.equal(handleVisibility(CART, along(8.2)).axis[2], true);
    assert.equal(handleVisibility(CART, along(90 - 81.9)).plane[0], true, 'the y–z square 81.9° from the line of sight');
    assert.equal(handleVisibility(CART, along(90 - 82.1)).plane[0], false);
  });

  test('each handle at its place', () => {
    assert.deepEqual(hitHandle(px(0, 0), opts()), { kind: 'center', distance: 0 });
    assert.equal(kindOf(hitHandle(px(50, 0), opts())), 'axis0');
    assert.equal(kindOf(hitHandle(px(0, 85), opts())), 'axis1');
    assert.equal(kindOf(hitHandle(px(94, 3), opts())), 'axis0', 'within 8 px of the tip at 88 px');
    assert.equal(kindOf(hitHandle(px(97, 3), opts())), null, 'past it');
    const sq = hitHandle(px(24, 24), opts());
    assert.deepEqual([sq.kind, sq.plane, sq.axes, sq.distance], ['plane', 2, [0, 1], 0]);
    assert.equal(kindOf(hitHandle(px(33, 33), opts())), 'plane2', 'within 3 px of the edge');
    assert.equal(kindOf(hitHandle(px(35, 35), opts())), null);
    const ring = hitHandle(px(62 * Math.SQRT1_2, 62 * Math.SQRT1_2), opts());
    assert.equal(kindOf(ring), 'ring2');
    near(ring.distance, 2, 1e-9);
    near(ring.point, [1.2 * Math.SQRT1_2, 1.2 * Math.SQRT1_2, 0], 1e-12, 'the ring point at 45° (60 px = 1.2 Å)');
    near(ring.tangent, [-Math.SQRT1_2, -Math.SQRT1_2], 1e-9, '+θ about z runs up-left on screen at 45°');
    const off = hitHandle(px(60 * Math.SQRT1_2 + 2, 60 * Math.SQRT1_2), opts());
    near(off.point, [1.2 * Math.cos(Math.atan2(42.43, 44.43)), 1.2 * Math.sin(Math.atan2(42.43, 44.43)), 0], 2e-3, 'nearest point of the 64-gon');
    assert.equal(hitHandle(px(200, 150), opts()), null);
  });

  test('priority: centre > squares > arrows > rings', () => {
    assert.equal(kindOf(hitHandle(px(9, 0), opts())), 'center', 'the x arrow starts 5 px away');
    assert.equal(kindOf(hitHandle(px(12, 0), opts())), 'axis0');
    assert.equal(kindOf(hitHandle(px(24, 10), opts({ touch: true }))), 'plane2', 'the square 7 px away, the x arrow 10 px');
    assert.equal(kindOf(hitHandle(px(60, 0), opts())), 'axis0', 'ring z and the edge-on ring y cross the arrow here');
    assert.equal(kindOf(hitHandle(px(-45, 0), opts())), 'ring1', 'an edge-on ring (a line) is still picked');
    assert.equal(kindOf(hitHandle(px(0, -45), opts())), 'ring0');
    assert.equal(kindOf(hitHandle(px(0, 0), opts({ show: 'rotate' }))), 'ring0', 'no centre when only rings show');
    assert.equal(hitHandle(px(60 * Math.SQRT1_2, 60 * Math.SQRT1_2), opts({ show: 'move' })), null);
  });

  test('hidden handles are skipped: the edge-on x–z square does not steal the x arrow', () => {
    // the x–z square seen edge-on would lie on the x arrow between 17 and 31 px, and squares come first
    assert.equal(kindOf(hitHandle(px(24, 0), opts())), 'axis0');
    // the z arrow along the line of sight is never hit
    for (const p of [px(0, 0), px(1, 1)]) assert.notEqual(kindOf(hitHandle(p, opts())), 'axis2');
  });

  test('touch and pen use the larger tolerances', () => {
    assert.equal(hitHandle(px(50, 12), opts()), null);
    assert.equal(kindOf(hitHandle(px(50, 12), opts({ touch: true }))), 'axis0');
    assert.equal(kindOf(hitHandle(px(15, 0), opts({ touch: true }))), 'center');
    assert.equal(kindOf(hitHandle(px(24, 37), opts({ touch: true }))), 'plane2');
  });

  test('an oblique perspective view: centre, arrows and squares where they are drawn', () => {
    const C = [0.5, -0.2, 1];
    const pc = camera({ eye: add(C, [7, 9, 12]), target: C });
    const wpp = pc.worldPerPixel(C);
    const o = { pivot: C, axes: CART, viewDir: pc.viewDir, worldPerPixel: wpp, project: pc.project };
    const vis = handleVisibility(CART, pc.viewDir);
    assert.deepEqual(vis, { center: true, axis: [true, true, true], plane: [true, true, true], ring: [true, true, true] });
    assert.equal(kindOf(hitHandle(scr(pc, C), o)), 'center');
    for (const k of [0, 1, 2]) assert.equal(kindOf(hitHandle(scr(pc, add(C, scale(CART[k], 80 * wpp))), o)), `axis${k}`);
    for (const [k, [i, j]] of PLANE_AXES.entries()) {
      assert.equal(kindOf(hitHandle(scr(pc, comb(C, [24 * wpp, CART[i]], [24 * wpp, CART[j]])), o)), `plane${k}`);
    }
    const ringPoint = add(C, [-60 * wpp * Math.cos(20 * DEG), -60 * wpp * Math.sin(20 * DEG), 0]);
    const h = hitHandle(scr(pc, ringPoint), o);
    assert.equal(kindOf(h), 'ring2');
    near(h.point, ringPoint, 60 * wpp * 0.01);
  });

  test('pressTarget: a handle, else a selected atom, else nothing', () => {
    const atomHit = { kind: 'atom', atom: { index: 30, src: 7, t: 12.5 } };
    const handle = { kind: 'axis', axis: 0, distance: 1 };
    assert.equal(pressTarget(handle, atomHit, new Set([7])), handle);
    assert.deepEqual(pressTarget(null, atomHit, new Set([7])), { kind: 'atom', atom: atomHit.atom });
    assert.deepEqual(pressTarget(null, atomHit, (src) => src === 7), { kind: 'atom', atom: atomHit.atom });
    assert.equal(pressTarget(null, atomHit, new Set([8])), null, 'an unselected atom: the viewer box-selects');
    assert.equal(pressTarget(null, { kind: 'none', atom: null }, new Set([7])), null);
    assert.equal(pressTarget(null, null, null), null);
  });
});

describe('errors', () => {
  const cam = topView();
  const base = { pointer: [400, 300], view: cam, axes: CART, pivot: [0, 0, 0] };

  test('bad drags', () => {
    assert.throws(() => beginDrag({ ...base, kind: 'move' }), (e) => e instanceof RangeError
      && e.message === `kind must be one of 'axis', 'plane', 'center', 'direct', 'ring' (got "move")`);
    assert.throws(() => beginDrag({ ...base, kind: 'axis', axis: 3 }), /^RangeError: axis must be 0, 1 or 2 \(got 3\)$/);
    assert.throws(() => beginDrag({ ...base, kind: 'center', view: null }), /^TypeError: view must have pointOnPlane/);
    assert.throws(() => beginDrag({ ...base, kind: 'direct' }), /^TypeError: grab must be a finite 3-vector \(got undefined\)$/);
    assert.throws(() => beginDrag({ ...base, kind: 'center', pivot: [0, NaN, 0] }), /pivot must be a finite 3-vector/);
    assert.throws(() => beginDrag({ ...base, kind: 'center', axes: [[1, 0, 0], [0, 1, 0], [1, 1, 0]] }), /axes must not be coplanar/);
    assert.throws(() => beginDrag({ ...base, kind: 'center', pointer: [1] }), /pointer must be a finite screen point/);
    const st = beginDrag({ ...base, kind: 'center' });
    assert.throws(() => dragTo({}, [0, 0]), /state must come from beginDrag/);
    assert.throws(() => dragTo(st, [0, 0], { fine: 0 }), /fine must be a positive number \(got 0\)/);
    assert.throws(() => dragTo(st, [0, 0], { snap: -0.1 }), /a snap step must be a positive number or 0 \(got -0.1\)/);
    assert.throws(() => dragTo(st, [0, 0], { snap: 'on' }), /snap must be a step/);
    assert.throws(() => dragTo(st, [0, 0], { targets: 'sites' }), /targets must be a list of points/);
  });

  test('bad frames, hit tests and values', () => {
    assert.throws(() => frameAxes('polar'), /^RangeError: frame must be one of 'auto', 'surface', 'cartesian', 'lattice' \(got "polar"\)$/);
    assert.throws(() => frameAxes('auto', { cell: [[1, 0, 0]] }), /cell must be three 3-vectors/);
    const o = { pivot: [0, 0, 0], axes: CART, viewDir: cam.viewDir, worldPerPixel: 0.02, project: cam.project };
    assert.throws(() => hitHandle([400, 300], { ...o, worldPerPixel: 0 }), /worldPerPixel must be a positive number \(got 0\)/);
    assert.throws(() => hitHandle([400, 300], { ...o, project: null }), /project must be a function/);
    assert.throws(() => hitHandle([400, 300], { ...o, show: 'all' }), /show must be one of 'both', 'move', 'rotate'/);
    assert.throws(() => hitHandle([400, 300], { ...o, viewDir: [0, 0, 0] }), /viewDir must not be a zero vector/);
    assert.throws(() => snapToStep(Number.NaN, 0.1), /value must be a finite number/);
    assert.throws(() => snapToTarget([0, 0, 0], [0, 0, 0], [], { project: cam.project, mode: 'line' }), /mode must be 'point' or 'plane'/);
    assert.throws(() => angleAbout([1, 0, 0], [0, 1, 0], [0, 0, 0]), /axis must not be a zero vector/);
  });
});
