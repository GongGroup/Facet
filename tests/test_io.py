"""Reader/writer round trips and format detection."""

from __future__ import annotations

import gzip
import io as stdio

import numpy as np
import pytest

import crystallume as cl
from crystallume import Structure, build
from crystallume.io import FormatError, ParseError, detect_format, parse_text, to_text


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
    assert s.name == "" and parse_text(text, filename="si.extxyz").name == "si"   # never the config_type


# Extended XYZ (F0-D T5, §3.11).  The shared cases (both languages) are tests/data/surface/f0d/extxyz.json; these
# tests cover what only Python shows (int and float types, numpy values) and the two languages against each other.
from crystallume.core.constraints import lattice_to_cartesian_mask  # noqa: E402
from crystallume.io import xyz as xyz_io  # noqa: E402

_T, _F = True, False
#: The 33 info keys of F0-D appendix A (``warnings`` is never written, ``nan`` cannot be).
_INFO33 = {
    "energy": -71.234, "free_energy": -71.0, "stress": [[0.1, 0, 0], [0, 0.2, 0], [0, 0, 0.3]],
    "virial": [1, 2, 3, 2, 5, 6, 3, 6, 9], "dipole": [0.0, 0.1, -0.2], "magmom": 2.0, "supercell": [2, 2, 1],
    "short": "T", "sg_text": "225", "version": "0.4", "flag": "false", "note": "1 2 3", "plain": "Pt(111) p(3×3)",
    "surface": {"miller": [1, 1, 1], "note": 'say "hi" \\ x'}, "labels": ["a", "b"], "one": [5], "empty": [],
    "nested": [[1, 2], [3, 4]], "mixed": [1, "a"], "bools": [True, False, True], "big": 12345678901234567890,
    "crystallume_clip": "abc123", "spacegroup": "Fm-3m", "spacegroupNumber": 225, "comma": "a,b", "comma_num": "1,2",
    "inf_text": "inf", "unicode_digits": "\u0661\u0662", "underscore_num": "1_000", "hexlike": "0x10", "dexp": 1500.0,
    "floats": [1.0, 2.5], "multiline": "line1\nline2"}


def _info_back(info: dict) -> dict:
    """What a reader gives back for ``_INFO33``: stress as 9 numbers, the integer beyond 2**53 as a float."""
    return dict(info, stress=[0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3], big=float(info["big"]))


def _same_value(a, b) -> bool:
    """Equal JSON-like values, numbers by value (``1 == 1.0``), but booleans and strings not mixed with numbers."""
    if isinstance(a, (bool, str)) or a is None or isinstance(b, (bool, str)) or b is None:
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same_value(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same_value(a[k], b[k]) for k in a)
    return False


def test_extxyz_whitespace_is_python_isspace():
    """The whitespace class shared with the JS twin is exactly str.isspace (the JS \\s lacks U+001C-U+001F, U+0085)."""
    import re

    chars = {chr(c) for c in range(0x110000) if chr(c).isspace()}
    assert {chr(c) for c in range(0x110000) if re.fullmatch(f"[{xyz_io._WS}]", chr(c))} == chars
    assert xyz_io.kv_tokenize("a=1\x1cb=2\x85c=3\ufeffd=4") == [("a", "1"), ("b", "2"), ("c", "3\ufeffd=4")]


def test_extxyz_convert_value_python_types():
    """Integers stay ints (0.3.1 read several as floats), beyond 2**53 - 1 floats; no Python-only number syntax."""
    cv = xyz_io.convert_value
    assert cv("1 2 3") == [1, 2, 3] and all(type(x) is int for x in cv("1 2 3"))
    assert cv("2") == 2 and type(cv("2")) is int and type(cv("2.0")) is float and type(cv("1e5")) is float
    assert type(cv("9007199254740991")) is int and type(cv("9007199254740992")) is float
    assert cv("1 2.5") == [1.0, 2.5] and all(type(x) is float for x in cv("1 2.5"))
    for raw in ("1_000", "inf", "nan", "-Infinity", "0x10", "\u0661\u0662", "1e999", "1\n", "_JSON [NaN]", "_JSON 1e999"):
        assert cv(raw) == raw, raw
    assert cv(None) is True and cv("T F") == [True, False]
    assert cv("_JSON [1, 12345678901234567890]") == [1, 1.2345678901234567e19]   # as JavaScript reads it
    deep = "_JSON " + "[" * 100000 + "]" * 100000
    assert cv(deep) == deep                                                       # too deep: kept as text


