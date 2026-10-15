"""Periodic-table data for AtomScope.

The data lives in ``atomscope/data/elements.json`` (Z = 1..103) and is loaded
lazily once per process.  Each record has::

    Z, symbol, name, mass (amu), covalentRadius (Å, Cordero 2008),
    vdwRadius (Å, Alvarez 2013 / Bondi 1964, fallback 2.0),
    jmolColor, vestaColor ("#RRGGBB"), electronegativity (Pauling, may be null)

Unknown symbols (e.g. the dummy ``"X"``) are handled gracefully by the helper
functions, which return sensible defaults instead of raising.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

__all__ = [
    "DATA_PATH",
    "element_table",
    "elements",
    "get_element",
    "is_element",
    "normalize_symbol",
    "symbol_from_label",
    "atomic_number",
    "symbol_of",
    "atomic_mass",
    "covalent_radius",
    "vdw_radius",
    "jmol_color",
    "vesta_color",
    "electronegativity",
]

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "elements.json"

#: Defaults used for unknown / dummy species.
DEFAULT_COVALENT_RADIUS = 1.5
DEFAULT_VDW_RADIUS = 2.0
DEFAULT_COLOR = "#FF1493"


@lru_cache(maxsize=1)
def element_table() -> dict[str, Any]:
    """Return the full parsed ``elements.json`` document (cached)."""
    with open(DATA_PATH, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _by_symbol() -> dict[str, dict[str, Any]]:
    return {rec["symbol"]: rec for rec in element_table()["elements"]}


@lru_cache(maxsize=1)
def _by_z() -> dict[int, dict[str, Any]]:
    return {rec["Z"]: rec for rec in element_table()["elements"]}


def elements() -> list[dict[str, Any]]:
    """Return the list of element records ordered by atomic number."""
    return list(element_table()["elements"])


def is_element(symbol: str) -> bool:
    """True if *symbol* (case-sensitive, e.g. ``"Fe"``) is a known element."""
    return symbol in _by_symbol()


def normalize_symbol(symbol: str | int) -> str:
    """Normalise a user-provided species token to a canonical element symbol.

    Accepts atomic numbers (``26`` or ``"26"``), any capitalisation
    (``"FE"`` -> ``"Fe"``) and strips charges / suffixes such as ``"Fe3+"``,
    ``"O2-"`` or POTCAR-style ``"Fe_pv"``.  Returns the cleaned token
    unchanged (capitalised) when it is not a known element.
    """
    if isinstance(symbol, (int,)) or (isinstance(symbol, str) and symbol.strip().isdigit()):
        z = int(symbol)
        rec = _by_z().get(z)
        return rec["symbol"] if rec else "X"
    s = str(symbol).strip()
    s = re.split(r"[_/.:]", s, maxsplit=1)[0]
    m = re.match(r"([A-Za-z]{1,2})", s)
    if not m:
        return s or "X"
    letters = m.group(1)
    cand = letters[0].upper() + letters[1:].lower()
    if cand in _by_symbol():
        return cand
    one = letters[0].upper()
    if one in _by_symbol():
        return one
    return cand


def symbol_from_label(label: str) -> str:
    """Guess the element from a site label such as ``"Ca1"``, ``"O2a"`` or ``"FE3"``.

    Two-letter symbols win when valid (``"Ca1"`` -> Ca), otherwise the first
    letter is used (``"C12"`` -> C, ``"Ow"`` -> O).
    """
    m = re.match(r"([A-Za-z]+)", label.strip())
    if not m:
        return "X"
    letters = m.group(1)
    if len(letters) >= 2:
        two = letters[0].upper() + letters[1].lower()
        if two in _by_symbol():
            return two
    one = letters[0].upper()
    return one if one in _by_symbol() else letters[:2].capitalize()


def get_element(symbol: str | int) -> dict[str, Any] | None:
    """Return the element record for a symbol or atomic number (or ``None``)."""
    if isinstance(symbol, int):
        return _by_z().get(symbol)
    return _by_symbol().get(symbol) or _by_symbol().get(normalize_symbol(symbol))


def atomic_number(symbol: str) -> int:
    """Atomic number of *symbol* (0 for unknown species)."""
    rec = get_element(symbol)
    return int(rec["Z"]) if rec else 0


def symbol_of(z: int) -> str:
    """Element symbol for atomic number *z* (``"X"`` if unknown)."""
    rec = _by_z().get(int(z))
    return rec["symbol"] if rec else "X"


def atomic_mass(symbol: str) -> float:
    """Standard atomic mass in amu (0.0 for unknown species)."""
    rec = get_element(symbol)
    return float(rec["mass"]) if rec else 0.0


def covalent_radius(symbol: str) -> float:
    """Covalent radius in Å (Cordero 2008); 1.5 Å for unknown species."""
    rec = get_element(symbol)
    return float(rec["covalentRadius"]) if rec else DEFAULT_COVALENT_RADIUS


def vdw_radius(symbol: str) -> float:
    """Van der Waals radius in Å; 2.0 Å for unknown species."""
    rec = get_element(symbol)
    return float(rec["vdwRadius"]) if rec else DEFAULT_VDW_RADIUS


def jmol_color(symbol: str) -> str:
    """Jmol colour as ``"#RRGGBB"``."""
    rec = get_element(symbol)
    return rec["jmolColor"] if rec else DEFAULT_COLOR


def vesta_color(symbol: str) -> str:
    """VESTA colour as ``"#RRGGBB"``."""
    rec = get_element(symbol)
    return rec["vestaColor"] if rec else DEFAULT_COLOR


def electronegativity(symbol: str) -> float | None:
    """Pauling electronegativity, or ``None`` when undefined/unknown."""
    rec = get_element(symbol)
    return rec.get("electronegativity") if rec else None
