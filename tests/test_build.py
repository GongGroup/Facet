"""Builder tests: atom counts, metadata and geometry sanity."""

from __future__ import annotations

import numpy as np
import pytest

from atomscope import build
from atomscope.analysis import distance_matrix


@pytest.mark.parametrize(
    "prototype, elements, natoms",
    [
        ("sc", "Po", 1), ("bcc", "Fe", 2), ("fcc", "Cu", 4), ("hcp", "Mg", 2), ("diamond", "Si", 8),
        ("zincblende", ["Ga", "As"], 8), ("wurtzite", ["Zn", "O"], 4), ("rocksalt", ["Na", "Cl"], 8),
        ("cscl", ["Cs", "Cl"], 2), ("fluorite", ["Ca", "F"], 12), ("perovskite", ["Sr", "Ti", "O"], 5),
        ("rutile", ["Ti", "O"], 6), ("graphene", "C", 2), ("mos2", ["Mo", "S"], 3), ("graphite", "C", 4),
    ],
)
def test_prototype_atom_counts(prototype, elements, natoms):
    s = build.crystal(prototype, elements)
    assert len(s) == natoms
    assert s.info["prototype"] == prototype
    assert s.info["spacegroup"] == build.PROTOTYPES[prototype]["spacegroup"]
    assert build.PROTOTYPES[prototype]["atomsPerCell"] == natoms
    # no two atoms closer than 1 Å (minimum image)
    d = distance_matrix(s.positions, s.cell, s.pbc)
    np.fill_diagonal(d, np.inf)
    assert d.min() > 1.0


def test_compositions_and_params():
    assert build.crystal("fluorite", ["Ca", "F"]).formula == "Ca4F8"
    assert build.crystal("fluorite", ["Ca", "F"]).get_formula(reduce=True) == "CaF2"
    assert build.crystal("rutile", ["Ti", "O"]).get_formula(reduce=True) == "TiO2"
    assert build.crystal("perovskite", "Ba Ti O", a=4.0).formula == "BaTiO3"
    assert build.crystal("rocksalt", "MgO").get_formula(reduce=True) == "MgO"
    g = build.crystal("graphene", "C", vacuum=10.0)
    assert abs(g.cell[2, 2] - 20.0) < 1e-9 and g.pbc == [True, True, False]
    w = build.crystal("wurtzite", ["Ga", "N"], u=0.377)
    assert w.info["u"] == 0.377
    hcp = build.crystal("hcp", "Cu", a=2.5)
    assert abs(hcp.info["c"] / 2.5 - np.sqrt(8 / 3)) < 1e-6


def test_crystal_defaults_and_errors():
    cu = build.crystal("fcc", "Cu")
    assert cu.info["a"] == 3.61
    au = build.crystal("fcc", "Au")
    assert au.info["a"] == 4.08
    with pytest.raises(ValueError):
        build.crystal("nonsense", "Cu")
    with pytest.raises(ValueError):
        build.crystal("rocksalt", ["Na"])


def test_supercell_and_prototype_repeat():
    s = build.supercell(build.crystal("fcc", "Cu"), 3, 3, 3)
    assert len(s) == 108 and s.formula == "Cu108"
    s2 = build.crystal("diamond", "Si", repeat=(2, 2, 2))
    assert len(s2) == 64


@pytest.mark.parametrize("shells, natoms", [(1, 1), (2, 13), (3, 55), (4, 147), (5, 309)])
def test_icosahedron_shells(shells, natoms):
    assert len(build.cluster("icosahedron", "Au", shells)) == natoms


@pytest.mark.parametrize("shells, natoms", [(2, 13), (3, 55), (4, 147)])
def test_cuboctahedron_shells(shells, natoms):
    assert len(build.cluster("cuboctahedron", "Cu", shells)) == natoms


def test_other_clusters():
    assert [len(build.cluster("octahedron", "Pt", n)) for n in (2, 3, 4)] == [6, 19, 44]
    assert [len(build.cluster("tetrahedron", "Pd", n)) for n in (2, 3, 4)] == [4, 10, 20]
    assert [len(build.cluster("decahedron", "Ag", n)) for n in (2, 3, 4)] == [7, 23, 54]
    assert len(build.cluster("decahedron", "Ag", 4, ino=1)) < 54
    sph = build.cluster("sphere", "Au", 6.0)
    assert np.linalg.norm(sph.positions, axis=1).max() <= 6.0 + 1e-6
    assert len(build.cluster("sphere", "Au", 3.0)) == 13


def test_cluster_geometry_nearest_neighbour():
    ico = build.cluster("icosahedron", "Cu", 3)
    d = distance_matrix(ico.positions)
    np.fill_diagonal(d, np.inf)
    assert abs(d.min() - 3.61 / np.sqrt(2)) < 0.01  # radial nn = a/sqrt(2)
    assert ico.cell is None and ico.pbc == [False, False, False]
    assert np.allclose(ico.positions.mean(axis=0), 0, atol=1e-9)
    x = build.cluster("cuboctahedron", "Xe", 2, a=6.2)
    d = distance_matrix(x.positions)
    np.fill_diagonal(d, np.inf)
    assert abs(d.min() - 6.2 / np.sqrt(2)) < 1e-6


def test_c60():
    c60 = build.cluster("fullerene")
    assert len(c60) == 60 and set(c60.symbols) == {"C"}
    d = distance_matrix(c60.positions)
    np.fill_diagonal(d, np.inf)
    nn = np.sort(d, axis=1)[:, :3]
    assert np.allclose(np.sort(np.unique(np.round(nn, 3))), [1.391, 1.455])
    assert len(build.molecule("C60")) == 60
    assert build.cluster("fullerene", "B").symbols[0] == "B"


def test_molecules():
    for name in build.molecule_names():
        m = build.molecule(name)
        assert len(m) > 0 and m.cell is None
    assert build.molecule("H2O").formula == "H2O"
    assert build.molecule("caffeine").formula == "C8H10N4O2"
    assert build.molecule("benzene").formula == "C6H6"
    with pytest.raises(ValueError):
        build.molecule("unobtainium")
