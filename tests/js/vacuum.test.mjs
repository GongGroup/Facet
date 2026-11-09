// Vacuum gaps along the cell vectors (core/vacuum.js), SURFACE_DEFAULTS (core/defaults.js) and core/lattice.js.
// The shared cases (tests/data/surface/f0d/vacuum.json, tests/data/surface/gaps.json) run in cases.test.mjs; this file
// covers what is particular to the web modules: frozen results, the cache keyed by rev, the current frame,
// makeContiguous on the typed arrays, and the trajectory and orientation checks of the F0-A spec.
// Run: node --test tests/js/vacuum.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import * as util from '../../crystallume/web/js/core/util.js';
import * as lattice from '../../crystallume/web/js/core/lattice.js';
import { SURFACE_DEFAULTS } from '../../crystallume/web/js/core/defaults.js';
import {
  axisGaps, contiguousShifts, displayCuts, findSurfaceGap, findVacuumGap, findVacuumGaps, gapCut, makeContiguous,
  requireGap, surfaceNormal, unwrapAlongGap, vacuumAxis, vacuumGapHint,
} from '../../crystallume/web/js/core/vacuum.js';
import * as vacuum from '../../crystallume/web/js/core/vacuum.js';
import { parseStructure } from '../../crystallume/web/js/io/index.js';
import { repoPath } from './helpers.mjs';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const D_LAYER = 3.92 / Math.sqrt(3);

/** Pt(111) slab (bottom layer at z0); extra atoms [symbol, [x, y, height above the top layer]]. */
function fcc111({ a = 3.92, n = [3, 3], layers = 4, vacuum: vac = 15, z0 = 0, extra = [], pbc = [true, true, true], info = {} } = {}) {
  const d = a / Math.SQRT2, dz = a / Math.sqrt(3);
  const a1 = [d, 0, 0], a2 = [d / 2, d * Math.sqrt(3) / 2, 0];
  const cell = [a1.map((v) => v * n[0]), a2.map((v) => v * n[1]), [0, 0, (layers - 1) * dz + vac]];
  const symbols = [], positions = [];
  for (let L = 0; L < layers; L++) for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) {
    const o = (L % 3) / 3;
    symbols.push('Pt');
    positions.push([0, 1, 2].map((k) => i * a1[k] + j * a2[k] + o * (a1[k] + a2[k]) + (k === 2 ? z0 + L * dz : 0)));
  }
  const top = z0 + (layers - 1) * dz;
  for (const [sym, [x, y, h]] of extra) { symbols.push(sym); positions.push([x, y, top + h]); }
  return new Structure({ name: 'Pt(111)', symbols, positions, cell, pbc, info });
}

function withCO(h, { vac = 15 } = {}) {
  const s = fcc111({ n: [2, 2], vacuum: vac });
  const [x, y] = s.pos(12);
  return fcc111({ n: [2, 2], vacuum: vac, extra: [['C', [x, y, h]], ['O', [x, y, h + 1.15]]] });
}

const fracAlong = (s, k) => { const f = s.fracPositions(); return Array.from({ length: s.length }, (_, i) => f[3 * i + k]); };
const contcar = () => parseStructure(readFileSync(repoPath('tests/data/surface/contcar_pt111.vasp'), 'utf8'), 'CONTCAR');

