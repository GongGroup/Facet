"""Direct two-language comparisons through the Node bridge (``tests/js_bridge.run_js``; M7 section 7.3).

F0-D T9: the dihedral angle (IUPAC sign in both languages, also as the viewer and the selection card show it), the
element radii (covalent and Bondi, element by element), the exact minimum image (``mic_vector`` / ``micVector``:
the same images on random skewed cells) and the periodic neighbours of skewed cells (``neighbor_arrays`` /
``findPeriodicNeighbors``).  Each module's own comparisons go in ``tests/test_<module>_parity.py`` (plan P-02);
the shared golden cases run in both languages through ``tests/test_cases.py`` and ``tests/js/cases.test.mjs``.
Every test makes at most one Node call.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from facet import Structure
from facet.analysis.geometry import mic_vector, signed_angle
from facet.analysis.neighbors import neighbor_arrays
from facet.core.elements import bondi_radius, covalent_radius, elements

A_PT = 3.92
FCC = np.array([[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) * A_PT
TTT = [True, True, True]


def circular(a: float, b: float) -> float:
    """Difference of two angles in degrees, modulo 360."""
    d = (a - b) % 360.0
    return min(d, 360.0 - d)


# ------------------------------------------------------------------ dihedral angles
def test_dihedral_angles_agree_with_get_dihedral(js):
    """50 random sets of four points, the cis/trans pair of tests/test_structure.py, and dihedrals across cells."""
    rng = np.random.default_rng(2026)
    quads = [rng.normal(scale=2.0, size=(4, 3)).tolist() for _ in range(50)]
    quads += [[[1, 1, 0], [0, 0, 0], [0, 0, 1.5], [1, 1, 1.5]], [[1, 1, 0], [0, 0, 0], [0, 0, 1.5], [-1, -1, 1.5]]]
    cell = [[A_PT, 0, 0], [8 * A_PT, A_PT, 0], [0, 0, A_PT]]                     # dihedrals through the minimum image
    periodic = [(rng.random((4, 3)) @ np.array(cell)).tolist() for _ in range(10)]
    got = js("""
      const g = await web('core/geometry.js');
      const { measureValue } = await web('render/viewer.js');
      const { geometryValue } = await web('ui/selectioncard.js');
      const THREE = await repo('facet/web/vendor/three/three.module.js');
      const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
      const bonds = (P) => [sub(P[1], P[0]), sub(P[2], P[1]), sub(P[3], P[2])];
      const plain = input.quads.map((P) => [g.dihedralFromVectors(...bonds(P)), geometryValue(P),
        measureValue('dihedral', P.map((p) => new THREE.Vector3(...p)))]);
      const mic = input.periodic.map((P) => {
        const b = bonds(P).map((v) => g.micVector(v, input.cell, [true, true, true]).vector);
        return g.dihedralFromVectors(...b);
      });
      return { plain, mic };
    """, {"quads": quads, "periodic": periodic, "cell": cell})
    for P, (js_deg, card, viewer) in zip(quads, got["plain"]):
        py = Structure(["C"] * 4, P).get_dihedral(0, 1, 2, 3)
        assert 0.0 <= js_deg < 360.0
        assert circular(js_deg, py) < 1e-9, (P, js_deg, py)
        assert circular(card, signed_angle(py)) < 1e-9 and -180 < card <= 180
        assert circular(viewer, signed_angle(py)) < 1e-9 and -180 < viewer <= 180
    assert got["plain"][-2][0] == pytest.approx(0.0, abs=1e-9)     # cis
    assert got["plain"][-1][0] == pytest.approx(180.0, abs=1e-9)   # trans
    for P, js_deg in zip(periodic, got["mic"]):
        py = Structure(["C"] * 4, P, cell=cell, pbc=True).get_dihedral(0, 1, 2, 3, mic=True)
        assert circular(js_deg, py) < 1e-9


# ------------------------------------------------------------------ element radii
def test_element_radii_agree_element_by_element(js):
    symbols = [rec["symbol"] for rec in elements()] + ["X", "Zz"]
    got = js("""
      const e = await web('core/elements.js');
      return input.map((s) => [e.covalentRadius(s), e.bondiRadius(s), e.element(s).rcov, e.element(s).rbondi]);
    """, symbols)
    for s, (rcov, rbondi, col_rcov, col_rbondi) in zip(symbols, got):
        assert rcov == col_rcov == covalent_radius(s), s
        assert rbondi == col_rbondi and rbondi == bondi_radius(s), s


def test_element_radii_in_python():
    assert covalent_radius("X") == covalent_radius("Zz") == 0.5                 # was 1.5 Å; the web app's value
    assert [covalent_radius(s) for s in ("Bk", "Cf", "Es", "Fm", "Md", "No", "Lr")] == [1.68, 1.68, 1.65, 1.67, 1.73,
                                                                                         1.76, 1.61]
    assert bondi_radius("Pt") == 1.72 and bondi_radius("Au") == 1.66 and bondi_radius("H") == 1.2
    assert bondi_radius("Ba") == 2.68 and bondi_radius("Ra") == 2.83          # Mantina et al. 2009
    assert bondi_radius("Fe") is None and bondi_radius("La") is None and bondi_radius("X") is None
    with_bondi = [rec["symbol"] for rec in elements() if rec["bondiRadius"] is not None]
    assert len(with_bondi) == 54
    assert all(isinstance(bondi_radius(s), float) for s in with_bondi)


# ------------------------------------------------------------------ exact minimum image
def test_mic_vector_picks_the_same_image_in_both_languages(js):
    """Random unimodular bases of four lattices, random vectors and half cell vectors, axis subsets and partial
    periodicity: the same images, and vectors within 1e-12 Å (the two implementations do the same arithmetic)."""
    rng = np.random.default_rng(9)
    bases = [np.eye(3) * A_PT, np.array([[8.316, 0, 0], [4.158, 7.2019, 0], [0, 0, 21.79]]),
             np.array([[2.77, 0, 0], [1.385, 2.399, 0], [7.5, 4.0, 20.0]]), np.array([[3.0, 0, 0], [0, 4.0, 0], [0.5, 0.3, -5.0]])]
    calls = []
    for base in bases:
        for _ in range(6):
            lower, upper = np.eye(3, dtype=int), np.eye(3, dtype=int)
            lower[1, 0], lower[2, 0], lower[2, 1] = rng.integers(-9, 10, size=3)
            upper[0, 1], upper[0, 2], upper[1, 2] = rng.integers(-3, 4, size=3)
            cell = (lower @ upper) @ base
            vs = (rng.random((8, 3)) - 0.5) @ (base * 3)
            halves = np.array([[0.5, 0.5, 0], [0.5, 0, 0.5], [-0.5, 0.5, 0.5]]) @ cell
            pbc = [bool(x) for x in rng.random(3) < 0.8]
            axes = [None, [0, 1], [2], [0, 2]][int(rng.integers(0, 4))]
            calls.append({"cell": cell.tolist(), "pbc": pbc, "axes": axes, "vs": np.vstack([vs, halves]).tolist()})
    got = js("""
      const { micVector } = await web('core/geometry.js');
      return input.map((c) => c.vs.map((v) => micVector(v, c.cell, c.pbc, { axes: c.axes })));
    """, calls)
    worst = 0.0
    for c, results in zip(calls, got):
        for v, r in zip(c["vs"], results):
            w, img = mic_vector(v, c["cell"], c["pbc"], axes=c["axes"])
            assert list(img) == r["image"], (c, v)
            worst = max(worst, float(np.max(np.abs(w - np.array(r["vector"])))))
    assert worst <= 1e-12


# ------------------------------------------------------------------ periodic neighbours (E-67)
@pytest.mark.parametrize("m", [8, 12, 650])
def test_periodic_neighbours_of_skewed_cells(js, m):
    """fcc Pt with b' = b + m a: 12 neighbours each and the same bonds as Python's neighbor_arrays.  m = 650 needs more
    than 9261 periodic images, so the JS search runs on the reduced vectors."""
    cell = [[A_PT, 0, 0], [m * A_PT, A_PT, 0], [0, 0, A_PT]]
    got = js("""
      const { findPeriodicNeighbors } = await web('core/bonds.js');
      return findPeriodicNeighbors(new Float64Array(input.pos.flat()), ['Pt', 'Pt', 'Pt', 'Pt'], input.cell, [true, true, true]);
    """, {"pos": FCC.tolist(), "cell": cell})
    py = neighbor_arrays(Structure(["Pt"] * 4, FCC, cell=cell, pbc=True), min_distance=0.4)
    js_bonds = sorted((b["i"], b["j"], tuple(b["offset"])) for b in got)
    py_bonds = sorted((int(i), int(j), tuple(int(x) for x in o)) for i, j, o in zip(py.i, py.j, py.offset))
    assert js_bonds == py_bonds
    assert len(js_bonds) == 24                                                # 4 atoms x 12 neighbours / 2
    by_key = {(b["i"], b["j"], tuple(b["offset"])): b["d"] for b in got}
    for i, j, o, d in zip(py.i, py.j, py.offset, py.distance):
        assert by_key[(int(i), int(j), tuple(int(x) for x in o))] == pytest.approx(d, abs=1e-9)
        assert d == pytest.approx(A_PT / math.sqrt(2), abs=1e-9)
