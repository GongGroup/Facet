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


# F0-D T4 (F0-D §3.10, §7.2 "POSCAR"); the shared cases are tests/data/surface/f0d/poscar.json.
from crystallume.core.structure import get_warnings  # noqa: E402
from crystallume.io.poscar import read_poscar, write_poscar  # noqa: E402

from .ops.f0d_poscar import poscar_canonical  # noqa: E402

_T, _F = True, False
_CUBE4 = "test\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0\n"
_SD_NOTE = ("selective dynamics: {n} line(s) had missing or unreadable T/F flags (first: line {line}, {what}); "
            "those directions were read as T (free)")
_GAAS = ("GaAs slab\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 20.0\n{species}\n1 1 2 2\nDirect\n0 0 0\n0.5 0.5 0.1\n"
         "0 0 0.2\n0.5 0 0.2\n0 0.5 0.3\n0.5 0.5 0.3\n")


def _sd_poscar(*rows: str) -> str:
    return _CUBE4 + f"Pt\n{len(rows)}\nSelective dynamics\nDirect\n" + "".join(f"0.1 0.2 0.3 {r}\n" for r in rows)


def _species_and_counts(text: str) -> tuple[list[str], list[int]]:
    lines = text.splitlines()
    return lines[5].split(), [int(c) for c in lines[6].split()]


@pytest.mark.parametrize("words, flags, problem", [
    ("T T F", [_T, _T, _F], None),
    (".TRUE. .TRUE. .FALSE.", [_T, _T, _F], None),
    (".T. .F. .T.", [_T, _F, _T], None),
    ("true false TRUE", [_T, _F, _T], None),
    ("t f t", [_T, _F, _T], None),
    ("T T F Si", [_T, _T, _F], None),          # pymatgen writes the element after the flags
    ("Si", [_T, _T, _T], "no flags"),
    ("F", [_T, _T, _T], "no flags"),           # one word: may be fluorine, not "fixed"
    ("", [_T, _T, _T], "no flags"),
    ("Fe Fe Fe", [_T, _T, _T], "'Fe'"),
    ("T T F ! Pt1", [_T, _T, _F], None),
])
def test_poscar_flag_words(words, flags, problem):
    """F0-D §3.10.1: the table of flag words (``.TRUE.`` used to read as fixed); problems make one note."""
    s = read_poscar(_sd_poscar(words))
    assert s.props["selective_dynamics"] == [flags]
    assert get_warnings(s.info) == ([_SD_NOTE.format(n=1, line=10, what=problem)] if problem else [])


def test_poscar_flag_note_counts_lines_and_names_the_first():
    s = read_poscar(_sd_poscar("T T F", "T T", "Fe T F", "F F F", "T .X. F"))
    assert s.props["selective_dynamics"] == [[_T, _T, _F], [_T, _T, _T], [_T, _T, _F], [_F, _F, _F], [_T, _T, _F]]
    assert get_warnings(s.info) == [_SD_NOTE.format(n=3, line=11, what="no flags")]
    # VASP 4 has no species line, so the coordinates start one line earlier; the first problem here is a word
    vasp4 = "Pt slab\n1.0\n4 0 0\n0 4 0\n0 0 4\n2\nSelective dynamics\nDirect\n0 0 0 T x T\n0.5 0.5 0.5\n"
    assert get_warnings(read_poscar(vasp4).info) == [_SD_NOTE.format(n=2, line=9, what="'x'")]
    # without a Selective dynamics line the words after the coordinates are not flags
    assert "selective_dynamics" not in read_poscar(_CUBE4 + "Pt\n1\nDirect\n0 0 0 F F F\n").props


def test_poscar_cartesian_flags_are_lattice_flags():
    """Domain review F8: in Cartesian mode the flags still refer to the cell vectors; they are never converted."""
    text = ("tilted\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n1.5 0.8 20.0\nO\n2\nSelective dynamics\nCartesian\n"
            "0.0 0.0 0.0 T T F\n1.5 0.8 10.0 F F T\n")
    s = read_poscar(text)
    assert s.props["selective_dynamics"] == [[_T, _T, _F], [_F, _F, _T]]
    assert np.allclose(s.positions, [[0, 0, 0], [1.5, 0.8, 10]], atol=1e-12)
    back = read_poscar(write_poscar(s))                       # written as Direct with the same flags
    assert back.props["selective_dynamics"] == s.props["selective_dynamics"]
    assert np.allclose(back.positions, s.positions, atol=1e-12)


