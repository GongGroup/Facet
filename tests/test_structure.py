"""Tests for the Structure model and lattice helpers.

The data core of F0-D T1 (``crystallume.core.structure`` and ``core.naming``) has its shared cases in
``tests/data/surface/f0d/props.json``, ``sourcemap.json`` and ``edits.json`` (both languages, ``tests/test_cases.py``);
the tests here cover the Python API in detail: the props invariants and defaults, ``_remap`` and the methods built on
it, source maps and tracking sessions, notes, ``mark_edited``, the atom order and the repeat suffix.
"""

from __future__ import annotations

import copy
import json
import pickle

import numpy as np
import pytest

from crystallume import Structure, build
from crystallume.core import structure as st
from crystallume.core.lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell, frac_to_cart
from crystallume.core.naming import TIMES, add_repeat_suffix, format_repeat
from crystallume.core.structure import (
    BUILD_INFO_KEYS,
    EDIT_KINDS,
    PROP_DEFAULTS,
    RESULT_INFO,
    RESULT_PROPS,
    SYMMETRY_INFO_KEYS,
    ChangeTracker,
    add_warning,
    canonical_order,
    compose_source_maps,
    concat_structures,
    copy_value,
    default_for,
    get_warnings,
    invert_source_map,
    mark_edited,
    new_warnings,
    normalize_warnings,
    poscar_order,
)
from crystallume.io import parse_text, to_text

T, F = True, False


def test_to_dict_from_dict_roundtrip():
    s = Structure(["Na", "Cl"], [[0, 0, 0], [2.8200001234, 2.82, 2.82]], cell=np.eye(3) * 5.64,
                  props={"charges": [1.0, -1.0]}, info={"source": "test"}, name="NaCl",
                  frames=[{"positions": [[0.1, 0, 0], [2.9, 2.82, 2.82]]}])
    d = s.to_dict()
    assert d["schema"] == "crystallume.structure/1"
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


def test_former_name_documents_still_load():
    """Files written while the package was called AtomScope keep opening."""
    from crystallume import Structure
    from crystallume.project import normalize_project

    s = Structure.from_dict({"schema": "atomscope.structure/1", "symbols": ["H"], "positions": [[0, 0, 0]]})
    assert len(s) == 1
    doc = normalize_project({"schema": "atomscope.project/1", "name": "old", "structures": []})
    assert doc["schema"] == "crystallume.project/1"


def test_former_name_environment_variables(tmp_path):
    from crystallume.config import Settings

    s = Settings.from_env({"ATOMSCOPE_PORT": "9123", "CRYSTALLUME_MODE": "local", "ATOMSCOPE_DATA_DIR": str(tmp_path)})
    assert s.port == 9123 and s.data_dir == tmp_path
    s2 = Settings.from_env({"ATOMSCOPE_PORT": "9123", "CRYSTALLUME_PORT": "9200"})
    assert s2.port == 9200


def test_former_name_cloud_database(tmp_path):
    """A data directory from before the rename keeps using its atomscope.db."""
    from crystallume.config import Settings
    from crystallume.storage.sqlite import SQLiteStore

    s = Settings(mode="cloud", data_dir=tmp_path)
    assert s.db_path == tmp_path / "crystallume.db"   # nothing there yet: the new name
    old = SQLiteStore(tmp_path / "atomscope.db", secret="x" * 32)
    old.create_user("alice", "correct horse battery")
    old.close()
    assert s.db_path == tmp_path / "atomscope.db"
    # also when an earlier start already created an empty crystallume.db next to it
    SQLiteStore(tmp_path / "crystallume.db", secret="x" * 32).close()
    assert s.db_path == tmp_path / "atomscope.db"
    new = SQLiteStore(tmp_path / "crystallume.db", secret="x" * 32)
    new.create_user("bob", "correct horse battery")
    new.close()
    assert s.db_path == tmp_path / "crystallume.db"   # a crystallume.db that holds data wins


# ------------------------------------------------------------------------------------------- props and remap
def _slab(n: int = 4, **props) -> Structure:
    """*n* Pt atoms in a 2.5 Å row inside a periodic cell, with the given per-atom properties."""
    return Structure(["Pt"] * n, [[2.5 * i, 0, 0] for i in range(n)], cell=[[2.5 * n, 0, 0], [0, 5, 0], [0, 0, 15]],
                     props=props)


def test_prop_tables():
    assert dict(PROP_DEFAULTS) == {
        "selective_dynamics": (T, T, T), "tags": 0, "adsorbate_id": 0, "occupancy": 1.0, "residue_names": "MOL",
        "residue_ids": 1, "chain_ids": "A", "residue": "MOL", "momenta": (0.0, 0.0, 0.0),
        "velocities": (0.0, 0.0, 0.0), "initial_magmoms": 0.0, "initial_charges": 0.0}
    with pytest.raises(TypeError):
        PROP_DEFAULTS["tags"] = 1  # type: ignore[index]
    assert all(not isinstance(v, list) for v in PROP_DEFAULTS.values())  # sequences are tuples
    assert st.PROP_SYMBOL_DEFAULT == ("labels", "label", "atom_names")
    assert st.PROP_SHAPED_ZERO == ("momenta", "velocities", "initial_magmoms", "initial_charges")
    assert RESULT_PROPS == ("energies", "forces", "stresses", "charges", "magmoms", "born_effective_charges", "dipoles")
    assert not set(RESULT_PROPS) & set(PROP_DEFAULTS)
    assert RESULT_INFO == ("energy", "free_energy", "stress", "virial", "dipole", "magmom", "polarization",
                           "dielectric_tensor")
    assert SYMMETRY_INFO_KEYS == ("spacegroup", "spacegroupNumber", "formulaSum")
    assert BUILD_INFO_KEYS == ("prototype", "a", "c", "u", "thickness")
    assert st.CARTESIAN_VECTOR_PROPS == ("velocities", "momenta", "initial_magmoms")
    assert EDIT_KINDS == ("order", "translate", "rotate", "positions", "atoms", "symbols", "repeat", "cell", "pbc")


def test_copy_value():
    for v in (None, True, 3, 2.5, "x", np.float64(1.5), np.int64(2)):
        assert copy_value(v) is v
    flat = [1, 2.0, "a", None, T]
    assert copy_value(flat) == flat and copy_value(flat) is not flat
    assert copy_value((1, 2)) == [1, 2]
    nested = [[1, 2], {"a": [3]}]
    out = copy_value(nested)
    assert out == nested and out[0] is not nested[0] and out[1]["a"] is not nested[1]["a"]