def test_extxyz_info_python_values():
    """numpy values, ints of the calculated results, values that cannot be written, keys that are not written."""
    fmt = xyz_io.format_info_value
    assert fmt("energy", np.float64(-1.5)) == "-1.5" and fmt("n", np.int64(7)) == "7" and fmt("b", np.bool_(True)) == "T"
    assert fmt("energy", 5) == "5.0" and fmt("n", 5) == "5" and fmt("n", 5.0) == "5.0"
    assert fmt("stress", np.eye(3)) == '"1.0 0.0 0.0 0.0 1.0 0.0 0.0 0.0 1.0"'
    assert fmt("v", np.array([1, 2])) == '"1 2"' and fmt("v", (1.5, 2.5)) == '"1.5 2.5"'
    assert fmt("x", float("nan")) is None and fmt("x", float("inf")) is None and fmt("x", [1.0, float("nan")]) is None
    assert fmt("x", {"a": float("inf")}) is None and fmt("x", {1, 2}) is None and fmt("x", 10**400) is None
    assert fmt("stress", [[1, 2, 3], [4, 5, 6], [7, 8, float("nan")]]) is None
    s = Structure(["Pt"], [[0, 0, 0]], cell=np.eye(3) * 3, name="a\nb",
                  info={"pbc": "x", "Lattice": "y", "bad key": 1, "9lives": 2, "ok-key.1:x": 3, "none": None,
                        "format": "cif", "source": "cif", "filename": "a.cif", "name": "other"})
    head = to_text(s, "extxyz").splitlines()[1]
    assert head == ('Lattice="3.00000000 0.00000000 0.00000000 0.00000000 3.00000000 0.00000000 0.00000000 '
                    '0.00000000 3.00000000" Properties=species:S:1:pos:R:3 pbc="T T T" name="a b" ok-key.1:x=3')


def test_extxyz_info_four_directions(js):
    """F0-D appendix A: the 33 info keys read back unchanged Py->Py, JS->JS, Py->JS and JS->Py."""
    s = Structure(["Pt"], [[0, 0, 0]], cell=[3, 3, 20], info=dict(_INFO33, warnings=["not written"]), name="info sample")
    py_text = to_text(s, "extxyz")
    got = js("""
        const { readXYZ, writeXYZ } = await web('io/xyz.js');
        const { Structure } = await web('core/structure.js');
        const s = new Structure({ name: 'info sample', symbols: ['Pt'], positions: [[0, 0, 0]],
                                  cell: [[3, 0, 0], [0, 3, 0], [0, 0, 20]], info: input.info });
        const text = writeXYZ(s);
        return { text, own: readXYZ(text).info, py: readXYZ(input.py).info };
    """, {"info": dict(_INFO33, warnings=["not written"]), "py": py_text})
    want = _info_back(_INFO33)
    for direction, info in (("py->py", parse_text(py_text, "extxyz").info), ("js->js", got["own"]),
                            ("py->js", got["py"]), ("js->py", parse_text(got["text"], "extxyz").info)):
        for key, value in want.items():
            assert _same_value(info.get(key), value), (direction, key, info.get(key))
        assert "warnings" not in info and "not written" not in got["text"] + py_text, direction


def test_extxyz_random_parity(js):
    """kvTokenize, convertValue and formatInfoValue agree with the JS twin on random input (fixed seed)."""
    import random

    rng = random.Random(7)
    pieces = ["a", "b", "=", " ", '"', "'", "{", "}", "[", "]", "\\", "1", ",", "\t", ".", "e", "D", "-", "T", "f",
              "_JSON ", "\u3000", "\x1c", "\x85", "\ufeff", "\xa0", "\u0662", "inf", "_"]
    lines = ["".join(rng.choice(pieces) for _ in range(rng.randint(0, 16))) for _ in range(3000)]
    values = [None, True, 5, -71, 1.5, "", "x y", "225", "T", "inf", "1_000", "\u0662", "a,b", 'q"\\', "l\nb", [1, 2],
              [1.5, 2], [True, False], [5], [], [[1, 2]], ["a"], {"k": [1, None]}, [1, 2, 3, 4, 5, 6]]
    items = [(k, v) for k in ("x", "energy", "stress", "dipole") for v in values]
    got = js("""
        const M = await web('io/xyz.js');
        return { tok: input.lines.map((l) => M.kvTokenize(l)), conv: input.lines.map((l) => M.convertValue(l)),
                 fmt: input.items.map(([k, v]) => M.formatInfoValue(k, v)) };
    """, {"lines": lines, "items": items})
    assert got["tok"] == [[list(p) for p in xyz_io.kv_tokenize(line)] for line in lines]
    assert all(_same_value(c, xyz_io.convert_value(line)) for c, line in zip(got["conv"], lines))
    assert got["fmt"] == [xyz_io.format_info_value(k, v) for k, v in items]