describe('SURFACE_DEFAULTS and core/lattice.js', () => {
  test('the nine wave-0 constants, frozen, no vacuum default', () => {
    assert.deepEqual(SURFACE_DEFAULTS, {
      vacuumGapMin: 5.0, surfaceHintGapMin: 2.0, blockGapMin: 3.5, smallBlockFraction: 0.5, gapWrapEps: 1e-6,
      positionTolerance: 1e-5, flagTolerance: 1e-6, overlapDistance: 0.5, micTie: 1e-8,
    });
    assert.ok(Object.isFrozen(SURFACE_DEFAULTS));
    assert.ok(!('vacuum' in SURFACE_DEFAULTS));
    assert.throws(() => { SURFACE_DEFAULTS.vacuumGapMin = 4; }, TypeError);   // ES modules are strict
  });

  test('lattice.js re-exports the util.js helpers and surfaceNormal', () => {
    for (const name of ['cellFromParams', 'cellParams', 'fracToCart', 'cartToFrac', 'det3', 'inv3']) assert.equal(lattice[name], util[name], name);
    assert.equal(lattice.surfaceNormal, surfaceNormal);
  });

  test('wrapFractional: the rule, shapes and pbc', () => {
    const w = lattice.wrapFractional([-1e-17, 0.5, 1.0]);
    assert.deepEqual(Array.from(w), [-1e-17, 0.5, 0]);
    const f = Float64Array.from([0.9999999999999, 1.5, -0.25, 2.0, -1.0, 0.75]);
    const g = lattice.wrapFractional(f, [true, true, false]);
    assert.ok(g instanceof Float64Array && g !== f && f[0] === 0.9999999999999);
    assert.ok(g[0] < 0 && g[0] >= -1e-12);
    assert.deepEqual(Array.from(g.slice(1)), [0.5, -0.25, 0, 0, 0.75]);
    assert.ok(Array.isArray(lattice.wrapFractional([0.2, 1.2, 2.2], false)));
    assert.deepEqual(lattice.wrapFractional([0.2, 1.25, 2.5], false), [0.2, 1.25, 2.5]);
    assert.ok(lattice.wrapFractional([1 - 1e-9, 0, 0], true, 1e-6)[0] < 0);
    assert.throws(() => lattice.wrapFractional([0.1, 0.2]), /3n numbers \(got 2\)/);
    assert.throws(() => lattice.wrapFractional(0.5), TypeError);
  });
});

