"""Materials Studio XSD (``facet/io/xsd.py`` and ``facet/web/js/io/xsd.js``): docs/design/xsd-export.

* the writer: the golden files of ``tests/data/xsd`` (the same bytes from both languages), the four samples of the
  design, the files checked without the writer (an XML parser: unique IDs, no dangling references, counts; the
  numbers read back; the orientation of the cell), the rounding rule against JavaScript's ``toFixed``;
* the export check: the messages of the design, word for word, in both languages;
* the reader: our own files read back, files modelled on what Materials Studio writes (``tests/data/xsd/read``),
  the same structure, notes and errors in both languages;
* the registry: detection, the command line and the server.
"""

from __future__ import annotations

import importlib.util
import itertools
import json
import math
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
import pytest

import facet as cl
from facet import Structure
from facet.cli import main
from facet.core.lattice import cell_to_cellpar
from facet.io import (
    ExportWarning,
    ParseError,
    detect_format,
    export_filename,
    export_report,
    formats,
    get_reader,
    get_writer,
    parse_text,
    to_text,
    write,
)
from facet.io.capabilities import CAPABILITY_VALUES, WRITER_CAPABILITIES, validate_capabilities
from facet.io.xsd import _fixed, cell_orientation, non_elements, read_xsd, write_xsd

REPO = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parent / "data" / "xsd"
READ = DATA / "read"
SAMPLES = REPO / "docs" / "design" / "xsd-export" / "samples"
CASES: list[dict[str, Any]] = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))["cases"]
READ_CASES: list[dict[str, Any]] = json.loads((READ / "expected.json").read_text(encoding="utf-8"))["cases"]
BY_ID = {c["id"]: c for c in CASES}

# the messages of the design (docs/design/xsd-export/README.md §6), word for word
PARTLY_FIXED = ("{n} atom(s) are fixed along some directions only; Materials Studio XSD fixes whole atoms, so they are "
                "written as fixed")
TURNED = ("the cell is written in Materials Studio's orientation (c along z, b in the yz plane): the structure is "
          "turned as a whole and the fractional coordinates are unchanged")
LEFT_HANDED = ("the cell is left-handed (negative volume) and is written as it is; Materials Studio may show its "
               "mirror image")


def golden(case: dict[str, Any]) -> str:
    return (DATA / case["file"]).read_bytes().decode("ascii")   # the files are plain ASCII


def structure(case: dict[str, Any]) -> Structure:
    return Structure.from_dict(case["structure"])


def ids(cases: list[dict[str, Any]], key: str = "id") -> list[str]:
    return [c[key] for c in cases]


WITH_ATOMS = [c for c in CASES if c["structure"]["symbols"]]
PERIODIC = [c for c in CASES if c["structure"]["cell"] is not None]


# ---------------------------------------------------------------------------------------------- the writer
def test_the_cases_cover_the_design():
    """docs/design/xsd-export §8.1: the structures the golden files must cover."""
    assert len(CASES) == len(BY_ID) >= 18
    for wanted in ("nacl-bulk", "pt111-slab-fixed", "triclinic", "h2o-molecule", "srtio3-labels", "partial-constraints",
                   "left-handed", "special-names-molecule", "outside-cell", "empty-crystal", "empty-molecule"):
        assert wanted in BY_ID, wanted
    assert sorted(c["sample"] for c in CASES if "sample" in c) == sorted(p.name for p in SAMPLES.glob("*.xsd"))


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_python_writes_the_golden_file(case):
    s = structure(case)
    assert to_text(s, "xsd") == write_xsd(s) == golden(case)
    assert export_report(s, "xsd") == {"warnings": case["warnings"], "notes": case["notes"]}


def test_js_writes_the_same_bytes(js):
    out = js("""
        const { Structure } = await web('core/structure.js');
        const { exportStructure, formats } = await web('io/index.js');
        return input.map((c) => {
          const s = Structure.fromJSON(c.structure);
          const r = exportStructure(s, 'xsd');
          return { id: c.id, text: r.text, warnings: r.warnings, notes: r.notes, mime: r.mime, filename: r.filename,
                   direct: formats.get('xsd').write(s) === r.text };
        });""", [{"id": c["id"], "structure": c["structure"]} for c in CASES])
    assert [r["id"] for r in out] == ids(CASES)
    for case, r in zip(CASES, out):
        assert r["text"] == golden(case), case["id"]
        assert (r["warnings"], r["notes"]) == (case["warnings"], case["notes"]), case["id"]
        assert r["mime"] == "application/xml" and r["filename"].endswith(".xsd") and r["direct"]


