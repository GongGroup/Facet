// The U1 display rule (F0-A §3.8.2–3.8.4, ledger L-F0-43): along a periodic axis with a vacuum-gap cut the atoms are
// wrapped into the cut's window and get no boundary copies; adsorbate groups move together (B10); model.home,
// storedImage and drawnCopies tie the drawn copies to the stored positions; the smart-bond rule (L-F0-55).
// Run: node --test tests/js/display_cuts.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../facet/web/js/core/structure.js';
import { inv3, cartToFrac } from '../../facet/web/js/core/util.js';
import { findPeriodicNeighbors } from '../../facet/web/js/core/bonds.js';
import { METALS, ANIONS } from '../../facet/web/js/core/elements.js';
import { buildCrystal } from '../../facet/web/js/build/crystal.js';
import { parseStructure } from '../../facet/web/js/io/index.js';
import { makeScene } from '../../facet/web/js/render/settings.js';
import {
  buildDisplayModel, estimateDisplayCount, homeOffsets, storedImage, refOf, drawnCopies, smartBondFilter,
  smartPairDefault, disabledPairsFor, anionBondedMetals,
} from '../../facet/web/js/render/display.js';
import { repoPath } from './helpers.mjs';

const DISPLAY = makeScene().display;
const disp = (patch = {}) => ({ ...DISPLAY, ...patch, bonds: { ...DISPLAY.bonds, ...(patch.bonds ?? {}) } });
const A_PT = 3.92, D_LAYER = A_PT / Math.sqrt(3);

