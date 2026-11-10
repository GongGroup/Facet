"""Formal oxidation states of the cleave tool (M2 §3.9.1, ledger L-M2-06): the shared table
``facet/web/data/oxidation_states.json`` (written by ``scripts/gen_oxidation_states.py``),
``load_oxidation_states`` and ``estimate_oxidation_states`` in ``facet.build.surface`` (segment M2-T2), and the
element data they rest on: ``METALS``, ``ANIONS`` and the Pauling electronegativities of
``facet.core.elements``.

``tests/js/oxidation_states.test.mjs`` runs the same cases on the JavaScript twins (``web/js/build/surface.js``,
``web/js/core/elements.js``).  Both files hold the same JSON constant ``PARITY_CASES`` (between the BEGIN and END
PARITY_CASES lines): compositions with the charges, their source and the notes, or the error, that both languages
must give, and malformed tables with their error.  ``test_parity_cases_are_one_constant`` checks that the two copies
agree, and ``test_js_matches_python`` runs the JavaScript twin through the Node bridge on every case and on random
compositions and compares the two languages item by item.  A case without ``charges`` expects none (unknown); its
``given`` are charges passed by the caller.  The expectations follow M2 §3.9.1 and M2 §7.1 ("oxidation states"):
SrTiO3, TiO2, ZnO, CeO2, Al2O3, NaCl and GaAs exact, Fe3O4 and Co3O4 averaged with the note W11, TaON (O and N both
anions), CaCO3 (C +4), TiH2 (H -1), Pt and PtTi without ionic charges, none of the 40 catalysts unknown, and elements
missing from the table unknown.
"""

from __future__ import annotations

import importlib
import itertools
import json
import random
import re
import runpy
import time
from pathlib import Path

import numpy as np
import pytest

from facet.build.surface import _check_oxidation_table, _formal_charges, _neutral_valences
from facet.build.surface import estimate_oxidation_states, load_oxidation_states
from facet.core.elements import ANIONS, METALS, electronegativity, elements
from facet.project import display_formula

#: The module itself (``facet.build`` will also export a function ``surface``, M7 §3.1 rule 13).
surface = importlib.import_module("facet.build.surface")

ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "facet" / "web" / "data" / "oxidation_states.json"
GENERATOR = ROOT / "scripts" / "gen_oxidation_states.py"
JS_TESTS = Path(__file__).resolve().parent / "js" / "oxidation_states.test.mjs"

#: The cation valences that M2 §3.9.1 writes out (the preference order is part of the design).
SPEC_CATIONS = {
    "H": [1], "Li": [1], "Na": [1], "K": [1], "Rb": [1], "Cs": [1], "Be": [2], "Mg": [2], "Ca": [2], "Sr": [2],
    "Ba": [2], "Sc": [3], "Y": [3], "La": [3], "Ce": [4, 3], "Pr": [3, 4], "Nd": [3], "Sm": [3, 2], "Eu": [3, 2],
    "Gd": [3], "Tb": [3, 4], "Dy": [3], "Ho": [3], "Er": [3], "Tm": [3], "Yb": [3, 2], "Lu": [3], "Ti": [4, 3, 2],
    "Zr": [4], "Hf": [4], "V": [5, 4, 3], "Nb": [5, 4], "Ta": [5], "Cr": [3, 6], "Mo": [6, 4], "W": [6, 4],
    "Mn": [2, 3, 4], "Re": [7, 4], "Fe": [3, 2], "Ru": [4, 3], "Os": [4, 8], "Co": [2, 3], "Rh": [3], "Ir": [4, 3],
    "Ni": [2, 3], "Pd": [2, 4], "Pt": [2, 4], "Cu": [2, 1], "Ag": [1], "Au": [3, 1], "Zn": [2], "Cd": [2],
    "Hg": [2, 1], "B": [3], "Al": [3], "Ga": [3], "In": [3], "Tl": [1, 3], "C": [4], "Si": [4], "Ge": [4],
    "Sn": [4, 2], "Pb": [2, 4], "N": [5, 3], "P": [5, 3], "As": [5, 3], "Sb": [5, 3], "Bi": [3, 5], "S": [6, 4],
    "Se": [4, 6], "Te": [4, 6], "I": [5, 7], "Th": [4], "U": [6, 4],
}
SPEC_ANIONS = {"O": -2, "S": -2, "Se": -2, "Te": -2, "F": -1, "Cl": -1, "Br": -1, "I": -1, "N": -3, "P": -3,
               "As": -3, "Sb": -3, "C": -4, "H": -1}