def test_default_for():
    assert default_for("selective_dynamics", "H", None) == [T, T, T]
    a, b = default_for("selective_dynamics", "H", None), default_for("selective_dynamics", "H", None)
    assert a is not b  # a new list each time
    assert default_for("labels", "Pt", ["x"]) == "Pt" and default_for("atom_names", "O", None) == "O"
    assert default_for("masses", "Pt", None) == pytest.approx(195.084)
    assert default_for("poscar_species", "H", ["Ga", "As", "H.75", "H1.25"]) == "H.75"
    assert default_for("poscar_species", "H", ["Ga", "H#2", "H"]) == "H#2"
    assert default_for("poscar_species", "Ti", ["Ga", "H"]) == "Ti"
    assert default_for("initial_magmoms", "Fe", [None, [0.0, 0.0, 2.0]]) == [0.0, 0.0, 0.0]
    assert default_for("initial_magmoms", "Fe", [2.0]) == 0.0
    assert default_for("velocities", "H", None) == [0.0, 0.0, 0.0]
    assert default_for("charge", "Na", [1.0]) is None and default_for("forces", "Na", None) is None


def test_append_gives_defaults_not_none():
    s = _slab(2, selective_dynamics=[[F, F, F]] * 2, tags=[2, 1], adsorbate_id=[0, 0], labels=["a", "b"],
              masses=[195.084] * 2, initial_magmoms=[[0, 0, 1.0]] * 2, poscar_species=["Pt", "Pt#2"], charge=[0.5, 0.5])
    s.append("o", [0, 0, 5])
    assert s.symbols[-1] == "O"
    assert s.props["selective_dynamics"][-1] == [T, T, T] and s.props["tags"][-1] == 0
    assert s.props["adsorbate_id"][-1] == 0 and s.props["labels"][-1] == "O"
    assert s.props["masses"][-1] == pytest.approx(15.999) and s.props["initial_magmoms"][-1] == [0.0, 0.0, 0.0]
    assert s.props["poscar_species"][-1] == "O" and s.props["charge"][-1] is None
    assert all(len(v) == 3 for v in s.props.values())
    # a POSCAR written after the append still has its Selective dynamics block (it vanished with a None row)
    assert "Selective dynamics" in to_text(s, "poscar")
    s.append("Pt", [1, 1, 1], tags=7, spin="up")
    assert s.props["tags"][-1] == 7 and s.props["spin"] == [None, None, None, "up"]
    assert s.props["poscar_species"][-1] == "Pt"   # the first Pt block


def test_set_prop_copies_normalizes_and_returns_self():
    s = _slab(3)
    row = [T, T, F]
    assert s.set_prop("selective_dynamics", [row] * 3) is s
    s.props["selective_dynamics"][0][2] = T
    assert s.props["selective_dynamics"][1] == [T, T, F] and row == [T, T, F]   # rows are not shared
    s.set_prop("selective_dynamics", np.array([[1, 0, 1]] * 3))
    assert s.props["selective_dynamics"] == [[T, F, T]] * 3
    s.set_prop("tags", [1, "x", None])
    assert s.props["tags"] == [1, 0, 0]
    assert s.info["warnings"] == ["tags: 2 invalid value(s) were replaced by 0"]
    with pytest.raises(ValueError, match=r"^property 'tags' has 2 values but there are 3 atoms$"):
        s.set_prop("tags", [1, 2])
    with pytest.raises(TypeError, match="must be a list"):
        s.set_prop("tags", "abc")
    assert s.remove_prop("tags") is s and "tags" not in s.props
    s.remove_prop("tags")   # no error when missing


def test_constructor_copies_its_inputs():
    flags = [[T, T, F], [F, F, F]]
    info = {"surface": {"miller": [1, 1, 1]}}
    s = Structure(["Pt", "Pt"], [[0, 0, 0], [1, 0, 0]], props={"selective_dynamics": flags, "groups": [[1], [2]]},
                  info=info)
    flags[0][2] = T
    info["surface"]["miller"][0] = 9
    assert s.props["selective_dynamics"][0] == [T, T, F] and s.info["surface"]["miller"] == [1, 1, 1]
    bad = Structure(["Pt"], [[0, 0, 0]], props={"tags": ["x"]}, info={"warnings": ["read"]})
    assert bad.props["tags"] == [0] and bad.info["warnings"] == ["read", "tags: 1 invalid value(s) were replaced by 0"]


def test_copy_shares_nothing():
    s = _slab(2, selective_dynamics=[[T, T, F]] * 2, groups=[[1], [2]])
    s.info["surface"] = {"miller": [1, 1, 1]}
    c = s.copy()
    c.props["selective_dynamics"][0][0] = F
    c.props["groups"][0].append(5)
    c.info["surface"]["miller"][0] = 2
    assert s.props["selective_dynamics"][0] == [T, T, F] and s.props["groups"][0] == [1]
    assert s.info["surface"]["miller"] == [1, 1, 1]


def test_repeat_images_are_independent():
    s = _slab(2, selective_dynamics=[[T, T, F], [F, F, F]], groups=[[1], [2]])
    r = s.repeat(2, 1, 1)
    r.props["selective_dynamics"][0][0] = F
    r.props["groups"][0].append(9)
    assert r.props["selective_dynamics"][2] == [T, T, F] and r.props["groups"][2] == [1]
    assert s.props["selective_dynamics"][0] == [T, T, F] and s.props["groups"][0] == [1]
    assert r.source_map.tolist() == [0, 1, 0, 1]


def test_repeat_counts_names_and_supercell_matrix():
    cu = build.crystal("fcc", "Cu", a=3.61)
    big = cu.repeat(2, 2, 1)
    assert big.name == "Cu fcc 2×2×1" and big.info["supercell"] == [2, 2, 1]
    assert big.info["supercellMatrix"] == [[2, 0, 0], [0, 2, 0], [0, 0, 1]]
    again = big.repeat((2, 1, 1))
    assert again.name == "Cu fcc 4×2×1" and again.info["supercell"] == [2, 1, 1]
    assert again.info["supercellMatrix"] == [[4, 0, 0], [0, 2, 0], [0, 0, 1]]
    assert len(cu.repeat(2.0, 1, 1)) == 8
    for bad, shown in ((1.5, "1.5"), (0, "0"), (-1, "-1"), (True, "true")):
        with pytest.raises(ValueError, match=rf"^repeat counts must be whole numbers >= 1 \(got {shown}\)$"):
            cu.repeat(bad, 1, 1)
    with pytest.raises(ValueError, match="repeat needs 3 counts"):
        cu.repeat((2, 2))
    old = Structure(["Cu"], [[0, 0, 0]], cell=np.eye(3) * 3.6, name="Cu fcc 2x2x2", info={"supercell": [2, 2, 2]})
    assert old.repeat(2, 1, 1).name == "Cu fcc 4×2×2"


