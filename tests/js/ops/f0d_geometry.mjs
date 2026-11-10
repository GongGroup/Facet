// F0-D T9 (geometry): the JS half of the op in tests/ops/f0d_geometry.py (see its docstring), for the shared cases in
// tests/data/geometry/mic.json, with the same argument errors.
import { op } from '../cases.mjs';
import { micVector } from '../../../facet/web/js/core/geometry.js';

const ARGS = ['axes', 'cell', 'pbc', 'v', 'vectors'];

op('micVector', (inp, args) => {
  const unknown = Object.keys(args).filter((k) => !ARGS.includes(k)).sort();
  if (unknown.length) throw new Error(`micVector: unknown args ${unknown.join(', ')}`);
  if (('v' in args) === ('vectors' in args)) throw new Error('micVector: give exactly one of v or vectors');
  const { cell, pbc = [true, true, true], axes = null } = args;
  if ('v' in args) {
    const { vector, image } = micVector(args.v, cell, pbc, { axes });
    return { vector, image };
  }
  const found = args.vectors.map((v) => micVector(v, cell, pbc, { axes }));
  return { vectors: found.map((r) => r.vector), images: found.map((r) => r.image) };
});