@pytest.mark.parametrize("case", [c for c in CASES if "sample" in c], ids=lambda c: c["sample"])
def test_the_samples_of_the_design_are_reproduced(case):
    """The four files a prototype of the design wrote: the golden files are those files, byte for byte."""
    assert golden(case) == (SAMPLES / case["sample"]).read_bytes().decode("ascii")


def test_the_generator_is_in_step_with_the_files():
    spec = importlib.util.spec_from_file_location("make_xsd_cases", DATA / "make_xsd_cases.py")
    module = importlib.util.module_from_spec(spec)
    cache, sys.dont_write_bytecode = sys.dont_write_bytecode, True     # no __pycache__ in the data folder
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = cache
    files = module.build_files()
    assert sorted(files) == sorted(p.name for p in DATA.iterdir() if p.suffix in (".xsd", ".json"))
    for name, text in files.items():
        assert (DATA / name).read_text(encoding="utf-8") == text, name


# -------------------------------------------------------------------- the files, checked without the writer
SINGLE_REFS = ("Mapping", "Parent", "SymmetryDefinition", "ActiveSystem", "TotalConstraintMapping")
LIST_REFS = ("Children", "MappedObjects", "DefectObjects")


def numbers(text: str) -> list[float]:
    return [float(v) for v in text.split(",")]


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_file_structure(case):
    text = golden(case)
    n = len(case["structure"]["symbols"])
    assert text.endswith("</XSD>\n") and "\r" not in text and not text.endswith("\n\n")
    assert all(not line or line[0] in "\t<" for line in text.split("\n")) and "  <" not in text   # tabs, no spaces
    root = ET.fromstring(text)
    assert root.tag == "XSD" and root.attrib == {"Version": "6.0", "WrittenBy": "Facet"}
    elements = list(root.iter())
    with_id = [e.attrib["ID"] for e in elements if "ID" in e.attrib]
    assert len(with_id) == len(set(with_id)), "IDs must be unique"
    known = set(with_id)
    for e in elements:
        for key in SINGLE_REFS:
            assert e.attrib.get(key, "1") in known, (e.tag, key)
        for key in LIST_REFS:
            for ref in filter(None, e.attrib.get(key, "").split(",")):
                assert ref in known, (e.tag, key, ref)
    tree = root.find("AtomisticTreeRoot")
    assert int(tree.attrib["NumProperties"]) == len(tree.findall("Property")) == 40
    atoms = [e for e in elements if e.tag == "Atom3d"]
    assert len(atoms) == n and [a.attrib["UserID"] for a in atoms] == [str(k + 1) for k in range(n)]
    assert [a.attrib["Components"] for a in atoms] == case["structure"]["symbols"]
    flags = case["structure"].get("props", {}).get("selective_dynamics")
    fixed = [not all(row) for row in flags] if flags else [False] * n
    # fixed notation: 12 decimals for fractional coordinates, 10 for Å; no zero with a sign
    periodic = case["structure"]["cell"] is not None
    coordinate = re.compile(r"-?\d+\.\d{12}" if periodic else r"-?\d+\.\d{10}")
    length = re.compile(r"-?\d+\.\d{10}")
    assert all(coordinate.fullmatch(v) for a in atoms for v in a.attrib["XYZ"].split(","))
    for group in root.iter("SpaceGroup"):
        assert all(length.fullmatch(v) for k in ("AVector", "BVector", "CVector") for v in group.attrib[k].split(","))
    assert not re.search(r'[",]-0\.0+[",]', text)
    if not periodic:
        molecule = tree.find("Molecule")
        assert int(molecule.attrib["NumChildren"]) == n and list(molecule) == atoms
        assert [a.attrib.get("RestrictedProperties") for a in atoms] == ["XYZ" if f else None for f in fixed]
    else:
        system = tree.find("SymmetrySystem")
        identity = system.find("MappingSet/MappingFamily/IdentityMapping")
        assert int(identity.attrib["NumImages"]) == n and int(system.attrib["UserID"]) == n + 1
        assert [e.tag for e in identity] == ["Atom3d"] * n + ["SpaceGroup", "ReciprocalLattice3D"]
        group = identity.find("SpaceGroup")
        assert group.attrib["Name"] == "P1" and group.attrib["ITNumber"] == "1"
        assert system.attrib["Children"].split(",") == [a.attrib["ID"] for a in atoms] + [group.attrib["ID"]]
        assert identity.attrib["MappedObjects"] == ",".join(a.attrib["ID"] for a in atoms)
        assert [a.attrib.get("RestrictedProperties") for a in atoms] == ["FractionalXYZ" if f else None for f in fixed]


