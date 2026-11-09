// Timing budget of the constraint flags core (F0-D §7.6), JS side; the Python side is tests/perf/test_constraints_perf.py.
// transformMoveFlags within 1 ms for 216 atoms and 15 ms for 10 000, and applyBasisChange (the same rule on a
// structure) within the same budget, times CRYSTALLUME_PERF_FACTOR (default 2). Not part of the default run (perf
// tests stay out of tests/js/*.test.mjs): node --test tests/perf/constraints.perf.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBasisChange, transformMoveFlags } from '../../crystallume/web/js/core/constraints.js';

const FACTOR = Number(process.env.CRYSTALLUME_PERF_FACTOR) || 2;
const ALL8 = Array.from({ length: 8 }, (_, k) => [!!(k & 1), !!(k & 2), !!(k & 4)]);
const TILTED = [[3, 0, 0], [0, 4, 0], [1.5, 0.8, 20]];
const ORTHO = [[3, 0, 0], [0, 4, 0], [0, 0, 20]];

function bestMs(fn, runs = 5) {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

for (const [natoms, budget] of [[216, 1], [10000, 15]]) {
  test(`change of basis on ${natoms} atoms within ${budget} ms (x${FACTOR})`, () => {
    const flags = Array.from({ length: natoms }, (_, i) => ALL8[(i * 7919) % 8]);
    const tTransform = bestMs(() => transformMoveFlags(flags, TILTED, ORTHO));
    const tApply = bestMs(() => applyBasisChange({ length: natoms, props: { selective_dynamics: flags }, info: {} }, TILTED, ORTHO));
    const limit = budget * FACTOR;
    assert.ok(tTransform <= limit, `transformMoveFlags on ${natoms} atoms: ${tTransform.toFixed(2)} ms > ${limit} ms`);
    assert.ok(tApply <= limit, `applyBasisChange on ${natoms} atoms: ${tApply.toFixed(2)} ms > ${limit} ms`);
  });
}
