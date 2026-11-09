"""Vacuum gaps along the cell vectors (``crystallume.analysis.vacuum``), ``SURFACE_DEFAULTS`` and ``wrap_fractional``.

The shared cases ``tests/data/surface/f0d/vacuum.json`` and ``tests/data/surface/gaps.json`` run in both languages
(``tests/test_cases.py``, ``tests/js/cases.test.mjs``).  The tests here cover the Python API and, through the Node
bridge, compare it with ``web/js/core/vacuum.js`` on generated structures (400 cells with two equal slabs, a random
sweep near every threshold).
"""

from __future__ import annotations

import copy
import math
import pickle
import time
from collections.abc import Mapping

import numpy as np
import pytest

from crystallume import Structure, analysis, build, read
from crystallume.analysis import vacuum as V
from crystallume.analysis.vacuum import (
    axis_gaps,
    contiguous_shifts,
    display_cuts,
    find_surface_gap,
    find_vacuum_gap,
    find_vacuum_gaps,
    gap_cut,
    make_contiguous,
    require_gap,
    surface_normal,
    unwrap_along_gap,
    vacuum_axis,
    vacuum_gap_hint,
)
from crystallume.core.defaults import SURFACE_DEFAULTS, Defaults
from crystallume.core.lattice import wrap_fractional

from .conftest import DATA

CONTCAR = DATA / "surface" / "contcar_pt111.vasp"
TOL = SURFACE_DEFAULTS.position_tolerance


# ---------------------------------------------------------------------------------------------- structures
def fcc111(a=3.92, n=(3, 3), layers=4, vacuum=15.0, z0=0.0, extra=(), pbc=True, info=None) -> Structure:
    """Pt(111) slab, bottom layer at *z0*; *extra* atoms ``(symbol, (x, y, height above the top layer))``."""
    d, dz = a / math.sqrt(2), a / math.sqrt(3)
    a1, a2 = np.array([d, 0, 0]), np.array([d / 2, d * math.sqrt(3) / 2, 0])
    cell = np.array([a1 * n[0], a2 * n[1], [0, 0, (layers - 1) * dz + vacuum]])
    pos = [i * a1 + j * a2 + (L % 3) * (a1 + a2) / 3 + [0, 0, z0 + L * dz]
           for L in range(layers) for i in range(n[0]) for j in range(n[1])]
    top = z0 + (layers - 1) * dz
    syms = ["Pt"] * len(pos)
    for sym, (x, y, h) in extra:
        pos.append(np.array([x, y, top + h]))
        syms.append(sym)
    return Structure(syms, pos, cell=cell, pbc=pbc, info=info or {})


def with_co(h, vacuum=15.0, n=(2, 2)):
    """CO upright on the first atom of the top layer, C at *h* Å above it."""
    s = fcc111(n=n, vacuum=vacuum)
    x, y = s.positions[3 * n[0] * n[1], :2]
    return fcc111(n=n, vacuum=vacuum, extra=[("C", (x, y, h)), ("O", (x, y, h + 1.15))])


def pyridine(vacuum=10.0, info=None):
    ring = [("N", (0, 0, 2.1)), ("C", (1.2, 0, 2.8)), ("C", (1.2, 0, 4.2)), ("C", (0, 0, 4.9)), ("C", (-1.2, 0, 4.2)),
            ("C", (-1.2, 0, 2.8)), ("H", (0, 0, 6.7))]
    return fcc111(vacuum=vacuum, extra=ring, info=info)