describe('gaps', () => {
  test('a slab: the vacuum along c, wherever the slab is', () => {
    for (const t of [0, 0.37, -0.81, 3.2]) {
      const s = fcc111();
      s.translate([0, 0, t * s.cell[2][2]]);
      const g = findVacuumGap(s);
      assert.equal(g.axis, 2);
      assert.ok(close(g.width, 15), g.width);
      const z = unwrapAlongGap(fracAlong(s, 2), surfaceNormal(s).cut).map((f) => f * s.cell[2][2]);
      assert.ok(close(Math.max(...z) - Math.min(...z), 3 * D_LAYER));
    }
  });

  test('the CONTCAR fixture: 14.9998 Å, the two wrapped atoms drawn below the bottom layer', () => {
    const s = contcar();
    const g = findVacuumGap(s);
    assert.ok(close(g.width, 21.7894 - 6.7896, 1e-4) && close(g.end, 0.99999, 1e-12));
    const z = Array.from(unwrapAlongGap(fracAlong(s, 2), displayCuts(s)[2]), (f) => f * s.cell[2][2]);
    assert.ok(close(z[3], -0.000218, 1e-6) && close(z[7], -0.000218, 1e-6));
    assert.deepEqual(Array.from(contiguousShifts(s, 2)).flatMap((v, i) => (v ? [i] : [])), [3, 7]);
  });

  test('bulk crystals and one-atom primitive cells have no vacuum gap', () => {
    const prim = (m, a) => new Structure({ symbols: ['X'], positions: [[0, 0, 0]], cell: m.map((r) => r.map((v) => 0.5 * a * v)) });
    const bcc = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]], fcc = [[0, 1, 1], [1, 0, 1], [1, 1, 0]];
    for (const [s, widest] of [[prim(bcc, 6.14), 6.14 / Math.SQRT2], [prim(bcc, 5.59), 5.59 / Math.SQRT2], [prim(fcc, 6.20), 6.20 / Math.sqrt(3)]]) {
      assert.equal(findVacuumGap(s), null);
      const w = findVacuumGap(s, null, { minWidth: 0 });
      assert.ok(close(w.width, widest) && w.axis === 2);
      const sn = surfaceNormal(s);
      assert.equal(sn.source, 'ab-plane');
      assert.equal(sn.surface, false);
      assert.match(vacuumGapHint(s), /^no vacuum gap of 5 Å or more along a cell vector \(the widest is \d\.\d Å along c\); add vacuum first$/);
      assert.throws(() => requireGap(s), /^Error: no vacuum gap of 5 Å/);
    }
  });

  test('frames: the current frame by default, a frame with its own cell, errors', () => {
    const s = new Structure({ symbols: ['Pt', 'Pt'], positions: [[0, 0, 0], [0, 0, 5]], cell: [[2.77, 0, 0], [0, 2.77, 0], [0, 0, 10]] });
    s.frames = [{ positions: Float64Array.from([0, 0, 0, 0, 0, 5]), cell: [[2.77, 0, 0], [0, 2.77, 0], [0, 0, 16]] },
      { positions: Float64Array.from([0, 0, 0, 0, 0, 7]), cell: null }];
    assert.ok(close(findVacuumGap(s).width, 5));
    s.setFrame(1);
    assert.ok(close(findVacuumGap(s).width, 11));   // JS default: the frame on screen
    assert.ok(close(findVacuumGap(s, null, { frame: 'current' }).width, 11));
    assert.ok(close(findVacuumGap(s, null, { frame: 0 }).width, 5));
    assert.ok(close(findVacuumGap(s, null, { frame: 2, minWidth: 0 }).width, 7));   // no cell of its own: the base cell
    assert.throws(() => gapCut(s, 2, { frame: 3 }), (e) => e instanceof RangeError && e.message === 'frame 3 out of range (structure has 3 frames)');
    assert.throws(() => gapCut(s, 2, { frame: 1.5 }), (e) => e instanceof TypeError && e.message === 'frame must be an integer (got 1.5)');
  });

  test('axisGaps returns new arrays every time', () => {
    const s = withCO(4, { vac: 10 });
    s.rev = 0;
    const a = axisGaps(s, 2), b = axisGaps(s, 2);
    assert.ok(a.w instanceof Float64Array && a.widths instanceof Float64Array && a.w !== b.w);
    a.w.fill(0.5); a.widths.fill(-1);
    const c = axisGaps(s, 2);
    assert.deepEqual(Array.from(c.w), Array.from(b.w));
    assert.deepEqual(Array.from(c.widths), Array.from(b.widths));
    assert.ok(close(a.height, s.cell[2][2]));
    const sum = Array.from(b.widths).reduce((x, y) => x + y, 0);
    assert.ok(close(sum, b.height));
    assert.equal(axisGaps(s, 2, { exclude: [16, 17] }).n, 16);
    assert.equal(axisGaps(s, 2, { exclude: new Set([16, 17]) }).n, 16);
    assert.equal(axisGaps(s, 2, { exclude: Int32Array.from([16, 17]) }).n, 16);
    assert.equal(axisGaps(s, 2, { exclude: [...Array(16).fill(false), true, true] }).n, 16);
  });
});

