#!/usr/bin/env python3
"""Write the M2 golden cases (``tests/data/surface/cleave``) and their input files (``cleave/inputs/``).

Development tool (M2-T7a): run it after changing a case table and commit what it writes; the tests never import
it.  ``--check`` compares the files on disk with what it would write and exits with 1 on any difference.  It keeps
the run state of the files on disk (a skip that a later task removed by hand stays removed, an ``xfail`` stays;
``--reset-skips`` writes every skip again) and leaves the subdirectories of other tasks (``full/``) alone.

    python tests/data/surface/cleave/make_cleave_cases.py            # from the repository root
    python tests/data/surface/cleave/make_cleave_cases.py --check

Where the expectations come from (see README.md):

* geometry (surface cells, periods, plane heights and gaps, layer compositions, slab cells, thicknesses, atom
  counts, tags, constraint flags, atom order, minimum distances) is computed here from the crystal structures by
  plain analytic geometry, independently of the M2 code (which does not exist yet), and every value that the spec
  or the acceptance scenarios quote is asserted against the quote;
* terminations (how many, their labels, order, broken bonds, polarity) and the Tasker type are taken from M2 §0.3
  and acceptance S1-S12 where those state them; this script re-derives them with a plain re-implementation of
  M2 §3.6-3.9 (planes, rumpled-layer merge, bond counting, two-level fingerprints, formal charges, the K7 order
  and the K8 labels) and refuses to write a case whose quoted value it does not reproduce;
* names, warnings and errors are the texts of M2 §3.13 and §3.20 and of the ledgers, verbatim.

Only numpy and this checkout's ``crystallume`` (to check the analytic bulks against the builders the ``bulk`` recipe
calls and the covalent radii against ``crystallume/core/elements.py``) are needed.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA = REPO / "tests" / "data"
SCHEMA = "crystallume.cases/1"

# =============================================================================================== element data
#: Cordero (2008) covalent radii (Å) of the elements used here, as in crystallume/core/elements.py (checked below).
COV = {"H": 0.31, "C": 0.76, "O": 0.66, "Na": 1.66, "Al": 1.21, "Si": 1.11, "Cl": 1.02, "Ti": 1.60, "Fe": 1.32,
       "Co": 1.26, "Cu": 1.32, "Zn": 1.22, "Ga": 1.22, "As": 1.19, "Sr": 1.95, "Ru": 1.46, "Ag": 1.45, "La": 2.07,
       "Ce": 2.04, "Pt": 1.36, "Mo": 1.54, "S": 1.05, "Cr": 1.39}
#: Pauling electronegativities (web/js/core/elements.js PAULING): the element order of formulas.
EN = {"H": 2.20, "C": 2.55, "O": 3.44, "Na": 0.93, "Al": 1.61, "Si": 1.90, "Cl": 3.16, "Ti": 1.54, "Fe": 1.83,
      "Co": 1.88, "Cu": 1.90, "Zn": 1.65, "Ga": 1.81, "As": 2.18, "Sr": 0.95, "Ru": 2.20, "Ag": 1.93, "La": 1.10,
      "Ce": 1.12, "Pt": 2.28, "Mo": 2.16, "S": 2.58, "Cr": 1.66}
#: web/js/core/elements.js METALS and ANIONS (M2 T2 copies them to core/elements.py).
METALS = set(("Li Be Na Mg Al K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn "
              "Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po "
              "Fr Ra Ac Th Pa U Np Pu Am Cm").split())
ANIONS = {"O", "F", "S", "Cl", "N", "Se", "Br", "I", "Te", "P", "C", "H", "As"}
#: M2 §3.9.1: anion charges and the cation valences (preference order) of the elements used here.
ANION_CHARGE = {"O": -2, "S": -2, "Cl": -1, "As": -3, "C": -4, "H": -1}
CATION_VALENCES = {"Na": [1], "Sr": [2], "La": [3], "Ce": [4, 3], "Ti": [4, 3, 2], "Fe": [3, 2], "Zn": [2],
                   "Al": [3], "Ga": [3], "Si": [4], "C": [4], "As": [5, 3], "Mo": [6, 4], "H": [1], "S": [6, 4],
                   "Cr": [3, 6]}
#: M3 §3.7 bond criterion (SURFACE_DEFAULTS bond_min, bond_max, bond_scale).
BOND_MIN, BOND_MAX, BOND_SCALE = 0.4, 5.0, 1.15
#: M2 §3.0 constants (SURFACE_DEFAULTS of M2 T1; ledger L-X-08 names).
LAYER_TOLERANCE = 0.3            # M3 layer_tolerance
PLANE_RESOLUTION = 0.1           # plane_resolution (the ideal crystals here never need plane_resolution_min)
SUBLAYER_GAP = 0.45              # sublayer_gap
SUBLAYER_TILT = 15.0             # sublayer_tilt
MARGIN = 0.01                    # layer_tolerance_margin
MATCH_TOL = 0.10                 # termination_match_tolerance
POLAR_THRESHOLD = 1e-3           # polar_threshold
CONTACT_ERROR, CONTACT_WARN = 0.75, 1.0   # contact_error_fraction, contact_warn_fraction


def formula(comp: dict[str, int]) -> str:
    """``Ti2O2``: elements by Pauling electronegativity, counts > 1 written, not reduced (K8, JS ``formula()``)."""
    return "".join(f"{e}{n if n != 1 else ''}" for e, n in sorted(comp.items(), key=lambda kv: (EN[kv[0]], kv[0])))


def reduced(comp: dict[str, int]) -> dict[str, int]:
    g = 0
    for n in comp.values():
        g = math.gcd(g, n)
    return {e: n // g for e, n in comp.items()}


def formal_charges_of(comp: dict[str, int]) -> dict[str, int]:
    """M2 §3.9.1 ``estimate`` for the compounds used here: metals 0, else the first exact combination."""
    els = sorted(comp)
    if all(e in METALS for e in els) or len(els) == 1:
        return {e: 0 for e in els}
    en_max = max(EN[e] for e in els)
    anions = [e for e in els if e in ANION_CHARGE and EN[e] >= en_max - 0.6]
    cations = [e for e in els if e not in anions]
    neg = sum(ANION_CHARGE[e] * comp[e] for e in anions)
    for combo in itertools.product(*(CATION_VALENCES[e] for e in cations)):
        if sum(q * comp[e] for q, e in zip(combo, cations)) + neg == 0:
            return {**{e: q for e, q in zip(cations, combo)}, **{e: ANION_CHARGE[e] for e in anions}}
    raise ValueError(f"no exact formal charges for {comp}")


# =============================================================================================== crystals
SQ3 = math.sqrt(3.0)
FCC = [(0, 0, 0), (0, .5, .5), (.5, 0, .5), (.5, .5, 0)]
CENTRING = {"P": [(0, 0, 0)], "F": FCC, "I": [(0, 0, 0), (.5, .5, .5)],
            "R": [(0, 0, 0), (2 / 3, 1 / 3, 1 / 3), (1 / 3, 2 / 3, 2 / 3)]}
#: Primitive vectors of the centred lattices in the conventional basis (rows), the standard primitive settings
#: that M2 §3.1.1's Q matrices turn back into the conventional cell (QF, QI, QR).
PRIMITIVE = {"P": [(1, 0, 0), (0, 1, 0), (0, 0, 1)], "F": [(0, .5, .5), (.5, 0, .5), (.5, .5, 0)],
             "I": [(-.5, .5, .5), (.5, -.5, .5), (.5, .5, -.5)],
             "R": [(2 / 3, 1 / 3, 1 / 3), (-1 / 3, 1 / 3, 1 / 3), (-1 / 3, -2 / 3, 1 / 3)]}
QF = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]]
QI = [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
QR = [[1, -1, 0], [0, 1, -1], [1, 1, 1]]


def cellpar(a: float, b: float, c: float, alpha: float = 90.0, beta: float = 90.0, gamma: float = 90.0) -> np.ndarray:
    """``core.lattice.cellpar_to_cell``: a along x, b in the xy plane (right angles give exact zeros)."""
    al, be, ga = np.radians([alpha, beta, gamma])
    ca, cb, cg = (0.0 if abs(v) < 1e-12 else v for v in (math.cos(al), math.cos(be), math.cos(ga)))
    sg = math.sin(ga)
    cy = (ca - cb * cg) / sg
    return np.array([[a, 0.0, 0.0], [b * cg, b * sg, 0.0], [c * cb, c * cy, c * math.sqrt(1.0 - cb * cb - cy * cy)]])


def hexagonal(a: float, c: float) -> np.ndarray:
    return cellpar(a, a, c, 90.0, 90.0, 120.0)


class Crystal:
    """Symbols, fractional coordinates, cell (rows) and the Bravais centring of a bulk (or a slab)."""

    def __init__(self, name: str, symbols: list[str], frac: Any, cell: Any, lattice: str = "P",
                 pbc: tuple[bool, bool, bool] = (True, True, True)) -> None:
        self.name, self.symbols = name, list(symbols)
        self.frac = np.array(frac, float).reshape(-1, 3)
        self.cell = np.array(cell, float)
        self.lattice, self.pbc = lattice, tuple(pbc)

    @property
    def cart(self) -> np.ndarray:
        return self.frac @ self.cell

    def __len__(self) -> int:
        return len(self.symbols)


def mod1(v: float) -> float:
    return v % 1.0


def prototype(proto: str, elements: list[str], a: float, c: float | None = None, u: float | None = None,
              thickness: float | None = None) -> Crystal:
    """The conventional cell of a builder prototype, site by site in the builders' order (web/js/build/crystal.js)."""
    E = elements
    if proto == "fcc":
        return Crystal("fcc", [E[0]] * 4, FCC, np.eye(3) * a, "F")
    if proto == "bcc":
        return Crystal("bcc", [E[0]] * 2, [(0, 0, 0), (.5, .5, .5)], np.eye(3) * a, "I")
    if proto == "hcp":
        return Crystal("hcp", [E[0]] * 2, [(1 / 3, 2 / 3, .25), (2 / 3, 1 / 3, .75)], hexagonal(a, c))
    if proto == "zincblende":
        f = FCC + [tuple(x + .25 for x in p) for p in FCC]
        return Crystal("zincblende", [E[0]] * 4 + [E[1]] * 4, f, np.eye(3) * a, "F")
    if proto == "rocksalt":
        f = FCC + [tuple(mod1(x + d) for x, d in zip(p, (.5, 0, 0))) for p in FCC]
        return Crystal("rocksalt", [E[0]] * 4 + [E[1]] * 4, f, np.eye(3) * a, "F")
    if proto == "fluorite":
        f = FCC + [tuple(mod1(x + .25) for x in p) for p in FCC] + [tuple(mod1(x + .75) for x in p) for p in FCC]
        return Crystal("fluorite", [E[0]] * 4 + [E[1]] * 8, f, np.eye(3) * a, "F")
    if proto == "perovskite":
        f = [(0, 0, 0), (.5, .5, .5), (.5, .5, 0), (.5, 0, .5), (0, .5, .5)]
        return Crystal("perovskite", [E[0], E[1], E[2], E[2], E[2]], f, np.eye(3) * a)
    if proto == "rutile":
        f = [(0, 0, 0), (.5, .5, .5), (u, u, 0), (1 - u, 1 - u, 0), (.5 + u, .5 - u, .5), (.5 - u, .5 + u, .5)]
        return Crystal("rutile", [E[0]] * 2 + [E[1]] * 4, f, np.diag([a, a, c]))
    if proto == "wurtzite":
        f = [(1 / 3, 2 / 3, 0), (2 / 3, 1 / 3, .5), (1 / 3, 2 / 3, mod1(u)), (2 / 3, 1 / 3, mod1(.5 + u))]
        return Crystal("wurtzite", [E[0]] * 2 + [E[1]] * 2, f, hexagonal(a, c))
    if proto == "graphene":
        return Crystal("graphene", [E[0]] * 2, [(1 / 3, 2 / 3, .5), (2 / 3, 1 / 3, .5)], hexagonal(a, c),
                       pbc=(True, True, False))
    if proto == "mos2":
        t = thickness / c
        f = [(1 / 3, 2 / 3, .5), (2 / 3, 1 / 3, .5 - t / 2), (2 / 3, 1 / 3, .5 + t / 2)]
        return Crystal("mos2", [E[0], E[1], E[1]], f, hexagonal(a, c), pbc=(True, True, False))
    raise KeyError(proto)


def corundum(a: float = 4.759, c: float = 12.991, z_al: float = 0.35216, x_o: float = 0.30624) -> Crystal:
    """Al2O3, R-3c (167), hexagonal axes: Al 12c (0, 0, z), O 18e (x, 0, 1/4); the M2 prototype's parameters."""
    ops = [lambda x, y, z: (x, y, z), lambda x, y, z: (-y, x - y, z), lambda x, y, z: (-x + y, -x, z),
           lambda x, y, z: (y, x, -z + .5), lambda x, y, z: (x - y, -y, -z + .5), lambda x, y, z: (-x, -x + y, -z + .5),
           lambda x, y, z: (-x, -y, -z), lambda x, y, z: (y, -x + y, -z), lambda x, y, z: (x - y, x, -z),
           lambda x, y, z: (-y, -x, z + .5), lambda x, y, z: (-x + y, y, z + .5), lambda x, y, z: (x, x - y, z + .5)]
    symbols, frac = _expand([("Al", (0, 0, z_al)), ("O", (x_o, 0, .25))], ops, CENTRING["R"])
    return Crystal("Al2O3", symbols, frac, hexagonal(a, c), "R")


def cr2o3() -> Crystal:
    """Cr2O3 (eskolaite), corundum type: a 4.959, c 13.594 Å, Cr 12c z 0.3475, O 18e x 0.3058 (the "Cr2O3 type" of
    M2 §0.3: the Cr-Cr gap of 0.385 Å is crossed by Cr-O bonds tilted about 41°, so it is not merged)."""
    crys = corundum(a=4.959, c=13.594, z_al=0.3475, x_o=0.3058)
    crys.name, crys.symbols = "Cr2O3", ["Cr" if e == "Al" else e for e in crys.symbols]
    return crys


def lafeo3(a: float = 5.556, b: float = 5.565, c: float = 7.862, z_o2: float = 0.0392) -> Crystal:
    """LaFeO3, Pbnm (GdFeO3 type): La 4c (0.9929, 0.0294, 1/4), Fe 4b (1/2, 0, 0), O1 4c (0.0716, 0.4867, 1/4),
    O2 8d (0.7157, 0.2834, 0.0392); the domain review's structure behind M2 §0.3 (O2 0.308 Å off the Fe plane)."""
    ops = [lambda x, y, z: (x, y, z), lambda x, y, z: (-x, -y, z + .5), lambda x, y, z: (x + .5, -y + .5, -z),
           lambda x, y, z: (-x + .5, y + .5, -z + .5), lambda x, y, z: (-x, -y, -z), lambda x, y, z: (x, y, -z + .5),
           lambda x, y, z: (-x + .5, y + .5, z), lambda x, y, z: (x + .5, -y + .5, z + .5)]
    sites = [("La", (0.9929, 0.0294, .25)), ("Fe", (.5, 0, 0)), ("O", (0.0716, 0.4867, .25)),
             ("O", (0.7157, 0.2834, z_o2))]
    symbols, frac = _expand(sites, ops, CENTRING["P"])
    return Crystal("LaFeO3", symbols, frac, np.diag([a, b, c]))


def anatase(a: float = 3.785, c: float = 9.514, z: float = 0.2081) -> Crystal:
    """Anatase TiO2, I41/amd (origin choice 1): Ti (0, 0, 0), (0, 1/2, 1/4); O (0, 0, ±z), (0, 1/2, 1/4 ± z); + I."""
    base = [("Ti", (0, 0, 0)), ("Ti", (0, .5, .25)), ("O", (0, 0, z)), ("O", (0, 0, -z)), ("O", (0, .5, .25 + z)),
            ("O", (0, .5, .25 - z))]
    symbols, frac = [], []
    for t in CENTRING["I"]:
        for el, p in base:
            symbols.append(el)
            frac.append(tuple(mod1(x + d) for x, d in zip(p, t)))
    order = sorted(range(len(symbols)), key=lambda i: symbols[i] != "Ti")      # Ti block first, then O
    return Crystal("anatase", [symbols[i] for i in order], [frac[i] for i in order], np.diag([a, a, c]), "I")


def sic(stacking: str, a: float = 3.073, bilayer: float = 2.513) -> Crystal:
    """SiC polytype with ideal tetrahedra (M2 domain review T4): Si-C bilayers on A/B/C sites, bond 3/4 bilayer."""
    pos = {"A": (0.0, 0.0), "B": (1 / 3, 2 / 3), "C": (2 / 3, 1 / 3)}
    n = len(stacking)
    c = n * bilayer
    si = [(*pos[s], i / n) for i, s in enumerate(stacking)]
    cc = [(*pos[s], i / n + 0.75 * bilayer / c) for i, s in enumerate(stacking)]
    return Crystal(f"SiC-{stacking}", ["Si"] * n + ["C"] * n, si + cc, hexagonal(a, c))


def la_dhcp(a: float = 3.77, c: float = 12.16) -> Crystal:
    """Double-hcp La (ABAC), the stacking test of M2 §0.3."""
    f = [(0, 0, 0), (1 / 3, 2 / 3, .25), (0, 0, .5), (2 / 3, 1 / 3, .75)]
    return Crystal("La dhcp", ["La"] * 4, f, hexagonal(a, c))


def _expand(sites, ops, centring) -> tuple[list[str], list]:
    out: list[tuple[str, np.ndarray]] = []
    for el, p in sites:
        for op in ops:
            for t in centring:
                q = np.mod(np.array(op(*p), float) + np.array(t), 1.0)
                q[np.abs(q - 1.0) < 1e-9] = 0.0
                if not any(e == el and np.allclose((q - f + .5) % 1 - .5, 0, atol=1e-6) for e, f in out):
                    out.append((el, q))
    return [e for e, _ in out], [f for _, f in out]


def primitive_setting(crys: Crystal, name: str) -> Crystal:
    """The standard primitive cell of a centred crystal, oriented as Materials Project / pymatgen write it
    (cell from its lengths and angles: a along x, b in the xy plane), atoms in its fractional coordinates."""
    P = np.array(PRIMITIVE[crys.lattice]) @ crys.cell
    lengths = np.linalg.norm(P, axis=1)
    ang = [math.degrees(math.acos(P[j] @ P[k] / (lengths[j] * lengths[k]))) for j, k in ((1, 2), (0, 2), (0, 1))]
    cell = cellpar(*lengths, *ang)
    f = np.mod(crys.cart @ np.linalg.inv(P), 1.0)
    f[np.abs(f - 1.0) < 1e-9] = 0.0
    f[np.abs(f) < 1e-12] = 0.0
    keep: list[int] = []
    for i, fi in enumerate(f):
        if not any(crys.symbols[j] == crys.symbols[i] and np.allclose((fi - f[j] + .5) % 1 - .5, 0, atol=1e-6)
                   for j in keep):
            keep.append(i)
    return Crystal(name, [crys.symbols[i] for i in keep], f[keep], cell, "P")


# =============================================================================================== integer and 2D helpers
def egcd(a: int, b: int) -> tuple[int, int, int]:
    """``(g, x, y)`` with ``x·a + y·b = g = gcd(a, b) >= 0`` (floor division, as M1 ``egcd``)."""
    if b == 0:
        return (abs(a), 1 if a >= 0 else -1, 0)
    q = a // b
    g, x, y = egcd(b, a - q * b)
    return (g, y, x - q * y)


