// Timing budget of the exact minimum image (F0-D T9, ledger section 5.4), JS side; the Python side is
// tests/perf/test_geometry_perf.py. 10 000 micVector calls within 20 ms, times FACET_PERF_FACTOR (default 2), in
// a slab cell, a skewed bulk cell (the reduced-basis branch) and a tall p(1x1) slab cell, for all three axes and for
// a and b only. Not part of the default run (perf tests stay out of tests/js/*.test.mjs):
// node --test tests/perf/geometry.perf.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micVector } from '../../facet/web/js/core/geometry.js';

const FACTOR = Number(process.env.FACET_PERF_FACTOR) || 2;
const BUDGET_MS = 20;
const CELLS = {
  'Pt(111) p(3x3) slab': [[8.316, 0, 0], [4.158, 7.2019, 0], [0, 0, 21.79]],
  "fcc Pt, b' = b + 12a": [[3.92, 0, 0], [47.04, 3.92, 0], [0, 0, 3.92]],
  'p(1x1) slab, 40 Å': [[2.77, 0, 0], [1.385, 2.399, 0], [0, 0, 40.0]],
};

function bestMs(fn, runs = 7) {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

for (const [name, cell] of Object.entries(CELLS)) {
  for (const axes of [null, [0, 1]]) {
    test(`10 000 micVector calls within ${BUDGET_MS} ms (x${FACTOR}): ${name}, axes ${axes ?? 'all'}`, () => {
      let s = 1;
      const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
      const V = Array.from({ length: 10000 }, () => {
        const f = [2 * rand(), 2 * rand(), 2 * rand()];
        return [0, 1, 2].map((c) => f[0] * cell[0][c] + f[1] * cell[1][c] + f[2] * cell[2][c]);
      });
      const run = () => { for (const v of V) micVector(v, cell, [true, true, true], { axes }); };
      run();   // warm up the compiler
      const ms = bestMs(run);
      const limit = BUDGET_MS * FACTOR;
      assert.ok(ms <= limit, `micVector x 10 000, ${name}: ${ms.toFixed(2)} ms > ${limit} ms`);
    });
  }
}