describe('the cut', () => {
  test('a molecule floating above the slab stays above it (below-main)', () => {
    const s = withCO(4, { vac: 10 });
    const cut = gapCut(s, 2);
    assert.equal(cut.rule, 'below-main');
    assert.ok(close(cut.empty, 8.85) && close(cut.widest, 4.85));
    const z = Array.from(unwrapAlongGap(fracAlong(s, 2), cut), (f) => f * s.cell[2][2]);
    assert.ok(close(Math.min(...z.slice(0, 16)), 0) && z[16] > Math.max(...z.slice(0, 16)));
  });

  test('desorption: the slab never moves along the trajectory, CO crosses at most once', () => {
    let jumps = 0, prev = null;
    for (let h = 1.85; h <= 15 - 1.6 + 1e-9; h += 0.05) {
      const s = withCO(h);
      const z = Array.from(unwrapAlongGap(fracAlong(s, 2), displayCuts(s)[2]), (f) => f * s.cell[2][2]);
      assert.ok(close(Math.min(...z.slice(0, 16)), 0), `h = ${h}`);
      if (prev !== null && Math.abs(z[16] - prev) > 1) jumps++;
      prev = z[16];
    }
    assert.ok(jumps <= 1, `${jumps} jumps`);
  });

  test('the block threshold allows the tolerance', () => {
    const at = (d) => withCO(15 - d - 1.15);   // O is d below the image of the bottom layer
    for (const d of [3.5, 3.5 - 4.3e-9, 3.5 - 5e-6]) assert.equal(gapCut(at(d), 2).rule, 'below-main', String(d));
    assert.equal(gapCut(at(3.5 - 2e-5), 2).rule, 'widest');
  });

  test('a stale hint is ignored; a valid one lowers the threshold', () => {
    const ring = [['N', [0, 0, 2.1]], ['C', [1.2, 0, 2.8]], ['C', [1.2, 0, 4.2]], ['C', [0, 0, 4.9]], ['C', [-1.2, 0, 4.2]],
      ['C', [-1.2, 0, 2.8]], ['H', [0, 0, 6.7]]];
    const s = fcc111({ vacuum: 10, extra: ring });
    assert.equal(gapCut(s, 2), null);
    assert.equal(surfaceNormal(s).source, 'ab-plane');
    s.info.surface = { axis: 2 };
    s.rev = 0;   // with a rev the results are cached; the key includes info.surface.axis
    const sn = surfaceNormal(s);
    assert.equal(sn.source, 'info');
    assert.ok(close(sn.cut.empty, 3.3, 1e-6) && displayCuts(s)[2] === sn.cut);
    s.info.surface = { axis: 0 };
    assert.equal(surfaceNormal(s).source, 'ab-plane');
    assert.equal(displayCuts(s)[0], null);
    const ex = surfaceNormal(s, { exclude: [36, 37, 38, 39, 40, 41, 42] });
    assert.equal(ex.source, 'vacuum');
    assert.equal(vacuumAxis(s, { exclude: [36, 37, 38, 39, 40, 41, 42] }), 2);
  });
});

describe('the surface normal', () => {
  test('follows the cell: tilted c, rotations, relabelled axes, reversed c', () => {
    const s = fcc111();
    s.info.surface = { normal: [1, 0, 0] };   // never read
    assert.deepEqual([...surfaceNormal(s).normal], [0, 0, 1]);
    const t = fcc111();
    t.cell[2] = [1.5, 0.7, t.cell[2][2]];
    assert.ok(surfaceNormal(t).normal.every((v, k) => close(v, [0, 0, 1][k], 1e-12)));
    for (const R of [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), 0], [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0], [0, 0, 1]]]) {
      const rot = (v) => R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
      const r = new Structure({ symbols: s.symbols, positions: Array.from({ length: s.length }, (_, i) => rot(s.pos(i))), cell: s.cell.map(rot) });
      const want = rot([0, 0, 1]);
      assert.ok(surfaceNormal(r).normal.every((v, k) => close(v, want[k], 1e-12)));
    }
    const p = fcc111({ info: { surface: { axis: 2 } } });
    p.cell = [p.cell[2], p.cell[0], p.cell[1]];   // new a = old c: the hint now names an in-plane axis
    const sp = surfaceNormal(p);
    assert.equal(sp.source, 'vacuum');
    assert.equal(sp.axis, 0);
    const f = fcc111();
    f.cell[2] = f.cell[2].map((v) => -v);   // c reversed: the top is the other side (+a_k)
    const sf = surfaceNormal(f);
    assert.ok(close(sf.normal[2], -1, 1e-12));
    const z = Array.from(unwrapAlongGap(fracAlong(f, 2), sf.cut));
    assert.ok(z.indexOf(Math.max(...z)) < 9);
  });

  test('multiple vacuum axes and the pbc rule', () => {
    const box = new Structure({ symbols: ['C', 'O'], positions: [[7.5, 7.5, 7], [7.5, 7.5, 8.128]], cell: [[15, 0, 0], [0, 15, 0], [0, 0, 15]] });
    const sn = surfaceNormal(box);
    assert.deepEqual([...sn.vacuumAxes], [0, 1, 2]);
    assert.equal(sn.surface, false);
    assert.equal(surfaceNormal(box, { requireGap: true }), null);
    assert.equal(vacuumGapHint(box), 'vacuum gaps along a, b and c: surface tools need a vacuum gap along one cell vector only');
    const g = new Structure({ symbols: ['C', 'C'], positions: [[0, 0, 0], [0, 1.42, 0]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 3]], pbc: [true, true, false] });
    const sg = surfaceNormal(g);
    assert.equal(sg.source, 'pbc');
    assert.equal(sg.cut, null);
    assert.equal(findSurfaceGap(g), null);
    assert.equal(vacuumGapHint(g), null);
    assert.equal(vacuumGapHint(new Structure({ symbols: ['H'], positions: [[0, 0, 0]] })), 'the structure has no unit cell, so it has no vacuum gap');
  });
});

