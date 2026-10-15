"""Crystal builders for common prototypes (conventional cells).

Use :func:`crystal`::

    from atomscope import build
    cu = build.crystal("fcc", "Cu")                       # a from the reference table
    nacl = build.crystal("rocksalt", ["Na", "Cl"], a=5.64)
    sto = build.crystal("perovskite", "Sr Ti O")         # elements as one string also OK
    gan = build.crystal("wurtzite", ["Ga", "N"], u=0.377)
    big = build.supercell(cu, 3, 3, 3)

:data:`PROTOTYPES` describes every prototype for user interfaces (camelCase keys).
"""

from __future__ import annotations

import math
import re
from typing import Any, Sequence

import numpy as np

from ..core.elements import covalent_radius, normalize_symbol
from ..core.lattice import cellpar_to_cell
from ..core.structure import Structure

__all__ = ["PROTOTYPES", "crystal", "supercell", "reference_lattice_constant"]

_SQ3 = math.sqrt(3.0)
_IDEAL_CA = math.sqrt(8.0 / 3.0)

# ---------------------------------------------------------------- metadata
#: Prototype metadata served to the UI (``GET /api/v1/build/prototypes``).
PROTOTYPES: dict[str, dict[str, Any]] = {
    "sc": {"label": "Simple cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Po"],
           "defaultA": 3.359, "defaultC": None, "spacegroup": "Pm-3m", "spacegroupNumber": 221,
           "crystalSystem": "cubic", "atomsPerCell": 1, "description": "Simple cubic lattice, one atom per cell (α-Po)."},
    "bcc": {"label": "Body-centred cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Fe"],
            "defaultA": 2.87, "defaultC": None, "spacegroup": "Im-3m", "spacegroupNumber": 229,
            "crystalSystem": "cubic", "atomsPerCell": 2, "description": "BCC metals (Fe, W, Mo, Cr, Na...)."},
    "fcc": {"label": "Face-centred cubic", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Cu"],
            "defaultA": 3.61, "defaultC": None, "spacegroup": "Fm-3m", "spacegroupNumber": 225,
            "crystalSystem": "cubic", "atomsPerCell": 4, "description": "FCC metals (Cu, Al, Au, Ag, Pt, Ni...)."},
    "hcp": {"label": "Hexagonal close-packed", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Mg"],
            "defaultA": 3.21, "defaultC": 5.21, "spacegroup": "P6_3/mmc", "spacegroupNumber": 194,
            "crystalSystem": "hexagonal", "atomsPerCell": 2,
            "description": "HCP metals (Mg, Ti, Zn, Co...). c defaults to the ideal sqrt(8/3)·a."},
    "diamond": {"label": "Diamond", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["Si"],
                "defaultA": 5.431, "defaultC": None, "spacegroup": "Fd-3m", "spacegroupNumber": 227,
                "crystalSystem": "cubic", "atomsPerCell": 8, "description": "Diamond structure (C, Si, Ge, α-Sn)."},
    "zincblende": {"label": "Zinc blende", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Ga", "As"],
                   "defaultA": 5.653, "defaultC": None, "spacegroup": "F-43m", "spacegroupNumber": 216,
                   "crystalSystem": "cubic", "atomsPerCell": 8, "description": "Sphalerite AB (GaAs, ZnS, InP, SiC-3C)."},
    "wurtzite": {"label": "Wurtzite", "nElements": 2, "elementRoles": ["A", "B"], "defaultElements": ["Zn", "O"],
                 "defaultA": 3.25, "defaultC": 5.207, "spacegroup": "P6_3mc", "spacegroupNumber": 186,
                 "crystalSystem": "hexagonal", "atomsPerCell": 4, "params": {"u": 0.375},
                 "description": "Hexagonal AB (ZnO, GaN, AlN). Internal parameter u (default 3/8)."},
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
                 "description": "Honeycomb monolayer; c is the cell height (vacuum), pbc = [T, T, F]."},
    "mos2": {"label": "MoS2 monolayer (2H)", "nElements": 2, "elementRoles": ["M", "X"], "defaultElements": ["Mo", "S"],
             "defaultA": 3.16, "defaultC": 15.0, "spacegroup": "P-6m2", "spacegroupNumber": 187,
             "crystalSystem": "hexagonal", "atomsPerCell": 3, "is2D": True, "params": {"thickness": 3.17},
             "description": "2H transition-metal dichalcogenide monolayer MX2; thickness = X-X height (Å)."},
    "graphite": {"label": "Graphite (AB)", "nElements": 1, "elementRoles": ["A"], "defaultElements": ["C"],
                 "defaultA": 2.464, "defaultC": 6.711, "spacegroup": "P6_3/mmc", "spacegroupNumber": 194,
                 "crystalSystem": "hexagonal", "atomsPerCell": 4, "description": "Bernal (AB-stacked) graphite."},
}
for _k, _v in PROTOTYPES.items():
    _v.setdefault("name", _k)
    _v.setdefault("params", {})
    _v.setdefault("is2D", False)
    _v["hasC"] = _v["defaultC"] is not None

