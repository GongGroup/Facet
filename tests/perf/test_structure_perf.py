"""Timing budget of the structure data core (F0-D §7.6, M7 §7.5), Python side.

``_remap`` and ``repeat`` within 5 ms for 216 atoms and 80 ms for 10 000, times ``CRYSTALLUME_PERF_FACTOR``
(default 2).  ``_remap`` is measured as a permutation and as the ``extend`` of a structure whose ``poscar_species``
column lacks the new element (the default of each new atom once scanned that column, O(n·m)), and the ``from_dict``
padding of that column gets the same budget.  Marked ``slow``, so the default run leaves it out:
``pytest -m slow tests/perf/test_structure_perf.py``.
"""

from __future__ import annotations

import os
import time

import numpy as np
import pytest

from crystallume import Structure, build

pytestmark = pytest.mark.slow

FACTOR = float(os.environ.get("CRYSTALLUME_PERF_FACTOR") or 2)
BUDGET_MS = {216: 5.0, 10000: 80.0}


def best_ms(fn, setup, runs: int = 5) -> float:
    out = []
    for _ in range(runs):
        arg = setup()
        t0 = time.perf_counter()
        fn(arg)
        out.append(time.perf_counter() - t0)
    return min(out) * 1e3


def slab(n: int) -> Structure:
    """*n* Pt atoms with the columns of a relaxed CONTCAR: flags, two POSCAR blocks, tags and velocities."""
    rng = np.random.default_rng(1)
    flags = [[bool(a), bool(b), bool(c)] for a, b, c in rng.integers(0, 2, size=(n, 3))]
    return Structure(["Pt"] * n, rng.random((n, 3)) * 30, cell=np.eye(3) * 30,
                     props={"selective_dynamics": flags, "poscar_species": (["Pt", "Pt#2"] * n)[:n],
                            "tags": [1] * n, "velocities": [[0.0, 0.0, 0.0]] * n})


def check(what: str, natoms: int, ms: float) -> None:
    limit = BUDGET_MS[natoms] * FACTOR
    assert ms <= limit, f"{what} on {natoms} atoms: {ms:.2f} ms > {limit:g} ms"


@pytest.mark.parametrize("natoms", [216, 10000])
def test_remap_budget(natoms):
    base = slab(natoms)
    reverse = np.arange(natoms)[::-1].copy()
    check("_remap (a permutation)", natoms, best_ms(lambda s: s._remap(reverse), base.copy))
    half = slab(natoms // 2)
    oxygen = Structure(["O"] * (natoms - natoms // 2), np.ones((natoms - natoms // 2, 3)))
    check("extend (new atoms of an element without a POSCAR block)", natoms,
          best_ms(lambda s: s.extend(oxygen), half.copy))


@pytest.mark.parametrize("natoms, reps", [(216, (3, 3, 6)), (10000, (10, 10, 25))])
def test_repeat_budget(natoms, reps):
    cu = build.crystal("fcc", "Cu", a=3.61)
    cu.set_prop("selective_dynamics", [[True, True, False]] * len(cu))
    assert len(cu) * int(np.prod(reps)) == natoms
    check("repeat", natoms, best_ms(lambda s: s.repeat(*reps), lambda: cu))


@pytest.mark.parametrize("natoms", [216, 10000])
def test_from_dict_padding_budget(natoms):
    half = natoms // 2
    doc = slab(natoms).to_dict()
    doc["symbols"] = ["Pt"] * half + ["O"] * (natoms - half)
    doc["props"]["poscar_species"] = doc["props"]["poscar_species"][:half]   # no values (and no block) for the O
    check("from_dict (padding poscar_species)", natoms, best_ms(Structure.from_dict, lambda: doc))