describe('frozen results and the cache', () => {
  test('results are frozen', () => {
    const s = fcc111();
    for (const v of [gapCut(s, 2), gapCut(s, 2).main, surfaceNormal(s), surfaceNormal(s).normal, surfaceNormal(s).vacuumAxes, displayCuts(s)]) {
      assert.ok(Object.isFrozen(v));
    }
    assert.throws(() => { gapCut(s, 2).lo = 0; }, TypeError);
  });

  test('without a rev nothing is cached', () => {
    const t = fcc111();
    const s = { symbols: t.symbols, positions: t.positions, cell: t.cell, pbc: t.pbc, info: {}, frames: [], frame: 0,
      _base: t.positions, _baseCell: t.cell, length: t.length };   // a structure-like object that counts no edits
    assert.notEqual(gapCut(s, 2), gapCut(s, 2));
    assert.deepEqual(gapCut(s, 2), gapCut(s, 2));
    assert.notEqual(displayCuts(s), displayCuts(s));
    assert.deepEqual(displayCuts(s), [null, null, gapCut(s, 2)]);
  });

  test('with a rev: one computation per version, frame, pbc and hint axis', () => {
    const s = fcc111();
    if (typeof s.rev !== 'number') s.rev = 0;
    const bump = () => { if (typeof s.touch === 'function') s.touch(); else s.rev += 1; };
    const c0 = gapCut(s, 2);
    assert.equal(gapCut(s, 2), c0);
    assert.equal(surfaceNormal(s), surfaceNormal(s));
    assert.equal(displayCuts(s), displayCuts(s));
    assert.equal(displayCuts(s)[2], c0);
    assert.notEqual(gapCut(s, 2, { hint: true }), c0);
    assert.notEqual(gapCut(s, 2, { exclude: [] }), c0);   // exclude: computed afresh
    s.positions[3 * 35 + 2] += 0.5;   // a direct write (a top-layer atom 0.5 Å up) is not seen ...
    assert.equal(gapCut(s, 2), c0);
    bump();   // ... until touch()
    const c1 = gapCut(s, 2);
    assert.notEqual(c1, c0);
    assert.ok(!close(c1.width, c0.width, 1e-6));
    s.pbc = [true, true, false];   // pbc is part of the key
    assert.equal(gapCut(s, 2).periodic, false);
    assert.equal(displayCuts(s)[2], null);
  });
});