def test_poscar_writes_selective_dynamics():
    """F0-D §3.10.2: the block is written whenever the key exists (all free included), after append, and every
    flag row follows its atom when the atoms are grouped by species."""
    s = Structure(["O", "Ti", "O", "Ti"], [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 2]], cell=np.eye(3) * 4,
                  props={"selective_dynamics": [[_F, _F, _F], [_T, _T, _F], [_T, _T, _T], [_F, _F, _T]]})
    text = write_poscar(s)
    assert _species_and_counts(text) == (["O", "Ti"], [2, 2])
    rows = text.splitlines()[9:13]
    assert [r.split()[3:] for r in rows] == [["F", "F", "F"], ["T", "T", "T"], ["T", "T", "F"], ["F", "F", "T"]]
    assert rows[1].split()[:3] == ["0.0000000000000000", "0.5000000000000000", "0.0000000000000000"]
    s.append("H", [1, 1, 3])                                  # a new atom is free: the block stays
    back = read_poscar(write_poscar(s))
    assert back.symbols == ["O", "O", "Ti", "Ti", "H"] and back.props["selective_dynamics"][-1] == [_T, _T, _T]
    free = Structure(["Pt"], [[0, 0, 0]], cell=np.eye(3) * 4, props={"selective_dynamics": [[_T, _T, _T]]})
    assert "Selective dynamics" in write_poscar(free)
    assert read_poscar(write_poscar(free)).props["selective_dynamics"] == [[_T, _T, _T]]
    assert "Selective dynamics" not in write_poscar(Structure(["Pt"], [[0, 0, 0]], cell=np.eye(3) * 4))
    s.props["selective_dynamics"][0] = None                   # one bad row used to drop the whole block
    assert read_poscar(write_poscar(s)).props["selective_dynamics"][0] == [_T, _T, _T]


def test_poscar_repeated_element_blocks():
    """F0-D §3.10.4: ``Ga As H H / 1 1 2 2`` keeps its four blocks (it used to become ``Ga As H / 1 1 4``)."""
    s = read_poscar(_GAAS.format(species="Ga As H H"))
    assert s.props["poscar_species"] == ["Ga", "As", "H", "H", "H#2", "H#2"]
    assert _species_and_counts(write_poscar(s)) == (["Ga", "As", "H", "H"], [1, 1, 2, 2])
    s.append("H", [2, 2, 8])                                  # joins the first H block
    assert s.props["poscar_species"][-1] == "H"
    assert _species_and_counts(write_poscar(s)) == (["Ga", "As", "H", "H"], [1, 1, 3, 2])
    s.sort_by_species()
    assert s.props["poscar_species"] == ["Ga", "As", "H", "H", "H", "H#2", "H#2"]
    raw = read_poscar(_GAAS.format(species="Ga As H.75 H1.25"))
    assert raw.props["poscar_species"] == ["Ga", "As", "H.75", "H.75", "H1.25", "H1.25"]
    assert _species_and_counts(write_poscar(raw))[0] == ["Ga", "As", "H", "H"]   # VASP reads two characters
    assert "poscar_species" not in read_poscar(_CUBE4 + "Ga As\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n").props
    stale = Structure(["H", "O", "H"], [[0, 0, 0], [2, 0, 0], [0, 2, 0]], cell=np.eye(3) * 4,
                      props={"poscar_species": ["H", "H#2", "H#2"]})   # the O was an H#2 before set_symbols
    assert _species_and_counts(write_poscar(stale)) == (["H", "O", "H"], [1, 1, 1])


def test_poscar_keep_order():
    """F0-D O-4: ``order="keep"`` writes the atoms in memory order, one block per run of one species."""
    s = Structure(["O", "O", "Ti", "O"], [[0, 0, 0], [0, 2, 0], [2, 0, 0], [2, 2, 2]], cell=np.eye(3) * 4)
    assert _species_and_counts(write_poscar(s, order="keep")) == (["O", "Ti", "O"], [2, 1, 1])
    back = read_poscar(write_poscar(s, order="keep"))
    assert back.symbols == s.symbols and np.allclose(back.positions, s.positions)
    with pytest.raises(ValueError, match=r"^order must be 'species' or 'keep'$"):
        write_poscar(s, order="sorted")


_XDAT_HEAD = "H2\n           1\n    {a:.6f}    0.000000    0.000000\n     0.000000   10.000000    0.000000\n" \
             "     0.000000    0.000000   10.000000\n   H\n     2\n"


