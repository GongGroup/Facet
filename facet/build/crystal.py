"""Crystal builders for common prototypes (conventional cells).

Use :func:`crystal`::

    from facet import build
    cu = build.crystal("fcc", "Cu")                       # a from the reference table (3.615 Å)
    nacl = build.crystal("rocksalt", ["Na", "Cl"], a=5.64)
    sto = build.crystal("perovskite", "Sr Ti O")         # elements as one string also OK
    gan = build.crystal("wurtzite", ["Ga", "N"])          # a, c and u = 0.377 from the table
    ws2 = build.crystal("mos2", ["W", "S"], c=20.0)       # 2D: c is the cell height
    big = build.supercell(cu, 3, 3, 3)

:data:`PROTOTYPES` describes every prototype for user interfaces (camelCase keys).  The default and tabulated
lattice parameters below are the only copy of these tables: ``scripts/gen_reference_data.py`` writes them into
``facet/web/js/build/reference.js``, so that the web app's builder makes the same structures
(:func:`reference_parameters` and ``referenceParameters`` apply the same rules).
"""

from __future__ import annotations

import math
import re
import warnings
from typing import Any, Sequence

import numpy as np

from ..core.elements import covalent_radius, normalize_symbol
from ..core.lattice import cellpar_to_cell
from ..core.structure import Structure

__all__ = ["PROTOTYPES", "crystal", "supercell", "reference_lattice_constant", "reference_parameters"]

_SQ3 = math.sqrt(3.0)
_IDEAL_CA = math.sqrt(8.0 / 3.0)

