"""Constraint flags core (``crystallume.core.constraints``): storage, the change-of-basis rule, axis names, adsorbate ids.

The shared cases ``tests/data/surface/f0d/constraints.json`` run in both languages (``tests/test_cases.py``,
``tests/js/cases.test.mjs``).  The tests here cover the Python API in detail, check the rule against an independent
subspace computation on many cells and matrices (it never frees an atom and is exact exactly when the freedom is
unchanged), and compare ``web/js/core/constraints.js`` with the Python module on random inputs through the Node bridge.
"""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest

from crystallume import Structure
from crystallume.core import constraints as C
from crystallume.core.constraints import (
    FLAG_RE,
    FLAG_TOL,
    MOVE_FLAGS_KEY,
    apply_basis_change,
    axis_labels,
    cartesian_name,
    cartesian_to_lattice_flags,
    clear_constraints,
    constraint_summary,
    lattice_to_cartesian_mask,
    move_flags,
    next_adsorbate_id,
    set_move_flags,
    transform_move_flags,
)
from crystallume.core.defaults import SURFACE_DEFAULTS

T, F = True, False
NOTE = ("selective dynamics: the partial constraints of {n} atom(s) do not follow the new cell vectors and were "
        "tightened (no atom gains freedom)")
ALL8 = [list(p) for p in itertools.product((T, F), repeat=3)]
COMMON = [[T, T, T], [F, F, F], [T, T, F], [F, F, T]]

D111 = 3.92 / math.sqrt(2)
HEX = np.array([[D111, 0, 0], [-D111 / 2, D111 * math.sqrt(3) / 2, 0], [0, 0, 20.0]])
SQUARE = np.diag([2.556191, 2.556191, 18.0])
TILTED = np.array([[3.0, 0, 0], [0, 4.0, 0], [1.5, 0.8, 20.0]])
R30 = np.array([[2, 1, 0], [-1, 1, 0], [0, 0, 1]])
C2X2 = np.array([[1, 1, 0], [-1, 1, 0], [0, 0, 1]])
P2X1 = np.array([[2, 0, 0], [0, 1, 0], [0, 0, 1]])


def P(name: str) -> list[bool]:
    return [c == "T" for c in name]


def rotation(axis, angle) -> np.ndarray:
    k = np.asarray(axis, float) / np.linalg.norm(axis)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(angle) * K + (1 - math.cos(angle)) * K @ K


def slab(flags=None, cell=HEX, n=None, info=None, ids=None) -> Structure:
    n = len(flags) if n is None else n
    props = {}
    if flags is not None:
        props[MOVE_FLAGS_KEY] = flags
    if ids is not None:
        props["adsorbate_id"] = ids
    return Structure(["Pt"] * n, [[0, 0, 1.5 * i] for i in range(n)], cell=cell, props=props, info=info or {})


# ----------------------------------------------------------------------------------- an independent reference
def _residual(v, basis) -> float:
    """Relative distance of *v* from span(*basis*) by least squares (not the formula of the implementation)."""
    B = np.asarray(basis, float).T
    coef, *_ = np.linalg.lstsq(B, v, rcond=None)
    return float(np.linalg.norm(v - B @ coef) / np.linalg.norm(v))


def _span_contains(big, small, tol=1e-6) -> bool:
    """Every vector of *small* lies in span(*big*) (empty *small*: trivially)."""
    return all(_residual(np.asarray(v, float), big) <= tol for v in small)


def check_rule(f, g, old, new) -> bool:
    """g never frees a direction outside span{a_k : f_k}; returns whether g describes the same freedom (exact)."""
    old, new = np.asarray(old, float), np.asarray(new, float)
    S = [old[k] for k in range(3) if f[k]]
    G = [new[j] for j in range(3) if g[j]]
    if not S:
        assert not G
        return True
    assert _span_contains(S, G), (f, g)
    return len(G) == len(S)


# ------------------------------------------------------------------------------------------------- constants
def test_constants():
    assert MOVE_FLAGS_KEY == "selective_dynamics"
    assert FLAG_TOL == SURFACE_DEFAULTS.flag_tolerance == 1e-6
    assert FLAG_RE.pattern == r"^\.?([TtFf])(?:rue|RUE|alse|ALSE)?\.?$"
    for token in ("T", "F", "t", "f", ".T.", ".F.", "TRUE", "FALSE", "true", "false", ".TRUE.", ".FALSE.", "True"):
        m = FLAG_RE.fullmatch(token)
        assert m and m.group(1) in "TtFf", token
    for token in ("Ti", "Fe", "Si", "", "TT", " T", "T ", "X", "1", "yes"):
        assert FLAG_RE.fullmatch(token) is None, token
    assert sorted(C.__all__) == sorted([
        "MOVE_FLAGS_KEY", "FLAG_RE", "FLAG_TOL", "move_flags", "set_move_flags", "clear_constraints",
        "constraint_summary", "transform_move_flags", "lattice_to_cartesian_mask",
        "cartesian_to_lattice_flags", "apply_basis_change", "axis_labels", "cartesian_name", "next_adsorbate_id"])