@pytest.mark.parametrize("case", WITH_ATOMS, ids=ids(WITH_ATOMS))
def test_numbers_read_back(case):
    """The coordinates and the cell of the file, read with an XML parser, are those of the structure."""
    root = ET.fromstring(golden(case))
    xyz = np.array([numbers(a.attrib["XYZ"]) for a in root.iter("Atom3d")])
    pos = np.array(case["structure"]["positions"], dtype=float)
    if case["structure"]["cell"] is None:
        assert np.abs(xyz - pos).max() <= 0.5e-10 + 1e-15
        return
    cell = np.array(case["structure"]["cell"], dtype=float)
    group = next(root.iter("SpaceGroup"))
    written = np.array([numbers(group.attrib[k]) for k in ("AVector", "BVector", "CVector")])
    frac = np.linalg.solve(cell.T, pos.T).T
    assert np.abs(xyz - frac).max() < 1e-11                               # fractional coordinates are unchanged
    assert np.allclose(cell_to_cellpar(written), cell_to_cellpar(cell), atol=1e-8, rtol=0)   # the same cell ...
    if case["id"] == "left-handed":
        assert np.abs(written - cell).max() < 1e-9 and np.linalg.det(written) < 0            # ... written as it is
    else:
        assert np.linalg.det(written) > 0                                 # ... in Materials Studio's orientation:
        assert written[2, 0] == written[2, 1] == 0 and written[2, 2] > 0  # c along z,
        assert written[1, 0] == 0 and written[1, 1] > 0                   # b in the yz plane
    new = xyz @ written
    pairs = list(itertools.combinations(range(len(pos)), 2))
    for i, j in pairs[:400]:                                              # the structure is turned as a whole
        assert abs(np.linalg.norm(new[i] - new[j]) - np.linalg.norm(pos[i] - pos[j])) < 1e-8


def test_orientation():
    cubic = np.diag([4.0, 4.0, 4.0])
    hexagonal = np.array([[2.77, 0.0, 0.0], [-1.385, 2.39889, 0.0], [0.0, 0.0, 20.0]])
    assert cell_orientation(cubic) == "same"
    assert cell_orientation(cubic + 5e-9 * np.ones((3, 3))) == "same"       # within 1e-8 Å: written as it is
    assert cell_orientation(hexagonal) == "rotated"                         # a along x: b is not in the yz plane
    assert cell_orientation([[2.39889, -1.385, 0.0], [0.0, 2.77, 0.0], [0.0, 0.0, 20.0]]) == "same"
    assert cell_orientation(hexagonal[[1, 0, 2]]) == "left-handed"
    with pytest.raises(ValueError, match="Materials Studio XSD: the unit cell has no volume"):
        cell_orientation([[1, 0, 0], [2, 0, 0], [0, 0, 1]])
    flat = Structure(["H"], [[0, 0, 0]], cell=np.eye(3))
    flat.cell = np.array([[1.0, 0, 0], [2.0, 0, 0], [0, 0, 1.0]])
    with pytest.raises(ValueError, match="no volume"):
        write_xsd(flat)


FIXED = [
    (2.0 ** -13, 12, "0.000122070313"),      # exactly halfway: away from zero (format() gives ...312)
    (-(2.0 ** -13), 12, "-0.000122070313"),
    (2.0 ** -11, 10, "0.0004882813"),
    (-1e-13, 12, "0.000000000000"),          # rounds to zero: no sign
    (-0.0, 12, "0.000000000000"),
    (-4e-11, 10, "0.0000000000"),
    (1.0 / 3.0, 12, "0.333333333333"),
    (2.0 / 3.0, 12, "0.666666666667"),
    (0.1 + 0.2, 12, "0.300000000000"),
    (-1.5, 10, "-1.5000000000"),
    (123456789.123456789, 10, "123456789.1234567910"),
    (1e20, 10, "100000000000000000000.0000000000"),
    (5e-324, 12, "0.000000000000"),
]