# ---------------------------------------------------------------- metadata
#: Prototype metadata served to the UI (``GET /api/v1/build/prototypes``).  ``defaultA``, ``defaultC`` and
#: ``params`` are the parameters of the example (``defaultElements``), as the reference tables give them.
PROTOTYPES: dict[str, dict[str, Any]] = {
    "sc": {"label": "Simple cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Po"],
           "defaultA": 3.359, "defaultC": None, "spacegroup": "Pm-3m", "spacegroupNumber": 221,
           "crystalSystem": "cubic", "atomsPerCell": 1, "description": "Simple cubic lattice, one atom per cell (α-Po)."},
    "bcc": {"label": "Body-centred cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Fe"],
            "defaultA": 2.866, "defaultC": None, "spacegroup": "Im-3m", "spacegroupNumber": 229,
            "crystalSystem": "cubic", "atomsPerCell": 2, "description": "BCC metals (Fe, W, Mo, Cr, Na...)."},
    "fcc": {"label": "Face-centred cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Cu"],
            "defaultA": 3.615, "defaultC": None, "spacegroup": "Fm-3m", "spacegroupNumber": 225,
            "crystalSystem": "cubic", "atomsPerCell": 4, "description": "FCC metals (Cu, Al, Au, Ag, Pt, Ni...)."},
    "hcp": {"label": "Hexagonal close-packed", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Mg"],
            "defaultA": 3.209, "defaultC": 5.211, "spacegroup": "P6_3/mmc", "spacegroupNumber": 194,
            "crystalSystem": "hexagonal", "atomsPerCell": 2,
            "description": "HCP metals (Mg, Ti, Zn, Co...). c from the reference table, else the ideal sqrt(8/3)·a."},
    "diamond": {"label": "Diamond", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Si"],
                "defaultA": 5.431, "defaultC": None, "spacegroup": "Fd-3m", "spacegroupNumber": 227,
                "crystalSystem": "cubic", "atomsPerCell": 8, "description": "Diamond structure (C, Si, Ge, α-Sn)."},
    "zincblende": {"label": "Zinc blende", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Ga", "As"],
                   "defaultA": 5.653, "defaultC": None, "spacegroup": "F-43m", "spacegroupNumber": 216,
                   "crystalSystem": "cubic", "atomsPerCell": 8, "description": "Sphalerite AB (GaAs, ZnS, InP, SiC-3C)."},
    "wurtzite": {"label": "Wurtzite", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Zn", "O"],
                 "defaultA": 3.25, "defaultC": 5.207, "spacegroup": "P6_3mc", "spacegroupNumber": 186,
                 "crystalSystem": "hexagonal", "atomsPerCell": 4, "params": {"u": 0.382},
                 "description": "Hexagonal AB (ZnO, GaN, AlN). Internal parameter u per compound "
                                "(ZnO 0.382), 3/8 when not tabulated."},
    "rocksalt": {"label": "Rock salt", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Na", "Cl"],
                 "defaultA": 5.64, "defaultC": None, "spacegroup": "Fm-3m", "spacegroupNumber": 225,
                 "crystalSystem": "cubic", "atomsPerCell": 8, "description": "NaCl-type AB (NaCl, MgO, PbS)."},
    "cscl": {"label": "Caesium chloride", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Cs", "Cl"],
             "defaultA": 4.123, "defaultC": None, "spacegroup": "Pm-3m", "spacegroupNumber": 221,
             "crystalSystem": "cubic", "atomsPerCell": 2, "description": "CsCl-type AB (CsCl, β-brass CuZn)."},
    "fluorite": {"label": "Fluorite", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Ca", "F"],
                 "defaultA": 5.463, "defaultC": None, "spacegroup": "Fm-3m", "spacegroupNumber": 225,
                 "crystalSystem": "cubic", "atomsPerCell": 12, "description": "AB2 fluorite (CaF2, CeO2, UO2)."},
    "perovskite": {"label": "Cubic perovskite", "nElements": 3, "elementRoles": ["A", "B", "X"],
                   "defaultElements": ["Sr", "Ti", "O"], "defaultA": 3.905, "defaultC": None, "spacegroup": "Pm-3m",
                   "spacegroupNumber": 221, "crystalSystem": "cubic", "atomsPerCell": 5,
                   "description": "Cubic ABX3 perovskite (SrTiO3, BaTiO3, CsPbI3)."},
    "rutile": {"label": "Rutile", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Ti", "O"],
               "defaultA": 4.594, "defaultC": 2.959, "spacegroup": "P4_2/mnm", "spacegroupNumber": 136,
               "crystalSystem": "tetragonal", "atomsPerCell": 6, "params": {"u": 0.305},
               "description": "Tetragonal AB2 (TiO2, SnO2, RuO2). Internal parameter u (default 0.305)."},
    "graphene": {"label": "Graphene (2D)", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["C"],
                 "defaultA": 2.46, "defaultC": 15.0, "spacegroup": "P6/mmm", "spacegroupNumber": 191,
                 "crystalSystem": "hexagonal", "atomsPerCell": 2, "is2D": True,
                 "description": "Honeycomb monolayer; c is the cell height, pbc = [T, T, F]."},
    "hbn": {"label": "Hexagonal BN (2D)", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["B", "N"],
            "defaultA": 2.504, "defaultC": 15.0, "spacegroup": "P-6m2", "spacegroupNumber": 187,
            "crystalSystem": "hexagonal", "atomsPerCell": 2, "is2D": True,
            "description": "Hexagonal boron nitride monolayer; c is the cell height, pbc = [T, T, F]."},
    "mos2": {"label": "MoS2 monolayer (2H)", "nElements": 2, "elementRoles": ["M", "X"], "defaultElements": ["Mo", "S"],
             "defaultA": 3.16, "defaultC": 18.0, "spacegroup": "P-6m2", "spacegroupNumber": 187,
             "crystalSystem": "hexagonal", "atomsPerCell": 3, "is2D": True, "params": {"thickness": 3.17},
             "description": "2H transition-metal dichalcogenide monolayer MX2; thickness = X-X height (Å), "
                            "per compound (MoS2 3.17)."},
    "graphite": {"label": "Graphite (AB)", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["C"],
                 "defaultA": 2.464, "defaultC": 6.711, "spacegroup": "P6_3/mmc", "spacegroupNumber": 194,
                 "crystalSystem": "hexagonal", "atomsPerCell": 4, "description": "Bernal (AB-stacked) graphite."},
}
for _k, _v in PROTOTYPES.items():
    _v.setdefault("name", _k)
    _v.setdefault("params", {})
    _v.setdefault("is2D", False)
    _v["hasC"] = _v["defaultC"] is not None