def primitive(kind: str, a: float) -> Structure:
    m = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]] if kind == "bcc" else [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
    return Structure(["X"], [[0, 0, 0]], cell=0.5 * a * np.array(m, float))


def bi2se3(rhombohedral=False, z_bi=0.4008, z_se=0.2117, a=4.143, c=28.636) -> Structure:
    A, B, C = np.array([a, 0, 0]), np.array([-a / 2, a * math.sqrt(3) / 2, 0]), np.array([0, 0, c])
    basis = [("Se", 0.0), ("Bi", z_bi), ("Bi", -z_bi), ("Se", z_se), ("Se", -z_se)]
    if rhombohedral:
        cell = np.array([2 / 3 * A + 1 / 3 * B + 1 / 3 * C, -1 / 3 * A + 1 / 3 * B + 1 / 3 * C, -1 / 3 * A - 2 / 3 * B + 1 / 3 * C])
        return Structure([s for s, _ in basis], [[0, 0, z * c] for _, z in basis], cell=cell)
    frac = [[t[0], t[1], (t[2] + z) % 1] for t in [(0, 0, 0), (2 / 3, 1 / 3, 1 / 3), (1 / 3, 2 / 3, 2 / 3)] for _, z in basis]
    return Structure([s for _ in range(3) for s, _ in basis], np.array(frac) @ np.array([A, B, C]), cell=[A, B, C])


def two_slabs(seed: int) -> Structure:
    """Two identical 4-layer slabs in a doubled cell, rotated and shifted at random: two equal 15 Å gaps."""
    rng = np.random.default_rng(seed)
    s = fcc111()
    pos = np.vstack([s.positions, s.positions + s.cell[2]])
    cell = s.cell.copy()
    cell[2] *= 2
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    if np.linalg.det(q) < 0:
        q[:, 0] *= -1
    shift = rng.uniform(-1, 1) * cell[2]
    return Structure(["Pt"] * len(pos), (pos + shift) @ q.T, cell=cell @ q.T)


def frac_c(s: Structure) -> np.ndarray:
    return s.frac_positions[:, 2]


def unchanged(s: Structure):
    before = s.to_dict(decimals=17)
    return lambda: s.to_dict(decimals=17) == before


# --------------------------------------------------------------------------------------------- SURFACE_DEFAULTS
EXPECTED_DEFAULTS = {
    "vacuum_gap_min": 5.0, "surface_hint_gap_min": 2.0, "block_gap_min": 3.5, "small_block_fraction": 0.5,
    "gap_wrap_eps": 1e-6, "position_tolerance": 1e-5, "flag_tolerance": 1e-6, "overlap_distance": 0.5, "mic_tie": 1e-8,
}


def test_surface_defaults_values():
    assert dict(SURFACE_DEFAULTS) == EXPECTED_DEFAULTS
    assert list(SURFACE_DEFAULTS) == list(EXPECTED_DEFAULTS)
    assert "vacuum" not in SURFACE_DEFAULTS  # U4: the vacuum of a slab has no default
    assert SURFACE_DEFAULTS.vacuum_gap_min > 4.34  # bcc Cs d110 must not count as vacuum


def test_surface_defaults_access_and_read_only():
    D = SURFACE_DEFAULTS
    assert isinstance(D, Mapping) and isinstance(D, Defaults) and len(D) == 9
    assert D.vacuum_gap_min == D["vacuum_gap_min"] == 5.0 and D.get("nope", 1) == 1
    with pytest.raises(AttributeError, match=r"^SURFACE_DEFAULTS has no key 'vacuum'$"):
        D.vacuum  # noqa: B018
    with pytest.raises(KeyError, match="vacuum"):
        D["vacuum"]  # noqa: B018
    with pytest.raises(AttributeError, match=r"^SURFACE_DEFAULTS is read-only$"):
        D.vacuum_gap_min = 4.0
    with pytest.raises(AttributeError, match="read-only"):
        D.vacuum = 15.0
    with pytest.raises(AttributeError, match="read-only"):
        del D.vacuum_gap_min
    with pytest.raises(TypeError):
        D["vacuum_gap_min"] = 4.0  # type: ignore[index]
    assert D.vacuum_gap_min == 5.0
    assert copy.copy(D) is D and copy.deepcopy(D) is D
    assert pickle.loads(pickle.dumps(D)) == D
    assert "vacuum_gap_min" in dir(D) and "SURFACE_DEFAULTS(" in repr(D)


def test_surface_defaults_match_js(js):
    got = js("const { SURFACE_DEFAULTS } = await web('core/defaults.js');"
             "return { values: SURFACE_DEFAULTS, frozen: Object.isFrozen(SURFACE_DEFAULTS) };")
    camel = {k: v for k, v in got["values"].items()}
    snake = {"".join("_" + ch.lower() if ch.isupper() else ch for ch in k): v for k, v in camel.items()}
    assert got["frozen"]
    assert snake == EXPECTED_DEFAULTS and list(snake) == list(EXPECTED_DEFAULTS)
    assert "vacuum" not in camel


# ------------------------------------------------------------------------------------------- wrap_fractional
def test_wrap_fractional_rule():
    f = np.array([[-1e-17, 0.5, 1.0], [0.9999999999999, 1.5, -0.25], [2.0, -1.0, 0.75]])
    w = wrap_fractional(f, pbc=(True, True, False))
    assert w is not f and f[0, 2] == 1.0  # a new array; the input is untouched
    assert w[0, 0] == -1e-17 and w[0, 1] == 0.5 and w[0, 2] == 1.0  # c is not periodic
    assert -1e-12 <= w[1, 0] < 0 and w[1, 1] == 0.5 and w[1, 2] == -0.25
    assert w[2, 0] == 0.0 and w[2, 1] == 0.0
    assert np.array_equal(wrap_fractional(f[1]), wrap_fractional(f)[1])  # one point
    assert wrap_fractional([0.3, -0.7, 1.2], pbc=False).tolist() == [0.3, -0.7, 1.2]
    assert wrap_fractional([1 - 1e-9, 0, 0], eps=1e-6)[0] < 0  # within eps of 1: taken as 0 (a hair below)
    assert wrap_fractional(np.zeros((0, 3))).shape == (0, 3)
    with pytest.raises(ValueError, match="one point"):
        wrap_fractional([0.1, 0.2])


def test_wrap_fractional_is_the_structure_wrap_rule():
    rng = np.random.default_rng(7)
    f = rng.uniform(-3, 3, size=(200, 3))
    f[:20] = np.round(f[:20])  # whole numbers
    f[20:40] = np.round(f[20:40]) - rng.uniform(0, 2e-12, size=(20, 3))  # just below whole numbers
    cell = np.array([[4.0, 0, 0], [1.0, 5.0, 0], [0.5, 0.3, 9.0]])
    s = Structure(["X"] * len(f), f @ cell, cell=cell, pbc=[True, False, True])
    wrapped = s.copy().wrap()
    assert np.allclose(wrapped.positions, wrap_fractional(s.frac_positions, s.pbc) @ cell, atol=1e-9)


def test_wrap_fractional_matches_js(js):
    rng = np.random.default_rng(3)
    f = np.concatenate([rng.uniform(-2, 2, 300), [-1e-17, 0.0, 1.0, 1 - 1e-13, -1e-13, 0.9999999999999, 2.5]])
    f = f[: len(f) // 3 * 3]
    variants = [([True, True, True], 1e-12), ([True, False, True], 1e-12), ([True, True, True], 1e-6)]
    got = js("const { wrapFractional } = await web('core/lattice.js');"
             "return input.variants.map(([pbc, eps]) => wrapFractional(Float64Array.from(input.f), pbc, eps));",
             {"f": f.tolist(), "variants": variants})
    for (pbc, eps), out in zip(variants, got):
        assert out == wrap_fractional(f.reshape(-1, 3), pbc, eps).ravel().tolist()


# ------------------------------------------------------------------------------------------------------ gaps
def test_slab_gap_is_the_vacuum():
    s = fcc111()
    g = find_vacuum_gap(s)
    c = s.cell[2, 2]
    top = 3 * 3.92 / math.sqrt(3)
    assert g["axis"] == 2 and g["periodic"] is True
    assert g["width"] == pytest.approx(15.0, abs=1e-9) and g["height"] == pytest.approx(c, abs=1e-12)
    assert g["start"] == pytest.approx(top / c, abs=1e-12) and g["end"] == 0.0
    assert g["center"] == pytest.approx((top / c + 15.0 / c / 2) % 1, abs=1e-12)
    assert find_vacuum_gap(s, 2) == g and find_vacuum_gap(s, 0) is None
    # along a: nine planes spaced evenly over the plane spacing 3 d sin(60°), d = a/sqrt(2)
    assert find_vacuum_gap(s, 0, min_width=0)["width"] == pytest.approx(3.92 / math.sqrt(2) * math.sqrt(3) / 6, abs=1e-9)
    gaps = find_vacuum_gaps(s)
    assert gaps[2] == g and gaps[0]["axis"] == 0 and gaps[1]["axis"] == 1


def test_contcar_fixture_gap_and_window():
    """Acceptance S14-3: 14.9998 Å along c; the two atoms VASP wrapped to f = 0.99999 stay below the bottom layer."""
    s = read(CONTCAR)
    check = unchanged(s)
    g = find_vacuum_gap(s)
    assert g["axis"] == 2 and g["width"] == pytest.approx(21.7894 - 6.7896, abs=1e-4)
    assert g["end"] == pytest.approx(0.99999, abs=1e-12)
    sn = surface_normal(s)
    assert sn["source"] == "vacuum" and sn["surface"] and sn["normal"] == [0.0, 0.0, 1.0] and sn["vacuum_axes"] == [2]
    assert sn["cut"] == display_cuts(s)[2] == find_surface_gap(s) and display_cuts(s)[:2] == [None, None]
    z = unwrap_along_gap(frac_c(s), sn["cut"]) * s.cell[2, 2]
    assert z[[3, 7]] == pytest.approx([-0.000218, -0.000218], abs=1e-6) and z.max() == pytest.approx(6.7896, abs=1e-4)
    assert np.all(z >= sn["cut"]["lo"] * s.cell[2, 2]) and sn["cut"]["main"]["count"] == 36
    assert vacuum_axis(s) == 2 and vacuum_gap_hint(s) is None and require_gap(s) == sn
    assert check()


@pytest.mark.parametrize("t", [0.0, 0.37, -0.81, 3.2])
def test_gap_does_not_depend_on_where_the_slab_is(t):
    s0, s = fcc111(), fcc111()
    s.positions += t * s.cell[2]
    g0, g = find_vacuum_gap(s0), find_vacuum_gap(s)
    assert g["width"] == pytest.approx(g0["width"], abs=1e-9)
    for key in ("start", "end", "center"):
        d = (g[key] - g0[key] - t) % 1
        assert min(d, 1 - d) < 1e-9
    cut = surface_normal(s)["cut"]
    z = unwrap_along_gap(frac_c(s), cut) * s.cell[2, 2]
    assert z.max() - z.min() == pytest.approx(3 * 3.92 / math.sqrt(3), abs=1e-9)  # one piece wherever it is


@pytest.mark.parametrize("structure, widest", [
    (build.crystal("fcc", "Cu", a=3.61), 3.61 / 2),
    (build.crystal("graphite", "C", a=2.464, c=6.711), 6.711 / 2),
    (build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959, u=0.305), None),
    (build.crystal("perovskite", ["Sr", "Ti", "O"], a=3.905), 3.905 / 2),
    (build.crystal("wurtzite", ["Zn", "O"], a=3.25, c=5.207), None),
    (primitive("bcc", 6.14), 6.14 / math.sqrt(2)),   # Cs: d110 = 4.34 Å, the widest of any element
    (primitive("bcc", 5.59), 5.59 / math.sqrt(2)),   # Rb
    (primitive("fcc", 6.20), 6.20 / math.sqrt(3)),   # Xe
    (bi2se3(), 2.58),
    (bi2se3(rhombohedral=True), None),
], ids=["cu", "graphite", "rutile", "srtio3", "zno", "cs-bcc", "rb-bcc", "xe-fcc", "bi2se3-hex", "bi2se3-rh"])
def test_no_vacuum_in_bulk_crystals(structure, widest):
    for t in (0.0, 0.37, -0.81):
        s = structure.copy()
        s.positions += t * s.cell[2]
        assert find_vacuum_gap(s) is None
        w = find_vacuum_gap(s, min_width=0)
        assert w["width"] < 4.4
        if widest is not None:
            assert w["width"] == pytest.approx(widest, abs=0.01 if widest == 2.58 else 1e-9)
        sn = surface_normal(s)
        assert sn["source"] == "ab-plane" and not sn["surface"] and sn["cut"] is None and sn["vacuum_axes"] == []
        assert vacuum_axis(s) is None and find_surface_gap(s) is None and display_cuts(s) == [None, None, None]
        assert vacuum_gap_hint(s).startswith("no vacuum gap of 5 Å or more along a cell vector (the widest is ")


def test_tiny_negative_coordinates_wrap_to_zero():
    s0, s = fcc111(), fcc111()
    s.positions[:9, 2] = -1e-17
    assert find_vacuum_gap(s) == find_vacuum_gap(s0)
    assert gap_cut(s, 2) == gap_cut(s0, 2)
    assert not contiguous_shifts(s, 2).any()
    g = axis_gaps(s, 2)
    assert g["w"][0] == 0.0 and np.all(g["w"] >= 0) and np.all(g["w"] < 1)


def test_threshold_and_ties_within_the_tolerance():
    def two(z1, c=10.0):
        return Structure(["Pt", "Pt"], [[0, 0, 0], [0, 0, z1]], cell=np.diag([2.77, 2.77, c]))

    g = find_vacuum_gap(two(5.0))
    assert g["width"] == pytest.approx(5.0, abs=1e-12) and g["start"] == 0.0  # exactly 5 Å counts; the lower start wins
    assert find_vacuum_gap(two(5.0), min_width=5.0 + 0.9 * TOL) is not None
    assert find_vacuum_gap(two(5.0), min_width=5.0 + 1.1 * TOL) is None
    assert find_vacuum_gap(two(5.0 - 0.3 * TOL))["start"] == 0.0  # widths within 1e-5 Å tie
    assert find_vacuum_gap(two(5.0 + 2 * TOL))["start"] == 0.0 and find_vacuum_gap(two(5.0 - 2 * TOL))["start"] > 0
    cube = Structure(["Ar"], [[1, 2, 3]], cell=np.eye(3) * 10)
    assert find_vacuum_gap(cube)["axis"] == 2  # equal across axes: c, b, a
    assert find_vacuum_gap(Structure(["Ar"], [[1, 2, 3]], cell=np.diag([10, 10.000005, 9])))["axis"] == 1
    assert find_vacuum_gap(Structure(["Ar"], [[1, 2, 3]], cell=np.diag([10, 10.00002, 9])))["axis"] == 1
    assert find_vacuum_gap(Structure(["Ar"], [[1, 2, 3]], cell=np.diag([10.00002, 10, 9])))["axis"] == 0


def test_two_equal_slabs_tie_rule():
    for seed in range(40):
        s = two_slabs(seed)
        g = find_vacuum_gap(s)
        G = axis_gaps(s, 2)
        top = G["widths"].max()
        ties = [t for t in range(G["n"]) if G["widths"][t] >= top - TOL]
        assert len(ties) == 2 and g["axis"] == 2 and g["start"] == G["w"][min(ties)]
        assert g["width"] == pytest.approx(15.0, abs=1e-9)


def test_two_equal_slabs_match_js(js):
    """F0-D §7.2: the tie rule on 400 cells with two identical slabs, same answers in both languages."""
    docs = [two_slabs(seed).to_dict(decimals=17) for seed in range(400)]
    got = js("""
      const { Structure } = await web('core/structure.js');
      const V = await web('core/vacuum.js');
      return input.map((d) => { const s = Structure.fromJSON(d); const n = V.surfaceNormal(s);
        return [V.findVacuumGap(s), V.gapCut(s, 2), { normal: n.normal, axis: n.axis, source: n.source, surface: n.surface }]; });
    """, docs)
    for d, (g, cut, sn) in zip(docs, got):
        s = Structure.from_dict(d)
        pn = surface_normal(s)
        assert g == find_vacuum_gap(s)
        assert cut == gap_cut(s, 2)
        assert sn == {"normal": pn["normal"], "axis": pn["axis"], "source": pn["source"], "surface": pn["surface"]}


def test_periodic_only_and_frames():
    g = build.crystal("graphene", "C")  # pbc T T F, c = 15 Å
    assert find_vacuum_gap(g) is None and find_vacuum_gaps(g)[2] is None
    open_gap = find_vacuum_gap(g, periodic_only=False)
    assert open_gap["axis"] == 2 and open_gap["width"] == pytest.approx(15.0) and open_gap["periodic"] is False
    assert find_vacuum_gaps(g, periodic_only=False)[2] == open_gap
    sn = surface_normal(g)
    assert sn["source"] == "vacuum" and sn["surface"] and sn["axis"] == 2 and sn["cut"]["periodic"] is False
    assert display_cuts(g) == [None, None, None]  # the display never cuts a non-periodic axis
    f = np.array([0.1, 0.9])
    assert unwrap_along_gap(f, sn["cut"]).tolist() == f.tolist()

    s = Structure(["Pt", "Pt"], [[0, 0, 0], [0, 0, 5]], cell=np.diag([2.77, 2.77, 10.0]),
                  frames=[{"positions": [[0, 0, 0], [0, 0, 5]], "cell": np.diag([2.77, 2.77, 16.0])},
                          {"positions": [[0, 0, 0], [0, 0, 7]]}])
    assert find_vacuum_gap(s)["width"] == pytest.approx(5.0)
    assert find_vacuum_gap(s, frame=0)["width"] == pytest.approx(5.0)
    assert find_vacuum_gap(s, frame=1)["width"] == pytest.approx(11.0)  # frame 1 has its own cell
    assert find_vacuum_gap(s, frame=2, min_width=0)["width"] == pytest.approx(7.0)  # frame 2 uses the base cell
    assert gap_cut(s, 2, frame=1)["height"] == pytest.approx(16.0)
    with pytest.raises(IndexError, match=r"^frame 3 out of range \(structure has 3 frames\)$"):
        find_vacuum_gap(s, frame=3)
    with pytest.raises(IndexError, match="frame -1 out of range"):
        gap_cut(s, 2, frame=-1)
    with pytest.raises(TypeError, match=r"frame must be an integer \(got 1.5\)"):
        surface_normal(s, frame=1.5)
    assert find_vacuum_gap(s, frame=1.0)["width"] == pytest.approx(11.0)  # JSON numbers: 1.0 is frame 1


def test_axis_gaps_arrays_and_exclude():
    s = with_co(4.0, vacuum=10.0)
    G = axis_gaps(s, 2)
    assert G["axis"] == 2 and G["n"] == 18 and G["periodic"] is True
    assert np.all(np.diff(G["w"]) >= 0) and G["w"][0] >= 0 and G["w"][-1] < 1
    assert G["widths"].sum() == pytest.approx(G["height"], abs=1e-9)  # the gaps go once round the cell
    E = axis_gaps(s, 2, exclude=[16, 17])
    M = axis_gaps(s, 2, exclude=[False] * 16 + [True, True])
    assert E["n"] == 16 and np.array_equal(E["w"], M["w"]) and np.array_equal(E["widths"], M["widths"])
    assert np.array_equal(axis_gaps(s, 2, exclude=np.array([16, 17]))["w"], E["w"])
    assert np.array_equal(axis_gaps(s, 2, exclude=np.arange(18) >= 16)["w"], E["w"])
    assert axis_gaps(s, 2, exclude=range(18)) is None and axis_gaps(s, 2, exclude=[])["n"] == 18
    assert axis_gaps(Structure(["H"], [[0, 0, 0]]), 0) is None  # no cell
    assert axis_gaps(Structure([], [], cell=np.eye(3) * 5), 0) is None  # no atoms


# ----------------------------------------------------------------------------------------------------- the cut
def test_gap_cut_widest_and_the_window():
    s = fcc111()
    cut = gap_cut(s, 2)
    c = s.cell[2, 2]
    assert cut["rule"] == "widest" and cut["blocks"] == 1 and cut["empty"] == cut["width"] == cut["widest"]
    assert cut["lo"] == pytest.approx(cut["center"] - 1) and cut["main"]["count"] == 36
    assert cut["main"]["lower"] == 0.0 and cut["main"]["upper"] * c == pytest.approx(6.7896, abs=1e-4)
    # across the cell boundary (bottom layer at z = 18 Å, two layers wrapped to the bottom): one piece again
    s18 = fcc111(z0=18.0)
    s18.wrap()
    assert s18.positions[:, 2].min() < 1.0 and s18.positions[:, 2].max() > 18.0  # stored in two halves
    cut = gap_cut(s18, 2)
    z = unwrap_along_gap(frac_c(s18), cut) * c
    assert z.max() - z.min() == pytest.approx(3 * 3.92 / math.sqrt(3), abs=1e-9)
    moved = np.count_nonzero(np.floor(frac_c(s18) - cut["lo"]))
    assert moved == 18 and cut["lo"] == cut["center"] < 0.5  # 18 against 18: the window starting below 0.5 moves the upper half


def test_gap_cut_ties_prefer_the_cell_face():
    s = Structure(["Pt", "Pt"], [[0, 0, 5], [0.3, 0, 15]], cell=[[2.77, 0, 0], [-1.385, 2.4, 0], [0, 0, 20]])
    cut = gap_cut(s, 2)
    assert cut["center"] == 0.0 and cut["lo"] == 0.0  # the gap whose middle is on the cell face
    assert (unwrap_along_gap(frac_c(s), cut) * 20).tolist() == pytest.approx([5.0, 15.0])
    g = find_vacuum_gap(s)
    assert g["start"] == pytest.approx(0.25, abs=1e-12)  # the report keeps its own rule: the lower start


def test_gap_cut_floating_molecule_goes_above_the_slab():
    s = with_co(4.0, vacuum=10.0)  # widest single gap 4.85 Å < 5, but 8.85 Å of vacuum below the slab
    cut = gap_cut(s, 2)
    assert cut["rule"] == "below-main" and cut["blocks"] == 2 and cut["widest"] == pytest.approx(4.85, abs=1e-9)
    assert cut["empty"] == pytest.approx(8.85, abs=1e-9) and cut["main"]["count"] == 16
    z = unwrap_along_gap(frac_c(s), cut) * s.cell[2, 2]
    assert z[:16].min() == pytest.approx(0.0, abs=1e-9) and z[16] > z[:16].max()
    alone = gap_cut(s, 2, exclude=[16, 17])
    assert alone["rule"] == "widest" and alone["empty"] == pytest.approx(10.0, abs=1e-9) and alone["main"]["count"] == 16
    z = unwrap_along_gap(frac_c(s), alone) * s.cell[2, 2]
    assert z[:16].min() == pytest.approx(0.0, abs=1e-9) and z[16] > z[:16].max()  # the window still applies to CO


def test_gap_cut_desorption_trajectory_keeps_the_slab_in_place():
    """CO rising through 15 Å of vacuum in 0.05 Å steps: the slab is never moved by the window."""
    jumps = 0
    previous = None
    for h in np.arange(1.85, 15 - 1.6 + 1e-9, 0.05):
        s = with_co(float(h))
        cut = display_cuts(s)[2]
        z = unwrap_along_gap(frac_c(s), cut) * s.cell[2, 2]
        assert z[:16].min() == pytest.approx(0.0, abs=1e-9), h
        if previous is not None and abs(z[16] - previous) > 1:
            jumps += 1
        previous = z[16]
    assert jumps <= 1  # once, when CO comes within 3.5 Å of the image of the bottom layer


def test_gap_cut_heterostructure_cuts_in_the_vacuum():
    sub = [("Au", ((t * 1.37) % 10, (t * 2.71) % 10, (t % 4) * 2.35)) for t in range(36)]
    gap, vac = 3.6, 15.0
    z1 = 3 * 2.35 + gap
    over = [("Mo" if t % 3 == 1 else "S", ((t * 1.91) % 10, (t * 3.17) % 10, z1 + (t % 3) * 1.56)) for t in range(48)]
    c = z1 + 2 * 1.56 + vac
    s = Structure([a for a, _ in sub + over], [p for _, p in sub + over], cell=np.diag([10.0, 10.0, c]))
    cut = gap_cut(s, 2)
    assert cut["rule"] == "widest-between-big" and cut["empty"] == pytest.approx(vac, abs=1e-9)
    z = unwrap_along_gap(frac_c(s), cut) * c
    assert z[36:].min() > z[:36].max()  # the overlayer on top of the substrate


def test_block_threshold_allows_the_tolerance():
    def slab_and_co(o_to_image):
        s = with_co(1.85)
        top = s.cell[2, 2] - 3 * 3.92 / math.sqrt(3)  # the vacuum: 15 Å
        return with_co(top - o_to_image - 1.15)

    for d in (3.5, 3.5 - 4.3e-9, 3.5 - 0.5 * TOL):
        assert gap_cut(slab_and_co(d), 2)["rule"] == "below-main", d  # CO still a block of its own
    assert gap_cut(slab_and_co(3.5 - 2 * TOL), 2)["rule"] == "widest"


def test_gap_cut_hint_and_threshold():
    s = pyridine()
    assert gap_cut(s, 2) is None and find_vacuum_gap(s) is None
    hinted = gap_cut(s, 2, hint=True)
    assert hinted["rule"] == "widest" and hinted["empty"] == pytest.approx(3.3, abs=1e-6)
    assert vacuum_gap_hint(s) == "no vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first"
    with pytest.raises(ValueError, match=r"^no vacuum gap of 5 Å or more along a cell vector \(the widest is 3\.3 Å along c\)"):
        require_gap(s)
    s.info["surface"] = {"axis": 2}
    sn = surface_normal(s)
    assert sn["source"] == "info" and sn["surface"] and sn["cut"] == hinted
    assert find_surface_gap(s) == hinted and display_cuts(s)[2] == hinted and vacuum_axis(s) == 2
    s.info["surface"] = {"axis": 2.0}  # a JSON number
    assert surface_normal(s)["source"] == "info"
    s.info["surface"] = {"axis": True}
    assert surface_normal(s)["source"] == "ab-plane"
    excluded = surface_normal(pyridine(), exclude=list(range(36, 43)))
    assert excluded["source"] == "vacuum" and excluded["cut"]["empty"] == pytest.approx(10.0, abs=1e-9)
    assert vacuum_gap_hint(pyridine(), exclude=list(range(36, 43))) is None


def test_hint_must_still_be_the_widest_vacuum():
    s = fcc111(info={"surface": {"axis": 0}})  # stale: a points along the surface
    sn = surface_normal(s)
    assert sn["source"] == "vacuum" and sn["axis"] == 2
    assert display_cuts(s)[0] is None and gap_cut(s, 0, hint=True) is None
    # after relabelling the axes (new a = old c), the old axis = 2 names an in-plane vector
    t = fcc111(info={"surface": {"axis": 2}})
    t.cell = t.cell[[2, 0, 1]]
    sn = surface_normal(t)
    assert sn["source"] == "vacuum" and sn["axis"] == 0 and sn["normal"] == pytest.approx([0, 0, 1], abs=1e-12)
    assert display_cuts(t)[2] is None and display_cuts(t)[0]["rule"] == "widest"


# ---------------------------------------------------------------------------------------------- the surface
def test_surface_normal_rules():
    assert surface_normal(Structure(["H"], [[0, 0, 0]])) is None  # no cell
    gr = build.crystal("graphene", "C")
    gr.cell[2] = [0, 0, 3.0]  # no 5 Å gap anywhere; one open axis
    sn = surface_normal(gr)
    assert sn["source"] == "pbc" and sn["surface"] and sn["axis"] == 2 and sn["cut"] is None
    assert vacuum_axis(gr) == 2 and find_surface_gap(gr) is None and vacuum_gap_hint(gr) is None
    box = Structure(["C", "O"], [[7.5, 7.5, 7.0], [7.5, 7.5, 8.128]], cell=np.eye(3) * 15)
    sn = surface_normal(box)
    assert sn["source"] == "vacuum" and not sn["surface"] and sn["vacuum_axes"] == [0, 1, 2] and sn["axis"] == 1  # 15 Å along a and b: b
    assert surface_normal(box, require_gap=True) is None and vacuum_axis(box) is None
    assert vacuum_gap_hint(box) == "vacuum gaps along a, b and c: surface tools need a vacuum gap along one cell vector only"
    wire = Structure(["Au", "Au"], [[10, 10, 0], [10, 10, 1.25]], cell=np.diag([20, 20, 2.5]))
    assert vacuum_gap_hint(wire) == "vacuum gaps along a and b: surface tools need a vacuum gap along one cell vector only"
    with pytest.raises(ValueError, match="^vacuum gaps along a and b"):
        require_gap(wire)
    bulk = build.crystal("fcc", "Cu", a=3.61)
    assert surface_normal(bulk, require_gap=True) is None
    assert surface_normal(bulk)["normal"] == [0.0, 0.0, 1.0]
    assert vacuum_gap_hint(Structure(["H"], [[0, 0, 0]])) == "the structure has no unit cell, so it has no vacuum gap"
    assert vacuum_gap_hint(Structure([], [], cell=np.eye(3) * 5)) == "the structure has no atoms, so it has no vacuum gap"


def test_surface_normal_follows_the_cell():
    s = fcc111()
    s.info["surface"] = {"normal": [1, 0, 0]}  # never read
    assert surface_normal(s)["normal"] == [0.0, 0.0, 1.0]
    tilted = fcc111()
    tilted.cell[2] = [1.5, 0.7, tilted.cell[2, 2]]  # c tilted: the normal is a x b, not c
    assert surface_normal(tilted)["normal"] == pytest.approx([0, 0, 1], abs=1e-12)
    for axis, angle in (("x", 90.0), ("z", 30.0)):
        t = math.radians(angle)
        R = (np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]]) if axis == "x"
             else np.array([[math.cos(t), -math.sin(t), 0], [math.sin(t), math.cos(t), 0], [0, 0, 1]]))
        r = Structure(s.symbols, s.positions @ R.T, cell=s.cell @ R.T)
        sn = surface_normal(r)
        assert sn["normal"] == pytest.approx(R @ [0, 0, 1], abs=1e-12) and sn["cut"]["lo"] == pytest.approx(gap_cut(s, 2)["lo"], abs=1e-12)
    flipped = fcc111()
    flipped.cell[2] *= -1  # c reversed: the top is now the other side (+a_k convention)
    sn = surface_normal(flipped)
    assert sn["normal"] == pytest.approx([0, 0, -1], abs=1e-12)
    z = unwrap_along_gap(flipped.frac_positions[:, 2], sn["cut"])
    assert np.argmax(z) in range(9)  # the old bottom layer is the top along +c