def test_module_does_not_import_structure_at_run_time():
    """core.structure will import this module for its normalizer, so the reverse import must not happen at run time."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(C))
    top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    assert all("structure" not in (getattr(n, "module", "") or "") for n in top)


# ------------------------------------------------------------------------- the verification table (F0-D §3.8.3)
@pytest.mark.parametrize("cell_name, matrix_name", [
    ("hex", "r30"), ("hex", "c2x2"), ("hex", "p2x1"), ("square", "r30"), ("square", "c2x2"), ("square", "p2x1"),
    ("tilted", "c2x2"), ("tilted", "p2x1"),
])
def test_in_plane_supercells_keep_the_common_patterns(cell_name, matrix_name):
    cell = {"hex": HEX, "square": SQUARE, "tilted": TILTED}[cell_name]
    p = {"r30": R30, "c2x2": C2X2, "p2x1": P2X1}[matrix_name]
    flags, tightened = transform_move_flags(COMMON, cell, p @ cell)
    assert flags == COMMON and tightened == 0


def test_a_plus_b_tightens_along_a_only():
    p = np.array([[1, 1, 0], [0, 1, 0], [0, 0, 1]])
    assert transform_move_flags([P("TFF")], SQUARE, p @ SQUARE) == ([P("FFF")], 1)
    flags, tightened = transform_move_flags([P("FTF"), P("TFT"), P("FTT")], SQUARE, p @ SQUARE)
    assert flags == [P("FTF"), P("FFT"), P("FTT")] and tightened == 1


def test_orthogonalising_a_tilted_c():
    new = TILTED.copy()
    new[2] = [0, 0, TILTED[2, 2]]
    assert transform_move_flags([P("TTF"), P("FFT")], TILTED, new) == ([P("TTF"), P("FFF")], 1)
    longer = TILTED.copy()
    longer[2] *= 1.7  # only c made longer: exact
    assert transform_move_flags(ALL8, TILTED, longer) == (ALL8, 0)


def test_noise_of_1e_9_does_not_change_the_verdict():
    rng = np.random.default_rng(5)
    for _ in range(20):
        old = HEX + rng.normal(scale=1e-9, size=(3, 3))
        new = R30 @ HEX + rng.normal(scale=1e-9, size=(3, 3))
        assert transform_move_flags(COMMON, old, new) == (COMMON, 0)


@pytest.mark.parametrize("sine, inside", [(0.5e-6, True), (0.999e-6, True), (1.001e-6, False), (2e-6, False)])
def test_the_tolerance_is_the_sine_of_the_angle(sine, inside):
    cos = math.sqrt(1 - sine * sine)
    one = [[1, 0, 0], [0, 1, 0], [sine, 0, cos]]   # new c at that angle from the old c
    two = [[cos, 0, sine], [0, 1, 0], [0, 0, 1]]   # new a at that angle out of the old ab plane
    assert transform_move_flags([P("FFT")], None, one) == ([P("FFT")] if inside else [P("FFF")], 0 if inside else 1)
    assert transform_move_flags([P("TTF")], None, two) == ([P("TTF")] if inside else [P("FTF")], 0 if inside else 1)
    # the tolerance is relative: the same angles with vectors of 30 A
    assert transform_move_flags([P("FFT")], None, 30 * np.array(one))[1] == (0 if inside else 1)


@pytest.mark.parametrize("offset, exact", [(1e-5, True), (1e-4, False)])
def test_contcar_c_offset(offset, exact):
    """A relaxed CONTCAR often has c = (1e-5, 0, 30): F F T is still exact; at 1e-4 it tightens."""
    cell = HEX.copy()
    cell[2] = [offset, 0, 30.0]
    mask, t = lattice_to_cartesian_mask([P("FFT"), P("TTF")], cell)
    assert mask == ([P("FFT")] if exact else [P("FFF")]) + [P("TTF")] and t == (0 if exact else 1)
    ortho = cell.copy()
    ortho[2] = [0, 0, 30.0]
    assert transform_move_flags([P("FFT")], cell, ortho) == ([P("FFT")] if exact else [P("FFF")], 0 if exact else 1)


def test_explicit_tolerance():
    cell = HEX.copy()
    cell[2] = [1e-5, 0, 30.0]
    assert lattice_to_cartesian_mask([P("FFT")], cell, 1e-7) == ([P("FFF")], 1)
    assert lattice_to_cartesian_mask([P("FFT")], cell, None) == ([P("FFT")], 0)
    assert transform_move_flags([P("FFT")], None, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], tol=0) == ([P("FFT")], 0)


# --------------------------------------------------------------------------------------- lattice <-> Cartesian
def test_hexagonal_slab_examples():
    """F0-D §3.8.4: T T F <-> T T F and F F T <-> F F T are exact; F T F has no Cartesian form; ASE 'only y' -> F F F."""
    assert lattice_to_cartesian_mask([P("TTF"), P("FFT")], HEX) == ([P("TTF"), P("FFT")], 0)
    assert cartesian_to_lattice_flags([P("TTF"), P("FFT")], HEX) == ([P("TTF"), P("FFT")], 0)
    assert lattice_to_cartesian_mask([P("FTF")], HEX) == ([P("FFF")], 1)
    assert cartesian_to_lattice_flags([P("FTF")], HEX) == ([P("FFF")], 1)
    assert cartesian_to_lattice_flags([P("TFF")], HEX) == ([P("TFF")], 0)   # a is along x


def test_no_cell_is_the_identity():
    assert lattice_to_cartesian_mask(ALL8, None) == (ALL8, 0)
    assert cartesian_to_lattice_flags(ALL8, None) == (ALL8, 0)
    assert transform_move_flags(ALL8, None, None) == (ALL8, 0)
    # a molecule's Cartesian flags pasted into a hexagonal slab
    assert transform_move_flags([P("TTF"), P("FTF")], None, HEX) == ([P("TTF"), P("FFF")], 1)


# --------------------------------------------------------------------------------------- the rule as a property
def _cells():
    rng = np.random.default_rng(17)
    out = [HEX, SQUARE, TILTED, HEX @ rotation([1, 2, 3], 0.7).T]
    for _ in range(6):  # random cells: lengths 2-30 A, angles away from degenerate
        while True:
            m = rng.normal(size=(3, 3)) * rng.uniform(2, 30, size=(3, 1))
            n = np.linalg.norm(m, axis=1)
            if abs(np.linalg.det(m)) > 0.2 * np.prod(n):
                break
        out.append(m)
    return out


def _matrices():
    rng = np.random.default_rng(23)
    out = [R30, C2X2, P2X1, np.array([[1, 1, 0], [0, 1, 0], [0, 0, 1]]), np.array([[1, 2, 0], [0, 1, 1], [1, 0, 1]]),
           np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]]), np.array([[3, 0, 0], [0, 2, 0], [0, 0, 1]]), np.eye(3, dtype=int)]
    while len(out) < 16:
        p = rng.integers(-2, 3, size=(3, 3))
        if round(abs(np.linalg.det(p))) >= 1:
            out.append(p)
    return out


def test_the_rule_never_frees_an_atom_and_is_exact_when_the_freedom_is_kept():
    """Cells x integer matrices x the 8 patterns (the domain review's 4 x 5 reproduction, extended): every new free
    vector lies in the old freedom; 'exact' (not counted) exactly when the new free vectors span the whole old freedom."""
    for cell, p in itertools.product(_cells(), _matrices()):
        new = p @ cell
        flags, tightened = transform_move_flags(ALL8, cell, new)
        count = 0
        for f, g in zip(ALL8, flags):
            exact = check_rule(f, g, cell, new)
            count += not exact
            if sum(f) in (0, 3):
                assert g == f
        assert tightened == count


def test_the_rule_does_not_depend_on_the_orientation():
    rng = np.random.default_rng(29)
    for cell, p in itertools.product(_cells()[:6], _matrices()[:8]):
        q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
        assert transform_move_flags(ALL8, cell, p @ cell) == transform_move_flags(ALL8, cell @ q.T, (p @ cell) @ q.T)


def test_vectors_parallel_within_the_tolerance_fix_rather_than_free():
    """New vectors that the tolerance cannot tell apart (two of them within 5e-7 rad of the old a) must not give an
    atom that could move along a only a whole plane: such a row becomes F F F."""
    a = np.array([1.0, 0, 0])
    b = np.array([math.cos(5e-7), math.sin(5e-7), 0])
    new = [a, b, [0, 0, 1.0]]
    assert transform_move_flags([P("TFF")], None, new) == ([P("FFF")], 1)
    assert transform_move_flags([P("TTF"), P("FFT")], None, new) == ([P("TTF"), P("FFT")], 0)


def test_results_are_new_lists_and_the_input_is_unchanged():
    flags = [[T, T, F]] * 5            # one shared row, five times
    old = HEX.copy()
    out, _ = transform_move_flags(flags, old, R30 @ HEX)
    assert out == flags and len({id(r) for r in out}) == 5 and all(r is not flags[0] for r in out)
    out[0][0] = False
    assert flags[0] == [T, T, F] and np.array_equal(old, HEX)


def test_dependence_is_relative_to_the_lengths():
    """A very short vector is still independent; vectors 1e-12 rad apart are not (|det| <= 1e-9 |a| |b| |c|)."""
    assert axis_labels([[1, 0, 0], [0, 1, 0], [0, 0, 1e-12]]) == ["x", "y", "z"]
    assert transform_move_flags([P("FFT")], None, [[1e-8, 0, 0], [0, 1e-8, 0], [0, 0, 1e-8]]) == ([P("FFT")], 0)
    with pytest.raises(ValueError, match="new cell vectors are linearly dependent"):
        transform_move_flags([P("FFT")], None, [[1, 0, 0], [math.cos(1e-10), math.sin(1e-10), 0], [0, 0, 1]])


def test_accepted_inputs():
    """Flags as 0/1, flag strings or numpy arrays; vectors as lists, tuples or arrays of any real type."""
    np_flags = np.array([[True, True, False], [False, False, True]])
    assert transform_move_flags(np_flags, HEX, R30 @ HEX) == ([P("TTF"), P("FFT")], 0)
    assert transform_move_flags([[1, 1, 0], ("F", ".F.", "true")], HEX.tolist(), tuple(map(tuple, R30 @ HEX))) \
        == ([P("TTF"), P("FFT")], 0)
    assert transform_move_flags([P("TTF")], np.eye(3, dtype=np.float32), np.eye(3, dtype=int)) == ([P("TTF")], 0)
    assert transform_move_flags([], HEX, HEX) == ([], 0)


@pytest.mark.parametrize("call, exc, message", [
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[1, 0, 0], [2, 0, 0], [0, 0, 1]]), ValueError,
     "new cell vectors are linearly dependent"),
    (lambda: transform_move_flags([P("TTF")], [[1, 0, 0], [0, 1, 0], [1, 1, 0]], SQUARE), ValueError,
     "old cell vectors are linearly dependent"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, 0]]), ValueError,
     "new cell vectors are linearly dependent"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[1, 0, 0], [0, 1, 0]]), ValueError,
     "new cell vectors must be a 3x3 matrix of finite numbers"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, math.nan]]), ValueError,
     "new cell vectors must be a 3x3 matrix of finite numbers"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, "1"]]), ValueError,
     "new cell vectors must be a 3x3 matrix of finite numbers"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, [[True, 0, 0], [0, 1, 0], [0, 0, 1]]), ValueError,
     "new cell vectors must be a 3x3 matrix of finite numbers"),
    (lambda: transform_move_flags("TTF", SQUARE, SQUARE), TypeError, "flags must be a list of [bool, bool, bool] rows"),
    (lambda: transform_move_flags([P("TTF"), [T, "maybe", F]], SQUARE, SQUARE), ValueError,
     "flags: row 1 must be [bool, bool, bool]"),
    (lambda: transform_move_flags([True, False], SQUARE, SQUARE), ValueError, "flags: row 0 must be [bool, bool, bool]"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, SQUARE, 1.0), ValueError, "tol must be a number >= 0 and < 1"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, SQUARE, -1e-7), ValueError, "tol must be a number >= 0 and < 1"),
    (lambda: transform_move_flags([P("TTF")], SQUARE, SQUARE, True), ValueError, "tol must be a number >= 0 and < 1"),
    (lambda: lattice_to_cartesian_mask([P("TTF")], [[1, 0, 0], [0, 1, 0]]), ValueError,
     "cell vectors must be a 3x3 matrix of finite numbers"),
    (lambda: cartesian_to_lattice_flags([P("TTF")], [[1, 0, 0], [1, 0, 0], [0, 0, 1]]), ValueError,
     "cell vectors are linearly dependent"),
    (lambda: cartesian_to_lattice_flags({"a": 1}, HEX), TypeError, "mask must be a list of [bool, bool, bool] rows"),
    (lambda: cartesian_name(HEX, [True, False]), ValueError, "flags must be [bool, bool, bool]"),
    (lambda: axis_labels([[1, 0, 0], [1, 1e-12, 0], [0, 0, 1]]), ValueError, "cell vectors are linearly dependent"),
])
def test_errors(call, exc, message):
    with pytest.raises(exc) as info:
        call()
    assert str(info.value) == message


# ------------------------------------------------------------------------------- reading and writing the flags
def test_move_flags_without_the_key_and_as_copies():
    s = slab(n=3)
    assert move_flags(s) == [P("TTT")] * 3
    s = slab([P("FFF"), P("TTF")])
    got = move_flags(s)
    assert got == [P("FFF"), P("TTF")]
    got[0][0] = True
    assert s.props[MOVE_FLAGS_KEY][0] == P("FFF")
    assert move_flags(slab([])) == []


def test_move_flags_reads_like_the_normalizer():
    s = slab(n=6)
    s.props[MOVE_FLAGS_KEY] = [["T", "F", ".TRUE."], [1, 0, 1], "F", None, ["x", "T", "T"], np.array([0, 1, 1])]
    assert move_flags(s) == [P("TFT"), P("TFT"), P("FFF"), P("TTT"), P("TTT"), P("FTT")]
    s.props[MOVE_FLAGS_KEY] = [P("FFF")]                     # too short: the rest is free
    assert move_flags(s) == [P("FFF")] + [P("TTT")] * 5
    s.props[MOVE_FLAGS_KEY] = [P("FFF")] * 8                 # too long: the extra rows are ignored
    assert move_flags(s) == [P("FFF")] * 6
    s.props[MOVE_FLAGS_KEY] = "F F F"                        # not a list: free
    assert move_flags(s) == [P("TTT")] * 6
    s.props[MOVE_FLAGS_KEY] = np.zeros((6, 3), dtype=bool)
    assert move_flags(s) == [P("FFF")] * 6


def test_the_props_normalizer():
    """``_normalize_move_flags`` (shared with the props normalizer of core/structure): accepted and rejected rows."""
    normalize_move_flags = C._normalize_move_flags
    rows, invalid = normalize_move_flags([
        ["T", "F", "t"], ["f", ".T.", ".F."], ["TRUE", "FALSE", "true"], ["false", ".TRUE.", ".FALSE."], [1, 0, 1],
        [1.0, 0.0, 1.0], [np.True_, np.False_, np.int64(1)], "F", "t", 1, 0, True, False, np.array([1, 0, 0]),
    ])
    assert invalid == 0
    assert rows == [P("TFT"), P("FTF"), P("TFT"), P("FTF"), P("TFT"), P("TFT"), P("TFT"), P("FFF"), P("TTT"),
                    P("TTT"), P("FFF"), P("TTT"), P("FFF"), P("TFF")]
    assert all(type(x) is bool for r in rows for x in r)
    bad = [["Ti", "T", "T"], "Si", ["T", "T"], ["T"] * 4, None, 2, -1, "", "TTF", {"a": 1}, ["T", None, "F"],
           [0.5, 1, 0], "T\n", math.nan, set()]
    rows, invalid = normalize_move_flags(bad)
    assert rows == [P("TTT")] * len(bad) and invalid == len(bad)
    rows, _ = normalize_move_flags([[T, T, F]] * 3)
    assert len({id(r) for r in rows}) == 3
    assert normalize_move_flags(np.array([True, False])) == ([P("TTT"), P("FFF")], 0)
    for not_a_list in ("TTF", None, 3, {"a": [T, T, F]}):
        with pytest.raises(TypeError, match=r"needs a list of \[bool, bool, bool\] rows, one per atom"):
            normalize_move_flags(not_a_list)


def test_set_move_flags():
    s = slab(n=3, info={"warnings": ["from the file"]})
    shared = [T, T, F]
    assert set_move_flags(s, [shared] * 3) is s
    stored = s.props[MOVE_FLAGS_KEY]
    assert stored == [P("TTF")] * 3 and len({id(r) for r in stored}) == 3 and all(r is not shared for r in stored)
    stored[0][0] = False
    assert shared == [T, T, F]
    assert s.info["warnings"] == ["from the file"]
    set_move_flags(s, [[1, 0, 1], "F", {"x": 1}])
    assert s.props[MOVE_FLAGS_KEY] == [P("TFT"), P("FFF"), P("TTT")]
    note = "selective_dynamics: 1 invalid value(s) were replaced by T T T (free)"
    assert s.info["warnings"] == ["from the file", note]
    set_move_flags(s, [None, None, "Ti"])
    assert s.info["warnings"][-1] == "selective_dynamics: 3 invalid value(s) were replaced by T T T (free)"
    set_move_flags(s, [P("TTT")] * 3)                      # all free: the key stays
    assert s.props[MOVE_FLAGS_KEY] == [P("TTT")] * 3
    set_move_flags(s, np.zeros((3, 3), dtype=bool))
    assert s.props[MOVE_FLAGS_KEY] == [P("FFF")] * 3


def test_set_move_flags_errors():
    s = slab(n=3)
    with pytest.raises(ValueError) as info:
        set_move_flags(s, [P("TTF")] * 2)
    assert str(info.value) == "selective_dynamics needs one [bool, bool, bool] per atom (got 2 rows for 3 atoms)"
    with pytest.raises(TypeError) as info:
        set_move_flags(s, "TTF")
    assert str(info.value) == "selective_dynamics needs a list of [bool, bool, bool] rows, one per atom"
    assert MOVE_FLAGS_KEY not in s.props


def test_clear_constraints():
    s = slab([P("FFF"), P("TTT")], info={"warnings": [NOTE.format(n=1)]})
    assert clear_constraints(s) is s
    assert MOVE_FLAGS_KEY not in s.props and move_flags(s) == [P("TTT")] * 2
    assert s.info["warnings"] == [NOTE.format(n=1)]   # notes are the user's to clear
    assert clear_constraints(s) is s                   # no key: nothing to do


def test_constraint_summary():
    """M3 §3.12.2 / L-F0-13: fixed, partial, free, byFlags (count descending, then pattern), present."""
    assert constraint_summary(slab(n=4)) == {"fixed": 0, "partial": 0, "free": 4, "byFlags": {}, "present": False}
    assert constraint_summary(slab([P("TTT")] * 3)) == {"fixed": 0, "partial": 0, "free": 3, "byFlags": {"TTT": 3},
                                                       "present": True}
    contcar = slab([P("FFF")] * 18 + [P("TTF")] * 4 + [P("TTT")] * 14)
    got = constraint_summary(contcar)
    assert got == {"fixed": 18, "partial": 4, "free": 14, "byFlags": {"FFF": 18, "TTT": 14, "TTF": 4}, "present": True}
    assert list(got) == ["fixed", "partial", "free", "byFlags", "present"]
    mixed = slab([P(x) for x in ["FTT", "TTF", "FFT", "TTF", "FFF", "FFT", "TTT", "TTF", "FFF", "TTF"]])
    got = constraint_summary(mixed)
    assert list(got["byFlags"].items()) == [("TTF", 4), ("FFF", 2), ("FFT", 2), ("FTT", 1), ("TTT", 1)]
    assert (got["fixed"], got["partial"], got["free"]) == (2, 7, 1)
    assert constraint_summary(slab([])) == {"fixed": 0, "partial": 0, "free": 0, "byFlags": {}, "present": True}


# ------------------------------------------------------------------------------------------- apply_basis_change
def test_apply_basis_change_writes_one_note_when_it_tightens():
    s = slab([P(x) for x in ["FFT", "FFT", "TTF", "TTF", "FFF", "TTT"]], cell=TILTED)
    new = TILTED.copy()
    new[2] = [0, 0, 20.0]
    assert apply_basis_change(s, s.cell, new) == 2
    assert s.props[MOVE_FLAGS_KEY] == [P(x) for x in ["FFF", "FFF", "TTF", "TTF", "FFF", "TTT"]]
    assert s.info["warnings"] == [NOTE.format(n=2)]
    assert apply_basis_change(s, new, new) == 0           # now exact: no second note
    assert s.info["warnings"] == [NOTE.format(n=2)]


def test_apply_basis_change_when_exact():
    s = slab([P(x) for x in ["FFF", "TTF", "FFT", "TTT"]], info={"warnings": ["kept"]})
    before = s.props[MOVE_FLAGS_KEY]
    assert apply_basis_change(s, HEX, R30 @ HEX) == 0
    assert s.props[MOVE_FLAGS_KEY] is before            # unchanged flags are not rewritten
    assert s.info["warnings"] == ["kept"]
    swap = np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]])
    s = slab([P("TFF"), P("FTT")], cell=SQUARE)
    assert apply_basis_change(s, SQUARE, swap @ SQUARE) == 0
    assert s.props[MOVE_FLAGS_KEY] == [P("FTF"), P("TFT")] and "warnings" not in s.info


def test_apply_basis_change_without_flags_and_with_errors():
    s = slab(n=3, cell=TILTED)
    assert apply_basis_change(s, TILTED, np.diag([3.0, 4.0, 20.0])) == 0
    assert MOVE_FLAGS_KEY not in s.props and "warnings" not in s.info
    with pytest.raises(ValueError, match="new cell vectors are linearly dependent"):
        apply_basis_change(s, TILTED, [[3, 0, 0], [6, 0, 0], [0, 0, 20]])
    with pytest.raises(ValueError, match="old cell vectors must be a 3x3 matrix"):
        apply_basis_change(slab([P("TTF")]), "cell", HEX)
    # pasted atoms without a cell: flags along x, y, z become lattice flags of the target
    mol = Structure(["C", "O"], [[0, 0, 0], [0, 0, 1.15]], props={MOVE_FLAGS_KEY: [P("TTF"), P("FTF")]})
    assert apply_basis_change(mol, None, HEX) == 1
    assert mol.props[MOVE_FLAGS_KEY] == [P("TTF"), P("FFF")]
    assert mol.info["warnings"] == [NOTE.format(n=1)]


def test_apply_basis_change_repairs_stored_rows_it_rewrites():
    s = slab(n=3, cell=TILTED)
    s.props[MOVE_FLAGS_KEY] = ["F", ["F", "F", "T"]]       # malformed and short (I1 broken by hand)
    new = TILTED.copy()
    new[2] = [0, 0, 20.0]
    assert apply_basis_change(s, TILTED, new) == 1
    assert s.props[MOVE_FLAGS_KEY] == [P("FFF"), P("FFF"), P("TTT")]


# -------------------------------------------------------------------------------------------- names and labels
def test_axis_labels():
    """M3 §3.12.3: flag k is called x, y or z only when fixing k alone is exactly fixing that Cartesian axis."""
    assert axis_labels(HEX) == ["a", "y", "z"]
    assert axis_labels(SQUARE) == ["x", "y", "z"]
    assert axis_labels(None) == ["x", "y", "z"]
    assert axis_labels(TILTED) == ["a", "b", "z"]
    xz = TILTED.copy()
    xz[2] = [1.5, 0, 20.0]
    assert axis_labels(xz) == ["a", "y", "z"]
    assert axis_labels(HEX @ rotation([0, 0, 1], math.radians(30)).T) == ["a", "b", "z"]
    assert axis_labels(HEX @ rotation([1, 2, 3], 0.7).T) == ["a", "b", "c"]
    assert axis_labels(np.diag([3.0, 4.0, 5.0])[[1, 0, 2]] * [[1], [1], [-1]]) == ["y", "x", "z"]  # a along y, b along x
    # the labels follow the same rule as the extxyz conversion
    for cell in (HEX, SQUARE, TILTED, xz):
        for k, label in enumerate(axis_labels(cell)):
            mask, t = lattice_to_cartesian_mask([[j != k for j in range(3)]], cell)
            assert (label in "xyz") == (t == 0 and mask[0].count(False) == 1)


def test_cartesian_name():
    names = {"TTT": None, "FFF": "x, y, z", "TTF": "z", "FFT": "x, y", "FTF": None, "TFT": "y", "FTT": None, "TFF": "y, z"}
    for pattern, name in names.items():
        assert cartesian_name(HEX, P(pattern)) == name, pattern
    assert cartesian_name(TILTED, P("TTF")) == "z"           # Fix z only needs a, b perpendicular to z
    assert cartesian_name(TILTED, P("FFT")) is None          # Fix x, y only needs c parallel to z
    assert cartesian_name(None, P("TFF")) == "y, z"
    assert cartesian_name(SQUARE, P("FTT")) == "x"
    assert cartesian_name(SQUARE, ["T", "T", "F"]) == "z"
    near = HEX.copy()
    near[2] = [1e-5, 0, 30.0]                                 # a relaxed CONTCAR still reads "fixed x, y"
    assert cartesian_name(near, P("FFT")) == "x, y"


# ------------------------------------------------------------------------------------------------ adsorbate ids
def test_next_adsorbate_id():
    assert next_adsorbate_id(slab(n=3)) == 1
    assert next_adsorbate_id(slab(n=6, ids=[0, 0, 1, 2, 2, 0])) == 3
    assert next_adsorbate_id(slab(n=3, ids=[0, 0, 0])) == 1
    assert next_adsorbate_id(slab(n=5, ids=[0, 3.0, "7", 2.5, None])) == 4
    assert next_adsorbate_id(slab(n=3, ids=[np.int64(5), True, 0])) == 6
    assert next_adsorbate_id(slab(n=2, ids=[-3, -1])) == 1           # ids below 1 are not adsorbates
    assert next_adsorbate_id(slab(n=2, ids=[2**60, 4])) == 5         # beyond 2**53 - 1: not an id (as in JS)
    s = slab(n=2)
    s.props["adsorbate_id"] = "1 2"
    assert next_adsorbate_id(s) == 1


# ------------------------------------------------------------------------------------------ JS parity (bridge)
def _random_changes(seed: int, count: int) -> list[dict]:
    """Random cells and matrices, plus new vectors placed within a hair of the tolerance (both sides of it)."""
    rng = np.random.default_rng(seed)
    out = []
    cells, mats = _cells(), _matrices()
    for i in range(count):
        cell = cells[i % len(cells)]
        if i % 3 == 0:  # a vector at an angle near the tolerance from an old vector or plane
            new = cell.copy()
            j = int(rng.integers(0, 3))
            k = (j + 1) % 3
            u = new[j] / np.linalg.norm(new[j])
            w = np.cross(u, new[k])
            w /= np.linalg.norm(w)
            angle = FLAG_TOL * rng.choice([0.5, 0.999999, 1.0, 1.000001, 2.0])
            new[j] = np.linalg.norm(new[j]) * (math.cos(angle) * u + math.sin(angle) * w)
        else:
            new = mats[i % len(mats)] @ cell
        flags = [ALL8[k] for k in rng.integers(0, 8, size=6)]
        out.append({"flags": flags, "old": cell.tolist(), "new": new.tolist()})
    return out


def test_js_gives_the_same_flags_on_random_changes(js):
    cases = _random_changes(seed=41, count=240)
    got = js("""
      const c = await web('core/constraints.js');
      return input.map(({ flags, old, new: nw }) => [c.transformMoveFlags(flags, old, nw),
        c.latticeToCartesianMask(flags, old), c.cartesianToLatticeFlags(flags, nw), c.axisLabels(old),
        flags.map((f) => c.cartesianName(old, f))]);
    """, cases)
    assert len(got) == len(cases)
    for case, (tf, l2c, c2l, labels, names) in zip(cases, got):
        flags, old, new = case["flags"], case["old"], case["new"]
        assert tf == dict(zip(("flags", "tightened"), transform_move_flags(flags, old, new)))
        assert l2c == dict(zip(("mask", "tightened"), lattice_to_cartesian_mask(flags, old)))
        assert c2l == dict(zip(("flags", "tightened"), cartesian_to_lattice_flags(flags, new)))
        assert labels == axis_labels(old)
        assert names == [cartesian_name(old, f) for f in flags]


def test_js_reads_writes_and_summarises_like_python(js):
    """Messy stored rows and ids, read, summarised and rewritten in both languages: the same flags and notes."""
    rng = np.random.default_rng(43)
    tokens = [True, False, 0, 1, 1.0, "T", "F", "t", ".T.", ".FALSE.", "TRUE", "x", "Ti", None, 2, "", [T, F]]
    docs = []
    for _ in range(60):
        n = int(rng.integers(0, 7))
        rows = []
        for _ in range(n):
            if rng.random() < 0.25:
                rows.append(tokens[int(rng.integers(0, len(tokens)))])
            else:
                rows.append([tokens[int(rng.integers(0, len(tokens)))] for _ in range(3)])
        ids = [tokens[int(rng.integers(0, len(tokens)))] if rng.random() < 0.3 else int(rng.integers(0, 4))
               for _ in range(n)]
        docs.append({"symbols": ["Pt"] * n, "positions": [[0, 0, i] for i in range(n)], "cell": SQUARE.tolist(),
                     "props": {MOVE_FLAGS_KEY: rows, "adsorbate_id": ids}})
    got = js("""
      const c = await web('core/constraints.js');
      const { Structure } = await web('core/structure.js');
      return input.map((doc) => {
        const s = new Structure({ symbols: doc.symbols, positions: doc.positions, cell: doc.cell });
        s.props = doc.props;   // the stored values as they are, like the Python side (no constructor normalizer)
        const read = [c.moveFlags(s), c.constraintSummary(s), c.nextAdsorbateId(s)];
        c.setMoveFlags(s, doc.props.selective_dynamics);
        return [...read, s.props.selective_dynamics, s.info.warnings ?? []];
      });
    """, docs)
    for doc, (flags, summary, next_id, stored, warnings) in zip(docs, got):
        s = Structure(doc["symbols"], doc["positions"], cell=doc["cell"])
        s.props.update({k: list(v) for k, v in doc["props"].items()})
        assert flags == move_flags(s)
        assert summary == constraint_summary(s)
        assert next_id == next_adsorbate_id(s)
        set_move_flags(s, doc["props"][MOVE_FLAGS_KEY])
        assert stored == s.props[MOVE_FLAGS_KEY]
        assert warnings == s.info.get("warnings", [])


def test_js_raises_the_same_messages(js):
    calls = [
        ["transformMoveFlags", [[[T, T, F]], SQUARE.tolist(), [[1, 0, 0], [2, 0, 0], [0, 0, 1]]]],
        ["transformMoveFlags", [[[T, T, F]], [[1, 0, 0], [0, 1, 0], [1, 1, 0]], SQUARE.tolist()]],
        ["transformMoveFlags", [[[T, T, F]], SQUARE.tolist(), [[1, 0, 0], [0, 1, 0]]]],
        ["transformMoveFlags", ["TTF", SQUARE.tolist(), SQUARE.tolist()]],
        ["transformMoveFlags", [[[T, T, F], [T, "maybe", F]], SQUARE.tolist(), SQUARE.tolist()]],
        ["transformMoveFlags", [[[T, T, F]], SQUARE.tolist(), SQUARE.tolist(), 2]],
        ["latticeToCartesianMask", [[[T, T, F]], [[1, 0, 0], [0, 1, 0]]]],
        ["cartesianToLatticeFlags", [{"a": 1}, HEX.tolist()]],
        ["cartesianName", [HEX.tolist(), [T, F]]],
        ["axisLabels", [[[1, 0, 0], [1, 1e-12, 0], [0, 0, 1]]]],
        ["setMoveFlags", [[[T, T, F]]]],
        ["setMoveFlags", ["TTF"]],
    ]
    got = js("""
      const c = await web('core/constraints.js');
      const { Structure } = await web('core/structure.js');
      const three = () => new Structure({ symbols: ['Pt', 'Pt', 'Pt'], positions: [[0, 0, 0], [0, 0, 1], [0, 0, 2]] });
      return input.map(([name, args]) => {
        try { name === 'setMoveFlags' ? c.setMoveFlags(three(), ...args) : c[name](...args); return null; }
        catch (err) { return [err.constructor.name, err.message]; }
      });
    """, calls)
    three = Structure(["Pt"] * 3, [[0, 0, 0], [0, 0, 1], [0, 0, 2]])
    py = {"transformMoveFlags": transform_move_flags, "latticeToCartesianMask": lattice_to_cartesian_mask,
          "cartesianToLatticeFlags": cartesian_to_lattice_flags, "cartesianName": cartesian_name,
          "axisLabels": axis_labels, "setMoveFlags": lambda *args: set_move_flags(three.copy(), *args)}
    kinds = {"ValueError": ("Error", "RangeError"), "TypeError": ("TypeError",)}
    for (name, args), js_err in zip(calls, got):
        with pytest.raises((ValueError, TypeError)) as info:
            py[name](*args)
        assert js_err is not None and js_err[0] in kinds[type(info.value).__name__], (name, js_err)
        assert js_err[1] == str(info.value), (name, js_err, str(info.value))
    assert got[-2] == ["RangeError", "selective_dynamics needs one [bool, bool, bool] per atom (got 1 rows for 3 atoms)"]


def test_js_module_matches_the_python_names_and_constants(js):
    got = js("""
      const c = await web('core/constraints.js');
      const d = await web('core/defaults.js');
      return { names: Object.keys(c).sort(), key: c.MOVE_FLAGS_KEY, re: c.FLAG_RE.source, flags: c.FLAG_RE.flags,
               tol: c.FLAG_TOL, same: c.FLAG_TOL === d.SURFACE_DEFAULTS.flagTolerance };
    """)
    camel = sorted(n if n.isupper() else n.split("_")[0] + "".join(w.title() for w in n.split("_")[1:])
                   for n in C.__all__)
    assert got["names"] == camel
    assert got["key"] == MOVE_FLAGS_KEY and got["re"] == FLAG_RE.pattern and got["flags"] == ""
    assert got["tol"] == FLAG_TOL and got["same"] is True