_ALIASES = {"zb": "zincblende", "sphalerite": "zincblende", "nacl": "rocksalt", "caf2": "fluorite",
            "mos2monolayer": "mos2", "2h": "mos2", "simplecubic": "sc"}

# ------------------------------------------------------- reference tables
# The web builder reads a generated copy (web/js/build/reference.js): after changing a table, run
# `python scripts/gen_reference_data.py` and commit both files.  Sources of the per-compound values are listed there.

#: Experimental lattice constants (Å, room temperature) of one-element crystals, used when ``a`` is omitted.
_REF_A: dict[str, dict[str, float]] = {
    "fcc": {"Cu": 3.615, "Al": 4.05, "Au": 4.08, "Ag": 4.09, "Pt": 3.92, "Pd": 3.89, "Ni": 3.52, "Pb": 4.95,
            "Ir": 3.84, "Rh": 3.80, "Ca": 5.58, "Sr": 6.08, "Ce": 5.16, "Yb": 5.49, "Th": 5.08, "Ne": 4.43,
            "Ar": 5.26, "Kr": 5.72, "Xe": 6.20, "Co": 3.54, "Fe": 3.59},
    "bcc": {"Fe": 2.866, "W": 3.165, "Mo": 3.147, "Cr": 2.884, "Na": 4.23, "K": 5.23, "Li": 3.51, "V": 3.03,
            "Nb": 3.30, "Ta": 3.30, "Rb": 5.59, "Cs": 6.05, "Ba": 5.02, "Eu": 4.61},
    "sc": {"Po": 3.359},
    "diamond": {"C": 3.567, "Si": 5.431, "Ge": 5.658, "Sn": 6.489},
    "hcp": {"Mg": 3.209, "Ti": 2.95, "Zn": 2.66, "Co": 2.507, "Zr": 3.23, "Cd": 2.98, "Be": 2.29, "Hf": 3.19,
            "Ru": 2.71, "Os": 2.73, "Re": 2.76, "Y": 3.65, "Sc": 3.31},
    "graphene": {"C": 2.46},
    "graphite": {"C": 2.464},
}
#: Experimental c (Å) of the one-element crystals in :data:`_REF_A` that have a c axis.
_REF_C: dict[str, dict[str, float]] = {
    "hcp": {"Mg": 5.211, "Ti": 4.68, "Zn": 4.95, "Co": 4.07, "Zr": 5.15, "Cd": 5.62, "Be": 3.58, "Hf": 5.05,
            "Ru": 4.28, "Os": 4.32, "Re": 4.46, "Y": 5.73, "Sc": 5.27},
    "graphite": {"C": 6.711},
}
#: Compounds (elements in role order): ``(a, c, params)``.  ``c`` is ``None`` for cubic cells and for 2D
#: prototypes, which use their default cell height; ``params`` holds the prototype parameters that depend on the
#: compound: the wurtzite ``u`` and the MX2 ``thickness`` (X-X height, Å).
_REF_AB: dict[str, dict[tuple[str, ...], tuple[float, float | None, dict[str, float]]]] = {
    "rocksalt": {("Na", "Cl"): (5.64, None, {}), ("Mg", "O"): (4.21, None, {}), ("Li", "F"): (4.03, None, {}),
                 ("K", "Cl"): (6.29, None, {}), ("Pb", "S"): (5.94, None, {}), ("Ca", "O"): (4.81, None, {}),
                 ("Ni", "O"): (4.18, None, {}), ("Ti", "N"): (4.24, None, {}), ("Ti", "C"): (4.33, None, {})},
    "zincblende": {("Ga", "As"): (5.653, None, {}), ("Zn", "S"): (5.41, None, {}), ("In", "P"): (5.869, None, {}),
                   ("Si", "C"): (4.36, None, {}), ("Ga", "P"): (5.451, None, {}), ("Cd", "Te"): (6.48, None, {}),
                   ("B", "N"): (3.615, None, {}), ("Ga", "N"): (4.50, None, {}), ("In", "As"): (6.058, None, {})},
    "wurtzite": {("Zn", "O"): (3.25, 5.207, {"u": 0.382}), ("Ga", "N"): (3.189, 5.185, {"u": 0.377}),
                 ("Al", "N"): (3.112, 4.982, {"u": 0.382}), ("Zn", "S"): (3.82, 6.26, {"u": 0.375}),
                 ("In", "N"): (3.545, 5.703, {"u": 0.377}), ("Cd", "S"): (4.136, 6.714, {"u": 0.377})},
    "cscl": {("Cs", "Cl"): (4.123, None, {}), ("Cu", "Zn"): (2.95, None, {}), ("Cs", "Br"): (4.29, None, {}),
             ("Ni", "Al"): (2.88, None, {}), ("Fe", "Al"): (2.91, None, {})},
    "fluorite": {("Ca", "F"): (5.463, None, {}), ("Ce", "O"): (5.411, None, {}), ("U", "O"): (5.47, None, {}),
                 ("Zr", "O"): (5.07, None, {}), ("Ba", "F"): (6.20, None, {})},
    "perovskite": {("Sr", "Ti", "O"): (3.905, None, {}), ("Ba", "Ti", "O"): (4.00, None, {}),
                   ("Ca", "Ti", "O"): (3.84, None, {}), ("Cs", "Pb", "I"): (6.29, None, {}),
                   ("Cs", "Pb", "Br"): (5.87, None, {}), ("La", "Al", "O"): (3.79, None, {}),
                   ("K", "Nb", "O"): (4.02, None, {}), ("Sr", "Ru", "O"): (3.93, None, {})},
    "rutile": {("Ti", "O"): (4.594, 2.959, {}), ("Sn", "O"): (4.737, 3.186, {}), ("Ru", "O"): (4.49, 3.11, {}),
               ("Ir", "O"): (4.50, 3.16, {}), ("Mn", "O"): (4.40, 2.87, {}), ("V", "O"): (4.55, 2.85, {})},
    "hbn": {("B", "N"): (2.504, None, {})},
    "mos2": {("Mo", "S"): (3.16, None, {"thickness": 3.17}), ("W", "S"): (3.155, None, {"thickness": 3.14}),
             ("Mo", "Se"): (3.29, None, {"thickness": 3.34}), ("W", "Se"): (3.28, None, {"thickness": 3.34}),
             ("Mo", "Te"): (3.52, None, {"thickness": 3.60})},
}
#: Prototype parameters of compounds :data:`_REF_AB` does not list (ideal wurtzite u = 3/8; MoS2's X-X height).
_FALLBACK_PARAMS: dict[str, dict[str, float]] = {
    "wurtzite": {"u": 0.375},
    "rutile": {"u": 0.305},
    "mos2": {"thickness": 3.17},
}