# ------------------------------------------------------------------------------------------- unwrapping
def test_unwrap_along_gap_types():
    f = [0.1, 0.9, -0.3, 1.2]
    assert unwrap_along_gap(f, 0.25).tolist() == pytest.approx([1.1, 0.9, 0.7, 1.2])
    assert unwrap_along_gap(np.array(f), {"lo": -0.5, "periodic": True}).tolist() == pytest.approx([0.1, -0.1, -0.3, 0.2])
    assert unwrap_along_gap(f, {"lo": -0.5, "periodic": False}).tolist() == f
    assert unwrap_along_gap(f, None).tolist() == f
    a = np.array(f)
    assert unwrap_along_gap(a, None) is not a
    x = unwrap_along_gap(0.9, {"lo": -0.4})
    assert isinstance(x, float) and x == pytest.approx(-0.1)
    assert unwrap_along_gap(np.float64(0.9), None) == 0.9 and isinstance(unwrap_along_gap(1, 0.5), float)
    assert math.isnan(unwrap_along_gap(math.nan, 0.0))
    for bad in ({"axis": 2, "start": 0.3}, "0.3", True, math.inf, {"lo": None}):
        with pytest.raises(TypeError, match=r"^unwrap_along_gap: pass a cut from gap_cut\(\) or find_surface_gap\(\), a window start, or None$"):
            unwrap_along_gap(f, bad)