def test_repeat_tiles_every_frame_and_keeps_the_space_group():
    s = Structure(["H"], [[0.5, 0.5, 0.5]], cell=np.eye(3) * 2, info={"spacegroup": "Pm-3m", "energy": -1.0},
                  frames=[{"positions": [[0.6, 0.5, 0.5]], "cell": np.eye(3) * 3}, {"positions": [[0.7, 0.5, 0.5]]}])
    r = s.repeat(2, 1, 1)
    assert r.n_frames == 3
    assert np.allclose(r.frames[0]["positions"], [[0.6, 0.5, 0.5], [3.6, 0.5, 0.5]])
    assert np.allclose(r.frames[0]["cell"], np.diag([6.0, 3, 3])) and "cell" not in r.frames[1]
    assert np.allclose(r.frames[1]["positions"], [[0.7, 0.5, 0.5], [2.7, 0.5, 0.5]])
    assert r.info["spacegroup"] == "Pm-3m" and "energy" not in r.info
    assert s.info["energy"] == -1.0   # the original is untouched


def test_extend_copies_renumbers_and_converts_flags():
    slab = _slab(2, adsorbate_id=[0, 1], selective_dynamics=[[F, F, F], [T, T, T]])
    co = Structure(["C", "O"], [[1, 1, 4], [1, 1, 5.15]], props={"adsorbate_id": [1, 1], "groups": [[1], [2]]})
    slab.extend(co)
    assert slab.props["adsorbate_id"] == [0, 1, 2, 2]
    assert slab.props["selective_dynamics"][2:] == [[T, T, T], [T, T, T]]
    assert slab.props["groups"] == [None, None, [1], [2]]
    slab.props["groups"][2].append(3)
    assert co.props["groups"][0] == [1]   # copied, not shared
    assert slab.source_map.tolist() == [0, 1, -1, -1]
    keep = _slab(2, adsorbate_id=[0, 1]).extend(co, renumber_adsorbates=False)
    assert keep.props["adsorbate_id"] == [0, 1, 1, 1]
    tilted = Structure(["O", "O"], [[1, 1, 6], [3, 3, 6]], cell=[[10, 0, 0], [0, 5, 0], [2, 0, 15]],
                       props={"selective_dynamics": [[T, T, F], [F, F, T]]})
    target = _slab(4)
    target.extend(tilted)
    assert target.props["selective_dynamics"][4:] == [[T, T, F], [F, F, F]]
    assert target.info["warnings"] == [st._TIGHTENED.format(n=1)]
    with pytest.raises(TypeError, match="^extend expects a Structure$"):
        target.extend({"symbols": ["H"]})  # type: ignore[arg-type]


def test_extend_frames():
    a = Structure(["H"], [[0, 0, 0]], cell=np.eye(3) * 5, frames=[{"positions": [[0, 0, 0.1]]}])
    b = Structure(["H"], [[0, 0, 1]], cell=np.eye(3) * 5, frames=[{"positions": [[0, 0, 1.1]]}])
    a.extend(b)
    assert a.n_frames == 2 and np.allclose(a.frames[0]["positions"], [[0, 0, 0.1], [0, 0, 1.1]])
    a.extend(Structure(["H"], [[0, 0, 2]], cell=np.eye(3) * 5))
    assert a.n_frames == 1 and "frames dropped by extend(): frame counts differ" in a.info["warnings"]
    extend_self = Structure(["H"], [[0, 0, 0]], cell=np.eye(3) * 5)
    extend_self.extend(extend_self)
    assert len(extend_self) == 2


def test_concat_structures():
    slab = _slab(2, tags=[2, 1], selective_dynamics=[[F, F, F], [T, T, T]], adsorbate_id=[0, 1])
    slab.name = "slab"
    slab.info["spacegroup"] = "P1"
    co = Structure(["C", "O"], [[1, 1, 4], [1, 1, 5.15]], props={"adsorbate_id": [1, 1], "labels": ["C1", "O1"]},
                   frames=[{"positions": [[1, 1, 4.1], [1, 1, 5.2]]}])
    h = Structure(["H"], [[2, 2, 7]], props={"adsorbate_id": [1]})
    out = concat_structures([slab, co, h])
    assert out.symbols == ["Pt", "Pt", "C", "O", "H"] and out.name == "slab"
    assert out.props["tags"] == [2, 1, 0, 0, 0] and out.props["adsorbate_id"] == [0, 1, 2, 2, 3]
    assert out.props["labels"] == ["Pt", "Pt", "C1", "O1", "H"]
    assert out.source_map.tolist() == [0, 1, -1, -1, -1]
    assert np.allclose(out.positions[2:4], co.positions)    # part 1 occupies [2, 4)
    assert out.n_frames == 1 and out.info["warnings"] == ["frames were dropped when the structures were combined"]
    assert "spacegroup" not in out.info and slab.info["spacegroup"] == "P1"    # the parts are unchanged
    assert len(slab) == 2 and co.n_frames == 2
    other = concat_structures([slab, co], cell=np.eye(3) * 30, pbc=[T, T, F], defaults={"tags": 5})
    assert np.allclose(other.cell, np.eye(3) * 30) and other.pbc == [T, T, F] and other.props["tags"] == [2, 1, 5, 5]
    with pytest.raises(ValueError, match="^concat_structures needs at least one structure$"):
        concat_structures([])
    with pytest.raises(TypeError, match="^concat_structures expects Structure objects$"):
        concat_structures([slab, "x"])  # type: ignore[list-item]
    with pytest.raises(TypeError, match="^concat_structures expects Structure objects$"):
        concat_structures(slab)  # type: ignore[arg-type]


