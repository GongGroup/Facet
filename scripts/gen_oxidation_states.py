#!/usr/bin/env python3
"""Write the formal oxidation-state table crystallume/web/data/oxidation_states.json (M2 §3.9.1).

    python scripts/gen_oxidation_states.py                    # write the file
    python scripts/gen_oxidation_states.py --check            # exit 1 when the file is out of date
    python scripts/gen_oxidation_states.py --pymatgen [FILE]  # also compare the snapshot below with pymatgen

The table has one copy, the JSON file, which both the Python package (crystallume.build.surface, through
crystallume.core.webdata) and the web app (build/surface.js, through core/webdata.js) read; the cleave tool uses it
to estimate formal charges (polarity, Tasker type, the default termination).  Run this script after changing a table
below and commit both files: tests/test_oxidation_states.py fails while the JSON is out of date.  Nothing runs this
script at run time.

Where the table comes from:

* the common oxidation states of pymatgen (``Element.common_oxidation_states``, MIT), frozen at development time in
  PYMATGEN_COMMON below (pymatgen-core 2026.10.31), so that neither this script nor the tests need pymatgen;
  ``--pymatgen`` re-reads them from an installed pymatgen, or from the data file FILE
  (``pymatgen/core/periodic_table.json`` or ``.json.gz``), and reports any difference;
* anions: the elements of ANION_ELEMENTS, each with its most negative common oxidation state;
* cations: the manual preference order of M2 §3.9.1 (PREFERENCE, first = preferred), and for the metals of
  crystallume.core.elements.METALS that it does not list, the positive common states in pymatgen's order.  Every
  manual list must be the positive common states plus the states in ADDED minus the states in DROPPED, which say
  why: the script refuses a list that adds or drops a state without a reason.
"""

from __future__ import annotations

import argparse
import gzip
import importlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "crystallume" / "web" / "data" / "oxidation_states.json"

SCHEMA = "crystallume.oxidation-states/1"
SOURCE = ("common oxidation states (pymatgen Element.common_oxidation_states, MIT; frozen at development time) "
          "+ manual preference order")
PYMATGEN_VERSION = "pymatgen-core 2026.10.31"

#: pymatgen ``Element.common_oxidation_states`` of the elements in the table (PYMATGEN_VERSION).
PYMATGEN_COMMON: dict[str, tuple[int, ...]] = {
    "H": (-1, 1), "Li": (1,), "Be": (2,), "B": (3,), "C": (-4, -3, -2, -1, 0, 1, 2, 3, 4), "N": (-3, 3, 5),
    "O": (-2,), "F": (-1,), "Na": (1,), "Mg": (2,), "Al": (3,), "Si": (-4, 4), "P": (-3, 3, 5), "S": (-2, 2, 4, 6),
    "Cl": (-1, 1, 3, 5, 7), "K": (1,), "Ca": (2,), "Sc": (3,), "Ti": (4,), "V": (5,), "Cr": (3, 6), "Mn": (2, 4, 7),
    "Fe": (2, 3), "Co": (2, 3), "Ni": (2,), "Cu": (2,), "Zn": (2,), "Ga": (3,), "Ge": (-4, 2, 4), "As": (-3, 3, 5),
    "Se": (-2, 2, 4, 6), "Br": (-1, 1, 3, 5), "Rb": (1,), "Sr": (2,), "Y": (3,), "Zr": (4,), "Nb": (5,),
    "Mo": (4, 6), "Tc": (4, 7), "Ru": (3, 4), "Rh": (3,), "Pd": (2, 4), "Ag": (1,), "Cd": (2,), "In": (3,),
    "Sn": (-4, 2, 4), "Sb": (-3, 3, 5), "Te": (-2, 2, 4, 6), "I": (-1, 1, 3, 5, 7), "Cs": (1,), "Ba": (2,),
    "La": (3,), "Ce": (3, 4), "Pr": (3,), "Nd": (3,), "Pm": (3,), "Sm": (3,), "Eu": (2, 3), "Gd": (3,), "Tb": (3,),
    "Dy": (3,), "Ho": (3,), "Er": (3,), "Tm": (3,), "Yb": (3,), "Lu": (3,), "Hf": (4,), "Ta": (5,), "W": (4, 6),
    "Re": (4, 7), "Os": (4,), "Ir": (3, 4), "Pt": (2, 4), "Au": (3,), "Hg": (1, 2), "Tl": (1, 3), "Pb": (2, 4),
    "Bi": (3,), "Po": (-2, 2, 4), "Fr": (1,), "Ra": (2,), "Ac": (3,), "Th": (4,), "Pa": (5,), "U": (6,),
    "Np": (5,), "Pu": (4,), "Am": (3,), "Cm": (3,),
}