def test_poscar_xdatcar_frames_with_their_own_cells():
    """F0-D §3.10.5 (ledger E-18): each configuration of a variable-cell XDATCAR is converted with its own cell."""
    text = (_XDAT_HEAD.format(a=10) + "Direct configuration=     1\n  0.0 0.0 0.0\n  0.075 0.0 0.0\n"
            + _XDAT_HEAD.format(a=11) + "Direct configuration=     2\n  0.1 0.0 0.0\n  0.175 0.0 0.0\n"
            + "Direct configuration=     3\n  0.2 0.0 0.0\n  0.275 0.0 0.0\n")
    s = parse_text(text, "poscar")
    assert s.n_frames == 3 and np.allclose(s.cell, np.diag([10, 10, 10]))
    assert np.allclose(s.frames[0]["cell"], np.diag([11, 10, 10]))
    assert np.allclose(s.frames[0]["positions"], [[1.1, 0, 0], [1.925, 0, 0]])   # not 1.0 and 1.75
    assert "cell" not in s.frames[1] and np.allclose(s.frames[1]["positions"], [[2.0, 0, 0], [2.75, 0, 0]])
    second = parse_text(text, "poscar", index=1)
    assert second.n_frames == 1 and np.allclose(second.cell, np.diag([11, 10, 10]))
    cut = text[:text.rindex("  0.275")]                       # a running job: the last configuration is cut off
    assert parse_text(cut, "poscar").n_frames == 2
    assert get_warnings(read_poscar(cut).info) == ["XDATCAR: the last configuration is incomplete and was skipped"]


def test_poscar_velocities():
    """Lead decision L-01, F0-D §3.10.6: non-zero CONTCAR velocities are read (Cartesian Å/fs) and written back."""
    head = _CUBE4 + "O Ti\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n"
    s = read_poscar(head + "\n  0.01 0.0 0.0\n  0.0 -0.02 0.005\n\n   1\n   1.0\n")    # + predictor-corrector
    assert s.props["velocities"] == [[0.01, 0.0, 0.0], [0.0, -0.02, 0.005]] and get_warnings(s.info) == []
    text = write_poscar(s)
    assert text.splitlines()[10] == ""                        # a blank line: Cartesian
    assert read_poscar(text).props["velocities"] == s.props["velocities"]
    s.sort_by_species(["Ti", "O"])                            # the velocities move with their atoms
    assert read_poscar(write_poscar(s)).props["velocities"] == [[0.0, -0.02, 0.005], [0.01, 0.0, 0.0]]
    zero = read_poscar(head + "\n0 0 0\n0 0 0\n")
    assert "velocities" not in zero.props and write_poscar(zero).count("\n") == 10
    scaled = read_poscar(head.replace("1.0\n4.0", "2.0\n2.0").replace("0.0 4.0", "0.0 2.0") + "\n0.01 0 0\n0 0 0\n")
    assert np.allclose(scaled.cell, np.eye(3) * 4) and scaled.props["velocities"][0] == [0.01, 0, 0]  # not scaled
    direct = read_poscar(head + "Direct\n0.01 0 0\n0 0.02 0\n")
    assert np.allclose(direct.props["velocities"], [[0.04, 0, 0], [0, 0.08, 0]])
    assert get_warnings(direct.info) == ["velocities in direct coordinates were converted to Å/fs assuming a time "
                                         "step of 1 fs"]
    lattice = ("Lattice velocities and vectors\n1\n0 0 0\n0 0 0\n0 0 0\n4 0 0\n0 4 0\n0 0 4\n\n0.01 0 0\n0 0.02 0\n")
    assert read_poscar(head + lattice).props["velocities"] == [[0.01, 0, 0], [0, 0.02, 0]]
    cut = read_poscar(head.replace("1 1\n", "1 2\n") + "0 0.5 0\n\n0.01 0 0\n0 0.02 0\n")
    assert "velocities" not in cut.props
    assert get_warnings(cut.info) == ["velocities: the block after the coordinates is incomplete (line 15); "
                                      "it was ignored"]


def test_poscar_writes_no_negative_zero():
    """Lead decision L-01: a number that rounds to zero is written without its sign (``-0.0000000000000000``)."""
    s = Structure(["Pt", "Pt"], [[-1e-17, 2.0, -0.0], [1.0, -4e-17, 3.0]],
                  cell=[[4.0, -1e-17, 0.0], [0.0, 4.0, -0.0], [-5e-17, 0.0, 4.0]])
    text = write_poscar(s)
    assert "-0.0" not in text
    assert text.count("0.0000000000000000") == 9               # six in the cell, three coordinates


def test_poscar_errors_name_the_line():
    """The errors (one text in both languages) name the line; ``parse_text`` adds the format."""
    with pytest.raises(ParseError, match=r"as poscar: line 7: expected the atom counts \(whole numbers\), found 'x'$"):
        parse_text(_CUBE4 + "H\nx\nDirect\n0 0 0\n0 0 0\n", "poscar")
    with pytest.raises(ValueError, match=r"^line 10: expected three coordinates, found 2$"):
        read_poscar(_CUBE4 + "H\n2\nDirect\n0 0 0\n0 0\n")
    with pytest.raises(ValueError, match=r"^expected 3 coordinate line\(s\), found 2$"):
        read_poscar(_CUBE4 + "H\n3\nDirect\n0 0 0\n0 0 0\n")
    with pytest.raises(ValueError, match=r"^line 4: expected a number, found 'inf'$"):
        read_poscar("x\n1.0\n4 0 0\n0 inf 0\n0 0 4\nH\n1\nDirect\n0 0 0\n")