def test_delete_indices():
    s = _slab(5, labels=list("abcde"))
    s.delete([-1, 0, 0])
    assert s.props["labels"] == ["b", "c", "d"] and s.source_map.tolist() == [1, 2, 3]
    with pytest.raises(IndexError, match=r"^atom index 3 out of range \(structure has 3 atoms\)$"):
        s.delete(3)
    with pytest.raises(IndexError, match=r"^atom index -4 out of range \(structure has 3 atoms\)$"):
        s.delete([-4])
    with pytest.raises(TypeError, match=r"^atom indices must be integers \(got 1.5\)$"):
        s.delete([1.5])
    with pytest.raises(TypeError, match=r"^atom indices must be integers \(got true\)$"):
        s.delete([True])
    s.delete(np.array([1]))
    assert s.props["labels"] == ["b", "d"]
    before = s.source_map
    s.delete([])
    assert s.source_map is before   # nothing deleted: no remap


def test_select():
    s = _slab(4, labels=list("abcd"))
    s.symbols[1] = "Au"
    s.info.update(spacegroup="P1", energy=-1.0)
    sub = s.select(elements="Pt", indices=[3, 1, 0])
    assert sub.props["labels"] == ["a", "d"] and sub.source_map.tolist() == [0, 3]
    assert "spacegroup" not in sub.info and "energy" not in sub.info and s.info["spacegroup"] == "P1"
    full = s.select(mask=[T, T, T, T])
    assert full.info["spacegroup"] == "P1" and full.source_map.tolist() == [0, 1, 2, 3]
    with pytest.raises(ValueError, match=r"^mask needs 4 values \(got 2\)$"):
        s.select(mask=[T, F])


def test_remap():
    s = _slab(3, labels=["a", "b", "c"], tags=[1, 2, 3])
    assert s._remap([2, None, 0], new_symbols=["H"], new_positions=[[0, 0, 9]], added_props={"tags": [7]},
                    defaults={"labels": "new"}) is s
    assert s.symbols == ["Pt", "H", "Pt"] and np.allclose(s.positions[1], [0, 0, 9])
    assert s.props["labels"] == ["c", "new", "a"] and s.props["tags"] == [3, 7, 1]
    assert s.source_map.tolist() == [2, -1, 0]
    with pytest.raises(IndexError, match=r"^source index 3 out of range \(structure has 3 atoms\)$"):
        s._remap([3])
    with pytest.raises(IndexError, match=r"^source index -2 out of range"):
        s._remap([-2])
    for kw in ({"new_positions": [[0, 0, 1]]}, {"new_symbols": ["H"]},
               {"symbols": ["Pt", "H"], "new_symbols": ["H"], "new_positions": [[0, 0, 1]]}):
        with pytest.raises(ValueError, match="^new atoms need symbols and positions$"):
            s._remap([0, -1], **kw)
    with pytest.raises(ValueError, match=r"^remap: 1 new atom\(s\) but 2 new symbol\(s\)$"):
        s._remap([0, -1], new_symbols=["H", "O"], new_positions=[[0, 0, 1]])
    with pytest.raises(ValueError, match=r"^added property 'tags' has 2 values for 1 new atom\(s\)$"):
        s._remap([0, -1], new_symbols=["H"], new_positions=[[0, 0, 1]], added_props={"tags": [1, 2]})
    with pytest.raises(TypeError, match="source map entries must be atom indices"):
        s._remap([0.5])
    assert s.symbols == ["Pt", "H", "Pt"]   # errors change nothing
    s.props["tags"].append(4)               # changed by hand: misaligned
    with pytest.raises(ValueError, match=r"^property 'tags' has 4 values but there are 3 atoms$"):
        s._remap([0, 1, 2])


def test_remap_frames():
    s = Structure(["H", "H"], [[0, 0, 0], [0, 0, 1]], cell=np.eye(3) * 5,
                  frames=[{"positions": [[0, 0, 0.1], [0, 0, 1.1]], "cell": np.eye(3) * 6}])
    with pytest.raises(ValueError, match=r"^remap: pass frames explicitly \(or call keep_frame first\) when the "
                                         r"structure has several frames$"):
        s.copy()._remap([1, 0], positions=[[0, 0, 1], [0, 0, 0]])
    kept = s.copy()._remap([1, -1], new_symbols=["O"], new_positions=[[1, 1, 1]])
    assert np.allclose(kept.frames[0]["positions"], [[0, 0, 1.1], [1, 1, 1]])
    assert np.allclose(kept.frames[0]["cell"], np.eye(3) * 6)
    kept.frames[0]["cell"][0, 0] = 99.0
    assert s.frames[0]["cell"][0, 0] == 6.0   # frame cells are copied too
    dropped = s.copy()._remap([1, 0], positions=[[0, 0, 1], [0, 0, 0]], frames=[])
    assert dropped.n_frames == 1
    given = s.copy()._remap([0, 1], frames=[{"positions": [[0, 0, 2], [0, 0, 3]]}])
    assert np.allclose(given.frames[0]["positions"], [[0, 0, 2], [0, 0, 3]]) and "cell" not in given.frames[0]


def test_from_dict_repairs_old_documents():
    doc = {"symbols": ["Pt", "Pt", "O"], "positions": [[0, 0, 0], [2.5, 0, 0], [1, 1, 1]],
           "props": {"selective_dynamics": [[F, F, F]], "labels": ["a", "b", "c", "d"], "charge": 5},
           "frames": [{"positions": [[0, 0, 0]] * 2}, {"positions": [[0, 0, 1]] * 3}],
           "info": {"warning": "a; b"}}
    s = Structure.from_dict(doc)
    assert s.props["selective_dynamics"] == [[F, F, F], [T, T, T], [T, T, T]]
    assert s.props["labels"] == ["a", "b", "c"] and "charge" not in s.props
    assert s.n_frames == 2 and "warning" not in s.info
    assert s.info["warnings"] == [
        "a; b",
        "property 'selective_dynamics' had 1 values for 3 atoms and was padded with defaults",
        "property 'labels' had 4 values for 3 atoms and was truncated",
        "property 'charge' is not a per-atom list and was removed",
        "frame 1 has 2 positions for 3 atoms and was dropped",
    ]
    assert doc["props"]["selective_dynamics"] == [[F, F, F]] and doc["info"] == {"warning": "a; b"}  # untouched
    with pytest.raises(ValueError, match=r"^invalid structure: positions must have 2 rows to match symbols \(got 1\)$"):
        Structure.from_dict({"symbols": ["H", "H"], "positions": [[0, 0, 0]]})
    with pytest.raises(ValueError, match="props must be an object"):
        Structure.from_dict({"symbols": ["H"], "positions": [[0, 0, 0]], "props": [1]})
    assert Structure.from_dict({"symbols": ["H"], "positions": [[0, 0, 0]], "cell": np.eye(3).tolist(),
                                "pbc": True}).pbc == [T, T, T]