def det3(m: Any) -> int:
    m = [[int(x) for x in row] for row in m]
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def plane_basis(hkl: tuple[int, int, int]) -> list[list[int]]:
    """M2 §3.3: integer ``[v1; v2; v3]`` with ``v1·hkl = v2·hkl = 0``, ``v3·hkl = 1`` and ``det = +1``."""
    h, k, l = hkl
    g, p, q = egcd(k, l)
    if g == 0:
        v1, v2, v3 = [0, 1, 0], [0, 0, 1], [h, 0, 0]
    else:
        _, x, y = egcd(g, h)
        v1, v2, v3 = [g, -p * h, -q * h], [0, l // g, -k // g], [y, x * p, x * q]
    if det3([v1, v2, v3]) != 1:
        v1 = [-t for t in v1]
    assert det3([v1, v2, v3]) == 1 and sum(a * b for a, b in zip(v3, hkl)) == 1
    return [v1, v2, v3]


def gauss_reduce_2d(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[list[int]]]:
    """M1 §3.11.1 ``gauss_reduce_2d(a, b, angle="obtuse")``, the frozen contract line by line: ``(u, v, M)`` with
    ``[u; v] = M @ [a; b]`` and ``det M = +1``.  The tie ``|u·v| = |u|²/2`` (hexagonal 60° and every centred
    rectangular net) keeps u and takes ``v - u``; any other acute pair becomes ``(v, -u)``; u then points along a."""
    a, b = np.array(a, float), np.array(b, float)
    u, v = a.copy(), b.copy()
    M = [[1, 0], [0, 1]]
    tau = 1e-9                                            # SURFACE_DEFAULTS.gauss_tolerance
    for _ in range(10000):
        if u @ u > (v @ v) * (1 + tau):
            u, v = v, -u
            M = [M[1], [-M[0][0], -M[0][1]]]
        x = (u @ v) / (u @ u)
        mu = int(math.copysign(math.floor(abs(x) + 0.5 - tau), x)) if abs(x) > 0.5 + tau else 0
        if mu == 0:
            break
        v = v - mu * u
        M = [M[0], [M[1][0] - mu * M[0][0], M[1][1] - mu * M[0][1]]]
    d = u @ v
    if d > tau * math.sqrt(u @ u) * math.sqrt(v @ v):
        if abs(d) >= (u @ u) / 2 * (1 - 1e-6):
            v = v - u
            M = [M[0], [M[1][0] - M[0][0], M[1][1] - M[0][1]]]
        else:
            u, v = v, -u
            M = [M[1], [-M[0][0], -M[0][1]]]
    cu = (u @ a) / math.sqrt((u @ u) * (a @ a))
    cv = (v @ b) / math.sqrt((v @ v) * (b @ b))
    if cu < -tau or (abs(cu) <= tau and cv < -tau):
        u, v = -u, -v
        M = [[-M[0][0], -M[0][1]], [-M[1][0], -M[1][1]]]
    return u, v, M


def mesh_kind(u: np.ndarray, v: np.ndarray, rel: float, deg: float) -> str:
    """One band of M1 §3.5.1 ``mesh_kind`` on a reduced pair (lengths within *rel*, angles within *deg*)."""
    la, lb = float(np.linalg.norm(u)), float(np.linalg.norm(v))
    gamma = math.degrees(math.acos(max(-1.0, min(1.0, (u @ v) / (la * lb)))))
    same = abs(la - lb) <= rel * max(la, lb)
    if same and abs(gamma - 120.0) <= deg:
        return "hexagonal"
    if abs(gamma - 90.0) <= deg:
        return "square" if same else "rectangular"
    if same or abs(2 * abs(u @ v) - la * la) <= rel * la * la:
        return "centred-rectangular"
    return "oblique"


def mesh_type(u: np.ndarray, v: np.ndarray) -> str:
    """M1 ``mesh_type`` (``classify_mesh(...)["kind"]``) of a pair reduced by :func:`gauss_reduce_2d`: the narrow
    band (1e-3 relative, 0.1°), then for centred-rectangular and oblique the distorted band (3 %, 2°)."""
    kind = mesh_kind(u, v, 1e-3, 0.1)
    if kind in ("centred-rectangular", "oblique"):
        wide = mesh_kind(u, v, 0.03, 2.0)
        if wide in ("hexagonal", "square", "rectangular"):
            return wide
    return kind


def lateral(v: np.ndarray, n: np.ndarray) -> np.ndarray:
    return v - (v @ n) * n


def mic2d(v: np.ndarray, a1: np.ndarray, b1: np.ndarray) -> float:
    """Shortest in-plane length of ``v + i·a1 + j·b1`` (v lies in the plane of a reduced a1, b1)."""
    M = np.array([[a1 @ a1, a1 @ b1], [a1 @ b1, b1 @ b1]])
    f = np.linalg.solve(M, np.array([v @ a1, v @ b1]))
    f0 = np.round(f)
    best = math.inf
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            w = v - (f0[0] + di) * a1 - (f0[1] + dj) * b1
            best = min(best, float(math.sqrt(w @ w)))
    return best


def periodic_bonds(symbols: list[str], cart: np.ndarray, cell: np.ndarray) -> list[tuple[int, int, np.ndarray]]:
    """Every bond of the periodic crystal once (M3 §3.7 criterion, ``metal_pairs="smart"``): ``(i, j, v)`` with
    ``v = r_j + image - r_i``."""
    n = len(symbols)
    cut_max = max(min(BOND_MAX, BOND_SCALE * (COV[a] + COV[b])) for a in set(symbols) for b in set(symbols))
    vol = abs(np.linalg.det(cell))
    reach = [int(math.ceil(cut_max / (vol / np.linalg.norm(np.cross(cell[(k + 1) % 3], cell[(k + 2) % 3]))))) + 1
             for k in range(3)]
    edges = []
    for i in range(n):
        for j in range(i, n):
            for L in itertools.product(*(range(-r, r + 1) for r in reach)):
                if i == j and L <= (0, 0, 0):
                    continue
                v = cart[j] + np.array(L) @ cell - cart[i]
                d = math.sqrt(v @ v)
                if BOND_MIN < d < min(BOND_MAX, BOND_SCALE * (COV[symbols[i]] + COV[symbols[j]])):
                    edges.append((i, j, v))
    nonmetal = {e for e in ANIONS if e not in METALS}
    tied = set()          # metals bonded to a non-metal anion
    for i, j, _ in edges:
        if symbols[i] in METALS and symbols[j] in nonmetal:
            tied.add(i)
        if symbols[j] in METALS and symbols[i] in nonmetal:
            tied.add(j)
    return [(i, j, v) for i, j, v in edges
            if not (symbols[i] in METALS and symbols[j] in METALS and i in tied and j in tied)]


def shortest_distance(cart: np.ndarray, cell: np.ndarray, pbc: tuple[bool, bool, bool] = (True, True, True)) -> float:
    n = len(cart)
    best = math.inf
    rng = [range(-2, 3) if p else range(0, 1) for p in pbc]
    for L in itertools.product(*rng):
        shift = np.array(L) @ cell
        for i in range(n):
            d = cart + shift - cart[i]
            r = np.sqrt((d * d).sum(axis=1))
            if L == (0, 0, 0):
                r[i] = math.inf
            best = min(best, float(r.min()))
    return best


# =============================================================================================== M2 §3.2-3.9 re-derived
def coprime(v: list[Fraction]) -> tuple[int, int, int]:
    den = 1
    for x in v:
        den = den * x.denominator // math.gcd(den, x.denominator)
    ints = [int(x * den) for x in v]
    g = 0
    for x in ints:
        g = math.gcd(g, x)
    return tuple(x // g for x in ints)  # type: ignore[return-value]


class Analysis:
    """The surface analysis of (hkl) of a bulk, re-derived from M2 §3.2-3.9 for ideal crystals.

    Lengths in Å.  ``layers`` are on the ring of one period, ``classes`` in the K7 order; ``stack``, ``gaps_below``
    and ``top_indices`` are the invariant view used by the cases (README.md, op ``terminations``).
    """

    def __init__(self, crys: Crystal, hkl: tuple[int, ...], *, primitive: bool = True, basis: str = "input") -> None:
        self.crys = crys
        hkl3 = tuple(int(x) for x in hkl)
        if len(hkl3) == 4:
            h, k, i, l = hkl3
            assert i == -(h + k)
            hkl3 = (h, k, l)
        g = math.gcd(math.gcd(hkl3[0], hkl3[1]), hkl3[2])
        self.miller = tuple(x // g for x in hkl3)
        C = crys.cell
        lat = crys.lattice if primitive else "P"
        self.Pm = np.array(PRIMITIVE[lat]) @ C if primitive else C.copy()
        self.n_lattice_points = round(abs(np.linalg.det(C)) / abs(np.linalg.det(self.Pm)))
        G = np.array(self.miller, float) @ np.linalg.inv(C).T
        self.normal = G / np.linalg.norm(G)
        hp = [Fraction(float(x)).limit_denominator(24) for x in self.Pm @ G]
        self.hkl_p = coprime(hp)
        Gp = np.array(self.hkl_p, float) @ np.linalg.inv(self.Pm).T
        self.period = 1.0 / float(np.linalg.norm(Gp))
        v1, v2, v3 = (np.array(v) @ self.Pm for v in plane_basis(self.hkl_p))
        assert np.cross(v1, v2) @ self.normal > 0
        a1, b1, _ = gauss_reduce_2d(v1, v2)
        self.a1, self.b1 = a1, b1
        # c0: the stacking vector with the smallest in-plane part (closest_in_plane; ties do not matter here)
        lat3 = lateral(v3, self.normal)
        M = np.array([[a1 @ a1, a1 @ b1], [a1 @ b1, b1 @ b1]])
        f = np.linalg.solve(M, np.array([lat3 @ a1, lat3 @ b1]))
        cands = [(math.floor(f[0]) + di, math.floor(f[1]) + dj) for di in (0, 1) for dj in (0, 1)]
        bi, bj = min(cands, key=lambda ij: float(np.linalg.norm(lat3 - ij[0] * a1 - ij[1] * b1)))
        self.c0 = v3 - bi * a1 - bj * b1
        self.ouc_cell = np.array([a1, b1, self.c0])
        self.area = float(np.linalg.norm(np.cross(a1, b1)))
        la, lb = float(np.linalg.norm(a1)), float(np.linalg.norm(b1))
        self.mesh = {"a": la, "b": lb, "gamma": math.degrees(math.acos((a1 @ b1) / (la * lb))), "area": self.area,
                     "type": mesh_type(a1, b1)}
        # the atoms of one primitive cell, then wrapped into the oriented unit cell
        fp = np.mod(crys.cart @ np.linalg.inv(self.Pm), 1.0)
        fp[np.abs(fp - 1.0) < 1e-9] = 0.0
        keep: list[int] = []
        for i, fi in enumerate(fp):
            if not any(np.allclose((fi - fp[j] + .5) % 1 - .5, 0, atol=1e-7) for j in keep):
                keep.append(i)
        assert len(keep) * self.n_lattice_points == len(crys), (len(keep), self.n_lattice_points, len(crys))
        self.symbols = [crys.symbols[i] for i in keep]
        self.prim_cart = fp[keep] @ self.Pm
        fo = np.mod(self.prim_cart @ np.linalg.inv(self.ouc_cell), 1.0)
        fo[np.abs(fo - 1.0) < 1e-9] = 0.0
        self.r = fo @ self.ouc_cell                       # OUC positions, heights in [0, period)
        self.z = self.r @ self.normal
        self.composition = dict(Counter(self.symbols))
        self.charges = formal_charges_of(self.composition)
        self.bonds = periodic_bonds(self.symbols, self.prim_cart, self.Pm)
        self.d_min = shortest_distance(self.prim_cart, self.Pm)
        self._planes()
        self._layers()
        self._cuts()
        self._classes()

    # ----------------------------------------------------------------------------------- planes and layers
    def _ring(self, groups_z: list[float]) -> int:
        """Index after the widest circular gap of sorted heights (the ring start)."""
        h = self.period
        gaps = [(groups_z[(k + 1) % len(groups_z)] + (h if k == len(groups_z) - 1 else 0.0)) - groups_z[k]
                for k in range(len(groups_z))]
        return (max(range(len(gaps)), key=lambda k: (gaps[k] - 1e-9 * k)) + 1) % len(gaps)

    def _planes(self) -> None:
        h = self.period
        order = sorted(range(len(self.z)), key=lambda i: (self.z[i], i))
        zs = [float(self.z[i]) for i in order]
        start = self._ring(zs)
        seq = [(order[(start + t) % len(order)], zs[(start + t) % len(order)] + (h if start + t >= len(order) else 0.0))
               for t in range(len(order))]
        planes, cur = [], [seq[0]]
        for a, b in zip(seq, seq[1:]):
            if b[1] - a[1] > PLANE_RESOLUTION:
                planes.append(cur)
                cur = [b]
            else:
                cur.append(b)
        planes.append(cur)
        assert planes[-1][-1][1] - planes[0][0][1] < h - PLANE_RESOLUTION, "spans the period"
        self.planes = [{"members": [i for i, _ in p], "zs": [z for _, z in p]} for p in planes]
        self.inner = max((max(b - a for a, b in zip(p["zs"], p["zs"][1:])) if len(p["zs"]) > 1 else 0.0)
                         for p in self.planes)

    def _crossings(self, z_lo: float, z_hi: float, z_cut: float) -> int:
        """How many of the planes ``z_cut + n·period`` lie strictly between z_lo and z_hi."""
        h = self.period
        lo, hi = min(z_lo, z_hi), max(z_lo, z_hi)
        return max(0, math.ceil((hi - z_cut) / h - 1e-12) - math.floor((lo - z_cut) / h + 1e-12) - 1)

    def _layers(self) -> None:
        h, P = self.period, self.planes
        m = len(P)
        lo_hi = [(min(p["zs"]), max(p["zs"])) for p in P]
        gaps = [(lo_hi[(k + 1) % m][0] + (h if k == m - 1 else 0.0)) - lo_hi[k][1] for k in range(m)]
        z_cut = [lo_hi[k][1] + gaps[k] / 2 for k in range(m)]
        all_metal = all(e in METALS for e in self.composition)
        nonmetal = {e for e in ANIONS if e not in METALS}
        flags, self.tilts = [False] * m, [None] * m
        if not all_metal and m > 1:
            for k in range(m):
                if gaps[k] >= SUBLAYER_GAP:
                    continue
                best = None
                for i, j, v in self.bonds:
                    if (self.symbols[i] in nonmetal) == (self.symbols[j] in nonmetal):
                        continue
                    zi = float(self.prim_cart[i] @ self.normal)
                    if self._crossings(zi, zi + float(v @ self.normal), z_cut[k]):
                        tilt = math.degrees(math.asin(min(1.0, abs(v @ self.normal) / math.sqrt(v @ v))))
                        best = tilt if best is None else min(best, tilt)
                self.tilts[k] = best
                flags[k] = best is not None and best < SUBLAYER_TILT
        self.plane_gaps, self.flags = gaps, flags
        merged = any(flags) and not all(flags)
        if merged:
            lo = max(max(g for g, f in zip(gaps, flags) if f), self.inner) + MARGIN
            hi = min(g for g, f in zip(gaps, flags) if not f) - MARGIN
            merged = lo <= hi
        if merged:
            kbest = max((k for k in range(m) if not flags[k]), key=lambda k: (gaps[k], -k))
            start = (kbest + 1) % m
            groups, cur = [], [(start, 0.0)]
            for t in range(1, m):
                k = (start + t) % m
                item = (k, h if start + t >= m else 0.0)      # planes after the end of the ring move up a period
                if flags[(k - 1) % m]:
                    cur.append(item)
                else:
                    groups.append(cur)
                    cur = [item]
            groups.append(cur)
            self.tau, self.grouping = min(max(LAYER_TOLERANCE, lo), hi), "merged"
        else:
            groups = [[(k, 0.0)] for k in range(m)]
            lo, hi = self.inner + MARGIN, min(gaps) - MARGIN
            self.tau = min(max(LAYER_TOLERANCE, lo), hi) if lo <= hi else (self.inner + min(gaps)) / 2
            self.grouping = "planes"
        layers = []
        for grp in groups:
            members, zs = [], []
            for k, shift in grp:
                members += P[k]["members"]
                zs += [z + shift for z in P[k]["zs"]]
            comp = dict(Counter(self.symbols[i] for i in members))
            layers.append({"members": members, "zs": zs, "min": min(zs), "max": max(zs),
                           "mean": sum(zs) / len(zs), "composition": comp, "sublayers": len(grp),
                           "charge": sum(self.charges[self.symbols[i]] for i in members)})
        base = math.floor(layers[0]["min"] / h + 1e-12)
        if base:
            for L in layers:
                L["zs"] = [z - base * h for z in L["zs"]]
                for key in ("min", "max", "mean"):
                    L[key] -= base * h
        self.layers = layers
        self.m = len(layers)

    # ----------------------------------------------------------------------------------- cuts and charges
    def Z(self, J: int) -> float:
        return self.layers[J % self.m]["mean"] + (J // self.m) * self.period

    def zmin(self, J: int) -> float:
        return self.layers[J % self.m]["min"] + (J // self.m) * self.period

    def zmax(self, J: int) -> float:
        return self.layers[J % self.m]["max"] + (J // self.m) * self.period

    def _cuts(self) -> None:
        m, h = self.m, self.period
        self.gaps_above = [self.zmin(k + 1) - self.zmax(k) for k in range(m)]
        self.z_cut = [(self.zmax(k) + self.zmin(k + 1)) / 2 for k in range(m)]
        self.broken = []
        for k in range(m):
            n = 0
            for i, _, v in self.bonds:
                zi = float(self.prim_cart[i] @ self.normal)
                n += self._crossings(zi, zi + float(v @ self.normal), self.z_cut[k])
            self.broken.append(n)
        sig = [L["charge"] for L in self.layers]
        self.dipole = [sum(sig[(k - j) % m] * (self.Z(k - j) - self.Z(k)) for j in range(m)) for k in range(m)]
        self.polar = [abs(mu) / self.area > POLAR_THRESHOLD for mu in self.dipole]
        if all(abs(s) <= 1e-6 for s in sig):
            self.tasker = 1
        elif not all(self.polar):
            self.tasker = 2
        else:
            self.tasker = 3

    # ----------------------------------------------------------------------------------- fingerprints
    def atoms_of(self, J: int) -> list[tuple[str, np.ndarray]]:
        L = self.layers[J % self.m]
        q = J // self.m
        out = []
        for i, z in zip(L["members"], L["zs"]):
            shift = round((z - float(self.z[i])) / self.period)
            out.append((self.symbols[i], self.r[i] + (shift + q) * self.c0))
        return out

    def fingerprint(self, J0: int, sign: int) -> list[tuple]:
        top = self.atoms_of(J0)
        elements = sorted({s for s, _ in top})
        fp = []
        for j in range(self.m):
            J = J0 + sign * j
            atoms = self.atoms_of(J)
            depth = abs(self.Z(J) - self.Z(J0))
            comp = tuple(sorted(Counter(s for s, _ in atoms).items()))
            D = []
            for ia, (sym, r) in enumerate(atoms):
                lam = []
                for el in elements:
                    best = math.inf
                    for it, (s2, r2) in enumerate(top):
                        if s2 != el:
                            continue
                        w = lateral(r - r2, self.normal)
                        d = mic2d(w, self.a1, self.b1)
                        if j == 0 and it == ia and d < 1e-9:      # the atom itself: use its nearest image
                            d = min(float(np.linalg.norm(w + x * self.a1 + y * self.b1))
                                    for x in (-1, 0, 1) for y in (-1, 0, 1) if (x, y) != (0, 0))
                        best = min(best, d)
                    lam.append(best)
                D.append((sym, tuple(lam)))
            fp.append((comp, depth, sorted(D)))
        return fp

    @staticmethod
    def same(fa: list[tuple], fb: list[tuple], level: int = 2, tol: float = MATCH_TOL) -> bool:
        for (ca, da, Da), (cb, db, Db) in zip(fa, fb):
            if ca != cb or abs(da - db) > tol:
                return False
            if level == 2:
                if len(Da) != len(Db):
                    return False
                for (sa, la), (sb, lb) in zip(Da, Db):
                    if sa != sb or any(abs(x - y) > tol for x, y in zip(la, lb)):
                        return False
        return len(fa) == len(fb)

    def _classes(self) -> None:
        m = self.m
        fps = [self.fingerprint(k, -1) for k in range(m)]
        self.fps = fps
        parent = list(range(m))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a in range(m):
            for b in range(a + 1, m):
                if self.same(fps[a], fps[b], 1) and self.same(fps[a], fps[b], 2):
                    parent[find(b)] = find(a)
        groups: dict[int, list[int]] = {}
        for k in range(m):
            groups.setdefault(find(k), []).append(k)
        classes = []
        for cuts in groups.values():
            rep = min(cuts)
            top = self.layers[rep]
            q = [self.charges[self.symbols[i]] for i in top["members"]]
            classes.append({"cuts": sorted(cuts), "rep": rep, "polar": self.polar[rep], "broken": self.broken[rep],
                            "qmax": max([x for x in q if x > 0], default=0), "nanion": sum(1 for x in q if x < 0),
                            "top": top["composition"], "below": self.layers[(rep - 1) % m]["composition"]})
        key = lambda c: (1 if c["polar"] else 0, c["broken"], -c["qmax"], -c["nanion"])  # noqa: E731
        classes.sort(key=lambda c: (key(c), c["rep"]))
        self.order_ties = any(key(a) == key(b) for a, b in zip(classes, classes[1:]))
        self.classes = classes
        self._labels()
        k0 = classes[0]["rep"]
        self.stack = [self.layers[(k0 - j) % m]["composition"] for j in range(m)]
        self.gaps_below = [self.gaps_above[(k0 - j - 1) % m] for j in range(m)]
        self.top_indices = [sorted((k0 - c) % m for c in cl["cuts"]) for cl in classes]

    def _labels(self) -> None:
        bases = [formula(c["top"]) for c in self.classes]
        labels = list(bases)
        for base in set(bases):
            idx = [i for i, b in enumerate(bases) if b == base]
            if len(idx) == 1:
                continue
            ext = [base + "·" + formula(self.classes[i]["below"]) for i in idx]
            if len(set(ext)) == len(ext):
                for i, e in zip(idx, ext):
                    labels[i] = e
            else:
                for n, i in enumerate(idx):
                    labels[i] = base + (f"-{chr(65 + n)}" if len(idx) <= 26 else f"-{n + 1}")
        for c, lab in zip(self.classes, labels):
            c["label"] = lab

    # ----------------------------------------------------------------------------------- slabs
    def class_of_cut(self, k: int) -> dict:
        return next(c for c in self.classes if k % self.m in c["cuts"])

    def bottom_label(self, k: int, L: int) -> str:
        """The label of the bottom face of the slab whose top is cut k (K8: a top class matched at level 2)."""
        fb = self.fingerprint(k - L + 1, +1)
        for c in self.classes:
            if self.same(self.fps[c["rep"]], fb, 1) and self.same(self.fps[c["rep"]], fb, 2):
                return c["label"]
        # otherwise the bottom faces are named among themselves by the same rule (base, then "·" + the next layer)
        faces = []                     # one bottom face per cut: the layer just above it, looking up
        for kk in range(self.m):
            f = self.fingerprint(kk + 1, +1)
            if not any(self.same(f, g, 1) and self.same(f, g, 2) for g, _ in faces):
                faces.append((f, kk + 1))
        bases = [formula(self.layers[b % self.m]["composition"]) for _, b in faces]
        mine = next(i for i, (g, _) in enumerate(faces) if self.same(fb, g, 1) and self.same(fb, g, 2))
        if bases.count(bases[mine]) == 1:
            return bases[mine]
        ext = [bases[i] + "·" + formula(self.layers[(b + 1) % self.m]["composition"])
               for i, (_, b) in enumerate(faces) if bases[i] == bases[mine]]
        if len(set(ext)) == len(ext):
            return bases[mine] + "·" + formula(self.layers[(faces[mine][1] + 1) % self.m]["composition"])
        raise ValueError("bottom labels would need -A/-B suffixes (not needed by the cases here)")

    def symmetric_layers(self, k: int, L0: int) -> int:
        for e in range(self.m):
            L = L0 + e
            fb = self.fingerprint(k - L + 1, +1)
            if self.same(self.fps[k], fb, 1) and self.same(self.fps[k], fb, 2):
                return L
        raise ValueError("no symmetric slab")


# =============================================================================================== numbers and names
def r6(x: float) -> float:
    """``round_half_up(x, 6)`` (L-M1-15) for the values ``info.surface`` stores."""
    return math.floor(x * 1e6 + 0.5) / 1e6 if x >= 0 else -math.floor(-x * 1e6 + 0.5) / 1e6


def r9(x: float) -> float:
    v = round(float(x), 9)
    return 0.0 if v == 0 else v


def fmt2(x: float) -> str:
    """``format_decimal(x, 2)``: two decimals, halves up."""
    return f"{math.floor(abs(x) * 100 + 0.5) / 100:.2f}" if x >= 0 else "-" + fmt2(-x)


def miller_token(idx: list[int]) -> str:
    sep = "" if all(abs(x) <= 9 for x in idx) else " "
    return "(" + sep.join(str(x) for x in idx) + ")"


def hkil_of(miller: tuple[int, int, int]) -> list[int]:
    h, k, l = miller
    return [h, k, -(h + k), l]


def comp_add(*comps: dict[str, int]) -> dict[str, int]:
    out: Counter = Counter()
    for c in comps:
        out.update(c)
    return dict(out)


def stoichiometry(comp: dict[str, int], bulk_unit: dict[str, int]) -> tuple[bool, str | None]:
    """M2 §3.9.2: n = min ⌊count/u⌋; the rest is the excess (None when stoichiometric)."""
    n = min(comp.get(e, 0) // u for e, u in bulk_unit.items())
    rest = {e: comp.get(e, 0) - n * bulk_unit.get(e, 0) for e in set(comp) | set(bulk_unit)}
    rest = {e: x for e, x in rest.items() if x}
    return (not rest), (formula(rest) if rest else None)


# =============================================================================================== slabs
class Slab:
    """What ``surface()`` must build for an analysed bulk (M2 §3.10-3.13, ledger L-M2-02): the invariant facts."""

    def __init__(self, A: Analysis, bulk_symbols: list[str], *, termination: int = 0, layers: int | None = None,
                 periods: int | None = None, symmetric: bool = False, vacuum: float, position: str = "center",
                 offset: float = 0.0, S: list[list[int]] | None = None, fix_bottom: int = 0, fix_middle: int = 0,
                 fix_axes: str = "abc") -> None:
        self.A = A
        m = A.m
        cls = A.classes[termination]
        k = cls["rep"]
        L = periods * m if periods else (layers or 4)
        if symmetric:
            L = A.symmetric_layers(k, L)
        self.L, self.k, self.termination = L, k, termination
        S = S or [[1, 0], [0, 1]]
        self.S, self.det = S, S[0][0] * S[1][1] - S[0][1] * S[1][0]
        Js = list(range(k - L + 1, k + 1))                    # bottom to top
        self.layer_comps = [A.layers[J % m]["composition"] for J in Js]
        heights = [[float(r @ A.normal) for _, r in A.atoms_of(J)] for J in Js]
        syms = [[s for s, _ in A.atoms_of(J)] for J in Js]
        zlo = min(min(h) for h in heights)
        self.thickness = max(max(h) for h in heights) - zlo
        z0 = (vacuum / 2 if position == "center" else offset) if vacuum > 0 else 0.0
        self.z_range = [z0, z0 + self.thickness]
        # formal charges, dipole about the middle of the slab (per 1x1 cell), net charge
        zmid = zlo + self.thickness / 2
        q = A.charges
        self.dipole = sum(q[s] * (z - zmid) for hs, ss in zip(heights, syms) for z, s in zip(hs, ss))
        self.net_charge = sum(q[s] for ss in syms for s in ss)
        # atoms: elements in the bulk's first-appearance order, each block bottom to top (K12)
        order = list(dict.fromkeys(bulk_symbols))
        self.symbols, self.tags, self.flags = [], [], []
        fixed = set()
        if fix_bottom:
            fixed = set(range(fix_bottom))
        if fix_middle:
            lo = (L - fix_middle) // 2
            fixed = set(range(lo, lo + fix_middle))
        flag = [ax not in fix_axes for ax in "abc"]
        for el in order:
            for ell, comp in enumerate(self.layer_comps):
                n = comp.get(el, 0) * self.det
                self.symbols += [el] * n
                self.tags += [L - ell] * n
                self.flags += [flag if ell in fixed else [True, True, True]] * n
        self.fixed_layers = fixed
        self.composition = comp_add(*[{e: n * self.det for e, n in c.items()} for c in self.layer_comps])
        bulk_unit = reduced(dict(Counter(bulk_symbols)))
        self.stoichiometric, self.excess = stoichiometry(self.composition, bulk_unit)
        self.bulk_formula = formula(bulk_unit)
        # cell: the supercell of the 1x1 mesh, a along x; c along z (V > 0) or (L/m)·c0 (V = 0)
        A2, B2 = (S[0][0] * A.a1 + S[0][1] * A.b1), (S[1][0] * A.a1 + S[1][1] * A.b1)
        la, lb = float(np.linalg.norm(A2)), float(np.linalg.norm(B2))
        g = math.acos((A2 @ B2) / (la * lb))
        self.mesh = (la, lb, math.degrees(g))
        self.vacuum = vacuum
        if vacuum > 0:
            self.cell = [[la, 0.0, 0.0], [lb * math.cos(g), lb * math.sin(g), 0.0], [0.0, 0.0, self.thickness + vacuum]]
        else:
            assert L % m == 0
            self.cell = None
        self.volume = abs(np.linalg.det(np.array([A2, B2, (L / m) * A.c0]))) if vacuum == 0 else \
            la * lb * math.sin(g) * (self.thickness + vacuum)
        self.top_label = cls["label"]
        self.bottom_label = A.bottom_label(k, L) if len(A.classes) > 1 else cls["label"]

    def contact(self) -> float:
        """Shortest distance across the cell edge along c (V > 0): top atoms to the bottom atoms one c higher."""
        A, m = self.A, self.A.m
        top = A.atoms_of(self.k)
        bottom = A.atoms_of(self.k - self.L + 1)
        c_up = self.thickness + self.vacuum
        best = math.inf
        zlo = min(float(r @ A.normal) for _, r in bottom)
        zhi = max(float(r @ A.normal) for _, r in top)
        for _, rt in top:
            for _, rb in bottom:
                dz = (float(rb @ A.normal) - zlo) + c_up - (zhi - zlo) - (zhi - float(rt @ A.normal))
                w = lateral(rb - rt, A.normal)
                best = min(best, math.sqrt(mic2d(w, A.a1, A.b1) ** 2 + dz * dz))
        return best

    def name(self, formula_bulk: str, idx: list[int], mesh_token: str = "") -> str:
        term = ""
        if len(self.A.classes) > 1:
            term = f"{self.top_label}-term" if self.top_label == self.bottom_label \
                else f"{self.top_label}/{self.bottom_label}-term"
        return " ".join(p for p in (formula_bulk + miller_token(idx), mesh_token, term, f"{self.L}L") if p)


def slab_atoms(A: Analysis, k: int, L: int, S: list[list[int]], vacuum: float, bulk_symbols: list[str],
               origin: tuple[float, float] = (0.0, 0.0)) -> tuple[list[str], np.ndarray, np.ndarray, list[int]]:
    """An explicit slab in the standard frame (a along x, the normal along z, c = (0, 0, t + V)): symbols, Cartesian
    positions, cell and tags, atoms in the K12 order.  Used for the tool inputs (any in-plane origin will do)."""
    e1 = A.a1 / np.linalg.norm(A.a1)
    e3 = A.normal
    Rm = np.array([e1, np.cross(e3, e1), e3])
    a1, b1 = Rm @ A.a1, Rm @ A.b1
    A2, B2 = S[0][0] * a1 + S[0][1] * b1, S[1][0] * a1 + S[1][1] * b1
    det = S[0][0] * S[1][1] - S[0][1] * S[1][0]
    inv = np.linalg.inv(np.array([[A2[0], A2[1]], [B2[0], B2[1]]]))
    images = []
    span = max(abs(x) for row in S for x in row) + 1
    for i in range(-span, span + 1):
        for j in range(-span, span + 1):
            p = i * a1 + j * b1
            f = np.array([p[0], p[1]]) @ inv
            if np.all(f > -1e-9) and np.all(f < 1 - 1e-9):
                images.append(p)
    assert len(images) == det
    rows = []
    Js = list(range(k - L + 1, k + 1))
    for ell, J in enumerate(Js):
        for s, r in A.atoms_of(J):
            for p in images:
                rows.append((s, ell, Rm @ r + p))
    z = np.array([r[2] for _, _, r in rows])
    t = float(z.max() - z.min())
    cell = np.array([A2, B2, [0.0, 0.0, t + vacuum]])
    cell[np.abs(cell) < 1e-12] = 0.0
    out = []
    for s, ell, r in rows:
        r = r.copy()
        r[2] += vacuum / 2 - z.min()
        f = np.array([r[0] - origin[0], r[1] - origin[1]]) @ inv
        f = f - np.floor(f + 1e-9)
        r[:2] = f @ np.array([[A2[0], A2[1]], [B2[0], B2[1]]]) + np.array(origin)
        out.append((s, ell, r))
    order = list(dict.fromkeys(bulk_symbols))
    out.sort(key=lambda x: (order.index(x[0]), x[1]))
    return [s for s, _, _ in out], np.array([r for _, _, r in out]), cell, [L - ell for _, ell, _ in out]


# =============================================================================================== case tables
def recipe(prototype_: str, elements: list[str], a: float, c: float | None = None, **extra: Any) -> dict:
    args: dict[str, Any] = {"prototype": prototype_, "elements": elements, "a": a}
    if c is not None:
        args["c"] = c
    args.update(extra)
    return {"recipe": {"name": "bulk", "args": args}}


#: The bulks of acceptance §0.4 (explicit lattice constants), with the analytic crystal of each.
BULKS: dict[str, tuple[dict, Crystal]] = {
    "Pt": (recipe("fcc", ["Pt"], 3.92), prototype("fcc", ["Pt"], 3.92)),
    "Cu": (recipe("fcc", ["Cu"], 3.615), prototype("fcc", ["Cu"], 3.615)),
    "Ag": (recipe("fcc", ["Ag"], 4.09), prototype("fcc", ["Ag"], 4.09)),
    "Fe": (recipe("bcc", ["Fe"], 2.866), prototype("bcc", ["Fe"], 2.866)),
    "Ru": (recipe("hcp", ["Ru"], 2.71, 4.28), prototype("hcp", ["Ru"], 2.71, 4.28)),
    "Ru706": (recipe("hcp", ["Ru"], 2.706, 4.282), prototype("hcp", ["Ru"], 2.706, 4.282)),
    "Co": (recipe("hcp", ["Co"], 2.507, 4.07), prototype("hcp", ["Co"], 2.507, 4.07)),
    "SrTiO3": (recipe("perovskite", ["Sr", "Ti", "O"], 3.905), prototype("perovskite", ["Sr", "Ti", "O"], 3.905)),
    "TiO2": (recipe("rutile", ["Ti", "O"], 4.594, 2.959, u=0.305),
             prototype("rutile", ["Ti", "O"], 4.594, 2.959, u=0.305)),
    "CeO2": (recipe("fluorite", ["Ce", "O"], 5.411), prototype("fluorite", ["Ce", "O"], 5.411)),
    "ZnO": (recipe("wurtzite", ["Zn", "O"], 3.25, 5.207, u=0.382),
            prototype("wurtzite", ["Zn", "O"], 3.25, 5.207, u=0.382)),
    "NaCl": (recipe("rocksalt", ["Na", "Cl"], 5.64), prototype("rocksalt", ["Na", "Cl"], 5.64)),
    "GaAs": (recipe("zincblende", ["Ga", "As"], 5.653), prototype("zincblende", ["Ga", "As"], 5.653)),
}
#: Builder metadata the slab records copy from the bulk (``info.spacegroup``, ``info.source``).
SPACEGROUP = {"fcc": "Fm-3m", "bcc": "Im-3m", "hcp": "P6_3/mmc", "perovskite": "Pm-3m", "rutile": "P4_2/mnm",
              "fluorite": "Fm-3m", "wurtzite": "P6_3mc", "rocksalt": "Fm-3m", "zincblende": "F-43m"}

TERMS_SKIP = "op terminations is registered by M2-T3 (Python) and M2-T6a (JS)"
SURFACE_SKIP = "op surface is registered by M2-T4 (Python) and M2-T6b (JS)"
TOOL_SKIP = "op {op} is registered by M2-T5 (Python and JS)"
TOL = {"value": 1e-6}

N2 = ("the {n}-atom input cell was reduced to its {p}-atom primitive cell; turn off Minimal surface cell to keep the "
      "input cell (for example for magnetic order set in INCAR)")


def skip(reason: str) -> dict:
    return {"py": reason, "js": reason}


def is_hexagonal(cell: np.ndarray) -> bool:
    la, lb = np.linalg.norm(cell[0]), np.linalg.norm(cell[1])
    gam = math.degrees(math.acos(cell[0] @ cell[1] / (la * lb)))
    lc = np.linalg.norm(cell[2])
    right = all(abs(math.degrees(math.acos(cell[2] @ cell[k] / (lc * np.linalg.norm(cell[k])))) - 90) <= 0.1
                for k in (0, 1))
    return abs(la - lb) <= 1e-3 * la and abs(gam - 120) <= 0.1 and right


def terms_expect(A: Analysis, miller_input: list[int], *, basis: str = "input", mesh: bool = True,
                 conventional: tuple[str, list] | None = None, miller_conventional: list[int] | None = None,
                 order: bool = True, extra: dict | None = None) -> dict:
    """The expectations of an op ``terminations`` case (README.md, "Op terminations")."""
    hexa = is_hexagonal(A.crys.cell)
    e: dict[str, Any] = {"miller": list(A.miller), "millerInput": list(miller_input), "millerBasis": basis}
    if conventional:
        e["millerConventional"] = miller_conventional
        e["conventional"] = {"kind": conventional[0], "toConventional": conventional[1]}
        e["hkil"] = hkil_of(tuple(miller_conventional)) if conventional[0] == "hR" else None
    else:
        e["millerConventional"] = None
        e["conventional"] = None
        e["hkil"] = hkil_of(A.miller) if hexa else None
    if mesh:
        e.update({"mesh.a": r9(A.mesh["a"]), "mesh.b": r9(A.mesh["b"]), "mesh.gamma": r9(A.mesh["gamma"])})
    e.update({"mesh.area": r9(A.mesh["area"]), "mesh.type": A.mesh["type"], "period": r9(A.period),
              "layersPerPeriod": A.m, "layerTolerance": r9(A.tau), "layerGrouping": A.grouping, "tasker": A.tasker,
              "terminationCount": len(A.classes)})
    e["labels"] = [c["label"] for c in A.classes]
    e["brokenBonds"] = [c["broken"] for c in A.classes]
    e["polar"] = [bool(c["polar"]) for c in A.classes]
    e["stack"] = [dict(sorted(c.items())) for c in A.stack]
    e["gapsBelow"] = [r9(g) for g in A.gaps_below]
    if order and not A.order_ties:
        e["topIndices"] = A.top_indices
    e.update(extra or {})
    return e


#: Quotes that are off in their last digit but within the acceptance tolerance (reported by ``--check``).
SLIPS: list[str] = []


def check_quote(name: str, got: Any, quoted: Any, digits: int | None = None, tol: float | None = None) -> None:
    """A value the spec or the acceptance scenarios quote must be what the geometry gives: to the quoted digits, or
    within *tol* (the acceptance tolerance classes, §0.5: A4 = 1e-4 Å, 0.01°, 1e-3 Å²), noting the slip."""
    if digits is None:
        if got != quoted:
            raise SystemExit(f"{name}: computed {got!r}, the spec quotes {quoted!r}")
        return
    if abs(got - quoted) <= 0.5 * 10.0 ** -digits + 1e-12:
        return
    if tol is not None and abs(got - quoted) <= tol:
        SLIPS.append(f"{name}: the quote {quoted} is off in its last digit (exact {got:.6f}; within ±{tol:g})")
        return
    raise SystemExit(f"{name}: computed {got!r}, the spec quotes {quoted!r}")


def terms_case(cid: str, inp: dict, args: dict, expect: dict, note: str) -> dict:
    return {"id": cid, "op": "terminations", "args": args, "input": inp, "expect": expect, "tol": TOL,
            "skip": skip(TERMS_SKIP), "note": note}


def quote_mesh(name: str, A: Analysis, a: float | None = None, b: float | None = None, gamma: float | None = None,
               area: float | None = None, area_digits: int = 4, period: float | None = None,
               period_digits: int = 4) -> None:
    if a is not None:
        check_quote(f"{name} a", A.mesh["a"], a, 4, 1e-4)
    if b is not None:
        check_quote(f"{name} b", A.mesh["b"], b, 4, 1e-4)
    if gamma is not None:
        check_quote(f"{name} gamma", A.mesh["gamma"], gamma, 2, 0.01)
    if area is not None:
        check_quote(f"{name} area", A.area, area, area_digits, 1e-3)
    if period is not None:
        check_quote(f"{name} period", A.period, period, period_digits, 1e-4)


def quote_terms(name: str, A: Analysis, terms: list[tuple[str, int, bool]] | None = None, tasker: int | None = None,
                count: int | None = None, m: int | None = None) -> None:
    got = [(c["label"], c["broken"], bool(c["polar"])) for c in A.classes]
    if terms is not None:
        check_quote(f"{name} terminations", got[:len(terms)], terms)
    if count is not None:
        check_quote(f"{name} termination count", len(got), count)
    if tasker is not None:
        check_quote(f"{name} Tasker type", A.tasker, tasker)
    if m is not None:
        check_quote(f"{name} layers per period", A.m, m)


def analysis_cases() -> dict[str, list[dict]]:
    files: dict[str, list[dict]] = {"analysis/metals.json": [], "analysis/oxides.json": [], "analysis/inputs.json": [],
                                    "analysis/errors.json": []}
    metals, oxides, inputs, errors = (files[k] for k in files)

    def add(lst: list, cid: str, bulk: str, hkl: tuple, note: str, *, args: dict | None = None, primitive: bool = True,
            quote=None, **kw) -> Analysis:
        inp, crys = BULKS[bulk]
        A = Analysis(crys, hkl, primitive=primitive)
        if quote:
            quote(A)
        a = {"miller": list(hkl)}
        if not primitive:
            a["primitive"] = False
        a.update(args or {})
        e = terms_expect(A, list(hkl), **kw)
        e["primitive"] = primitive
        lst.append(terms_case(cid, inp, a, e, note))
        return A

    n2_fcc = N2.format(n=4, p=1)
    # ---------------------------------------------------------------------------------------------- metals
    add(metals, "m2-terms-pt111", "Pt", (1, 1, 1),
        "acceptance S1-1, M2 §0.3: Pt(111) of the 4-atom cell, a = b = a0/√2, 120°, d = a0/√3; reduced to the "
        "primitive cell (N2)",
        quote=lambda A: (quote_mesh("Pt(111)", A, 2.7719, 2.7719, 120.0, 6.6538, period=2.2632),
                         quote_terms("Pt(111)", A, [("Pt", 3, False)], 1, 1, 1)),
        extra={"charges": {"Pt": 0}, "translationTolerance": 0.05, "notes": [n2_fcc], "warnings": {"equals": []},
               "normal": [r9(1 / SQ3)] * 3})
    add(metals, "m2-terms-pt222-reduced", "Pt", (2, 2, 2),
        "M2 §3.1 N1: (2 2 2) is the (1 1 1) plane; the notes give N1 then N2",
        extra={"notes": ["(2 2 2) was reduced to (1 1 1)", n2_fcc]})
    add(metals, "m2-terms-pt111-input-cell", "Pt", (1, 1, 1),
        "M2 §0.3: primitive=False keeps the 4-atom cell: a 2×2 mesh (5.5437 Å, 26.615 Å²), one Pt4 plane per period",
        primitive=False, quote=lambda A: (quote_mesh("Pt(111) input cell", A, 5.5437, 5.5437, 120.0, 26.615, 3, 2.2632),
                                          quote_terms("Pt(111) input cell", A, [("Pt4", 12, False)], 1, 1, 1)))
    add(metals, "m2-terms-pt100", "Pt", (1, 0, 0), "M2 §0.3: Pt(100), square 2.772 Å, d = a0/2, 4 bonds per cell",
        quote=lambda A: (quote_mesh("Pt(100)", A, 2.7719, 2.7719, 90.0, period=1.960, period_digits=3),
                         quote_terms("Pt(100)", A, [("Pt", 4, False)], 1, 1, 1)),
        extra={"notes": [n2_fcc]})
    add(metals, "m2-terms-pt100-input-cell", "Pt", (1, 0, 0),
        "the noise-free twin of m2-terms-pt100-input-cell-noise-0.02: the cubic cell's (100), two Pt2 planes per 3.92 "
        "Å, one termination",
        primitive=False, quote=lambda A: quote_terms("Pt(100) input cell", A, [("Pt2", 8, False)], 1, 1, 2))
    add(metals, "m2-terms-pt110", "Pt", (1, 1, 0),
        "acceptance S5-1: rectangle 2.7719 × 3.9200 Å (short side along a), d = a0/(2√2), 6 bonds per cell",
        quote=lambda A: (quote_mesh("Pt(110)", A, 2.7719, 3.9200, 90.0, 10.8657, period=1.3859),
                         quote_terms("Pt(110)", A, [("Pt", 6, False)], 1, 1, 1)))
    add(metals, "m2-terms-pt211", "Pt", (2, 1, 1),
        "acceptance S6-1: rectangle 2.7719 × 6.7896 Å (b = √3 a), d = a0/(2√6), 10 bonds per cell",
        quote=lambda A: (quote_mesh("Pt(211)", A, 2.7719, 6.7896, 90.0, 18.820, 3, 0.8002),
                         quote_terms("Pt(211)", A, [("Pt", 10, False)], 1, 1, 1)))
    add(metals, "m2-terms-pt543", "Pt", (5, 4, 3),
        "M2 §0.3: d = a0/(2√50) = 0.277 Å, so the layer tolerance is d - 0.01 Å (0.267); 28 bonds; the oblique "
        "mesh 4.801 × 11.429 Å at 98.05° (M1 §3.11.1: the reduced pair is already obtuse, the short side first)",
        quote=lambda A: (check_quote("Pt(543) period", A.period, 0.277, 3),
                         check_quote("Pt(543) tau", A.tau, 0.267, 3),
                         quote_terms("Pt(543)", A, [("Pt", 28, False)], 1, 1, 1)))
    add(metals, "m2-terms-pt1-1-12", "Pt", (1, 1, 12),
        "M2 §0.3: d = a0/(2√146) = 0.162 Å, layer tolerance 0.152 Å (v1 reported E7 at 0.3 Å), 50 bonds per cell",
        quote=lambda A: (check_quote("Pt(1 1 12) period", A.period, 0.162, 3),
                         check_quote("Pt(1 1 12) tau", A.tau, 0.152, 3),
                         quote_terms("Pt(1 1 12)", A, [("Pt", 50, False)], 1, 1, 1)))
    add(metals, "m2-terms-cu100", "Cu", (1, 0, 0),
        "acceptance S2-1: square 2.5562 Å, 6.5341 Å², d(100) = 1.8075 Å, 4 bonds",
        quote=lambda A: (quote_mesh("Cu(100)", A, 2.5562, 2.5562, 90.0, 6.5341, period=1.8075),
                         quote_terms("Cu(100)", A, [("Cu", 4, False)], 1, 1, 1)),
        extra={"notes": [n2_fcc]})
    add(metals, "m2-terms-ag111", "Ag", (1, 1, 1), "acceptance S3-1: 2.8921 Å at 120°, d = 2.3614 Å (a0 = 4.09 Å)",
        quote=lambda A: (quote_mesh("Ag(111)", A, 2.8921, 2.8921, 120.0, period=2.3614),
                         quote_terms("Ag(111)", A, [("Ag", 3, False)], 1, 1, 1)))
    add(metals, "m2-terms-fe110", "Fe", (1, 1, 0),
        "acceptance S7-1: rhombic 2.4820 Å at 109.47° (obtuse convention), 5.8082 Å², d = a0/√2; nearest and second "
        "neighbours are bonds (4 per cell)",
        quote=lambda A: (quote_mesh("Fe(110)", A, 2.4820, 2.4820, 109.47, 5.8082, period=2.0266),
                         quote_terms("Fe(110)", A, [("Fe", 4, False)], 1, 1, 1)),
        extra={"notes": [N2.format(n=2, p=1)]})
    add(metals, "m2-terms-ru0001", "Ru", (0, 0, 0, 1),
        "acceptance S4-1: four indices; 2.7100 Å at 120°, 6.3603 Å², period 4.2800 Å with two layers 2.1400 Å apart, "
        "one termination (6_3 screw)",
        quote=lambda A: (quote_mesh("Ru(0001)", A, 2.7100, 2.7100, 120.0, 6.3603, period=4.2800),
                         quote_terms("Ru(0001)", A, [("Ru", 3, False)], 1, 1, 2)),
        extra={"notes": []})
    add(metals, "m2-terms-ru001-three-indices", "Ru", (0, 0, 1),
        "the same plane given with three indices: hkil is still reported for the 120° hexagonal cell")
    add(metals, "m2-terms-ru10-10", "Ru706", (1, 0, -1, 0),
        "M2 §0.3 (a = 2.706, c = 4.282 Å as there): rectangle 2.706 × 4.282 Å, period 2.3435 Å, layers 0.781 and 1.562 "
        "Å apart; Ru-A (6 bonds) and Ru-B (8)",
        quote=lambda A: (quote_mesh("Ru(10-10)", A, 2.706, 4.282, 90.0, period=2.3435),
                         check_quote("Ru(10-10) gaps", sorted(round(g, 3) for g in A.gaps_below), [0.781, 1.562]),
                         quote_terms("Ru(10-10)", A, [("Ru-A", 6, False), ("Ru-B", 8, False)], 1, 2, 2)))
    add(metals, "m2-terms-co0001", "Co", (0, 0, 0, 1), "M2 §0.3: Co(0001), 2.507 Å at 120°, period 4.070 Å",
        quote=lambda A: (quote_mesh("Co(0001)", A, 2.507, 2.507, 120.0, period=4.070, period_digits=3),
                         quote_terms("Co(0001)", A, [("Co", 3, False)], 1, 1, 2)))
    # ---------------------------------------------------------------------------------------------- oxides
    add(oxides, "m2-terms-srtio3-001", "SrTiO3", (0, 0, 1),
        "acceptance S9-1, M2 §0.3: square 3.9050 Å, 15.249 Å², TiO2 and SrO 1.9525 Å apart, 5 bonds each; TiO2 first "
        "(K7: Ti4+ on top), Tasker 1",
        quote=lambda A: (quote_mesh("SrTiO3(001)", A, 3.9050, 3.9050, 90.0, 15.249, 3, 3.9050),
                         quote_terms("SrTiO3(001)", A, [("TiO2", 5, False), ("SrO", 5, False)], 1, 2, 2)),
        extra={"charges": {"Sr": 2, "Ti": 4, "O": -2}})
    add(oxides, "m2-terms-tio2-110", "TiO2", (1, 1, 0),
        "acceptance S8-1/S8-2, M2 §0.3: 2.9590 × 6.4969 Å, period 3.2484 Å, three planes 1.2669/0.7147/1.2669 Å apart; "
        "O·Ti2O2 (bridging O, 2 bonds, non-polar), Ti2O2 (3, polar), O·O (3, polar); Tasker 2",
        quote=lambda A: (quote_mesh("TiO2(110)", A, 2.9590, 6.4969, 90.0, 19.224, 3, 3.2484),
                         check_quote("TiO2(110) gaps", sorted(round(g, 4) for g in A.gaps_below),
                                     [0.7147, 1.2669, 1.2669]),
                         quote_terms("TiO2(110)", A, [("O·Ti2O2", 2, False), ("Ti2O2", 3, True), ("O·O", 3, True)], 2,
                                     3, 3)),
        extra={"charges": {"Ti": 4, "O": -2}})
    # the K5 regression rows of M2 §0.3: merged rutile (111)/(120), rutile (102) (E7 in v1), ZnO (2 0 -2 1) (one
    # termination in v1 at 0.3 Å)
    for cid, hkl, what, m, tau, grouping, count, tasker, layers in [
        ("m2-terms-tio2-111", (1, 1, 1), "(111)", 2, 0.30, "merged", 2, 3, ["Ti", "TiO4"]),
        ("m2-terms-tio2-120", (1, 2, 0), "(120)", 2, 0.30, "merged", 2, 3, ["Ti", "TiO4"]),
        ("m2-terms-tio2-102", (1, 0, 2), "(102)", 6, 0.145, "planes", 3, 2, None),
    ]:
        def quote(A, what=what, m=m, tau=tau, grouping=grouping, count=count, tasker=tasker, layers=layers):
            check_quote(f"rutile {what} tau", A.tau, tau, 3 if tau < 0.3 else 2)
            check_quote(f"rutile {what} grouping", A.grouping, grouping)
            quote_terms(f"rutile {what}", A, None, tasker, count, m)
            if layers:
                check_quote(f"rutile {what} layers", sorted(formula(L["composition"]) for L in A.layers), layers)
        merged = ("the Ti and TiO4 sub-planes (bonds tilted under 15°) merged into Ti | TiO4, two layers per "
                  "period, layer tolerance 0.30 Å; TiO4 first, both polar, Tasker 3")
        add(oxides, cid, "TiO2", hkl,
            f"M2 §0.3 and §7.1 (layers and merging, K5): rutile {what}: "
            + (merged if grouping == "merged" else
               "six separate planes (0.155 Å apart at the closest, v1 reported E7), layer tolerance 0.145 Å; the "
               "non-polar O·Ti cut first, Ti and O·O polar, Tasker 2"),
            quote=quote, extra={"charges": {"Ti": 4, "O": -2}})
    A = add(oxides, "m2-terms-zno-20-21", "ZnO", (2, 0, -2, 1),
            "M2 §0.3 (K5): ZnO (2 0 -2 1): four separate planes Zn | Zn | O | O per 1.359 Å, layer tolerance 0.216 Å "
            "(v1 found one termination at 0.3 Å), four terminations, all polar (Tasker 3); the centred-rectangular "
            "mesh 3.25 × 10.909 Å; Zn·O and Zn·Zn tie in the K7 key, so only the first and last labels are compared",
            quote=lambda A: (check_quote("ZnO(20-21) tau", A.tau, 0.216, 3),
                             check_quote("ZnO(20-21) grouping", A.grouping, "planes"),
                             check_quote("ZnO(20-21) layers", sorted(formula(L["composition"]) for L in A.layers),
                                         ["O", "O", "Zn", "Zn"]),
                             quote_terms("ZnO(20-21)", A, None, 3, 4, 4)))
    e = oxides[-1]["expect"]
    assert A.order_ties and "topIndices" not in e
    labels = e.pop("labels")
    e.update({"terminations.0.label": labels[0], "terminations.3.label": labels[3]})
    add(oxides, "m2-terms-ceo2-111", "CeO2", (1, 1, 1),
        "acceptance S10-1/S10-2: 3.8262 Å at 120°, 12.678 Å², period 3.1240 Å, O/Ce/O 0.7810 Å apart and 1.5620 Å "
        "between trilayers; O·Ce (2 bonds, non-polar) first, Ce and O·O (4, polar); Tasker 2",
        quote=lambda A: (quote_mesh("CeO2(111)", A, 3.8262, 3.8262, 120.0, 12.678, 3, 3.1240),
                         check_quote("CeO2(111) gaps", sorted(round(g, 4) for g in A.gaps_below),
                                     [0.7810, 0.7810, 1.5620]),
                         quote_terms("CeO2(111)", A, [("O·Ce", 2, False), ("Ce", 4, True), ("O·O", 4, True)], 2, 3, 3)),
        extra={"charges": {"Ce": 4, "O": -2}})
    add(oxides, "m2-terms-zno-10-10", "ZnO", (1, 0, -1, 0),
        "acceptance S11-1 to S11-3: four indices stored as miller (1 0 0); rectangle 3.2500 × 5.2070 Å, 16.923 Å², "
        "period 2.8146 Å (a√3/2), "
        "ZnO planes 0.9382/1.8764 Å apart (independent of u); ZnO-A (wide gap, 2 bonds), ZnO-B (4), non-polar",
        quote=lambda A: (quote_mesh("ZnO(10-10)", A, 3.2500, 5.2070, 90.0, 16.923, 3, 2.8146),
                         check_quote("ZnO(10-10) gaps", sorted(round(g, 4) for g in A.gaps_below), [0.9382, 1.8764]),
                         quote_terms("ZnO(10-10)", A, [("ZnO-A", 2, False), ("ZnO-B", 4, False)], 1, 2, 2)),
        extra={"charges": {"Zn": 2, "O": -2}})
    add(oxides, "m2-terms-zno-0001", "ZnO", (0, 0, 0, 1),
        "M2 §0.3: O | Zn | O | Zn per period, the Zn termination breaks 1 bond per cell (first), Tasker 3",
        quote=lambda A: (quote_mesh("ZnO(0001)", A, 3.25, 3.25, 120.0, period=5.207, period_digits=3),
                         quote_terms("ZnO(0001)", A, [("Zn", 1, True)], 3, 2, 4)))
    add(oxides, "m2-terms-nacl-100", "NaCl", (1, 0, 0),
        "acceptance S12-1: the minimal mesh is 3.9881 Å square (15.905 Å²), d = 2.8200 Å, each layer Na1Cl1 and "
        "neutral, one termination",
        quote=lambda A: (quote_mesh("NaCl(100)", A, 3.9881, 3.9881, 90.0, 15.905, 3, 2.8200),
                         quote_terms("NaCl(100)", A, [("NaCl", 2, False)], 1, 1, 1)),
        extra={"notes": [N2.format(n=8, p=2)], "charges": {"Na": 1, "Cl": -1}})
    add(oxides, "m2-terms-nacl-100-input-cell", "NaCl", (1, 0, 0),
        "acceptance S12-1: without the primitive step the mesh is the 5.64 Å square of the input cell, twice the "
        "minimal area",
        primitive=False, quote=lambda A: (quote_mesh("NaCl(100) input cell", A, 5.64, 5.64, 90.0),
                                          check_quote("NaCl(100) area ratio", round(A.area / 15.904899, 4), 2.0)))
    add(oxides, "m2-terms-nacl-111", "NaCl", (1, 1, 1),
        "M2 §0.3 and §7.1 (K7 ties): Cl | Na, both polar with 3 bonds; Na first (higher cation charge on top); "
        "Tasker 3",
        quote=lambda A: quote_terms("NaCl(111)", A, [("Na", 3, True), ("Cl", 3, True)], 3, 2, 2))
    add(oxides, "m2-terms-gaas-111", "GaAs", (1, 1, 1),
        "M2 §0.3: the sign of the indices decides the top: (111) has Ga on top with 1 bond per cell; Tasker 3",
        quote=lambda A: quote_terms("GaAs(111)", A, [("Ga", 1, True), ("As", 3, True)], 3, 2, 2))
    add(oxides, "m2-terms-gaas-m1m1m1", "GaAs", (-1, -1, -1),
        "M2 §0.3: the (-1 -1 -1) face is As-terminated with 1 bond per cell",
        quote=lambda A: quote_terms("GaAs(-1-1-1)", A, [("As", 1, True), ("Ga", 3, True)], 3, 2, 2))
    analysis_input_cases(inputs)
    analysis_error_cases(errors)
    return files


# =============================================================================================== input files
def poscar_text(comment: str, crys: Crystal, flags: list[list[bool]] | None = None) -> str:
    """VASP 5 POSCAR (Direct, 16 decimals); species in blocks in the order of the atoms."""
    species = list(dict.fromkeys(crys.symbols))
    assert crys.symbols == sorted(crys.symbols, key=species.index), "POSCAR atoms must come in species blocks"
    lines = [comment, "1.0"]
    lines += ["  " + " ".join(f"{x:22.16f}" for x in row) for row in crys.cell]
    lines += ["  " + "  ".join(species), "  " + "  ".join(str(crys.symbols.count(e)) for e in species)]
    if flags is not None:
        lines.append("Selective dynamics")
    lines.append("Direct")
    for i, f in enumerate(crys.frac):
        row = "  " + " ".join(f"{x:20.16f}" for x in f)
        if flags is not None:
            row += "   " + " ".join("T" if v else "F" for v in flags[i])
        lines.append(row)
    return "\n".join(lines) + "\n"


def read_poscar(text: str) -> tuple[Crystal, list[list[bool]] | None]:
    """The reader matching :func:`poscar_text` (so that the analyses use the numbers as written)."""
    lines = text.splitlines()
    cell = np.array([[float(x) for x in lines[k].split()] for k in (2, 3, 4)]) * float(lines[1])
    species, counts = lines[5].split(), [int(x) for x in lines[6].split()]
    k = 7
    sd = lines[k].strip().lower().startswith("s")
    k += 1 + sd
    n = sum(counts)
    symbols = [e for e, c in zip(species, counts) for _ in range(c)]
    frac, flags = [], []
    for line in lines[k:k + n]:
        tok = line.split()
        frac.append([float(x) for x in tok[:3]])
        if sd:
            flags.append([t.upper().startswith("T") for t in tok[3:6]])
    return Crystal(lines[0].strip(), symbols, frac, cell), (flags if sd else None)


def wrapped(crys: Crystal) -> Crystal:
    f = np.mod(crys.frac, 1.0)
    f[np.abs(f - 1.0) < 1e-12] = 0.0
    f[np.abs(f) < 1e-15] = 0.0
    return Crystal(crys.name, crys.symbols, f, crys.cell, crys.lattice, crys.pbc)


def noisy(crys: Crystal, sigma: float, seed: int) -> Crystal:
    """Gaussian noise of *sigma* Å on each Cartesian component (numpy ``default_rng(seed)``), cell unchanged."""
    rng = np.random.default_rng(seed)
    cart = crys.cart + rng.normal(0.0, sigma, (len(crys), 3))
    return wrapped(Crystal(crys.name, crys.symbols, cart @ np.linalg.inv(crys.cell), crys.cell, "P"))


#: Noise inputs: name -> (bulk key or builder, sigma, seed, hkl, primitive); the seeds were chosen so that every
#: equivalent cut stays within half the 0.10 Å match tolerance of its class and different classes stay far apart.
NOISE = {
    "tio2_rutile_noise_0.01": ("TiO2", 0.01, 11, (1, 1, 0), True),
    "tio2_rutile_noise_0.02": ("TiO2", 0.02, 11, (1, 1, 0), True),
    "srtio3_noise_0.02": ("SrTiO3", 0.02, 21, (0, 0, 1), True),
    "zno_noise_0.02": ("ZnO", 0.02, 31, (1, 0, -1, 0), True),
    "ru_hcp_noise_0.02": ("Ru706", 0.02, 29, (0, 0, 0, 1), True),
    "pt_fcc_noise_0.02": ("Pt", 0.02, 4, (1, 0, 0), False),
    "al2o3_noise_0.01": ("Al2O3", 0.01, 5, (0, 0, 0, 1), False),
    "al2o3_noise_0.02": ("Al2O3", 0.02, 5, (0, 0, 0, 1), False),     # no case: the input of M2-T3's W2b test
}


def fp_distance(fa: list[tuple], fb: list[tuple]) -> float:
    """The largest difference between two fingerprints (inf when compositions differ)."""
    worst = 0.0
    for (ca, da, Da), (cb, db, Db) in zip(fa, fb):
        if ca != cb or len(Da) != len(Db):
            return math.inf
        worst = max(worst, abs(da - db))
        for (sa, la), (sb, lb) in zip(Da, Db):
            if sa != sb:
                return math.inf
            worst = max(worst, max((abs(x - y) for x, y in zip(la, lb)), default=0.0))
    return worst


def robust_noise(A: Analysis, ideal: Analysis) -> None:
    """A noisy bulk keeps the ideal classification with a safe margin (or the seed must change)."""
    assert A.m == ideal.m and len(A.classes) == len(ideal.classes), (A.m, len(A.classes))
    for c in A.classes:
        for k in c["cuts"]:
            d = fp_distance(A.fps[c["rep"]], A.fps[k])
            assert d <= 0.05, f"cut {k} of {c['label']} is {d:.3f} Å from its class"
    for a, b in itertools.combinations(A.classes, 2):
        assert fp_distance(A.fps[a["rep"]], A.fps[b["rep"]]) >= 0.2
    assert A.tau == LAYER_TOLERANCE and A.inner + MARGIN <= 0.25 and min(A.plane_gaps) - MARGIN >= 0.35


class Inputs:
    """The files of ``cleave/inputs/`` with the crystals as written (re-read from the text)."""

    def __init__(self) -> None:
        self.text: dict[str, str] = {}
        self.crystal: dict[str, Crystal] = {}
        self.flags: dict[str, list[list[bool]] | None] = {}
        self.lattice: dict[str, str] = {}
        pt = BULKS["Pt"][1]
        self.add("pt_mp_primitive.vasp", "Pt, standard primitive cell (Materials Project style)",
                 primitive_setting(pt, "Pt"))
        self.add("fe_mp_primitive.vasp", "Fe, standard primitive cell (Materials Project style)",
                 primitive_setting(BULKS["Fe"][1], "Fe"))
        cor = corundum()
        self.add("al2o3_mp_rhombohedral.vasp", "Al2O3 corundum, rhombohedral primitive cell (Materials Project style)",
                 primitive_setting(cor, "Al2O3"))
        self.add("al2o3_hexagonal.vasp",
                 "Al2O3 corundum, hexagonal cell (R-3c, a 4.759 c 12.991, Al z 0.35216, O x 0.30624)",
                 cor, lattice="R")
        self.add("cr2o3_hexagonal.vasp",
                 "Cr2O3 corundum type, hexagonal cell (a 4.959 c 13.594, Cr z 0.3475, O x 0.3058)",
                 cr2o3(), lattice="R")
        self.add("lafeo3_pbnm.vasp", "LaFeO3 Pbnm (a 5.556 b 5.565 c 7.862; La 4c, Fe 4b, O1 4c, O2 8d z 0.0392)",
                 lafeo3())
        self.add("anatase.vasp", "TiO2 anatase I41/amd (a 3.785 c 9.514, O z 0.2081, origin choice 1)", anatase(),
                 lattice="I")
        self.add("sic_2h.vasp", "SiC 2H (AB), ideal tetrahedra, a 3.073, bilayer 2.513", sic("AB"))
        self.add("sic_3c.vasp", "SiC 3C (ACB), hexagonal cell of the rhombohedral lattice, ideal tetrahedra, a 3.073, "
                 "bilayer 2.513", sic("ACB"), lattice="R")
        self.add("sic_4h.vasp", "SiC 4H (ABCB), ideal tetrahedra, a 3.073, bilayer 2.513", sic("ABCB"))
        self.add("sic_6h.vasp", "SiC 6H (ABCACB), ideal tetrahedra, a 3.073, bilayer 2.513", sic("ABCACB"))
        self.add("la_dhcp.vasp", "La double hcp (ABAC), a 3.77 c 12.16", la_dhcp())
        for name, (bulk, sigma, seed, _, _) in NOISE.items():
            base = cor if bulk == "Al2O3" else BULKS[bulk][1]
            self.add(f"{name}.vasp", f"{base.name if bulk == 'Al2O3' else bulk} bulk, Gaussian noise sigma {sigma} A "
                     f"on each Cartesian component, numpy default_rng({seed})", noisy(base, sigma, seed))
        # CONTCAR-like slabs for the vacuum tools (pbc T T T, Selective dynamics, VASP 5 layout)
        self._contcars()

    def add(self, name: str, comment: str, crys: Crystal, flags=None, lattice: str = "P") -> None:
        text = poscar_text(comment, wrapped(crys), flags)
        back, fl = read_poscar(text)
        back.lattice = lattice
        self.text[name], self.crystal[name], self.flags[name], self.lattice[name] = text, back, fl, lattice

    def _contcars(self) -> None:
        A = Analysis(BULKS["Pt"][1], (1, 1, 1))
        # left-handed: Pt(111) p(2x2) 3L with H 1.55 Å above a top Pt, the cell rows a and b swapped (det < 0)
        sy, pos, cell, tags = slab_atoms(A, A.classes[0]["rep"], 3, [[2, 0], [0, 2]], 15.0, ["Pt"])
        top = int(np.argmax(pos[:, 2]))
        sy, pos = sy + ["H"], np.vstack([pos, pos[top] + [0.0, 0.0, 1.55]])
        # flags in the right-handed frame (the bottom layer F F F, the middle layer fixed along a only, so that the
        # expected flags pin the a/b swap of W18), written with the columns of the left-handed cell (a and b swapped)
        flags = [[False] * 3 if t == 3 else [False, True, True] if t == 2 else [True] * 3 for t in tags] + [[True] * 3]
        left = np.array([cell[1], cell[0], cell[2]])
        self.add("contcar_pt111_lefthanded_h.vasp", "Pt(111) p(2x2) 3L + H on top, left-handed cell (a and b swapped)",
                 Crystal("left", sy, pos @ np.linalg.inv(left), left), [[f[1], f[0], f[2]] for f in flags])
        # floating H2: Pt(111) p(2x2) 3L, an H2 molecule (0.74 Å, parallel to the surface) 7.0 Å above the top layer,
        # 13 Å of vacuum above the molecule
        sy, pos, cell, tags = slab_atoms(A, A.classes[0]["rep"], 3, [[2, 0], [0, 2]], 20.0, ["Pt"])
        ztop = pos[:, 2].max()
        h2 = np.array([[1.0, 1.0, ztop + 7.0], [1.74, 1.0, ztop + 7.0]])
        sy, pos = sy + ["H", "H"], np.vstack([pos, h2])
        flags = [[False] * 3 if t == 3 else [True] * 3 for t in tags] + [[True] * 3] * 2
        self.add("contcar_pt111_h2_floating.vasp", "Pt(111) p(2x2) 3L + H2 floating 7.0 A above the slab",
                 Crystal("h2", sy, pos @ np.linalg.inv(cell), cell), flags)
        # the shared CONTCAR fixture with the vacuum along a: cell rows (c, a, b), flags permuted the same way; in the
        # fixture's frame the top layer may only move in-plane (T T F) and the third layer is fixed along a (F T T),
        # so that the expected flags pin the relabelling (W16)
        fixture, fl = read_poscar((DATA / "surface" / "contcar_pt111.vasp").read_text(encoding="utf-8"))
        cell = np.array([fixture.cell[2], fixture.cell[0], fixture.cell[1]])
        frac = fixture.frac[:, [2, 0, 1]]
        fl = [[True, True, False] if 0.3 < f[2] < 0.5 else [False, True, True] if 0.2 < f[2] < 0.3 else row
              for f, row in zip(fixture.frac, fl)]
        flags = [[f[2], f[0], f[1]] for f in fl]
        self.add("contcar_pt111_vacuum_along_a.vasp",
                 "Pt(111) p(3x3) 4L relaxed, cell vectors relabelled so the vacuum is along a",
                 Crystal("a", fixture.symbols, frac, cell), flags)

    def file(self, name: str) -> dict:
        return {"file": f"surface/cleave/inputs/{name}"}


INPUTS = Inputs()


def analysis_input_cases(out: list[dict]) -> None:
    I = INPUTS

    def add(cid: str, name: str, hkl: tuple, note: str, *, args: dict | None = None, primitive: bool = True,
            basis: str = "input", quote=None, **kw) -> Analysis:
        A = Analysis(I.crystal[name], hkl, primitive=primitive)
        if quote:
            quote(A)
        a = {"miller": list(hkl)}
        if basis != "input":
            a["millerBasis"] = basis
        if not primitive:
            a["primitive"] = False
        a.update(args or {})
        e = terms_expect(A, list(hkl), basis=basis, **kw)
        e["primitive"] = primitive
        out.append(terms_case(cid, I.file(name), a, e, note))
        return A

    cor = corundum()
    # Materials Project style primitive cells (M2 §3.1.1, K2): indices stay relative to the input cell
    pt_faces = [
        ((1, 1, 1), [1, 1, 1],
         "(1 1 1) of the primitive cell is the conventional (111): the mesh and period of m2-terms-pt111"),
        ((1, 0, 0), [-1, 1, 1],
         "(1 0 0) of the fcc primitive cell is a {111} plane (conventional (-1 1 1), F0-A §3.14.4)"),
        ((1, 1, 0), [0, 0, 1], "(1 1 0) of the fcc primitive cell is conventional (0 0 1): the square (100) mesh"),
    ]
    for hkl, conv, note in pt_faces:
        A = Analysis(I.crystal["pt_mp_primitive.vasp"], hkl)
        e = terms_expect(A, list(hkl), conventional=("cF", QF), miller_conventional=conv)
        e["primitive"] = True
        out.append(terms_case(f"m2-terms-pt-mp-primitive-{''.join(map(str, hkl))}", I.file("pt_mp_primitive.vasp"),
                              {"miller": list(hkl)}, e, "M2 §3.1.1 (K2), §7.1 Miller row: " + note))
    A = Analysis(I.crystal["pt_mp_primitive.vasp"], (0, 1, 1))
    quote_mesh("Pt primitive, conventional (100)", A, 2.7719, 2.7719, 90.0, period=1.960, period_digits=3)
    e = terms_expect(A, [1, 0, 0], basis="conventional", conventional=("cF", QF), miller_conventional=[1, 0, 0])
    e["primitive"] = True
    out.append(terms_case("m2-terms-pt-mp-conventional-basis-100", I.file("pt_mp_primitive.vasp"),
                          {"miller": [1, 0, 0], "millerBasis": "conventional"}, e,
                          "acceptance E2E-4, M2 §3.1: Conventional basis (1 0 0) = (0 1 1) of the primitive cell: the "
                          "square mesh of Pt(100)"))
    A = Analysis(I.crystal["fe_mp_primitive.vasp"], (0, 0, 1))
    quote_mesh("Fe primitive, conventional (110)", A, 2.4820, 2.4820, 109.47, period=2.0266)
    e = terms_expect(A, [1, 1, 0], basis="conventional", conventional=("cI", QI), miller_conventional=[1, 1, 0])
    e["primitive"] = True
    out.append(terms_case("m2-terms-fe-mp-conventional-basis-110", I.file("fe_mp_primitive.vasp"),
                          {"miller": [1, 1, 0], "millerBasis": "conventional"}, e,
                          "M2 §3.1.1: the bcc primitive cell (cI hint, QI); conventional (1 1 0) = (0 0 1) of this "
                          "cell, the rhombic mesh of Fe(110)"))
    # corundum: hexagonal cell and the rhombohedral primitive cell, (0001) either way
    quote_c = lambda A: (quote_mesh("Al2O3(0001)", A, 4.759, 4.759, 120.0, period=4.3303),  # noqa: E731
                         quote_terms("Al2O3(0001)", A, [("Al·O3", 6, False)], 2, 3, 6))
    A = Analysis(I.crystal["al2o3_hexagonal.vasp"], (0, 0, 1))          # read with the R centring of the file
    quote_c(A)
    e = terms_expect(A, [0, 0, 0, 1])
    e["primitive"] = True
    out.append(terms_case("m2-terms-al2o3-0001", I.file("al2o3_hexagonal.vasp"), {"miller": [0, 0, 0, 1]}, e,
                          "M2 §0.3: corundum (0001) from the 30-atom hexagonal cell, reduced to the rhombohedral "
                          "primitive cell: period c/3 = 4.3303 Å, O3 | Al | Al (0.489 Å) twice per period; Al·O3 "
                          "(single Al, 6 bonds, non-polar) first, then Al·Al and O3 (6 bonds each, polar; Al on top "
                          "first by K7); Tasker 2"))
    rh = I.crystal["al2o3_mp_rhombohedral.vasp"]
    A = Analysis(rh, (1, 1, 1))
    quote_c(A)
    e = terms_expect(A, [1, 1, 1], conventional=("hR", QR), miller_conventional=[0, 0, 1])
    e["primitive"] = True
    out.append(terms_case("m2-terms-al2o3-rhombohedral-111", I.file("al2o3_mp_rhombohedral.vasp"),
                          {"miller": [1, 1, 1]}, e,
                          "M2 §3.1.1: rhombohedral (1 1 1) = hexagonal (0 0 1) = (0001); the hint is hR (QR) and hkil "
                          "comes from the conventional indices"))
    e = terms_expect(A, [0, 0, 0, 1], basis="conventional", conventional=("hR", QR), miller_conventional=[0, 0, 1])
    e["primitive"] = True
    out.append(terms_case("m2-terms-al2o3-rhombohedral-conventional-basis-0001", I.file("al2o3_mp_rhombohedral.vasp"),
                          {"miller": [0, 0, 0, 1], "millerBasis": "conventional"}, e,
                          "M2 §7.1 Miller row: the Conventional basis with (0 0 0 1) on the MP rhombohedral cell gives "
                          "the mesh and terminations of the hexagonal cell's (0001) (m2-terms-al2o3-0001)"))
    A = Analysis(I.crystal["cr2o3_hexagonal.vasp"], (0, 0, 1))
    check_quote("Cr2O3 grouping", A.grouping, "planes")
    check_quote("Cr2O3 tau", A.tau, 0.30, 2)
    check_quote("Cr2O3 M-M gap", round(min(A.gaps_below), 3), 0.385)
    check_quote("Cr2O3 tilt", round(min(t for t in A.tilts if t is not None)), 41)
    quote_terms("Cr2O3(0001)", A, None, 2, 3, 6)
    e = terms_expect(A, [0, 0, 0, 1])
    e["primitive"] = True
    out.append(terms_case("m2-terms-cr2o3-0001", I.file("cr2o3_hexagonal.vasp"), {"miller": [0, 0, 0, 1]}, e,
                          "M2 §0.3 and §7.1 (layers and merging): the Cr2O3-type corundum keeps 6 planes per period: "
                          "its 0.385 Å Cr-Cr gap is crossed by Cr-O bonds tilted about 41° (more than 15°), so it "
                          "is not merged; layer tolerance 0.30 Å, three terminations, Tasker 2"))
    # rumpled layers, polytypes
    add("m2-terms-lafeo3-001", "lafeo3_pbnm.vasp", (0, 0, 1),
        "M2 §0.3 K5: the FeO2 planes are rumpled by 0.308 Å (O2 z = 0.0392 c) and merged: La2O2 | Fe2O4 twice per "
        "7.862 Å, layer tolerance 0.0392 c + 0.01 = 0.318 Å; Fe2O4 (8 bonds) first, both polar (Tasker 3)",
        quote=lambda A: (quote_mesh("LaFeO3(001)", A, 5.556, 5.565, 90.0, period=7.862, period_digits=3),
                         check_quote("LaFeO3 tau", A.tau, 0.318, 3),
                         check_quote("LaFeO3 grouping", A.grouping, "merged"),
                         quote_terms("LaFeO3(001)", A, [("Fe2O4", 8, True)], 3, 2, 4)))
    add("m2-terms-anatase-001", "anatase.vasp", (0, 0, 1),
        "M2 §0.3 K5: anatase (001): O-Ti-O sub-planes 0.40 Å apart merged into one TiO2 layer, two per period c/2 = "
        "4.757 Å, layer tolerance 0.409 Å; one termination (2 bonds), Tasker 1",
        quote=lambda A: (check_quote("anatase(001) period", A.period, 4.757, 3),
                         check_quote("anatase(001) tau", A.tau, 0.409, 3),
                         check_quote("anatase grouping", A.grouping, "merged"),
                         quote_terms("anatase(001)", A, [("TiO2", 2, False)], 1, 1, 2)))
    add("m2-terms-anatase-101", "anatase.vasp", (1, 0, 1),
        "M2 §0.3: anatase (101): O | TiO | TiO | O per 3.517 Å, four terminations, O·TiO (2 bonds) first, Tasker 2; "
        "the centred-rectangular mesh 3.785 × 5.458 Å at 110.29° (2|u·v| = |u|²: M1's reduction keeps the short "
        "vector first, M1 §3.11.1)",
        quote=lambda A: (check_quote("anatase(101) period", A.period, 3.517, 3),
                         check_quote("anatase(101) tau", A.tau, 0.30, 2),
                         check_quote("anatase(101) mesh type", A.mesh["type"], "centred-rectangular"),
                         quote_terms("anatase(101)", A, [("O·TiO", 2, False)], 2, 4, 4)))
    for name, seq, m in (("sic_2h.vasp", "2h", 4), ("sic_3c.vasp", "3c", 2)):
        add(f"m2-terms-sic-{seq}-0001", name, (0, 0, 1),
            f"M2 §0.3 and §7.1 (SiC 2H/3C/4H/6H: 2/2/4/6 classes): SiC {seq.upper()} (0001): {m} planes per period"
            + (" (the hexagonal cell reduces to the rhombohedral primitive cell, one bilayer per period)"
               if seq == "3c" else "")
            + ", two terminations: Si on top (1 bond per cell) and C (3), both polar",
            quote=lambda A, m=m: (check_quote("SiC tau", A.tau, 0.30, 2),
                                  check_quote("SiC grouping", A.grouping, "planes"),
                                  quote_terms("SiC", A, [("Si", 1, True), ("C", 3, True)], 3, 2, m)))
    for name, seq, count, m in (("sic_4h.vasp", "4h", 4, 8), ("sic_6h.vasp", "6h", 6, 12)):
        add(f"m2-terms-sic-{seq}-0001", name, (0, 0, 1),
            f"M2 §0.3: SiC {seq.upper()} (0001): {m} planes per period, {count} terminations (two cut types × "
            f"{count // 2} stacking sites, "
            "the second fingerprint level separates them); ties in the K7 key keep the labels in sort order (Si-A, "
            "Si-B, ...)",
            quote=lambda A, count=count, m=m: quote_terms("SiC", A, None, 3, count, m))
    add("m2-terms-la-dhcp-0001", "la_dhcp.vasp", (0, 0, 1),
        "M2 §0.3, §3.18: double-hcp La (ABAC): the first fingerprint level gives one class, the second two "
        "(La-A, La-B)",
        quote=lambda A: quote_terms("La dhcp", A, None, 1, 2, 4))
    # noisy bulks (M2 §7.1 "noisy bulks": the classification of the ideal bulk survives)
    for name, (bulk, sigma, seed, hkl, prim) in NOISE.items():
        if name == "al2o3_noise_0.02":
            continue
        base = cor if bulk == "Al2O3" else BULKS[bulk][1]
        ideal = Analysis(base, hkl, primitive=prim)
        A = Analysis(I.crystal[f"{name}.vasp"], hkl, primitive=prim)
        robust_noise(A, ideal)
        e = terms_expect(A, list(hkl))
        e["primitive"] = prim
        # noise moves the gaps and the dipoles: keep the geometry of the cell and what does not depend on them
        for key in ("gapsBelow", "topIndices", "stack"):
            e.pop(key, None)
        neutral = all(abs(L["charge"]) <= 1e-9 for L in A.layers)
        if not neutral:
            for key in ("labels", "brokenBonds", "polar", "tasker"):
                e.pop(key)
        args = {"miller": list(hkl)}
        if not prim:
            args["primitive"] = False
        what = ("the classification" if neutral
                else "the number of terminations (the polar flags follow the noisy dipoles)")
        out.append(terms_case(f"m2-terms-{name.replace('_', '-')}", I.file(f"{name}.vasp"), args, e,
                              f"M2 §7.1 noisy bulks: σ = {sigma} Å Gaussian noise (seed {seed}) keeps {what} of the "
                              f"ideal bulk; "
                              "every equivalent cut stays within 0.05 Å of its class"))


def analysis_error_cases(out: list[dict]) -> None:
    def err(cid: str, inp: dict, args: dict, text: str, note: str) -> None:
        out.append({"id": cid, "op": "terminations", "args": args, "input": inp, "expect": {"error": text},
                    "skip": skip(TERMS_SKIP), "note": note})

    graphene = recipe("graphene", ["C"], 2.46, 15.0)
    err("m2-terms-graphene-not-periodic", graphene, {"miller": [0, 0, 1]},
        "cleaving needs a structure that is periodic along a, b and c (this one is periodic along a and b only)",
        "M2 §3.20 E2 (acceptance S13 step 2): only the declared pbc is read, no slab detection (U1)")
    err("m2-terms-four-indices-cubic", BULKS["Pt"][0], {"miller": [1, 1, -2, 1]},
        "four-index (h k i l) notation needs a hexagonal cell with γ = 120°", "M2 §3.20 E4 (M2's own sentence)")
    err("m2-terms-four-indices-wrong-i", BULKS["ZnO"][0], {"miller": [1, 0, 0, 0]},
        "in (h k i l), i must be −(h + k) = -1",
        "acceptance S11, F0 ledger L-F0-46/47: the F0-A miller text (U+2212 in the formula, ASCII minus in the "
        "number); matched by substring")
    err("m2-terms-zero-indices", BULKS["Pt"][0], {"miller": [0, 0, 0]}, "(0 0 0) is not a plane",
        "F0 ledger L-F0-47 miller text, matched by substring")
    err("m2-terms-conventional-basis-not-centred", BULKS["Pt"][0], {"miller": [1, 0, 0], "millerBasis": "conventional"},
        "conventional indices need a standard primitive cell of a centred lattice; this cell is not one, so enter "
        "indices for this cell",
        "M2 §3.20 E4b: the 4-atom cubic cell is already conventional (no hint)")


# =============================================================================================== slab cases
W8 = "the slab is not stoichiometric: {comp} per cell (bulk {bulk}), excess {excess}"
W9_ZNO = "the slab is polar: dipole 9.83 e·Å per cell (1.07 e/Å), from formal charges Zn +2, O -2"


def embed(S: list[list[int]]) -> list[list[int]]:
    return [[S[0][0], S[0][1], 0], [S[1][0], S[1][1], 0], [0, 0, 1]]


def surface_case(cid: str, inp: dict, args: dict, expect: dict, note: str) -> dict:
    return {"id": cid, "op": "surface", "args": args, "input": inp, "expect": expect, "tol": TOL,
            "skip": skip(SURFACE_SKIP), "note": note}


def slab_expect(s: Slab, A: Analysis, bulk: Crystal, bulk_info: dict | None, *, name: str, miller_input: list[int],
                spec: dict, auto: bool = True, supercell: list[list[int]] | None = None,
                fixed: dict | None = None, warnings: dict | None = None, position: str = "center",
                offset: float = 0.0, conventional: list[int] | None = None) -> dict:
    """The expectations of an op ``surface`` case (README.md, "Op surface")."""
    v = s.vacuum
    props: dict[str, Any] = {"tags": s.tags, "adsorbate_id": None,
                             "selective_dynamics": s.flags if s.fixed_layers else None}
    info: dict[str, Any] = {"source": "builder:surface", "spacegroup": None, "spacegroupNumber": None,
                            "supercellMatrix": embed(supercell) if supercell else None}
    st: dict[str, Any] = {"name": name, "pbc": [True, True, True], "symbols": s.symbols, "props": props, "info": info}
    if s.cell is not None:
        st["cell"] = [[r9(x) for x in row] for row in s.cell]
    hexa = is_hexagonal(bulk.cell)
    cls = A.classes[s.termination]
    e: dict[str, Any] = {"structure": st, "warnings": warnings or {"equals": []},
                         "zRange": [r9(z) for z in s.z_range]}
    if v == 0:
        e["volume"] = r9(s.volume)
        e["minDistance"] = r9(A.d_min)
    sf = {
        "version": 2, "kind": "cleave", "autoName": name if auto else None, "miller": list(A.miller),
        "millerBasis": "input", "primitive": True, "translationTolerance": 0.05,
        "bulkNormal": [r6(x) for x in A.normal], "normal": [0, 0, 1], "axis": 2,
        "period": r6(A.period), "layersPerPeriod": A.m, "layerTolerance": r6(A.tau), "layerGrouping": A.grouping,
        "meshParams": {"a": r6(A.mesh["a"]), "b": r6(A.mesh["b"]), "gamma": r6(A.mesh["gamma"]),
                       "area": r6(A.mesh["area"]), "type": A.mesh["type"]},
        "termination.index": s.termination, "termination.count": len(A.classes), "termination.label": cls["label"],
        "termination.top": s.top_label, "termination.bottom": s.bottom_label,
        "termination.topComposition": dict(sorted(s.layer_comps[-1].items())),
        "termination.bottomComposition": dict(sorted(s.layer_comps[0].items())),
        "termination.brokenBonds": cls["broken"], "termination.polar": bool(cls["polar"]), "tasker": A.tasker,
        "layers": s.L, "thicknessSpec": spec, "thickness": r6(s.thickness), "vacuum": float(v),
        "stacking": "vacuum" if v > 0 else "bulk", "position": position, "offset": float(offset),
        "symmetric": s.symmetric, "symmetryCheck": "fingerprint", "flipped": False,
        "asBuilt.composition": dict(sorted(s.composition.items())), "asBuilt.stoichiometric": s.stoichiometric,
        "asBuilt.excess": s.excess, "asBuilt.polarity.polar": abs(s.dipole) / A.area > POLAR_THRESHOLD,
        "asBuilt.polarity.netCharge": float(s.net_charge * s.det),
        # M2 §3.9.2: the dipole about the middle of the slab, per cell (e·Å), and per area (e/Å)
        "asBuilt.polarity.dipole": r6(s.dipole * s.det) + 0.0,
        "asBuilt.polarity.dipoleDensity": r6(s.dipole / A.area) + 0.0,
        "bulk.formula": formula(dict(Counter(bulk.symbols))), "bulk.reducedFormula": s.bulk_formula,
        "bulk.natoms": len(bulk), "bulk.cell": [[r6(x) for x in row] for row in bulk.cell],
    }
    if hexa:
        sf["hkil"] = hkil_of(A.miller)
    if list(miller_input) != list(A.miller):
        sf["millerInput"] = list(miller_input)
    if conventional:
        sf["millerConventional"] = conventional
    if bulk_info:
        sf["bulk.spacegroup"] = bulk_info["spacegroup"]
        sf["bulk.source"] = bulk_info["source"]
    if supercell:
        sf["asBuilt.supercell"] = supercell
    if fixed:
        sf["asBuilt.fixed"] = fixed
    e.update({f"surface.{k}": val for k, val in sf.items()})
    return e


def slab_cases() -> dict[str, list[dict]]:
    files: dict[str, list[dict]] = {"slab/metals.json": [], "slab/oxides.json": [], "slab/vacuum.json": [],
                                    "slab/errors.json": []}
    metals, oxides, vac, errors = (files[k] for k in files)

    def add(lst: list, cid: str, bulk: str, hkl: tuple, note: str, *, name: str, mesh: str = "",
            supercell: list[list[int]] | None = None, sc_arg: Any = None, termination: int | str = 0,
            layers: int | None = None, periods: int | None = None, symmetric: bool = False, vacuum: float = 15.0,
            fix_bottom: int = 0, fix_middle: int = 0, fix_axes: str = "abc", warnings: dict | None = None,
            quote=None, override: str | None = None, keys: set | None = None, file: str | None = None,
            conventional: list[int] | None = None, a_hkl: tuple | None = None) -> Slab:
        if file:
            crys = INPUTS.crystal[file]
            inp, binfo = INPUTS.file(file), None
        else:
            inp, crys = BULKS[bulk]
            proto = inp["recipe"]["args"]["prototype"]
            binfo = {"spacegroup": SPACEGROUP[proto], "source": f"builder:{proto}"}
        A = Analysis(crys, a_hkl or hkl)
        t = termination if isinstance(termination, int) else next(
            i for i, c in enumerate(A.classes) if c["label"] == termination)
        s = Slab(A, crys.symbols, termination=t, layers=layers, periods=periods, symmetric=symmetric, vacuum=vacuum,
                 S=supercell, fix_bottom=fix_bottom, fix_middle=fix_middle, fix_axes=fix_axes)
        s.symmetric = symmetric
        idx = conventional or (hkil_of(A.miller) if is_hexagonal(crys.cell) else list(A.miller))
        formula_bulk = s.bulk_formula
        auto_name = s.name(formula_bulk, idx, mesh)
        check_quote(f"{cid} name", auto_name, name if override is None else name)
        args: dict[str, Any] = {"miller": list(hkl), "vacuum": vacuum}
        for key, val in (("layers", layers), ("periods", periods)):
            if val is not None:
                args[key] = val
        if termination != 0:
            args["termination"] = termination
        if symmetric:
            args["symmetric"] = True
        if sc_arg is not None:
            args["supercell"] = sc_arg
        elif supercell is not None:
            args["supercell"] = supercell
        if fix_bottom:
            args["fixBottom"] = fix_bottom
        if fix_middle:
            args["fixMiddle"] = fix_middle
        if fix_axes != "abc":
            args["fixAxes"] = fix_axes
        if override:
            args["name"] = override
        mode = ("periods", periods) if periods else (("layers", layers) if layers else ("default", 4))
        fixed = None
        if fix_bottom or fix_middle:
            fixed = {"layers": fix_bottom or fix_middle, "from": "bottom" if fix_bottom else "middle", "axes": fix_axes}
        e = slab_expect(s, A, crys, binfo, name=override or name, miller_input=list(hkl), auto=override is None,
                        spec={"mode": mode[0], "value": mode[1]}, supercell=supercell, fixed=fixed, warnings=warnings,
                        conventional=conventional)
        if keys is not None:            # a short case: only these expectations
            e = {k: v for k, v in e.items() if k in keys}
            if "structure" in e:
                e["structure"] = {k: v for k, v in e["structure"].items() if k in ("name", "symbols", "pbc")}
        if quote:
            quote(s)
        lst.append(surface_case(cid, inp, args, e, note))
        return s

    def q(cid: str, **vals: float):
        def check(s: Slab) -> None:
            got = {"natoms": len(s.symbols), "thickness": s.thickness, "c": s.cell[2][2] if s.cell else None,
                   "a": s.mesh[0], "b": s.mesh[1], "gamma": s.mesh[2], "zmin": s.z_range[0], "zmax": s.z_range[1],
                   "volume": s.volume}
            for k, v in vals.items():
                if k == "natoms":
                    check_quote(f"{cid} {k}", got[k], v)
                else:
                    check_quote(f"{cid} {k}", got[k], v, 4 if k != "gamma" else 2, 1e-4 if k != "gamma" else 0.01)
        return check

    short = {"structure", "zRange", "surface.autoName", "surface.layers"}
    # ---------------------------------------------------------------------------------------------- metals
    add(metals, "m2-slab-pt111-p3x3-4l-fix2", "Pt", (1, 1, 1),
        "acceptance S1-2 to S1-4: 36 atoms, 4 layers of 9, 2.2632 Å apart; a = b = 8.3156 Å at 120°, c = 6.7896 + 15 Å "
        "along z; layers at z = 7.5 ... 14.2896 Å (centred, U4-d); the bottom two layers fixed (18 × F F F); supercell "
        "given as the diagonal shorthand [3, 3]",
        name="Pt(111) p(3×3) 4L", mesh="p(3×3)", supercell=[[3, 0], [0, 3]], sc_arg=[3, 3], layers=4, fix_bottom=2,
        quote=q("S1", natoms=36, a=8.3156, b=8.3156, gamma=120.0, c=21.7896, thickness=6.7896, zmin=7.5, zmax=14.2896))
    add(metals, "m2-slab-pt111-p3x3-text", "Pt", (1, 1, 1),
        "ledger L-M2-02: the surface supercell given as text (M1 surface_mesh_matrix) gives the same slab and name",
        name="Pt(111) p(3×3) 4L", mesh="p(3×3)", supercell=[[3, 0], [0, 3]], sc_arg="p(3×3)", keys=short)
    add(metals, "m2-slab-pt111-4l", "Pt", (1, 1, 1),
        "U4-e: no thickness given = 4 layers; no supercell (no supercellMatrix), nothing fixed (no selective_dynamics)",
        name="Pt(111) 4L", quote=q("Pt(111) 4L", natoms=4, thickness=6.7896, c=21.7896))
    add(metals, "m2-slab-pt111-named", "Pt", (1, 1, 1),
        "ledger L-X-07: a name given with name= replaces the automatic one and autoName is null",
        name="Pt(111) 4L", override="my slab", keys={"structure", "surface.autoName"})
    add(metals, "m2-slab-pt-mp-primitive-100", "Pt", (1, 0, 0),
        "ledger L-X-07: (1 0 0) of a Materials Project primitive cell is conventional (-1 1 1), so the name says "
        "Pt(-111)",
        name="Pt(-111) 4L", file="pt_mp_primitive.vasp", conventional=[-1, 1, 1],
        keys={"structure", "zRange", "surface.miller", "surface.millerConventional", "surface.autoName",
              "surface.meshParams"})
    add(metals, "m2-slab-cu100-4l-fix2", "Cu", (1, 0, 0),
        "acceptance S2-2: 4 atoms, c = 5.4225 + 15 Å, the bottom two fixed",
        name="Cu(100) 4L", layers=4, fix_bottom=2, quote=q("S2-2", natoms=4, c=20.4225, thickness=5.4225))
    add(metals, "m2-slab-cu100-c2x2", "Cu", (1, 0, 0),
        "acceptance S2-3, lead decision L-19: c(2×2) = [[1, 1], [-1, 1]] on the 1×1 mesh: 8 atoms, a = b = 3.6150 Å, "
        "the name from the matrix (Wood label), not the preset label; supercellMatrix relative to the 1×1 slab",
        name="Cu(100) (√2×√2)R45° 4L", mesh="(√2×√2)R45°", supercell=[[1, 1], [-1, 1]], fix_bottom=2,
        quote=q("S2-3", natoms=8, a=3.6150, b=3.6150, gamma=90.0, c=20.4225))
    add(metals, "m2-slab-cu100-c2x2-text", "Cu", (1, 0, 0),
        "lead decision L-19: the preset text c(2×2) gives the same name (the matrix of the preset is M1's)",
        name="Cu(100) (√2×√2)R45° 4L", mesh="(√2×√2)R45°", supercell=[[1, 1], [-1, 1]], sc_arg="c(2×2)",
        keys={"structure", "surface.autoName"})
    add(metals, "m2-slab-ag111-4l-fix2-c", "Ag", (1, 1, 1),
        "acceptance S3-1: 4 atoms, thickness 7.0841 Å, c = 22.0841 Å; the bottom two layers fixed along c only (T T F)",
        name="Ag(111) 4L", layers=4, fix_bottom=2, fix_axes="c", quote=q("S3-1", natoms=4, thickness=7.0841, c=22.0841))
    add(metals, "m2-slab-ag111-sqrt3", "Ag", (1, 1, 1),
        "acceptance S3-2: (√3×√3)R30° = [[2, 1], [-1, 1]]: 12 atoms, a = b = 5.0092 Å at 120°, 6 atoms T T F",
        name="Ag(111) (√3×√3)R30° 4L", mesh="(√3×√3)R30°", supercell=[[2, 1], [-1, 1]], fix_bottom=2, fix_axes="c",
        quote=q("S3-2", natoms=12, a=5.0092, b=5.0092, gamma=120.0))
    add(metals, "m2-slab-ag111-sqrt3-text", "Ag", (1, 1, 1),
        "M2 K17: the Wood text gives the same slab and name as the matrix", name="Ag(111) (√3×√3)R30° 4L",
        mesh="(√3×√3)R30°", supercell=[[2, 1], [-1, 1]], sc_arg="(√3×√3)R30°", keys=short)
    add(metals, "m2-slab-ru0001-p2x2-4l-fix2", "Ru", (0, 0, 0, 1),
        "acceptance S4-2: four indices; 16 atoms, a = b = 5.4200 Å, thickness 6.4200 Å, c = 21.4200 Å, 4 layers of 4, "
        "8 fixed",
        name="Ru(0001) p(2×2) 4L", mesh="p(2×2)", supercell=[[2, 0], [0, 2]], sc_arg=[2, 2], layers=4, fix_bottom=2,
        quote=q("S4-2", natoms=16, a=5.4200, thickness=6.4200, c=21.4200))
    add(metals, "m2-slab-pt110-p2x2-6l-fix3", "Pt", (1, 1, 0),
        "acceptance S5-2: 24 atoms, a = 5.5437, b = 7.8400 Å, thickness 6.9296 Å, c = 21.9296 Å, 6 layers of 4, 12 "
        "fixed",
        name="Pt(110) p(2×2) 6L", mesh="p(2×2)", supercell=[[2, 0], [0, 2]], sc_arg=[2, 2], layers=6, fix_bottom=3,
        quote=q("S5-2", natoms=24, a=5.5437, b=7.8400, thickness=6.9296, c=21.9296))
    add(metals, "m2-slab-pt211-12l", "Pt", (2, 1, 1),
        "acceptance S6-2: 12 atoms, 12 layers of 1, thickness 8.8018 Å, c = 23.8018 Å",
        name="Pt(211) 12L", layers=12, quote=q("S6-2", natoms=12, thickness=8.8018, c=23.8018))
    add(metals, "m2-slab-fe110-p2x2-4l", "Fe", (1, 1, 0),
        "acceptance S7-2: 16 atoms, a = b = 4.9641 Å at 109.47°, thickness 6.0797 Å, c = 21.0797 Å",
        name="Fe(110) p(2×2) 4L", mesh="p(2×2)", supercell=[[2, 0], [0, 2]], sc_arg=[2, 2], layers=4,
        quote=q("S7-2", natoms=16, a=4.9641, gamma=109.47, thickness=6.0797, c=21.0797))
    # ---------------------------------------------------------------------------------------------- oxides
    add(oxides, "m2-slab-tio2-110-p2x1-3periods", "TiO2", (1, 1, 0),
        "acceptance S8-3: 3 periods = 9 layers O2/Ti4O4/O2 ...; 36 atoms Ti12O24, a = 5.9180, b = 6.4969 Å, thickness "
        "9.0307 Å, c = 24.0307 Å; stoichiometric and symmetric (bridging O on both faces)",
        name="TiO2(110) p(2×1) O·Ti2O2-term 9L", mesh="p(2×1)", supercell=[[2, 0], [0, 1]], sc_arg=[2, 1], periods=3,
        quote=q("S8-3", natoms=36, a=5.9180, b=6.4969, thickness=9.0307, c=24.0307))
    add(oxides, "m2-slab-tio2-110-4l", "TiO2", (1, 1, 0),
        "M2 §3.10: the default 4 layers of TiO2(110) are 1⅓ periods: Ti2O5, 3.25 Å, not stoichiometric, polar and "
        "charged (W8, W9, W10); the bottom face is the O·O face",
        name="TiO2(110) O·Ti2O2/O·O-term 4L",
        warnings={"contains": [W8.format(comp="Ti2O5", bulk="TiO2", excess="O"), "the slab is polar: dipole ",
                               "the slab has a net formal charge of -2 per cell"], "count": 3},
        quote=q("TiO2(110) 4L", natoms=7, thickness=3.2484))
    add(oxides, "m2-slab-tio2-110-ti2o2-symmetric", "TiO2", (1, 1, 0),
        "M2 §7.1 (symmetric: Ti2O2 termination 9 -> 10 layers) and §3.9.2 (Q = +4): 22 atoms Ti8O14, W8 and W10",
        name="TiO2(110) Ti2O2-term 10L", termination="Ti2O2", layers=9, symmetric=True,
        warnings={"contains": [W8.format(comp="Ti8O14", bulk="TiO2", excess="Ti"),
                               "the slab has a net formal charge of +4 per cell"], "count": 2},
        quote=q("Ti2O2 10L", natoms=22))
    add(oxides, "m2-slab-srtio3-001-tio2-sym7", "SrTiO3", (0, 0, 1),
        "acceptance S9-2: TiO2 on both faces, 18 atoms Sr3Ti4O11, thickness 11.7150 Å, c = 26.7150 Å, excess TiO2 (W8)",
        name="SrTiO3(001) TiO2-term 7L", termination="TiO2", layers=7, symmetric=True,
        warnings={"equals": [W8.format(comp="Sr3Ti4O11", bulk="SrTiO3", excess="TiO2")]},
        quote=q("S9-2", natoms=18, thickness=11.7150, c=26.7150))
    add(oxides, "m2-slab-srtio3-001-tio2-sym7-fix-middle3", "SrTiO3", (0, 0, 1),
        "acceptance S9-5 (cleave path, M2 K13): the middle 3 layers (TiO2, SrO, TiO2) fixed: 8 atoms Ti2SrO5",
        name="SrTiO3(001) TiO2-term 7L", termination="TiO2", layers=7, symmetric=True, fix_middle=3,
        warnings={"equals": [W8.format(comp="Sr3Ti4O11", bulk="SrTiO3", excess="TiO2")]})
    add(oxides, "m2-slab-srtio3-001-sro-sym7", "SrTiO3", (0, 0, 1),
        "acceptance S9-3: SrO on both faces, 17 atoms Sr4Ti3O10, excess SrO",
        name="SrTiO3(001) SrO-term 7L", termination="SrO", layers=7, symmetric=True,
        warnings={"equals": [W8.format(comp="Sr4Ti3O10", bulk="SrTiO3", excess="SrO")]}, quote=q("S9-3", natoms=17))
    add(oxides, "m2-slab-srtio3-001-8l", "SrTiO3", (0, 0, 1),
        "acceptance S9-4: 4 periods, TiO2 on top and SrO at the bottom: 20 atoms Sr4Ti4O12, thickness 13.6675 Å, "
        "stoichiometric",
        name="SrTiO3(001) TiO2/SrO-term 8L", termination="TiO2", layers=8,
        quote=q("S9-4", natoms=20, thickness=13.6675))
    add(oxides, "m2-slab-srtio3-001-sym-8-to-9", "SrTiO3", (0, 0, 1),
        "M2 §7.1 (symmetric: SrTiO3 7 -> 7 and 8 -> 9 layers): 8 layers requested, 9 built (TiO2 on both faces)",
        name="SrTiO3(001) TiO2-term 9L", layers=8, symmetric=True,
        warnings={"equals": [W8.format(comp="Sr4Ti5O14", bulk="SrTiO3", excess="TiO2")]}, quote=q("8->9", natoms=23))
    add(oxides, "m2-slab-ceo2-111-3periods", "CeO2", (1, 1, 1),
        "acceptance S10-3: 3 periods = 9 layers O/Ce/O; 9 atoms Ce3O6, thickness 7.8101 Å, c = 22.8101 Å, O on both "
        "faces",
        name="CeO2(111) O·Ce-term 9L", periods=3, quote=q("S10-3", natoms=9, thickness=7.8101, c=22.8101))
    add(oxides, "m2-slab-zno-10-10-6l", "ZnO", (1, 0, -1, 0),
        "acceptance S11-1, S11-4: four indices stored as miller (1 0 0) with hkil and millerInput; 12 atoms Zn6O6, "
        "thickness 6.5674 Å, c = 21.5674 Å",
        name="ZnO(10-10) ZnO-A-term 6L", layers=6, quote=q("S11-4", natoms=12, thickness=6.5674, c=21.5674))
    add(oxides, "m2-slab-zno-10-10-4l", "ZnO", (1, 0, -1, 0), "acceptance S11-6: 4 layers are 3.7528 Å thick (8 atoms)",
        name="ZnO(10-10) ZnO-A-term 4L", layers=4, quote=q("S11-6", natoms=8, thickness=3.7528))
    add(oxides, "m2-slab-zno-10-10-8l", "ZnO", (1, 0, -1, 0),
        "acceptance S11-6: 8 layers are 9.3819 Å thick (16 atoms)",
        name="ZnO(10-10) ZnO-A-term 8L", layers=8, quote=q("S11-6 8L", natoms=16, thickness=9.3819))
    add(oxides, "m2-slab-zno-0001-4periods", "ZnO", (0, 0, 0, 1),
        "M2 §0.3 and §3.20 W9: Zn on top, O at the bottom, 16 layers 18.839 Å thick, dipole 9.83 e·Å per cell (1.07 "
        "e/Å)",
        name="ZnO(0001) Zn/O-term 16L", periods=4,
        warnings={"equals": [W9_ZNO]},
        quote=q("ZnO(0001) 16L", natoms=16, thickness=18.8389))
    add(oxides, "m2-slab-nacl-100-4l", "NaCl", (1, 0, 0),
        "acceptance S12-2: 8 atoms Na4Cl4, 4 layers 2.8200 Å apart, thickness 8.4600 Å, c = 23.4600 Å",
        name="NaCl(100) 4L", quote=q("S12-2", natoms=8, thickness=8.4600, c=23.4600))
    add(oxides, "m2-slab-nacl-111-na-sym5", "NaCl", (1, 1, 1),
        "M2 §7.1 (symmetric: NaCl(111) 5 layers, net charge ±1, dipole 0): Na on both faces, Na3Cl2, W8 and W10",
        name="NaCl(111) Na-term 5L", termination="Na", layers=5, symmetric=True,
        warnings={"contains": [W8.format(comp="Na3Cl2", bulk="NaCl", excess="Na"),
                               "the slab has a net formal charge of +1 per cell"], "count": 2},
        quote=q("NaCl(111) 5L", natoms=5))
    add(oxides, "m2-slab-lafeo3-001-4l", "", (0, 0, 1),
        "M2 §0.3: with the rumpled FeO2 layers merged, the default 4 layers are one period: 20 atoms, 6.20 Å, "
        "stoichiometric, polar",
        name="LaFeO3(001) Fe2O4/La2O2-term 4L", file="lafeo3_pbnm.vasp",
        warnings={"contains": ["the slab is polar: dipole "], "count": 1}, quote=q("LaFeO3 4L", natoms=20))
    # ------------------------------------------------------------------------------ vacuum 0 and small vacuum
    for cid, bulk, hkl, kw, name, dmin, note in [
        ("m2-slab-nacl-100-v0", "NaCl", (1, 0, 0), {"layers": 4}, "NaCl(100) 4L", 2.8200,
         "acceptance S12-4 (U4: 0 is allowed): the bulk stacking continues; cell volume 179.41 Å³ = 5.64³, shortest "
         "distance 2.82 Å"),
        ("m2-slab-pt111-4l-v0", "Pt", (1, 1, 1), {"layers": 4}, "Pt(111) 4L", 2.772,
         "M2 §0.3 (V = 0): 4 layers = 4 periods, shortest distance as in the bulk (2.772 Å)"),
        ("m2-slab-pt111-3l-v0", "Pt", (1, 1, 1), {"layers": 3}, "Pt(111) 3L", 2.772, "M2 §0.3 (V = 0): Pt(111) 3L"),
        ("m2-slab-pt100-4l-v0", "Pt", (1, 0, 0), {"layers": 4}, "Pt(100) 4L", 2.772, "M2 §0.3 (V = 0): Pt(100) 4L"),
        ("m2-slab-srtio3-8l-v0", "SrTiO3", (0, 0, 1), {"layers": 8}, "SrTiO3(001) TiO2/SrO-term 8L", 1.952,
         "M2 §0.3 (V = 0): SrTiO3 8L, shortest distance 1.952 Å"),
        ("m2-slab-tio2-110-3periods-v0", "TiO2", (1, 1, 0), {"periods": 3}, "TiO2(110) O·Ti2O2-term 9L", 1.948,
         "M2 §0.3 (V = 0): TiO2(110) 3 periods, shortest distance 1.948 Å"),
        ("m2-slab-ceo2-111-3periods-v0", "CeO2", (1, 1, 1), {"periods": 3}, "CeO2(111) O·Ce-term 9L", 2.343,
         "M2 §0.3 (V = 0): CeO2(111) 3 periods, shortest distance 2.343 Å"),
        ("m2-slab-zno-0001-4periods-v0", "ZnO", (0, 0, 0, 1), {"periods": 4}, "ZnO(0001) Zn/O-term 16L", 1.974,
         "M2 §0.3 (V = 0): ZnO(0001) 4 periods, shortest distance 1.974 Å; the polarity record as at 15 Å, the "
         "warnings not compared (whether W9 applies to the bulk stacking is open, README decision 10)"),
    ]:
        s = add(vac, cid, bulk, hkl, note, name=name, vacuum=0.0, **kw)
        # open for the lead (README decision 10): whether W8-W10 apply to the bulk stacking, which is 3D-periodic
        # (it is oriented_cell).  Whole periods are stoichiometric and neutral, so only a polar stacking (ZnO) would
        # warn: its warnings are left out, and the other V = 0 cases expect none either way.  position and offset
        # have no effect at V = 0 and are not compared.
        e = vac[-1]["expect"]
        polar = abs(s.dipole) / s.A.area > POLAR_THRESHOLD
        assert s.stoichiometric and abs(s.net_charge) < 1e-9 and polar == (bulk == "ZnO")
        for key in ("surface.position", "surface.offset") + (("warnings",) if polar else ()):
            del e[key]
        check_quote(f"{cid} shortest distance", s.A.d_min, dmin, 3, 1e-3)
        check_quote(f"{cid} volume", s.volume, s.L / s.A.m * abs(np.linalg.det(s.A.Pm)), 9)
    check_quote("S12-4 volume", vac[0]["expect"]["volume"], 179.41, 2)
    s = add(vac, "m2-slab-al2o3-2periods-v0", "", (0, 0, 0, 1),
            "M2 §0.3 (V = 0): Al2O3(0001) 2 periods (12 layers) from the hexagonal cell, shortest distance 1.855 Å",
            name="Al2O3(0001) Al·O3-term 12L", file="al2o3_hexagonal.vasp", periods=2, vacuum=0.0,
            keys={"structure", "zRange", "volume", "minDistance", "surface.stacking", "surface.vacuum",
                  "surface.layers"})
    check_quote("Al2O3 V=0 shortest distance", s.A.d_min, 1.855, 3, 1e-3)
    for cid, bulk, hkl, kw, vacuum, name, text, note in [
        ("m2-slab-pt111-4l-v2.5", "Pt", (1, 1, 1), {}, 2.5, "Pt(111) 4L",
         "the vacuum (2.5 Å) leaves atoms 2.50 Å apart across the cell edge, closer than in the bulk (2.77 Å)",
         "M2 §0.3 (K11): Pt(111) 4L at 2.5 Å: the top layer sits over the image of the bottom one, 2.50 Å < 2.77 Å "
         "(W12)"),
        ("m2-slab-tio2-110-3periods-v1.5", "TiO2", (1, 1, 0), {"periods": 3}, 1.5, "TiO2(110) O·Ti2O2-term 9L",
         "the vacuum (1.5 Å) leaves atoms 1.50 Å apart across the cell edge, closer than in the bulk (1.95 Å)",
         "M2 §0.3 (K11) and the W12 example of §3.20: bridging O over bridging O, 1.50 Å < 1.95 Å"),
    ]:
        s = add(vac, cid, bulk, hkl, note, name=name, vacuum=vacuum, warnings={"equals": [text]}, **kw)
        check_quote(f"{cid} contact", s.contact(), vacuum, 9)
    # ---------------------------------------------------------------------------------------------- errors
    def err(cid: str, inp: dict, args: dict, text: str, note: str) -> None:
        errors.append({"id": cid, "op": "surface", "args": args, "input": inp, "expect": {"error": text},
                       "skip": skip(SURFACE_SKIP), "note": note})

    pt, zno, sto, tio2 = BULKS["Pt"][0], BULKS["ZnO"][0], BULKS["SrTiO3"][0], BULKS["TiO2"][0]
    err("m2-slab-vacuum-null", pt, {"miller": [1, 1, 1], "vacuum": None},
        "vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)",
        "M2 §3.20 E12a, U4-c: vacuum has no default (None/null is refused; a missing keyword is Python's own "
        "TypeError)")
    err("m2-slab-vacuum-too-large", pt, {"miller": [1, 1, 1], "vacuum": 1001}, "vacuum must be between 0 and 1000 Å",
        "M2 §3.20 E12, max_vacuum = 1000 Å")
    err("m2-slab-vacuum-negative", pt, {"miller": [1, 1, 1], "vacuum": -1}, "vacuum must be between 0 and 1000 Å",
        "M2 §3.20 E12")
    err("m2-slab-v0-half-period", sto, {"miller": [0, 0, 1], "vacuum": 0, "layers": 7},
        "a vacuum of 0 Å needs a whole number of periods (this slab has 3.5); choose Periods or another thickness",
        "acceptance S12, M2 §3.20 E12b: 7 layers of SrTiO3(001) are 3.5 periods")
    err("m2-slab-pt111-v2", pt, {"miller": [1, 1, 1], "vacuum": 2},
        "the vacuum (2 Å) is too small: atoms would be 2.00 Å apart across the cell edge (shortest distance in the "
        "bulk 2.77 Å); "
        "use at least 2.1 Å, or 0 for a bulk-like stacking",
        "M2 §0.3 (K11): 2.00 Å < 0.75 × 2.77 Å; the minimum offered is ceil(7.5 d_min)/10 Å")
    err("m2-slab-tio2-110-v1", tio2, {"miller": [1, 1, 0], "vacuum": 1, "periods": 3},
        "the vacuum (1 Å) is too small: atoms would be 1.00 Å apart across the cell edge (shortest distance in the "
        "bulk 1.95 Å); "
        "use at least 1.5 Å, or 0 for a bulk-like stacking", "M2 §3.20 E16 (its example), §0.3: TiO2(110) at 1 Å")
    err("m2-slab-graphene", recipe("graphene", ["C"], 2.46, 15.0), {"miller": [0, 0, 1], "vacuum": 15},
        "cleaving needs a structure that is periodic along a, b and c (this one is periodic along a and b only)",
        "M2 §3.20 E2: a 2D prototype (pbc T T F) cannot be cleaved; its vacuum is changed with set_vacuum (tools/)")
    err("m2-slab-four-indices-wrong-i", zno, {"miller": [1, 0, 0, 0], "vacuum": 15},
        "in (h k i l), i must be −(h + k) = -1",
        "acceptance S11: build.surface(zno, (1, 0, 0, 0), ...) raises the F0-A miller text")
    err("m2-slab-layers-and-periods", pt, {"miller": [1, 1, 1], "vacuum": 15, "layers": 4, "periods": 2},
        "give only one of layers, periods or thickness", "M2 §3.20 E8")
    err("m2-slab-layers-zero", pt, {"miller": [1, 1, 1], "vacuum": 15, "layers": 0},
        "layers must be a whole number from 1 to 1000", "M2 §3.20 E8")
    err("m2-slab-zno-0001-symmetric", zno,
        {"miller": [0, 0, 0, 1], "vacuum": 15, "termination": "Zn", "symmetric": True},
        "no symmetric slab exists with the Zn termination: no bottom layer matches the top (the (0 0 0 1) and "
        "(0 0 0 -1) faces of this crystal differ); for a polar surface, passivate the bottom (for example with "
        "pseudo-hydrogen) or use an asymmetric slab with a dipole correction",
        "M2 §3.11 E9 (its example): the polar ZnO(0001) has no symmetric slab")
    err("m2-slab-termination-out-of-range", zno, {"miller": [0, 0, 0, 1], "vacuum": 15, "termination": 3},
        "termination 3 does not exist (this surface has 2: 0 Zn, 1 O)", "M2 §3.20 E10 (its example)")
    err("m2-slab-termination-unknown", zno, {"miller": [0, 0, 0, 1], "vacuum": 15, "termination": "Ti"},
        "unknown termination 'Ti' (use Zn or O)", "M2 §3.20 E10 (its example)")
    err("m2-slab-fix-both", pt, {"miller": [1, 1, 1], "vacuum": 15, "fixBottom": 2, "fixMiddle": 2},
        "give only one of fix_bottom or fix_middle", "M2 §3.20 E14")
    err("m2-slab-fix-too-many", pt, {"miller": [1, 1, 1], "vacuum": 15, "fixBottom": 5},
        "fix_bottom must be from 0 to the number of layers (4)", "M2 §3.20 E14")
    return files


# =============================================================================================== tool cases
FIXTURE = "surface/contcar_pt111.vasp"
W14 = "no vacuum gap of at least 5 Å was found; the structure was cut at its widest gap along c ({w} Å)"
W18 = "the cell was left-handed; a and b were swapped so that c points to the top surface"
W19 = ("a group of 2 atoms (H2) floats in the vacuum 7.0 Å above the slab; it was kept with the slab and the vacuum "
       "was measured from it")
E12D = ("a vacuum of 0 Å is only possible when cleaving (the slab then repeats as in the bulk); enter a gap larger "
        "than 0 Å")


def structure_doc(name: str, symbols: list[str], cart: np.ndarray, cell: np.ndarray, pbc=(True, True, True),
                  props: dict | None = None, info: dict | None = None, exact: bool = False) -> dict:
    """A ``crystallume.structure/1`` input (10 decimals, or every digit with *exact*)."""
    num = (lambda x: float(x) + 0.0) if exact else r10      # noqa: E731
    return {"schema": "crystallume.structure/1", "name": name, "symbols": list(symbols),
            "positions": [[num(x) for x in r] for r in cart], "cell": [[num(x) for x in r] for r in cell],
            "pbc": list(pbc), "props": props or {}, "info": info or {}}


def r10(x: float) -> float:
    v = round(float(x), 10)
    return 0.0 if v == 0 else v


def tool_case(op_: str, cid: str, inp: dict, args: dict, expect: dict, note: str) -> dict:
    case = {"id": cid, "op": op_, "args": args, "input": inp, "expect": expect, "skip": skip(TOOL_SKIP.format(op=op_)),
            "note": note}
    if "error" not in expect:
        case["tol"] = TOL
    return case


def vacuum_block(name: str, thickness: float, vacuum: float, position: str = "center", offset: float = 0.0) -> dict:
    """The ``kind: "vacuum"`` record set_vacuum writes on a structure without info.surface (L-X-01, M2 §3.14.12)."""
    return {"version": 2, "kind": "vacuum", "autoName": name, "axis": 2, "normal": [0, 0, 1],
            "thickness": r6(thickness),
            "vacuum": float(vacuum), "position": position, "offset": float(offset), "stacking": "vacuum"}


def contcar() -> tuple[Crystal, list[list[bool]], np.ndarray]:
    """The shared CONTCAR fixture and its positions with the two atoms at f_c = 0.99999 unwrapped below the slab."""
    crys, flags = read_poscar((DATA / FIXTURE).read_text(encoding="utf-8"))
    f = crys.frac.copy()
    f[f[:, 2] > 0.5, 2] -= 1.0
    return crys, flags, f @ crys.cell


def placed(cart: np.ndarray, z0: float) -> np.ndarray:
    out = cart.copy()
    out[:, 2] += z0 - cart[:, 2].min()
    return out


def standard_frame(cell: np.ndarray) -> np.ndarray:
    """Ledger L-M1-04 ``standard_frame(cell, "a-x")``: the proper rotation R for which ``cell @ R.T`` has a along +x
    and b in the xy plane with y >= 0."""
    x = cell[0] / np.linalg.norm(cell[0])
    z = np.cross(cell[0], cell[1])
    z = z / np.linalg.norm(z)
    return np.array([x, np.cross(z, x), z])


def wrap_in_plane(cart: np.ndarray, cell: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """F0-D ``wrap_fractional`` along a and b only: ``w = f - floor(f + eps)``, ``w >= 1 - eps`` becomes 0."""
    f = cart @ np.linalg.inv(cell)
    w = f[:, :2] - np.floor(f[:, :2] + eps)
    f[:, :2] = np.where(w >= 1.0 - eps, 0.0, w)
    return f @ cell


def face_margin(cart: np.ndarray, cell: np.ndarray) -> float:
    """The smallest distance of an in-plane fractional coordinate from a whole number (a cell face)."""
    f = (cart @ np.linalg.inv(cell))[:, :2]
    return float(np.abs(f - np.round(f)).min())


#: In-plane shift (units of a and b) of the flip inputs: no atom lies on a cell face before or after the flip, so
#: the in-plane wrap of the result cannot depend on the rounding of the stored input.
FLIP_SHIFT = (0.137, 0.291)


def flip_slab(doc: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[list[int]]]:
    """M2 §3.15 (ledger L-M2-04) on a stored input slab with c along the normal and the vacuum in one piece, from
    the numbers as stored (what an implementation reads): the rotation R = 2ââᵀ - I by 180° about â, then
    ``a1 = a``, ``b1 = -(R b)``, ``c1 = -(R c)``, the in-plane basis reduced by M1 ``gauss_reduce_2d`` (matrix M2),
    the slab put back where it was along the normal (centred stays centred), turned into the standard frame
    (a along x) and wrapped in-plane.  Returns positions, cell, R and M2."""
    pos, cell = np.array(doc["positions"], float), np.array(doc["cell"], float)
    a, b, c = cell
    n_in = np.cross(a, b)
    n_in = np.sign(c @ n_in) * n_in / np.linalg.norm(n_in)
    ah = a / np.linalg.norm(a)
    R = 2.0 * np.outer(ah, ah) - np.eye(3)
    u, v, M2 = gauss_reduce_2d(a, -(R @ b))
    new = np.array([u, v, -(R @ c)])
    n = np.cross(u, v)
    n = n / np.linalg.norm(n)
    out = pos @ R.T
    out = out + (float((pos @ n_in).min()) - float((out @ n).min())) * n     # the same heights as before
    Rs = standard_frame(new)
    out, new = out @ Rs.T, new @ Rs.T
    new[np.abs(new) < 1e-12] = 0.0
    out = wrap_in_plane(out, new)
    assert face_margin(out, new) > 1e-3, "an atom of the flipped slab lies on a cell face: change FLIP_SHIFT"
    return out, new, R, M2


def flip_supercell(S_old: list[list[int]], cell: np.ndarray, R: np.ndarray,
                   M2: list[list[int]]) -> tuple[list[list[int]], float]:
    """M2 §3.15's supercell record of a flipped slab: the 1×1 mesh ``inv(S_old)·[a; b]`` turned by R and reduced
    (``(p, q, M1x) = gauss_reduce_2d(R a₁, -R b₁)``), ``S_new = M2 · D · S_old · D · inv(M1x)`` with D = diag(1, -1);
    returns S_new and the angle (°) of the 1×1 mesh it refers to."""
    S = np.array(S_old, float)
    one = np.linalg.inv(S) @ np.array(cell[:2])
    p, q, M1x = gauss_reduce_2d(R @ one[0], -(R @ one[1]))
    D = np.diag([1.0, -1.0])
    S_new = np.array(M2, float) @ D @ S @ D @ np.linalg.inv(np.array(M1x, float))
    ints = np.round(S_new).astype(int)
    assert np.allclose(S_new, ints, atol=1e-9)
    u, v, _ = gauss_reduce_2d(cell[0], -(R @ cell[1]))
    assert np.allclose(ints @ np.array([p, q]), np.array([u, v]), atol=1e-8), "[u; v] = S_new [p; q]"
    gamma = math.degrees(math.acos((p @ q) / (np.linalg.norm(p) * np.linalg.norm(q))))
    return ints.tolist(), gamma


def tool_cases() -> dict[str, list[dict]]:
    files: dict[str, list[dict]] = {"tools/set_vacuum.json": [], "tools/flip.json": [], "tools/standardize.json": []}
    sv, fl, sd = (files[k] for k in files)
    crys, flags, cart = contcar()
    t = float(cart[:, 2].max() - cart[:, 2].min())
    check_quote("CONTCAR gap", crys.cell[2][2] - t, 14.9998, 4)
    name = crys.name
    fixture = {"file": FIXTURE}

    def slab_result(name_: str, symbols, pos, cell, pbc=(True, True, True), flags_=None, surface=None) -> dict:
        st = {"name": name_, "symbols": list(symbols), "pbc": list(pbc),
              "positions": [[r9(x) for x in r] for r in pos], "cell": [[r9(x) for x in r] for r in cell]}
        if flags_ is not None:
            st["props"] = {"selective_dynamics": flags_}
        return {"structure": st, "surface": surface, "zRange": [r9(pos[:, 2].min()), r9(pos[:, 2].max())]}

    # ---------------------------------------------------------------------------------------------- set_vacuum
    for vac in (15.0, 20.0):
        cell = crys.cell.copy()
        cell[2] = [0.0, 0.0, t + vac]
        e = slab_result(name, crys.symbols, placed(cart, vac / 2), cell, flags_=flags,
                        surface=vacuum_block(name, t, vac))
        e["warnings"] = {"equals": []}
        e["minDistance"] = r9(3.92 / math.sqrt(2))
        sv.append(tool_case("setVacuum", f"m2-vacuum-contcar-{int(vac)}", fixture, {"vacuum": vac}, e,
                            f"M2 §7.1, acceptance S14 and E2E-3: the CONTCAR fixture (gap 14.9998 Å, two atoms wrapped "
                            f"to f = 0.99999) "
                            f"set to a {vac:g} Å total gap: the slab joined in one piece and centred, c = thickness + "
                            f"{vac:g} Å, "
                            "constraints as read, pbc still T T T (U2), a new kind 'vacuum' record (not a slab marker, "
                            "U1), name kept"))
    cell = crys.cell.copy()
    cell[2] = [0.0, 0.0, t + 15.0]
    e = slab_result(name, crys.symbols, placed(cart, 2.0), cell, flags_=flags,
                    surface=vacuum_block(name, t, 15.0, "bottom", 2.0))
    sv.append(tool_case("setVacuum", "m2-vacuum-contcar-bottom", fixture,
                        {"vacuum": 15, "position": "bottom", "offset": 2},
                        e, "M2 §3.14 step 8: position bottom with an offset of 2 Å puts the lowest atom at z = 2 Å"))
    sv.append(tool_case("setVacuum", "m2-vacuum-contcar-zero", fixture, {"vacuum": 0}, {"error": E12D},
                        "lead decision L-13, M2 §3.20 E12d: 0 Å is only defined when cleaving; an existing structure "
                        "refuses it"))
    # the vacuum along a: the same fixture with its cell vectors relabelled, gives the same result plus W16; the
    # flags of its top and third layers (T T F and F T T in the fixture's frame) follow the relabelling
    a_file = "contcar_pt111_vacuum_along_a.vasp"
    a_flags = [[f[1], f[2], f[0]] for f in INPUTS.flags[a_file]]      # (a, b, c) <- (a_1, a_2, a_0), M2 §3.14.2
    e = slab_result(name, crys.symbols, placed(cart, 7.5), cell, flags_=a_flags, surface=None)
    a_name = INPUTS.crystal[a_file].name
    e["structure"]["name"] = a_name
    e["surface"] = vacuum_block(a_name, t, 15.0)
    e["warnings"] = {"contains": ["the vacuum was along a; the cell vectors were relabelled"], "count": 1}
    sv.append(tool_case("setVacuum", "m2-vacuum-along-a", INPUTS.file(a_file),
                        {"vacuum": 15},
                        e, "M2 §3.14 step 2 (W16): the vacuum along a is moved to c by a cyclic relabelling (cell, "
                           "pbc, flags: the T T F and F T T flags of the input's top and third layers come back as "
                           "they are in the fixture); the result is m2-vacuum-contcar-15 with axis 2"))
    # the same with a declared: pbc F T T and a supercell record follow the relabelling too (M2 §7.1 "vacuum along
    # a: pbc, SD and supercellMatrix permuted together"); the slab is moved 0.1 along a so that it does not cross
    # the cell boundary (with pbc[a] false nothing is joined, step 5), and the positions keep every digit so that
    # the in-plane wrap cannot depend on rounding
    src = INPUTS.crystal[a_file]
    f_pbc = src.frac.copy()
    f_pbc[:, 0] = np.mod(f_pbc[:, 0] + 0.1, 1.0)
    p_name = "Pt(111) p(3x3) 4L, vacuum along a (a not periodic)"
    doc = structure_doc(p_name, src.symbols, f_pbc @ src.cell, src.cell, pbc=(False, True, True),
                        props={"selective_dynamics": INPUTS.flags[a_file]},
                        info={"supercellMatrix": [[1, 0, 0], [0, 3, 0], [0, 0, 3]]}, exact=True)
    e = slab_result(p_name, crys.symbols, placed(cart, 7.5), cell, pbc=(True, True, False), flags_=a_flags,
                    surface=vacuum_block(p_name, t, 15.0))
    e["structure"]["info"] = {"supercellMatrix": [[3, 0, 0], [0, 3, 0], [0, 0, 1]]}
    e["warnings"] = {"contains": ["the vacuum was along a; the cell vectors were relabelled"], "count": 1}
    sv.append(tool_case("setVacuum", "m2-vacuum-along-a-pbc", {"structure": doc}, {"vacuum": 15}, e,
                        "M2 §3.14 steps 2 and 11, §7.1 (vacuum along a: pbc, SD and supercellMatrix permuted "
                        "together): pbc F T T becomes T T F, the supercell record diag(1, 3, 3) becomes diag(3, 3, 1), "
                        "the flags as in m2-vacuum-along-a; the slab is the one of m2-vacuum-along-a"))
    # graphene and MoS2 (pbc T T F stays T T F, U2; acceptance S13-1)
    for key, rec, vac, z in (("graphene", recipe("graphene", ["C"], 2.46, 15.0, name="graphene"), 20.0, None),
                             ("mos2", recipe("mos2", ["Mo", "S"], 3.16, 18.0, name="MoS2"), 20.0, 3.17)):
        cr = (prototype("graphene", ["C"], 2.46, 15.0) if key == "graphene"
              else prototype("mos2", ["Mo", "S"], 3.16, 18.0, thickness=3.17))
        nm = rec["recipe"]["args"]["name"]
        th = 0.0 if z is None else z
        c2 = cr.cell.copy()
        c2[2] = [0.0, 0.0, th + vac]
        e = slab_result(nm, cr.symbols, placed(cr.cart, vac / 2), c2, pbc=(True, True, False),
                        surface=vacuum_block(nm, th, vac))
        e["warnings"] = {"equals": []}
        note = ("acceptance S13-1: graphene (pbc T T F) set to 20 Å: c = 20 Å, the atoms at z = 10 Å, in-plane "
                "unchanged, pbc still T T F, a new kind 'vacuum' record") if key == "graphene" else \
            "M2 §7.1: MoS2 (pbc T T F, S-S height 3.17 Å) set to 20 Å: c = 23.17 Å, centred, pbc still T T F"
        sv.append(tool_case("setVacuum", f"m2-vacuum-{key}-20", rec, {"vacuum": vac}, e, note))
    # left-handed CONTCAR with H on top (W18), floating H2 (W19)
    lh = INPUTS.crystal["contcar_pt111_lefthanded_h.vasp"]
    lcart = lh.cart
    lt = float(lcart[:, 2].max() - lcart[:, 2].min())
    rcell = np.array([lh.cell[1], lh.cell[0], [0.0, 0.0, lt + 15.0]])
    l_flags = [[f[1], f[0], f[2]] for f in INPUTS.flags["contcar_pt111_lefthanded_h.vasp"]]   # M2 §3.14.3: a <-> b
    e = slab_result(lh.name, lh.symbols, placed(lcart, 7.5), rcell, flags_=l_flags,
                    surface=vacuum_block(lh.name, lt, 15.0))
    e["warnings"] = {"equals": [W18]}
    check_quote("left-handed H on top", int(np.argmax(lcart[:, 2])), len(lh) - 1)
    sv.append(tool_case("setVacuum", "m2-vacuum-lefthanded-h", INPUTS.file("contcar_pt111_lefthanded_h.vasp"),
                        {"vacuum": 15},
                        e, "M2 §3.14 steps 3-4, review t10: a left-handed CONTCAR (a and b swapped) keeps the H on "
                           "top: a and b "
                        "are swapped back (W18) with their flag columns (the middle layer's T F T becomes F T T), "
                        "the normal is on the side of c, nothing is mirrored"))
    fh = INPUTS.crystal["contcar_pt111_h2_floating.vasp"]
    fcart = fh.cart
    ft = float(fcart[:, 2].max() - fcart[:, 2].min())
    check_quote("H2 thickness", round(ft - 2 * 3.92 / SQ3, 9), 7.0)
    c3 = fh.cell.copy()
    c3[2] = [0.0, 0.0, ft + 15.0]
    e = slab_result(fh.name, fh.symbols, placed(fcart, 7.5), c3, flags_=INPUTS.flags["contcar_pt111_h2_floating.vasp"],
                    surface=vacuum_block(fh.name, ft, 15.0))
    e["warnings"] = {"equals": [W19]}
    sv.append(tool_case("setVacuum", "m2-vacuum-floating-h2", INPUTS.file("contcar_pt111_h2_floating.vasp"),
                        {"vacuum": 15},
                        e, "M2 §3.14 step 6 (W19): an H2 molecule 7.0 Å above the slab is kept with it and the 15 Å "
                           "gap is "
                        "measured from the H2 (thickness = slab + 7.0 Å)"))
    # a bulk crystal has no gap: cut at the widest gap along c (W14); F0-D picks the gap [0, 0.5) of SrTiO3,
    # so the window starts at 0.25 (L-M2-03 step 1) and TiO2 is the bottom layer
    sto_rec = recipe("perovskite", ["Sr", "Ti", "O"], 3.905, name="SrTiO3")
    sto = prototype("perovskite", ["Sr", "Ti", "O"], 3.905)
    f = sto.frac.copy()
    f[f[:, 2] < 0.25, 2] += 1.0
    scart = f @ sto.cell
    st_t = float(scart[:, 2].max() - scart[:, 2].min())
    c4 = sto.cell.copy()
    c4[2] = [0.0, 0.0, st_t + 15.0]
    e = slab_result("SrTiO3", sto.symbols, placed(scart, 7.5), c4, surface=vacuum_block("SrTiO3", st_t, 15.0))
    e["warnings"] = {"equals": [W14.format(w=fmt2(st_t))]}
    sv.append(tool_case("setVacuum", "m2-vacuum-bulk-srtio3", sto_rec, {"vacuum": 15}, e,
                        "M2 §3.14 step 1 (W14): bulk SrTiO3 has no vacuum gap; it is cut at the widest gap along c "
                        "(1.95 Å) and becomes a 2-layer slab (TiO2 below SrO) with 15 Å of vacuum"))
    # tilted c: made orthogonal, the height of the cell along the normal kept
    A = Analysis(BULKS["Pt"][1], (1, 1, 1))
    sy, pos, cell4, tags = slab_atoms(A, A.classes[0]["rep"], 4, [[1, 0], [0, 1]], 15.0, ["Pt"])
    tilted = cell4.copy()
    tilted[2] = [1.0, 0.5, cell4[2][2]]
    fl4 = [[False] * 3 if tg >= 3 else [True] * 3 for tg in tags]
    doc = structure_doc("Pt(111) 4L tilted c", sy, pos, tilted, props={"tags": tags, "selective_dynamics": fl4})
    e = slab_result("Pt(111) 4L tilted c", sy, pos, cell4, flags_=fl4,
                    surface=vacuum_block("Pt(111) 4L tilted c", float(pos[:, 2].max() - pos[:, 2].min()), 15.0))
    e["structure"]["props"]["tags"] = tags
    e["warnings"] = {"equals": []}
    sv.append(tool_case("setVacuum", "m2-vacuum-tilted-c", {"structure": doc}, {"vacuum": 15}, e,
                        "M2 §3.14 step 7: a tilted c is made orthogonal ((t + V) n); the slab already had 15 Å along "
                        "the normal, so no atom moves; F F F and T T T flags are kept exactly (no W15)"))
    # ---------------------------------------------------------------------------------------------- flip_slab
    # The inputs are shifted in-plane by FLIP_SHIFT (no atom on a cell face) and the expectations are computed from
    # the stored numbers, so that the in-plane wrap of a correct implementation lands every atom where the case says.
    sA = Analysis(BULKS["SrTiO3"][1], (0, 0, 1))
    sy, pos, cell8, tags = slab_atoms(sA, sA.classes[0]["rep"], 8, [[1, 0], [0, 1]], 15.0, ["Sr", "Ti", "O"])
    pos = wrap_in_plane(pos + FLIP_SHIFT[0] * cell8[0] + FLIP_SHIFT[1] * cell8[1], cell8)
    fl8 = [[True, True, False] if tg >= 7 else [True, True, True] for tg in tags]
    doc = structure_doc("SrTiO3 8L", sy, pos, cell8, props={"tags": tags, "selective_dynamics": fl8})
    fpos, fcell, _, _ = flip_slab(doc)
    assert np.allclose(fcell, cell8, atol=1e-9), "the square cell is its own flip"
    e = slab_result("SrTiO3 8L", sy, fpos, fcell, flags_=fl8, surface=None)
    e["structure"]["props"]["tags"] = [9 - tg for tg in tags]
    top_after = [s for s, z in zip(sy, fpos[:, 2]) if abs(z - fpos[:, 2].max()) < 1e-6]
    check_quote("flipped SrTiO3 top", sorted(Counter(top_after).items()), [("O", 1), ("Sr", 1)])
    fl.append(tool_case("flipSlab", "m2-flip-srtio3-8l", {"structure": doc}, {}, e,
                        "M2 §7.1 flip row: an asymmetric SrTiO3 slab (TiO2 on top) turned over about a: SrO on top, "
                        "tags reversed, "
                        "the T T F flags of the old bottom layers kept, the cell unchanged (det > 0); no record, name "
                        "kept"))
    for cid, bulk, hkl, L, S, name0, name1, sc0, sc1, note in [
        ("m2-flip-zno-0001-16l", "ZnO", (0, 0, 0, 1), 16, None, "ZnO(0001) Zn/O-term 16L", "ZnO(000-1) O/Zn-term 16L",
         None, None,
         "M2 §7.1 flip row, ledger L-X-07: miller, hkil, millerInput and bulkNormal negated, top and bottom swapped, "
         "the name refreshed (ZnO(000-1) O/Zn-term 16L); tags reversed, hexagonal 120° kept"),
        ("m2-flip-pt111-sqrt3-4l", "Pt", (1, 1, 1), 4, [[2, 1], [-1, 1]], "Pt(111) (√3×√3)R30° 4L",
         "Pt(-1-1-1) (√3×√3)R30° 4L",
         [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], [[1, -1, 0], [1, 2, 0], [0, 0, 1]],
         "M2 §3.15, ledger L-M2-04, §7.1 flip row: the input is the M1 make_supercell path, so a lies 30° from x; "
         "the slab turns 180° about a (R = 2ââᵀ - I, not about x) and back into the standard frame (a along x); "
         "the supercell record of √3 becomes [[1, -1], [1, 2]] on the reduced flipped 1×1 mesh (120°)"),
        ("m2-flip-pt111-p3x3-4l", "Pt", (1, 1, 1), 4, [[3, 0], [0, 3]], "Pt(111) p(3×3) 4L", "Pt(-1-1-1) p(3×3) 4L",
         [[3, 0, 0], [0, 3, 0], [0, 0, 1]], [[3, 0, 0], [0, 3, 0], [0, 0, 1]],
         "M2 §3.15, §7.1 flip row: p(3×3) stays diag(3, 3)"),
    ]:
        inp, crys_b = BULKS[bulk]
        An = Analysis(crys_b, hkl)
        k = An.classes[0]["rep"]
        Sx = S or [[1, 0], [0, 1]]
        sl = Slab(An, crys_b.symbols, layers=L, vacuum=15.0, S=Sx)
        check_quote(f"{cid} name", sl.name(sl.bulk_formula, hkil_of(An.miller) if bulk == "ZnO" else list(An.miller),
                                           "" if S is None else ("(√3×√3)R30°" if S[0][1] else "p(3×3)")), name0)
        sy, pos, cellx, tags = slab_atoms(An, k, L, Sx, 15.0, crys_b.symbols)
        pos = wrap_in_plane(pos + FLIP_SHIFT[0] * cellx[0] + FLIP_SHIFT[1] * cellx[1], cellx)
        proto = inp["recipe"]["args"]["prototype"]
        miller = list(An.miller)
        rec = {"version": 2, "kind": "cleave", "autoName": name0,
               "bulk": {"name": f"{sl.bulk_formula} {proto}", "formula": formula(dict(Counter(crys_b.symbols))),
                        "reducedFormula": sl.bulk_formula, "natoms": len(crys_b),
                        "cell": [[r6(x) for x in row] for row in crys_b.cell], "spacegroup": SPACEGROUP[proto],
                        "source": f"builder:{proto}"},
               "miller": miller, "millerBasis": "input", "primitive": True, "translationTolerance": 0.05,
               "bulkNormal": [r6(x) for x in An.normal], "normal": [0, 0, 1], "axis": 2, "period": r6(An.period),
               "layersPerPeriod": An.m, "layerTolerance": r6(An.tau), "layerGrouping": An.grouping,
               "meshParams": {"a": r6(An.mesh["a"]), "b": r6(An.mesh["b"]), "gamma": r6(An.mesh["gamma"]),
                              "area": r6(An.area), "type": An.mesh["type"]},
               "termination": {"index": 0, "count": len(An.classes), "label": sl.top_label, "top": sl.top_label,
                               "bottom": sl.bottom_label, "topComposition": dict(sl.layer_comps[-1]),
                               "bottomComposition": dict(sl.layer_comps[0]), "brokenBonds": An.classes[0]["broken"],
                               "polar": bool(An.classes[0]["polar"])},
               "tasker": An.tasker, "layers": L, "thicknessSpec": {"mode": "layers", "value": L},
               "thickness": r6(sl.thickness), "vacuum": 15.0, "stacking": "vacuum", "position": "center", "offset": 0.0,
               "symmetric": False, "symmetryCheck": "fingerprint", "flipped": False,
               "asBuilt": {"composition": sl.composition, "stoichiometric": sl.stoichiometric, "excess": sl.excess,
                           "supercell": Sx}}
        if bulk == "ZnO":
            rec["hkil"] = [0, 0, 0, 1]
            rec["millerInput"] = [0, 0, 0, 1]
        info = {"source": "builder:surface", "surface": rec}
        if sc0:
            info["supercellMatrix"] = sc0
        doc = structure_doc(name0, sy, pos, cellx, props={"tags": tags}, info=info)
        fpos, fcell, R, M2 = flip_slab(doc)
        if S is None or S[0][1] == 0:       # a along x already: the reduced flipped cell is the input cell
            assert np.allclose(fcell, cellx, atol=1e-9)
        e = slab_result(name1, sy, fpos, fcell, surface=None)
        del e["surface"]
        e["structure"]["props"] = {"tags": [L + 1 - tg for tg in tags]}
        if sc1:
            S_new, gamma = flip_supercell(Sx, np.array(doc["cell"], float), R, M2)
            check_quote(f"{cid} supercell record", embed(S_new), sc1)
            check_quote(f"{cid} 1×1 mesh of the record", round(gamma, 9), 120.0)
            e["structure"]["info"] = {"supercellMatrix": sc1}
        neg = [-x for x in miller]
        e.update({"surface.kind": "cleave", "surface.autoName": name1, "surface.miller": neg,
                  "surface.bulkNormal": [r6(-x) for x in An.normal], "surface.flipped": True,
                  "surface.normal": [0, 0, 1], "surface.axis": 2, "surface.termination.top": sl.bottom_label,
                  "surface.termination.bottom": sl.top_label,
                  "surface.termination.topComposition": dict(sl.layer_comps[0]),
                  "surface.termination.bottomComposition": dict(sl.layer_comps[-1])})
        if bulk == "ZnO":
            e.update({"surface.hkil": [0, 0, 0, -1], "surface.millerInput": [0, 0, 0, -1]})
        fl.append(tool_case("flipSlab", cid, {"structure": doc}, {}, e, note))
    # ---------------------------------------------------------------------------------------------- standardize_slab
    e = slab_result(name, crys.symbols, placed(cart, 0.0), crys.cell, flags_=flags, surface=None)
    sd.append(tool_case("standardizeSlab", "m2-standardize-contcar", fixture, {}, e,
                        "ledger L-M2-05: the CONTCAR fixture joined in one piece with its lowest atom at z = 0; the "
                        "gap "
                        "(c·n) unchanged, pbc unchanged, no record written, name kept"))
    a_doc = INPUTS.file(a_file)
    e = slab_result(a_name, crys.symbols, placed(cart, 0.0), crys.cell, flags_=a_flags, surface=None)
    sd.append(tool_case("standardizeSlab", "m2-standardize-vacuum-along-a", a_doc, {}, e,
                        "ledger L-M2-05 (R-F22): the vacuum along a is relabelled to c (cell, pbc and flag columns): "
                        "the result of m2-standardize-contcar, with the flags of m2-vacuum-along-a"))
    lcell = np.array([lh.cell[1], lh.cell[0], lh.cell[2]])
    e = slab_result(lh.name, lh.symbols, placed(lcart, 0.0), lcell, flags_=l_flags, surface=None)
    sd.append(tool_case("standardizeSlab", "m2-standardize-lefthanded-h",
                        INPUTS.file("contcar_pt111_lefthanded_h.vasp"), {},
                        e, "ledger L-M2-05: a left-handed cell is relabelled (a and b swapped, with their flag "
                           "columns), the H stays on the top face"))
    sy, pos, cell4, _ = slab_atoms(A, A.classes[0]["rep"], 4, [[1, 0], [0, 1]], 15.0, ["Pt"])
    doc = structure_doc("Pt(111) 4L tilted c", sy, pos, tilted)
    e = slab_result("Pt(111) 4L tilted c", sy, placed(pos, 0.0), cell4, surface=None)
    sd.append(tool_case("standardizeSlab", "m2-standardize-tilted-c", {"structure": doc}, {}, e,
                        "ledger L-M2-05: c made orthogonal with c·n kept, a along x, the lowest atom at z = 0"))
    g = prototype("graphene", ["C"], 2.46, 15.0)
    e = slab_result("graphene", g.symbols, placed(g.cart, 0.0), g.cell, pbc=(True, True, False), surface=None)
    sd.append(tool_case("standardizeSlab", "m2-standardize-graphene",
                        recipe("graphene", ["C"], 2.46, 15.0, name="graphene"), {},
                        e, "ledger L-M2-05: pbc T T F is kept; the atoms move to z = 0, the cell is unchanged"))
    sd.append(tool_case("standardizeSlab", "m2-standardize-bulk", sto_rec, {},
                        {"error": "no vacuum gap of 5 Å or more along a cell vector (the widest is 2.0 Å along c); add "
                                  "vacuum first"},
                        "ledger L-M2-05: a structure without a surface raises ValueError(\"'<name>': \" + "
                        "vacuum_gap_hint(s)), "
                        "the F0-D hint (matched without the name)"))
    return files


# ======================================================================================= recipe and input checks
def load_case(cid: str, inp: dict, crys: Crystal, note: str, *, name: str | None = None,
              info: dict | None = None) -> dict:
    st: dict[str, Any] = {"symbols": crys.symbols, "pbc": list(crys.pbc),
                          "cell": [[r9(x) for x in row] for row in crys.cell],
                          "positions": [[r9(x) for x in r] for r in crys.cart]}
    if name is not None:
        st["name"] = name
    if info:
        st["info"] = info
    return {"id": cid, "op": "load", "input": inp, "expect": {"structure": st}, "note": note}


def recipe_cases() -> list[dict]:
    """The ``bulk`` recipe in both languages against the analytic crystals (op ``load``, registered by F0-D)."""
    from crystallume import build   # the builders the recipe calls: the analytic crystals must be what they build

    out = []
    table = [("fcc", ["Pt"], 3.92, None, {}), ("bcc", ["Fe"], 2.866, None, {}), ("hcp", ["Ru"], 2.71, 4.28, {}),
             ("perovskite", ["Sr", "Ti", "O"], 3.905, None, {}), ("rutile", ["Ti", "O"], 4.594, 2.959, {"u": 0.305}),
             ("fluorite", ["Ce", "O"], 5.411, None, {}), ("wurtzite", ["Zn", "O"], 3.25, 5.207, {"u": 0.382}),
             ("rocksalt", ["Na", "Cl"], 5.64, None, {}), ("zincblende", ["Ga", "As"], 5.653, None, {}),
             ("graphene", ["C"], 2.46, 15.0, {"name": "graphene"}), ("mos2", ["Mo", "S"], 3.16, 18.0, {"name": "MoS2"}),
             ("mos2", ["Mo", "S"], 3.16, 18.0, {"thickness": 3.3})]
    for proto, els, a, c, extra in table:
        params = {k: v for k, v in extra.items() if k in ("u", "thickness")}
        crys = prototype(proto, els, a, c, u=params.get("u"),
                         thickness=params.get("thickness", 3.17 if proto == "mos2" else None))
        real = build.crystal(proto, list(els), a=a, c=c, **params)
        assert real.symbols == crys.symbols and np.allclose(real.positions, crys.cart, atol=1e-9) \
            and np.allclose(real.cell, crys.cell, atol=1e-12) and list(real.pbc) == list(crys.pbc), proto
        thick = [f"thickness-{params['thickness']}"] if "thickness" in params else []
        tag = "-".join([proto] + [e.lower() for e in els] + thick)
        info = {"prototype": proto, "source": f"builder:{proto}", "a": a, **({"c": c} if c is not None else {}),
                **params}
        if proto == "mos2" and "thickness" not in params:
            info["thickness"] = 3.17
        out.append(load_case(f"m2-recipe-bulk-{tag}", recipe(proto, els, a, c, **extra), crys,
                             f"recipe bulk: {proto} {' '.join(els)} with explicit lattice constants is the same "
                             "crystal in both languages (analytic positions; build.crystal checked against them)",
                             name=extra.get("name"), info=info))
    pt = prototype("fcc", ["Pt"], 3.92)
    rep = Crystal("Pt", pt.symbols * 2, np.vstack([pt.frac, pt.frac + [1, 0, 0]]) / [2, 1, 1],
                  pt.cell * [[2], [1], [1]])
    real = build.crystal("fcc", ["Pt"], a=3.92, repeat=[2, 1, 1])
    assert np.allclose(real.positions, rep.cart, atol=1e-9), "repeat order"
    out.append(load_case("m2-recipe-bulk-fcc-pt-repeat-2x1x1", recipe("fcc", ["Pt"], 3.92, repeat=[2, 1, 1]), rep,
                         "recipe bulk with repeat: the Structure.repeat atom order (image-major: the 4 atoms of image "
                         "0, then image 1)"))
    return out


def input_cases() -> list[dict]:
    """Each file of inputs/ read by both languages (op ``load``): the same atoms as the generator wrote."""
    out = []
    for name, crys in INPUTS.crystal.items():
        flags = INPUTS.flags[name]
        note = "both readers give the atoms of this input file" + (
            " (its Selective dynamics flags are compared by the tool cases once F0-D T4 lets the web reader keep them)"
            if flags else "")
        out.append(load_case(f"m2-input-{name.removesuffix('.vasp').replace('_', '-')}", INPUTS.file(name), crys, note))
    return out


# =============================================================================================== writing
HEADER = ("Generated by tests/data/surface/cleave/make_cleave_cases.py (M2-T7a); the op contracts, the skips and the "
          "decisions behind the expectations are in tests/data/surface/cleave/README.md. ")
DESCRIPTIONS = {
    "recipes.json": "The shared recipe bulk (tests/ops/m2_recipes.py, tests/js/ops/m2_recipes.mjs): every prototype "
                    "the M2 cases "
                    "use, built with explicit lattice constants, gives the same crystal in both languages.",
    "inputs.json": "The files of inputs/ read by both languages.",
    "analysis/metals.json": "Op terminations (M2-T3, M2-T6a) on metals: surface cells, periods, layers and "
                            "terminations of "
                            "acceptance S1-S7 and M2 §0.3.",
    "analysis/oxides.json": "Op terminations on oxides and halides: acceptance S8-S12 and M2 §0.3 (Tasker types, K7 "
                            "order, K8 labels; the K5 rows rutile (111), (120), (102) and ZnO (2 0 -2 1)).",
    "analysis/inputs.json": "Op terminations on the real inputs of M2 §7.2: Materials Project primitive cells "
                            "(conventional-cell hints and indices), corundum, rumpled LaFeO3 and anatase layers, SiC "
                            "2H/3C/4H/6H, dhcp La, noisy bulks.",
    "analysis/errors.json": "Op terminations: input errors (M2 §3.20).",
    "slab/metals.json": "Op surface (M2-T4, M2-T6b) on metals: acceptance S1-S7 (pbc T T T, U2; vacuum = total gap, "
                        "U4; names, L-19).",
    "slab/oxides.json": "Op surface on oxides: acceptance S8-S12, symmetric slabs, stoichiometry and polarity "
                        "warnings.",
    "slab/vacuum.json": "Op surface with a vacuum of 0 Å (bulk stacking, U4) and small vacua (K11 contact check).",
    "slab/errors.json": "Op surface: errors (M2 §3.20; E12a for vacuum null, U4).",
    "tools/set_vacuum.json": "Op setVacuum (M2-T5): the CONTCAR fixture at 15 and 20 Å, 2D prototypes (pbc kept), "
                             "vacuum along a (cell, pbc, flags and supercell record relabelled), "
                             "left-handed cells, floating molecules, bulks, tilted c, and set_vacuum(0) (L-13).",
    "tools/flip.json": "Op flipSlab (M2-T5): flipped slabs (180° about a, back in the standard frame), their records "
                       "and names (M2 §3.15).",
    "tools/standardize.json": "Op standardizeSlab (M2-T5): the slab normalisation M6 uses (ledger L-M2-05).",
}
KEY_ORDER = ("id", "op", "args", "input", "expect", "tol", "skip", "xfail", "note")
#: The subdirectories this script writes (besides the files directly in cleave/); ``--check`` ignores the others,
#: such as the full atom lists M2-T7b-lite adds under ``full/``.
OWN_DIRS = ("analysis", "inputs", "slab", "tools")


def keep_run_state(rel: str, cases: list[dict]) -> list[dict]:
    """The cases with the run state the file on disk has: a language whose skip was removed (M2-T5, M2-T7c and
    M2-T7b-lite remove them by hand once that language passes) stays without it, and an ``xfail`` on disk is kept.
    A new case, or a language that still skips, gets the skip of its op."""
    path = HERE / rel
    if not path.is_file():
        return cases
    disk = {c.get("id"): c for c in json.loads(path.read_text(encoding="utf-8")).get("cases", [])}
    out = []
    for case in cases:
        old = disk.get(case["id"])
        if old is not None:
            case = dict(case)
            if "skip" in case:
                kept = {lang: why for lang, why in case["skip"].items() if lang in old.get("skip", {})}
                if kept:
                    case["skip"] = kept
                else:
                    del case["skip"]
            if "xfail" in old:
                case["xfail"] = old["xfail"]
        out.append(case)
    return out


def file_text(rel: str, cases: list[dict]) -> str:
    lines = ["{", f'  "schema": {json.dumps(SCHEMA)},',
             f'  "description": {json.dumps(HEADER + DESCRIPTIONS[rel], ensure_ascii=False)},', '  "cases": [']
    body = [json.dumps({k: c[k] for k in KEY_ORDER if k in c}, ensure_ascii=False, separators=(", ", ": "))
            for c in cases]
    lines += ["    " + b + ("," if i < len(body) - 1 else "") for i, b in enumerate(body)]
    lines += ["  ]", "}"]
    return "\n".join(lines) + "\n"


def all_files(*, keep_state: bool = True) -> dict[str, str]:
    files: dict[str, str] = {}
    groups: dict[str, list[dict]] = {"recipes.json": recipe_cases(), "inputs.json": input_cases()}
    for group in (analysis_cases(), slab_cases(), tool_cases()):
        groups.update(group)
    for rel, cases in groups.items():
        files[rel] = file_text(rel, keep_run_state(rel, cases) if keep_state else cases)
    for name, text in INPUTS.text.items():
        files[f"inputs/{name}"] = text
    return files


def check_radii() -> None:
    """The radii and electronegativities used here are the repository's (crystallume/core/elements.py)."""
    from crystallume.core.elements import covalent_radius
    for e, r in COV.items():
        assert abs(covalent_radius(e) - r) < 1e-12, (e, covalent_radius(e), r)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk instead of writing")
    ap.add_argument("--reset-skips", action="store_true",
                    help="give every case the skip of its op again (by default a skip removed by hand stays removed)")
    opts = ap.parse_args(argv)
    sys.path.insert(0, str(REPO))
    check_radii()
    files = all_files(keep_state=not opts.reset_skips)
    stale = []
    for rel, text in sorted(files.items()):
        path = HERE / rel
        if opts.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                stale.append(rel)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    for slip in SLIPS:
        print(f"note: {slip}")
    if opts.check:
        on_disk = {rel for rel in (p.relative_to(HERE).as_posix() for p in HERE.rglob("*")
                                   if p.is_file() and p.suffix in (".json", ".vasp"))
                   if "/" not in rel or rel.split("/", 1)[0] in OWN_DIRS}
        extra = sorted(on_disk - set(files))
        if stale or extra:
            print("out of date: " + ", ".join(stale + [f"{x} (not written by this script)" for x in extra]))
            return 1
        print(f"{len(files)} files up to date")
        return 0
    n = sum(text.count('"id": ') for rel, text in files.items() if rel.endswith(".json"))
    print(f"wrote {len(files)} files ({n} cases) under {HERE.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