def test_numbers_are_written_like_tofixed(js):
    assert f"{2.0 ** -13:.12f}" == "0.000122070312"    # why format() is not used: it rounds halves to even
    for value, decimals, text in FIXED:
        assert _fixed(value, decimals) == text, value
    for bad in (math.nan, math.inf, -math.inf, 1e21, -1e21, 1.5e300):
        assert _fixed(bad, 10) is None
    rng = np.random.default_rng(20261111)
    values = [v for v, _, _ in FIXED]
    values += (rng.standard_normal(600) * 10.0 ** rng.integers(-14, 6, 600)).tolist()
    values += (rng.integers(-4096, 4096, 400) / 2.0 ** rng.integers(8, 20, 400)).tolist()     # many exact halves
    values += [k * 5e-13 for k in range(-40, 41)] + [k * 5e-11 for k in range(-40, 41)]
    out = js("const strip = (t) => (/^-[0.]*$/.test(t) ? t.slice(1) : t);"
             "return input.map((x) => [strip(x.toFixed(12)), strip(x.toFixed(10))]);", values)
    assert out == [[_fixed(v, 12), _fixed(v, 10)] for v in values]


def test_writer_refuses_what_it_cannot_write():
    s = Structure(["H", "H"], [[0, 0, 0], [0, 1, 0]])
    s.positions[1, 1] = math.inf                              # the constructor refuses such numbers
    with pytest.raises(ValueError, match="Materials Studio XSD: atom 2 has a value that is not a finite number"):
        write_xsd(s)
    with pytest.raises(ValueError, match="atom 1 has a value"):
        write_xsd(Structure(["H"], [[1e22, 0, 0]], cell=np.eye(3)))


def test_names_and_frames():
    s = Structure(["O", "H", "H"], [[0, 0, 0], [1, 0, 0], [0, 1, 0]], props={"labels": ["Ow", "", "  "]}, name="  ")
    text = write_xsd(s)
    assert 'Name="Ow"' in text and 'Name="H1"' in text and 'Name="H2"' in text    # empty labels: element numbers
    assert '<Molecule ID="2" NumChildren="3" Name="Untitled">' in text
    traj = structure(BY_ID["trajectory"])
    assert traj.n_frames == 3 and write_xsd(traj) == write_xsd(traj.get_frame(0)) != write_xsd(traj.get_frame(2))
    assert non_elements(["Pt", "X", "Xx", "X", "O"]) == ["X", "Xx"] and non_elements(["Pt"]) == []


# ------------------------------------------------------------------------------------------ the export check
def test_capabilities():
    caps = WRITER_CAPABILITIES["xsd"]
    assert dict(caps) == {"label": "Materials Studio XSD", "frames": "one", "cell": True, "constraints": "atoms",
                          "occupancy": False, "order": "keep", "pbc": "periodic", "overlap": True,
                          "handedness": False, "velocities": False}
    assert CAPABILITY_VALUES["constraints"] == ("lattice", "cartesian", "atoms", "none")
    assert validate_capabilities("x", caps) == dict(caps)
    spec = get_writer("xsd")
    assert spec.capabilities == dict(caps) and spec.extensions == [".xsd"] and spec.mimetype == "application/xml"
    assert spec.description == "Materials Studio XSD (3D atomistic document; save as .xsd)"


def test_the_messages_of_the_design():
    report = lambda case_id: export_report(structure(BY_ID[case_id]), "xsd")   # noqa: E731
    assert report("nacl-bulk") == {"warnings": [], "notes": []}
    assert report("pt111-slab-fixed") == {"warnings": [], "notes": [TURNED]}       # whole atoms fixed: no warning
    assert report("triclinic") == {"warnings": [], "notes": [TURNED]}
    assert report("partial-constraints") == {"warnings": [PARTLY_FIXED.format(n=2)], "notes": []}
    assert report("molecule-fixed") == {"warnings": [PARTLY_FIXED.format(n=1)], "notes": []}
    assert report("left-handed") == {"warnings": [LEFT_HANDED], "notes": []}
    assert report("h2o-molecule") == report("outside-cell") == report("special-names-crystal") == \
        {"warnings": [], "notes": []}
    assert report("dummy-atoms")["warnings"] == [
        "2 atom(s) have a symbol that is not a chemical element (X); Materials Studio may not recognise them"]
    assert report("trajectory")["warnings"] == ["Materials Studio XSD holds one frame: wrote frame 1 of 3"]
    assert report("slab-open-axis")["notes"] == [
        TURNED, "Materials Studio XSD is always periodic: c was not periodic and is written as a cell vector with a "
                "17.7 Å gap between periodic images"]
    lossy = report("lossy")
    assert lossy["warnings"] == [
        "1 site(s) are partially occupied, but Materials Studio XSD cannot store occupancy; they are written as full "
        "atoms", "1 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 2, 0.30 Å apart)"]
    assert lossy["notes"] == ["the atoms have velocities, but Materials Studio XSD cannot store them; use POSCAR, "
                              "Extended XYZ or Facet JSON to keep them"]
    # the other formats say nothing new
    slab = structure(BY_ID["partial-constraints"])
    assert not any("whole atoms" in m for fmt in ("poscar", "extxyz", "cif", "json") for m in
                   export_report(slab, fmt)["warnings"])
    assert not any("Materials Studio" in m for m in export_report(structure(BY_ID["left-handed"]), "poscar")["warnings"])


