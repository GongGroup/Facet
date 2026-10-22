"""A small library of molecules with reasonable 3D coordinates.

Coordinates of the organic molecules are MMFF94-optimised conformers from
PubChem (3D records); C60 is generated analytically (see
:func:`crystallume.build.cluster.c60_positions`).

    from crystallume import build
    w = build.molecule("water")
    caf = build.molecule("caffeine")
    build.MOLECULES        # metadata for UIs
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ..core.structure import Structure
from .cluster import c60_positions

__all__ = ["MOLECULES", "molecule", "molecule_names"]

_DATA: dict[str, list[tuple[str, float, float, float]]] = {
    "water": [("O", 0.0000, 0.0000, 0.0000), ("H", 0.2774, 0.8929, 0.2544), ("H", 0.6068, -0.2383, -0.7169)],
    "methane": [
        ("C", 0.0000, 0.0000, 0.0000), ("H", 0.5541, 0.7996, 0.4965), ("H", 0.6833, -0.8134, -0.2536),
        ("H", -0.7782, -0.3735, 0.6692), ("H", -0.4593, 0.3874, -0.9121),
    ],
    "ammonia": [
        ("N", 0.0000, 0.0000, 0.0000), ("H", -0.4417, 0.2906, 0.8711), ("H", 0.7256, 0.6896, -0.1907),
        ("H", 0.4875, -0.8701, 0.2089),
    ],
    "co2": [("C", 0.0000, 0.0000, 0.0000), ("O", -1.1970, 0.0000, 0.0000), ("O", 1.1970, 0.0000, 0.0000)],
    "benzene": [
        ("C", -1.2131, -0.6884, 0.0000), ("C", -1.2028, 0.7064, 0.0001), ("C", -0.0103, -1.3948, 0.0000),
        ("C", 0.0104, 1.3948, -0.0001), ("C", 1.2028, -0.7063, 0.0000), ("C", 1.2131, 0.6884, 0.0000),
        ("H", -2.1577, -1.2244, 0.0000), ("H", -2.1393, 1.2564, 0.0001), ("H", -0.0184, -2.4809, -0.0001),
        ("H", 0.0184, 2.4808, 0.0000), ("H", 2.1394, -1.2563, 0.0001), ("H", 2.1577, 1.2245, 0.0000),
    ],
    "ethanol": [
        ("O", -1.1712, 0.2997, 0.0000), ("C", -0.0463, -0.5665, 0.0000), ("C", 1.2175, 0.2668, 0.0000),
        ("H", -0.0958, -1.2120, 0.8819), ("H", -0.0952, -1.1938, -0.8946), ("H", 2.1050, -0.3720, -0.0177),
        ("H", 1.2426, 0.9307, -0.8704), ("H", 1.2616, 0.9052, 0.8886), ("H", -1.1291, 0.8364, 0.8099),
    ],
    "methanol": [
        ("O", 0.7079, 0.0000, 0.0000), ("C", -0.7079, 0.0000, 0.0000), ("H", -1.0732, -0.7690, 0.6852),
        ("H", -1.0731, -0.1947, -1.0113), ("H", -1.0632, 0.9786, 0.3312), ("H", 0.9936, -0.8804, -0.2980),
    ],
    "ethylene": [
        ("C", -0.6672, 0.0000, 0.0000), ("C", 0.6672, 0.0000, 0.0000), ("H", -1.2213, -0.9290, 0.0708),
        ("H", -1.2212, 0.9290, -0.0708), ("H", 1.2213, 0.9290, -0.0708), ("H", 1.2213, -0.9290, 0.0708),
    ],
    "acetylene": [
        ("C", -0.6000, 0.0000, 0.0000), ("C", 0.6000, 0.0000, 0.0000), ("H", -1.6650, 0.0000, -0.0001),
        ("H", 1.6650, 0.0000, 0.0001),
    ],
    "caffeine": [
        ("O", 0.4700, 2.5688, 0.0006), ("O", -3.1271, -0.4436, -0.0003), ("N", -0.9686, -1.3125, 0.0000),
        ("N", 2.2182, 0.1412, -0.0003), ("N", -1.3477, 1.0797, -0.0001), ("N", 1.4119, -1.9372, 0.0002),
        ("C", 0.8579, 0.2592, -0.0008), ("C", 0.3897, -1.0264, -0.0004), ("C", 0.0307, 1.4220, -0.0006),
        ("C", -1.9061, -0.2495, -0.0004), ("C", 2.5032, -1.1998, 0.0003), ("C", -1.4276, -2.6960, 0.0008),
        ("C", 3.1926, 1.2061, 0.0003), ("C", -2.2969, 2.1881, 0.0007), ("H", 3.5163, -1.5787, 0.0008),
        ("H", -1.0451, -3.1973, -0.8937), ("H", -2.5186, -2.7596, 0.0011), ("H", -1.0447, -3.1963, 0.8957),
        ("H", 4.1992, 0.7801, 0.0002), ("H", 3.0468, 1.8092, -0.8992), ("H", 3.0466, 1.8083, 0.9004),
        ("H", -1.8087, 3.1651, -0.0003), ("H", -2.9322, 2.1027, 0.8881), ("H", -2.9346, 2.1021, -0.8849),
    ],
}

#: Metadata for every molecule (``label``, ``aliases``, ``description``).
MOLECULES: dict[str, dict[str, Any]] = {
    "water": {"label": "Water", "aliases": ["h2o"], "description": "H2O"},
    "methane": {"label": "Methane", "aliases": ["ch4"], "description": "CH4"},
    "ammonia": {"label": "Ammonia", "aliases": ["nh3"], "description": "NH3"},
    "co2": {"label": "Carbon dioxide", "aliases": ["carbon dioxide", "carbon_dioxide"], "description": "CO2 (linear)"},
    "benzene": {"label": "Benzene", "aliases": ["c6h6"], "description": "C6H6 aromatic ring"},
    "ethanol": {"label": "Ethanol", "aliases": ["c2h5oh", "etoh"], "description": "C2H5OH"},
    "methanol": {"label": "Methanol", "aliases": ["ch3oh", "meoh"], "description": "CH3OH"},
    "ethylene": {"label": "Ethylene", "aliases": ["ethene", "c2h4"], "description": "C2H4"},
    "acetylene": {"label": "Acetylene", "aliases": ["ethyne", "c2h2"], "description": "C2H2"},
    "caffeine": {"label": "Caffeine", "aliases": ["c8h10n4o2"], "description": "1,3,7-trimethylxanthine"},
    "c60": {"label": "Fullerene C60", "aliases": ["fullerene", "buckminsterfullerene", "buckyball"],
            "description": "Icosahedral C60"},
}

_ALIASES = {alias: name for name, meta in MOLECULES.items() for alias in [name, *meta["aliases"]]}


def molecule_names() -> list[str]:
    """Canonical names of all molecules in the library."""
    return list(MOLECULES)


def molecule(name: str) -> Structure:
    """Return a molecule by name or alias (case-insensitive), centred at the origin."""
    key = _ALIASES.get(name.strip().lower().replace("-", " ").replace("_", " "))
    if key is None:
        key = _ALIASES.get(name.strip().lower())
    if key is None:
        raise ValueError(f"unknown molecule {name!r}; available: {', '.join(MOLECULES)}")
    if key == "c60":
        pos = c60_positions()
        symbols = ["C"] * len(pos)
    else:
        rows = _DATA[key]
        symbols = [r[0] for r in rows]
        pos = np.array([r[1:] for r in rows], dtype=float)
    s = Structure(symbols, pos, cell=None, pbc=False, info={"source": f"builder:molecule:{key}"},
                  name=MOLECULES[key]["label"])
    s.translate(-s.positions.mean(axis=0))
    return s