#: The elements with an anion charge (M2 §3.9.1); the charge is the most negative common oxidation state.
ANION_ELEMENTS = ("O", "S", "Se", "Te", "F", "Cl", "Br", "I", "N", "P", "As", "Sb", "C", "H")

#: Cation valences in order of preference, M2 §3.9.1: the estimate takes the first combination of these, in order,
#: that makes the formula neutral, and averages the first valences when none does.
PREFERENCE: dict[str, tuple[int, ...]] = {
    "H": (1,), "Li": (1,), "Na": (1,), "K": (1,), "Rb": (1,), "Cs": (1,), "Be": (2,), "Mg": (2,), "Ca": (2,),
    "Sr": (2,), "Ba": (2,), "Sc": (3,), "Y": (3,), "La": (3,), "Ce": (4, 3), "Pr": (3, 4), "Nd": (3,), "Sm": (3, 2),
    "Eu": (3, 2), "Gd": (3,), "Tb": (3, 4), "Dy": (3,), "Ho": (3,), "Er": (3,), "Tm": (3,), "Yb": (3, 2),
    "Lu": (3,), "Ti": (4, 3, 2), "Zr": (4,), "Hf": (4,), "V": (5, 4, 3), "Nb": (5, 4), "Ta": (5,), "Cr": (3, 6),
    "Mo": (6, 4), "W": (6, 4), "Mn": (2, 3, 4), "Re": (7, 4), "Fe": (3, 2), "Ru": (4, 3), "Os": (4, 8),
    "Co": (2, 3), "Rh": (3,), "Ir": (4, 3), "Ni": (2, 3), "Pd": (2, 4), "Pt": (2, 4), "Cu": (2, 1), "Ag": (1,),
    "Au": (3, 1), "Zn": (2,), "Cd": (2,), "Hg": (2, 1), "B": (3,), "Al": (3,), "Ga": (3,), "In": (3,),
    "Tl": (1, 3), "C": (4,), "Si": (4,), "Ge": (4,), "Sn": (4, 2), "Pb": (2, 4), "N": (5, 3), "P": (5, 3),
    "As": (5, 3), "Sb": (5, 3), "Bi": (3, 5), "S": (6, 4), "Se": (4, 6), "Te": (4, 6), "I": (5, 7), "Th": (4,),
    "U": (6, 4),
}

#: States of PREFERENCE that are not common oxidation states in pymatgen, with the reason ("ICSD": pymatgen's
#: ``icsd_oxidation_states`` has them).
ADDED: dict[str, dict[int, str]] = {
    "Pr": {4: "ICSD (PrO2, Pr6O11)"},
    "Sm": {2: "ICSD (SmO, SmS)"},
    "Tb": {4: "ICSD (TbO2, Tb4O7)"},
    "Yb": {2: "ICSD (YbO, YbS)"},
    "Ti": {3: "ICSD (Ti2O3, LaTiO3)", 2: "ICSD (TiO; TiH2)"},
    "V": {4: "ICSD (VO2)", 3: "ICSD (V2O3)"},
    "Nb": {4: "ICSD (NbO2)"},
    "Mn": {3: "ICSD (Mn2O3, LaMnO3)"},
    "Os": {8: "OsO4"},
    "Ni": {3: "ICSD (LaNiO3, LiNiO2)"},
    "Cu": {1: "ICSD (Cu2O)"},
    "Au": {1: "Au(I) compounds (AuCl, Au2S)"},
    "Bi": {5: "ICSD (NaBiO3)"},
    "U": {4: "ICSD (UO2)"},
}

#: Positive common oxidation states in pymatgen that PREFERENCE leaves out, with the reason.
DROPPED: dict[str, dict[int, str]] = {
    "Mn": {7: "permanganates are averaged; the oxides need +2 to +4"},
    "C": {1: "as a cation carbon is +4 (carbonates); carbides take the anion charge -4",
          2: "as above", 3: "as above"},
    "Ge": {2: "GeO2 (+4); Ge(II) compounds are rare"},
    "S": {2: "sulfates (+6) and sulfites (+4); S(II) cations are rare"},
    "Se": {2: "selenites (+4) and selenates (+6)"},
    "Te": {2: "tellurites (+4) and tellurates (+6)"},
    "I": {1: "iodates (+5) and periodates (+7)", 3: "as above"},
}