# ---------------------------------------------------------------------------------------- explicit edits
def test_contiguous_shifts_and_make_contiguous_on_the_contcar():
    s = read(CONTCAR)
    check = unchanged(s)
    shifts = contiguous_shifts(s, 2)
    assert shifts.dtype == np.int64 and np.flatnonzero(shifts).tolist() == [3, 7] and shifts[3] == -1
    assert check()  # read-only
    t = s.copy()
    z = t.positions[:, 2].copy()
    assert make_contiguous(t, 2) == 2
    assert t.positions[[3, 7], 2] == pytest.approx(z[[3, 7]] - s.cell[2, 2]) and np.array_equal(np.delete(t.positions, [3, 7], 0), np.delete(s.positions, [3, 7], 0))
    assert not contiguous_shifts(t, 2).any() and make_contiguous(t, 2) == 0
    assert t.pbc == s.pbc and np.array_equal(t.cell, s.cell) and t.props == s.props and t.info == s.info


def test_make_contiguous_split_slab_and_whole_cell_displacements():
    s = fcc111()
    bottom = s.positions[:, 2] < 0.1
    s.positions[bottom] += [0, 0, -0.05]
    s.positions[bottom] += s.cell[2]  # the bottom layer wrapped to the top, as a CONTCAR stores it
    t = s.copy()
    assert make_contiguous(t, 2) == 9
    z = t.frac_positions[:, 2]
    assert z.max() - z.min() == pytest.approx((0.05 + 3 * 3.92 / math.sqrt(3)) / s.cell[2, 2], abs=1e-12)
    for k in (1, -1, 2):  # a slab in one piece, a whole number of cells away: no atom moves (shifts 0, -1, +1)
        u = fcc111()
        u.positions += k * u.cell[2]
        if abs(k) == 1:
            assert not contiguous_shifts(u, 2).any()
        else:
            assert np.all(contiguous_shifts(u, 2) == -2)  # every choice moves all: the first (0) of 0, -1, +1
    assert make_contiguous(fcc111(), 0) == 0  # no cut along a
    assert make_contiguous(build.crystal("fcc", "Cu"), 2) == 0  # bulk: no cut
    gr = build.crystal("graphene", "C")
    gr.positions[0, 2] += 15.0
    assert make_contiguous(gr, 2, cut=0.0) == 0  # c is not periodic