#: The metals that M2 §3.9.1 does not list, with the positive common oxidation states of pymatgen.
METALS_FROM_PYMATGEN = {"Tc": [4, 7], "Pm": [3], "Po": [2, 4], "Fr": [1], "Ra": [2], "Ac": [3], "Pa": [5],
                        "Np": [5], "Pu": [4], "Am": [3], "Cm": [3]}

# BEGIN PARITY_CASES (JSON: the same constant as in tests/js/oxidation_states.test.mjs)
PARITY_CASES = {
  "estimate": [
    {"id": "SrTiO3", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "SrTiO3 as symbols", "symbols": ["O", "Sr", "O", "Ti", "O"], "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "TiO2", "symbols": {"Ti": 2, "O": 4}, "charges": {"Ti": 4, "O": -2}, "source": "formal"},
    {"id": "ZnO", "symbols": {"Zn": 2, "O": 2}, "charges": {"Zn": 2, "O": -2}, "source": "formal"},
    {"id": "CeO2", "symbols": {"Ce": 1, "O": 2}, "charges": {"Ce": 4, "O": -2}, "source": "formal"},
    {"id": "Al2O3", "symbols": {"Al": 12, "O": 18}, "charges": {"Al": 3, "O": -2}, "source": "formal"},
    {"id": "NaCl", "symbols": {"Na": 4, "Cl": 4}, "charges": {"Na": 1, "Cl": -1}, "source": "formal"},
    {"id": "GaAs", "symbols": {"Ga": 1, "As": 1}, "charges": {"Ga": 3, "As": -3}, "source": "formal"},
    {"id": "Fe3O4 (W11)", "symbols": {"Fe": 24, "O": 32}, "charges": {"Fe": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Fe +2.67)"]},
    {"id": "Co3O4 (W11)", "symbols": {"Co": 3, "O": 4}, "charges": {"Co": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Co +2.67)"]},
    {"id": "KMnO4 (W11, two cations)", "symbols": {"K": 1, "Mn": 1, "O": 4}, "charges": {"K": 2.6666666666666665, "Mn": 5.333333333333333, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (K +2.67, Mn +5.33)"]},
    {"id": "NpO2 (W11 with a whole number)", "symbols": {"Np": 1, "O": 2}, "charges": {"Np": 4, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Np +4.00)"]},
    {"id": "TaON (O and N anions)", "symbols": {"Ta": 1, "O": 1, "N": 1}, "charges": {"Ta": 5, "N": -3, "O": -2}, "source": "formal"},
    {"id": "BiOCl (O and Cl anions)", "symbols": {"Bi": 1, "O": 1, "Cl": 1}, "charges": {"Bi": 3, "Cl": -1, "O": -2}, "source": "formal"},
    {"id": "CaCO3 (C +4)", "symbols": {"Ca": 1, "C": 1, "O": 3}, "charges": {"Ca": 2, "C": 4, "O": -2}, "source": "formal"},
    {"id": "TiH2 (H -1)", "symbols": {"Ti": 1, "H": 2}, "charges": {"Ti": 2, "H": -1}, "source": "formal"},
    {"id": "Ca(OH)2 (H +1)", "symbols": {"Ca": 1, "O": 2, "H": 2}, "charges": {"Ca": 2, "H": 1, "O": -2}, "source": "formal"},
    {"id": "BaSO4 (S +6)", "symbols": {"Ba": 1, "S": 1, "O": 4}, "charges": {"Ba": 2, "S": 6, "O": -2}, "source": "formal"},
    {"id": "NaIO3 (I +5)", "symbols": {"Na": 1, "I": 1, "O": 3}, "charges": {"Na": 1, "I": 5, "O": -2}, "source": "formal"},
    {"id": "LiFePO4", "symbols": {"Li": 4, "Fe": 4, "P": 4, "O": 16}, "charges": {"Li": 1, "Fe": 2, "P": 5, "O": -2}, "source": "formal"},
    {"id": "FeTiO3 (cations in formula order)", "symbols": {"Fe": 1, "Ti": 1, "O": 3}, "charges": {"Ti": 4, "Fe": 2, "O": -2}, "source": "formal"},
    {"id": "CuFeO2 (cations in formula order)", "symbols": {"Cu": 1, "Fe": 1, "O": 2}, "charges": {"Fe": 3, "Cu": 1, "O": -2}, "source": "formal"},
    {"id": "twenty cations", "symbols": {"Ti": 1, "V": 1, "Mn": 1, "Fe": 1, "Co": 1, "Ni": 1, "Cu": 1, "Mo": 1, "W": 1, "Nb": 1, "Ce": 1, "Sn": 1, "Pb": 1, "Pd": 1, "Pt": 1, "Ir": 1, "Ru": 1, "Tl": 1, "Au": 1, "Bi": 1, "O": 25}, "charges": {"Ce": 4, "Ti": 3, "Mn": 2, "Nb": 4, "Tl": 1, "V": 3, "Fe": 2, "Co": 2, "Cu": 1, "Ni": 2, "Sn": 2, "Bi": 3, "Mo": 4, "Ir": 3, "Pd": 2, "Ru": 3, "Pt": 2, "Pb": 2, "W": 4, "Au": 1, "O": -2}, "source": "formal"},
    {"id": "Pt (metal)", "symbols": {"Pt": 4}, "charges": {"Pt": 0}, "source": "metal"},
    {"id": "PtTi (metals)", "symbols": ["Pt", "Ti"], "charges": {"Ti": 0, "Pt": 0}, "source": "metal"},
    {"id": "Si (one element)", "symbols": {"Si": 8}, "charges": {"Si": 0}, "source": "element"},
    {"id": "Ar (one element without electronegativity)", "symbols": ["Ar"], "charges": {"Ar": 0}, "source": "element"},
    {"id": "zero counts are left out", "symbols": {"Fe": 0, "O": 2}, "charges": {"O": 0}, "source": "element"},
    {"id": "nothing", "symbols": [], "charges": {}, "source": "metal"},
    {"id": "XeF2 (Xe not in the table)", "symbols": {"Xe": 1, "F": 2}, "source": "unknown"},
    {"id": "ClF3 (Cl below the anion window, no cation valence)", "symbols": {"Cl": 1, "F": 3}, "source": "unknown"},
    {"id": "SiGe (Ge has no anion charge)", "symbols": {"Si": 1, "Ge": 1}, "source": "unknown"},
    {"id": "PtSi (Pt has no anion charge)", "symbols": {"Pt": 1, "Si": 1}, "source": "unknown"},
    {"id": "OF2 (only anions)", "symbols": {"O": 1, "F": 2}, "source": "unknown"},
    {"id": "ArO (Ar has no electronegativity)", "symbols": {"Ar": 1, "O": 1}, "source": "unknown"},
    {"id": "XO (a dummy species)", "symbols": {"X": 1, "O": 1}, "source": "unknown"},
    {"id": "FeO1 (symbols are taken as written)", "symbols": {"Fe1": 1, "O": 1}, "source": "unknown"},
    {"id": "SrTiO3 with given charges", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"O": -2, "Ti": 4, "Sr": 2, "Pt": 0}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "user"},
    {"id": "Fe3O4 with given charges", "symbols": {"Fe": 3, "O": 4}, "given": {"Fe": 2.5, "O": -2}, "charges": {"Fe": 2.5, "O": -2}, "source": "user"},
    {"id": "Pt with a given charge", "symbols": {"Pt": 1}, "given": {"Pt": 0.5}, "charges": {"Pt": 0.5}, "source": "user"},
    {"id": "XeF2 with given charges", "symbols": {"Xe": 1, "F": 2}, "given": {"Xe": 2, "F": -1}, "charges": {"Xe": 2, "F": -1}, "source": "user"}
  ],
  "catalysts": [
    {"id": "SnO2", "symbols": {"Sn": 1, "O": 2}, "charges": {"Sn": 4, "O": -2}, "source": "formal"},
    {"id": "PdO", "symbols": {"Pd": 1, "O": 1}, "charges": {"Pd": 2, "O": -2}, "source": "formal"},
    {"id": "IrO2", "symbols": {"Ir": 1, "O": 2}, "charges": {"Ir": 4, "O": -2}, "source": "formal"},
    {"id": "RuO2", "symbols": {"Ru": 1, "O": 2}, "charges": {"Ru": 4, "O": -2}, "source": "formal"},
    {"id": "Nb2O5", "symbols": {"Nb": 2, "O": 5}, "charges": {"Nb": 5, "O": -2}, "source": "formal"},
    {"id": "Ta2O5", "symbols": {"Ta": 2, "O": 5}, "charges": {"Ta": 5, "O": -2}, "source": "formal"},
    {"id": "Bi2O3", "symbols": {"Bi": 2, "O": 3}, "charges": {"Bi": 3, "O": -2}, "source": "formal"},
    {"id": "BiVO4", "symbols": {"Bi": 1, "V": 1, "O": 4}, "charges": {"V": 5, "Bi": 3, "O": -2}, "source": "formal"},
    {"id": "Y2O3", "symbols": {"Y": 2, "O": 3}, "charges": {"Y": 3, "O": -2}, "source": "formal"},
    {"id": "La2O3", "symbols": {"La": 2, "O": 3}, "charges": {"La": 3, "O": -2}, "source": "formal"},
    {"id": "Ga2O3", "symbols": {"Ga": 2, "O": 3}, "charges": {"Ga": 3, "O": -2}, "source": "formal"},
    {"id": "In2O3", "symbols": {"In": 2, "O": 3}, "charges": {"In": 3, "O": -2}, "source": "formal"},
    {"id": "WO3", "symbols": {"W": 1, "O": 3}, "charges": {"W": 6, "O": -2}, "source": "formal"},
    {"id": "MoO3", "symbols": {"Mo": 1, "O": 3}, "charges": {"Mo": 6, "O": -2}, "source": "formal"},
    {"id": "V2O5", "symbols": {"V": 2, "O": 5}, "charges": {"V": 5, "O": -2}, "source": "formal"},
    {"id": "Co3O4", "symbols": {"Co": 3, "O": 4}, "charges": {"Co": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Co +2.67)"]},
    {"id": "Fe3O4", "symbols": {"Fe": 3, "O": 4}, "charges": {"Fe": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Fe +2.67)"]},
    {"id": "Fe2O3", "symbols": {"Fe": 2, "O": 3}, "charges": {"Fe": 3, "O": -2}, "source": "formal"},
    {"id": "NiO", "symbols": {"Ni": 1, "O": 1}, "charges": {"Ni": 2, "O": -2}, "source": "formal"},
    {"id": "CuO", "symbols": {"Cu": 1, "O": 1}, "charges": {"Cu": 2, "O": -2}, "source": "formal"},
    {"id": "Cu2O", "symbols": {"Cu": 2, "O": 1}, "charges": {"Cu": 1, "O": -2}, "source": "formal"},
    {"id": "ZnO", "symbols": {"Zn": 1, "O": 1}, "charges": {"Zn": 2, "O": -2}, "source": "formal"},
    {"id": "MgO", "symbols": {"Mg": 1, "O": 1}, "charges": {"Mg": 2, "O": -2}, "source": "formal"},
    {"id": "CaO", "symbols": {"Ca": 1, "O": 1}, "charges": {"Ca": 2, "O": -2}, "source": "formal"},
    {"id": "SrTiO3", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "BaTiO3", "symbols": {"Ba": 1, "Ti": 1, "O": 3}, "charges": {"Ba": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "LaFeO3", "symbols": {"La": 1, "Fe": 1, "O": 3}, "charges": {"La": 3, "Fe": 3, "O": -2}, "source": "formal"},
    {"id": "LaMnO3", "symbols": {"La": 1, "Mn": 1, "O": 3}, "charges": {"La": 3, "Mn": 3, "O": -2}, "source": "formal"},
    {"id": "LaCoO3", "symbols": {"La": 1, "Co": 1, "O": 3}, "charges": {"La": 3, "Co": 3, "O": -2}, "source": "formal"},
    {"id": "CeO2", "symbols": {"Ce": 1, "O": 2}, "charges": {"Ce": 4, "O": -2}, "source": "formal"},
    {"id": "ZrO2", "symbols": {"Zr": 1, "O": 2}, "charges": {"Zr": 4, "O": -2}, "source": "formal"},
    {"id": "HfO2", "symbols": {"Hf": 1, "O": 2}, "charges": {"Hf": 4, "O": -2}, "source": "formal"},
    {"id": "TiO2", "symbols": {"Ti": 1, "O": 2}, "charges": {"Ti": 4, "O": -2}, "source": "formal"},
    {"id": "Al2O3", "symbols": {"Al": 2, "O": 3}, "charges": {"Al": 3, "O": -2}, "source": "formal"},
    {"id": "SiO2", "symbols": {"Si": 1, "O": 2}, "charges": {"Si": 4, "O": -2}, "source": "formal"},
    {"id": "MnO2", "symbols": {"Mn": 1, "O": 2}, "charges": {"Mn": 4, "O": -2}, "source": "formal"},
    {"id": "MoS2", "symbols": {"Mo": 1, "S": 2}, "charges": {"Mo": 4, "S": -2}, "source": "formal"},
    {"id": "WS2", "symbols": {"W": 1, "S": 2}, "charges": {"W": 4, "S": -2}, "source": "formal"},
    {"id": "GaN", "symbols": {"Ga": 1, "N": 1}, "charges": {"Ga": 3, "N": -3}, "source": "formal"},
    {"id": "TiN", "symbols": {"Ti": 1, "N": 1}, "charges": {"Ti": 3, "N": -3}, "source": "formal"}
  ],
  "errors": [
    {"id": "a formula string", "symbols": "SrTiO3", "kind": "type", "error": "symbols must be a list of element symbols or a mapping of counts"},
    {"id": "a number", "symbols": 5, "kind": "type", "error": "symbols must be a list of element symbols or a mapping of counts"},
    {"id": "a fractional count", "symbols": {"Fe": 1.5, "O": 1}, "kind": "value", "error": "the count of Fe must be a whole number"},
    {"id": "a negative count", "symbols": {"Fe": 1, "O": -2}, "kind": "value", "error": "the count of O must be a whole number"},
    {"id": "a count as text", "symbols": {"Fe": "2", "O": 3}, "kind": "value", "error": "the count of Fe must be a whole number"},
    {"id": "given charges without O", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"Sr": 2, "Ti": 4}, "kind": "value", "error": "charges must give every element: missing O"},
    {"id": "given charges without Ti and O", "symbols": ["O", "Ti", "Sr", "O", "O"], "given": {"Sr": 2}, "kind": "value", "error": "charges must give every element: missing Ti, O"},
    {"id": "a given charge as text", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"Sr": "2", "Ti": 4, "O": -2}, "kind": "value", "error": "the charge given for Sr is not a finite number"},
    {"id": "given charges as a list", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": [2, 4, -2], "kind": "type", "error": "charges must be a mapping of element symbols to charges"}
  ],
  "tables": [
    {"id": "another schema", "table": {"schema": "facet.oxidation-states/2", "anions": {}, "cations": {}}, "error": "oxidation_states.json is not a facet.oxidation-states/1 table"},
    {"id": "a list", "table": [], "error": "oxidation_states.json is not a facet.oxidation-states/1 table"},
    {"id": "no cations", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}}, "error": "oxidation_states.json needs the objects anions and cations"},
    {"id": "cations as a list", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": []}, "error": "oxidation_states.json needs the objects anions and cations"},
    {"id": "a positive anion charge", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": 2}, "cations": {}}, "error": "oxidation_states.json: anions.O must be a negative whole number"},
    {"id": "a fractional anion charge", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -1.5}, "cations": {}}, "error": "oxidation_states.json: anions.O must be a negative whole number"},
    {"id": "no valences", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": []}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a repeated valence", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": [3, 3]}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a negative valence", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": [3, -2]}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a valence that is not a list", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": 3}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"}
  ]
}
# END PARITY_CASES


def _parity_block(path: Path, comment: str) -> dict:
    text = path.read_text(encoding="utf-8")
    block = text.split(f"{comment} BEGIN PARITY_CASES", 1)[1].split(f"{comment} END PARITY_CASES", 1)[0]
    return json.loads(block.split("=", 1)[1].strip().rstrip(";"))


def test_parity_cases_are_one_constant():
    """The two copies of PARITY_CASES (here and in tests/js/oxidation_states.test.mjs) are the same JSON constant."""
    here = _parity_block(Path(__file__), "#")
    assert here == PARITY_CASES
    assert _parity_block(JS_TESTS, "//") == here


def _expected(case: dict) -> dict:
    return {"charges": case.get("charges"), "source": case["source"], "notes": case.get("notes", [])}


def _check(case: dict, got: dict) -> None:
    want = _expected(case)
    assert got == want, case["id"]
    if want["charges"] is not None:
        assert list(got["charges"]) == list(want["charges"]), f"{case['id']}: elements in formula order"
        assert all(type(q) is float for q in got["charges"].values())


# =============================================================================================== the table
def _table() -> dict:
    return json.loads(TABLE.read_text(encoding="utf-8"))


def test_the_table_follows_m2():
    """M2 §3.9.1: the schema, the source, the anion charges and the cation valences in their preference order."""
    t = _table()
    assert list(t) == ["schema", "source", "anions", "cations"]
    assert t["schema"] == "facet.oxidation-states/1"
    assert t["source"] == ("common oxidation states (pymatgen Element.common_oxidation_states, MIT; frozen at "
                           "development time) + manual preference order")
    assert t["anions"] == SPEC_ANIONS
    assert {e: t["cations"][e] for e in SPEC_CATIONS} == SPEC_CATIONS
    assert {e: q for e, q in t["cations"].items() if e not in SPEC_CATIONS} == METALS_FROM_PYMATGEN
    assert _check_oxidation_table(t)[1]["Ti"] == (4, 3, 2)


def test_the_table_covers_every_metal():
    """Every element of METALS has cation valences (M2 §3.9.1, coverage), so no metal oxide is unknown."""
    cations = _table()["cations"]
    assert sorted(METALS - set(cations)) == []
    for e in sorted(METALS):
        assert estimate_oxidation_states({e: 2, "O": 3}) is not None, e


def test_the_table_is_what_the_generator_writes():
    """facet/web/data/oxidation_states.json is the output of scripts/gen_oxidation_states.py (no pymatgen)."""
    render = runpy.run_path(str(GENERATOR), run_name="gen_oxidation_states")["render"]
    assert TABLE.read_text(encoding="utf-8") == render(), "run: python scripts/gen_oxidation_states.py"


def test_the_table_is_stored_once():
    """One copy of the JSON in the sources, and no module of the package carries the table in another form."""
    copies = sorted(p.relative_to(ROOT).as_posix() for top in ("facet", "tests", "scripts", "docs", "examples")
                    for p in (ROOT / top).rglob("oxidation_states*.json"))
    assert copies == ["facet/web/data/oxidation_states.json"]
    osmium = re.compile(r"""["']?Os["']?\s*:\s*[\[(]\s*4\s*,\s*8\s*[\])]""")   # the valences of Os, unique to the table
    holders = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "facet").rglob("*")
                     if p.is_file() and p.suffix in (".py", ".js", ".mjs", ".json", ".html")
                     and osmium.search(p.read_text(encoding="utf-8", errors="replace")))
    assert holders == ["facet/web/data/oxidation_states.json"]


def test_load_oxidation_states_returns_a_copy_of_the_table():
    first = load_oxidation_states()
    assert first == _table()
    first["cations"]["Fe"].reverse()
    first["anions"]["O"] = -9
    assert load_oxidation_states() == _table()
    assert estimate_oxidation_states({"Fe": 2, "O": 3}) == {"Fe": 3.0, "O": -2.0}


@pytest.mark.parametrize("case", PARITY_CASES["tables"], ids=lambda c: c["id"])
def test_malformed_tables(case):
    with pytest.raises(ValueError) as exc:
        _check_oxidation_table(case["table"])
    assert str(exc.value) == case["error"]


def test_a_malformed_table_stops_the_estimate(monkeypatch: pytest.MonkeyPatch):
    bad = {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": [3, 3]}}
    surface._oxidation_table.cache_clear()
    monkeypatch.setattr(surface, "load_web_data", lambda name: bad)
    try:
        with pytest.raises(ValueError, match="cations.Fe must be a list"):
            estimate_oxidation_states({"Fe": 2, "O": 3})
        with pytest.raises(ValueError, match="cations.Fe must be a list"):
            load_oxidation_states()
    finally:
        surface._oxidation_table.cache_clear()


# =============================================================================================== the estimate
@pytest.mark.parametrize("case", PARITY_CASES["estimate"], ids=lambda c: c["id"])
def test_estimate(case):
    got = _formal_charges(case["symbols"], charges=case.get("given"))
    _check(case, got)
    assert estimate_oxidation_states(case["symbols"], charges=case.get("given")) == got["charges"]


def test_the_forty_catalysts_are_never_unknown():
    """M2 §3.9.1: none of the 40 compounds is "Charge unknown"; Co3O4 and Fe3O4 are averaged (W11), the rest exact."""
    cases = PARITY_CASES["catalysts"]
    assert len(cases) == 40 and len({c["id"] for c in cases}) == 40
    for case in cases:
        _check(case, _formal_charges(case["symbols"]))
    assert [c["id"] for c in cases if c["source"] == "averaged"] == ["Co3O4", "Fe3O4"]
    assert all(c["source"] == "formal" for c in cases if c["id"] not in ("Co3O4", "Fe3O4"))


@pytest.mark.parametrize("case", PARITY_CASES["errors"], ids=lambda c: c["id"])
def test_errors(case):
    with pytest.raises(TypeError if case["kind"] == "type" else ValueError) as exc:
        estimate_oxidation_states(case["symbols"], charges=case.get("given"))
    assert str(exc.value) == case["error"]


@pytest.mark.parametrize("symbols", [None, 3.5, True], ids=repr)
def test_symbols_must_be_a_list_or_a_mapping(symbols):
    with pytest.raises(TypeError, match="^symbols must be a list of element symbols or a mapping of counts$"):
        estimate_oxidation_states(symbols)  # type: ignore[arg-type]


def test_counts_and_charges_take_numbers_only():
    with pytest.raises(ValueError, match="^the count of Fe must be a whole number$"):
        estimate_oxidation_states({"Fe": True, "O": 1})
    with pytest.raises(ValueError, match="^the charge given for O is not a finite number$"):
        estimate_oxidation_states(["Fe", "O"], charges={"Fe": 2, "O": float("nan")})
    with pytest.raises(ValueError, match="^the charge given for Fe is not a finite number$"):
        estimate_oxidation_states(["Fe", "O"], charges={"Fe": True, "O": -2})


def test_symbols_from_numpy_and_counts_from_numpy():
    """Structure symbols, numpy string arrays and numpy integer counts are all accepted."""
    want = {"Sr": 2.0, "Ti": 4.0, "O": -2.0}
    assert estimate_oxidation_states(np.array(["Sr", "Ti", "O", "O", "O"])) == want
    assert estimate_oxidation_states({"Sr": np.int64(1), "Ti": np.int32(1), "O": 3.0}) == want
    assert estimate_oxidation_states(iter(["Ti", "O", "O"])) == {"Ti": 4.0, "O": -2.0}
    assert estimate_oxidation_states(["Fe", "O"], charges={"Fe": np.int64(2), "O": np.float32(-2)}) == {"Fe": 2.0, "O": -2.0}


def test_neutral_valences_is_the_first_neutral_combination():
    """The search gives what M2 §3.9.1 describes: the first neutral combination in itertools.product order."""
    rng = random.Random(20261110)
    valences = list(_table()["cations"].values())
    for _ in range(400):
        n = rng.randint(1, 4)
        options = [tuple(rng.choice(valences)) for _ in range(n)]
        counts = [rng.randint(1, 5) for _ in range(n)]
        need = rng.randint(1, 40)
        brute = next((list(c) for c in itertools.product(*options)
                      if sum(k * v for k, v in zip(counts, c)) == need), None)
        assert _neutral_valences(counts, options, need) == brute, (counts, options, need)


def test_many_cations_are_fast():
    """Twenty cations with two or three valences each: the reachable sums keep the search linear (the product of the
    valence lists has 3.5 million combinations)."""
    case = next(c for c in PARITY_CASES["estimate"] if c["id"] == "twenty cations")
    t0 = time.perf_counter()
    _check(case, _formal_charges(case["symbols"]))
    assert time.perf_counter() - t0 < 0.5
    big = {e: 50 + i for i, e in enumerate(case["symbols"]) if e != "O"} | {"O": 2000}
    t0 = time.perf_counter()
    assert _formal_charges(big)["source"] in ("formal", "averaged")
    assert time.perf_counter() - t0 < 1.0


# =============================================================================================== element data
def test_metals_and_anions():
    assert isinstance(METALS, frozenset) and isinstance(ANIONS, frozenset)
    assert len(METALS) == 72 and {"Pt", "Ti", "Al", "Bi", "Po", "Cm"} <= METALS and not {"Si", "Ge", "B", "C"} & METALS
    assert ANIONS == {"O", "F", "S", "Cl", "N", "Se", "Br", "I", "Te", "P", "C", "H", "As"}


def test_electronegativity_has_every_element_but_three_noble_gases():
    missing = sorted(r["symbol"] for r in elements() if electronegativity(r["symbol"]) is None)
    assert missing == ["Ar", "He", "Ne"]


# =============================================================================================== JavaScript
def _random_compositions(seed: int = 20261110) -> list[dict]:
    """Random compositions over the table's elements, a few noble gases and a dummy species (fixed seed)."""
    rng = random.Random(seed)
    pool = sorted(set(_table()["cations"]) | set(_table()["anions"]) | {"Xe", "Kr", "Ar", "X", "F", "Cl", "Br"})
    out = []
    for _ in range(300):
        els = rng.sample(pool, rng.randint(1, 5))
        out.append({e: rng.randint(1, 8) for e in els})
    return out


def test_js_matches_python(js):
    """The JavaScript twin gives the same charges, sources, notes and errors as Python, word for word, on every case
    and on 300 random compositions; METALS, ANIONS and the electronegativities are the same element by element, and
    formulas list all elements in the same order; before loadOxidationStates() the estimate throws."""
    cases = PARITY_CASES["estimate"] + PARITY_CASES["catalysts"] + PARITY_CASES["errors"]
    randoms = _random_compositions()
    symbols = [r["symbol"] for r in elements()] + ["X"]
    got = js("""
      const { estimateOxidationStates, formalCharges, loadOxidationStates } = await web('build/surface.js');
      const { setWebData } = await web('core/webdata.js');
      const { ANIONS, METALS, PAULING } = await web('core/elements.js');
      const { Structure } = await web('core/structure.js');
      let early = null;
      try { estimateOxidationStates(['Pt']); } catch (e) { early = e.message; }
      const table = await loadOxidationStates();
      const run = (symbols, given) => {
        try { return formalCharges(symbols, { charges: given ?? null }); }
        catch (e) { return { error: e.message, kind: e instanceof TypeError ? 'type' : 'value' }; }
      };
      const results = input.cases.map((c) => run(c.symbols, c.given));
      const randoms = input.randoms.map((c) => run(c));
      const pauling = Object.fromEntries(input.symbols.map((s) => [s, Object.hasOwn(PAULING, s) ? PAULING[s] : null]));
      const noH = input.symbols.filter((s) => s !== 'H' && s !== 'X');
      const formula = new Structure({ symbols: noH, positions: noH.map((_, i) => [i, 0, 0]) }).formula();
      const tables = [];
      for (const c of input.tables) {
        setWebData('oxidation_states.json', c.table);
        try { await loadOxidationStates(); tables.push(null); } catch (e) { tables.push(e.message); }
      }
      return { early, table, results, randoms, pauling, paulingKeys: Object.keys(PAULING), formula, tables,
               metals: [...METALS], anions: [...ANIONS] };
    """, {"cases": cases, "randoms": randoms, "symbols": symbols, "tables": PARITY_CASES["tables"]})
    assert got["early"] == "oxidation states are not loaded yet; call await loadOxidationStates() first"
    assert got["table"] == _table()
    for case, res in zip(cases, got["results"]):
        if "error" in case:
            assert res == {"error": case["error"], "kind": case["kind"]}, case["id"]
        else:
            assert res == _expected(case), case["id"]
            assert res["charges"] is None or list(res["charges"]) == list(case["charges"]), case["id"]
    for comp, res in zip(randoms, got["randoms"]):
        py = _formal_charges(comp)
        assert res == py, comp
        assert res["charges"] is None or list(res["charges"]) == list(py["charges"]), comp
    assert sum(r["source"] == "unknown" for r in got["randoms"]) < len(randoms)
    assert got["tables"] == [c["error"] for c in PARITY_CASES["tables"]]
    assert set(got["metals"]) == METALS and len(got["metals"]) == len(METALS)
    assert set(got["anions"]) == ANIONS and len(got["anions"]) == len(ANIONS)
    assert got["pauling"] == {s: electronegativity(s) if s != "X" else None for s in symbols}
    assert set(got["paulingKeys"]) <= set(symbols)
    no_h = [s for s in symbols if s not in ("H", "X")]
    assert got["formula"] == display_formula(no_h)