def test_extxyz_structures_cross_language(js):
    """Python writes and JS reads, JS writes and Python reads: atoms, cells, frames, props, flags and info agree."""
    hexcell = [[2.7718585822512662, 0, 0], [-1.3859292911256331, 2.400499947927514, 0], [0, 0, 20]]
    s = Structure(["Pt", "Pt", "Pt", "O"], [[0, 0, 5], [0, 1.6, 7.26], [1.39, 0.8, 9.53], [1.39, 0.8, 11.4]],
                  cell=hexcell, pbc=[True, True, True], name="Pt(111) 3L + O",
                  frames=[{"positions": [[0, 0, 5.1], [0, 1.6, 7.3], [1.39, 0.8, 9.5], [1.39, 0.8, 11.5]],
                           "cell": [hexcell[0], hexcell[1], [0, 0, 21]]}],
                  props={"selective_dynamics": [[_F, _F, _F], [_T, _T, _F], [_F, _T, _F], [_T, _T, _T]],
                         "tags": [3, 2, 1, 0], "adsorbate_id": [0, 0, 0, 1], "forces": [[0, 0, 0.5]] * 4,
                         "labels": ["Pt1", "Pt2", "Pt3", "O1"], "initial_magmoms": [0.5, 0.5, 0.5, 0.0]},
                  info={"energy": -12.25, "surface": {"miller": [1, 1, 1], "layers": 3}, "crystallume_clip": "c1"})
    py_text = to_text(s, "extxyz")
    got = js("""
        const { readXYZ, writeXYZ } = await web('io/xyz.js');
        const r = readXYZ(input.text);
        return { read: r.toJSON({ precision: 9 }), text: writeXYZ(r) };
    """, {"text": py_text})
    back_py = parse_text(py_text, "extxyz")
    back_js = parse_text(got["text"], "extxyz")
    tightened_flags = [[_F, _F, _F], [_T, _T, _F], [_F, _F, _F], [_T, _T, _T]]   # F T F has no exact x, y, z form
    for label, doc in (("py->py", back_py.to_dict(decimals=9)), ("py->js", got["read"]),
                       ("js->py", back_js.to_dict(decimals=9))):
        assert doc["symbols"] == s.symbols and doc["pbc"] == [True, True, True] and doc["name"] == s.name, label
        assert np.allclose(doc["cell"], hexcell, atol=1e-8) and np.allclose(doc["positions"], s.positions, atol=1e-8)
        assert len(doc["frames"]) == 1 and np.allclose(doc["frames"][0]["cell"][2], [0, 0, 21]), label
        props = doc["props"]
        assert props["selective_dynamics"] == tightened_flags and props["tags"] == [3, 2, 1, 0], label
        assert props["adsorbate_id"] == [0, 0, 0, 1] and props["labels"] == ["Pt1", "Pt2", "Pt3", "O1"], label
        assert np.allclose(props["forces"], [[0, 0, 0.5]] * 4) and np.allclose(props["initial_magmoms"], [0.5] * 3 + [0])
        assert doc["info"]["energy"] == -12.25 and doc["info"]["surface"] == {"miller": [1, 1, 1], "layers": 3}
        assert doc["info"]["crystallume_clip"] == "c1", label
    assert py_text.splitlines()[1] == got["text"].splitlines()[1]   # the same comment line from both writers