def test_make_contiguous_moves_every_frame_by_the_same_cells():
    s = fcc111()
    bottom = np.flatnonzero(s.positions[:, 2] < 0.1)
    s.positions[bottom] += s.cell[2] - [0, 0, 0.02]  # the bottom layer stored 0.02 Å below the top face
    c2 = s.cell.copy()
    c2[2, 2] += 1.0
    jiggle = s.positions + [0.01, 0, 0]
    s.frames = [{"positions": jiggle.copy(), "cell": c2}, {"positions": jiggle.copy()}]
    shifts = contiguous_shifts(s, 2)
    assert np.flatnonzero(shifts).tolist() == bottom.tolist()
    t = s.copy()
    assert make_contiguous(t, 2) == 9
    assert t.positions[bottom, 2] == pytest.approx(s.positions[bottom, 2] - s.cell[2, 2])
    assert t.frames[0]["positions"][bottom, 2] == pytest.approx(jiggle[bottom, 2] - c2[2, 2])  # its own cell
    assert t.frames[1]["positions"][bottom, 2] == pytest.approx(jiggle[bottom, 2] - s.cell[2, 2])
    assert np.array_equal(contiguous_shifts(s, 2, frame=1), shifts)
    assert np.array_equal(contiguous_shifts(s, 2, cut=display_cuts(s)[2]), shifts)
    assert np.array_equal(contiguous_shifts(s, 2, cut=display_cuts(s)[2]["lo"]), shifts)
    with pytest.raises(TypeError, match="^contiguous_shifts: pass a cut from"):
        contiguous_shifts(s, 2, cut=find_vacuum_gap(s))