#: Experimental lattice constants (Å) used when ``a`` is omitted.
_REF_A: dict[str, dict[str, float]] = {
    "fcc": {"Cu": 3.61, "Al": 4.05, "Au": 4.08, "Ag": 4.09, "Pt": 3.92, "Pd": 3.89, "Ni": 3.52, "Pb": 4.95,
            "Ir": 3.84, "Rh": 3.80, "Ca": 5.58, "Sr": 6.08, "Ce": 5.16, "Yb": 5.49, "Th": 5.08, "Ne": 4.43,
            "Ar": 5.26, "Kr": 5.72, "Xe": 6.20, "Co": 3.54, "Fe": 3.59},
    "bcc": {"Fe": 2.87, "W": 3.165, "Mo": 3.147, "Cr": 2.91, "Na": 4.23, "K": 5.23, "Li": 3.51, "V": 3.03,
            "Nb": 3.30, "Ta": 3.30, "Rb": 5.59, "Cs": 6.05, "Ba": 5.02, "Eu": 4.61},
    "sc": {"Po": 3.359},
    "diamond": {"C": 3.567, "Si": 5.431, "Ge": 5.658, "Sn": 6.489},
    "hcp": {"Mg": 3.21, "Ti": 2.95, "Zn": 2.66, "Co": 2.507, "Zr": 3.23, "Cd": 2.98, "Be": 2.29, "Hf": 3.19,
            "Ru": 2.71, "Os": 2.73, "Re": 2.76, "Y": 3.65, "Sc": 3.31},
    "graphene": {"C": 2.46},
    "graphite": {"C": 2.464},
}
_REF_C: dict[str, dict[str, float]] = {
    "hcp": {"Mg": 5.21, "Ti": 4.68, "Zn": 4.95, "Co": 4.07, "Zr": 5.15, "Cd": 5.62, "Be": 3.58, "Hf": 5.05,
            "Ru": 4.28, "Os": 4.32, "Re": 4.46, "Y": 5.73, "Sc": 5.27},
    "graphite": {"C": 6.711},
}
_REF_AB: dict[str, dict[tuple[str, ...], tuple[float, float | None]]] = {
    "rocksalt": {("Na", "Cl"): (5.64, None), ("Mg", "O"): (4.21, None), ("Li", "F"): (4.03, None),
                 ("K", "Cl"): (6.29, None), ("Pb", "S"): (5.94, None), ("Ca", "O"): (4.81, None),
                 ("Ni", "O"): (4.18, None), ("Ti", "N"): (4.24, None), ("Ti", "C"): (4.33, None)},
    "zincblende": {("Ga", "As"): (5.653, None), ("Zn", "S"): (5.41, None), ("In", "P"): (5.869, None),
                   ("Si", "C"): (4.36, None), ("Ga", "P"): (5.451, None), ("Cd", "Te"): (6.48, None),
                   ("B", "N"): (3.615, None), ("Ga", "N"): (4.50, None), ("In", "As"): (6.058, None)},
    "wurtzite": {("Zn", "O"): (3.25, 5.207), ("Ga", "N"): (3.189, 5.185), ("Al", "N"): (3.112, 4.982),
                 ("Zn", "S"): (3.82, 6.26), ("In", "N"): (3.545, 5.703), ("Cd", "S"): (4.136, 6.714)},
    "cscl": {("Cs", "Cl"): (4.123, None), ("Cu", "Zn"): (2.95, None), ("Cs", "Br"): (4.29, None),
             ("Ni", "Al"): (2.88, None), ("Fe", "Al"): (2.91, None)},
    "fluorite": {("Ca", "F"): (5.463, None), ("Ce", "O"): (5.411, None), ("U", "O"): (5.47, None),
                 ("Zr", "O"): (5.07, None), ("Ba", "F"): (6.20, None)},
    "perovskite": {("Sr", "Ti", "O"): (3.905, None), ("Ba", "Ti", "O"): (4.00, None),
                   ("Ca", "Ti", "O"): (3.84, None), ("Cs", "Pb", "I"): (6.29, None),
                   ("Cs", "Pb", "Br"): (5.87, None), ("La", "Al", "O"): (3.79, None),
                   ("K", "Nb", "O"): (4.02, None), ("Sr", "Ru", "O"): (3.93, None)},
    "rutile": {("Ti", "O"): (4.594, 2.959), ("Sn", "O"): (4.737, 3.186), ("Ru", "O"): (4.49, 3.11),
               ("Ir", "O"): (4.50, 3.16), ("Mn", "O"): (4.40, 2.87), ("V", "O"): (4.55, 2.85)},
    "mos2": {("Mo", "S"): (3.16, None), ("W", "S"): (3.155, None), ("Mo", "Se"): (3.29, None),
             ("W", "Se"): (3.28, None), ("Mo", "Te"): (3.52, None)},
}


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