describe('contiguous shifts and makeContiguous', () => {
  test('moves the wrapped atoms of the CONTCAR by −c, in place, and touches', () => {
    const s = contcar();
    const before = Float64Array.from(s.positions);
    let touched = 0;
    s.touch = () => { touched++; return s; };
    assert.equal(makeContiguous(s, 2), 2);
    assert.equal(touched, 1);
    assert.equal(s.positions, s._base);   // the arrays are edited in place
    for (let i = 0; i < s.length; i++) {
      const dz = s.positions[3 * i + 2] - before[3 * i + 2];
      assert.ok(close(dz, i === 3 || i === 7 ? -s.cell[2][2] : 0, 1e-9), `atom ${i}`);
    }
    assert.equal(makeContiguous(s, 2), 0);
    assert.equal(touched, 1);
  });

  test('every frame gets the same whole-cell shifts along its own cell vector', () => {
    const s = fcc111();
    const c = s.cell[2][2];
    for (let i = 0; i < 9; i++) s.positions[3 * i + 2] += c - 0.02;   // the bottom layer stored at the top
    const c2 = s.cell.map((r) => r.slice()); c2[2][2] += 1;
    const jiggle = Float64Array.from(s.positions, (v, i) => (i % 3 === 0 ? v + 0.01 : v));
    s.frames = [{ positions: Float64Array.from(jiggle), cell: c2 }, { positions: Float64Array.from(jiggle), cell: null }];
    const shifts = Array.from(contiguousShifts(s, 2));
    assert.deepEqual(shifts.flatMap((v, i) => (v ? [i] : [])), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(Array.from(contiguousShifts(s, 2, { frame: 1 })), shifts);
    assert.deepEqual(Array.from(contiguousShifts(s, 2, { cut: displayCuts(s)[2].lo })), shifts);
    assert.equal(makeContiguous(s, 2), 9);
    for (let i = 0; i < 9; i++) {
      assert.ok(close(s.frames[0].positions[3 * i + 2], jiggle[3 * i + 2] - (c + 1)));
      assert.ok(close(s.frames[1].positions[3 * i + 2], jiggle[3 * i + 2] - c));
    }
    assert.throws(() => contiguousShifts(s, 2, { cut: findVacuumGap(s) }), /^TypeError: contiguousShifts: pass a cut from/);
  });

  test('nothing moves without a cut or along a non-periodic axis', () => {
    const s = fcc111();
    assert.ok(contiguousShifts(s, 2) instanceof Int32Array);
    assert.equal(makeContiguous(s, 0), 0);
    const g = new Structure({ symbols: ['C', 'C'], positions: [[0, 0, 0], [0, 1.42, 15]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 15]], pbc: [true, true, false] });
    assert.equal(makeContiguous(g, 2, { cut: 0 }), 0);
  });
});

