"""Exact minimum image (``mic_vector``, ``minimum_image_vectors``), the IUPAC dihedral and ``signed_angle``
(F0-D T9: ledger L-F0-20, L-F0-21 and section 5.4).

The shared cases of ``tests/data/geometry/mic.json`` run in both languages through ``tests/test_cases.py``; these tests
check the Python side against an independent exhaustive search, the vectorised path against the vector-by-vector one,
the consumers (``Structure.get_distance/get_angle/get_dihedral(mic=True)``, ``distance_matrix``) and the errors.  The
JS side and the two-language comparisons are in ``tests/js/geometry.test.mjs`` and ``tests/test_js_parity.py``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from facet import Structure
from facet.analysis import geometry
from facet.analysis.geometry import (
    dihedral_from_vectors,
    distance_matrix,
    mic_vector,
    minimum_image_vectors,
    signed_angle,
)

A_PT = 3.92
FCC = np.array([[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) * A_PT   # Cartesian, conventional cell
NN = A_PT / math.sqrt(2)                                                            # 2.7719 Å
TTT = (True, True, True)
CELLS = {
    "fcc-b8a": [[A_PT, 0, 0], [8 * A_PT, A_PT, 0], [0, 0, A_PT]],
    "fcc-b12a": [[A_PT, 0, 0], [12 * A_PT, A_PT, 0], [0, 0, A_PT]],
    "shear10": [[1, 0, 0], [10, 1, 0], [0, 0, 1]],
    "oblique-c": [[2.77, 0, 0], [1.385, 2.399, 0], [7.5, 4.0, 20.0]],
    "hex-p3x3": [[8.316, 0, 0], [4.158, 7.2019, 0], [0, 0, 21.79]],
    "cu-c2x2": [[2.556, 2.556, 0], [-2.556, 2.556, 0], [0, 0, 20.4]],
    "shear73": [[1, 0, 0], [7.3, 0.4, 0], [0, 0, 10]],
    "p1x1-tall": [[2.77, 0, 0], [1.385, 2.399, 0], [0, 0, 40.0]],
    "left-handed": [[3.0, 0, 0], [0, 4.0, 0], [0.5, 0.3, -5.0]],
}
DEPENDENT = "mic_vector: the periodic cell vectors are linearly dependent"
BAD_V = "mic_vector: v must be three finite numbers"
MIC_CASES = Path(__file__).resolve().parent / "data" / "geometry" / "mic.json"


def exhaustive(v, cell, axes):
    """Independent reference: every translation with |g_k + n_k| <= |v| / h_k, the shortest, ties within 1e-8 Å broken
    by the smallest floor(1e6 (g + n) + 0.5) (g: numpy's coordinates of v).  Returns (vector, image)."""
    v = np.asarray(v, float)
    cell = np.asarray(cell, float)
    A = cell[list(axes)]
    G = A @ A.T
    h = 1.0 / np.sqrt(np.diag(np.linalg.inv(G)))
    g = np.linalg.solve(G, A @ v)
    r = (np.linalg.norm(v) + 1e-6) / h
    rng = [np.arange(math.ceil(-r[k] - g[k]) - 1, math.floor(r[k] - g[k]) + 2) for k in range(len(axes))]
    n = np.stack([x.ravel() for x in np.meshgrid(*rng, indexing="ij")], 1)
    w = v[None, :] + n @ A
    L = np.sqrt((w * w).sum(1))
    ties = np.nonzero(L <= L.min() + 1e-8)[0]
    best = min(ties, key=lambda i: tuple(math.floor(1e6 * (g[t] + n[i, t]) + 0.5) for t in range(len(axes))))
    image = [0, 0, 0]
    for t, k in enumerate(axes):
        image[k] = int(n[best, t])
    return w[best], tuple(image)


def random_vectors(rng, cell, count, scale=1.5):
    return (rng.random((count, 3)) - 0.5) @ (np.asarray(cell, float) * 2 * scale)


# ------------------------------------------------------------------ the defect (E-66) and its consumers
@pytest.mark.parametrize("m", [0, 1, 4, 8, 12])
def test_same_fcc_lattice_in_any_basis(m):
    """The ledger's reproduction: b' = b + m a gave 9.99 Å (m = 8) and 17.75 Å (m = 12) instead of 2.77 Å."""
    skew = Structure(["Pt"] * 4, FCC, cell=[[A_PT, 0, 0], [m * A_PT, A_PT, 0], [0, 0, A_PT]], pbc=True)
    ortho = Structure(["Pt"] * 4, FCC, cell=np.eye(3) * A_PT, pbc=True)
    assert skew.get_distance(0, 1, mic=True) == pytest.approx(2.7719, abs=1e-4)
    for i in range(4):
        for j in range(4):
            assert skew.get_distance(i, j, mic=True) == pytest.approx(ortho.get_distance(i, j, mic=True), abs=1e-9)
    assert skew.get_angle(1, 0, 2, mic=True) == pytest.approx(60.0, abs=1e-9)
    assert skew.get_dihedral(1, 0, 2, 3, mic=True) == pytest.approx(ortho.get_dihedral(1, 0, 2, 3, mic=True), abs=1e-9)
    d = distance_matrix(skew.positions, skew.cell, skew.pbc)
    assert np.allclose(d, distance_matrix(ortho.positions, ortho.cell, ortho.pbc), atol=1e-9)
    assert np.allclose(d + np.eye(4) * NN, NN, atol=1e-9)    # every pair of the conventional cell is a nearest pair


def test_examples_of_the_ledger():
    w, img = mic_vector([0.3 * A_PT, 0.6 * A_PT, 0], CELLS["fcc-b12a"], TTT)
    assert np.linalg.norm(w) == pytest.approx(0.5 * A_PT, abs=1e-12)          # (0.3, -0.4) a; rounding gave 1.96 Å only by luck
    assert np.allclose(w, np.array([0.3 * A_PT, 0.6 * A_PT, 0]) + np.array(img) @ np.array(CELLS["fcc-b12a"]))
    w, img = mic_vector([0.3, 0.6, 0], CELLS["shear10"], TTT)                  # round + 27 images gave 2.73
    assert np.linalg.norm(w) == pytest.approx(0.5, abs=1e-12)


def test_structure_uses_the_exact_minimum_image():
    s = Structure(["Pt"] * 4, FCC, cell=CELLS["fcc-b8a"], pbc=[True, True, False])
    d = s.positions[1] - s.positions[0]
    assert np.array_equal(s.get_distance(0, 1, mic=True, vector=True), mic_vector(d, s.cell, s.pbc)[0])
    assert np.array_equal(s.get_distance(0, 1, vector=True), d)               # mic=False: the stored difference


# ------------------------------------------------------------------ exactness and the vectorised path
@pytest.mark.parametrize("name", sorted(CELLS))
def test_matches_an_exhaustive_search(name):
    """The axis sets and cells that tests/data/geometry/mic.json (all three axes and a/b, exhaustive) leaves out."""
    rng = np.random.default_rng(sorted(CELLS).index(name))
    cell = np.array(CELLS[name], float)
    vs = list(random_vectors(rng, cell, 10)) + [np.array([fa, fb, fc]) @ cell for fa in (0.5, -0.5) for fb in (0.5, 0)
                                               for fc in (0, 0.5)]
    golden = name not in ("p1x1-tall", "left-handed")
    for axes in ((0, 2), (2,)) if golden else ((0, 1, 2), (0, 1), (1, 2), (2,)):
        for v in vs:
            w, img = mic_vector(v, cell, TTT, axes=axes)
            ref_w, ref_img = exhaustive(v, cell, axes)
            assert img == ref_img, (name, axes, v)
            assert np.max(np.abs(w - ref_w)) < 1e-12
            assert all(img[k] == 0 for k in range(3) if k not in axes)


def test_random_unimodular_bases_give_the_same_images():
    """The shortest vector does not depend on the basis; with the same lattice, only the image numbers change."""
    rng = np.random.default_rng(7)
    hexcell = np.array(CELLS["hex-p3x3"])
    for _ in range(12):
        lower, upper = np.eye(3, dtype=int), np.eye(3, dtype=int)     # unitriangular, so det T = 1
        lower[1, 0], lower[2, 0], lower[2, 1] = rng.integers(-6, 7, size=3)
        upper[0, 1], upper[0, 2], upper[1, 2] = rng.integers(-4, 5, size=3)
        T = lower @ upper
        assert round(np.linalg.det(T)) == 1
        cell = T @ hexcell
        for v in random_vectors(rng, hexcell, 10):
            w, _ = mic_vector(v, cell, TTT)
            w0, _ = mic_vector(v, hexcell, TTT)
            assert np.linalg.norm(w) == pytest.approx(np.linalg.norm(w0), abs=1e-9)


def test_vectorised_rows_equal_vector_by_vector(monkeypatch):
    rng = np.random.default_rng(3)
    cell = np.array(CELLS["fcc-b12a"])        # short vectors take the plain window, long ones the reduced basis
    V = np.vstack([random_vectors(rng, cell, 120, 0.05), random_vectors(rng, cell, 120, 1.0)])
    single = np.array([mic_vector(v, cell, TTT)[0] for v in V])
    assert np.array_equal(minimum_image_vectors(V, cell, TTT), single)
    monkeypatch.setattr(geometry, "_BLOCK", 7)     # many blocks, and passes split into halves
    monkeypatch.setattr(geometry, "_PASS", 40)
    assert np.array_equal(minimum_image_vectors(V, cell, TTT), single)
    assert np.array_equal(minimum_image_vectors(V, cell, TTT, axes=(0, 1)),
                          np.array([mic_vector(v, cell, TTT, axes=(0, 1))[0] for v in V]))


def test_the_shared_cases_through_the_vectorised_path():
    cases = json.loads(MIC_CASES.read_text(encoding="utf-8"))["cases"]
    vector_cases = [c for c in cases if "vectors" in c["args"]]
    assert len(vector_cases) >= 14
    for c in vector_cases:
        a = c["args"]
        got = minimum_image_vectors(a["vectors"], a["cell"], a["pbc"], axes=a.get("axes"))
        assert np.max(np.abs(got - np.array(c["expect"]["vectors"]))) < 1e-12, c["id"]


def test_distance_matrix_is_the_pairwise_minimum_image():
    rng = np.random.default_rng(11)
    cell = np.array(CELLS["oblique-c"])
    pos = rng.random((9, 3)) @ cell
    d = distance_matrix(pos, cell, TTT)
    for i in range(9):
        for j in range(9):
            assert d[i, j] == pytest.approx(np.linalg.norm(mic_vector(pos[j] - pos[i], cell, TTT)[0]), abs=1e-12)


# ------------------------------------------------------------------ ties, axes and periodicity
def test_ties_go_to_the_smaller_effective_coordinate():
    cube = np.eye(3)
    for v, w, img in (([0.5, 0, 0], [-0.5, 0, 0], (-1, 0, 0)), ([-0.5, 0, 0], [-0.5, 0, 0], (0, 0, 0)),
                      ([0.5, 0.5, 0.5], [-0.5, -0.5, -0.5], (-1, -1, -1)), ([1.5, 0, 0], [-0.5, 0, 0], (-2, 0, 0))):
        got_w, got_img = mic_vector(v, cube, TTT)
        assert got_img == img and np.allclose(got_w, w, atol=1e-15)
    a, b, c = np.array(CELLS["cu-c2x2"], float)
    got_w, got_img = mic_vector(0.5 * a + 0.5 * b, CELLS["cu-c2x2"], TTT)    # (0.5, 0.5) ties with (-0.5, -0.5) ...
    assert got_img == (-1, -1, 0) and np.allclose(got_w, -0.5 * a - 0.5 * b, atol=1e-12)


def test_axes_and_periodicity():
    cell = np.array([[3.0, 0, 0], [1.0, 3.0, 0], [0.5, 0.5, 10.0]])
    v = [2.9, 2.0, 9.0]
    w_ab, img_ab = mic_vector(v, cell, TTT, axes=(0, 1))
    assert img_ab[2] == 0
    for w, img in (mic_vector(v, cell, (True, True, False)), mic_vector(v, cell, TTT, axes=[1, 0, 1])):
        assert img == img_ab and np.array_equal(w, w_ab)
    assert mic_vector(v, cell, True)[1] == mic_vector(v, cell, TTT)[1]                 # a single bool for all axes
    assert mic_vector(v, cell, TTT, axes=np.array([0, 1]))[1] == img_ab                  # numpy integers
    for none in (dict(pbc=False), dict(pbc=(False,) * 3), dict(pbc=TTT, axes=())):
        w, img = mic_vector(v, None if "axes" not in none else cell, none["pbc"], axes=none.get("axes"))
        assert img == (0, 0, 0) and np.array_equal(w, v)                                 # the cell is not even read
    assert minimum_image_vectors(np.array([v]), cell, (False, False, False)).tolist() == [v]
    assert minimum_image_vectors(v, cell, TTT).shape == (1, 3)                           # one vector: one row
    assert minimum_image_vectors(np.zeros((0, 3)), cell, TTT).shape == (0, 3)


# ------------------------------------------------------------------ errors
def test_dependent_cell_vectors():
    for cell in ([[2, 0, 0], [4, 0, 0], [0, 0, 5]], [[2, 0, 0], [0, 3, 0], [2, 3, 0]], [[0, 0, 0], [0, 3, 0], [0, 0, 5]],
                 [[2, 0, 0], [0, 3, 0], [0, 0, math.nan]]):
        with pytest.raises(ValueError) as err:
            mic_vector([1, 1, 1], cell, TTT)
        assert str(err.value) == DEPENDENT
        with pytest.raises(ValueError, match="^minimum_image_vectors: the periodic cell vectors are linearly dependent$"):
            minimum_image_vectors([[1, 1, 1]], cell, TTT)
    w, img = mic_vector([1.5, -2.0, 1.0], [[2, 0, 0], [0, 3, 0], [2, 3, 0]], (True, True, False))   # c is not searched
    assert img == (-1, 1, 0) and np.allclose(w, [-0.5, 1.0, 1.0])


def test_argument_errors():
    cube = np.eye(3)
    for v in ([1, 2], [1, 2, math.nan], [1, 2, math.inf], ["1", 2, 3], None, [True, False, True], [[1, 2, 3]],
              [1, [2], 3], "abc"):
        with pytest.raises(TypeError) as err:
            mic_vector(v, cube, TTT)
        assert str(err.value) == BAD_V
    for axes in ([3], [-1], [0.5], ["a"], [True], 5):
        with pytest.raises(ValueError, match=r"^mic_vector: axes must be cell axes 0, 1 or 2$"):
            mic_vector([1, 2, 3], cube, TTT, axes=axes)
    assert mic_vector([1, 2, 3], cube, TTT, axes=[1.0])[1] == (0, -2, 0)                 # a whole number is an axis
    with pytest.raises(TypeError, match=r"^mic_vector: pbc must be three booleans$"):
        mic_vector([1, 2, 3], cube, [True, False])
    for cell in ([[1, 0, 0], [0, 1, 0]], None, "cell"):
        with pytest.raises(TypeError, match=r"^mic_vector: cell must be a 3 x 3 matrix$"):
            mic_vector([1, 2, 3], cell, TTT)
    for vectors in ([[1, 2]], [[1, 2, math.nan]], [["a", "b", "c"]]):
        with pytest.raises(TypeError, match=r"^minimum_image_vectors: vectors must be an M x 3 array of finite numbers$"):
            minimum_image_vectors(vectors, cube, TTT)
    with pytest.raises(TypeError):
        minimum_image_vectors([[1, 2, 3]], cube, TTT, (0, 1))   # axes is keyword-only


def test_a_degenerate_cell_is_refused_not_searched_for_ever():
    """A 1e-10 Å lattice vector puts millions of images within 1e-8 Å of the shortest: refused, quickly."""
    with pytest.raises(ValueError) as err:
        mic_vector([0.3, 4.9, 4.9], [[1e-10, 0, 0], [0, 10, 0], [0, 0, 10]], TTT)
    assert str(err.value) == ("mic_vector: the cell is too degenerate for an exact minimum image "
                              "(more than 1000000 candidate images)")
    w, img = mic_vector([0.3, 4.9, 4.9], [[1e-3, 0, 0], [0, 10, 0], [0, 0, 10]], TTT)   # thin, but searched exactly
    assert img == (-300, 0, 0) and np.allclose(w, [0, 4.9, 4.9], atol=1e-12)
    w, img = mic_vector([0.3, 4.9, 4.9], [[1e-7, 0, 0], [0, 10, 0], [0, 0, 10]], TTT)   # thousands of ties: the rule
    assert np.linalg.norm(w) == pytest.approx(math.hypot(4.9, 4.9), abs=1e-8) and img[1:] == (0, 0)


# ------------------------------------------------------------------ basis reduction
def test_reduce_basis():
    B, U = geometry._reduce_basis(CELLS["fcc-b12a"])
    assert np.allclose(B, np.eye(3) * A_PT) and U == [[1, 0, 0], [-12, 1, 0], [0, 0, 1]]
    for name in sorted(CELLS):
        for rows in (CELLS[name], CELLS[name][:2], CELLS[name][1:2]):
            A = np.array(rows, float)
            B, U = geometry._reduce_basis(A)
            assert np.allclose(np.array(U) @ A, B, atol=1e-9) and round(abs(np.linalg.det(np.array(U, float)))) == 1
            assert sorted(np.linalg.norm(B, axis=1)) <= sorted(np.linalg.norm(A, axis=1) + 1e-12)
            B2, U2 = geometry._reduce_basis(B)                                            # a fixed point
            assert U2 == np.eye(len(A), dtype=int).tolist()


# ------------------------------------------------------------------ dihedral and signed angles
@pytest.mark.parametrize("phi", [30.0, 60.0, 150.0, -60.0, -150.0, 179.0, -179.0])
def test_dihedral_has_the_iupac_sign(phi):
    """i on +x, j at the origin, k on +z, l turned by phi about z: the IUPAC (and ASE) dihedral i-j-k-l is phi."""
    t = math.radians(phi)
    s = Structure(["C"] * 4, [[1, 0, 0], [0, 0, 0], [0, 0, 1.5], [math.cos(t), math.sin(t), 1.5]])
    assert s.get_dihedral(0, 1, 2, 3) == pytest.approx(phi % 360.0, abs=1e-9)
    assert signed_angle(s.get_dihedral(0, 1, 2, 3)) == pytest.approx(phi, abs=1e-9)
    assert s.get_dihedral(3, 2, 1, 0) == pytest.approx(phi % 360.0, abs=1e-9)          # the same read backwards
    mirror = Structure(["C"] * 4, s.positions * [1, -1, 1])
    assert mirror.get_dihedral(0, 1, 2, 3) == pytest.approx((-phi) % 360.0, abs=1e-9)


def test_dihedral_range_and_degenerate_cases():
    assert dihedral_from_vectors(np.array([-1.0, 0, 0]), np.array([0, 0, 1.0]), np.array([1.0, -1e-17, 0])) == 0.0
    assert dihedral_from_vectors(np.array([1.0, 0, 0]), np.array([2.0, 0, 0]), np.array([0, 1.0, 0])) == 0.0
    rng = np.random.default_rng(2)
    for b in rng.normal(size=(200, 3, 3)):
        assert 0.0 <= dihedral_from_vectors(*b) < 360.0


@pytest.mark.parametrize("deg, want", [(0, 0), (180, 180), (-180, 180), (181, -179), (359.5, -0.5), (360, 0),
                                       (540, 180), (-540, 180), (-1e-20, 0), (90, 90), (-90, -90), (720.25, 0.25)])
def test_signed_angle(deg, want):
    got = signed_angle(deg)
    assert got == pytest.approx(want, abs=1e-12) and -180 < got <= 180
    assert math.copysign(1.0, signed_angle(-0.0)) == 1.0 and math.isnan(signed_angle(math.nan))
