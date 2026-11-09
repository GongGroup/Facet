"""Lattice directions in ``crystallume.core.lattice`` (F0-A T7a): plane normals and lattice directions in the current
cell, hexagonal-cell detection, (h k l) <-> (h k i l) and [u v w] <-> [U V T W], and the fcc/bcc primitive-cell hint.

The shared cases ``tests/data/surface/directions.json`` run in both languages (``tests/test_cases.py``,
``tests/js/cases.test.mjs``).  The tests here cover the Python API (types, exact messages, properties on seeded random
cells, the table of F0-A §3.14.4) and, through the Node bridge, compare it with ``web/js/core/lattice.js`` on generated
inputs: the two implementations use the same arithmetic in the same order, so the unit vectors agree bit for bit.
The JS-only display helpers ``formatIndices`` and ``ariaIndices`` are tested in ``tests/js/lattice_directions.test.mjs``.
"""

from __future__ import annotations

import copy
import json
import math

import numpy as np
import pytest

from crystallume.core import lattice
from crystallume.core.lattice import (
    cellpar_to_cell,
    centered_cell_hint,
    hkil_to_hkl,
    hkl_to_hkil,
    is_hexagonal_cell,
    lattice_direction,
    miller_normal,
    reciprocal_cell,
    uvtw_to_uvw,
    uvw_to_uvtw,
)

from .conftest import DATA

NEW = ["miller_normal", "lattice_direction", "is_hexagonal_cell", "hkl_to_hkil", "hkil_to_hkl", "uvw_to_uvtw",
       "uvtw_to_uvw", "centered_cell_hint"]