_VACUUM_DEPRECATION = ("build.crystal(vacuum=) adds vacuum on each side, so the gap between periodic images is "
                       "twice this; give c (the cell height) instead, or use Structure.set_vacuum for the total gap")


def _prototype_id(prototype: str) -> str:
    """The prototype key of *prototype* (any case, ``-``/``_`` ignored, aliases such as ``"nacl"``)."""
    p = prototype.strip().lower().replace("-", "").replace("_", "")
    p = _ALIASES.get(p, p)
    if p not in PROTOTYPES:
        raise ValueError(f"unknown prototype {prototype!r}; available: {', '.join(PROTOTYPES)}")
    return p


def _parse_elements(elements: str | Sequence[str] | None, prototype: str) -> list[str]:
    meta = PROTOTYPES[prototype]
    if elements is None or (isinstance(elements, (list, tuple)) and len(elements) == 0) or elements == "":
        return list(meta["defaultElements"])
    if isinstance(elements, str):
        toks = [t for t in re.split(r"[\s,;/-]+", elements.strip()) if t]
        if len(toks) == 1 and meta["nElements"] > 1:
            # Allow compact strings such as "NaCl" or "SrTiO3".
            found = re.findall(r"[A-Z][a-z]?", toks[0])
            if len(found) >= meta["nElements"]:
                toks = found
    else:
        toks = [str(e) for e in elements]
    syms = [normalize_symbol(t) for t in toks]
    need = meta["nElements"]
    if len(syms) == 1 and need > 1:
        raise ValueError(f"prototype {prototype!r} needs {need} elements ({', '.join(meta['elementRoles'])})")
    if len(syms) < need:
        raise ValueError(f"prototype {prototype!r} needs {need} elements, got {len(syms)}")
    return syms[:need]