def test_pbc_values():
    s = _slab(2)
    with pytest.raises(TypeError, match="^pbc must be a boolean or three booleans$"):
        Structure(["H"], [[0, 0, 0]], pbc="TTF")
    for bad in ("TTF", [T, F], {"a": 1, "b": 2, "c": 3}):
        with pytest.raises(TypeError, match="^pbc must be a boolean or three booleans$"):
            s.set_pbc(bad)
    s.info["energy"] = -1.0
    s.set_pbc(np.array([1, 1, 1]))   # no change
    assert s.info["energy"] == -1.0
    pos, cell = s.positions.copy(), s.cell.copy()
    assert s.set_pbc([T, T, F]) is s and s.pbc == [T, T, F] and "energy" not in s.info
    assert np.array_equal(s.positions, pos) and np.array_equal(s.cell, cell)   # U1/U2: nothing moves
    assert Structure(["H"], [[0, 0, 0]]).set_pbc(None).pbc == [F, F, F]


# ------------------------------------------------------------------------------------- source maps and sessions
def _labelled() -> Structure:
    return Structure(["Pt", "Pt", "O"], [[0, 0, 0], [1.4, 0, 0], [0.7, 1.2, 0]],
                     cell=[[2.8, 0, 0], [0, 2.4, 0], [0, 0, 10]], props={"labels": ["Pt0", "Pt1", "O2"]})


def _consistent(old: Structure, new: Structure, src) -> bool:
    """The map *src* says where each atom of *new* came from: the labels agree."""
    return [old.props["labels"][i] if i >= 0 else None for i in src] == \
        [lab if lab in old.props["labels"] else None for lab in new.props["labels"]]


@pytest.mark.parametrize("edit, expect", [
    (lambda w: (w.delete([0]), w.append("O", [0, 0, 5]))[0], [1, 2, -1]),
    (lambda w: (w.delete([0]), w.repeat(2, 1, 1))[1], [1, 2, 1, 2]),
    (lambda w: w.repeat(2, 1, 1).delete([0]), [1, 2, 0, 1, 2]),
    (lambda w: w.delete([1]).repeat(2, 1, 1).append("H", [0, 0, 5]).select(indices=[4, 0, 1]), [0, 2, -1]),
    (lambda w: (lambda r: (w.delete([0]), r)[1])(w.repeat(2, 1, 1)), [0, 1, 2, 0, 1, 2]),
    (lambda w: w.copy().sort_by_species(["O"]), [2, 0, 1]),
])
def test_six_ways_of_editing(edit, expect):
    """F0-D 3.4: in place, delete then derive, derive then delete, several levels, derive then edit the parent, copy
    then sort -- the session's map matches the labels every time."""
    old = _labelled()
    work = old.copy()
    t = work.track_changes()
    result = edit(work) or work
    src = t.stop(result)
    assert src.tolist() == expect and _consistent(old, result, src)
    assert t.src is src and not t.active


def test_sessions():
    s = _labelled()
    with s.track_changes() as t:
        s.delete([0])
        s.append("H", [0, 0, 3])
    assert t.src.tolist() == [1, 2, -1] and not t.active
    assert t.stop() is t.src                     # stopping again gives the same result
    t2 = s.track_changes()
    unrelated = Structure(["H"], [[0, 0, 0]])
    assert t2.stop(unrelated) is None
    bad = s.track_changes()
    with pytest.raises(TypeError, match="stop"):
        bad.stop("x")  # type: ignore[arg-type]
    assert bad.active and bad.stop().tolist() == [0, 1, 2]   # still open after the error
    a, b = s.track_changes(), s.track_changes()   # several sessions at once
    s.delete([2])
    assert a.stop().tolist() == [0, 1] and b.stop().tolist() == [0, 1]
    s.delete([0])
    assert len(s._tracks) == 0                     # closed sessions are dropped at the next remap
    assert "ChangeTracker(closed" in repr(a) and isinstance(a, ChangeTracker)


def test_source_map_lifecycle():
    s = _labelled()
    assert s.source_map is None and s.copy().source_map is None
    assert Structure.from_dict(s.to_dict()).source_map is None
    sub = s.select(indices=[2, 0])
    assert sub.source_map.tolist() == [0, 2]
    with pytest.raises(ValueError):
        sub.source_map[0] = 5                       # read-only
    sub.delete([0])
    assert sub.source_map.tolist() == [2]           # accumulated since it was derived
    assert sub.copy().source_map is None and sub.get_frame(0).source_map is None
    assert "_source_map" not in json.dumps(sub.to_dict()) and "source_map" not in sub.to_dict()
    clone = pickle.loads(pickle.dumps(sub))
    assert clone.source_map is None and clone.props == sub.props and clone._tracks == {}
    deep = copy.deepcopy(sub)
    assert deep.source_map is None and deep.props == sub.props


def test_set_source_and_adopt():
    parent = _labelled()
    t = parent.track_changes()
    built = Structure(["O", "H"], [[0, 0, 0], [0, 0, 1]])
    assert built._set_source(parent, [2, -1]) is built
    assert built.source_map.tolist() == [2, -1] and t.stop(built).tolist() == [2, -1]
    with pytest.raises(ValueError, match="the source map has 1 entries but the structure has 2 atoms"):
        built._set_source(parent, [0])
    with pytest.raises(IndexError, match=r"source index 3 out of range \(structure has 3 atoms\)"):
        built._set_source(parent, [3, 0])

    work = _labelled()
    t = work.track_changes()
    big = work.repeat(2, 1, 1)
    assert work._adopt(big) is work
    assert len(work) == 6 and work.symbols is big.symbols   # taken over, not copied
    assert work.source_map.tolist() == [0, 1, 2, 0, 1, 2] and t.stop().tolist() == [0, 1, 2, 0, 1, 2]
    t = work.track_changes()
    work._adopt(Structure(["H"], [[0, 0, 0]]))
    assert work.source_map is None and t.stop() is None   # unrelated
    t = work.track_changes()
    work._adopt(Structure(["H", "H"], [[0, 0, 0], [0, 0, 1]]), src=[0, -1])
    assert t.stop().tolist() == [0, -1]
    with pytest.raises(TypeError, match="^_adopt expects a Structure$"):
        work._adopt("x")  # type: ignore[arg-type]
    with pytest.raises(IndexError, match="source index 5 out of range"):
        work._adopt(Structure(["H"], [[0, 0, 0]]), src=[5])


