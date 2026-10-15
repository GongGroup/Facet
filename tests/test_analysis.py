"""Neighbour search, coordination, RDF and summary."""

from __future__ import annotations

import time

import numpy as np

from atomscope import Structure, analysis, build


def _check_offsets(s: Structure) -> None:
    nl = analysis.neighbor_arrays(s)
    vec = s.positions[nl.j] + nl.offset @ s.cell - s.positions[nl.i]
    assert np.allclose(np.linalg.norm(vec, axis=1), nl.distance)


def test_diamond_four_neighbours_pbc():
    si = build.crystal("diamond", "Si")
    cn = analysis.coordination_numbers(si)
    assert cn.tolist() == [4] * 8
    bonds = analysis.neighbors(si)
    assert len(bonds) == 16
    i, j, d, off = bonds[0]
    assert i < j and abs(d - 5.431 * np.sqrt(3) / 4) < 1e-6 and len(off) == 3
    _check_offsets(si)


def test_fcc_twelve_neighbours():
    cu = build.crystal("fcc", "Cu")
    assert analysis.coordination_numbers(cu).tolist() == [12] * 4
    # Single-atom primitive cell: self-image bonds
    prim = Structure(["Cu"], [[0, 0, 0]], cell=[[0, 1.805, 1.805], [1.805, 0, 1.805], [1.805, 1.805, 0]])
    nl = analysis.neighbor_arrays(prim)
    assert len(nl.i) == 6 and analysis.coordination_numbers(prim).tolist() == [12]


def test_unwrapped_positions_and_skewed_cell():
    si = build.crystal("diamond", "Si").repeat(2, 1, 1)
    si.positions += np.array([13.1, -7.7, 2.2])
    assert set(analysis.coordination_numbers(si).tolist()) == {4}
    _check_offsets(si)
    hcp = build.crystal("hcp", "Mg").repeat(2, 2, 2)
    assert set(analysis.coordination_numbers(hcp).tolist()) == {12}
    _check_offsets(hcp)


def test_no_pbc_and_cutoff():
    si = build.crystal("diamond", "Si")
    cn_open = analysis.coordination_numbers(si, pbc=False)
    assert cn_open.max() <= 4 and cn_open.min() < 4
    cu = build.crystal("fcc", "Cu")
    cn = analysis.coordination_numbers(cu, cutoff=3.7)  # 1st + 2nd shell
    assert cn.tolist() == [18] * 4
    water = build.molecule("water")
    assert len(analysis.neighbors(water)) == 2


def test_2d_pbc():
    g = build.crystal("graphene", "C").repeat(3, 3, 1)
    assert set(analysis.coordination_numbers(g).tolist()) == {3}


def test_large_structure_is_fast():
    big = build.crystal("fcc", "Cu").repeat(17, 17, 18)  # 20808 atoms
    t = time.perf_counter()
    cn = analysis.coordination_numbers(big)
    elapsed = time.perf_counter() - t
    assert len(big) > 20000 and set(cn.tolist()) == {12}
    assert elapsed < 5.0


def test_large_cluster_no_pbc():
    sph = build.cluster("sphere", "Au", 30.0)
    t = time.perf_counter()
    cn = analysis.coordination_numbers(sph)
    assert time.perf_counter() - t < 5.0
    assert cn.max() == 12


def test_rdf_peak_and_partial():
    cu = build.crystal("fcc", "Cu").repeat(3, 3, 3)
    r, g = analysis.rdf(cu, rmax=5.0, nbins=100)
    assert abs(r[np.argmax(g)] - 3.61 / np.sqrt(2)) < 0.05
    nacl = build.crystal("rocksalt", "NaCl").repeat(2, 2, 2)
    r, g = analysis.rdf(nacl, rmax=4.0, nbins=80, elements=("Na", "Cl"))
    assert abs(r[np.argmax(g)] - 2.82) < 0.05


def test_summary():
    s = analysis.summary(build.crystal("perovskite", "SrTiO3"))
    assert s["formula"] == "SrTiO3" and s["natoms"] == 5
    assert s["cellpar"] == [3.905, 3.905, 3.905, 90.0, 90.0, 90.0]
    assert s["spacegroup"] == "Pm-3m" and 5.0 < s["density"] < 5.2
    m = analysis.summary(build.molecule("water"))
    assert m["volume"] is None and m["cellpar"] is None and m["composition"] == {"H": 2, "O": 1}
