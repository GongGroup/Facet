#!/usr/bin/env python3
"""Write the golden files of the Materials Studio XSD writer: ``cases.json`` and one ``<id>.xsd`` per case.

    python tests/data/xsd/make_xsd_cases.py            # write
    python tests/data/xsd/make_xsd_cases.py --check    # compare with the files on disk (exit 1 when they differ)

Run it from the repository root with this checkout's ``facet`` importable.  The tests never run it.

Each case of ``cases.json`` holds the input structure (``facet.structure/1``, coordinates with every digit, so both
languages start from the same numbers), the name of the expected file, and the warnings and notes of the export check.
The expected files are what the Python writer gives; ``tests/test_xsd.py`` and ``tests/js/io_xsd.test.mjs`` then
require the same bytes from both languages, and check the files themselves without the writer: against the four files
of ``docs/design/xsd-export/samples`` (written by the prototype of the design, case key ``sample``), with an XML
parser (unique IDs, no dangling references, counts) and by reading the numbers back.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO))

import facet  # noqa: E402
from facet import Structure, build  # noqa: E402
from facet.core.lattice import cellpar_to_cell  # noqa: E402
from facet.io import export_report, to_text  # noqa: E402

T, F = True, False


def as_json(s: Structure) -> dict[str, Any]:
    """The structure as ``facet.structure/1`` with every digit of its coordinates."""
    out: dict[str, Any] = {
        "schema": "facet.structure/1",
        "name": s.name,
        "symbols": list(s.symbols),
        "positions": np.asarray(s.positions, dtype=float).tolist(),
        "cell": None if s.cell is None else np.asarray(s.cell, dtype=float).tolist(),
        "pbc": [bool(p) for p in s.pbc],
    }
    if s.frames:
        out["frames"] = [{"positions": np.asarray(fr["positions"], dtype=float).tolist()} for fr in s.frames]
    if s.props:
        out["props"] = {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in s.props.items()}
    return out


def without_labels(s: Structure) -> Structure:
    s = s.copy()
    s.remove_prop("labels")
    return s


def rotation(axis: list[float], degrees: float) -> np.ndarray:
    u = np.array(axis, dtype=float)
    u /= np.linalg.norm(u)
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    k = np.array([[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]])
    return np.eye(3) * c + s * k + (1 - c) * np.outer(u, u)


def cases() -> list[tuple[str, Structure, dict[str, Any]]]:
    data = REPO / "tests" / "data"
    hexagonal = [[2.77, 0.0, 0.0], [-1.385, 2.39889, 0.0], [0.0, 0.0, 20.0]]
    out: list[tuple[str, Structure, dict[str, Any]]] = []

    def add(case_id: str, s: Structure, **extra: Any) -> None:
        out.append((case_id, s, extra))

    # the four samples of the design (docs/design/xsd-export/samples)
    add("nacl-bulk", without_labels(facet.read(data / "NaCl.cif")), sample="NaCl_bulk.xsd",
        note="rock salt read from tests/data/NaCl.cif, without the site labels")
    add("srtio3-bulk", without_labels(facet.read(data / "SrTiO3.cif")), sample="SrTiO3_bulk.xsd",
        note="perovskite read from tests/data/SrTiO3.cif, without the site labels")
    add("pt111-slab-fixed", facet.read(data / "surface" / "contcar_pt111.vasp"), sample="Pt111_slab_fixed.xsd",
        note="the CONTCAR fixture: hexagonal cell with a along x (turned for Materials Studio), 18 atoms F F F")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        water = build.molecule("H2O")
    water.name = "H2O"
    add("h2o-molecule", water, sample="H2O_molecule.xsd", note="a molecule: Cartesian coordinates, no cell")

    add("srtio3-labels", facet.read(data / "SrTiO3.cif"),
        note="site labels of a CIF become the atom names (the three O of one site share O1)")

    tri = cellpar_to_cell(5.1, 6.2, 7.3, 80.0, 95.0, 105.0) @ rotation([1.0, 2.0, 3.0], 37.0).T
    frac = np.array([[0.1, 0.2, 0.3], [0.61, 0.07, 0.48], [0.33, 0.9, 0.75], [0.875, 0.5, 0.125]])
    add("triclinic", Structure(["Cu", "O", "O", "H"], frac @ tri, cell=tri, name="triclinic"),
        note="a triclinic cell in a general orientation")

    ortho = np.diag([4.0, 5.0, 12.0])
    add("partial-constraints",
        Structure(["Pt", "Pt", "Pt", "O"], [[0, 0, 1], [2, 2.5, 3], [0, 0, 5], [2, 2.5, 7]], cell=ortho,
                  props={"selective_dynamics": [[F, F, F], [T, T, F], [F, T, T], [T, T, T]]}, name="partly fixed"),
        note="atoms fixed along some directions only are written as fixed, with a warning")
    add("molecule-fixed",
        Structure(["C", "O", "O"], [[0, 0, 0], [0, 0, 1.16], [0, 0, -1.16]],
                  props={"selective_dynamics": [[F, F, F], [T, F, T], [T, T, T]]}, name="CO2"),
        note='fixed atoms of a molecule: RestrictedProperties="XYZ"')

    left = [hexagonal[1], hexagonal[0], hexagonal[2]]
    add("left-handed", Structure(["Pt", "O"], [[0.0, 0.0, 1.0], [0.7, 1.2, 3.0]], cell=left, name="left-handed"),
        note="a left-handed cell is written as it is, with a warning")

    add("special-names-molecule",
        Structure(["O", "H", "H", "H"], [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0], [3, 3, 3]],
                  props={"labels": ['O"1"', "H<a>", "  H&b\t", ""]},
                  name='H2O & "heavy" <water> é 水 \U0001f600'),
        note="XML escapes and character references in names; an empty label falls back to the element number")
    add("special-names-crystal",
        Structure(["Fe", "Fe"], [[0, 0, 0], [1.435, 1.435, 1.435]], cell=np.diag([2.87, 2.87, 2.87]),
                  props={"labels": ["α-Fe", "Fe–1"]}, name="α-Fe"),
        note="names outside ASCII are written as character references")

    add("outside-cell",
        Structure(["Pt", "Pt", "H"], np.array([[-0.25, 0.5, 0.5], [1.5, 0.25, -1.0], [0.5, 0.5, 2.000001]]) @ ortho,
                  cell=ortho, name="outside"),
        note="coordinates outside 0-1 are not wrapped")

    add("empty-crystal", Structure([], np.zeros((0, 3)), cell=ortho, name="empty"), note="no atoms, a cell")
    add("empty-molecule", Structure([], np.zeros((0, 3)), name="nothing"), note="no atoms, no cell")

    unit = np.eye(3)
    add("rounding-fractional",
        Structure(["H", "H", "H", "H"],
                  [[2.0 ** -13, -(2.0 ** -13), -1e-13], [0.5, 1.0 / 3.0, 2.0 / 3.0],
                   [3 * 2.0 ** -13, 0.9999999999995, -0.0], [1e-12, 4.9e-13, -4.9e-13]],
                  cell=unit, name="rounding"),
        note="12 decimals: halves of the exact binary value round away from zero (toFixed), no negative zero")
    add("rounding-cartesian",
        Structure(["He", "He", "He"],
                  [[2.0 ** -11, -(2.0 ** -11), -4e-11], [123456.5, -0.00000000005, 1e-10], [1.0 / 3.0, -2.0 / 3.0, 0.0]],
                  name="rounding"),
        note="10 decimals for Cartesian coordinates, the same rounding")

    add("slab-open-axis",
        Structure(["Pt", "Pt"], [[0, 0, 5.0], [1.385, 0.79963, 7.26]], cell=hexagonal, pbc=[T, T, F], name="slab T T F"),
        note="an axis that is not periodic: the file is periodic anyway, a note says so")
    add("dummy-atoms",
        Structure(["X", "Pt", "X"], [[0, 0, 1], [2, 2.5, 3], [0, 0, 5]], cell=ortho, name="dummies"),
        note="symbols that are not elements are written as they are, with a warning")
    add("trajectory",
        Structure.from_frames([Structure(["Pt", "O"], [[0, 0, 1.0 + 0.1 * k], [2, 2.5, 3.0]], cell=ortho)
                               for k in range(3)], name="trajectory"),
        note="the file holds one frame")
    add("lossy",
        Structure(["Pt", "Pt", "O"], [[0, 0, 1], [0, 0, 1.3], [2, 2.5, 3]], cell=ortho,
                  props={"occupancy": [1.0, 0.5, 1.0], "velocities": [[0, 0, 0.1], [0, 0, 0], [0, 0, 0]]}, name="lossy"),
        note="occupancies and velocities are not written; two atoms overlap")
    return out


def build_files() -> dict[str, str]:
    """File name -> content of every file this script writes."""
    files: dict[str, str] = {}
    manifest: list[dict[str, Any]] = []
    for case_id, s, extra in cases():
        name = case_id.replace("-", "_") + ".xsd"
        files[name] = to_text(s, "xsd")
        report = export_report(s, "xsd")
        entry: dict[str, Any] = {"id": case_id, "file": name}
        entry.update(extra)
        entry.update({"structure": as_json(s), "warnings": report["warnings"], "notes": report["notes"]})
        manifest.append(entry)
    doc = {"about": "Golden cases of the Materials Studio XSD writer; written by make_xsd_cases.py (see README.md)",
           "cases": manifest}
    files["cases.json"] = json.dumps(doc, indent=1, ensure_ascii=True) + "\n"
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="compare with the files on disk instead of writing")
    args = parser.parse_args()
    files = build_files()
    bad = 0
    for name, text in files.items():
        path = HERE / name
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                print(f"differs: {path.relative_to(REPO)}")
                bad += 1
        else:
            path.write_text(text, encoding="utf-8", newline="\n")
    if not args.check:
        print(f"wrote {len(files)} files to {HERE.relative_to(REPO)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