def _elements() -> Any:
    """The module ``crystallume.core.elements`` of this checkout (METALS and the atomic numbers)."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    return importlib.import_module("crystallume.core.elements")


def _positive(states: tuple[int, ...]) -> list[int]:
    return [q for q in states if q > 0]


def build_table() -> dict[str, Any]:
    """The table as a dict (schema, source, anions, cations; elements by atomic number); raises on a broken rule."""
    el = _elements()
    by_z = el.atomic_number
    anions: dict[str, int] = {}
    for e in sorted(ANION_ELEMENTS, key=by_z):
        q = min(PYMATGEN_COMMON[e])
        if q >= 0:
            raise SystemExit(f"error: {e} has no negative common oxidation state")
        anions[e] = q
    missing = sorted((set(PREFERENCE) | set(el.METALS)) - set(PYMATGEN_COMMON), key=by_z)
    if missing:
        raise SystemExit(f"error: no pymatgen states for {', '.join(missing)} in PYMATGEN_COMMON")
    cations: dict[str, list[int]] = {}
    for e in sorted(set(PREFERENCE) | set(el.METALS), key=by_z):
        common = _positive(PYMATGEN_COMMON[e])
        states = list(PREFERENCE.get(e, common))
        if not states or len(set(states)) != len(states) or any(not isinstance(q, int) or q <= 0 for q in states):
            raise SystemExit(f"error: {e}: cation states must be distinct positive whole numbers ({states})")
        want = (set(common) | set(ADDED.get(e, {}))) - set(DROPPED.get(e, {}))
        if set(states) != want:
            raise SystemExit(f"error: {e}: {states} differs from pymatgen's {common} by states that ADDED and "
                             f"DROPPED do not explain (expected the states {sorted(want)})")
        cations[e] = states
    unused = sorted((set(ADDED) | set(DROPPED)) - set(PREFERENCE))
    if unused:
        raise SystemExit(f"error: ADDED or DROPPED name elements without a PREFERENCE entry: {', '.join(unused)}")
    return {"schema": SCHEMA, "source": SOURCE, "anions": anions, "cations": cations}


def _js(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def render() -> str:
    """The text of ``oxidation_states.json``: the anions on one line, one line per cation."""
    doc = build_table()
    lines = ["{", f'  "schema": {_js(doc["schema"])},', f'  "source": {_js(doc["source"])},',
             '  "anions": {' + ", ".join(f"{_js(k)}: {_js(v)}" for k, v in doc["anions"].items()) + "},",
             '  "cations": {']
    items = list(doc["cations"].items())
    lines += [f"    {_js(k)}: {_js(v)}{',' if i < len(items) - 1 else ''}" for i, (k, v) in enumerate(items)]
    lines += ["  }", "}"]
    return "\n".join(lines) + "\n"


def pymatgen_common(source: str | None) -> dict[str, tuple[int, ...]]:
    """Common oxidation states from pymatgen: the data file *source*, or the installed package when it is None."""
    if source is None:
        from pymatgen.core.periodic_table import Element  # development only

        return {e: tuple(Element(e).common_oxidation_states) for e in PYMATGEN_COMMON}
    path = Path(source)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    return {e: tuple((data.get(e) or {}).get("Common oxidation states") or ()) for e in PYMATGEN_COMMON}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--check", action="store_true", help="only check that the JSON file is up to date")
    ap.add_argument("--pymatgen", nargs="?", const="", metavar="FILE",
                    help="compare PYMATGEN_COMMON with pymatgen (installed, or its periodic_table.json[.gz] FILE)")
    args = ap.parse_args(argv)
    status = 0
    if args.pymatgen is not None:
        fresh = pymatgen_common(args.pymatgen or None)
        diff = {e: (PYMATGEN_COMMON[e], fresh[e]) for e in PYMATGEN_COMMON if PYMATGEN_COMMON[e] != fresh[e]}
        for e, (old, new) in diff.items():
            print(f"{e}: snapshot {old}, pymatgen {new}")
        print(f"pymatgen: {len(diff)} differences from the snapshot ({PYMATGEN_VERSION})")
        status = 1 if diff else 0
    text = render()
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.is_file() else None
        if current != text:
            print(f"{TARGET.relative_to(ROOT)} is out of date: run python scripts/gen_oxidation_states.py")
            return 1
        print(f"{TARGET.relative_to(ROOT)} is up to date")
        return status
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(text.encode('utf-8'))} bytes)")
    return status


if __name__ == "__main__":
    sys.exit(main())
