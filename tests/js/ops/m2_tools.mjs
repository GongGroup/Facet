// M2 (cleave and slab): the op `flipSlab` of the shared cases tests/data/surface/cleave/tools/flip.json. The Python
// half is tests/ops/m2_tools.py (its docstring says why setVacuum and standardizeSlab are not registered).
import { op } from '../cases.mjs';
import { flipSlab } from '../../../facet/web/js/build/surface.js';
import { slabResult } from './m2_analysis.mjs';

op('flipSlab', (inp, args) => {
  const unknown = Object.keys(args).sort();
  if (unknown.length) throw new Error(`flipSlab: unknown args ${unknown.join(', ')}`);
  return slabResult(flipSlab(inp.structure.clone()));
});