def reference_lattice_constant(prototype: str, elements: Sequence[str]) -> tuple[float, float | None]:
    """Best-guess ``(a, c)`` for *prototype* with *elements*.

    Uses tabulated experimental values where available, otherwise estimates
    from covalent radii; ``c`` is ``None`` for prototypes without a c axis.
    """
    p = prototype
    meta = PROTOTYPES[p]
    els = tuple(elements)
    if len(els) == 1 and els[0] in _REF_A.get(p, {}):
        a = _REF_A[p][els[0]]
        c = _REF_C.get(p, {}).get(els[0])
        if c is None and meta["hasC"]:
            c = meta["defaultC"] if p in ("graphene",) else (_IDEAL_CA * a if p == "hcp" else meta["defaultC"])
        return a, c
    if els in _REF_AB.get(p, {}):
        a, c = _REF_AB[p][els]
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
    elif p == "mos2":
        a = (r[0] + r[1]) * 1.32
        return a, meta["defaultC"]
    else:  # pragma: no cover
        a = float(meta["defaultA"])
    return a, (meta["defaultC"] if meta["hasC"] else None)


_FCC = np.array([[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]])


def _hex_cell(a: float, c: float) -> np.ndarray:
    return cellpar_to_cell(a, a, c, 90.0, 90.0, 120.0)