/** Pt(111) slab on the 120° mesh (bottom layer at z0, wrapped into [0, c)); extra atoms [symbol, [x, y, z above z0]]. */
function pt111({ z0 = 0, L = 4, nx = 2, vac = 15, pbc = [true, true, true], extra = [], props = undefined } = {}) {
  const d = A_PT / Math.SQRT2;
  const A = [nx * d, 0, 0], B = [-nx * d / 2, nx * d * Math.sqrt(3) / 2, 0];
  const c = (L - 1) * D_LAYER + vac;
  const sh = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]], symbols = [], positions = [];
  const put = (sym, x, y, z) => { let w = z + z0; w -= Math.floor(w / c) * c; symbols.push(sym); positions.push([x, y, w]); };
  for (let l = 0; l < L; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
    const u = (i + sh[l % 3][0]) / nx, v = (j + sh[l % 3][1]) / nx;
    put('Pt', u * A[0] + v * B[0], u * A[1] + v * B[1], l * D_LAYER);
  }
  for (const [sym, p] of extra) put(sym, p[0], p[1], p[2]);
  return new Structure({ name: 'Pt(111)', symbols, positions, cell: [A, B, [0, 0, c]], pbc, props });
}
/** Upright CO on the top site of the first top-layer atom, C at hC above the top layer. */
function withCO(hC, opts = {}) {
  const L = opts.L ?? 4, nx = opts.nx ?? 2, top = (L - 1) * D_LAYER;
  const p = pt111(opts).pos((L - 1) * nx * nx);
  return pt111({ ...opts, extra: [['C', [p[0], p[1], top + hC]], ['O', [p[0], p[1], top + hC + 1.15]]] });
}
const contcar = () => parseStructure(readFileSync(repoPath('tests/data/surface/contcar_pt111.vasp'), 'utf8'), 'CONTCAR');
const zRange = (m, pick = () => true) => {
  let lo = Infinity, hi = -Infinity;
  for (let d = 0; d < m.n; d++) if (pick(m.src[d])) { lo = Math.min(lo, m.positions[3 * d + 2]); hi = Math.max(hi, m.positions[3 * d + 2]); }
  return [lo, hi];
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** The rule written out once more: home, boundary bits and drawn count from given window starts (null: [0, 1) + copies). */
function expected(s, lo) {
  const inv = inv3(s.cell), n = s.length, home = new Int32Array(3 * n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const f = cartToFrac(s.pos(i), inv);
    let span = 1;
    for (let k = 0; k < 3; k++) {
      if (!s.pbc[k]) continue;
      if (lo[k] != null) { home[3 * i + k] = -Math.floor(f[k] - lo[k]); continue; }
      let w = f[k] - Math.floor(f[k]);
      if (w > 1 - 1e-6) w = 0;
      home[3 * i + k] = Math.round(w - f[k]);
      if (w < 1e-3) span *= 2;
    }
    count += span;
  }
  return { home, count };
}

/** Every drawn copy sits at its stored position plus storedImage whole cells (Float32 drawing). */
function assertCopiesStored(s, m, tol = 2e-4) {
  for (let d = 0; d < m.n; d++) {
    const i = m.src[d], I = storedImage(m, d), p = s.pos(i), c = s.cell;
    for (let k = 0; k < 3; k++) {
      const want = p[k] + I[0] * c[0][k] + I[1] * c[1][k] + I[2] * c[2][k];
      assert.ok(near(m.positions[3 * d + k], want, tol), `copy ${d} of atom ${i}: ${m.positions[3 * d + k]} vs ${want}`);
    }
  }
}

describe('the U1 cut on tests/data/surface/gaps.json', () => {
  const doc = JSON.parse(readFileSync(repoPath('tests/data/surface/gaps.json'), 'utf8'));
  for (const c of doc.cases) {
    test(`${c.id}: windows, home offsets and drawn count`, () => {
      const s = Structure.fromJSON(c.input.structure);
      const m = buildDisplayModel(s, DISPLAY, {});
      const lo = [0, 1, 2].map((k) => (s.pbc[k] && c.expect.cuts[k] ? c.expect.cuts[k].lo : null));
      // the display uses the cut of the shared module on the periodic axes only, no other
      for (let k = 0; k < 3; k++) {
        if (lo[k] == null) { assert.equal(m.cuts[k], null, `axis ${k}`); assert.equal(m.wrapRule.lo[k], null); continue; }
        assert.ok(near(m.cuts[k].lo, lo[k], 1e-9), `axis ${k}: lo ${m.cuts[k].lo} vs ${lo[k]}`);
        assert.equal(m.cuts[k].rule, c.expect.cuts[k].rule);
        assert.equal(m.wrapRule.lo[k], m.cuts[k].lo);
      }
      const want = expected(s, lo);
      assert.deepEqual(Array.from(m.home), Array.from(want.home));
      assert.deepEqual(Array.from(homeOffsets(s, DISPLAY)), Array.from(want.home), 'homeOffsets = model.home');
      assert.equal(m.n, want.count, 'drawn atoms');
      assert.equal(estimateDisplayCount(s, [1, 1, 1], DISPLAY), m.n, 'estimateDisplayCount');
      // home copies: image 0,0,0 in the drawn block, inside the windows of the cut axes
      for (let i = 0; i < s.length; i++) {
        const d = m.homeIndex[i];
        assert.ok(d >= 0, `atom ${i} has a home copy`);
        assert.deepEqual([m.img[3 * d], m.img[3 * d + 1], m.img[3 * d + 2]], [0, 0, 0]);
      }
      assertCopiesStored(s, m);
    });
  }
});

describe('the U1 cut on slabs (F0-A §3.8.2 table)', () => {
  test('Pt(111) 2×2 4L at z = 0: 26 drawn atoms, no bottom layer above the vacuum; the old rule drew 35', () => {
    const s = pt111();
    const m = buildDisplayModel(s, DISPLAY, {});
    assert.equal(m.n, 26);
    const [lo, hi] = zRange(m);
    assert.ok(near(lo, 0, 1e-5) && near(hi, 3 * D_LAYER, 1e-4), `${lo}…${hi}`);
    assert.equal(m.cuts[2].rule, 'widest');
    assert.ok(near(m.cuts[2].width, 15, 1e-6));
    const old = buildDisplayModel(s, DISPLAY, { cuts: false });
    assert.equal(old.n, 35);
    assert.deepEqual(old.cuts, [null, null, null]);
    assert.ok(near(zRange(old)[1], s.cell[2][2], 1e-4), 'the old rule repeats the bottom layer on the top face');
  });

  test('pbc T T F: the non-periodic axis is never cut or wrapped', () => {
    const m = buildDisplayModel(pt111({ pbc: [true, true, false] }), DISPLAY, {});
    assert.equal(m.n, 26);
    assert.deepEqual(m.cuts, [null, null, null]);
  });

  test('a slab near the top face stays where it is (bottom layer at z = 14)', () => {
    const m = buildDisplayModel(pt111({ z0: 14 }), DISPLAY, {});
    const [lo, hi] = zRange(m);
    assert.ok(near(lo, 14, 1e-4) && near(hi, 14 + 3 * D_LAYER, 1e-4), `${lo}…${hi}`);
    assert.ok(Array.from(m.home).every((h) => h === 0));
  });

  test('a slab stored across the c face is drawn in one piece, moving the fewest atoms (bottom layer at z = 17)', () => {
    const s = pt111({ z0: 17 });   // layers at 17, 19.3, 21.5 and (wrapped) 2.0 Å
    assert.ok(s.pos(12)[2] < 3, 'the top layer is stored at the bottom of the cell');
    const m = buildDisplayModel(s, DISPLAY, {});
    const [lo, hi] = zRange(m);
    assert.ok(near(lo, 17, 1e-4) && near(hi, 17 + 3 * D_LAYER, 1e-4), `${lo}…${hi}`);
    for (let i = 0; i < 16; i++) assert.deepEqual(Array.from(m.home.subarray(3 * i, 3 * i + 3)), [0, 0, i >= 12 ? 1 : 0], `atom ${i}`);
    assertCopiesStored(s, m);
  });

  test('contcar_pt111.vasp: the bottom layer is drawn at the bottom, the slab in one piece, 50 atoms', () => {
    const s = contcar();
    const m = buildDisplayModel(s, DISPLAY, {});
    assert.equal(s.length, 36);
    assert.equal(m.n, 50, '36 atoms + 14 boundary copies along a and b');
    assert.equal(estimateDisplayCount(s, [1, 1, 1], DISPLAY), 50);
    assert.deepEqual([m.cuts[0], m.cuts[1]], [null, null]);
    assert.equal(m.cuts[2].rule, 'widest');
    const [lo, hi] = zRange(m);
    assert.ok(lo > -0.01 && lo < 0, `rows 4 and 8 (stored at 0.99999) are drawn just below z = 0: ${lo}`);
    assert.ok(near(hi, 3 * D_LAYER, 1e-3), `top layer ${hi}`);
    for (const i of [3, 7]) {
      assert.deepEqual(Array.from(m.home.subarray(3 * i, 3 * i + 3)), [0, 0, -1]);
      assert.ok(s.pos(i)[2] > 21, 'stored at the top of the cell');
    }
    assertCopiesStored(s, m);
  });

  test('CO in the vacuum: the slab stays put, CO drawn above it until it nearly touches the image of the bottom', () => {
    const slabZ = (m) => zRange(m, (i) => i < 16), molZ = (m) => zRange(m, (i) => i >= 16);
    for (const [vac, hC, rule, above] of [[15, 7, 'below-main', true], [15, 10, 'below-main', true], [10, 4, 'below-main', true], [10, 6, 'widest', false]]) {
      const m = buildDisplayModel(withCO(hC, { vac }), DISPLAY, {});
      const [s0, s1] = slabZ(m), [c0, c1] = molZ(m);
      assert.ok(near(s0, 0, 1e-5) && near(s1, 3 * D_LAYER, 1e-4), `vac ${vac} CO ${hC}: slab ${s0}…${s1}`);
      assert.equal(m.cuts[2].rule, rule, `vac ${vac} CO ${hC}`);
      assert.equal(above ? c0 > s1 : c1 < s0, true, `vac ${vac} CO ${hC}: CO ${c0}…${c1}`);
    }
  });

  test('single-layer graphene with pbc T T T stays at z = 0', () => {
    const a = 2.46;
    const s = new Structure({ symbols: ['C', 'C'], positions: [[0, 0, 0], [0, a / Math.sqrt(3), 0]], cell: [[a, 0, 0], [-a / 2, a * Math.sqrt(3) / 2, 0], [0, 0, 15]], pbc: [true, true, true] });
    const m = buildDisplayModel(s, DISPLAY, {});
    const [lo, hi] = zRange(m);
    assert.ok(lo === 0 && hi === 0, `${lo}…${hi}`);
  });

  test('display.wrap off: no cuts, atoms where they are stored, home all zero', () => {
    const s = pt111({ z0: 14 });
    const m = buildDisplayModel(s, disp({ wrap: false }), {});
    assert.equal(m.n, 16);
    assert.deepEqual(m.cuts, [null, null, null]);
    assert.deepEqual(m.wrapRule, { wrap: false, boundary: false, lo: [null, null, null] });
    assert.ok(Array.from(m.home).every((h) => h === 0));
    for (let d = 0; d < m.n; d++) assert.ok(near(m.positions[3 * d + 2], s.pos(m.src[d])[2], 1e-4));
  });

  test('a display supercell along c repeats the slab with the same cut in every image', () => {
    const s = pt111();
    const m = buildDisplayModel(s, disp({ supercell: [1, 1, 2] }), {});
    assert.equal(m.n, 52);
    const c = s.cell[2][2];
    const lower = zRange(m, () => true);
    assert.ok(near(lower[0], 0, 1e-5) && near(lower[1], c + 3 * D_LAYER, 1e-3), `${lower}`);
    let mid = 0;
    for (let d = 0; d < m.n; d++) { const z = m.positions[3 * d + 2]; if (z > 3 * D_LAYER + 0.1 && z < c - 0.1) mid++; }
    assert.equal(mid, 0, 'nothing drawn in the vacuum between the images');
    assert.equal(estimateDisplayCount(s, [1, 1, 2], DISPLAY), 52);
  });

  test('given cuts are used as they are (ghosts and drag previews keep the drawn model’s cut)', () => {
    const s = withCO(7, { vac: 15 });
    const own = buildDisplayModel(s, DISPLAY, {});
    const moved = withCO(9.5, { vac: 15 });   // its own cut would sit elsewhere
    const kept = buildDisplayModel(moved, DISPLAY, { cuts: own.cuts });
    assert.equal(kept.cuts[2], own.cuts[2]);
    assert.equal(kept.wrapRule.lo[2], own.cuts[2].lo);
    assert.deepEqual(Array.from(homeOffsets(moved, DISPLAY, { cuts: own.cuts })), Array.from(kept.home));
  });
});

describe('adsorbate groups (B10)', () => {
  // a CO lying flat above a Pt(111) 2×2 slab across the a face: C at fractional a = 0.97, O at 1.17 (stored outside)
  const top = 3 * D_LAYER;
  const slabWithCO = (aC, props) => {
    const s = pt111();
    const [A, B] = s.cell, at = (a, b, z) => [a * A[0] + b * B[0], a * A[1] + b * B[1], z];
    return pt111({ extra: [['C', at(aC, 0.5, top + 2)], ['O', at(aC + 0.2, 0.5, top + 2)]], props });
  };
  const fa = (s, m, i) => cartToFrac([m.positions[3 * m.homeIndex[i]], m.positions[3 * m.homeIndex[i] + 1], m.positions[3 * m.homeIndex[i] + 2]], inv3(s.cell))[0];
  test('without groups each atom wraps on its own: the molecule is drawn split across the cell', () => {
    const s = slabWithCO(0.97);
    const m = buildDisplayModel(s, DISPLAY, {});
    assert.ok(near(fa(s, m, 16), 0.97, 1e-5) && near(fa(s, m, 17), 0.17, 1e-5), `C ${fa(s, m, 16)}, O ${fa(s, m, 17)}`);
  });
  test('with adsorbate_id the group moves by the whole cells of its first atom: drawn in one piece, no boundary copies', () => {
    const ids = { adsorbate_id: [...Array(16).fill(0), 1, 1] };
    const s = slabWithCO(0.97, ids);
    const m = buildDisplayModel(s, DISPLAY, {});
    assert.ok(near(fa(s, m, 16), 0.97, 1e-5) && near(fa(s, m, 17), 1.17, 1e-5), `C ${fa(s, m, 16)}, O ${fa(s, m, 17)}`);
    assert.deepEqual(Array.from(m.home.subarray(48, 54)), [0, 0, 0, 0, 0, 0]);
    assert.equal(m.n, 26 + 2, 'group atoms get no boundary copies');
    assert.equal(estimateDisplayCount(s, [1, 1, 1], DISPLAY), m.n);
    assertCopiesStored(s, m);
    // the first atom stored outside the cell: the whole group moves back with it
    const s2 = slabWithCO(1.03, ids);
    const m2 = buildDisplayModel(s2, DISPLAY, {});
    assert.deepEqual(Array.from(m2.home.subarray(48, 54)), [-1, 0, 0, -1, 0, 0]);
    assert.deepEqual(Array.from(homeOffsets(s2, DISPLAY)), Array.from(m2.home));
    assert.ok(near(fa(s2, m2, 17) - fa(s2, m2, 16), 0.2, 1e-5));
  });
});

describe('drawn ↔ stored', () => {
  test('refOf and storedImage name each drawn copy by its stored image; model.refs maps them back', () => {
    const s = contcar();
    const m = buildDisplayModel(s, disp({ supercell: [2, 2, 1], completeBonds: true }), {});
    const seen = new Set();
    for (let d = 0; d < m.n; d++) {
      const ref = refOf(m, d), I = storedImage(m, d);
      assert.equal(ref, `${m.src[d]}:${I.join(',')}`);
      assert.ok(!seen.has(ref), 'unique');
      seen.add(ref);
      assert.equal(m.refs.get(ref), d);
    }
    assertCopiesStored(s, m);
  });

  test('drawnCopies places points as the atoms are drawn (the cut, the boundary copies, the supercell)', () => {
    for (const s of [contcar(), pt111({ z0: 14 }), withCO(7)]) {
      const m = buildDisplayModel(s, disp({ supercell: [2, 1, 1] }), {});
      const pts = Array.from({ length: s.length }, (_, i) => s.pos(i));
      const c = drawnCopies(pts, m);
      assert.equal(c.index.length, m.n);
      const key = (src, a, b, cc) => `${src}:${a},${b},${cc}`;
      const want = new Map();
      for (let d = 0; d < m.n; d++) { const I = storedImage(m, d); want.set(key(m.src[d], ...I), d); }
      for (let q = 0; q < c.index.length; q++) {
        const d = want.get(key(c.index[q], c.img[3 * q], c.img[3 * q + 1], c.img[3 * q + 2]));
        assert.ok(d !== undefined, `copy ${q}`);
        for (let k = 0; k < 3; k++) assert.ok(near(c.positions[3 * q + k], m.positions[3 * d + k], 1e-4));
      }
      const once = drawnCopies(pts.flat(), m, { repeat: false });
      assert.ok(once.index.length < c.index.length, 'repeat: false draws one block');
    }
  });

  test('drawnCopies without a periodic model returns the points as they are', () => {
    const m = buildDisplayModel(new Structure({ symbols: ['O'], positions: [[0, 0, 0]] }), DISPLAY, {});
    const c = drawnCopies([[1, 2, 3]], m);
    assert.deepEqual(Array.from(c.positions), [1, 2, 3]);
    assert.deepEqual(Array.from(c.index), [0]);
    assert.throws(() => drawnCopies([1, 2], m), TypeError);
  });
});

describe('smart bonds (L-F0-55)', () => {
  const ptPt = (m) => {
    let n = 0;
    for (let b = 0; b < m.bonds.count; b++) if (m.symbols[m.bonds.pairs[2 * b]] === 'Pt' && m.symbols[m.bonds.pairs[2 * b + 1]] === 'Pt') n++;
    return n;
  };
  test('CO on a Pt slab keeps every Pt–Pt bond (the old rule dropped them all)', () => {
    const clean = buildDisplayModel(pt111({ nx: 3 }), DISPLAY, {});
    const co = buildDisplayModel(withCO(1.85, { nx: 3 }), DISPLAY, {});
    assert.ok(ptPt(clean) > 0);
    assert.equal(ptPt(co), ptPt(clean));
    assert.ok(co.bonds.count > clean.bonds.count, 'Pt–C and C–O are drawn too');
    assert.equal(smartPairDefault('Pt-Pt', ['Pt', 'C', 'O']), true);
  });

  test('two metal atoms that both bond to a non-metal lose their bond; an explicit tick keeps it; smart off keeps all', () => {
    // CO on every top-layer atom of a 2×2 slab: the top-layer Pt–Pt bonds go, the others stay
    const L = 4, nx = 2, top = (L - 1) * D_LAYER;
    const base = pt111({ nx });
    const extra = [];
    for (let t = 0; t < nx * nx; t++) { const p = base.pos((L - 1) * nx * nx + t); extra.push(['C', [p[0], p[1], top + 1.85]], ['O', [p[0], p[1], top + 3.0]]); }
    const s = pt111({ nx, extra });
    const full = buildDisplayModel(s, DISPLAY, {});
    const topPair = (m, b) => [m.bonds.pairs[2 * b], m.bonds.pairs[2 * b + 1]].every((d) => m.src[d] >= (L - 1) * nx * nx && m.src[d] < L * nx * nx);
    let topBonds = 0;
    for (let b = 0; b < full.bonds.count; b++) if (topPair(full, b)) topBonds++;
    assert.equal(topBonds, 0, 'no bond within the CO-covered top layer');
    assert.ok(ptPt(full) > 0, 'the lower layers keep theirs');
    const off = buildDisplayModel(s, disp({ bonds: { smart: false } }), {});
    const ticked = buildDisplayModel(s, disp({ bonds: { pairOverrides: { 'Pt-Pt': true } } }), {});
    assert.ok(ptPt(off) > ptPt(full));
    assert.equal(ptPt(ticked), ptPt(off));
    const unticked = buildDisplayModel(s, disp({ bonds: { pairOverrides: { 'Pt-Pt': false } } }), {});
    assert.equal(ptPt(unticked), 0);
  });

  test('an oxide shows no cation–cation contacts, also with completed coordination shells', () => {
    const s = buildCrystal('perovskite', { repeat: [2, 2, 2] });
    const m = buildDisplayModel(s, DISPLAY, {});
    const cc = (mm) => { let n = 0; for (let b = 0; b < mm.bonds.count; b++) { const x = mm.symbols[mm.bonds.pairs[2 * b]], y = mm.symbols[mm.bonds.pairs[2 * b + 1]]; if (METALS.has(x) && METALS.has(y)) n++; } return n; };
    assert.equal(cc(m), 0);
    assert.ok(cc(buildDisplayModel(s, disp({ bonds: { smart: false } }), {})) > 0, 'there are contacts to drop');
    // completed shells bring in only the images the per-element rule brought in before
    const shells = buildDisplayModel(s, disp({ completeBonds: true }), {});
    const before = buildDisplayModel(s, disp({ completeBonds: true, bonds: { smart: false, pairOverrides: { 'Sr-Sr': false, 'Sr-Ti': false, 'Ti-Ti': false } } }), {});
    assert.equal(shells.n, before.n);
    assert.equal(cc(shells), 0);
  });

  test('anionBondedMetals agrees with the periodic neighbour list, a tilted cell included', () => {
    const cases = [withCO(1.85, { nx: 3 }), buildCrystal('perovskite', { repeat: [2, 1, 1] }), buildCrystal('rocksalt', { elements: ['Na', 'Cl'] })];
    const tilted = withCO(2.0);
    tilted.cell = [tilted.cell[0], tilted.cell[1], [1.5, 0.7, tilted.cell[2][2]]];
    cases.push(tilted);
    for (const s of cases) {
      const want = new Uint8Array(s.length);
      const isAnion = (e) => ANIONS.has(e) && !METALS.has(e);
      for (const { i, j } of findPeriodicNeighbors(s.positions, s.symbols, s.cell, s.pbc, { tolerance: 1.15, maxLength: 4.5 })) {
        if (METALS.has(s.symbols[i]) && isAnion(s.symbols[j])) want[i] = 1;
        if (METALS.has(s.symbols[j]) && isAnion(s.symbols[i])) want[j] = 1;
      }
      assert.deepEqual(Array.from(anionBondedMetals(s)), Array.from(want), s.name);
    }
  });

  test('smartBondFilter returns the bonds unchanged when nothing goes; the analyses keep the per-element rule', () => {
    const m = buildDisplayModel(pt111(), DISPLAY, {});
    assert.equal(smartBondFilter(m.bonds, m, pt111(), DISPLAY.bonds), m.bonds);
    assert.deepEqual(disabledPairsFor(['Sr', 'Ti', 'O'], { smart: true, pairOverrides: { 'O-Sr': false } }), ['O-Sr', 'Sr-Sr', 'Sr-Ti', 'Ti-Ti']);
    assert.deepEqual(disabledPairsFor(['Sr', 'Ti', 'O'], { smart: false }), []);
    assert.deepEqual(disabledPairsFor(['Pt'], { smart: true }), []);
  });
});