# ------------------------------------------------------------------------------------- guarantees and errors
@pytest.mark.parametrize("make", [fcc111, pyridine, lambda: read(CONTCAR), lambda: build.crystal("graphene", "C"),
                                  lambda: with_co(4.0, vacuum=10.0)])
def test_analysis_never_changes_the_structure(make):
    s = make()
    check = unchanged(s)
    for k in range(3):
        axis_gaps(s, k)
        gap_cut(s, k, hint=True)
        find_vacuum_gap(s, k, min_width=0)
        contiguous_shifts(s, k)
    find_vacuum_gaps(s, periodic_only=False)
    display_cuts(s)
    surface_normal(s)
    find_surface_gap(s)
    vacuum_axis(s)
    vacuum_gap_hint(s)
    try:
        require_gap(s)
    except ValueError:
        pass
    unwrap_along_gap(s.frac_positions[:, 2], surface_normal(s)["cut"])
    assert check()


def test_argument_errors():
    s = fcc111()
    for bad in (3, -1, 1.5, "c", True):
        with pytest.raises(ValueError, match=r"^axis must be 0, 1, 2 or None \(got "):
            find_vacuum_gap(s, bad)
        with pytest.raises(ValueError, match=r"^axis must be 0, 1 or 2 \(got "):
            gap_cut(s, bad)
    with pytest.raises(ValueError, match=r"axis must be 0, 1 or 2 \(got null\)"):
        axis_gaps(s, None)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match=r'axis must be 0, 1, 2 or None \(got "c"\)'):
        find_vacuum_gap(s, "c")
    assert find_vacuum_gap(s, 2.0) == find_vacuum_gap(s, 2)
    for bad in (-1, math.nan, math.inf, "5"):
        with pytest.raises(ValueError, match=r"^min_width must be a non-negative number"):
            find_vacuum_gap(s, min_width=bad)
    with pytest.raises(IndexError, match=r"^exclude: atom index 36 out of range \(structure has 36 atoms\)$"):
        gap_cut(s, 2, exclude=[36])
    with pytest.raises(IndexError, match="out of range"):
        surface_normal(s, exclude=[-1])
    with pytest.raises(ValueError, match=r"^exclude: a boolean mask needs 36 values \(got 2\)$"):
        surface_normal(s, exclude=[True, False])
    with pytest.raises(TypeError, match=r"^exclude: atom indices must be integers \(got 1.5\)$"):
        gap_cut(s, 2, exclude=[1.5])
    with pytest.raises(TypeError, match=r"^exclude: atom indices must be integers \(got true\)$"):
        gap_cut(s, 2, exclude=[True, 1])
    for bad in ("abc", 5, {"a": 1}):
        with pytest.raises(TypeError, match="^exclude must be a list of atom indices or a boolean mask$"):
            axis_gaps(s, 2, exclude=bad)