def test_invert_and_compose_source_maps():
    assert invert_source_map([1, 2, 1, 2], 3).tolist() == [-1, 0, 1]
    assert invert_source_map(np.array([2, -1, 0]), 4).tolist() == [2, -1, 0, -1]
    assert invert_source_map([None, 0], 1).tolist() == [1]
    with pytest.raises(IndexError, match=r"source index 3 out of range \(structure has 3 atoms\)"):
        invert_source_map([3], 3)
    assert compose_source_maps([1, 2, 1, 2], [3, 0, -1]).tolist() == [2, 1, -1]
    assert compose_source_maps([0, -1, 1], [1, 2]).tolist() == [-1, 1]
    with pytest.raises(ValueError, match=r"^source maps do not chain: the second map refers to atom 5 but the "
                                         r"first has 3 entries$"):
        compose_source_maps([0, 1, 2], [5])
    out = compose_source_maps([0], [0])
    out[0] = 7   # a plain, writable array


# --------------------------------------------------------------------------------------- notes and derived info
def test_notes():
    info: dict = {}
    assert add_warning(info, "a") is info and info == {"warnings": ["a"]}
    add_warning(info, "a")
    add_warning(info, "")
    assert info == {"warnings": ["a"]}
    shared = ["x"]
    other = {"warnings": shared}
    add_warning(other, "y")
    assert shared == ["x"] and other["warnings"] == ["x", "y"]   # a new list
    assert add_warning({"warnings": "old"}, "b") == {"warnings": ["b"]}
    assert get_warnings({"warnings": ["a", 3], "warning": "b"}) == ["a", "b"]
    assert get_warnings({"warnings": ["a"], "warning": "a"}) == ["a"] and get_warnings({}) == []
    assert new_warnings(["a", "b"], ["a", "c", "b", "d"]) == ["c", "d"] and new_warnings(None, ["a"]) == ["a"]
    legacy = {"warning": "VASP 4 POSCAR without element names; species set to X"}
    assert normalize_warnings(legacy) == {"warnings": ["VASP 4 POSCAR without element names; species set to X"]}
    assert normalize_warnings({"warnings": ["a"], "warning": "a"}) == {"warnings": ["a"]}
    assert normalize_warnings({"warning": ""}) == {}


def test_mark_edited_table():
    """F0-D 3.7, row by row: each kind drops exactly the keys of its row."""
    rows = {"order": (F, F, F), "translate": (F, F, F), "rotate": (F, T, F), "positions": (T, T, F),
            "atoms": (T, T, F), "symbols": (T, T, F), "repeat": (F, T, F), "cell": (T, T, T), "pbc": (F, T, F)}
    assert tuple(rows) == EDIT_KINDS
    for kind, (sym, res, build_) in rows.items():
        s = _slab(2, forces=[[0, 0, 1.0]] * 2, energies=[-1.0, -1.0], tags=[1, 2], velocities=[[1.0, 0, 0]] * 2)
        s.info.update({k: 1 for k in SYMMETRY_INFO_KEYS + RESULT_INFO + BUILD_INFO_KEYS}, source="builder:crystal")
        assert mark_edited(s, kind) is s
        assert all((k in s.info) is not sym for k in SYMMETRY_INFO_KEYS), kind
        assert all((k in s.info) is not res for k in RESULT_INFO), kind
        assert all((k in s.props) is not res for k in ("forces", "energies")), kind
        assert all((k in s.info) is not build_ for k in BUILD_INFO_KEYS), kind
        assert s.info["source"] == "builder:crystal" and s.props["tags"] == [1, 2] and "velocities" in s.props
        if res:
            assert s.info["warnings"] == ["calculated results (energy, free_energy, stress, virial, dipole, magmom, "
                                          "polarization, dielectric_tensor, energies, forces) were removed because "
                                          "the structure changed"]
        else:
            assert "warnings" not in s.info
    with pytest.raises(ValueError, match=r"^mark_edited: unknown kind 'foo' \(use order, translate, rotate, positions, "
                                         r"atoms, symbols, repeat, cell or pbc\)$"):
        mark_edited(_slab(1), "foo")


def test_mark_edited_rotate_turns_cartesian_vectors():
    R = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]   # +90 degrees about z
    s = _slab(2, velocities=[[1.0, 0, 0], [0, 2.0, 0]], initial_magmoms=[[0, 0, 1.0], [1.0, 0, 0]],
              momenta=[[0, 0, 3.0], [1.0, 1.0, 0]])
    s.info["spacegroup"] = "P1"
    mark_edited(s, "rotate", rotation=R)
    assert np.allclose(s.props["velocities"], [[0, 1, 0], [-2, 0, 0]])
    assert np.allclose(s.props["initial_magmoms"], [[0, 0, 1], [0, 1, 0]])
    assert np.allclose(s.props["momenta"], [[0, 0, 3], [-1, 1, 0]]) and s.info["spacegroup"] == "P1"
    collinear = _slab(2, initial_magmoms=[2.0, -2.0])
    mark_edited(collinear, "rotate", rotation=R)
    assert collinear.props["initial_magmoms"] == [2.0, -2.0]
    with pytest.raises(ValueError, match="^rotation must be a 3x3 matrix of finite numbers$"):
        mark_edited(_slab(1, velocities=[[1.0, 0, 0]]), "rotate", rotation=[[1, 0], [0, 1]])


def test_stale_results_are_not_exported():
    """Domain review F3: a Pt12 slab with energy, stress and forces, one atom deleted and an O added, no longer
    claims the old energy in the extxyz it writes; sorting only reorders the forces and keeps the energy."""
    s = build.crystal("fcc", "Pt", a=3.92).repeat(1, 1, 3)
    assert len(s) == 12
    s.info.update(energy=-71.234, stress=[[0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1]], spacegroup="Fm-3m")
    s.set_prop("forces", [[0.0, 0.0, 0.01 * i] for i in range(12)])
    edited = s.copy().delete([5]).append("O", [1.0, 1.0, 12.0])
    text = to_text(edited, "extxyz")
    assert "energy=" not in text and "forces" not in text and "spacegroup" not in text
    assert edited.info["warnings"] == ["calculated results (energy, stress, forces) were removed because the "
                                       "structure changed"]
    mixed = Structure(["O", "Pt", "O", "Pt"], [[0, 0, 4], [0, 0, 0], [2, 2, 4], [2, 2, 0]], cell=np.eye(3) * 4,
                      props={"forces": [[0, 0, 0.0], [0, 0, 1.0], [0, 0, 2.0], [0, 0, 3.0]]},
                      info={"energy": -5.0})
    mixed.sort_by_species()
    assert mixed.symbols == ["O", "O", "Pt", "Pt"] and mixed.info["energy"] == -5.0
    assert mixed.props["forces"] == [[0, 0, 0.0], [0, 0, 2.0], [0, 0, 1.0], [0, 0, 3.0]]