def test_extxyz_move_mask_follows_the_cell():
    """The written mask is the Cartesian form of the flags of frame 0's cell; reading converts it back exactly."""
    hexcell = np.array([[2.7718585822512662, 0, 0], [-1.3859292911256331, 2.400499947927514, 0], [0, 0, 20]])
    flags = [[_T, _T, _F], [_F, _F, _T], [_F, _F, _F], [_T, _T, _T]]
    s = Structure(["Pt"] * 4, np.arange(12.0).reshape(4, 3), cell=hexcell, props={"selective_dynamics": flags})
    columns, skipped = xyz_io.extxyz_columns(s)
    mask, tightened = lattice_to_cartesian_mask(flags, hexcell)
    assert columns == [{"name": "move_mask", "type": "L", "width": 3, "values": mask, "tightened": 0}] and not skipped
    assert tightened == 0 and parse_text(to_text(s, "extxyz"), "extxyz").props["selective_dynamics"] == flags
    tilted = hexcell.copy()
    tilted[2] = [0.5, 0.0, 20.0]                  # c leans: "fixed along c" is no longer "fixed along z"
    t = Structure(["Pt"] * 4, np.arange(12.0).reshape(4, 3), cell=tilted, props={"selective_dynamics": flags})
    assert xyz_io.extxyz_columns(t)[0][0]["tightened"] == 1
    with pytest.raises(ValueError, match='^constraints must be "exact" or "fix-partial"$'):
        xyz_io.write_extxyz(s, constraints="loose")


def test_extxyz_frames_write_results_once():
    """F0-D S-5: forces, energy and stress describe frame 1, so the other frames carry no copy of them."""
    s = Structure(["Pt", "O"], [[0, 0, 0], [0, 0, 2]], cell=np.eye(3) * 4,
                  frames=[{"positions": [[0, 0, 0.1], [0, 0, 2.1]]}],
                  props={"forces": [[0, 0, 0.5], [0, 0, -0.5]], "tags": [1, 0]},
                  info={"energy": -3.5, "stress": [0.1, 0.2, 0.3, 0, 0, 0], "note": "md"})
    lines = to_text(s, "extxyz").splitlines()
    assert "forces:R:3" in lines[1] and "energy=-3.5" in lines[1] and "stress=" in lines[1]
    assert "forces" not in lines[5] and "energy" not in lines[5] and "stress" not in lines[5]
    assert "tags:I:1" in lines[5] and "note=md" in lines[5]
    assert lines[2].split()[-1] == "1" and len(lines[7].split()) == 5    # tags only after the coordinates
    last = parse_text("\n".join(lines), "extxyz", index=-1)
    assert "energy" not in last.info and "forces" not in last.props and last.props["tags"] == [1, 0]


def test_extxyz_reading_details():
    """Huge atom counts fail cleanly, a BOM is skipped, old line breaks work, bare words and parse_comment."""
    with pytest.raises(ParseError, match=r"file ended early at line 3 \(frame 1 declares 99999999999999999999 atoms"):
        parse_text("99999999999999999999\ncomment\n", "extxyz")
    s = parse_text("\ufeff1\rplain\r\nO 0 0 0\r", "xyz")
    assert s.symbols == ["O"] and s.name == "plain"
    s = parse_text('1\nLattice="3 0 0 0 3 0 0 0 3" Properties=species:S:1:pos:R:3 relaxed comment="kept"\nO 0 0 0\n',
                   "extxyz")
    assert s.info["comment"] == "kept" and "relaxed" not in s.info
    assert xyz_io.parse_comment('a=1 b="x y" free text a=2') == ({"a": "2", "b": "x y"}, "free text")
    assert "parse_comment" in xyz_io.__all__ and "kv_tokenize" in xyz_io.__all__


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
    s = cl.read(data_dir / "NaCl.cif")
    assert len(s) == 8
    assert s.composition == {"Na": 4, "Cl": 4}
    assert np.allclose(s.cellpar, (5.6402, 5.6402, 5.6402, 90, 90, 90))
    assert s.info["spacegroup"] == "F m -3 m"
    f = s.frac_positions
    assert np.all(f >= 0) and np.all(f < 1)


def test_cif_perovskite_pm3m(data_dir):
    s = cl.read(data_dir / "SrTiO3.cif")
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
    proj = cl.new_project("p", [build.molecule("water"), s])
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
    cl.write(p, si)
    assert cl.read(p).formula == "Si8"
    cl.write(tmp_path / "si.xyz", si)   # .xyz paths use extended XYZ (keeps the cell)
    assert cl.read(tmp_path / "si.xyz").cell is not None
    gz = tmp_path / "si.cif.gz"
    gz.write_bytes(gzip.compress(to_text(si, "cif").encode()))
    assert len(cl.read(gz)) == 8
    buf = stdio.StringIO(to_text(si, "xyz"))
    assert len(cl.read(buf, format="xyz")) == 8


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