MINUS = "−"
A_PT, A_FE = 3.92, 2.866
PT_CONV = np.eye(3) * A_PT
PT_PRIM = A_PT / 2 * np.array([[0, 1, 1], [1, 0, 1], [1, 1, 0]], dtype=float)
FE_PRIM = A_FE / 2 * np.array([[-1, 1, 1], [1, -1, 1], [1, 1, -1]], dtype=float)
ZNO = cellpar_to_cell(3.25, 3.25, 5.207, 90, 90, 120)
FCC_Q = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]]
BCC_Q = [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
H120 = {"axis": 2, "gamma": 120}


def rotation(rng: np.random.Generator) -> np.ndarray:
    """A random proper rotation (rows), applied to row vectors as ``cell @ R.T``."""
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    q = q * np.sign(np.diag(r))
    return q if np.linalg.det(q) > 0 else -q


def random_cells(n: int, seed: int) -> list[np.ndarray]:
    """Lengths 2-12 Å, angles 55-125° (rejecting flat cells), random orientation, a quarter left-handed."""
    rng = np.random.default_rng(seed)
    out: list[np.ndarray] = []
    while len(out) < n:
        a, b, c = rng.uniform(2, 12, 3)
        al, be, ga = rng.uniform(55, 125, 3)
        try:
            cell = cellpar_to_cell(a, b, c, al, be, ga)
        except ValueError:
            continue
        if abs(np.linalg.det(cell)) < 0.2 * a * b * c:
            continue
        cell = cell @ rotation(rng).T
        out.append(cell[[1, 0, 2]] if rng.uniform() < 0.25 else cell)
    return out


def random_indices(rng: np.random.Generator, n: int = 3, top: int = 4) -> list[int]:
    while True:
        v = [int(x) for x in rng.integers(-top, top + 1, n)]
        if any(v):
            return v


# ------------------------------------------------------------------------------------------------ the module
def test_all_lists_the_new_functions_after_the_f0d_ones():
    assert lattice.__all__[-len(NEW):] == NEW
    assert lattice.__all__[:8] == ["cellpar_to_cell", "cell_to_cellpar", "frac_to_cart", "cart_to_frac", "cell_volume",
                                   "plane_spacings", "reciprocal_cell", "wrap_fractional"]
    for name in lattice.__all__:
        assert callable(getattr(lattice, name)), name


def test_golden_file_runs_in_both_languages():
    doc = json.loads((DATA / "surface" / "directions.json").read_text(encoding="utf-8"))
    assert doc["schema"] == "crystallume.cases/1"
    ops = {c["op"] for c in doc["cases"]}
    assert ops == {"reciprocalCell", "millerNormal", "latticeDirection", "isHexagonalCell", "hklToHkil", "hkilToHkl",
                   "uvwToUvtw", "uvtwToUvw", "centeredCellHint", "primitiveMiller"}
    for case in doc["cases"]:
        assert case["id"].startswith("f0a-dir-"), case["id"]
        assert "skip" not in case and "xfail" not in case, f"{case['id']} must run in both languages"


# --------------------------------------------------------------------------------------------- miller_normal
def test_miller_normal_is_the_unit_reciprocal_vector_on_random_cells():
    rng = np.random.default_rng(1)
    for cell in random_cells(200, 2):
        hkl = random_indices(rng)
        n = miller_normal(cell, hkl)
        assert isinstance(n, np.ndarray) and n.dtype == np.float64 and n.shape == (3,)
        assert abs(np.linalg.norm(n) - 1) < 1e-15
        g = np.asarray(hkl, dtype=float) @ np.linalg.inv(cell).T  # the formula of the ledger
        assert np.allclose(n, g / np.linalg.norm(g), atol=1e-13, rtol=0)
        d = 1 / np.linalg.norm(g)
        assert np.allclose(cell @ n, np.asarray(hkl) * d, atol=1e-11)  # n . a_i = h_i d: the sign rule
        h, k, l = hkl
        for uvw in ([k, -h, 0], [0, l, -k], [l, 0, -h]):  # lattice vectors in the plane
            v = np.asarray(uvw, dtype=float) @ cell
            assert abs(n @ v) <= 1e-11 * max(np.linalg.norm(v), 1)


def test_miller_normal_of_a_multiple_is_the_same_bit_for_bit():
    for cell in random_cells(50, 3):
        assert miller_normal(cell, (2, 2, 2)).tolist() == miller_normal(cell, (1, 1, 1)).tolist()
        assert miller_normal(cell, (-3, 0, 6)).tolist() == miller_normal(cell, (-0.5, 0, 1)).tolist()


@pytest.mark.parametrize(("cell", "a", "q", "hkl", "conventional", "d", "angle"), [
    (PT_PRIM, A_PT, FCC_Q, (1, 0, 0), (-1, 1, 1), "2.263", "54.74"),
    (PT_PRIM, A_PT, FCC_Q, (1, 1, 0), (0, 0, 1), "1.960", "90.00"),
    (PT_PRIM, A_PT, FCC_Q, (1, 1, 1), (1, 1, 1), "2.263", "0.00"),
    (PT_PRIM, A_PT, FCC_Q, (2, 1, 1), (0, 1, 1), "1.386", "54.74"),
    (FE_PRIM, A_FE, BCC_Q, (1, 0, 0), (0, 1, 1), "2.027", "90.00"),
    (FE_PRIM, A_FE, BCC_Q, (1, 1, 0), (1, 1, 2), "1.170", "54.74"),
    (FE_PRIM, A_FE, BCC_Q, (2, 1, 1), (2, 3, 3), "0.611", "29.50"),
])
def test_indices_belong_to_the_current_cell(cell, a, q, hkl, conventional, d, angle):
    """The table of F0-A §3.14.4: a primitive cell's (h k l) is not the conventional plane of the same name."""
    hint = centered_cell_hint(cell)
    assert hint["to_conventional"] == q
    qh = np.asarray(q) @ np.asarray(hkl)
    assert tuple(int(x) for x in qh // math.gcd(*(int(x) for x in qh))) == conventional
    n = miller_normal(cell, hkl)
    assert np.allclose(n, np.asarray(conventional) / np.linalg.norm(conventional), atol=1e-12)
    assert f"{1 / np.linalg.norm(np.asarray(hkl) @ reciprocal_cell(cell)):.3f}" == d
    conventional_cell = np.asarray(q) @ cell
    assert np.allclose(conventional_cell, np.eye(3) * a, atol=1e-12)
    same = miller_normal(conventional_cell, hkl)
    assert f"{math.degrees(math.atan2(np.linalg.norm(np.cross(n, same)), abs(n @ same))):.2f}" == angle


def test_miller_normal_sign_and_handedness():
    left = [[3, 0, 0], [0, 4, 0], [0, 0, -5]]
    assert miller_normal(left, (0, 0, 1)).tolist() == [0.0, 0.0, -1.0]  # c* = (a x b) / det: on the side of c
    assert miller_normal(left, (1, 0, 0)).tolist() == [1.0, 0.0, 0.0]
    assert miller_normal(PT_CONV, (0, 0, -1)).tolist() == [0.0, 0.0, -1.0]
    tilted = [[8.3155757467537992, 0, 0], [-4.1577878733768996, 7.2014998437825444, 0], [1.5, 0.7, 21.8]]
    assert np.allclose(miller_normal(tilted, (0, 0, 1)), [0, 0, 1], atol=1e-15)  # a x b, not c


def test_miller_normal_inputs_and_outputs():
    cell = PT_CONV.copy()
    hkl = np.array([1, 1, 0], dtype=np.int64)
    for args in ((cell, hkl), (cell.tolist(), (1, 1, 0)), (tuple(map(tuple, cell.tolist())), [np.int32(1), 1.0, 0])):
        assert np.allclose(miller_normal(*args), [math.sqrt(0.5), math.sqrt(0.5), 0], atol=1e-15)
    assert np.array_equal(cell, PT_CONV) and hkl.tolist() == [1, 1, 0]  # inputs untouched
    n = miller_normal(PT_CONV, (-0.0, 0, 1))
    assert all(math.copysign(1, x) > 0 for x in n if x == 0)  # no negative zeros
    assert miller_normal(PT_CONV, (1, 1, 1)) is not miller_normal(PT_CONV, (1, 1, 1))


@pytest.mark.parametrize(("cell", "hkl", "exc", "message"), [
    (PT_CONV, (0, 0, 0), ValueError, "(0 0 0) is not a plane"),
    (PT_CONV, (-0.0, 0, 0), ValueError, "(0 0 0) is not a plane"),
    (PT_CONV, (1, 1), ValueError, "hkl must be a list of three numbers"),
    (PT_CONV, (1, 1, 1, 1), ValueError, "hkl must be a list of three numbers"),
    (PT_CONV, "1 1 1", TypeError, "hkl must be a list of three numbers"),
    (PT_CONV, None, TypeError, "hkl must be a list of three numbers"),
    (PT_CONV, (1, "1", 0), TypeError, "hkl must be a list of three numbers"),
    (PT_CONV, (True, 0, 0), TypeError, "hkl must be a list of three numbers"),
    (PT_CONV, (math.nan, 0, 0), ValueError, "hkl must be finite numbers"),
    (PT_CONV, (1, math.inf, 0), ValueError, "hkl must be finite numbers"),
    (PT_CONV, (10**400, 0, 0), ValueError, "hkl must be finite numbers"),
    ([[1, 0, 0], [0, 1, 0], [2, 2, 0]], (1, 0, 0), ValueError, "cell vectors are linearly dependent"),
    ([[1, 0, 0], [0, 1, 0], [0, 0, 0]], (1, 0, 0), ValueError, "cell vectors are linearly dependent"),
    (None, (1, 0, 0), ValueError, "cell must be a 3x3 matrix of finite numbers"),
    (None, (0, 0, 0), ValueError, "cell must be a 3x3 matrix of finite numbers"),  # the cell is checked first
    ([[1, 0, 0], [0, 1, 0]], (1, 0, 0), ValueError, "cell must be a 3x3 matrix of finite numbers"),
    ([[1, 0, 0], [0, 1, 0], [0, 0, math.nan]], (1, 0, 0), ValueError, "cell must be a 3x3 matrix of finite numbers"),
    ([[1, 0, 0], [0, 1, 0], [0, 0, "1"]], (1, 0, 0), ValueError, "cell must be a 3x3 matrix of finite numbers"),
])
def test_miller_normal_errors(cell, hkl, exc, message):
    with pytest.raises(exc) as info:
        miller_normal(cell, hkl)
    assert str(info.value) == message


# ----------------------------------------------------------------------------------------- lattice_direction
def test_lattice_direction_on_random_cells():
    rng = np.random.default_rng(4)
    for cell in random_cells(200, 5):
        uvw = random_indices(rng)
        t = lattice_direction(cell, uvw)
        v = np.asarray(uvw, dtype=float) @ cell
        assert isinstance(t, np.ndarray) and t.shape == (3,)
        assert np.allclose(t, v / np.linalg.norm(v), atol=1e-14, rtol=0)


def test_lattice_direction_examples_and_errors():
    assert np.allclose(lattice_direction(ZNO, uvtw_to_uvw((2, -1, -1, 0))), [1, 0, 0], atol=1e-15)
    assert np.allclose(lattice_direction(ZNO, (1, 1, 0)), [0.5, math.sqrt(3) / 2, 0], atol=1e-15)
    assert np.allclose(lattice_direction(PT_PRIM, (1, 1, 0)), np.array([1, 1, 2]) / math.sqrt(6), atol=1e-15)
    assert lattice_direction(PT_CONV, (0, 0, 7)).tolist() == [0.0, 0.0, 1.0]
    for uvw, exc, message in (((0, 0, 0), ValueError, "[0 0 0] is not a direction"),
                              ((1, 0, 0, 0), ValueError, "uvw must be a list of three numbers"),
                              ("x", TypeError, "uvw must be a list of three numbers"),
                              ((math.nan, 1, 0), ValueError, "uvw must be finite numbers")):
        with pytest.raises(exc) as info:
            lattice_direction(PT_CONV, uvw)
        assert str(info.value) == message
    with pytest.raises(ValueError, match="^cell vectors are linearly dependent$"):
        lattice_direction([[1, 0, 0], [2, 0, 0], [0, 0, 1]], (0, 0, 1))


# ----------------------------------------------------------------------------------------- is_hexagonal_cell
A, C = 3.25, 5.207


def test_hexagonal_settings_and_unique_axis():
    assert is_hexagonal_cell(ZNO) == H120
    assert is_hexagonal_cell(cellpar_to_cell(A, A, C, 90, 90, 60)) == {"axis": 2, "gamma": 60}
    s = A * math.sqrt(3) / 2
    assert is_hexagonal_cell([[C, 0, 0], [0, A, 0], [0, -A / 2, s]]) == {"axis": 0, "gamma": 120}
    assert is_hexagonal_cell([[A, 0, 0], [0, C, 0], [-A / 2, 0, s]]) == {"axis": 1, "gamma": 120}
    rng = np.random.default_rng(6)
    for _ in range(50):
        assert is_hexagonal_cell(ZNO @ rotation(rng).T) == H120
    result = is_hexagonal_cell(ZNO)
    assert type(result["axis"]) is int and type(result["gamma"]) is int


@pytest.mark.parametrize(("f", "want"), [(0.5e-3, H120), (0.99e-3, H120), (1.01e-3, None), (1.1e-3, None)])
def test_hexagonal_length_tolerance(f, want):
    """Lengths are equal within 1e-3 relative to the longer one (inclusive)."""
    assert is_hexagonal_cell(cellpar_to_cell(A, A * (1 + f), C, 90, 90, 120)) == want
    assert is_hexagonal_cell(cellpar_to_cell(A * (1 + f), A, C, 90, 90, 120)) == want


@pytest.mark.parametrize(("d", "want"), [(0.05, H120), (0.099, H120), (0.101, None), (0.2, None)])
def test_hexagonal_angle_tolerance(d, want):
    """gamma within 0.1° of 120° and c within 0.1° of perpendicular to a and b."""
    for g in (120 + d, 120 - d):
        assert is_hexagonal_cell(cellpar_to_cell(A, A, C, 90, 90, g)) == want
    for p in (90 + d, 90 - d):
        assert is_hexagonal_cell(cellpar_to_cell(A, A, C, p, 90, 120)) == want
        assert is_hexagonal_cell(cellpar_to_cell(A, A, C, 90, p, 120)) == want


def test_hexagonal_custom_tolerances():
    long_b = cellpar_to_cell(A, A * 1.0015, C, 90, 90, 120)
    assert is_hexagonal_cell(long_b) is None
    assert is_hexagonal_cell(long_b, length_tol=2e-3) == H120
    assert is_hexagonal_cell(long_b, 2e-3) == H120  # the ledger's signature: positional too
    wide = cellpar_to_cell(A, A, C, 90.15, 90, 120.15)
    assert is_hexagonal_cell(wide) is None
    assert is_hexagonal_cell(wide, angle_tol=0.2) == H120
    assert is_hexagonal_cell(wide, 1e-3, 0.2) == H120


def test_not_hexagonal():
    for cell in (PT_CONV, PT_PRIM, FE_PRIM, cellpar_to_cell(A, A, C, 90, 100, 120),
                 cellpar_to_cell(A, 1.2 * A, C, 90, 90, 120), [ZNO[0], ZNO[1], [0, 0, 0]]):
        assert is_hexagonal_cell(cell) is None
    assert is_hexagonal_cell(None) is None


def test_hexagonal_errors():
    for bad in ({"cell": ZNO}, [[1, 0, 0], [0, 1, 0]], "cell"):  # a cell only, never a structure (U1)
        with pytest.raises(ValueError, match=r"^cell must be a 3x3 matrix of finite numbers$"):
            is_hexagonal_cell(bad)
    for kw, message in (({"length_tol": -1}, "length_tol must be a non-negative number (got -1)"),
                        ({"angle_tol": "0.1"}, 'angle_tol must be a non-negative number (got "0.1")'),
                        ({"angle_tol": math.nan}, "angle_tol must be a non-negative number (got NaN)"),
                        ({"length_tol": None}, "length_tol must be a non-negative number (got null)")):
        with pytest.raises(ValueError) as info:
            is_hexagonal_cell(ZNO, **kw)
        assert str(info.value) == message


# --------------------------------------------------------------------------------------------- four indices
def test_hkl_hkil_round_trip_and_types():
    for h in range(-3, 4):
        for k in range(-3, 4):
            for l in range(-3, 4):
                hkil = hkl_to_hkil((h, k, l))
                assert hkil == (h, k, -(h + k), l) and all(type(x) is int for x in hkil)
                back = hkil_to_hkl(hkil)
                assert back == (h, k, l) and all(type(x) is int for x in back)
    assert hkl_to_hkil((2, 2, 2)) == (2, 2, -4, 2)  # common factors are kept
    assert hkl_to_hkil(np.array([1, 0, 0])) == (1, 0, -1, 0)
    assert hkl_to_hkil([np.int64(1), 1.0, 0]) == (1, 1, -2, 0)
    assert hkil_to_hkl([1.0, 0, -1, 0]) == (1, 0, 0)


@pytest.mark.parametrize(("hkil", "value"), [((1, 0, 0, 0), "-1"), ((1, 1, 0, 0), "-2"), ((-1, 0, 0, 0), "1"),
                                             ((0, 0, 1, 0), "0"), ((-2, -3, 4, 1), "5")])
def test_hkil_to_hkl_message_word_for_word(hkil, value):
    """F0-A §3.15: U+2212 in the formula, the computed value in ASCII."""
    with pytest.raises(ValueError) as info:
        hkil_to_hkl(hkil)
    assert type(info.value) is ValueError
    assert str(info.value) == f"in (h k i l), i must be {MINUS}(h + k) = {value}"
    assert str(info.value).count(MINUS) == 1


def test_four_index_input_errors():
    for fn, value, exc, message in (
        (hkl_to_hkil, (0.5, 0, 0), ValueError, "hkl must be whole numbers"),
        (hkil_to_hkl, (1, 0.5, -1.5, 0), ValueError, "hkil must be whole numbers"),
        (hkil_to_hkl, (2**53, 0, -(2**53), 0), ValueError, "hkil must be whole numbers"),
        (hkil_to_hkl, (1, 0, 0), ValueError, "hkil must be a list of four numbers"),
        (hkl_to_hkil, ("1", 0, 0), TypeError, "hkl must be a list of three numbers"),
        (hkil_to_hkl, (math.nan, 0, 0, 0), ValueError, "hkil must be finite numbers"),
        (uvw_to_uvtw, (1, 0), ValueError, "uvw must be a list of three numbers"),
        (uvtw_to_uvw, (1, 0, 0), ValueError, "uvtw must be a list of four numbers"),
        (uvtw_to_uvw, (1, 0, 0, math.inf), ValueError, "uvtw must be finite numbers"),
    ):
        with pytest.raises(exc) as info:
            fn(value)
        assert str(info.value) == message
    with pytest.raises(ValueError) as info:
        uvw_to_uvtw((0.5, 0, 0), integer=True)
    assert str(info.value) == "uvw must be whole numbers for integer indices"


def test_uvw_uvtw_formulas_integer_form_and_round_trip():
    assert uvw_to_uvtw((1, 0, 0)) == (2 / 3, -1 / 3, -1 / 3, 0.0)
    assert uvw_to_uvtw((0.5, 0, 0)) == (1 / 3, -1 / 6, -1 / 6, 0.0)
    assert uvw_to_uvtw((1, 0, 0), integer=True) == (2, -1, -1, 0)
    assert uvw_to_uvtw((0, 0, 1), integer=True) == (0, 0, 0, 1)
    assert uvw_to_uvtw((0, 0, 0), integer=True) == (0, 0, 0, 0)
    assert uvtw_to_uvw((2, -1, -1, 0)) == (3.0, 0.0, 0.0)
    assert uvtw_to_uvw((1, 0, 0, 0)) == (1.0, 0.0, 0.0)  # T != -(U + V) describes a vector all the same
    with pytest.raises(TypeError):
        uvw_to_uvtw((1, 0, 0), True)  # integer is keyword-only
    a1, a2, c = ZNO
    a3 = -(a1 + a2)
    for u in range(-3, 4):
        for v in range(-3, 4):
            for w in range(-2, 3):
                f = uvw_to_uvtw((u, v, w))
                assert all(type(x) is float and math.copysign(1, x) > 0 for x in f if x == 0)
                assert all(type(x) is float for x in f) and abs(f[0] + f[1] + f[2]) < 1e-15
                assert np.allclose(uvtw_to_uvw(f), (u, v, w), atol=1e-14)
                four = f[0] * a1 + f[1] * a2 + f[2] * a3 + f[3] * c  # the same vector in four indices
                assert np.allclose(four, np.array([u, v, w]) @ ZNO, atol=1e-12)
                q = uvw_to_uvtw((u, v, w), integer=True)
                assert all(type(x) is int for x in q) and q[0] + q[1] + q[2] == 0
                if u or v or w:
                    assert math.gcd(*q) == 1
                    back = np.array(uvtw_to_uvw(q))  # a positive multiple of [u v w]
                    s = np.linalg.norm(back) / np.linalg.norm([u, v, w])
                    assert s > 0 and np.allclose(back, s * np.array([u, v, w]), atol=1e-12)


# ---------------------------------------------------------------------------------------- centered_cell_hint
@pytest.mark.parametrize(("cell", "kind", "q", "a"), [(PT_PRIM, "fcc", FCC_Q, A_PT), (FE_PRIM, "bcc", BCC_Q, A_FE)])
def test_centered_cell_hint_to_conventional(cell, kind, q, a):
    """``to_conventional @ cell`` is the conventional cubic cell of the fcc or bcc primitive cell."""
    hint = centered_cell_hint(cell)
    assert hint == {"kind": kind, "to_conventional": q}
    assert all(type(x) is int for row in hint["to_conventional"] for x in row)
    assert np.allclose(np.asarray(hint["to_conventional"]) @ cell, np.eye(3) * a, atol=1e-12)
    assert round(np.linalg.det(hint["to_conventional"])) == (4 if kind == "fcc" else 2)


def test_centered_cell_hint_any_orientation_and_handedness():
    rng = np.random.default_rng(7)
    for i in range(100):
        base, kind, a = (PT_PRIM, "fcc", A_PT) if i % 2 else (FE_PRIM, "bcc", A_FE)
        cell = base @ rotation(rng).T
        if i % 3 == 0:
            cell = cell[[0, 2, 1]]
        hint = centered_cell_hint(cell)
        assert hint is not None and hint["kind"] == kind
        cube = np.asarray(hint["to_conventional"]) @ cell
        assert np.allclose(cube @ cube.T, np.eye(3) * a * a, atol=1e-11)  # a rotated cube of edge a
        assert np.sign(np.linalg.det(cube)) == np.sign(np.linalg.det(cell))


def test_centered_cell_hint_returns_new_lists():
    one = centered_cell_hint(PT_PRIM)
    one["to_conventional"][0][0] = 99
    one["to_conventional"].append([0, 0, 0])
    assert centered_cell_hint(PT_PRIM)["to_conventional"] == FCC_Q
    assert centered_cell_hint(copy.deepcopy(PT_PRIM.tolist())) == {"kind": "fcc", "to_conventional": FCC_Q}


def test_centered_cell_hint_tolerances():
    fcc_len, bcc_len = A_PT / math.sqrt(2), A_FE * math.sqrt(3) / 2
    bcc_angle = math.degrees(math.acos(-1 / 3))

    def kind(cell):
        hint = centered_cell_hint(cell)
        return None if hint is None else hint["kind"]

    for d, want in ((0.05, "fcc"), (0.099, "fcc"), (0.101, None)):
        assert kind(cellpar_to_cell(fcc_len, fcc_len, fcc_len, 60 + d, 60 + d, 60 + d)) == want
        assert kind(cellpar_to_cell(fcc_len, fcc_len, fcc_len, 60, 60, 60 - d)) == want
        assert kind(cellpar_to_cell(bcc_len, bcc_len, bcc_len, bcc_angle + d, bcc_angle, bcc_angle)) == \
            (want and "bcc")
    for f, want in ((0.99e-3, "fcc"), (1.01e-3, None)):
        assert kind(cellpar_to_cell(fcc_len, fcc_len, fcc_len * (1 + f), 60, 60, 60)) == want
    assert kind(cellpar_to_cell(bcc_len, bcc_len, bcc_len, 109.47, 109.47, 109.47)) == "bcc"


def test_centered_cell_hint_none():
    acute = math.degrees(math.acos(1 / 3))
    for cell in (PT_CONV, ZNO, cellpar_to_cell(3, 3, 3, 90, 90, 90), cellpar_to_cell(3, 3, 3, acute, acute, acute),
                 cellpar_to_cell(3, 3, 3, 60, 60, 90), [PT_PRIM[0], PT_PRIM[1], [0, 0, 0]], None):
        assert centered_cell_hint(cell) is None
    with pytest.raises(ValueError, match=r"^cell must be a 3x3 matrix of finite numbers$"):
        centered_cell_hint([[1, 0, 0]])


# -------------------------------------------------------------------------------------- the two languages
def test_unit_vectors_match_js_bit_for_bit(js):
    """Plane normals and directions on random cells and indices: the same doubles in both languages."""
    rng = np.random.default_rng(8)
    cells = random_cells(150, 9)
    items = [{"cell": cell.tolist(), "hkl": random_indices(rng, top=6), "uvw": random_indices(rng, top=6)}
             for cell in cells]
    got = js("""
      const L = await web('core/lattice.js');
      return input.map(({ cell, hkl, uvw }) => ({
        normal: L.millerNormal(cell, hkl), direction: L.latticeDirection(cell, uvw), reciprocal: L.reciprocalCell(cell),
      }));
    """, items)
    for item, out in zip(items, got):
        assert out["normal"] == miller_normal(item["cell"], item["hkl"]).tolist()
        assert out["direction"] == lattice_direction(item["cell"], item["uvw"]).tolist()
        assert np.allclose(out["reciprocal"], reciprocal_cell(item["cell"]), rtol=1e-12, atol=1e-15)


def test_cell_recognizers_match_js_near_their_thresholds(js):
    """is_hexagonal_cell and centered_cell_hint on cells around both tolerances (and rotated) agree with JS."""
    rng = np.random.default_rng(10)
    cells = []
    for f in (0.5, 0.9, 0.99, 1.01, 1.1, 2.0):
        for sign in (1, -1):
            cells += [cellpar_to_cell(A, A * (1 + sign * f * 1e-3), C, 90, 90, 120),
                      cellpar_to_cell(A, A, C, 90, 90, 120 + sign * f * 0.1),
                      cellpar_to_cell(A, A, C, 90 + sign * f * 0.1, 90, 120),
                      cellpar_to_cell(A, A, C, 90, 90, 60 + sign * f * 0.1),
                      cellpar_to_cell(2.77, 2.77, 2.77 * (1 + sign * f * 1e-3), 60, 60, 60),
                      cellpar_to_cell(2.77, 2.77, 2.77, 60 + sign * f * 0.1, 60, 60),
                      cellpar_to_cell(2.48, 2.48, 2.48, 109.4712206 + sign * f * 0.1, 109.4712206, 109.4712206)]
    cells = [c @ rotation(rng).T if i % 2 else c for i, c in enumerate(cells)] + [PT_PRIM, FE_PRIM, ZNO, PT_CONV]
    items = [c.tolist() for c in cells]
    got = js("""
      const L = await web('core/lattice.js');
      return input.map((cell) => [L.isHexagonalCell(cell), L.isHexagonalCell(cell, { lengthTol: 2e-3, angleTol: 0.15 }),
                                  L.centeredCellHint(cell)]);
    """, items)
    hits = 0
    for cell, (hexagonal, wide, hint) in zip(items, got):
        assert hexagonal == is_hexagonal_cell(cell)
        assert wide == is_hexagonal_cell(cell, length_tol=2e-3, angle_tol=0.15)
        mine = centered_cell_hint(cell)
        assert hint == (None if mine is None else {"kind": mine["kind"], "toConventional": mine["to_conventional"]})
        hits += hexagonal is not None or hint is not None
    assert 0 < hits < len(items)


def test_index_conversions_and_messages_match_js(js):
    """The conversions on every small index set, and the error messages for bad arguments, in both languages."""
    triples = [[h, k, l] for h in range(-3, 4) for k in range(-3, 4) for l in range(-2, 3)]
    quads = [[h, k, i, l] for h in range(-2, 3) for k in range(-2, 3) for i in range(-2, 3) for l in (-1, 0, 2)]
    bad = [["millerNormal", [PT_CONV.tolist(), [0, 0, 0]]], ["millerNormal", [None, [1, 0, 0]]],
           ["millerNormal", [PT_CONV.tolist(), [1, 1]]], ["millerNormal", [PT_CONV.tolist(), "1 1 1"]],
           ["millerNormal", [[[1, 0, 0], [0, 1, 0], [1, 1, 0]], [1, 0, 0]]],
           ["latticeDirection", [PT_CONV.tolist(), [0, 0, 0]]], ["latticeDirection", [PT_CONV.tolist(), [1, "0", 0]]],
           ["hklToHkil", [[0.5, 0, 0]]], ["hkilToHkl", [[1, 0, 0, 0]]], ["hkilToHkl", [[3, 4, 0, 1]]],
           ["hkilToHkl", [[1, 0, 0]]], ["uvtwToUvw", [[1, 2]]], ["isHexagonalCell", [[[1, 0, 0], [0, 1, 0]]]],
           ["centeredCellHint", [[[1, 0, 0], [0, 1, 0], [0, 0, "x"]]]]]
    got = js("""
      const L = await web('core/lattice.js');
      const errors = input.bad.map(([name, args]) => {
        try { L[name](...args); return null; } catch (err) { return [err.constructor.name, err.message]; }
      });
      return {
        hkil: input.triples.map((t) => L.hklToHkil(t)),
        uvtw: input.triples.map((t) => L.uvwToUvtw(t)),
        uvtwInt: input.triples.map((t) => L.uvwToUvtw(t, { integer: true })),
        uvw: input.quads.map((q) => L.uvtwToUvw(q)),
        hkl: input.quads.map((q) => { try { return L.hkilToHkl(q); } catch (err) { return err.message; } }),
        errors,
      };
    """, {"triples": triples, "quads": quads, "bad": bad})
    assert got["hkil"] == [list(hkl_to_hkil(t)) for t in triples]
    assert got["uvtw"] == [list(uvw_to_uvtw(t)) for t in triples]
    assert got["uvtwInt"] == [list(uvw_to_uvtw(t, integer=True)) for t in triples]
    assert got["uvw"] == [list(uvtw_to_uvw(q)) for q in quads]

    def py_hkl(q):
        try:
            return list(hkil_to_hkl(q))
        except ValueError as exc:
            return str(exc)

    assert got["hkl"] == [py_hkl(q) for q in quads]
    py_fns = {"millerNormal": miller_normal, "latticeDirection": lattice_direction, "hklToHkil": hkl_to_hkil,
              "hkilToHkl": hkil_to_hkl, "uvtwToUvw": uvtw_to_uvw, "isHexagonalCell": is_hexagonal_cell,
              "centeredCellHint": centered_cell_hint}
    for (name, args), js_error in zip(bad, got["errors"]):
        with pytest.raises((ValueError, TypeError)) as info:
            py_fns[name](*args)
        assert js_error == ["TypeError" if type(info.value) is TypeError else "Error", str(info.value)], (name, args)