def test_poscar_u1_contcar_round_trip(data_dir, tmp_path):
    """Design brief U1, acceptance S14-4: the CONTCAR fixture read and written without an edit is the same file
    (canonical form), pbc stays T T T, the atom order and the flags of every row are the same and no atom moves by
    more than 1e-8 Å; reading it leaves no note (the zero velocities are not stored)."""
    original = (data_dir / "surface" / "contcar_pt111.vasp").read_text()
    s = cl.read(data_dir / "surface" / "contcar_pt111.vasp")
    assert s.info["format"] == "poscar" and s.pbc == [True, True, True] and get_warnings(s.info) == []
    assert s.props["selective_dynamics"] == [[False] * 3] * 18 + [[True] * 3] * 18
    assert set(s.props) == {"selective_dynamics"}
    out = tmp_path / "CONTCAR"
    cl.write(out, s, format="poscar")
    text = out.read_text()
    assert poscar_canonical(text) == poscar_canonical(original)
    assert "-0.0" not in text
    back = cl.read(out)
    assert back.pbc == [True, True, True] and back.symbols == s.symbols
    assert back.props["selective_dynamics"] == s.props["selective_dynamics"]
    assert np.linalg.norm(back.positions - s.positions, axis=1).max() <= 1e-8
    f = back.frac_positions[:, 2]
    assert np.isclose(f[3], 0.99999) and np.isclose(f[7], 0.99999) and f[0] == 0.0   # not wrapped


def _same_reading(a: dict, b: dict, what: str) -> None:
    """Two readings of POSCAR text: the same atoms, cell (1e-8 Å) and properties (velocities within 1e-10 Å/fs)."""
    assert a["symbols"] == b["symbols"] and a["pbc"] == b["pbc"] and a["notes"] == b["notes"], what
    assert np.abs(np.reshape(a["positions"], (-1, 3)) - np.reshape(b["positions"], (-1, 3))).max() <= 1e-8, what
    assert np.abs(np.asarray(a["cell"]) - np.asarray(b["cell"])).max() <= 1e-8, what
    assert sorted(a["props"]) == sorted(b["props"]), what
    for key, col in a["props"].items():
        if key == "velocities":
            assert np.abs(np.asarray(col) - np.asarray(b["props"][key])).max() <= 1e-10, what
        else:
            assert col == b["props"][key], (what, key)


def test_poscar_cross_language_read_back(js, data_dir):
    """F0-D §3.10.2: the writers print numbers differently (16 and 10 decimals), so the check is on reading: each
    language reads the input, its own output and the other language's output as the same structure."""
    texts = [
        (data_dir / "surface" / "contcar_pt111.vasp").read_text(),
        _GAAS.format(species="Ga As H.75 H1.25"),
        _CUBE4 + "O Ti\n2 1\nSelective dynamics\nCartesian\n0 0 0 F F F\n2 0 0 T T F\n2 2 2 .TRUE. .F. t\n"
                 "\n0.01 0 0\n0 -0.02 0.005\n0.003 0.002 0.001\n",
    ]

    def py_view(text: str) -> dict:
        s = read_poscar(text)
        return {"symbols": s.symbols, "positions": s.positions.tolist(), "cell": s.cell.tolist(), "pbc": s.pbc,
                "props": s.props, "notes": get_warnings(s.info)}

    got = js("""
      const { readPOSCAR, writePOSCAR } = await web('io/poscar.js');
      const view = (text) => {
        const s = readPOSCAR(text);
        return { symbols: s.symbols, positions: s.positions, cell: s.cell, pbc: s.pbc, props: s.props, notes: s.info.warnings ?? [] };
      };
      return input.map(([text, pyText]) => ({ input: view(text), python: view(pyText), written: writePOSCAR(readPOSCAR(text)) }));
    """, [[t, write_poscar(read_poscar(t))] for t in texts])
    for k, (text, res) in enumerate(zip(texts, got, strict=True)):
        py_written = write_poscar(read_poscar(text))
        _same_reading(res["input"], py_view(text), f"text {k}: both read the input alike")
        _same_reading(res["python"], py_view(py_written), f"text {k}: JS reads the Python file as Python does")
        _same_reading(py_view(res["written"]), py_view(py_written), f"text {k}: the JS file reads as the Python one")


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