def _reference_cell(p: str, els: tuple[str, ...]) -> tuple[float, float | None]:
    """``(a, c)`` from the tables, else estimated from covalent radii (the rules of ``referenceCell`` in JS)."""
    meta = PROTOTYPES[p]
    if len(els) == 1 and els[0] in _REF_A.get(p, {}):
        a = _REF_A[p][els[0]]
        c = _REF_C.get(p, {}).get(els[0])
        if c is None and meta["hasC"]:
            c = _IDEAL_CA * a if p == "hcp" else meta["defaultC"]
        return a, c
    if els in _REF_AB.get(p, {}):
        a, c, _ = _REF_AB[p][els]
        if c is None and meta["hasC"]:
            c = meta["defaultC"] if meta["is2D"] else None
        return a, c
    r = [covalent_radius(e) for e in els]
    if p == "sc":
        a = 2 * r[0]
    elif p == "bcc":
        a = 4 * r[0] / _SQ3
    elif p == "fcc":
        a = 2 * r[0] * math.sqrt(2)
    elif p == "hcp":
        a = 2 * r[0]
        return a, _IDEAL_CA * a
    elif p == "diamond":
        a = 8 * r[0] / _SQ3
    elif p == "zincblende":
        a = 4 * (r[0] + r[1]) / _SQ3
    elif p == "wurtzite":
        d = r[0] + r[1]
        a = d * math.sqrt(8.0 / 3.0)
        return a, _IDEAL_CA * a
    elif p == "rocksalt":
        a = 2 * (r[0] + r[1])
    elif p == "cscl":
        a = 2 * (r[0] + r[1]) / _SQ3
    elif p == "fluorite":
        a = 4 * (r[0] + r[1]) / _SQ3
    elif p == "perovskite":
        a = 2 * (r[1] + r[2])
    elif p == "rutile":
        d = r[0] + r[1]
        a = d / (0.305 * math.sqrt(2))
        return a, 0.644 * a
    elif p in ("graphene", "graphite"):
        a = 2 * r[0] * _SQ3
        return a, (meta["defaultC"] if p == "graphene" else 2.0 * 3.35)
    elif p == "hbn":
        a = (r[0] + r[1]) * _SQ3
        return a, meta["defaultC"]
    elif p == "mos2":
        a = (r[0] + r[1]) * 1.32
        return a, meta["defaultC"]
    else:  # pragma: no cover
        a = float(meta["defaultA"])
    return a, (meta["defaultC"] if meta["hasC"] else None)


def _reference(p: str, els: tuple[str, ...]) -> dict[str, Any]:
    """:func:`reference_parameters` for a prototype key and parsed elements."""
    meta = PROTOTYPES[p]
    a, c = _reference_cell(p, els)
    out: dict[str, Any] = {"a": a}
    if meta["hasC"]:
        out["c"] = c
    params = {**_FALLBACK_PARAMS.get(p, {}), **_REF_AB.get(p, {}).get(els, (None, None, {}))[2]}
    for key in meta["params"]:
        out[key] = params[key]
    return out


def reference_parameters(prototype: str, elements: str | Sequence[str] | None = None) -> dict[str, Any]:
    """The lattice parameters :func:`crystal` uses for *prototype* and *elements* when none are given.

    Returns ``{"a": ...}`` plus ``"c"`` for prototypes with a c axis (2D: the cell height) and each prototype
    parameter: ``"u"`` (wurtzite, rutile) and ``"thickness"`` (mos2, the X-X height); lengths in Å.
    Tabulated experimental values are used where available; otherwise ``a`` and ``c`` are estimated from
    covalent radii and the parameters take their generic values (wurtzite u = 3/8, MX2 thickness 3.17 Å).
    *elements* are given as for :func:`crystal` (default: the prototype's example).  The web app's builder
    applies the same tables and rules (``referenceParameters`` in ``web/js/build/crystal.js``).
    """
    p = _prototype_id(prototype)
    return _reference(p, tuple(_parse_elements(elements, p)))