def test_non_finite_coordinates_raise():
    """A NaN or infinite coordinate gives a clear error (the JS twin used to loop forever when an axis had at most one
    finite fractional coordinate); an excluded atom does not count."""
    two = Structure(["H", "H"], [[0, 0, 0], [0, 0, 1]], cell=[[5, 0, 0], [0, 5, 0], [0, 0, 20]])
    two.positions[0, 0] = math.nan   # along a only one fractional coordinate is finite; NaN * 0 spoils every axis
    one = Structure(["H"], [[0, 0, 0]], cell=[[5, 0, 0], [0, 5, 0], [0, 0, 20]])
    one.positions[0, 2] = math.inf
    for s in (two, one):
        for fn in (lambda: find_vacuum_gap(s), lambda: find_vacuum_gap(s, 0), lambda: find_vacuum_gaps(s),
                   lambda: find_vacuum_gap(s, 2, min_width=0), lambda: gap_cut(s, 2), lambda: axis_gaps(s, 2),
                   lambda: surface_normal(s), lambda: display_cuts(s), lambda: vacuum_gap_hint(s)):
            with pytest.raises(ValueError, match=r"^positions must be finite numbers$"):
                fn()
    slab = fcc111()
    slab.positions[2, 2] = math.nan
    with pytest.raises(ValueError, match=r"^positions must be finite numbers$"):
        gap_cut(slab, 2)
    assert gap_cut(slab, 2, exclude=[2]) is not None
    slab.positions[2, 2] = 0.0
    assert abs(find_vacuum_gap(slab)["width"] - 15.0) < 1e-9