def test_notes_are_kept_in_json_not_in_extxyz():
    s = _slab(2)
    add_warning(s.info, "the cell was repaired")
    assert "warnings=" not in to_text(s, "extxyz") and "the cell was repaired" not in to_text(s, "extxyz")
    back = parse_text(to_text(s, "json"), "json")
    assert back.info["warnings"] == ["the cell was repaired"]


def test_center_marks_a_new_cell_only():
    s = _slab(2)
    s.info.update(spacegroup="P1", energy=-1.0, prototype="fcc")
    s.center()
    assert s.info["spacegroup"] == "P1" and s.info["energy"] == -1.0
    s.center(vacuum=10.0, axis=[2])
    assert "spacegroup" not in s.info and "energy" not in s.info and "prototype" not in s.info
    mol = build.molecule("water")
    mol.info["energy"] = -14.2
    mol.center(vacuum=5.0)
    assert mol.info["energy"] == -14.2   # boxing a molecule (no cell before, pbc unchanged) keeps it


# ----------------------------------------------------------------------------------------------- frames
def _trajectory() -> Structure:
    return Structure(["H", "H"], [[0, 0, 0], [0, 0, 0.74]], cell=np.eye(3) * 10,
                     info={"energy": -1.1, "spacegroup": "P1"}, props={"forces": [[0, 0, 1.0], [0, 0, -1.0]]},
                     frames=[{"positions": [[0, 0, 0.1], [0, 0, 0.9]]},
                             {"positions": [[0, 0, 0.2], [0, 0, 1.0]], "cell": np.eye(3) * 11}])


def test_get_frame_and_keep_frame():
    s = _trajectory()
    f0 = s.get_frame(0)
    assert f0.info["energy"] == -1.1 and f0.n_frames == 1 and "warnings" not in f0.info
    f2 = s.get_frame(-1)
    assert np.allclose(f2.positions[1], [0, 0, 1.0]) and np.allclose(f2.cell, np.eye(3) * 11)
    assert "energy" not in f2.info and "spacegroup" not in f2.info and "forces" not in f2.props
    assert s.info["energy"] == -1.1
    with pytest.raises(IndexError, match=r"^frame 3 out of range \(structure has 3 frames\)$"):
        s.get_frame(3)
    with pytest.raises(TypeError, match=r"^frame must be an integer \(got 1.5\)$"):
        s.get_frame(1.5)
    k = s.copy()
    assert k.keep_frame(1) is k and k.n_frames == 1 and np.allclose(k.positions[1], [0, 0, 0.9])
    assert np.allclose(k.cell, np.eye(3) * 10) and "energy" not in k.info
    k0 = s.copy().keep_frame()
    assert k0.n_frames == 1 and k0.info["energy"] == -1.1


def test_set_positions_and_write_frame():
    s = _trajectory()
    assert s.set_positions([[0, 0, 0.8]], indices=[1], mark=None) is s
    assert np.allclose(s.positions, [[0, 0, 0], [0, 0, 0.8]]) and s.info["energy"] == -1.1
    s.set_positions([[0, 0, 0.3]], indices=[-2], frame=2)
    assert np.allclose(s.frames[1]["positions"], [[0, 0, 0.3], [0, 0, 1.0]]) and "energy" not in s.info
    with pytest.raises(ValueError, match=r"^set_positions: expected 2 rows of 3 coordinates, got 1$"):
        s.set_positions([[1, 1, 1]])
    with pytest.raises(ValueError, match="^positions must be finite numbers$"):
        s.set_positions([[1, 1, np.nan], [0, 0, 0]])
    with pytest.raises(ValueError, match="^mark_edited: unknown kind 'moved'"):
        s.set_positions([[1, 1, 1], [0, 0, 0]], mark="moved")
    with pytest.raises(IndexError, match=r"^frame 5 out of range \(structure has 3 frames\)$"):
        s.set_positions([[1, 1, 1], [0, 0, 0]], frame=5)
    w = _trajectory()
    assert w.write_frame(0, cell=np.eye(3) * 12) is w
    assert np.allclose(w.cell, np.eye(3) * 12) and w.info["energy"] == -1.1   # no mark_edited
    w.write_frame(2, cell=None)
    assert "cell" not in w.frames[1]
    w.write_frame(1, positions=[[0, 0, 0.5], [0, 0, 1.5]], cell=np.eye(3) * 9)
    assert np.allclose(w.frames[0]["positions"][1], [0, 0, 1.5]) and np.allclose(w.frames[0]["cell"], np.eye(3) * 9)
    with pytest.raises(ValueError, match=r"^write_frame: expected 2 rows of 3 coordinates, got 3$"):
        w.write_frame(0, positions=[[0, 0, 0]] * 3)
    with pytest.raises(ValueError, match="^cell must be finite numbers$"):
        w.write_frame(0, cell=[[np.inf, 0, 0], [0, 1, 0], [0, 0, 1]])
    w.write_frame(0, cell=None)
    assert w.cell is None


def test_wrap_uses_wrap_fractional_on_every_frame():
    s = Structure(["H", "H"], [[11, 0, 0], [9.99999999999999, 0, 0]], cell=np.eye(3) * 10,
                  frames=[{"positions": [[21, 0, 0], [-0.5, 0, 0]], "cell": np.diag([20.0, 10, 10])}])
    s.info["spacegroup"] = "P1"
    s.wrap()
    assert np.allclose(s.positions, [[1, 0, 0], [0, 0, 0]], atol=1e-9)
    assert np.allclose(s.frames[0]["positions"], [[1, 0, 0], [19.5, 0, 0]])
    assert s.info["spacegroup"] == "P1"   # wrapping is a translation: nothing is dropped