describe('arguments', () => {
  test('unwrapAlongGap: numbers, arrays and the cut forms', () => {
    assert.ok(close(unwrapAlongGap(0.9, { lo: -0.4 }), -0.1));
    assert.equal(unwrapAlongGap(0.9, null), 0.9);
    const out = unwrapAlongGap([0.1, 0.9, -0.3, 1.2], 0.25);
    assert.ok(out instanceof Float64Array);
    assert.ok([1.1, 0.9, 0.7, 1.2].every((v, i) => close(out[i], v, 1e-12)));
    const f = Float64Array.from([0.1, 0.9]);
    const same = unwrapAlongGap(f, { lo: -0.5, periodic: false });
    assert.ok(same !== f && same[1] === 0.9);
    for (const bad of [{ axis: 2, start: 0.3 }, '0.3', true, Infinity, { lo: null }]) {
      assert.throws(() => unwrapAlongGap([0.1], bad), (e) => e instanceof TypeError
        && e.message === 'unwrapAlongGap: pass a cut from gapCut() or findSurfaceGap(), a window start, or null');
    }
    assert.throws(() => unwrapAlongGap('0.1', 0), TypeError);
  });

  test('axis, minWidth and exclude errors', () => {
    const s = fcc111();
    for (const bad of [3, -1, 1.5, 'c', true]) {
      assert.throws(() => findVacuumGap(s, bad), (e) => e instanceof RangeError && e.message.startsWith('axis must be 0, 1, 2 or None (got '));
      assert.throws(() => gapCut(s, bad), (e) => e instanceof RangeError && e.message.startsWith('axis must be 0, 1 or 2 (got '));
    }
    assert.throws(() => axisGaps(s), /axis must be 0, 1 or 2 \(got undefined\)/);
    assert.throws(() => findVacuumGap(s, null, { minWidth: -1 }), /^Error: minWidth must be a non-negative number \(got -1\)$/);
    assert.throws(() => gapCut(s, 2, { exclude: [36] }), (e) => e instanceof RangeError && e.message === 'exclude: atom index 36 out of range (structure has 36 atoms)');
    assert.throws(() => gapCut(s, 2, { exclude: [true] }), /^Error: exclude: a boolean mask needs 36 values \(got 1\)$/);
    assert.throws(() => gapCut(s, 2, { exclude: [true, 1] }), (e) => e instanceof TypeError && e.message === 'exclude: atom indices must be integers (got true)');
    for (const bad of ['abc', 5, { a: 1 }]) {
      assert.throws(() => gapCut(s, 2, { exclude: bad }), (e) => e instanceof TypeError && e.message === 'exclude must be a list of atom indices or a boolean mask');
    }
  });

  test('a NaN or infinite coordinate throws instead of looping forever', () => {
    const NOT_FINITE = /^Error: positions must be finite numbers$/;
    // two atoms, one of them NaN: along a only one fractional coordinate is finite (the case that never returned)
    const two = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 1]], cell: [[5, 0, 0], [0, 5, 0], [0, 0, 20]] });
    two.positions[0] = NaN;
    two.touch();
    assert.throws(() => findVacuumGap(two, 0), NOT_FINITE);
    assert.throws(() => findVacuumGap(two), NOT_FINITE);
    assert.throws(() => findVacuumGaps(two), NOT_FINITE);
    assert.throws(() => findVacuumGap(two, 2, { minWidth: 0 }), NOT_FINITE);   // NaN · 0 is NaN: every axis of that atom
    const one = new Structure({ symbols: ['H'], positions: [[0, 0, 0]], cell: [[5, 0, 0], [0, 5, 0], [0, 0, 20]] });
    one.positions[2] = Infinity;
    one.touch();
    for (const fn of [() => findVacuumGap(one, 2), () => findVacuumGaps(one), () => gapCut(one, 2), () => axisGaps(one, 2),
      () => surfaceNormal(one), () => displayCuts(one), () => vacuumGapHint(one)]) assert.throws(fn, NOT_FINITE);
    // an excluded atom does not count, and a repaired coordinate works again after touch()
    const s = fcc111();
    s.positions[2] = NaN;
    s.touch();
    assert.throws(() => gapCut(s, 2), NOT_FINITE);
    assert.ok(gapCut(s, 2, { exclude: [0] }));
    s.positions[2] = 0;
    s.touch();
    assert.ok(close(findVacuumGap(s).width, 15, 1e-9));
  });

  test('the read-only functions leave the structure alone', () => {
    const s = withCO(4, { vac: 10 });
    s.info.surface = { axis: 2 };
    const before = JSON.stringify(s.toJSON({ precision: 17 }));
    for (let k = 0; k < 3; k++) { axisGaps(s, k); gapCut(s, k, { hint: true }); findVacuumGap(s, k, { minWidth: 0 }); contiguousShifts(s, k); }
    findVacuumGaps(s, { periodicOnly: false }); displayCuts(s); surfaceNormal(s, { exclude: [16, 17] }); findSurfaceGap(s);
    vacuumAxis(s); vacuumGapHint(s); requireGap(s);
    assert.equal(JSON.stringify(s.toJSON({ precision: 17 })), before);
  });

  test('the module exports what the ledger lists', () => {
    assert.deepEqual(Object.keys(vacuum).sort(), ['axisGaps', 'contiguousShifts', 'displayCuts', 'findSurfaceGap', 'findVacuumGap',
      'findVacuumGaps', 'gapCut', 'makeContiguous', 'requireGap', 'surfaceNormal', 'unwrapAlongGap', 'vacuumAxis', 'vacuumGapHint']);
  });
});

test('performance: three axes of a 10 000-atom slab', () => {
  const s = fcc111({ n: [25, 25], layers: 16 });
  assert.equal(s.length, 10000);
  const best = (fn) => { let b = Infinity; for (let r = 0; r < 3; r++) { const t0 = performance.now(); fn(); b = Math.min(b, performance.now() - t0); } return b; };
  const t1 = best(() => findVacuumGap(s, null, { minWidth: 0 }));
  const t2 = best(() => displayCuts(s));
  assert.ok(t1 < 45, `findVacuumGap ${t1.toFixed(1)} ms`);   // F0-D §7.6: 15 ms (x3 for slow machines)
  assert.ok(t2 < 45, `displayCuts ${t2.toFixed(1)} ms`);   // L-F0-16: 6 ms (x3, plus the first, uncached call)
});