def test_exports():
    names = ["axis_gaps", "find_vacuum_gaps", "find_vacuum_gap", "gap_cut", "display_cuts", "unwrap_along_gap",
             "surface_normal", "find_surface_gap", "require_gap", "vacuum_axis", "vacuum_gap_hint", "contiguous_shifts",
             "make_contiguous"]
    assert V.__all__ == names
    for name in names:
        assert name in analysis.__all__ and getattr(analysis, name) is getattr(V, name)


def test_performance_budget():
    """F0-D §7.6: three axes of a 10 000-atom slab within 15 ms (here x3 for slow machines)."""
    s = fcc111(n=(25, 25), layers=16)
    assert len(s) == 10000

    def best(fn, runs=3):
        out = []
        for _ in range(runs):
            t0 = time.perf_counter()
            fn()
            out.append(time.perf_counter() - t0)
        return min(out) * 1e3

    assert best(lambda: find_vacuum_gap(s, min_width=0)) < 45
    assert best(lambda: display_cuts(s)) < 150


# ------------------------------------------------------------------------------------------- random parity
def _random_structures(seed=11, count=120):
    """Slabs, floating molecules, heterostructures and boxes with gaps near every threshold, random pbc and hints."""
    rng = np.random.default_rng(seed)
    out = []
    edges = [SURFACE_DEFAULTS.block_gap_min, SURFACE_DEFAULTS.vacuum_gap_min, SURFACE_DEFAULTS.surface_hint_gap_min]
    for i in range(count):
        a, b = rng.uniform(2.5, 9.0, size=2)
        gamma = rng.choice([90.0, 120.0, 60.0, rng.uniform(70, 110)])
        A = np.array([a, 0, 0])
        B = b * np.array([math.cos(math.radians(gamma)), math.sin(math.radians(gamma)), 0])
        z, syms, pos = 0.0, [], []
        for _ in range(rng.integers(1, 4)):  # blocks along c, each starting exactly at z
            spread = rng.uniform(0.1, 8)
            for j in range(rng.integers(1, 30)):
                syms.append("X")
                pos.append(rng.uniform(0, 1) * A + rng.uniform(0, 1) * B + [0, 0, z + (rng.uniform(0, spread) if j else 0.0)])
            top = max(p[2] for p in pos)
            if rng.uniform() < 0.5:  # a gap at a threshold, or a hair either side of it
                step = rng.choice(edges) + rng.choice([0.0, 0.5 * TOL, -0.5 * TOL, 2 * TOL, -2 * TOL])
            else:
                step = rng.uniform(0.5, 12)
            z = top + step
        C = np.array([rng.uniform(-1.5, 1.5), rng.uniform(-1.5, 1.5), z])
        cell = np.array([A, B, C])
        if rng.uniform() < 0.3:  # the vacuum along a instead
            cell = cell[[2, 0, 1]]
        p = np.array(pos) + rng.uniform(-2, 2) * cell[2]
        pbc = [bool(v) for v in rng.uniform(size=3) > 0.15]
        info = {"surface": {"axis": int(rng.integers(0, 3))}} if rng.uniform() < 0.3 else {}
        out.append(Structure(syms, p, cell=cell, pbc=pbc, info=info))
    return out


def _report(s: Structure) -> dict:
    hint = V._hint_axis(s)
    sn = surface_normal(s)
    return {"gaps": find_vacuum_gaps(s, periodic_only=False), "gap": find_vacuum_gap(s),
            "cuts": [gap_cut(s, k, hint=(k == hint)) for k in range(3)], "display": display_cuts(s),
            "normal": None if sn is None else {**{k: v for k, v in sn.items() if k != "vacuum_axes"}, "vacuumAxes": sn["vacuum_axes"]},
            "hint": vacuum_gap_hint(s),
            "shifts": [contiguous_shifts(s, k).tolist() for k in range(3)]}


def test_random_structures_match_js(js):
    """Every result, discrete choice and number, is the same in both languages near every threshold."""
    docs = [s.to_dict(decimals=17) for s in _random_structures()]
    structures = [Structure.from_dict(d) for d in docs]  # both languages read the same numbers
    got = js("""
      const { Structure } = await web('core/structure.js');
      const V = await web('core/vacuum.js');
      return input.map((d) => {
        const s = Structure.fromJSON(d);
        const a = s.info?.surface?.axis, hint = a === 0 || a === 1 || a === 2 ? a : null;
        return { gaps: V.findVacuumGaps(s, { periodicOnly: false }), gap: V.findVacuumGap(s),
                 cuts: [0, 1, 2].map((k) => V.gapCut(s, k, { hint: k === hint })), display: V.displayCuts(s),
                 normal: V.surfaceNormal(s), hint: V.vacuumGapHint(s),
                 shifts: [0, 1, 2].map((k) => Array.from(V.contiguousShifts(s, k))) };
      });
    """, docs)
    rules = set()
    for s, j in zip(structures, got):
        p = _report(s)
        assert j == p, s
        rules.update(c["rule"] for c in p["cuts"] if c)
    assert rules == {"widest", "below-main", "widest-between-big"}
