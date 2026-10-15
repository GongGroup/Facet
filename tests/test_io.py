"""Reader/writer round trips and format detection."""

from __future__ import annotations

import gzip
import io as stdio

import numpy as np
import pytest

import atomscope as ats
from atomscope import Structure, build
from atomscope.io import FormatError, ParseError, detect_format, parse_text, to_text


def _same_positions(a: Structure, b: Structure, atol: float = 1e-4) -> bool:
    return np.allclose(np.sort(a.positions, axis=0), np.sort(b.positions, axis=0), atol=atol)


# --------------------------------------------------------------------- XYZ
def test_xyz_multiframe_roundtrip():
    w = build.molecule("water")
    traj = Structure.from_frames([w, w.copy().translate([0.5, 0, 0]), w.copy().translate([1.0, 0, 0])])
    text = to_text(traj, "xyz")
    assert text.count("\n3\n") == 2  # three frames
    back = parse_text(text, "xyz")
    assert back.n_frames == 3
    assert np.allclose(back.get_frame(2).positions, w.positions + [1.0, 0, 0], atol=1e-6)
    last = parse_text(text, "xyz", index=-1)
    assert last.n_frames == 1 and np.allclose(last.positions, w.positions + [1.0, 0, 0], atol=1e-6)


def test_plain_xyz_with_extra_columns_and_atomic_numbers():
    text = "2\nsome comment\n8 0.0 0.0 0.0 0.1\n1 0.0 0.0 0.97 0.2\n"
    s = parse_text(text, "xyz")
    assert s.symbols == ["O", "H"]
    assert s.name == "some comment"


def test_extxyz_lattice_and_properties():
    rut = build.crystal("rutile", ["Ti", "O"])
    rut.set_prop("charges", [2.0, 2.0, -1.0, -1.0, -1.0, -1.0])
    rut.set_prop("fixed", [True, False, False, False, False, False])
    text = to_text(rut, "extxyz")
    header = text.splitlines()[1]
    assert header.startswith('Lattice="') and 'pbc="T T T"' in header
    assert "charges:R:1" in header and "fixed:L:1" in header
    back = parse_text(text)  # detected as xyz
    assert np.allclose(back.cell, rut.cell, atol=1e-6)
    assert back.pbc == [True, True, True]
    assert back.props["charges"] == [2.0, 2.0, -1.0, -1.0, -1.0, -1.0]
    assert back.props["fixed"][0] is True
    assert _same_positions(back, rut)


def test_extxyz_reader_external_style():
    text = (
        "2\n"
        'Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" Properties=species:S:1:pos:R:3:forces:R:3 '
        'energy=-12.5 pbc="T T F" config_type=bulk\n'
        "Si 0.0 0.0 0.0 0.1 0.0 0.0\n"
        "Si 1.3 1.3 1.3 -0.1 0.0 0.0\n"
    )
    s = parse_text(text, "extxyz")
    assert s.pbc == [True, True, False]
    assert s.info["energy"] == -12.5 and s.info["config_type"] == "bulk"
    assert s.props["forces"][1] == [-0.1, 0.0, 0.0]


# ------------------------------------------------------------------ POSCAR
def test_poscar_direct_roundtrip():
    sto = build.crystal("perovskite", "SrTiO3")
    text = to_text(sto, "poscar")
    assert "Direct" in text and "Sr   Ti    O" in text
    back = parse_text(text, "poscar")
    assert back.symbols == sto.symbols
    assert np.allclose(back.cell, sto.cell)
    assert _same_positions(back, sto)


def test_poscar_cartesian_and_scale():
    text = """cartesian test
2.0
 1.0 0.0 0.0
 0.0 1.0 0.0
 0.0 0.0 1.0
Na Cl
1 1
Cartesian
0.0 0.0 0.0
0.5 0.5 0.5
"""
    s = parse_text(text, "poscar")
    assert np.allclose(s.cell, np.eye(3) * 2.0)
    assert np.allclose(s.positions[1], [1.0, 1.0, 1.0])  # Cartesian also scaled


def test_poscar_vasp4_negative_scale_selective_dynamics():
    text = """Ga As zincblende
-180.0
 0.0 0.5 0.5
 0.5 0.0 0.5
 0.5 0.5 0.0
1 1
Selective dynamics
Direct
0.00 0.00 0.00 F F F
0.25 0.25 0.25 T T T
"""
    s = parse_text(text, "poscar")
    assert s.symbols == ["Ga", "As"]
    assert abs(s.volume - 180.0) < 1e-6
    assert s.props["selective_dynamics"] == [[False, False, False], [True, True, True]]
    again = parse_text(to_text(s, "poscar"), "poscar")
    assert again.props["selective_dynamics"] == s.props["selective_dynamics"]


def test_poscar_groups_species():
    s = Structure(["O", "Ti", "O"], [[0, 0, 0], [1, 1, 1], [2, 2, 2]], cell=np.eye(3) * 4)
    back = parse_text(to_text(s, "poscar"), "poscar")
    assert back.symbols == ["O", "O", "Ti"]


# --------------------------------------------------------------------- CIF
def test_cif_nacl_symmetry_expansion(data_dir):
    s = ats.read(data_dir / "NaCl.cif")
    assert len(s) == 8
    assert s.composition == {"Na": 4, "Cl": 4}
    assert np.allclose(s.cellpar, (5.6402, 5.6402, 5.6402, 90, 90, 90))
    assert s.info["spacegroup"] == "F m -3 m"
    f = s.frac_positions
    assert np.all(f >= 0) and np.all(f < 1)