def reference_lattice_constant(prototype: str, elements: Sequence[str]) -> tuple[float, float | None]:
    """Best-guess ``(a, c)`` for *prototype* with *elements*.

    Uses tabulated experimental values where available, otherwise estimates
    from covalent radii; ``c`` is ``None`` for prototypes without a c axis.
    :func:`reference_parameters` also gives the prototype parameters.
    """
    return _reference_cell(prototype, tuple(elements))


_FCC = np.array([[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]])


def _hex_cell(a: float, c: float) -> np.ndarray:
    return cellpar_to_cell(a, a, c, 90.0, 90.0, 120.0)


def _build(p: str, els: list[str], a: float, c: float | None, params: dict[str, float]) -> tuple[list[str], np.ndarray, np.ndarray, list[bool]]:
    """Return (symbols, fractional positions, cell, pbc) for prototype *p*."""
    cubic = np.eye(3) * a
    full = [True, True, True]
    if p == "sc":
        return [els[0]], np.zeros((1, 3)), cubic, full
    if p == "bcc":
        return [els[0]] * 2, np.array([[0, 0, 0], [0.5, 0.5, 0.5]]), cubic, full
    if p == "fcc":
        return [els[0]] * 4, _FCC.copy(), cubic, full
    if p == "diamond":
        frac = np.vstack([_FCC, _FCC + 0.25])
        return [els[0]] * 8, frac, cubic, full
    if p == "zincblende":
        frac = np.vstack([_FCC, _FCC + 0.25])
        return [els[0]] * 4 + [els[1]] * 4, frac, cubic, full
    if p == "rocksalt":
        frac = np.vstack([_FCC, _FCC + np.array([0.5, 0, 0])]) % 1.0
        return [els[0]] * 4 + [els[1]] * 4, frac, cubic, full
    if p == "cscl":
        return [els[0], els[1]], np.array([[0, 0, 0], [0.5, 0.5, 0.5]]), cubic, full
    if p == "fluorite":
        frac = np.vstack([_FCC, _FCC + 0.25, _FCC + 0.75]) % 1.0
        return [els[0]] * 4 + [els[1]] * 8, frac, cubic, full
    if p == "perovskite":
        frac = np.array([[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]])
        return [els[0], els[1], els[2], els[2], els[2]], frac, cubic, full
    if p == "hcp":
        assert c is not None
        frac = np.array([[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]])
        return [els[0]] * 2, frac, _hex_cell(a, c), full
    if p == "wurtzite":
        assert c is not None
        u = params["u"]
        frac = np.array([[1 / 3, 2 / 3, 0], [2 / 3, 1 / 3, 0.5], [1 / 3, 2 / 3, u], [2 / 3, 1 / 3, 0.5 + u]])
        return [els[0]] * 2 + [els[1]] * 2, frac % 1.0, _hex_cell(a, c), full
    if p == "rutile":
        assert c is not None
        u = params["u"]
        frac = np.array([[0, 0, 0], [0.5, 0.5, 0.5], [u, u, 0], [1 - u, 1 - u, 0],
                         [0.5 + u, 0.5 - u, 0.5], [0.5 - u, 0.5 + u, 0.5]])
        cell = np.diag([a, a, c])
        return [els[0]] * 2 + [els[1]] * 4, frac, cell, full
    if p == "graphene":
        assert c is not None
        frac = np.array([[1 / 3, 2 / 3, 0.5], [2 / 3, 1 / 3, 0.5]])
        return [els[0]] * 2, frac, _hex_cell(a, c), [True, True, False]
    if p == "hbn":
        assert c is not None
        frac = np.array([[1 / 3, 2 / 3, 0.5], [2 / 3, 1 / 3, 0.5]])
        return [els[0], els[1]], frac, _hex_cell(a, c), [True, True, False]
    if p == "mos2":
        assert c is not None
        t = params["thickness"] / c
        frac = np.array([[1 / 3, 2 / 3, 0.5], [2 / 3, 1 / 3, 0.5 - t / 2], [2 / 3, 1 / 3, 0.5 + t / 2]])
        return [els[0], els[1], els[1]], frac, _hex_cell(a, c), [True, True, False]
    if p == "graphite":
        assert c is not None
        frac = np.array([[0, 0, 0.25], [0, 0, 0.75], [1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]])
        return [els[0]] * 4, frac, _hex_cell(a, c), full
    raise ValueError(f"unknown prototype {p!r}")  # pragma: no cover