def test_write_warns(tmp_path):
    s = structure(BY_ID["partial-constraints"])
    with pytest.warns(ExportWarning) as caught:
        write(tmp_path / "slab.xsd", s)                       # the format follows from the name
    assert [str(w.message) for w in caught] == [PARTLY_FIXED.format(n=2)]
    assert (tmp_path / "slab.xsd").read_text() == golden(BY_ID["partial-constraints"])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        write(tmp_path / "bulk.xsd", structure(BY_ID["nacl-bulk"]))   # nothing lost: no warning (the note is not one)
        write(tmp_path / "slab2.xsd", structure(BY_ID["pt111-slab-fixed"]))
    assert export_filename(structure(BY_ID["triclinic"]), "xsd") == "triclinic.xsd"


# ---------------------------------------------------------------------------------------------- the reader
def flags_of(s: Structure) -> list[int] | None:
    rows = s.props.get("selective_dynamics")
    if rows is None:
        return None
    assert all(list(r) in ([True] * 3, [False] * 3) for r in rows)
    return [i for i, r in enumerate(rows) if not r[0]]


@pytest.mark.parametrize("case", WITH_ATOMS, ids=ids(WITH_ATOMS))
def test_our_files_read_back(case):
    """Cell, fractional coordinates, elements, order, fixed atoms and names survive; a second write is the file."""
    text = golden(case)
    src = structure(case)
    back = parse_text(text, "xsd")
    assert detect_format(text=text) == "xsd" and parse_text(text).symbols == back.symbols
    assert back.symbols == src.symbols and back.info == {"format": "xsd"}
    root = ET.fromstring(text)
    assert back.props["labels"] == [a.attrib["Name"] for a in root.iter("Atom3d")]
    flags = src.props.get("selective_dynamics")
    fixed = [i for i, row in enumerate(flags) if not all(row)] if flags else []
    assert (flags_of(back) or []) == fixed
    if src.cell is None:
        assert back.cell is None and back.pbc == [False] * 3 and np.abs(back.positions - src.positions).max() < 1e-10
        assert back.name == root.find("AtomisticTreeRoot/Molecule").attrib["Name"]
    else:
        assert back.pbc == [True] * 3 and back.name == ""
        assert np.allclose(back.cellpar, src.cellpar, atol=1e-8, rtol=0)
        assert np.abs(back.frac_positions - src.frac_positions).max() < 1e-11      # not wrapped either
    assert to_text(back, "xsd") == text


def test_reading_gives_the_structure_name_from_the_file_name(tmp_path):
    path = tmp_path / "Pt slab.xsd"
    path.write_bytes(golden(BY_ID["pt111-slab-fixed"]).encode("latin-1"))
    s = cl.read(path)
    assert s.name == "Pt slab" and len(s) == 36 and s.info["filename"] == "Pt slab.xsd"
    assert s.constraint_summary()["fixed"] == 18 and s.constraint_summary()["partial"] == 0


def check_read(s: Structure, want: dict[str, Any]) -> None:
    assert s.symbols == want["symbols"]
    assert s.name == (want["name"] or "")
    if want["cell"] is None:
        assert s.cell is None and s.pbc == [False] * 3
        assert np.abs(s.positions - np.array(want["positions"], dtype=float)).max() < 1e-12
    else:
        cell = np.array(want["cell"], dtype=float)
        assert s.pbc == [True] * 3 and np.array_equal(s.cell, cell)
        assert np.abs(s.positions - np.array(want["frac"], dtype=float) @ cell).max() < 1e-12
    assert s.props.get("labels") == want["labels"]
    assert flags_of(s) == want["fixed"]
    assert s.info.get("spacegroup") == want["spacegroup"]
    assert s.info.get("warnings", []) == want["warnings"]
    assert sorted(s.props) == sorted(k for k, v in (("labels", want["labels"]), ("selective_dynamics", want["fixed"]))
                                     if v is not None)