def test_cif_perovskite_pm3m(data_dir):
    s = ats.read(data_dir / "SrTiO3.cif")
    assert len(s) == 5
    assert s.formula == "SrTiO3"
    assert abs(s.cell[0, 0] - 3.905) < 1e-9  # uncertainty "(2)" stripped
    assert s.info["spacegroupNumber"] == 221


def test_cif_roundtrip_p1():
    sto = build.crystal("rutile", "TiO2")
    text = to_text(sto, "cif")
    assert "_symmetry_space_group_name_H-M   'P 1'" in text
    back = parse_text(text, "cif")
    assert len(back) == 6
    assert _same_positions(back, sto)


def test_cif_hexagonal_ops_and_labels():
    text = """data_wurtzite
_cell_length_a 3.25
_cell_length_b 3.25
_cell_length_c 5.207
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 120
_symmetry_space_group_name_H-M 'P 63 m c'
loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'-y, x-y, z'
'-x+y, -x, z'
'-x, -y, z+1/2'
'y, -x+y, z+1/2'
'x-y, x, z+1/2'
'-y, -x, z'
'-x+y, y, z'
'x, x-y, z'
'y, x, z+1/2'
'x-y, -y, z+1/2'
'-x, -x+y, z+1/2'
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Zn1 0.3333 0.6667 0.0
O1 0.3333 0.6667 0.375
"""
    s = parse_text(text, "cif")
    assert len(s) == 4
    assert s.composition == {"Zn": 2, "O": 2}


# --------------------------------------------------------------------- PDB
PDB_TEXT = """HEADER    TEST PEPTIDE
CRYST1   10.000   10.000   10.000  90.00  90.00  90.00 P 1           1
MODEL        1
ATOM      1  N   ALA A   1       1.104   1.134   1.504  1.00  0.00           N
ATOM      2  CA  ALA A   1       1.639   1.071   2.847  1.00  0.00           C
HETATM    3 FE   HEM A   2       3.000   3.000   3.000  1.00  0.00
ENDMDL
MODEL        2
ATOM      1  N   ALA A   1       1.204   1.134   1.504  1.00  0.00           N
ATOM      2  CA  ALA A   1       1.739   1.071   2.847  1.00  0.00           C
HETATM    3 FE   HEM A   2       3.100   3.000   3.000  1.00  0.00
ENDMDL
END
"""


def test_pdb_read_models_cell_elements():
    s = parse_text(PDB_TEXT)
    assert s.info["format"] == "pdb"
    assert s.symbols == ["N", "C", "Fe"]  # CA = alpha carbon (element column), FE from name
    assert s.n_frames == 2
    assert np.allclose(s.cell, np.eye(3) * 10)
    assert s.props["residue_names"] == ["ALA", "ALA", "HEM"]


def test_pdb_roundtrip():
    caf = build.molecule("caffeine")
    back = parse_text(to_text(caf, "pdb"), "pdb")
    assert back.symbols == caf.symbols
    assert np.allclose(back.positions, caf.positions, atol=1e-3)
    sto = build.crystal("perovskite", "SrTiO3")
    back = parse_text(to_text(sto, "pdb"), "pdb")
    assert np.allclose(back.cell, sto.cell, atol=1e-3) and len(back) == 5


# -------------------------------------------------------------------- JSON
def test_json_roundtrip_and_project_input():
    s = build.crystal("graphene", "C")
    back = parse_text(to_text(s, "json"), "json")
    assert back.info.pop("format") == "json"
    assert back.to_dict() == s.to_dict()
    proj = ats.new_project("p", [build.molecule("water"), s])
    proj["activeStructure"] = proj["structures"][1]["id"]
    import json

    chosen = parse_text(json.dumps(proj), "json")
    assert chosen.formula == "C2"


# ----------------------------------------------------- detection, files, errors
@pytest.mark.parametrize(
    "name, fmt",
    [("POSCAR", "poscar"), ("CONTCAR", "poscar"), ("POSCAR_relaxed", "poscar"), ("x.vasp", "poscar"),
     ("a.cif", "cif"), ("A.CIF", "cif"), ("t.xyz", "xyz"), ("t.extxyz", "extxyz"), ("p.pdb", "pdb"),
     ("s.json", "json"), ("x.cif.gz", "cif"), ("README", None)],
)
def test_detect_by_name(name, fmt):
    assert detect_format(name) == fmt


def test_read_write_files_and_fileobj(tmp_path):
    si = build.crystal("diamond", "Si")
    p = tmp_path / "POSCAR"
    ats.write(p, si)
    assert ats.read(p).formula == "Si8"
    ats.write(tmp_path / "si.xyz", si)  # .xyz paths use extended XYZ (keeps the cell)
    assert ats.read(tmp_path / "si.xyz").cell is not None
    gz = tmp_path / "si.cif.gz"
    gz.write_bytes(gzip.compress(to_text(si, "cif").encode()))
    assert len(ats.read(gz)) == 8
    buf = stdio.StringIO(to_text(si, "xyz"))
    assert len(ats.read(buf, format="xyz")) == 8


def test_errors():
    with pytest.raises(FormatError):
        parse_text("1\nx\nH 0 0 0\n", "nope")
    with pytest.raises(ParseError):
        parse_text("not a poscar", "poscar")
    with pytest.raises(FormatError):
        parse_text("???")  # undetectable
    with pytest.raises(FormatError):
        to_text(build.molecule("water"), "nope")


def test_writers_handle_molecules():
    w = build.molecule("water")
    for fmt in ("poscar", "cif"):
        back = parse_text(to_text(w, fmt), fmt)  # boxed with vacuum
        assert back.cell is not None and len(back) == 3