# ------------------------------------------------------------------------------------------------- order
def test_poscar_order_and_canonical_order():
    assert poscar_order(["O", "Ti", "O", "Ti"]) == [0, 2, 1, 3]
    assert poscar_order(["O", "Ti", "O", "Ti"], ["Ti"]) == [1, 3, 0, 2]
    assert poscar_order(["O", "Ti", "O", "Ti"], ["Pt", "Ti", "O"]) == [1, 3, 0, 2]
    blocks = ["Ga", "As", "H", "H", "H#2", "H#2"]
    assert poscar_order(["Ga", "As", "H", "H", "H", "H"], blocks=blocks) == [0, 1, 2, 3, 4, 5]
    assert poscar_order(["Ga", "As", "H", "H", "H", "H"], ["H"], blocks) == [2, 3, 4, 5, 0, 1]
    syms = ["Ti", "O", "O", "Ti", "O", "O", "Ti", "O", "O"]
    order = canonical_order(syms, [0, 0, 1, 1, 1, 2, 2, 2, 3])
    assert [f"{syms[i]}{l}" for i, l in zip(order, [0, 1, 2, 0, 1, 1, 2, 2, 3])] == \
        ["Ti0", "Ti1", "Ti2", "O0", "O1", "O1", "O2", "O2", "O3"]
    assert poscar_order([syms[i] for i in order]) == list(range(9))
    with pytest.raises(ValueError, match=r"^blocks must have 2 entries \(got 1\)$"):
        poscar_order(["H", "H"], blocks=["H"])
    with pytest.raises(TypeError, match="layers must be numbers"):
        canonical_order(["H", "H"], [0, None])


def test_sort_by_species():
    s = Structure(["O", "Pt", "O", "Pt"], [[0, 0, 4], [0, 0, 0], [2, 2, 4], [2, 2, 0]], cell=np.eye(3) * 4,
                  props={"labels": ["O0", "Pt1", "O2", "Pt3"]}, frames=[{"positions": [[0, 0, 4.1], [0, 0, 0.1],
                                                                                         [2, 2, 4.1], [2, 2, 0.1]]}])
    assert s.sort_by_species(("pt",)) is s
    assert s.symbols == ["Pt", "Pt", "O", "O"] and s.props["labels"] == ["Pt1", "Pt3", "O0", "O2"]
    assert np.allclose(s.frames[0]["positions"][:, 2], [0.1, 0.1, 4.1, 4.1]) and s.source_map.tolist() == [1, 3, 0, 2]
    for bad in ("PtO", ["Pt", 3]):
        with pytest.raises(TypeError, match=r"^order must be a list of element symbols, e.g. \['Pt', 'C', 'O'\]$"):
            s.sort_by_species(bad)
    blocks = Structure(["Ga", "H", "As", "H", "H"], np.zeros((5, 3)),
                       props={"poscar_species": ["Ga", "H", "As", "H#2", "H"]})
    assert blocks.sort_by_species().symbols == ["Ga", "H", "H", "As", "H"]
    assert blocks.props["poscar_species"] == ["Ga", "H", "H", "As", "H#2"]


def test_set_symbols():
    s = _slab(2, labels=["Pt1", "Pt2"], label=["a", "b"], atom_names=["PT", "PT"], tags=[1, 2])
    s.info["spacegroup"] = "P1"
    assert s.set_symbols([-1], "au") is s
    assert s.symbols == ["Pt", "Au"] and s.props["labels"] == ["Pt1", "Au"] and s.props["label"] == ["a", "Au"]
    assert s.props["atom_names"] == ["PT", "Au"] and s.props["tags"] == [1, 2] and "spacegroup" not in s.info
    with pytest.raises(IndexError, match=r"^atom index 2 out of range \(structure has 2 atoms\)$"):
        s.set_symbols([2], "O")


def test_constraint_methods():
    s = _slab(3, selective_dynamics=[[F, F, F], [T, T, F], [T, T, T]])
    assert s.move_flags() == [[F, F, F], [T, T, F], [T, T, T]]
    s.move_flags()[0][0] = T
    assert s.props["selective_dynamics"][0] == [F, F, F]   # a copy
    assert s.constraint_summary() == {"fixed": 1, "partial": 1, "free": 1,
                                      "byFlags": {"FFF": 1, "TTF": 1, "TTT": 1}, "present": True}
    assert _slab(2).move_flags() == [[T, T, T]] * 2


# ------------------------------------------------------------------------------------------------- names
def test_repeat_suffix():
    """F0-D 3.14: all ones, an empty name, a plain name, a name with a suffix, and the two older suffixes."""
    assert TIMES == "×" and format_repeat((2, 2, 1)) == "2×2×1" and format_repeat([2.0, 1, 3]) == "2×1×3"
    assert add_repeat_suffix("Cu fcc", (1, 1, 1)) == "Cu fcc"
    assert add_repeat_suffix("", (2, 2, 2)) == ""
    assert add_repeat_suffix("Cu fcc", (2, 2, 1)) == "Cu fcc 2×2×1"
    assert add_repeat_suffix("Cu fcc 2×1×1", (2, 1, 1)) == "Cu fcc 4×1×1"
    assert add_repeat_suffix("Cu fcc 2x2x2", (2, 1, 1)) == "Cu fcc 4×2×2"
    assert add_repeat_suffix("Cu (Face-centred cubic) (2×2×2)", (2, 1, 1)) == "Cu (Face-centred cubic) 4×2×2"
    assert add_repeat_suffix("Cu (2×2×2", (2, 1, 1)) == "Cu (2×2×2 2×1×1"   # parentheses only in pairs
    assert add_repeat_suffix("Cu 2×2×2)", (2, 1, 1)) == "Cu 2×2×2) 2×1×1"
    assert add_repeat_suffix("Cu ٢x٢x٢", (2, 1, 1)) == "Cu ٢x٢x٢ 2×1×1"     # ASCII digits only, as in JS
    assert add_repeat_suffix("Cu 2x2x2\n", (2, 1, 1)) == "Cu 2x2x2\n 2×1×1"
    with pytest.raises(ValueError, match=r"repeat counts must be whole numbers >= 1 \(got 0\)"):
        add_repeat_suffix("Cu", (0, 1, 1))
    with pytest.raises(TypeError, match="repeat counts must be whole numbers"):
        format_repeat([1.5])
    with pytest.raises(ValueError, match="3 counts"):
        add_repeat_suffix("Cu", (2, 2))
    s = build.crystal("fcc", "Cu", a=3.61)
    assert s.repeat(2, 1, 1).repeat(2, 1, 1).name == "Cu fcc 4×1×1"   # not 'Cu fcc 2x1x1 2x1x1'


def test_core_reexports():
    import crystallume.core as core

    for name in ("PROP_DEFAULTS", "mark_edited", "invalidate_symmetry_info", "add_warning", "get_warnings",
                 "poscar_order", "concat_structures"):
        assert name in core.__all__ and getattr(core, name) is getattr(st, name)
    assert set(st.__all__) <= set(dir(st))