@pytest.mark.parametrize("want", READ_CASES, ids=ids(READ_CASES, "file"))
def test_reader_fixtures(want):
    text = (READ / want["file"]).read_text(encoding="utf-8")
    check_read(read_xsd(text), want)
    check_read(read_xsd(text.replace("\n", "\r\n")), want)          # Materials Studio writes CRLF
    check_read(read_xsd("﻿" + text), want)
    s = parse_text(text, filename=want["file"])
    assert s.info["format"] == "xsd" and s.name == (want["name"] or want["file"][:-4])


def reader_outputs(s: Structure) -> dict[str, Any]:
    return {"symbols": s.symbols, "positions": np.asarray(s.positions).tolist(),
            "cell": None if s.cell is None else s.cell.tolist(), "pbc": s.pbc,
            "labels": s.props.get("labels"), "flags": s.props.get("selective_dynamics"),
            "warnings": s.info.get("warnings", []), "spacegroup": s.info.get("spacegroup")}


def test_both_readers_give_the_same(js):
    """The same structure and the same notes from Python and JavaScript, to the last bit of every coordinate."""
    texts = {c["file"]: (READ / c["file"]).read_text(encoding="utf-8") for c in READ_CASES}
    texts.update({c["file"]: golden(c) for c in WITH_ATOMS})
    out = js("""
        const { readXSD } = await web('io/xsd.js');
        const { parseStructure } = await web('io/index.js');
        const res = {};
        for (const [file, text] of Object.entries(input)) {
          const s = readXSD(text, `some/dir/${file}`);
          const viaRegistry = parseStructure(text, file);
          res[file] = { symbols: s.symbols, positions: Array.from({ length: s.length }, (_, i) => Array.from(s.positions.slice(3 * i, 3 * i + 3))),
            cell: s.cell, pbc: s.pbc, labels: s.props.labels ?? null, flags: s.props.selective_dynamics ?? null,
            warnings: s.info.warnings ?? [], spacegroup: s.info.spacegroup ?? null, name: s.name,
            source: viaRegistry.info.source, sameLength: viaRegistry.length === s.length };
        }
        return res;""", texts)
    names = {c["file"]: c["name"] for c in READ_CASES}
    for file, text in texts.items():
        got = out[file]
        assert got.pop("source") == "xsd" and got.pop("sameLength")
        name = got.pop("name")
        py = read_xsd(text)
        assert name == (py.name or file[:-4]) and (file not in names or name == (names[file] or file[:-4]))
        assert got == reader_outputs(py), file


BAD = {
    "schema": '<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="a"/></xs:schema>',
    "empty": "",
    "text": "8\nLattice=\"1 0 0 0 1 0 0 0 1\"\n",
    "no atoms": "<XSD><AtomisticTreeRoot><Molecule Name='m'/></AtomisticTreeRoot></XSD>",
    "only images": '<XSD><AtomisticTreeRoot><Atom3d ID="5" ImageOf="4"/></AtomisticTreeRoot></XSD>',
    "cut in a tag": '<XSD><AtomisticTreeRoot><Atom3d ID="1" XYZ="0,0,0',
    "cut in a comment": "<XSD><AtomisticTreeRoot><!-- <Atom3d/>",
    "cut in the doctype": "<!DOCTYPE XSD [ <!ENTITY a 'b'>",
    "2D": ('<XSD><AtomisticTreeRoot><SymmetrySystem><PlaneGroup AVector="1,0,0" BVector="0,1,0"/>'
           '<Atom3d XYZ="0,0,0" Components="C"/></SymmetrySystem></AtomisticTreeRoot></XSD>'),
    "two numbers": '<XSD><Atom3d XYZ="1,2" Components="C"/></XSD>',
    "not numbers": '<XSD><Atom3d XYZ="0,0,0" Components="C"/><Atom3d XYZ="a,b,c" Components="C"/></XSD>',
    "hex number": '<XSD><Atom3d XYZ="0x10,0,0" Components="C"/></XSD>',
    "overflow": '<XSD><Atom3d XYZ="1e999,0,0" Components="C"/></XSD>',
    "bad lattice": ('<XSD><SpaceGroup AVector="1,0" BVector="0,1,0" CVector="0,0,1"/>'
                    '<Atom3d XYZ="0,0,0" Components="C"/></XSD>'),
}
BAD_MESSAGES = {
    "schema": "XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same extension",
    "empty": "XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same extension",
    "text": "XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same extension",
    "no atoms": "XSD: the document has no atoms (Atom3d)",
    "only images": "XSD: the document has no atoms (Atom3d)",
    "cut in a tag": "XSD: the file ends in the middle of a tag",
    "cut in a comment": "XSD: the file ends in the middle of a tag",
    "cut in the doctype": "XSD: the file ends in the middle of a tag",
    "2D": "XSD: this is a 2D periodic document (PlaneGroup); only 3D periodic documents and molecules can be read",
    "two numbers": 'XSD: atom 1: XYZ="1,2" is not three numbers',
    "not numbers": 'XSD: atom 2: XYZ="a,b,c" is not three numbers',
    "hex number": 'XSD: atom 1: XYZ="0x10,0,0" is not three numbers',
    "overflow": 'XSD: atom 1: XYZ="1e999,0,0" is not three numbers',
    "bad lattice": 'XSD: AVector="1,0" of the lattice is not three numbers',
}


