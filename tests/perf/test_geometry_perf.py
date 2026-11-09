"""Timing budget of the exact minimum image (F0-D T9, ledger section 5.4), Python side; the JS side is
``tests/perf/geometry.perf.mjs``.

``minimum_image_vectors`` on 10 000 vectors within 10 ms, times ``CRYSTALLUME_PERF_FACTOR`` (default 2), in a slab
cell, a skewed bulk cell (the reduced-basis branch) and a tall p(1x1) slab cell, for all three axes and for a and b
only.  Marked ``slow``, so the default run leaves it out: ``pytest -m slow tests/perf/test_geometry_perf.py``.
"""

from __future__ import annotations

import os
import time

import numpy as np
import pytest

from crystallume.analysis.geometry import mic_vector, minimum_image_vectors

pytestmark = pytest.mark.slow

FACTOR = float(os.environ.get("CRYSTALLUME_PERF_FACTOR") or 2)
BUDGET_MS = 10.0
CELLS = {
    "Pt(111) p(3x3) slab": [[8.316, 0, 0], [4.158, 7.2019, 0], [0, 0, 21.79]],
    "fcc Pt, b' = b + 12a": [[3.92, 0, 0], [47.04, 3.92, 0], [0, 0, 3.92]],
    "p(1x1) slab, 40 A": [[2.77, 0, 0], [1.385, 2.399, 0], [0, 0, 40.0]],
}


def best_ms(fn, runs: int = 7) -> float:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        out.append(time.perf_counter() - t0)
    return min(out) * 1e3


@pytest.mark.parametrize("name", sorted(CELLS))
@pytest.mark.parametrize("axes", [None, (0, 1)])
def test_ten_thousand_vectors(name, axes):
    cell = np.array(CELLS[name], float)
    V = (np.random.default_rng(1).random((10000, 3)) - 0.5) @ (cell * 2)
    W = minimum_image_vectors(V, cell, (True, True, True), axes=axes)
    for i in range(0, 10000, 997):                                    # the fast path is the vector-by-vector rule
        assert np.array_equal(W[i], mic_vector(V[i], cell, (True, True, True), axes=axes)[0])
    ms = best_ms(lambda: minimum_image_vectors(V, cell, (True, True, True), axes=axes))
    limit = BUDGET_MS * FACTOR
    assert ms <= limit, f"minimum_image_vectors, 10 000 vectors, {name}, axes {axes}: {ms:.2f} ms > {limit:g} ms"
