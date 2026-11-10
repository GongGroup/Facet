// F0-A T7a (lattice directions): JS halves of the ops in tests/ops/f0a_lattice.py (see its docstring), for the shared
// cases in tests/data/surface/directions.json, with the same argument errors.
import { op } from '../cases.mjs';
import * as lattice from '../../../facet/web/js/core/lattice.js';

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

function oneOf(args, name, keys) {
  const given = keys.filter((k) => k in args);
  if (given.length !== 1) throw new Error(`${name}: give exactly one of ${keys.join(' or ')}`);
  return given[0];
}

op('reciprocalCell', (inp, args) => {
  take(args, 'reciprocalCell', ['cell'], ['cell']);
  return { value: lattice.reciprocalCell(args.cell) };
});

op('millerNormal', (inp, args) => {
  const name = 'millerNormal';
  take(args, name, ['cell', 'hkl', 'hkil'], ['cell']);
  const hkl = oneOf(args, name, ['hkl', 'hkil']) === 'hkl' ? args.hkl : lattice.hkilToHkl(args.hkil);
  return { value: lattice.millerNormal(args.cell, hkl) };
});

op('latticeDirection', (inp, args) => {
  const name = 'latticeDirection';
  take(args, name, ['cell', 'uvw', 'uvtw'], ['cell']);
  const uvw = oneOf(args, name, ['uvw', 'uvtw']) === 'uvw' ? args.uvw : lattice.uvtwToUvw(args.uvtw);
  return { value: lattice.latticeDirection(args.cell, uvw) };
});

op('isHexagonalCell', (inp, args) => {
  take(args, 'isHexagonalCell', ['cell', 'lengthTol', 'angleTol'], ['cell']);
  return { value: lattice.isHexagonalCell(args.cell, { lengthTol: args.lengthTol, angleTol: args.angleTol }) };
});

op('hklToHkil', (inp, args) => {
  take(args, 'hklToHkil', ['hkl'], ['hkl']);
  return { value: lattice.hklToHkil(args.hkl) };
});

op('hkilToHkl', (inp, args) => {
  take(args, 'hkilToHkl', ['hkil'], ['hkil']);
  return { value: lattice.hkilToHkl(args.hkil) };
});

op('uvwToUvtw', (inp, args) => {
  take(args, 'uvwToUvtw', ['uvw', 'integer'], ['uvw']);
  return { value: lattice.uvwToUvtw(args.uvw, { integer: args.integer ?? false }) };
});

op('uvtwToUvw', (inp, args) => {
  take(args, 'uvtwToUvw', ['uvtw'], ['uvtw']);
  return { value: lattice.uvtwToUvw(args.uvtw) };
});

op('centeredCellHint', (inp, args) => {
  take(args, 'centeredCellHint', ['cell'], ['cell']);
  return { value: lattice.centeredCellHint(args.cell) };
});

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const length = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A row of the table in F0-A §3.14.4 (see tests/ops/f0a_lattice.py). */
op('primitiveMiller', (inp, args) => {
  take(args, 'primitiveMiller', ['cell', 'hkl'], ['cell', 'hkl']);
  const { cell, hkl } = args;
  const normal = lattice.millerNormal(cell, hkl);
  const r = lattice.reciprocalCell(cell);
  const g = [0, 1, 2].map((x) => hkl[0] * r[0][x] + hkl[1] * r[1][x] + hkl[2] * r[2][x]);
  const out = { normal, spacing: 1 / length(g), kind: null, conventional: null, angle: null };
  const hint = lattice.centeredCellHint(cell);
  if (hint) {
    const q = hint.toConventional;
    const qh = [0, 1, 2].map((i) => q[i][0] * hkl[0] + q[i][1] * hkl[1] + q[i][2] * hkl[2]);
    const div = gcd(gcd(Math.abs(qh[0]), Math.abs(qh[1])), Math.abs(qh[2]));
    const conventionalCell = [0, 1, 2].map((i) => [0, 1, 2].map((x) => q[i][0] * cell[0][x] + q[i][1] * cell[1][x] + q[i][2] * cell[2][x]));
    const same = lattice.millerNormal(conventionalCell, hkl);
    const dot = normal[0] * same[0] + normal[1] * same[1] + normal[2] * same[2];
    Object.assign(out, {
      kind: hint.kind,
      conventional: qh.map((x) => x / div + 0),
      angle: Math.atan2(length(cross(normal, same)), Math.abs(dot)) * 180 / Math.PI,
    });
  }
  return out;
});