def test_reader_errors_are_the_same_in_both_languages(js):
    assert sorted(BAD) == sorted(BAD_MESSAGES)
    for key, text in BAD.items():
        with pytest.raises(ValueError) as err:
            read_xsd(text)
        assert str(err.value) == BAD_MESSAGES[key], key
    with pytest.raises(ParseError, match="could not parse 'a.xsd' as xsd: XSD: the document has no atoms"):
        parse_text(BAD["no atoms"], filename="a.xsd")
    out = js("const { readXSD } = await web('io/xsd.js'); const res = {};"
             "for (const [k, t] of Object.entries(input)) { try { readXSD(t); res[k] = null; } catch (e) { res[k] = e.message; } }"
             "return res;", BAD)
    assert out == BAD_MESSAGES


TOLERATED = {
    # end tags that match nothing, elements left open, a stray "<", ">" and "<" inside attribute values
    "sloppy": ('<XSD Version="1"><AtomisticTreeRoot></Nothing><Molecule Name="a > b < c">'
               '<Atom3d Name="x>y" XYZ="1,2,3" Components="C"><Properties Note="<odd>">'
               '<Atom3d XYZ="4,5,6" Components="O" junk here/> < <Atom3d XYZ="7,8,9" Components="N">'),
    # a document nested ten thousand elements deep must not exhaust the stack
    "deep": "<XSD>" + "<Group>" * 10000 + '<Atom3d XYZ="1,1,1" Components="He"/>' + "</Group>" * 10000 + "</XSD>",
    # ... and end tags that close nothing must not each walk up all the open elements
    "unmatched": "<XSD>" + "<Group>" * 30000 + "</Other>" * 30000 + '<Atom3d XYZ="2,2,2" Components="Ne"/>',
    # the two character references that are not characters, a reference too long to be one
    "references": '<XSD><Atom3d Name="a&#0;b&#xD800;c&#x110000;d&#99999999999;e&#x41;" XYZ="0,0,0" Components="H"/></XSD>',
}