def crystal(
    prototype: str,
    elements: str | Sequence[str] | None = None,
    a: float | None = None,
    c: float | None = None,
    **kw: Any,
) -> Structure:
    """Build the conventional cell of a crystal *prototype*.

    Parameters
    ----------
    prototype:
        One of :data:`PROTOTYPES` (``sc, bcc, fcc, hcp, diamond, zincblende,
        wurtzite, rocksalt, cscl, fluorite, perovskite, rutile, graphene, hbn,
        mos2, graphite``).
    elements:
        Element(s) in the order of ``PROTOTYPES[p]["elementRoles"]``; a list,
        a single symbol, a whitespace/comma separated string or a compact
        formula-like string (``"NaCl"``).  Defaults to the prototype's example.
    a, c:
        Lattice constants in Å (``c`` only for hexagonal/tetragonal/2D cells;
        for 2D prototypes ``c`` is the cell height, the layer and the vacuum
        around it).  Omitted values come from :func:`reference_parameters`:
        tabulated experimental values, or estimates from covalent radii.  When
        only ``a`` is given, hcp, wurtzite and rutile keep the reference c/a.
    **kw:
        Prototype parameters: ``u`` (wurtzite, rutile) and ``thickness`` (mos2:
        the X-X height in Å), both tabulated per compound when omitted;
        ``repeat``/``supercell`` (``(nx, ny, nz)`` applied at the end), ``name``.
        ``vacuum`` (graphene, hbn, mos2, when ``c`` is omitted) is deprecated:
        vacuum on each side (Å); the gap between periodic images is twice this
        (``c = thickness + 2·vacuum``).  It gives a :class:`DeprecationWarning`;
        new code gives ``c``, or uses ``Structure.set_vacuum``, whose ``vacuum``
        is the total gap.

    ``info`` records ``prototype``, the space group, ``a``, ``c`` and the
    parameters used (``u``, ``thickness``).
    """
    p = _prototype_id(prototype)
    meta = PROTOTYPES[p]
    els = _parse_elements(elements, p)
    ref = _reference(p, tuple(els))
    vacuum = kw.get("vacuum")
    if vacuum is not None:
        warnings.warn(_VACUUM_DEPRECATION, DeprecationWarning, stacklevel=2)
    ref_a, ref_c = ref["a"], ref.get("c")
    a_val = float(a) if a else ref_a
    if a_val <= 0:
        raise ValueError("lattice constant a must be positive")
    params = {key: float(kw[key]) if kw.get(key) is not None else ref[key] for key in meta["params"]}
    c_val: float | None = None
    if meta["hasC"]:
        if c:
            c_val = float(c)
        elif meta["is2D"] and vacuum is not None:
            c_val = params.get("thickness", 0.0) + 2.0 * float(vacuum)
        elif a and p in ("hcp", "wurtzite", "rutile") and ref_c is not None and ref_a:
            c_val = ref_c / ref_a * a_val  # keep the reference c/a ratio
        else:
            c_val = ref_c if ref_c else meta["defaultC"]
        if c_val is None or c_val <= 0:
            raise ValueError("lattice constant c must be positive")
    symbols, frac, cell, pbc = _build(p, els, a_val, c_val, params)
    info: dict[str, Any] = {
        "source": f"builder:{p}",
        "prototype": p,
        "spacegroup": meta["spacegroup"],
        "spacegroupNumber": meta["spacegroupNumber"],
        "a": round(a_val, 6),
    }
    if c_val is not None:
        info["c"] = round(c_val, 6)
    info.update(params)
    s = Structure(symbols, frac @ cell, cell=cell, pbc=pbc, info=info)
    s.name = str(kw.get("name") or f"{s.get_formula(reduce=True)} {p}")
    rep = kw.get("repeat") or kw.get("supercell")
    if rep:
        s = supercell(s, *rep)
    return s


def supercell(structure: Structure, nx: int = 1, ny: int = 1, nz: int = 1) -> Structure:
    """Return the ``nx x ny x nz`` supercell of a periodic *structure* (new object)."""
    return structure.repeat(int(nx), int(ny), int(nz))