def _build(p: str, els: list[str], a: float, c: float | None, kw: dict[str, Any]) -> tuple[list[str], np.ndarray, np.ndarray, list[bool]]:
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
        u = float(kw.get("u", 0.375))
        frac = np.array([[1 / 3, 2 / 3, 0], [2 / 3, 1 / 3, 0.5], [1 / 3, 2 / 3, u], [2 / 3, 1 / 3, 0.5 + u]])
        return [els[0]] * 2 + [els[1]] * 2, frac % 1.0, _hex_cell(a, c), full
    if p == "rutile":
        assert c is not None
        u = float(kw.get("u", 0.305))
        frac = np.array([[0, 0, 0], [0.5, 0.5, 0.5], [u, u, 0], [1 - u, 1 - u, 0],
                         [0.5 + u, 0.5 - u, 0.5], [0.5 - u, 0.5 + u, 0.5]])
        cell = np.diag([a, a, c])
        return [els[0]] * 2 + [els[1]] * 4, frac, cell, full
    if p == "graphene":
        assert c is not None
        frac = np.array([[1 / 3, 2 / 3, 0.5], [2 / 3, 1 / 3, 0.5]])
        return [els[0]] * 2, frac, _hex_cell(a, c), [True, True, False]
    if p == "mos2":
        assert c is not None
        t = float(kw.get("thickness", 3.17)) / c
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
        wurtzite, rocksalt, cscl, fluorite, perovskite, rutile, graphene, mos2,
        graphite``).
    elements:
        Element(s) in the order of ``PROTOTYPES[p]["elementRoles"]``; a list,
        a single symbol, a whitespace/comma separated string or a compact
        formula-like string (``"NaCl"``).  Defaults to the prototype's example.
    a, c:
        Lattice constants in Å (``c`` only for hexagonal/tetragonal/2D cells;
        for 2D prototypes ``c`` is the cell height including vacuum).  Omitted
        values come from a table of experimental values or covalent radii.
    **kw:
        Prototype parameters: ``u`` (wurtzite, rutile), ``thickness`` (mos2),
        ``vacuum`` (graphene/mos2: alternative to ``c``), ``repeat``/``supercell``
        (``(nx, ny, nz)`` applied at the end), ``name``.
    """
    p = prototype.strip().lower().replace("-", "").replace("_", "")
    aliases = {"zb": "zincblende", "sphalerite": "zincblende", "nacl": "rocksalt", "caf2": "fluorite",
               "mos2monolayer": "mos2", "2h": "mos2", "simplecubic": "sc"}
    p = aliases.get(p, p)
    if p not in PROTOTYPES:
        raise ValueError(f"unknown prototype {prototype!r}; available: {', '.join(PROTOTYPES)}")
    meta = PROTOTYPES[p]
    els = _parse_elements(elements, p)
    ref_a, ref_c = reference_lattice_constant(p, els)
    a_val = float(a) if a else ref_a
    if a_val <= 0:
        raise ValueError("lattice constant a must be positive")
    c_val: float | None = None
    if meta["hasC"]:
        if c:
            c_val = float(c)
        elif meta["is2D"] and kw.get("vacuum") is not None:
            thick = float(kw.get("thickness", 3.17)) if p == "mos2" else 0.0
            c_val = thick + 2.0 * float(kw["vacuum"])
        elif a and p in ("hcp", "wurtzite") and ref_c is not None and ref_a:
            c_val = ref_c / ref_a * a_val  # keep the reference c/a ratio
        elif a and p == "rutile" and ref_c is not None and ref_a:
            c_val = ref_c / ref_a * a_val
        else:
            c_val = ref_c if ref_c else meta["defaultC"]
        if c_val is None or c_val <= 0:
            raise ValueError("lattice constant c must be positive")
    symbols, frac, cell, pbc = _build(p, els, a_val, c_val, kw)
    info: dict[str, Any] = {
        "source": f"builder:{p}",
        "prototype": p,
        "spacegroup": meta["spacegroup"],
        "spacegroupNumber": meta["spacegroupNumber"],
        "a": round(a_val, 6),
    }
    if c_val is not None:
        info["c"] = round(c_val, 6)
    for key in ("u", "thickness"):
        if key in kw and key in meta["params"]:
            info[key] = float(kw[key])
    s = Structure(symbols, frac @ cell, cell=cell, pbc=pbc, info=info)
    s.name = str(kw.get("name") or f"{s.get_formula(reduce=True)} {p}")
    rep = kw.get("repeat") or kw.get("supercell")
    if rep:
        s = supercell(s, *rep)
    return s


def supercell(structure: Structure, nx: int = 1, ny: int = 1, nz: int = 1) -> Structure:
    """Return the ``nx x ny x nz`` supercell of a periodic *structure* (new object)."""
    return structure.repeat(int(nx), int(ny), int(nz))