def test_reader_is_tolerant_in_the_same_way_in_both_languages(js):
    sloppy = read_xsd(TOLERATED["sloppy"])
    assert sloppy.symbols == ["C", "O", "N"] and sloppy.positions.tolist() == [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    assert sloppy.name == "a > b < c" and sloppy.props["labels"] == ["x>y", "O", "N"]
    deep = read_xsd(TOLERATED["deep"])
    assert deep.symbols == ["He"] and read_xsd(TOLERATED["unmatched"]).symbols == ["Ne"]
    refs = read_xsd(TOLERATED["references"])
    assert refs.props["labels"] == ["a�b�c�d&#99999999999;eA"]
    out = js("const { readXSD } = await web('io/xsd.js'); const res = {};"
             "for (const [k, t] of Object.entries(input)) { const s = readXSD(t, 'f.xsd');"
             "  res[k] = [s.symbols, Array.from(s.positions), s.props.labels ?? null, s.name]; }"
             "return res;", TOLERATED)
    for key, text in TOLERATED.items():
        s = read_xsd(text)
        assert out[key] == [s.symbols, s.positions.ravel().tolist(), s.props.get("labels"), s.name or "f"], key


def test_entities_of_a_doctype_are_never_expanded():
    text = (READ / "components_and_entities.xsd").read_text(encoding="utf-8")
    s = read_xsd(text)
    assert "&xxe;" in s.props["labels"] and not any("root:" in lab for lab in s.props["labels"])
    assert max(len(lab) for lab in s.props["labels"]) < 40          # "&big;" stays five characters


# -------------------------------------------------------------------- registry, command line, server
def test_registry_and_detection():
    reader = get_reader("xsd")
    assert reader.extensions == [".xsd"] and "Materials Studio" in reader.description
    names = [w["name"] for w in formats()["writers"]]
    assert names.index("xsd") == names.index("pdb") + 1               # after PDB in the Export menu
    assert "xsd" in [r["name"] for r in formats()["readers"]]
    for name in ("slab.xsd", "SLAB.XSD", "dir/slab.xsd.gz"):
        assert detect_format(name) == "xsd"
    sample = golden(BY_ID["h2o-molecule"])
    assert detect_format(text=sample) == detect_format("unknown.dat", sample) == "xsd"
    assert detect_format(text="﻿" + sample) == "xsd"
    assert detect_format(text="<html><body>XSD</body></html>") is None
    assert detect_format(text=BAD["schema"]) is None                  # an XML Schema file is not sniffed as ours


def test_detection_in_the_web_app(js):
    out = js("""
        const { detectFormat, formats } = await web('io/index.js');
        const f = formats.get('xsd');
        return { byName: detectFormat('slab.xsd'), upper: detectFormat('SLAB.XSD'), byText: detectFormat('', input.sample),
                 pasted: detectFormat('pasted', input.sample), html: detectFormat('', '<html><body>XSD</body></html>'),
                 schema: detectFormat('', input.schema), poscar: detectFormat('POSCAR', ''),
                 entry: { name: f.name, extensions: f.extensions, mime: f.mime, description: f.description, caps: f.capabilities },
                 order: formats.writers().map((w) => w.id) };""",
             {"sample": golden(BY_ID["h2o-molecule"]), "schema": BAD["schema"]})
    assert (out["byName"], out["upper"], out["byText"], out["pasted"]) == ("xsd",) * 4
    assert out["html"] is None and out["schema"] is None and out["poscar"] == "poscar"
    assert out["entry"] == {"name": "Materials Studio XSD", "extensions": ["xsd"], "mime": "application/xml",
                            "description": "Materials Studio XSD (3D atomistic document; save as .xsd)",
                            "caps": dict(WRITER_CAPABILITIES["xsd"])}
    assert out["order"].index("xsd") == out["order"].index("pdb") + 1


def test_command_line(tmp_path, data_dir, capsys):
    out = tmp_path / "slab.xsd"
    assert main(["convert", str(data_dir / "surface" / "contcar_pt111.vasp"), str(out)]) == 0
    assert out.read_text() == golden(BY_ID["pt111-slab-fixed"])
    back = tmp_path / "POSCAR"
    assert main(["convert", str(out), str(back)]) == 0
    s = cl.read(back)
    assert len(s) == 36 and s.constraint_summary()["fixed"] == 18
    capsys.readouterr()
    assert main(["formats"]) == 0
    listed = capsys.readouterr().out
    assert "xsd" in listed and "Materials Studio XSD" in listed


def test_server(local_client, data_dir):
    listed = local_client.get("/api/v1/formats").json()
    assert "xsd" in {r["name"] for r in listed["readers"]}
    writer = {w["name"]: w for w in listed["writers"]}["xsd"]
    assert writer["capabilities"]["constraints"] == "atoms" and writer["mimetype"] == "application/xml"
    contcar = (data_dir / "surface" / "contcar_pt111.vasp").read_text()
    slab = local_client.post("/api/v1/io/parse", json={"text": contcar, "filename": "CONTCAR"}).json()["structure"]
    body = local_client.post("/api/v1/io/export", json={"structure": slab, "format": "xsd"}).json()
    assert body["filename"].endswith(".xsd") and body["mimetype"] == "application/xml"
    assert body["warnings"] == [] and body["notes"] == [TURNED] and body["text"].count("FractionalXYZ") == 18
    parsed = local_client.post("/api/v1/io/parse", json={"text": body["text"], "filename": "slab.xsd"}).json()
    assert parsed["structure"]["symbols"] == ["Pt"] * 36 and parsed["structure"]["info"]["format"] == "xsd"
    r = local_client.post("/api/v1/io/convert", files={"file": ("slab.xsd", body["text"].encode())}, data={"to": "poscar"})
    assert r.status_code == 200 and "Selective dynamics" in r.text
