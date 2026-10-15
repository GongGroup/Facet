"""Tests for the Structure model and lattice helpers."""

from __future__ import annotations

import json

import numpy as np
import pytest

from atomscope import Structure, build
from atomscope.core.lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell, frac_to_cart


def test_to_dict_from_dict_roundtrip():
    s = Structure(["Na", "Cl"], [[0, 0, 0], [2.8200001234, 2.82, 2.82]], cell=np.eye(3) * 5.64,
                  props={"charges": [1.0, -1.0]}, info={"source": "test"}, name="NaCl",
                  frames=[{"positions": [[0.1, 0, 0], [2.9, 2.82, 2.82]]}])
    d = s.to_dict()
    assert d["schema"] == "atomscope.structure/1"
    assert set(d) == {"schema", "name", "symbols", "positions", "cell", "pbc", "frames", "props", "info"}
    assert d["positions"][1][0] == 2.82  # rounded to 6 decimals
    assert d["pbc"] == [True, True, True]
    json.dumps(d)  # JSON serialisable
    s2 = Structure.from_dict(d)
    assert s2.symbols == s.symbols
    assert np.allclose(s2.positions, s.positions, atol=1e-6)
    assert np.allclose(s2.cell, s.cell)
    assert s2.n_frames == 2
    assert s2.props["charges"] == [1.0, -1.0]
    assert s2.to_dict() == d


def test_molecule_without_cell():
    s = Structure(["O", "H", "H"], [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]])
    d = s.to_dict()
    assert d["cell"] is None and d["pbc"] == [False, False, False]
    assert s.volume is None and s.density is None
    with pytest.raises(ValueError):
        s.repeat(2, 2, 2)


def test_from_dict_validation():
    with pytest.raises(ValueError):
        Structure.from_dict({"symbols": ["H", "H"], "positions": [[0, 0, 0]]})
    with pytest.raises(ValueError):
        Structure.from_dict({"positions": []})
    with pytest.raises(ValueError):
        Structure.from_dict({"schema": "other/1", "symbols": [], "positions": []})


@pytest.mark.parametrize(
    "structure, formula",
    [
        (build.molecule("C60"), "C60"),
        (build.crystal("perovskite", "SrTiO3"), "SrTiO3"),
        (build.crystal("fcc", "Cu").repeat(3, 3, 3), "Cu108"),
        (build.molecule("caffeine"), "C8H10N4O2"),
        (build.crystal("rocksalt", ["Na", "Cl"]), "Na4Cl4"),
    ],
)
def test_formula(structure, formula):
    assert structure.formula == formula


def test_formula_modes_and_composition():
    s = build.crystal("perovskite", "SrTiO3")
    assert s.get_formula("hill") == "O3SrTi"
    assert s.composition == {"Sr": 1, "Ti": 1, "O": 3}
    assert build.crystal("rocksalt", "NaCl").get_formula(reduce=True) == "NaCl"


def test_repeat_wrap_center_translate():
    cu = build.crystal("fcc", "Cu", a=3.61)
    big = cu.repeat(2, 3, 1)
    assert len(big) == 24
    assert np.allclose(big.cell, np.diag([7.22, 10.83, 3.61]))
    assert abs(big.volume - 6 * cu.volume) < 1e-9
    s = cu.copy().translate([10.0, -4.0, 0.5]).wrap()
    f = s.frac_positions
    assert np.all(f >= -1e-9) and np.all(f < 1)
    w = build.molecule("water").center(vacuum=5.0)
    lo, hi = w.bounding_box
    assert w.cell is not None
    assert np.allclose(lo, 5.0) and np.allclose(np.diag(w.cell) - hi, 5.0)


def test_density():
    cu = build.crystal("fcc", "Cu", a=3.61)
    assert abs(cu.density - 8.97) < 0.02


def test_geometry_helpers():
    w = build.molecule("water")
    assert 100 < w.get_angle(1, 0, 2) < 110
    assert abs(w.get_distance(0, 1) - 0.969) < 1e-3
    # Dihedral of a planar cis/trans arrangement
    s = Structure(["C"] * 4, [[1, 1, 0], [0, 0, 0], [0, 0, 1.5], [1, 1, 1.5]])
    assert abs(s.get_dihedral(0, 1, 2, 3)) < 1e-6
    s.positions[3] = [-1, -1, 1.5]
    assert abs(s.get_dihedral(0, 1, 2, 3) - 180) < 1e-6
    # minimum image
    box = Structure(["H", "H"], [[0.1, 0, 0], [9.9, 0, 0]], cell=np.eye(3) * 10)
    assert abs(box.get_distance(0, 1) - 9.8) < 1e-9
    assert abs(box.get_distance(0, 1, mic=True) - 0.2) < 1e-9


def test_append_extend_delete_select():
    s = build.molecule("water")
    s.set_prop("charge", [-0.8, 0.4, 0.4])
    s.append("He", [5, 5, 5], charge=0.0)
    assert len(s) == 4 and s.props["charge"][-1] == 0.0
    s.extend(build.molecule("methane"))
    assert len(s) == 9 and s.props["charge"][-1] is None
    only_h = s.select(elements="H")
    assert set(only_h.symbols) == {"H"} and len(only_h) == 6
    s.delete([0, -1])
    assert len(s) == 7 and s.symbols[0] == "H"


def test_frames():
    a = build.molecule("water")
    b = a.copy().translate([1, 0, 0])
    traj = Structure.from_frames([a, b, b.copy().translate([1, 0, 0])])
    assert traj.n_frames == 3
    assert np.allclose(traj.get_frame(-1).positions, a.positions + [2, 0, 0])
    assert len(list(traj.iter_frames())) == 3


def test_lattice_roundtrip():
    cell = cellpar_to_cell(3.0, 4.0, 5.0, 80.0, 95.0, 110.0)
    assert np.allclose(cell_to_cellpar(cell), (3.0, 4.0, 5.0, 80.0, 95.0, 110.0))
    frac = np.array([[0.1, 0.2, 0.3], [0.9, 0.5, 0.0]])
    assert np.allclose(cart_to_frac(frac_to_cart(frac, cell), cell), frac)
    with pytest.raises(ValueError):
        cellpar_to_cell(1, 1, 1, 10, 10, 170)
