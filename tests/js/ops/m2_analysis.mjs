// M2 (cleave and slab): the ops `terminations` and `surface` of the shared cases under tests/data/surface/cleave/
// (its README documents the contracts). The Python half is tests/ops/m2_analysis.py.
//
// - terminations: surfaceAnalysis(bulk, { miller, ... }). The result (toJSON()) is flattened from the top (mesh.a,
//   terminations.0.label, ...), plus terminationCount, labels, brokenBonds, polar (per termination) and the views that
//   do not depend on where the ring of one period starts: stack, gapsBelow and topIndices.
// - surface: buildSurface(bulk, { miller, vacuum, ... }). Returns the slab as `structure` (its info.warnings are the
//   case's warnings), info.surface flattened under `surface`, zRange, volume and minDistance.
//
// `keepMolecules` (an optional feature of the design that is not implemented) throws.
import { op } from '../cases.mjs';
import { buildSurface, loadOxidationStates, surfaceAnalysis } from '../../../facet/web/js/build/surface.js';

const TERMINATION_ARGS = ['miller', 'millerBasis', 'primitive', 'translationTolerance', 'layerTolerance', 'charges', 'keepMolecules'];
const SURFACE_ARGS = ['miller', 'vacuum', 'layers', 'periods', 'thickness', 'termination', 'cut', 'symmetric', 'position', 'offset',
  'supercell', 'primitive', 'millerBasis', 'translationTolerance', 'fixBottom', 'fixMiddle', 'fixAxes', 'layerTolerance', 'charges',
  'keepMolecules', 'name'];

/** Every node of a JSON tree under its dotted path: `p` maps to the node and `p.k` to its children. */
export function flatten(prefix, value, out) {
  if (prefix) out[prefix] = value;
  if (Array.isArray(value)) value.forEach((v, i) => flatten(prefix ? `${prefix}.${i}` : String(i), v, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(prefix ? `${prefix}.${k}` : k, v, out);
  return out;
}

function options(args, allowed, name) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  const { keepMolecules = false, ...rest } = args;
  if (keepMolecules) throw new Error(`${name}: keep_molecules is not implemented`);
  return rest;
}

const mod = (a, m) => ((a % m) + m) % m;

op('terminations', async (inp, args) => {
  await loadOxidationStates();
  const d = surfaceAnalysis(inp.structure, options(args, TERMINATION_ARGS, 'terminations')).toJSON();
  const out = flatten('', d, {});
  const m = d.layersPerPeriod;
  const { terminations: terms, layers, cuts } = d;
  const p0 = cuts[terms[0].cut].layer;
  const ring = Array.from({ length: m }, (_, j) => j);
  return Object.assign(out, {
    terminationCount: terms.length,
    labels: terms.map((t) => t.label),
    brokenBonds: terms.map((t) => t.brokenBonds),
    polar: terms.map((t) => t.polar),
    stack: ring.map((j) => layers[mod(p0 - j, m)].composition),
    gapsBelow: ring.map((j) => layers[mod(p0 - j - 1, m)].gapAbove),
    topIndices: terms.map((t) => t.cuts.map((c) => mod(p0 - cuts[c].layer, m)).sort((a, b) => a - b)),
  });
});

/** The shortest distance between two atoms of the periodic structure (images along the periodic axes only). */
export function minDistance(s) {
  const p = s.positions, cell = s.cell, n = s.length;
  const range = (on) => (on ? [-2, -1, 0, 1, 2] : [0]);
  let best = Infinity;
  for (const i of range(s.pbc[0])) for (const j of range(s.pbc[1])) for (const k of range(s.pbc[2])) {
    const sx = i * cell[0][0] + j * cell[1][0] + k * cell[2][0];
    const sy = i * cell[0][1] + j * cell[1][1] + k * cell[2][1];
    const sz = i * cell[0][2] + j * cell[1][2] + k * cell[2][2];
    const origin = i === 0 && j === 0 && k === 0;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (origin && a === b) continue;
        const d = Math.hypot(p[3 * b] + sx - p[3 * a], p[3 * b + 1] + sy - p[3 * a + 1], p[3 * b + 2] + sz - p[3 * a + 2]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** What the slab ops return for a structure (README, "surface, setVacuum, flipSlab, standardizeSlab"). */
export function slabResult(s) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.length; i++) { const z = s.positions[3 * i + 2]; lo = Math.min(lo, z); hi = Math.max(hi, z); }
  const c = s.cell;
  const det = c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]);
  const out = { structure: s, zRange: [lo, hi], volume: Math.abs(det), minDistance: minDistance(s) };
  flatten('surface', s.info.surface ?? null, out);
  return out;
}

op('surface', async (inp, args) => {
  await loadOxidationStates();
  return slabResult(buildSurface(inp.structure, options(args, SURFACE_ARGS, 'surface')));
});
