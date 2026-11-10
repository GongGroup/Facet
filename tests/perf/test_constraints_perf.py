"""Timing budget of the constraint flags core (F0-D §7.6), Python side; the JS side is ``tests/perf/constraints.perf.mjs``.

``transform_move_flags`` within 1 ms for 216 atoms and 15 ms for 10 000, and ``apply_basis_change`` (the same rule on a
structure) within the same budget, times ``FACET_PERF_FACTOR`` (default 2).  Marked ``slow``, so the default run
leaves it out: ``pytest -m slow tests/perf/test_constraints_perf.py``.
"""

from __future__ import annotations

import itertools
import os
import time

import numpy as np
import pytest

from facet import Structure
from facet.core.constraints import apply_basis_change, transform_move_flags

pytestmark = pytest.mark.slow

FACTOR = float(os.environ.get("FACET_PERF_FACTOR") or 2)
ALL8 = [list(p) for p in itertools.product((True, False), repeat=3)]
TILTED = np.array([[3.0, 0, 0], [0, 4.0, 0], [1.5, 0.8, 20.0]])
ORTHO = np.diag([3.0, 4.0, 20.0])


def best_ms(fn, runs: int = 5) -> float:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        out.append(time.perf_counter() - t0)
    return min(out) * 1e3


@pytest.mark.parametrize("natoms, budget_ms", [(216, 1.0), (10000, 15.0)])
def test_change_of_basis_budget(natoms, budget_ms):
    rng = np.random.default_rng(3)
    flags = [ALL8[k] for k in rng.integers(0, 8, size=natoms)]
    s = Structure(["Pt"] * natoms, np.zeros((natoms, 3)), cell=TILTED, props={"selective_dynamics": flags})
    t_transform = best_ms(lambda: transform_move_flags(flags, TILTED, ORTHO))
    copies = [s.copy() for _ in range(5)]
    t_apply = best_ms(lambda: apply_basis_change(copies.pop(), TILTED, ORTHO))
    limit = budget_ms * FACTOR
    assert t_transform <= limit, f"transform_move_flags on {natoms} atoms: {t_transform:.2f} ms > {limit:g} ms"
    assert t_apply <= limit, f"apply_basis_change on {natoms} atoms: {t_apply:.2f} ms > {limit:g} ms"
