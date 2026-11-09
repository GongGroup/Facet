#!/usr/bin/env python3
"""Write the golden cases of the layer analysis (M3): ``tests/data/surface/layers/*.json``.

    python scripts/gen_layer_fixtures.py            # (re)write the case files
    python scripts/gen_layer_fixtures.py --check    # rebuild them in memory; exit 1 if a case on disk differs

A development tool: the tests read the JSON files and never import this script (nor ASE or pymatgen).
Skips are not written by hand here: each case skips a language until the ops it runs are registered there
(``tests/ops`` in Python, ``tests/js/ops`` listed through Node.js), so regenerating after a task registered its
ops puts no stale skip back.  An ``xfail`` marker a task added to a case is kept (matched by case id).

The structures of the M3 test plan (§7.1) are built analytically: fcc, bcc and hcp faces plane by plane from the
lattice (the primitive cell of the Bravais lattice turned into the surface frame), oxides from the repository's
bulk prototypes (``build.crystal`` with every parameter given) turned and cropped the same way, corundum from its
Wyckoff positions.  pbc T T T is the rule (user decision U2) and every file has T T F twins.

The expected values come from the construction (rows, spacings, which atoms were added as adsorbates) and from a
plain re-implementation of M3 §3 as amended by the API ledgers: direction and period, the U1 cut through
``crystallume.analysis.vacuum`` (``surface_normal(...)["cut"]``, the display's cut), single-linkage clustering,
row statistics and warnings, stoichiometric units, the bond graph, the adsorbate guess and the closed-form
exposure.  Every analytic value of M3 §7.1 (d-spacings, kappa* thresholds, atoms per row, adsorbate sets) is
asserted here, and the script stops when a value lies so close to a threshold that rounding could flip it.
The op contracts and the decisions behind the expectations are in ``tests/data/surface/layers/README.md``.
"""

from __future__ import annotations

import argparse
import functools
import json
import math
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, NamedTuple, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "data" / "surface" / "layers"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from crystallume import Structure, build  # noqa: E402
from crystallume.analysis.vacuum import display_cuts, surface_normal, unwrap_along_gap, vacuum_gap_hint  # noqa: E402
from crystallume.core.defaults import SURFACE_DEFAULTS  # noqa: E402
from crystallume.core.elements import covalent_radius  # noqa: E402
from crystallume.core.lattice import wrap_fractional  # noqa: E402

SCHEMA = "crystallume.cases/1"

# ------------------------------------------------------------------------------------------------ constants
#: The M3 keys of SURFACE_DEFAULTS (M3 §3); M3-T1/T3a/T3b add them to core/defaults.py and core/defaults.js.
M3_DEFAULTS = {
    "layer_tolerance": 0.3,
    "layer_tolerance_max": 5.0,
    "layer_borderline": 0.15,
    "layer_rumple_min": 0.6,
    "period_max_index": 12,
    "period_min": 0.5,
    "surface_probe": 0.70,
    "surface_borderline": 0.10,
    "bond_scale": 1.15,
    "bond_min": 0.4,
    "bond_max": 5.0,
}
for _k, _v in M3_DEFAULTS.items():
    if _k in SURFACE_DEFAULTS and SURFACE_DEFAULTS[_k] != _v:
        raise SystemExit(f"SURFACE_DEFAULTS.{_k} = {SURFACE_DEFAULTS[_k]!r}, but M3 §3 says {_v!r}: "
                         "update this script")
K = {**M3_DEFAULTS, "position_tolerance": SURFACE_DEFAULTS.position_tolerance}

#: The element sets of the smart metal-metal rule (``web/js/core/elements.js``; M2-T2 adds the same to Python).
METALS = frozenset(
    "Li Be Na Mg Al K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn "
    "Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po "
    "Fr Ra Ac Th Pa U Np Pu Am Cm".split())
ANIONS = frozenset("O F S Cl N Se Br I Te P C H As".split())
NONMETALS = ANIONS - METALS

#: Lattice constants (Å) used throughout; every case gives its own explicitly.
A_FCC = {"Ni": 3.524, "Cu": 3.615, "Rh": 3.803, "Pd": 3.891, "Pt": 3.92, "Au": 4.078, "Ag": 4.086}
A_BCC = {"Fe": 2.866, "Mo": 3.147, "W": 3.165}
VAC = 15.0      # the vacuum of every built slab (Å, total gap between the slab and its periodic image)
DIGITS = 10     # positions and cells are written with 10 decimals; expectations are computed from those values

#: The task that registers each op (ledger L-M3-01, L-M3-03…05; ``group="units"`` comes with findLayers in
#: M3-T1); the skips name it, and ``tests/test_layers_golden_shape.py`` checks them against the same table.
REGISTERED_BY = {
    "findLayers": "M3-T1",
    "findAdsorbates": "M3-T3a",
    "bondGraph": "M3-T3a",
    "markAdsorbates": "M3-T3a",
    "surfaceAtoms": "M3-T3b (wave 2)",
}


class Fragile(AssertionError):
    """A value is so close to a threshold that rounding in another implementation could flip the result."""


# ------------------------------------------------------------------------------------------------ small helpers
def _r(x: float) -> float:
    return float(round(float(x), DIGITS)) + 0.0


def num(x: float) -> str:
    """A user-given number in messages: shortest form, integers without a decimal point (JS ``String(x)``)."""
    x = float(x)
    return str(int(x)) if x.is_integer() else repr(x)


def dec2(x: float) -> str:
    """Two decimals, halves rounded up (``format_decimal(x, 2)`` of L-M1-15)."""
    v = abs(float(x)) * 100.0
    if abs(v - math.floor(v) - 0.5) < 1e-6:
        raise Fragile(f"{x!r} rounds ambiguously to two decimals")
    q = math.floor(v + 0.5)
    sign = "-" if x < 0 and q != 0 else ""
    return f"{sign}{q // 100}.{q % 100:02d}"


def dot3(a: Sequence[float], b: Sequence[float]) -> float:
    return (a[0] * b[0] + a[1] * b[1]) + a[2] * b[2]


def norm3(v: Sequence[float]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def unit(v: Sequence[float]) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    n = norm3(v)
    if not (n > 0) or not math.isfinite(n):
        raise ValueError("direction vector must be non-zero and finite")
    return v / n


def plane_normal(cell: np.ndarray, k: int) -> np.ndarray:
    """Unit normal of the planes spanned by the two other cell vectors, on the +a_k side."""
    n = unit(np.cross(cell[(k + 1) % 3], cell[(k + 2) % 3]))
    return -n if float(dot3(n, cell[k])) < 0 else n


def heights(pos: np.ndarray, n: Sequence[float]) -> np.ndarray:
    """``h = (x n0 + y n1) + z n2`` in the fixed order of M3 §3.3."""
    return (pos[:, 0] * n[0] + pos[:, 1] * n[1]) + pos[:, 2] * n[2]


def spacing(cell: np.ndarray, k: int) -> float:
    return abs(float(np.linalg.det(cell))) / norm3(np.cross(cell[(k + 1) % 3], cell[(k + 2) % 3]))


def composition(symbols: Sequence[str], atoms: Sequence[int]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i in atoms:
        out[symbols[i]] = out.get(symbols[i], 0) + 1
    return out


def make(symbols: Sequence[str], positions: Any, cell: Any, pbc: Sequence[bool], *, name: str,
         props: dict | None = None, info: dict | None = None) -> Structure:
    """A structure exactly as the tests will load it: coordinates rounded to DIGITS decimals."""
    doc: dict[str, Any] = {
        "schema": "crystallume.structure/1", "name": name, "symbols": list(symbols),
        "positions": [[_r(x) for x in p] for p in np.asarray(positions, float).reshape(-1, 3)],
        "cell": None if cell is None else [[_r(x) for x in row] for row in np.asarray(cell, float)],
        "pbc": [bool(b) for b in pbc],
    }
    if props:
        doc["props"] = props
    if info:
        doc["info"] = info
    return Structure.from_dict(json.loads(json.dumps(doc)))


def to_doc(s: Structure) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "schema": "crystallume.structure/1", "name": s.name, "symbols": list(s.symbols),
        "positions": [[_r(x) for x in p] for p in s.positions],
        "cell": None if s.cell is None else [[_r(x) for x in row] for row in s.cell],
        "pbc": [bool(b) for b in s.pbc],
    }
    if s.props:
        doc["props"] = json.loads(json.dumps(s.props))
    if s.info:
        doc["info"] = json.loads(json.dumps(s.info))
    return doc


def with_(s: Structure, *, symbols=None, positions=None, cell=None, pbc=None, props=None, info=None,
          name=None) -> Structure:
    """A copy of *s* with some fields replaced (rounded like :func:`make`)."""
    return make(s.symbols if symbols is None else symbols, s.positions if positions is None else positions,
                s.cell if cell is None else cell, s.pbc if pbc is None else pbc, name=name or s.name,
                props=dict(s.props) if props is None else props, info=dict(s.info) if info is None else info)


def append(s: Structure, symbols: Sequence[str], positions: Any, *, name: str | None = None,
           props: dict | None = None) -> Structure:
    """*s* with atoms appended at the end (props given explicitly for the whole new atom list)."""
    pos = np.vstack([s.positions, np.asarray(positions, float).reshape(-1, 3)])
    return make(list(s.symbols) + list(symbols), pos, s.cell, s.pbc, name=name or s.name, props=props or {},
                info=dict(s.info))


def relabel_ttf(s: Structure, name: str | None = None) -> Structure:
    return with_(s, pbc=[True, True, False], name=name or s.name + " (pbc T T F)")


# ------------------------------------------------------------------------------------------------ integer lattice
def egcd(a: int, b: int) -> tuple[int, int, int]:
    """``(g, x, y)`` with ``a x + b y = g = gcd(a, b) >= 0``."""
    if b == 0:
        return abs(a), (1 if a >= 0 else -1), 0
    g, x, y = egcd(b, a % b)
    return g, y, x - (a // b) * y


def plane_basis(m: Sequence[int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Integer rows ``v1, v2`` spanning ``{t : m·t = 0}`` and ``w`` with ``m·w = 1`` (m primitive)."""
    m1, m2, m3 = (int(x) for x in m)
    g = math.gcd(m2, m3)
    if g == 0:
        return np.array([0, 1, 0]), np.array([0, 0, 1]), np.array([m1, 0, 0])
    _, p, q = egcd(m2, m3)
    v1 = np.array([0, m3 // g, -m2 // g])
    v2 = np.array([g, -m1 * p, -m1 * q])
    _, a, b = egcd(m1, g)
    w = np.array([a, b * p, b * q])
    assert int(np.dot(m, v1)) == 0 and int(np.dot(m, v2)) == 0 and int(np.dot(m, w)) == 1
    return v1, v2, w


def primitive(m: Sequence[int]) -> list[int]:
    g = 0
    for x in m:
        g = math.gcd(g, int(x))
    return [int(x) // g for x in m]


def adjugate(B: np.ndarray) -> np.ndarray:
    """Integer inverse of a unimodular 3×3 integer matrix (det = 1)."""
    B = [[int(x) for x in row] for row in B]
    det = (B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0])
           + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]))
    assert det == 1, det
    adj = [[0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            r = [x for x in range(3) if x != j]
            c = [x for x in range(3) if x != i]
            minor = B[r[0]][c[0]] * B[r[1]][c[1]] - B[r[0]][c[1]] * B[r[1]][c[0]]
            adj[i][j] = (-1) ** (i + j) * minor
    return np.array(adj, dtype=float)


# ------------------------------------------------------------------------------------------------ bulk and slabs
class Bulk(NamedTuple):
    cell: np.ndarray        # rows a, b, c (Å)
    frac: np.ndarray        # (n, 3)
    symbols: list[str]


FCC_P = np.array([[0.0, 0.5, 0.5], [0.5, 0.0, 0.5], [0.5, 0.5, 0.0]])
BCC_P = np.array([[-0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5]])


def bravais(kind: str, element: str, a: float) -> Bulk:
    """The primitive cell (one atom) of an fcc or bcc metal."""
    return Bulk((FCC_P if kind == "fcc" else BCC_P) * a, np.zeros((1, 3)), [element])


def cubic_miller(kind: str, hkl: Sequence[int]) -> list[int]:
    """Miller indices of a cubic (hkl) family in the primitive basis of the fcc or bcc lattice."""
    P = FCC_P if kind == "fcc" else BCC_P
    m = [int(round(2 * float(np.dot(P[i], hkl)))) for i in range(3)]
    return primitive(m)


def hexagonal(a: float, c: float) -> np.ndarray:
    return np.array([[a, 0.0, 0.0], [-a / 2, a * math.sqrt(3) / 2, 0.0], [0.0, 0.0, c]])


def from_builder(prototype: str, elements: Sequence[str], **kw: Any) -> Bulk:
    s = build.crystal(prototype, list(elements), **kw)
    return Bulk(np.asarray(s.cell, float), np.asarray(s.frac_positions, float), list(s.symbols))


def fluorite_primitive(a: float, cation: str = "Ce", anion: str = "O") -> Bulk:
    return Bulk(FCC_P * a, np.array([[0, 0, 0], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]]), [cation, anion, anion])


def corundum(a: float = 4.759, c: float = 12.991, z_al: float = 0.3523, x_o: float = 0.3064) -> Bulk:
    """α-Al2O3 in the hexagonal setting of R-3c (12 Al at 12c, 18 O at 18e)."""
    ops = [(1, 0, 0, 0, 1, 0, 0, 0, 1, 0), (0, -1, 0, 1, -1, 0, 0, 0, 1, 0), (-1, 1, 0, -1, 0, 0, 0, 0, 1, 0),
           (0, 1, 0, 1, 0, 0, 0, 0, -1, 0.5), (-1, 0, 0, -1, 1, 0, 0, 0, -1, 0.5), (1, -1, 0, 0, -1, 0, 0, 0, -1, 0.5)]
    full = []
    for o in ops:  # with the inversion
        full.append(o)
        full.append(tuple(-x for x in o[:9]) + (-o[9],))
    centres = [(0, 0, 0), (2 / 3, 1 / 3, 1 / 3), (1 / 3, 2 / 3, 2 / 3)]
    syms: list[str] = []
    fr: list[np.ndarray] = []
    for sym, p in (("Al", (0.0, 0.0, z_al)), ("O", (x_o, 0.0, 0.25))):
        for o in full:
            R = np.array(o[:9], float).reshape(3, 3)
            q = R @ np.array(p) + np.array([0, 0, o[9]])
            for t in centres:
                r = (q + t) % 1.0
                r[r > 1 - 1e-9] = 0.0
                if any(np.allclose((r - f + 0.5) % 1 - 0.5, 0, atol=1e-6) for f in fr):
                    continue
                syms.append(sym)
                fr.append(r)
    assert syms.count("Al") == 12 and syms.count("O") == 18
    return Bulk(hexagonal(a, c), np.array(fr), syms)


class Plane(NamedTuple):
    z: float
    atoms: list[tuple[str, float, float]]      # (symbol, fa, fb) in the 1×1 surface mesh


class Oriented(NamedTuple):
    """A bulk crystal in the surface frame: in-plane mesh U, V (z = 0), stacking vector W (W_z = plane spacing)."""
    U: np.ndarray
    V: np.ndarray
    W: np.ndarray
    planes: list[Plane]          # the atomic planes of `reps` stacking periods, bottom to top


def _gauss(U: np.ndarray, V: np.ndarray, iu: np.ndarray, iv: np.ndarray):
    """Lagrange-Gauss reduction keeping the orientation; hexagonal meshes come out at 120°."""
    for _ in range(1000):
        mu = math.floor(float(np.dot(U, V)) / float(np.dot(U, U)) + 0.5)
        V, iv = V - mu * U, iv - mu * iu
        if float(np.dot(V, V)) < float(np.dot(U, U)) - 1e-9:
            U, V, iu, iv = V, -U, iv, -iu
            continue
        break
    if float(np.dot(U, V)) > 1e-9 and abs(float(np.dot(V - U, V - U)) - float(np.dot(V, V))) < 1e-6:
        V, iv = V - U, iv - iu
    return U, V, iu, iv


def orient(bulk: Bulk, m: Sequence[int], reps: int) -> Oriented:
    """The bulk in the surface frame of the lattice planes with Miller indices *m* (in the bulk's own basis)."""
    m = primitive(m)
    v1, v2, w = plane_basis(m)
    A = bulk.cell
    U, V, W = v1 @ A, v2 @ A, w @ A
    if float(np.dot(np.cross(U, V), W)) < 0:
        V, v2 = -V, -v2
    U, V, v1, v2 = _gauss(U, V, v1, v2)
    n = unit(np.cross(U, V))
    # stacking vector with the smallest in-plane part
    ex = U / norm3(U)
    ey = np.cross(n, ex)
    Up = np.array([norm3(U), 0.0, 0.0])
    Vp = np.array([float(np.dot(V, ex)), float(np.dot(V, ey)), 0.0])
    Wp = np.array([float(np.dot(W, ex)), float(np.dot(W, ey)), float(np.dot(W, n))])
    beta = Wp[1] / Vp[1]
    alpha = (Wp[0] - beta * Vp[0]) / Up[0]
    ia, ib = math.floor(alpha + 0.5), math.floor(beta + 0.5)
    w = w - ia * v1 - ib * v2
    Wp = Wp - ia * Up - ib * Vp
    B = np.array([v1, v2, w])
    fnew = bulk.frac @ adjugate(B)
    fnew = fnew - np.floor(fnew + 1e-9)
    wa = (Wp[0] - (Wp[1] / Vp[1]) * Vp[0]) / Up[0]
    wb = Wp[1] / Vp[1]
    d = Wp[2]
    raw: list[tuple[float, str, float, float]] = []
    for r in range(reps):
        for sym, f in zip(bulk.symbols, fnew):
            t = f[2] + r
            fa, fb = (f[0] + t * wa) % 1.0, (f[1] + t * wb) % 1.0
            fa = 0.0 if fa > 1 - 1e-9 else fa
            fb = 0.0 if fb > 1 - 1e-9 else fb
            raw.append((t * d, sym, fa, fb))
    raw.sort(key=lambda x: x[0])
    planes: list[Plane] = []
    for z, sym, fa, fb in raw:
        if planes and z - planes[-1].z < 1e-6:
            planes[-1].atoms.append((sym, fa, fb))
        else:
            planes.append(Plane(z, [(sym, fa, fb)]))
    return Oriented(Up, Vp, Wp, planes)


def plane_comp(p: Plane) -> dict[str, int]:
    out: dict[str, int] = {}
    for sym, _, _ in p.atoms:
        out[sym] = out.get(sym, 0) + 1
    return out


def slab(o: Oriented, start: int, count: int, *, mesh: tuple[int, int] = (1, 1), vacuum: float = VAC,
         place: str | float = "centre", pbc: Sequence[bool] = (True, True, True), name: str = "",
         dz: Callable[[int, str, int], float] | None = None) -> Structure:
    """Planes ``start .. start + count - 1`` of *o* on an n1 × n2 mesh with *vacuum* Å along c (c ∥ z).

    *place*: ``"centre"`` (slab in the middle of the cell), ``"bottom"`` (bottom plane at z = 0), a number (the
    bottom plane's z; the slab is not wrapped), or ``"straddle:<z>"`` (bottom plane at z, then every atom wrapped
    into [0, c), so the slab crosses the cell boundary).  *dz(plane, symbol, atom)* displaces atoms along z.
    Atoms are ordered bottom plane first, then by position in the plane.
    """
    planes = o.planes[start:start + count]
    assert len(planes) == count, "not enough planes: increase reps"
    n1, n2 = mesh
    z0 = planes[0].z
    thick = planes[-1].z - z0
    c = thick + vacuum
    A1, A2 = n1 * o.U, n2 * o.V
    cell = np.array([A1, A2, [0.0, 0.0, c]])
    atoms: list[tuple[int, float, float, str, float]] = []
    for k, p in enumerate(planes):
        for sym, fa, fb in p.atoms:
            for i in range(n1):
                for j in range(n2):
                    atoms.append((k, (fb + j) / n2, (fa + i) / n1, sym, p.z - z0))
    atoms.sort(key=lambda t: (t[0], round(t[1], 8), round(t[2], 8), t[3]))
    if place == "centre":
        shift, wrap = vacuum / 2, False
    elif place == "bottom":
        shift, wrap = 0.0, False
    elif isinstance(place, str) and place.startswith("straddle:"):
        shift, wrap = float(place.split(":", 1)[1]), True
    else:
        shift, wrap = float(place), False
    syms, pos = [], []
    for idx, (k, fb, fa, sym, z) in enumerate(atoms):
        zz = z + shift + (dz(k, sym, idx) if dz else 0.0)
        if wrap:
            zz = zz - c * math.floor(zz / c)
        syms.append(sym)
        pos.append(fa * A1 + fb * A2 + np.array([0.0, 0.0, zz]))
    return make(syms, pos, cell, pbc, name=name)


def find_start(o: Oriented, pattern: Sequence[dict[str, int] | str]) -> int:
    """The first plane index whose compositions match *pattern* (a dict, or a string: the element set)."""
    for s0 in range(1, len(o.planes) - len(pattern)):
        ok = True
        for p, want in zip(o.planes[s0:], pattern):
            comp = plane_comp(p)
            if (set(comp) != set(want.split())) if isinstance(want, str) else comp != want:
                ok = False
                break
        if ok:
            return s0
    raise AssertionError(f"no planes match {pattern}")


def metal_slab(kind: str, element: str, a: float, hkl: Sequence[int], count: int, *, mesh=(1, 1),
               place: str | float = "centre", pbc=(True, True, True), name: str = "", dz=None) -> Structure:
    o = orient(bravais(kind, element, a), cubic_miller(kind, hkl), count + 4)
    return slab(o, 2, count, mesh=mesh, place=place, pbc=pbc, dz=dz,
                name=name or f"{element}({''.join(str(x) for x in hkl)}) {mesh[0]}x{mesh[1]} {count}L")


def hcp_slab(element: str, a: float, c: float, count: int, *, mesh=(1, 1), pbc=(True, True, True)) -> Structure:
    bulk = Bulk(hexagonal(a, c), np.array([[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]]), [element, element])
    o = orient(bulk, (0, 0, 1), count + 4)
    return slab(o, 2, count, mesh=mesh, pbc=pbc, name=f"{element}(0001) {mesh[0]}x{mesh[1]} {count}L")


# ------------------------------------------------------------------------------------------------ positions helpers
def rows_by_z(s: Structure, tol: float = 1e-3) -> list[list[int]]:
    """Atoms grouped by stored z (construction-time helper for standard slabs), bottom to top."""
    z = s.positions[:, 2]
    order = sorted(range(len(s)), key=lambda i: (z[i], i))
    rows: list[list[int]] = []
    for i in order:
        if rows and z[i] - z[rows[-1][-1]] < tol:
            rows[-1].append(i)
        else:
            rows.append([i])
    return [sorted(r) for r in rows]


def inplane_nearest(s: Structure, p: np.ndarray, candidates: Sequence[int]) -> int:
    """The candidate atom whose (x, y) is nearest to *p*'s, over in-plane periodic images."""
    cell = s.cell
    best, arg = math.inf, -1
    for i in candidates:
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                q = s.positions[i] + a * cell[0] + b * cell[1]
                d = math.hypot(q[0] - p[0], q[1] - p[1])
                if d < best - 1e-9:
                    best, arg = d, i
    return arg


def xy_image(s: Structure, i: int, near: np.ndarray) -> np.ndarray:
    """The in-plane periodic image of atom *i* whose (x, y) is nearest to *near*."""
    cell = s.cell
    best, out = math.inf, s.positions[i]
    for a in (-2, -1, 0, 1, 2):
        for b in (-2, -1, 0, 1, 2):
            q = s.positions[i] + a * cell[0] + b * cell[1]
            d = math.hypot(q[0] - near[0], q[1] - near[1])
            if d < best - 1e-9:
                best, out = d, q
    return out


# ================================================================================================= reference: layers
def _cell(s: Structure) -> np.ndarray | None:
    return None if s.cell is None else np.asarray(s.cell, float)


def layer_tolerance(s: Structure, tolerance: float | None) -> float:
    """``tolerance`` -> ``info.surface.layerTolerance`` (a finite positive number) -> the default; then checked."""
    if tolerance is None:
        surf = s.info.get("surface") if isinstance(s.info, dict) else None
        t = surf.get("layerTolerance") if isinstance(surf, dict) else None
        tolerance = t if isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t) and t > 0 \
            else K["layer_tolerance"]
    tol = float(tolerance)
    if not tol > 0:
        raise ValueError(f"tolerance must be > 0 Å (got {num(tol)})")
    if tol > K["layer_tolerance_max"]:
        raise ValueError(f"tolerance must be at most {num(K['layer_tolerance_max'])} Å (got {num(tol)})")
    return tol


def resolve_direction(s: Structure, direction: Any) -> tuple[str, np.ndarray, int | None, str]:
    """M3 §3.1: ``(label, unit normal, axis, source)``."""
    cell = _cell(s)
    if direction is None or direction in ("auto", "normal"):
        sn = surface_normal(s, require_gap=True)
        if sn is not None:
            return "abc"[sn["axis"]], np.array(sn["normal"], float), int(sn["axis"]), str(sn["source"])
        if direction == "normal":
            raise ValueError("direction 'normal' needs a vacuum gap or a non-periodic axis; use 'c'")
        if cell is None:
            return "z", np.array([0.0, 0.0, 1.0]), None, "default"
        return "c", plane_normal(cell, 2), 2, "default"
    if isinstance(direction, str) and direction in ("a", "b", "c"):
        if cell is None:
            raise ValueError(f"direction '{direction}' needs a unit cell; use 'x', 'y', 'z' or a vector")
        k = "abc".index(direction)
        return direction, plane_normal(cell, k), k, "axis"
    if isinstance(direction, str) and direction in ("x", "y", "z"):
        n = np.zeros(3)
        n["xyz".index(direction)] = 1.0
        label = direction
    elif isinstance(direction, (list, tuple)) and len(direction) == 3:
        n, label = unit(direction), "vector"
    elif isinstance(direction, dict) and ("hkl" in direction or "hkil" in direction):
        if cell is None:
            raise ValueError("direction 'hkl' needs a unit cell; use 'x', 'y', 'z' or a vector")
        if "hkil" in direction:
            h, k, i, l = direction["hkil"]
            if i != -(h + k):
                raise ValueError(f"four-index (h k i l) needs i = -(h + k) (got {num(h)} {num(k)} {num(i)} {num(l)})")
            hkl = (h, k, l)
        else:
            hkl = direction["hkl"]
        rec = np.linalg.inv(cell).T
        n, label = unit(hkl[0] * rec[0] + hkl[1] * rec[1] + hkl[2] * rec[2]), "hkl"
    else:
        shown = f"'{direction}'" if isinstance(direction, str) else json.dumps(direction)
        raise ValueError(f"unknown direction {shown}; use 'auto', 'normal', 'a', 'b', 'c', 'x', 'y', 'z', "
                         "a vector or {'hkl': [h, k, l]}")
    axis = None
    if cell is not None:
        for k in range(3):
            if abs(float(dot3(n, plane_normal(cell, k)))) > 1 - 1e-9:
                axis = k
    return label, n, axis, "given"


def period_along(cell: np.ndarray | None, pbc: Sequence[bool], n: np.ndarray, tol: float) -> tuple[float | None, str]:
    """M3 §3.2."""
    if cell is None or not any(pbc):
        return None, "invariant"
    scale = max(norm3(cell[k]) for k in range(3))
    nz = [abs(float(dot3(cell[k], n))) for k in range(3) if pbc[k] and abs(float(dot3(cell[k], n))) > 1e-9 * scale]
    if not nz:
        return None, "invariant"
    p0 = min(nz)
    for m in range(1, K["period_max_index"] + 1):
        P = p0 / m
        if P < max(K["period_min"], 2 * tol):
            break
        if all(abs(x / P - round(x / P)) < 1e-6 * max(1.0, abs(x / P)) for x in nz):
            return P, "periodic"
    return None, "irrational"


def ring_cut(h: np.ndarray, P: float, C: Sequence[int], tol: float) -> tuple[np.ndarray, np.ndarray, bool]:
    """M3 §3.3, a periodic direction that is not the slab axis: cut the ring of heights in its widest gap."""
    w = h - P * np.floor(h / P)
    w[w >= P * (1 - 1e-12)] = 0.0
    spans = False
    if not C:
        u = w.copy()
    else:
        order = sorted(C, key=lambda i: (w[i], i))
        ws = [float(w[i]) for i in order]
        m = len(ws)
        gaps = [ws[t + 1] - ws[t] for t in range(m - 1)] + [ws[0] + P - ws[m - 1]]
        if max(gaps) <= tol:
            u, spans = w.copy(), True
        else:
            top = max(gaps)
            cand = [t for t in range(m) if gaps[t] >= top - K["position_tolerance"]]
            j = m - 1 if (m - 1) in cand else cand[0]
            mid = ws[j] + gaps[j] / 2
            u = np.where(w > mid, w - P, w)
    offset = np.rint((h - u) / P).astype(int)
    return u, offset, spans


def ref_layers(s: Structure, direction: Any = None, tolerance: float | None = None, *, indices=None,
               skip_adsorbates: bool = False, group: str = "planes") -> dict[str, Any]:
    """M3 §3.1-3.6 with the ledger's cut (L-M3-01): every field the findLayers op reports, plus the rows."""
    N = len(s)
    tol = layer_tolerance(s, tolerance)
    if indices is not None:
        for i in indices:
            if not (isinstance(i, int) and 0 <= i < N):
                raise IndexError(f"atom index {i} is out of range (the structure has {N} atoms)")
    label, n, axis, source = resolve_direction(s, direction)
    cell = _cell(s)
    pbc = [bool(b) for b in s.pbc]
    P, kind = period_along(cell, pbc, n, tol)
    excluded: list[int] = []
    adsorbates = None
    if skip_adsorbates:
        a = ref_adsorbates(s, direction=direction, tolerance=tol)
        excluded = list(a["indices"])
        adsorbates = {"indices": list(a["indices"]), "source": a["source"]}
    C = sorted(set(range(N) if indices is None else indices) - set(excluded))
    pos = np.asarray(s.positions, float)
    h = heights(pos, n)
    offset = np.zeros(N, int)
    vacuum = None
    spans = False
    coords = {"invariant": "invariant", "periodic": "periodic", "irrational": "wrapped"}[kind]
    if kind == "periodic":
        sn = surface_normal(s, require_gap=True)
        if axis is not None and pbc[axis] and sn is not None and sn["axis"] == axis:
            f = np.asarray(s.frac_positions[:, axis], float)
            offset = np.rint(f - unwrap_along_gap(f, sn["cut"])).astype(int)
            u = h - offset * P
            vacuum = float(sn["cut"]["width"])        # the width of the gap that is cut (M3 §3.3 gap.width)
        else:
            u, offset, spans = ring_cut(h, P, C, tol)
    elif kind == "irrational":
        f = np.array(s.frac_positions, float)
        cuts = display_cuts(s)
        for k in range(3):
            if not pbc[k]:
                continue
            if cuts[k] is not None:
                f[:, k] = unwrap_along_gap(f[:, k], cuts[k])
            else:
                f = wrap_fractional(f, [kk == k for kk in range(3)])
        u = heights(f @ cell, n)
    else:
        u = h.copy()
    # linear single linkage
    index = np.full(N, -1, int)
    rows: list[dict[str, Any]] = []
    if C:
        order = sorted(C, key=lambda i: (float(u[i]), i))
        members = [[order[0]]]
        for a_, b_ in zip(order, order[1:]):
            gap = float(u[b_]) - float(u[a_])
            if abs(gap - tol) < 1e-6:
                raise Fragile(f"{s.name}: a gap of {gap!r} Å is too close to the tolerance {tol}")
            if gap > tol:
                members.append([b_])
            else:
                members[-1].append(b_)
        for k, mem in enumerate(members):
            rows.append(_row(s, u, sorted(mem)))
    _link(rows)
    planes = rows
    # the warnings are about the clustering, so they describe the atomic planes in both groupings
    warnings = layer_warnings(s, planes, tol, label, coords, spans, cell is None and direction in (None, "auto"))
    stoich: list[bool] | None = None
    if group == "units":
        units = stoich_units(s, planes, C)
        if units is None:
            warnings.append("No repeating stoichiometric unit was found; showing atomic planes.")
        else:
            rows = [_row(s, u, sorted(a for k in range(lo, hi + 1) for a in planes[k]["atoms"])) for lo, hi, _ in units]
            _link(rows)
            stoich = [st for _, _, st in units]
    for k, row in enumerate(rows):
        for i in row["atoms"]:
            index[i] = k
    L = len(rows)
    from_top = np.where(index >= 0, L - 1 - index, -1)
    if skip_adsorbates and excluded and rows:
        lo_h, hi_h = rows[0]["min"], rows[-1]["max"]
        if all(float(u[i]) < (lo_h + hi_h) / 2 for i in excluded):
            warnings.append("The detected adsorbates are on the bottom side of the slab.")
    return {
        "count": L, "atomLayer": index.tolist(), "atomFromTop": from_top.tolist(), "offset": offset.tolist(),
        "height": [float(x) for x in u], "heights": [r["height"] for r in rows],
        "compositions": [r["composition"] for r in rows], "rows": rows, "planes": planes,
        "normal": [float(x) + 0.0 for x in n], "direction": label, "normalSource": source, "axis": axis,
        "tolerance": tol, "group": group, "coords": coords, "period": P, "vacuum": vacuum,
        "straddles": bool(C) and len({int(offset[i]) for i in C}) > 1, "spansPeriod": spans,
        "excluded": excluded, "adsorbates": adsorbates, "warnings": warnings,
        "stoichiometric": stoich, "planeCount": len(planes),
    }


def _link(rows: list[dict[str, Any]]) -> None:
    for k, row in enumerate(rows):
        below = rows[k - 1] if k else None
        row["gapBelow"] = None if below is None else row["min"] - below["max"]
        row["spacingBelow"] = None if below is None else row["height"] - below["height"]


def _row(s: Structure, u: np.ndarray, atoms: list[int]) -> dict[str, Any]:
    total = 0.0
    for i in atoms:            # in atom order, one by one (M3 §3.4)
        total += float(u[i])
    hs = sorted(float(u[i]) for i in atoms)
    inner = max((b - a for a, b in zip(hs, hs[1:])), default=0.0)
    return {"atoms": atoms, "height": total / len(atoms), "min": hs[0], "max": hs[-1], "innerGap": inner,
            "rumpling": hs[-1] - hs[0], "composition": composition(s.symbols, atoms)}


def _limit(name: str, value: float, threshold: float) -> None:
    if abs(value - threshold) < 1e-6:
        raise Fragile(f"{name}: {value!r} is too close to the threshold {threshold!r}")


def layer_warnings(s: Structure, rows: list[dict], tol: float, label: str, coords: str, spans: bool,
                   no_cell: bool) -> list[str]:
    """M3 §3.5, kind by kind in the order of its table; within a kind from the top row down; more than three of
    a kind: the first three and then ``… and N more``."""
    L = len(rows)
    rumpled, steps, merges = [], [], []
    margin = K["layer_borderline"]
    for k in range(L - 1, -1, -1):              # top row first
        row = rows[k]
        top = L - k
        limit = max(2 * tol, K["layer_rumple_min"])
        _limit(f"{s.name} row {top} rumpling", row["rumpling"], limit)
        if row["rumpling"] > limit:
            rumpled.append(f"Layer {top} is rumpled by {dec2(row['rumpling'])} Å. "
                           "If it should be two layers, lower the tolerance.")
        _limit(f"{s.name} row {top} step", row["innerGap"], tol - margin)
        if row["innerGap"] >= tol - margin and row["innerGap"] > 0:
            steps.append(f"Layer {top} has a {dec2(row['innerGap'])} Å step, close to the {num(tol)} Å tolerance: "
                         "it may split after relaxation.")
        if row["gapBelow"] is not None:
            _limit(f"{s.name} gap below row {top}", row["gapBelow"], tol + margin)
            if row["gapBelow"] <= tol + margin:
                merges.append(f"Layers {top} and {top + 1} are only {dec2(row['gapBelow'])} Å apart, close to the "
                              f"{num(tol)} Å tolerance: they may merge after relaxation.")
    out: list[str] = []
    for kind in (rumpled, steps, merges):
        out += kind if len(kind) <= 3 else kind[:3] + [f"… and {len(kind) - 3} more"]
    if spans:
        out.append(f"No gap larger than the tolerance along {label}: all atoms form one layer.")
    if coords == "wrapped":
        out.append("This direction is not normal to a lattice plane, so heights use the atoms wrapped into the cell "
                   "as drawn.")
    if no_cell:
        out.append("No unit cell: layers are counted along z.")
    occ = s.props.get("occupancy")
    if occ is not None and any(float(x) < 1 for x in occ):
        out.append("Some sites are partially occupied; layer counts include every site.")
    return out


def parse_formula(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    i = 0
    while i < len(text):
        j = i + 1
        while j < len(text) and text[j].islower():
            j += 1
        k = j
        while k < len(text) and text[k].isdigit():
            k += 1
        out[text[i:j]] = out.get(text[i:j], 0) + (int(text[j:k]) if k > j else 1)
        i = k
    return out


def _proportional(comp: dict[str, int], target: dict[str, int]) -> bool:
    if set(comp) != set(target):
        return False
    ratios = {Fraction(comp[e], target[e]) for e in target}
    return len(ratios) == 1


def stoich_units(s: Structure, planes: list[dict], C: Sequence[int]) -> list[tuple[int, int, bool]] | None:
    """M3 §3.6: contiguous groups of planes; most groups proportional to the target, then fewest others; ties: the
    split points as high as possible (the first group from the top as short as possible, then the next...).
    Returns ``[(lo, hi, stoichiometric)]`` with bottom-based plane indices, bottom group first, or None."""
    surf = s.info.get("surface") if isinstance(s.info, dict) else None
    formula = ((surf or {}).get("bulk") or {}).get("reducedFormula") if isinstance(surf, dict) else None
    if isinstance(formula, str) and formula:
        target = parse_formula(formula)
    else:
        comp = composition(s.symbols, C)
        g = 0
        for v in comp.values():
            g = math.gcd(g, v)
        target = {e: v // g for e, v in comp.items()}
    top = list(reversed(planes))                      # index 0 = top plane
    L = len(top)

    def score(i: int, j: int) -> tuple[int, int]:
        comp: dict[str, int] = {}
        for p in top[i:j]:
            for e, c in p["composition"].items():
                comp[e] = comp.get(e, 0) + c
        return (1, 0) if _proportional(comp, target) else (0, -1)

    best: list[tuple[int, int]] = [(0, 0)] * (L + 1)  # best score of the planes i..L-1 (top-based)
    for i in range(L - 1, -1, -1):
        cand = None
        for j in range(i + 1, L + 1):
            a, b = score(i, j)
            v = (a + best[j][0], b + best[j][1])
            if cand is None or v > cand:
                cand = v
        best[i] = cand
    groups: list[tuple[int, int, bool]] = []
    i = 0
    while i < L:
        for j in range(i + 1, L + 1):
            a, b = score(i, j)
            if (a + best[j][0], b + best[j][1]) == best[i]:
                groups.append((L - j, L - 1 - i, a == 1))
                i = j
                break
    if sum(1 for g in groups if g[2]) < 2:
        return None
    return list(reversed(groups))


# ================================================================================================= reference: bonds
class Graph(NamedTuple):
    adj: list[list[tuple[int, tuple[int, int, int], float]]]     # per atom: (j, image offset, distance), sorted


def _image_ranges(s: Structure, reach: float) -> list[range]:
    cell = _cell(s)
    if cell is None:
        return [range(0, 1)] * 3
    frac = s.frac_positions
    out = []
    for k in range(3):
        if not s.pbc[k]:
            out.append(range(0, 1))
            continue
        span = float(frac[:, k].max() - frac[:, k].min())
        m = int(math.ceil(reach / spacing(cell, k) + span)) + 1
        out.append(range(-m, m + 1))
    return out


def ref_graph(s: Structure, metal_pairs: str = "all", indices: Sequence[int] | None = None) -> Graph:
    """M3 §3.7: ``bond_min < d < min(bond_max, bond_scale (r_i + r_j))``, every periodic image an edge."""
    pos = np.asarray(s.positions, float)
    N = len(pos)
    sym = list(s.symbols)
    rad = np.array([covalent_radius(x) for x in sym])
    cut = np.minimum(K["bond_max"], K["bond_scale"] * (rad[:, None] + rad[None, :]))
    cell = _cell(s)
    rng = _image_ranges(s, K["bond_max"])
    adj: list[list] = [[] for _ in range(N)]
    for o0 in rng[0]:
        for o1 in rng[1]:
            for o2 in rng[2]:
                t = np.zeros(3) if cell is None else o0 * cell[0] + o1 * cell[1] + o2 * cell[2]
                dv = (pos[None, :, :] + t) - pos[:, None, :]
                d = np.sqrt(dv[..., 0] * dv[..., 0] + dv[..., 1] * dv[..., 1] + dv[..., 2] * dv[..., 2])
                near = (np.abs(d - cut) < 1e-6) | (np.abs(d - K["bond_min"]) < 1e-6)
                if near.any():
                    i, j = map(int, np.argwhere(near)[0])
                    raise Fragile(f"{s.name}: atoms {i} and {j} are {d[i, j]!r} Å apart, at a bond threshold")
                for i, j in np.argwhere((d > K["bond_min"]) & (d < cut)):
                    adj[int(i)].append((int(j), (o0, o1, o2), float(d[i, j])))
    for lst in adj:
        lst.sort(key=lambda e: (e[0], e[1]))
    if metal_pairs == "smart":
        bonded = [any(sym[j] in NONMETALS for j, _, _ in adj[i]) for i in range(N)]
        for i in range(N):
            if sym[i] in METALS and bonded[i]:
                adj[i] = [e for e in adj[i] if not (sym[e[0]] in METALS and bonded[e[0]])]
    if indices is not None:
        keep = set(indices)
        adj = [[e for e in adj[i] if e[0] in keep] if i in keep else [] for i in range(N)]
    return Graph(adj)


def csr(g: Graph) -> dict[str, Any]:
    indptr = [0]
    for lst in g.adj:
        indptr.append(indptr[-1] + len(lst))
    return {"indptr": indptr, "neighbors": [e[0] for lst in g.adj for e in lst],
            "offsets": [list(e[1]) for lst in g.adj for e in lst], "distances": [e[2] for lst in g.adj for e in lst],
            "degree": [len(lst) for lst in g.adj]}


def components(g: Graph, members: Sequence[int] | None = None) -> list[tuple[list[int], bool]]:
    """Connected blocks of the subgraph on *members*; a block is periodic when it reaches an image of itself."""
    mem = set(range(len(g.adj)) if members is None else members)
    seen: dict[int, tuple[int, int, int]] = {}
    out = []
    for st in sorted(mem):
        if st in seen:
            continue
        seen[st] = (0, 0, 0)
        comp, stack, periodic = [st], [st], False
        while stack:
            i = stack.pop()
            for j, o, _ in g.adj[i]:
                if j not in mem:
                    continue
                oj = (seen[i][0] + o[0], seen[i][1] + o[1], seen[i][2] + o[2])
                if j in seen:
                    periodic |= seen[j] != oj
                    continue
                seen[j] = oj
                comp.append(j)
                stack.append(j)
        out.append((sorted(comp), periodic))
    return out


def two_core(g: Graph, members: Sequence[int]) -> set[int]:
    core = set(members)
    while True:
        drop = {i for i in core if sum(1 for j, _, _ in g.adj[i] if j in core) <= 1}
        if not drop:
            return core
        core -= drop


# ============================================================================================ reference: adsorbates
def ref_adsorbates(s: Structure, *, direction: Any = None, tolerance: float | None = None) -> dict[str, Any]:
    """M3 §3.8: ``{indices, source, notes, substrateElements}``."""
    N = len(s)
    sym = list(s.symbols)
    notes: list[str] = []
    ids = s.props.get("adsorbate_id")
    if ids is not None and any(int(v) > 0 for v in ids):
        return {"indices": [i for i in range(N) if int(ids[i]) > 0], "source": "adsorbate_id", "notes": notes,
                "substrateElements": []}
    tags = s.props.get("tags")
    if tags is not None:
        tags = [int(t) for t in tags]
        vals = set(tags)
        g = ref_graph(s)
        if vals <= {0, 1, 2} and 2 in vals and (0 in vals or 1 in vals):
            two = [i for i in range(N) if tags[i] == 2]
            if not any(p for _, p in components(g, two)):
                return {"indices": two, "source": "tags-oc20", "notes": notes, "substrateElements": []}
        if 0 in vals and any(t > 0 for t in tags):
            cand = [i for i in range(N) if tags[i] == 0]
            if any(p for _, p in components(g, cand)):
                notes.append("Atoms with tag 0 form a periodic layer, so the tags don't mark adsorbates; "
                             "guessed from the geometry.")
            else:
                return {"indices": cand, "source": "tags", "notes": notes, "substrateElements": []}
    none = {"indices": [], "source": "none", "notes": notes, "substrateElements": []}
    if surface_normal(s, require_gap=True) is None:
        return none
    L = ref_layers(s, direction, tolerance)
    if L["count"] < 2:
        return none
    g = ref_graph(s)
    u = L["height"]
    mid = (min(u) + max(u)) / 2
    e_low = {sym[i] for i in range(N) if u[i] <= mid}
    order = sorted(range(N), key=lambda i: (u[i], i))
    q = N // 4
    e_rank = {sym[i] for i in order[q:N - q]}
    E = (e_low & e_rank) or set(e_low)

    def cn_e(i: int, elements: set[str]) -> int:
        return sum(1 for j, _, _ in g.adj[i] if sym[j] in elements)

    while True:
        seeds = []
        for i in range(N):
            if sym[i] in E:
                continue
            host = [j for j in L["rows"][L["atomLayer"][i]]["atoms"] if sym[j] in E]
            if host and cn_e(i, E) >= float(np.median([cn_e(j, E) for j in host])):
                continue                          # substitutional
            seeds.append(i)
        comps = components(g, seeds)
        new: set[str] = set()
        for m_, periodic in comps:
            if periodic:
                new |= {sym[i] for i in two_core(g, m_)}
        new -= E
        if not new:
            break
        E |= new
    ads = {i for m_, periodic in comps if not periodic for i in m_}
    while True:                                   # absorb terminal substrate-element atoms
        grow = set()
        for i in ads:
            for j, _, _ in g.adj[i]:
                if j in ads or sym[j] not in E:
                    continue
                if sum(1 for k, _, _ in g.adj[j] if k not in ads and sym[k] in E) <= 1:
                    grow.add(j)
        if not grow:
            break
        ads |= grow
    whole = components(g)
    if any(p for _, p in whole):                  # free molecules
        for m_, periodic in whole:
            if not periodic and len(m_) <= N / 2:
                ads |= set(m_)
    keep = sorted(i for m_, periodic in components(g, sorted(ads)) if not periodic for i in m_)
    return {"indices": keep, "source": "geometry" if keep else "none", "notes": notes,
            "substrateElements": sorted(E)}


def ref_mark(s: Structure, indices: Sequence[int]) -> dict[str, Any]:
    """M3 §3.13 on a copy: ``promote_adsorbates`` then ``mark_adsorbates(indices)``."""
    N = len(s)
    ids = [int(v) for v in (s.props.get("adsorbate_id") or [0] * N)]
    g = ref_graph(s)
    promoted = 0
    if not any(v > 0 for v in ids):
        a = ref_adsorbates(s)
        if a["source"] in ("tags", "tags-oc20", "geometry") and a["indices"]:
            for k, (m_, _) in enumerate(components(g, a["indices"]), 1):
                for i in m_:
                    ids[i] = k
                promoted = k
    nxt = max([0] + ids) + 1
    marked = 0
    for m_, _ in components(g, sorted(i for i in set(indices) if ids[i] == 0)):
        for i in m_:
            ids[i] = nxt
        nxt += 1
        marked += 1
    return {"promoted": promoted, "marked": marked, "adsorbateId": ids}


# ================================================================================================= reference: exposure
def ref_surface(s: Structure, side: str = "top", *, probe: float | None = None, direction: Any = None,
                tolerance: float | None = None, skip_adsorbates: bool = True) -> dict[str, Any]:
    """M3 §3.9, the closed form on every substrate atom (all in-plane images): what the surfaceAtoms op reports."""
    kappa = K["surface_probe"] if probe is None else float(probe)
    sn = surface_normal(s)
    if sn is None or not sn["surface"]:
        raise ValueError(vacuum_gap_hint(s))
    L = ref_layers(s, direction, tolerance)
    if L["coords"] == "wrapped" or (L["coords"] == "periodic" and L["vacuum"] is None):
        raise ValueError("surface atoms need the slab normal; this direction is not a cell axis")
    N = len(s)
    excluded = set(ref_adsorbates(s, direction=direction, tolerance=tolerance)["indices"]) if skip_adsorbates else set()
    sub = [i for i in range(N) if i not in excluded]
    cell = _cell(s)
    n = np.array(L["normal"], float)
    pos = np.asarray(s.positions, float).copy()
    if L["axis"] is not None:
        pos = pos - np.array(L["offset"], float)[:, None] * cell[L["axis"]][None, :]
    u = heights(pos, n)
    P = pos[sub]
    # R: half the median distance to the nearest substrate atom (all periodic images, > bond_min)
    rng = _image_ranges(s, 6.0)
    nearest = np.full(len(sub), np.inf)
    for o0 in rng[0]:
        for o1 in rng[1]:
            for o2 in rng[2]:
                t = o0 * cell[0] + o1 * cell[1] + o2 * cell[2]
                dv = (P[None, :, :] + t) - P[:, None, :]
                d = np.sqrt(dv[..., 0] * dv[..., 0] + dv[..., 1] * dv[..., 1] + dv[..., 2] * dv[..., 2])
                d[d <= K["bond_min"]] = np.inf
                nearest = np.minimum(nearest, d.min(axis=1))
    R = 0.5 * float(np.median(nearest))
    inplane = [k for k in range(3) if s.pbc[k] and abs(float(dot3(cell[k], n))) <= 1e-9 * norm3(cell[k])]
    us = u[sub]
    out: dict[str, Any] = {"radius": R}
    exposed_by_side: dict[str, list[int]] = {}
    kappas_by_side: dict[str, list[float | None]] = {}
    for name, sigma in (("top", 1.0), ("bottom", -1.0)):
        if side not in (name, "both"):
            continue
        sstar = np.full(len(sub), np.inf)
        higher_any = np.array([bool(np.any(sigma * (us - us[a]) > 0)) for a in range(len(sub))])
        reach = 12.0
        while True:
            sstar = np.full(len(sub), np.inf)
            ranges = [range(0, 1)] * 3
            for k in inplane:
                m = int(math.ceil(reach / spacing(cell, k))) + 2
                ranges[k] = range(-m, m + 1)
            for o0 in ranges[0]:
                for o1 in ranges[1]:
                    for o2 in ranges[2]:
                        t = o0 * cell[0] + o1 * cell[1] + o2 * cell[2]
                        dv = (P[None, :, :] + t) - P[:, None, :]
                        dh = sigma * (us[None, :] - us[:, None])
                        along = dv @ n
                        perp = dv - along[..., None] * n
                        rho = np.sqrt(perp[..., 0] ** 2 + perp[..., 1] ** 2 + perp[..., 2] ** 2)
                        d2 = dv[..., 0] ** 2 + dv[..., 1] ** 2 + dv[..., 2] ** 2
                        with np.errstate(divide="ignore", invalid="ignore"):
                            val = np.where(rho < dh, rho, d2 / (2 * dh))
                        val = np.where(dh > 0, val, np.inf)
                        sstar = np.minimum(sstar, val.min(axis=1))
            if np.all(~higher_any | (sstar < reach)):
                break
            reach *= 2
            if reach > 400:
                raise Fragile(f"{s.name}: exposure needs images beyond 400 Å")
        limit = R * (1 + kappa)
        exp_list, kap_list = [], [None] * N
        for a, i in enumerate(sub):
            if math.isfinite(sstar[a]):
                if abs(sstar[a] - limit) < 1e-5:
                    raise Fragile(f"{s.name}: atom {i} is exposed at kappa* = kappa")
                kap_list[i] = float(sstar[a] / R - 1)
            if sstar[a] >= limit - 1e-6:
                exp_list.append(i)
        exposed_by_side[name] = sorted(exp_list)
        kappas_by_side[name] = kap_list
    atoms = sorted(set().union(*exposed_by_side.values()))
    out["atoms"] = atoms
    out["top"] = exposed_by_side.get("top", [])
    out["bottom"] = exposed_by_side.get("bottom", [])
    border: set[int] = set()
    for kap_list in kappas_by_side.values():
        for i, kv in enumerate(kap_list):
            if kv is not None:
                _limit(f"{s.name} atom {i} borderline", abs(kv - kappa), K["surface_borderline"])
                if abs(kv - kappa) < K["surface_borderline"]:
                    border.add(i)
    out["borderline"] = sorted(border)
    if side in ("top", "bottom"):
        out["exposure"] = kappas_by_side[side]
    return out


# ================================================================================================= cases
TTT = (True, True, True)
TTF = (True, True, False)
LAYER_KEYS = ("count", "atomLayer", "atomFromTop", "offset", "heights", "compositions", "normal", "direction",
              "normalSource", "axis", "tolerance", "coords", "period", "vacuum", "straddles", "spansPeriod",
              "excluded", "adsorbates", "warnings")
TOL_LAYERS = {"heights": 1e-6, "period": 1e-6, "vacuum": 1e-6}
TOL_SURFACE = {"radius": 1e-6, "exposure": 1e-6}


def skip_parts(op: str, args: dict[str, Any]) -> list[tuple[str, str]]:
    """``(op, reason part)`` for every op a case runs: its own, and findAdsorbates for ``skipAdsorbates``."""
    parts = [(op, f"op {op} is registered by {REGISTERED_BY[op]}")]
    if op == "findLayers" and args.get("skipAdsorbates"):
        parts.append(("findAdsorbates", f"skipAdsorbates needs op findAdsorbates ({REGISTERED_BY['findAdsorbates']})"))
    return parts


@functools.lru_cache(maxsize=1)
def registered_ops() -> dict[str, frozenset[str]]:
    """The case ops registered now in each language: ``tests/ops`` and ``tests/js/ops`` (listed through Node)."""
    import tests.ops  # noqa: F401  (registers every Python op)
    from tests.cases import OPS
    from tests.js_bridge import JSError, NodeUnavailable, run_js

    try:
        js = run_js("const { OPS, loadOps } = await repo('tests/js/cases.mjs'); await loadOps(); "
                    "return [...OPS.keys()];")
    except (NodeUnavailable, JSError) as exc:
        raise SystemExit(f"the skips follow the ops each language registers; listing tests/js/ops needs "
                         f"Node.js: {exc}") from None
    return {"py": frozenset(OPS), "js": frozenset(js)}


def skip_for(op: str, args: dict[str, Any], registered: dict[str, frozenset[str]]) -> dict[str, str]:
    """The case's ``skip``: per language, the parts of the ops not registered there yet (README.md, "Skips")."""
    out = {}
    for lang in ("py", "js"):
        reason = "; ".join(part for name, part in skip_parts(op, args) if name not in registered[lang])
        if reason:
            out[lang] = reason
    return out


def _clean(x: Any) -> Any:
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, np.ndarray):
        return _clean(x.tolist())
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        if not math.isfinite(float(x)):
            raise ValueError("non-finite number in an expectation")
        return float(round(float(x), 12)) + 0.0
    return x


#: Case ids are ``m3-<family>-<name>``, the family named after the op.
OP_FAMILY = {"findLayers": "layers", "findAdsorbates": "ads", "bondGraph": "bonds", "markAdsorbates": "mark",
             "surfaceAtoms": "exposure"}


def case(cid: str, op: str, inp: Structure | dict, expect: dict[str, Any], *, args: dict | None = None,
         tol: dict | None = None, note: str | None = None) -> dict[str, Any]:
    family = OP_FAMILY[op]
    out: dict[str, Any] = {"id": f"m3-{cid if cid.startswith(family + '-') else family + '-' + cid}", "op": op}
    if note:
        out["note"] = note
    if args:
        out["args"] = args
    out["input"] = {"structure": to_doc(inp)} if isinstance(inp, Structure) else inp
    out["expect"] = _clean(expect)
    if tol:
        out["tol"] = {k: v for k, v in tol.items() if k in expect}
        if not out["tol"]:
            del out["tol"]
    return out                                    # render() adds the skip and keeps an xfail from the disk


def py_layer_args(args: dict[str, Any]) -> dict[str, Any]:
    names = {"direction": "direction", "tolerance": "tolerance", "indices": "indices",
             "skipAdsorbates": "skip_adsorbates", "group": "group"}
    return {names[k]: v for k, v in args.items()}


def load_input(inp: Structure | dict) -> Structure:
    if isinstance(inp, Structure):
        return inp
    from crystallume.io import read
    return read(ROOT / "tests" / "data" / inp["file"])


def layers_case(cid: str, inp: Structure | dict, args: dict | None = None, *, note: str | None = None,
                check: Callable[[dict], None] | None = None) -> dict[str, Any]:
    args = dict(args or {})
    L = ref_layers(load_input(inp), **py_layer_args(args))
    if check:
        check(L)
    exp = {k: L[k] for k in LAYER_KEYS}
    exp["warnings"] = {"equals": L["warnings"]}
    if args.get("group") == "units":
        exp.update(group=L["group"], stoichiometric=L["stoichiometric"], planeCount=L["planeCount"])
    return case(cid, "findLayers", inp, exp, args=args or None, tol=TOL_LAYERS, note=note)


def error_case(cid: str, op: str, inp: Structure, args: dict, message: str, run: Callable[[], Any],
               note: str | None = None) -> dict[str, Any]:
    try:
        run()
    except (ValueError, IndexError, TypeError) as exc:
        if message not in str(exc):
            raise AssertionError(f"{cid}: expected {message!r}, the reference says {exc}") from exc
    else:
        raise AssertionError(f"{cid}: the reference does not raise")
    return case(cid, op, inp, {"error": message}, args=args, note=note)


def ads_case(cid: str, inp: Structure, want: Sequence[int], source: str, *, args: dict | None = None,
             notes: Sequence[str] = (), note: str | None = None) -> dict[str, Any]:
    args = dict(args or {})
    a = ref_adsorbates(inp, direction=args.get("direction"), tolerance=args.get("tolerance"))
    if a["indices"] != sorted(want) or a["source"] != source or a["notes"] != list(notes):
        raise AssertionError(f"{cid}: the guess gives {a}, the construction says {sorted(want)} ({source})")
    exp = {"indices": a["indices"], "source": a["source"], "notes": a["notes"]}
    if source == "geometry":
        exp["substrateElements"] = a["substrateElements"]
    return case(cid, "findAdsorbates", inp, exp, args=args or None, note=note)


def bonds_case(cid: str, inp: Structure, args: dict | None = None, *, full: bool = False,
               note: str | None = None, check: Callable[[dict], None] | None = None) -> dict[str, Any]:
    args = dict(args or {})
    g = ref_graph(inp, metal_pairs=args.get("metalPairs", "all"), indices=args.get("indices"))
    data = csr(g)
    if check:
        check(data)
    exp: dict[str, Any] = {"degree": data["degree"],
                           "components": [{"members": m, "periodic": p} for m, p in components(g)]}
    if full:
        exp.update({k: data[k] for k in ("indptr", "neighbors", "offsets", "distances")})
    return case(cid, "bondGraph", inp, exp, args=args or None, note=note)


def surface_case(cid: str, inp: Structure | dict, args: dict | None = None, *, note: str | None = None,
                 check: Callable[[dict], None] | None = None) -> dict[str, Any]:
    args = dict(args or {})
    names = {"side": "side", "probe": "probe", "direction": "direction", "tolerance": "tolerance",
             "skipAdsorbates": "skip_adsorbates"}
    kw = {names[k]: v for k, v in args.items()}
    r = ref_surface(load_input(inp), **kw)
    if check:
        check(r)
    side = args.get("side", "top")
    exp: dict[str, Any] = {"atoms": r["atoms"], "radius": r["radius"]}
    if side == "both":
        exp.update(top=r["top"], bottom=r["bottom"])
    else:
        exp.update(exposure=r["exposure"], borderline=r["borderline"])
    return case(cid, "surfaceAtoms", inp, exp, args=args or None, tol=TOL_SURFACE, note=note)


def mark_case(cid: str, inp: Structure, indices: Sequence[int], want: Sequence[int], *,
              note: str | None = None) -> dict[str, Any]:
    r = ref_mark(inp, indices)
    if r["adsorbateId"] != list(want):
        raise AssertionError(f"{cid}: {r}")
    return case(cid, "markAdsorbates", inp, r, args={"indices": list(indices)}, note=note)


def approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


def assert_spacing(L: dict, delta: float, per_row: int | dict | None = None, tol: float = 1e-6) -> None:
    """Rows equally spaced by *delta* (analytic), with *per_row* atoms (or that composition) each."""
    hs = L["heights"]
    for a, b in zip(hs, hs[1:]):
        if not approx(b - a, delta, tol):
            raise AssertionError(f"spacing {b - a!r}, analytic {delta!r}")
    if per_row is not None:
        for comp in L["compositions"]:
            want = per_row if isinstance(per_row, dict) else None
            if want is not None and comp != want:
                raise AssertionError(f"row {comp}, want {want}")
            if want is None and sum(comp.values()) != per_row:
                raise AssertionError(f"row {comp}, want {per_row} atoms")


# ------------------------------------------------------------------------------------------------ geometry helpers
def site_above(s: Structure, xy_from: int, height: float, top_z: float) -> np.ndarray:
    p = s.positions[xy_from]
    return np.array([p[0], p[1], top_z + height])


def wrap_c(s: Structure, *, inplane: bool = False) -> Structure:
    """VASP-style storage: fractional c (and optionally a, b) wrapped into [0, 1)."""
    f = s.frac_positions.copy()
    f[:, 2] -= np.floor(f[:, 2])
    if inplane:
        f[:, :2] -= np.floor(f[:, :2])
    return with_(s, positions=f @ s.cell)


def shuffled(s: Structure, seed: int) -> tuple[Structure, list[int]]:
    perm = [int(x) for x in np.random.default_rng(seed).permutation(len(s))]
    new = make([s.symbols[i] for i in perm], s.positions[perm], s.cell, s.pbc, name=s.name + " (atoms shuffled)")
    return new, perm


def repeat_inplane(s: Structure, n1: int, n2: int, name: str) -> Structure:
    syms, pos = [], []
    for i in range(n1):
        for j in range(n2):
            for k, sym in enumerate(s.symbols):
                syms.append(sym)
                pos.append(s.positions[k] + i * s.cell[0] + j * s.cell[1])
    cell = np.array([n1 * s.cell[0], n2 * s.cell[1], s.cell[2]])
    order = sorted(range(len(syms)), key=lambda t: (round(pos[t][2], 6), round(pos[t][1], 6), round(pos[t][0], 6)))
    return make([syms[t] for t in order], [pos[t] for t in order], cell, s.pbc, name=name)


def need(cond: Any, what: str = "") -> None:
    """Fail the generation when an analytic expectation does not hold."""
    if not cond:
        raise AssertionError(what or "an analytic expectation does not hold")


# ------------------------------------------------------------------------------------------------ pt111.json
A_PT = A_FCC["Pt"]
D111 = A_PT / math.sqrt(3)


def pt111(n: int = 4, mesh: tuple[int, int] = (3, 3), place: str | float = "centre", pbc=TTT,
          name: str = "") -> Structure:
    return metal_slab("fcc", "Pt", A_PT, (1, 1, 1), n, mesh=mesh, place=place, pbc=pbc,
                      name=name or f"Pt(111) p({mesh[0]}x{mesh[1]}) {n}L")


def co_top_fcc(s: Structure) -> Structure:
    """*s* + CO upright on a top site (C 1.85 Å, O 3.00 Å above) + CO in the fcc hollow farthest from it
    (C 1.30 Å, O 2.45 Å above the top layer; an fcc hollow lies over an atom of the third layer)."""
    rows = rows_by_z(s)
    top, third = rows[-1], rows[-3]
    zt = s.positions[top[0], 2]
    t0 = top[0]

    def apart(i: int) -> float:
        q = xy_image(s, i, s.positions[t0])
        return math.hypot(q[0] - s.positions[t0][0], q[1] - s.positions[t0][1])
    hollow = max(third, key=lambda i: (round(apart(i), 6), -i))
    xy = s.positions[hollow]
    pos = [site_above(s, t0, 1.85, zt), site_above(s, t0, 3.00, zt),
           [xy[0], xy[1], zt + 1.30], [xy[0], xy[1], zt + 2.45]]
    return append(s, ["C", "O", "C", "O"], pos, name=s.name + " + CO top + CO fcc")


def co_upright(s: Structure, height: float, *, below: bool = False) -> Structure:
    rows = rows_by_z(s)
    i = rows[0][0] if below else rows[-1][0]
    z = s.positions[i, 2]
    sign = -1.0 if below else 1.0
    pos = [site_above(s, i, sign * height, z), site_above(s, i, sign * (height + 1.15), z)]
    return append(s, ["C", "O"], pos, name=s.name + f" + CO {height:g} Å {'below' if below else 'above'}")


def family_pt111() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    centred = pt111()
    placements = {
        "centred": centred,
        "bottom-at-0": pt111(place="bottom", name="Pt(111) p(3x3) 4L, bottom layer at z = 0"),
        "bottom-below-0": pt111(place=-0.01, name="Pt(111) p(3x3) 4L, bottom layer at z = -0.01 Å"),
        "across-boundary": pt111(place="straddle:-1.0", name="Pt(111) p(3x3) 4L across the cell boundary"),
    }
    first: list[int] | None = None

    def four_rows(L: dict) -> None:
        assert_spacing(L, D111, {"Pt": 9})
        need(L["count"] == 4 and L["warnings"] == [] and approx(L["vacuum"], VAC))

    for tag, s in placements.items():
        L = ref_layers(s)
        four_rows(L)
        first = first or L["atomLayer"]
        need(L["atomLayer"] == first, "the four placements must give the same rows atom by atom")
        out.append(layers_case(f"pt111-p3x3-4l-{tag}", s, note=(
            "M3 §7.1: 4 rows of 9, spacing a/sqrt(3) = 2.2632 Å, the same rows atom by atom in the four placements "
            "(centred, bottom at 0, bottom at -0.01 Å, across the cell boundary)") if tag == "centred" else None))
    need(ref_layers(placements["across-boundary"])["straddles"])
    mixed, perm = shuffled(centred, 7)
    need(ref_layers(mixed)["atomLayer"] == [first[i] for i in perm])
    out.append(layers_case("pt111-p3x3-4l-shuffled", mixed, note="atoms in random order: the rows follow the atoms"))
    out.append(layers_case("pt111-p3x3-4l-ttf", relabel_ttf(centred),
                           check=lambda L: (assert_spacing(L, D111, {"Pt": 9}), need(L["coords"] == "invariant")),
                           note="T T F twin: c is not periodic, so heights are not unrolled (period and vacuum null)"))
    for d in ("c", "z", "normal"):
        out.append(layers_case(f"pt111-p3x3-4l-direction-{d}", centred, {"direction": d},
                               check=lambda L: assert_spacing(L, D111, {"Pt": 9})))
    top2 = [i for i in range(len(centred)) if first[i] >= 2]
    out.append(layers_case("pt111-p3x3-4l-indices-top-two", centred, {"indices": top2},
                           check=lambda L: need(L["count"] == 2)))
    info05 = with_(centred, info={"surface": {"layerTolerance": 0.5}}, name="Pt(111) p(3x3) 4L, layerTolerance 0.5")
    out.append(layers_case("pt111-p3x3-4l-info-tolerance", info05, check=lambda L: need(L["tolerance"] == 0.5),
                           note="no tolerance given: info.surface.layerTolerance (0.5) is the default"))
    out.append(layers_case("pt111-p3x3-4l-given-tolerance-wins", info05, {"tolerance": 0.3},
                           check=lambda L: need(L["tolerance"] == 0.3)))
    out.append(layers_case("pt111-p3x3-4l-tolerance-2.5", centred, {"tolerance": 2.5},
                           check=lambda L: need(L["count"] == 1 and len(L["warnings"]) == 1),
                           note="2.5 Å chains the four planes into one rumpled row"))
    occ = with_(centred, props={"occupancy": [1.0] * 35 + [0.5]}, name="Pt(111) p(3x3) 4L, one site half occupied")
    out.append(layers_case("pt111-p3x3-4l-partial-occupancy", occ, check=lambda L: need(len(L["warnings"]) == 1)))
    # errors (M3 §3.16, the layer part)
    for cid, args, msg in [
        ("tolerance-zero", {"tolerance": 0}, "tolerance must be > 0 Å (got 0)"),
        ("tolerance-negative", {"tolerance": -1}, "tolerance must be > 0 Å (got -1)"),
        ("tolerance-too-large", {"tolerance": 7}, "tolerance must be at most 5 Å (got 7)"),
        ("index-out-of-range", {"indices": [0, 99]}, "atom index 99 is out of range (the structure has 36 atoms)"),
        ("unknown-direction", {"direction": "q"},
         "unknown direction 'q'; use 'auto', 'normal', 'a', 'b', 'c', 'x', 'y', 'z', a vector or {'hkl': [h, k, l]}"),
        ("zero-vector", {"direction": [0, 0, 0]}, "direction vector must be non-zero and finite"),
        ("four-index", {"direction": {"hkil": [1, 0, 0, 0]}}, "four-index (h k i l) needs i = -(h + k) (got 1 0 0 0)"),
    ]:
        out.append(error_case(f"layers-error-{cid}", "findLayers", centred, args, msg,
                              lambda a=args: ref_layers(centred, **py_layer_args(a))))
    # adsorbates: CO on top + CO in an fcc hollow, no tags
    co = co_top_fcc(centred)
    n0 = len(centred)

    def eight_rows(L: dict) -> None:
        need(L["count"] == 8 and L["warnings"] == [])

    def slab_rows(L: dict) -> None:
        assert_spacing(L, D111, {"Pt": 9})
        need(L["excluded"] == list(range(n0, n0 + 4)) and L["adsorbates"]["source"] == "geometry")

    out.append(layers_case("pt111-co-top-fcc", co, check=eight_rows))
    out.append(layers_case("pt111-co-top-fcc-skip", co, {"skipAdsorbates": True}, check=slab_rows,
                           note="M3 §7.1: 4 rows once the 4 adsorbate atoms (geometry) are left out"))
    out.append(ads_case("pt111-co-top-fcc", co, range(n0, n0 + 4), "geometry"))
    out.append(layers_case("pt111-co-top-fcc-ttf-skip", relabel_ttf(co), {"skipAdsorbates": True}, check=slab_rows))
    # the shared CONTCAR fixture (acceptance S14-3)
    contcar = {"file": "surface/contcar_pt111.vasp"}
    fixture = load_input(contcar)

    def s14(L: dict) -> None:
        assert_spacing(L, D111, {"Pt": 9}, tol=1e-4)   # two of the nine bottom atoms sit at f = 0.99999 - 1
        need(abs(L["heights"][0]) < 1e-4 and approx(L["vacuum"], 14.9998, 1e-4) and L["straddles"])
        need([i for i in range(36) if L["offset"][i]] == [3, 7], "the two atoms at f = 0.99999 are unrolled")
        f = fixture.frac_positions[:, 2]
        need(L["offset"] == np.rint(f - unwrap_along_gap(f, display_cuts(fixture)[2])).astype(int).tolist())

    out.append(layers_case("contcar-pt111", contcar, check=s14,
                           note="acceptance S14-3: 4 rows of 9, the bottom row at about 0 (the display's cut, U1)"))
    out.append(layers_case("contcar-pt111-skip", contcar, {"skipAdsorbates": True}, check=s14))
    # the slab + 2 CO as a relaxed CONTCAR: bottom at z = 0, seeded 0.03 Å jitter, wrapped like VASP
    rng = np.random.default_rng(20261109)
    jit = co.positions - np.array([0.0, 0.0, co.positions[:n0, 2].min()])
    jit = jit + rng.normal(0.0, 0.03, jit.shape)
    jittered = wrap_c(with_(co, positions=jit, name="Pt(111) p(3x3) 4L + 2 CO, CONTCAR-like (jitter 0.03 Å)"),
                      inplane=True)

    def relaxed(L: dict) -> None:
        need(L["count"] == 4 and abs(L["heights"][0]) < 0.03 and L["warnings"] == [])
        need(approx(L["vacuum"], 11.9, 0.1) and L["straddles"])
        need(all(comp == {"Pt": 9} for comp in L["compositions"]))
        f = jittered.frac_positions[:, 2]
        need(L["offset"] == np.rint(f - unwrap_along_gap(f, display_cuts(jittered)[2])).astype(int).tolist())

    out.append(layers_case("pt111-co-contcar-jitter-skip", jittered, {"skipAdsorbates": True}, check=relaxed,
                           note="M3 §7.1: 4 rows, bottom at about 0, vacuum about 11.9 Å, no warning; offset = the "
                                "display's cut"))
    out.append(layers_case("pt111-co-contcar-jitter", jittered, check=eight_rows))
    # CO 6, 7 and 8 Å above the top layer, slab centred and at the bottom of the cell
    for hgt in (6, 7, 8):
        for tag, base in (("centred", centred), ("bottom-at-0", placements["bottom-at-0"])):
            s = wrap_c(co_upright(base, hgt))

            def gap_above_co(L: dict, hgt: int = hgt) -> None:
                # the cut lies in the gap between the O (hgt + 1.15 Å up) and the slab's image: that is the vacuum
                need(approx(L["vacuum"], VAC - hgt - 1.15), f"vacuum {L['vacuum']}")

            def above(L: dict) -> None:
                need(L["count"] == 6 and L["compositions"][-2:] == [{"C": 1}, {"O": 1}])
                gap_above_co(L)

            cid = f"pt111-co-{hgt}a-{tag}"
            out.append(layers_case(cid, s, check=above, note=(
                "the ledger's cut (L-F0-16, the display's) keeps the floating CO above the slab at 6, 7 and 8 Å; "
                "M3 §7.1 put it below the slab at 7 and 8 Å under the old widest-gap cut. vacuum is the width of "
                "the cut gap, from the O to the slab's image (6.85 Å), as M2 measures it from a floating group")
                if (hgt, tag) == (7, "centred") else None))
            out.append(layers_case(cid + "-skip", s, {"skipAdsorbates": True},
                                   check=lambda L: (assert_spacing(L, D111, {"Pt": 9}), gap_above_co(L))))
            out.append(ads_case(cid, s, [n0, n0 + 1], "geometry"))
    # vacuum along a (cell rows c, a, b)
    c = centred.cell
    along_a = with_(centred, cell=np.array([c[2], c[0], c[1]]), name="Pt(111) p(3x3) 4L, vacuum along a")
    for d in (None, "normal"):
        out.append(layers_case("pt111-vacuum-along-a" + ("" if d is None else "-normal"), along_a,
                               None if d is None else {"direction": d},
                               check=lambda L: (assert_spacing(L, D111, {"Pt": 9}), need(L["axis"] == 0))))
    out.append(layers_case("pt111-vacuum-along-a-direction-c", along_a, {"direction": "c"},
                           check=lambda L: need(L["coords"] == "periodic" and L["vacuum"] is None),
                           note="'c' is the normal of the planes spanned by a and b: rows across the surface"))
    # bulk Pt (conventional cell)
    b0 = build.crystal("fcc", ["Pt"], a=A_PT)
    bulk = make(b0.symbols, b0.positions, b0.cell, b0.pbc, name="Pt fcc (conventional cell)")

    def two_rows(L: dict) -> None:
        assert_spacing(L, A_PT / 2, {"Pt": 2})
        need(approx(L["period"], A_PT) and approx(L["heights"][0], 0.0))

    out.append(layers_case("bulk-pt-auto", bulk, check=two_rows))
    out.append(layers_case("bulk-pt-c", bulk, {"direction": "c"}, check=two_rows,
                           note="M3 §7.1: period 3.92 Å, two rows at 0 and 1.96 Å (the cut at the cell boundary)"))
    out.append(layers_case("bulk-pt-hkl-111", bulk, {"direction": {"hkl": [1, 1, 1]}},
                           check=lambda L: need(approx(L["period"], D111) and L["count"] == 1)))
    out.append(layers_case("bulk-pt-irrational", bulk, {"direction": [1, 2, 3.1]},
                           check=lambda L: need(L["coords"] == "wrapped" and L["count"] == 4)))
    out.append(layers_case("bulk-pt-c-tolerance-2", bulk, {"direction": "c", "tolerance": 2},
                           check=lambda L: need(L["coords"] == "wrapped" and L["count"] == 1),
                           note="the period (3.92 Å) is below 2 × tolerance, so the direction counts as irrational "
                                "(M3 §3.2) and gets the 'wrapped' warning of M3 §3.5, worded for every wrapped "
                                "result (README decision 9)"))
    out.append(error_case("layers-error-normal-without-surface", "findLayers", bulk, {"direction": "normal"},
                          "direction 'normal' needs a vacuum gap or a non-periodic axis; use 'c'",
                          lambda: ref_layers(bulk, "normal")))
    # no cell: a Pt3 + CO cluster
    tri = [[0.0, 0.0, 0.0], [2.77, 0.0, 0.0], [1.385, 2.3989, 0.0]]
    cluster = make(["Pt", "Pt", "Pt", "C", "O"], tri + [[1.385, 0.7996, 1.30], [1.385, 0.7996, 2.45]], None,
                   (False, False, False), name="Pt3 + CO (no cell)")
    out.append(layers_case("cluster-no-cell", cluster, check=lambda L: need(L["count"] == 3)))
    out.append(error_case("layers-error-c-without-cell", "findLayers", cluster, {"direction": "c"},
                          "direction 'c' needs a unit cell; use 'x', 'y', 'z' or a vector",
                          lambda: ref_layers(cluster, "c")))
    # adsorbates on the bottom side
    below = co_upright(centred, 1.85, below=True)
    out.append(layers_case("pt111-co-below-skip", below, {"skipAdsorbates": True},
                           check=lambda L: need(L["warnings"] == ["The detected adsorbates are on the bottom side of "
                                                                  "the slab."])))
    # 216 atoms: Pt(111) p(6×6) 6L on the primitive mesh (not the 864-atom grid of the v1 prototype)
    big = pt111(6, (6, 6))
    need(len(big) == 216)
    out.append(layers_case("pt111-p6x6-6l", big, check=lambda L: assert_spacing(L, D111, {"Pt": 36}),
                           note="the 216-atom case of M3 §7.5, built on the primitive p(6×6) mesh"))
    return out


# ------------------------------------------------------------------------------------------------ metals.json
RU_A, RU_C = 2.706, 4.282


def family_metals() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    a_cu, a_ag, a_fe = A_FCC["Cu"], A_FCC["Ag"], A_BCC["Fe"]
    table = [  # (id, structure, analytic spacing, atoms per row) -- M3 §7.1
        ("cu100-p2x2-4l", metal_slab("fcc", "Cu", a_cu, (1, 0, 0), 4, mesh=(2, 2)), a_cu / 2, 4),
        ("ag111-p2x2-4l", metal_slab("fcc", "Ag", a_ag, (1, 1, 1), 4, mesh=(2, 2)), a_ag / math.sqrt(3), 4),
        ("ru0001-p2x2-4l", hcp_slab("Ru", RU_A, RU_C, 4, mesh=(2, 2)), RU_C / 2, 4),
        ("fe110-p2x2-4l", metal_slab("bcc", "Fe", a_fe, (1, 1, 0), 4, mesh=(2, 2)), a_fe / math.sqrt(2), 4),
        ("fe100-p2x2-4l", metal_slab("bcc", "Fe", a_fe, (1, 0, 0), 4, mesh=(2, 2)), a_fe / 2, 4),
        ("fe111-1x1-6l", metal_slab("bcc", "Fe", a_fe, (1, 1, 1), 6), a_fe / (2 * math.sqrt(3)), 1),
        ("pt110-1x2-4l", metal_slab("fcc", "Pt", A_PT, (1, 1, 0), 4, mesh=(1, 2)), A_PT / (2 * math.sqrt(2)), 2),
        ("pt211-1x1-6l", metal_slab("fcc", "Pt", A_PT, (2, 1, 1), 6), A_PT / (2 * math.sqrt(6)), 1),
    ]
    stated = {"cu100-p2x2-4l": 1.8075, "ag111-p2x2-4l": 2.3591, "ru0001-p2x2-4l": 2.141, "fe110-p2x2-4l": 2.0266,
              "fe100-p2x2-4l": 1.433, "fe111-1x1-6l": 0.8274, "pt110-1x2-4l": 1.3859, "pt211-1x1-6l": 0.8002}
    for cid, s, delta, per_row in table:
        need(approx(delta, stated[cid], 1e-4), f"{cid}: the analytic spacing {delta} is not M3 §7.1's {stated[cid]}")
        out.append(layers_case(cid, s, check=lambda L, d=delta, n=per_row: (
            assert_spacing(L, d, n), need(L["warnings"] == [] and L["normalSource"] == "vacuum")),
            note=f"M3 §7.1: spacing {stated[cid]} Å" if cid == "cu100-p2x2-4l" else None))
    out.append(layers_case("ru0001-p2x2-4l-ttf", relabel_ttf(table[2][1]),
                           check=lambda L: (assert_spacing(L, RU_C / 2, 4), need(L["coords"] == "invariant"))))
    # vicinal faces at the default tolerance
    # (a thin vicinal slab on its 1×1 mesh leaves a vacuum gap along b as well: no surface, so take enough planes)
    d554 = A_PT / math.sqrt(4 * (25 + 25 + 16))
    s554 = metal_slab("fcc", "Pt", A_PT, (5, 5, 4), 30)
    out.append(layers_case("pt554-1x1-30planes", s554, check=lambda L: need(
        L["count"] == 1 and approx(L["rows"][0]["innerGap"], d554) and len(L["warnings"]) == 2
        and L["normalSource"] == "vacuum"),
        note="planes 0.2413 Å apart chain into one row: a rumpling and a step warning (M3 §7.1)"))
    d332 = A_PT / math.sqrt(4 * (9 + 9 + 4))
    s332 = metal_slab("fcc", "Pt", A_PT, (3, 3, 2), 12)
    out.append(layers_case("pt332-1x1-12planes", s332, check=lambda L: (
        assert_spacing(L, d332, 1), need(len(L["warnings"]) == 4 and L["warnings"][-1] == "… and 8 more"
                                         and L["normalSource"] == "vacuum")),
        note="planes 0.418 Å apart: eleven merge warnings, shown as the top three and '… and 8 more'"))
    out.append(layers_case("pt332-1x1-12planes-tolerance-0.5", s332, {"tolerance": 0.5},
                           check=lambda L: need(L["count"] == 1)))
    return out


# ------------------------------------------------------------------------------------------------ oxides.json
def rutile() -> Bulk:
    return from_builder("rutile", ["Ti", "O"], a=4.594, c=2.959, u=0.305)


TIO2_PATTERN = ["O", "Ti O", "O"]


def tio2_110(trilayers: int = 3, mesh=(2, 1), pbc=TTT, dz=None, name: str = "") -> Structure:
    o = orient(rutile(), (1, 1, 0), trilayers + 4)
    start = find_start(o, TIO2_PATTERN * trilayers)
    return slab(o, start, 3 * trilayers, mesh=mesh, pbc=pbc, dz=dz,
                name=name or f"TiO2(110) ({mesh[0]}x{mesh[1]}) {trilayers} O-Ti2O2-O trilayers")


def tio2_sites(s: Structure) -> dict[str, list[int]]:
    """Ti6c / Ti5c / O3c of the top trilayer's Ti2O2 plane and the top bridging O (by geometry)."""
    rows = rows_by_z(s)
    obr, mid = rows[-1], rows[-2]
    ti = [i for i in mid if s.symbols[i] == "Ti"]

    def d_obr(i: int) -> float:
        return min(math.dist(s.positions[i][:2], xy_image(s, j, s.positions[i])[:2]) for j in obr)
    ti6 = [i for i in ti if d_obr(i) < 2.0]          # under the bridging-O rows (in-plane distance c/2 = 1.48 Å)
    ti5 = [i for i in ti if i not in ti6]
    need(len(ti6) == len(ti5) > 0, "Ti6c and Ti5c alternate")
    return {"obr": obr, "ti6": ti6, "ti5": ti5, "o3": [i for i in mid if s.symbols[i] == "O"]}


def tio2_displaced(d_ti6: float, d_ti5: float, d_o3: float, d_obr: float, name: str) -> Structure:
    s = tio2_110()
    sites = tio2_sites(s)
    pos = s.positions.copy()
    for key, d in (("ti6", d_ti6), ("ti5", d_ti5), ("o3", d_o3), ("obr", d_obr)):
        for i in sites[key]:
            pos[i, 2] += d
    return with_(s, positions=pos, name=name)


def perovskite_001(n: int, top: str, mesh=(1, 1)) -> Structure:
    o = orient(from_builder("perovskite", ["Sr", "Ti", "O"], a=3.905), (0, 0, 1), n + 4)
    first = "Ti O" if top == "TiO2" else "Sr O"
    other = "Sr O" if top == "TiO2" else "Ti O"
    start = find_start(o, [first if k % 2 == 0 else other for k in range(n)])
    return slab(o, start, n, mesh=mesh, name=f"SrTiO3(001) {top}-terminated {n}L")


def ceo2_111(trilayers: int = 3, mesh=(1, 1)) -> Structure:
    o = orient(fluorite_primitive(5.411), cubic_miller("fcc", (1, 1, 1)), trilayers + 4)
    start = find_start(o, ["O", "Ce", "O"] * trilayers)
    return slab(o, start, 3 * trilayers, mesh=mesh, name=f"CeO2(111) {trilayers} O-Ce-O trilayers")


def nacl_100(n: int = 4) -> Structure:
    o = orient(from_builder("rocksalt", ["Na", "Cl"], a=5.64), (1, 0, 0), n + 4)
    return slab(o, 2, n, name=f"NaCl(100) {n}L")


def wurtzite() -> Bulk:
    return from_builder("wurtzite", ["Zn", "O"], a=3.25, c=5.207, u=0.382)


def zno_1010(n: int = 6, mesh=(2, 2), dz=None, name: str = "") -> Structure:
    o = orient(wurtzite(), (1, 0, 0), n + 6)
    zs = [p.z for p in o.planes]
    start = next(k for k in range(2, len(zs) - n) if zs[k + 1] - zs[k] < 1.0)   # top and bottom gaps 0.938 Å
    return slab(o, start, n, mesh=mesh, dz=dz, name=name or f"ZnO(10-10) ({mesh[0]}x{mesh[1]}) {n}L")


def zno_0001(n: int = 8) -> Structure:
    o = orient(wurtzite(), (0, 0, 1), n + 6)
    zs = [p.z for p in o.planes]
    start = next(k for k in range(2, len(zs) - n)
                 if plane_comp(o.planes[k]) == {"O": 1} and zs[k + 1] - zs[k] < 1.0)  # O below Zn, 0.614 Å
    return slab(o, start, n, name=f"ZnO(0001) Zn-terminated {n} planes")


def al2o3_0001(units: int = 6) -> Structure:
    o = orient(corundum(), (0, 0, 1), units + 4)
    zs = [p.z for p in o.planes]
    start = next(k for k in range(1, len(zs) - 3 * units)
                 if plane_comp(o.planes[k]) == {"Al": 1} and plane_comp(o.planes[k + 1]) == {"O": 3})
    return slab(o, start, 3 * units, name=f"Al2O3(0001) Al-terminated, {units} Al-O3-Al units")


def mos2(mesh: int = 4) -> Structure:
    b = build.crystal("mos2", ["Mo", "S"], a=3.16, c=18.0, thickness=3.17)
    s = make(b.symbols, b.positions, b.cell, b.pbc, name="MoS2 1x1")
    return repeat_inplane(s, mesh, mesh, f"MoS2 monolayer {mesh}x{mesh}")


def family_oxides() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    a, u = 4.594, 0.305
    d110 = a / math.sqrt(2)
    t = tio2_110()
    obr_gap, inter = (1 - 2 * u) * d110, (4 * u - 1) * d110          # 1.267 and 0.715 Å

    def tio2_rows(L: dict) -> None:
        hs = L["heights"]
        gaps = [b - a_ for a_, b in zip(hs, hs[1:])]
        need(all(approx(g, obr_gap if k % 3 != 2 else inter) for k, g in enumerate(gaps)), str(gaps))
        need(approx(obr_gap, 1.267, 1e-3) and approx(inter, 0.715, 1e-3) and L["warnings"] == [])

    out.append(layers_case("tio2-110-2x1-3tl", t, check=tio2_rows,
                           note="M3 §7.1: O_br 1.267 Å above Ti2O2, 0.715 Å between trilayers"))
    out.append(layers_case("tio2-110-2x1-3tl-ttf", relabel_ttf(t), check=tio2_rows))
    # LEED-size displacements of the top trilayer (Ti6c, Ti5c, in-plane O3c, bridging O)
    for tag, disp in (("set1", (0.12, -0.19, 0.17, -0.02)), ("set2", (0.20, -0.15, 0.10, -0.10))):
        s = tio2_displaced(*disp, name=f"TiO2(110) 2x1 3TL, top trilayer displaced {disp} (Ti6c, Ti5c, O3c, O_br)")
        for tol in (0.3, 0.5):
            out.append(layers_case(f"tio2-110-leed-{tag}-tol-{tol:g}", s, {"tolerance": tol}, note=(
                "Ti6c (under the O_br rows) +0.12, Ti5c -0.19, O3c +0.17, O_br -0.02 Å: at 0.3 Å the Ti2O2 plane "
                "splits 0.31 Å apart (M3 §3.5 quotes 0.36 Å from a prototype that moved every Ti by -0.19)")
                if (tag, tol) == ("set1", 0.3) else None))
    # ZnO(10-10): ideal and the top Zn moved in by 0.25 / 0.35 Å (the top O by 0.03 Å), at 0.3 and 0.5 Å
    z = zno_1010()
    out.append(layers_case("zno-1010-2x2-6l", z, check=lambda L: need(
        L["count"] == 6 and all(c_ == {"Zn": 4, "O": 4} for c_ in L["compositions"]) and L["warnings"] == [])))
    zno_rows = {  # (Zn moved in, tolerance) -> (rows, warnings); M3 §3.5 states the 0.3 Å results
        (0.25, 0.3): (6, ["Layer 1 has a 0.22 Å step, close to the 0.3 Å tolerance: it may split after relaxation."]),
        (0.35, 0.3): (7, ["Layers 1 and 2 are only 0.32 Å apart, close to the 0.3 Å tolerance: they may merge after "
                          "relaxation."]),
        (0.25, 0.5): (6, []),
        (0.35, 0.5): (6, ["Layers 1 and 2 are only 0.59 Å apart, close to the 0.5 Å tolerance: they may merge after "
                          "relaxation."]),
    }
    for dzn in (0.25, 0.35):
        def inward(k: int, sym: str, idx: int, dzn: float = dzn) -> float:
            return (-dzn if sym == "Zn" else -0.03) if k == 5 else 0.0
        s = zno_1010(dz=inward, name=f"ZnO(10-10) 2x2 6L, top Zn -{dzn:g} Å, top O -0.03 Å")
        for tol in (0.3, 0.5):
            def zno_check(L: dict, want: tuple = zno_rows[dzn, tol]) -> None:
                need((L["count"], L["warnings"]) == want, f"{L['count']} {L['warnings']}")
            cid = f"zno-1010-top-zn-in-{dzn:g}" + ("" if tol == 0.3 else f"-tol-{tol:g}")
            out.append(layers_case(cid, s, None if tol == 0.3 else {"tolerance": tol}, check=zno_check, note={
                (0.25, 0.3): "M3 §3.5: at the default 0.3 Å the top row has a 0.22 Å step; with the Zn 0.35 Å in "
                             "it splits 0.32 Å apart",
                (0.35, 0.5): "M3 §7.1 (D3(e)): the displaced slabs at 0.3 and 0.5 Å; at 0.5 Å the split top row "
                             "is one row again, 0.59 Å above the next",
            }.get((dzn, tol))))
    # other surfaces of M3 §1.3
    for cid, top in (("srtio3-001-tio2-7l", "TiO2"), ("srtio3-001-sro-7l", "SrO")):
        out.append(layers_case(cid, perovskite_001(7, top),
                               check=lambda L: (assert_spacing(L, 3.905 / 2), need(L["count"] == 7))))
    ce = ceo2_111()
    d_ce = 5.411 / math.sqrt(3)
    def ceo2_rows(L: dict) -> None:
        gaps = [b - a_ for a_, b in zip(L["heights"], L["heights"][1:])]
        want = [d_ce / 4, d_ce / 4, d_ce / 2] * 2 + [d_ce / 4] * 2
        need(len(gaps) == len(want) and all(approx(g, w_) for g, w_ in zip(gaps, want)), str(gaps))

    out.append(layers_case("ceo2-111-3tl", ce, check=ceo2_rows, note="O-Ce-O 0.781 Å, trilayers 1.562 Å apart"))
    out.append(layers_case("nacl-100-4l", nacl_100(), check=lambda L: assert_spacing(L, 5.64 / 2, {"Na": 2, "Cl": 2})))
    al = al2o3_0001()
    out.append(layers_case("al2o3-0001-tol-0.3", al, {"tolerance": 0.3}, check=lambda L: need(L["count"] == 18)))
    out.append(layers_case("al2o3-0001-tol-0.6", al, {"tolerance": 0.6}, check=lambda L: need(
        L["count"] == 13 and L["warnings"][-1] == "… and 2 more"),
        note="0.6 Å merges the 0.493 Å Al pairs: 18 -> 13 rows, five step warnings"))
    # stoichiometric units (M3 §3.6; group="units" comes with find_layers in M3-T1, ledger L-M3-01)
    keep = [i for i in range(len(t)) if i not in rows_by_z(t)[-1]]
    t_vac = make([t.symbols[i] for i in keep], t.positions[keep], t.cell, t.pbc,
                 name="TiO2(110) 2x1 3TL without the top bridging O, bulk formula given",
                 info={"surface": {"axis": 2, "bulk": {"reducedFormula": "TiO2"}}})
    t_vac_bare = with_(t_vac, info={}, name="TiO2(110) 2x1 3TL without the top bridging O")
    st7 = perovskite_001(7, "TiO2")
    st7_info = with_(st7, info={"surface": {"axis": 2, "bulk": {"reducedFormula": "SrTiO3"}}},
                     name="SrTiO3(001) TiO2-terminated 7L, bulk formula given")
    units = [
        ("tio2-110-units", t, [3, [True] * 3]),
        ("tio2-110-no-top-obr-units", t_vac, [3, [True, True, False]]),     # rows from the bottom
        ("tio2-110-no-top-obr-units-no-bulk-formula", t_vac_bare, None),
        ("ceo2-111-units", ce, [3, [True] * 3]),
        ("al2o3-0001-units", al, [6, [True] * 6]),
        ("zno-0001-units", zno_0001(), [4, [True] * 4]),
        ("srtio3-001-tio2-7l-units", st7, None),
        ("srtio3-001-tio2-7l-units-bulk-formula", st7_info, [4, [True, True, True, False]]),
        ("pt111-units", pt111(), [4, [True] * 4]),
        ("mos2-units", mos2(), None),
    ]
    for cid, s, want in units:
        def check(L: dict, want=want) -> None:
            if want is None:
                need(L["stoichiometric"] is None
                     and L["warnings"][-1] == "No repeating stoichiometric unit was found; showing atomic planes.")
            else:
                need(L["count"] == want[0] and L["stoichiometric"] == want[1], f"{L['count']} {L['stoichiometric']}")
        out.append(layers_case(cid, s, {"group": "units"}, check=check, note={
            "tio2-110-no-top-obr-units": "ties go to the split points nearest the top (M3 §3.6 rule 3): the "
                                         "incomplete unit is the top one, as M3 §0.3, §3.6 and the M3-T1 tests "
                                         "state; the v2 prototype leaves it at the bottom (README decision 3)",
            "srtio3-001-tio2-7l-units": "without info.surface.bulk the target is the slab's own formula: no unit",
            "tio2-110-no-top-obr-units-no-bulk-formula": "the target is the slab's own formula (Ti6O11): no unit",
        }.get(cid)))
    # bulk wurtzite: four-index directions and a row spanning the period
    w = wurtzite()
    zb = make(w.symbols, w.frac @ w.cell, w.cell, TTT, name="ZnO wurtzite (bulk)")
    out.append(layers_case("bulk-zno-hkil-10-10", zb, {"direction": {"hkil": [1, 0, -1, 0]}},
                           check=lambda L: need(L["coords"] == "periodic"
                                                and approx(L["period"], 3.25 * math.sqrt(3) / 2))))
    out.append(layers_case("bulk-zno-hkl-100", zb, {"direction": {"hkl": [1, 0, 0]}}))
    out.append(layers_case("bulk-zno-c-tolerance-2.2", zb, {"direction": "c", "tolerance": 2.2},
                           check=lambda L: need(L["spansPeriod"] and L["count"] == 1)))
    return out


# ------------------------------------------------------------------------------------------------ adsorbates.json
#: Upright molecules bound through their lowest atom: (symbols, offsets from the surface atom below, Å).
ETHANOL = (["O", "H", "C", "H", "H", "C", "H", "H", "H"],
           [(0, 0, 2.2), (0.9, 0, 2.45), (0, 0, 3.63), (0.9, 0.5, 4.0), (-0.9, 0.5, 4.0), (0, -0.3, 5.15),
            (0, 0.7, 5.6), (0.9, -0.8, 5.5), (-0.9, -0.8, 5.5)])
PYRIDINE = (["N", "C", "C", "C", "C", "C", "H", "H", "H", "H", "H"],
            [(0, 0, 2.1), (1.14, 0, 2.76), (-1.14, 0, 2.76), (1.20, 0, 4.15), (-1.20, 0, 4.15), (0, 0, 4.85),
             (2.08, 0, 2.22), (-2.08, 0, 2.22), (2.15, 0, 4.68), (-2.15, 0, 4.68), (0, 0, 5.93)])


def on_top(s: Structure, molecule: tuple[list[str], list[tuple]], name: str) -> Structure:
    i = rows_by_z(s)[-1][0]
    p = s.positions[i]
    syms, offs = molecule
    return append(s, syms, [p + np.array(o, float) for o in offs], name=name)


def graphene(mesh: int, c: float = 15.0, pbc=TTF) -> Structure:
    b = build.crystal("graphene", ["C"], a=2.46, c=c)
    s = make(b.symbols, b.positions, b.cell, pbc, name="graphene 1x1")
    return repeat_inplane(s, mesh, mesh, f"graphene {mesh}x{mesh}")


def graphene_hbn(mesh: int = 3) -> Structure:
    a, c, gap = 2.46, 20.0, 3.3
    cell = hexagonal(a, c)
    syms, pos = [], []
    for i in range(mesh):
        for j in range(mesh):
            for sym, f, z in (("B", (1 / 3, 2 / 3), c / 2 - gap / 2), ("N", (2 / 3, 1 / 3), c / 2 - gap / 2),
                              ("C", (1 / 3, 2 / 3), c / 2 + gap / 2), ("C", (2 / 3, 1 / 3), c / 2 + gap / 2)):
                xy = (f[0] + i) * cell[0] + (f[1] + j) * cell[1]
                syms.append(sym)
                pos.append([xy[0], xy[1], z])
    order = sorted(range(len(syms)), key=lambda t: (pos[t][2], pos[t][1], pos[t][0]))
    big = np.array([mesh * cell[0], mesh * cell[1], cell[2]])
    return make([syms[t] for t in order], [pos[t] for t in order], big, TTF,
                name=f"graphene on hBN {mesh}x{mesh} (3.3 Å apart)")


def family_adsorbates() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    # two-dimensional materials (pbc T T F as built) and their T T T twins
    gr = graphene(4)
    gr_h = append(gr, ["H"], [gr.positions[rows_by_z(gr)[-1][0]] + [0, 0, 1.1]], name="graphene 4x4 + H")
    n = len(gr)
    out.append(ads_case("graphene-4x4-h", gr_h, [n], "geometry"))
    out.append(ads_case("graphene-4x4-h-ttt", with_(gr_h, pbc=TTT, name="graphene 4x4 + H (pbc T T T)"), [n],
                        "geometry"))
    out.append(layers_case("graphene-4x4-h-skip", gr_h, {"skipAdsorbates": True},
                           check=lambda L: need(L["count"] == 1)))
    out.append(layers_case("graphene-4x4-h", gr_h, check=lambda L: need(L["count"] == 2)))
    m = mos2(4)
    top_s = rows_by_z(m)[-1][0]
    m_pt = append(m, ["Pt"], [m.positions[top_s] + [0, 0, 2.3]], name="MoS2 4x4 + Pt on top of S")
    out.append(ads_case("mos2-4x4-pt", m_pt, [len(m)], "geometry"))
    out.append(layers_case("mos2-4x4-pt-skip", m_pt, {"skipAdsorbates": True}, check=lambda L: need(L["count"] == 3)))
    gh = graphene_hbn(3)
    out.append(ads_case("graphene-hbn-3x3", gh, [], "none", note="the upper sheet is periodic: not an adsorbate"))
    gh_h = append(gh, ["H"], [gh.positions[rows_by_z(gh)[-1][0]] + [0, 0, 1.1]], name="graphene/hBN 3x3 + H")
    out.append(ads_case("graphene-hbn-3x3-h", gh_h, [len(gh)], "geometry"))
    # TiO2(110): water on Ti5c, H on a bridging O, O2 6 Å above the surface
    t = tio2_110()
    sites = tio2_sites(t)
    nt = len(t)
    pw = t.positions[sites["ti5"][0]] + [0, 0, 2.2]
    water = append(t, ["O", "H", "H"], [pw, pw + [0.76, 0, 0.59], pw + [-0.76, 0, 0.59]],
                   name="TiO2(110) 2x1 + H2O on Ti5c")
    out.append(ads_case("tio2-110-h2o-ti5c", water, [nt, nt + 1, nt + 2], "geometry"))
    oh = append(t, ["H"], [t.positions[sites["obr"][0]] + [0, 0, 0.97]], name="TiO2(110) 2x1 + H on a bridging O")
    out.append(ads_case("tio2-110-h-on-obr", oh, [nt], "geometry", note="only the H: the bridging O stays lattice"))
    t1 = tio2_110(mesh=(1, 1), name="TiO2(110) 1x1 3 trilayers")
    s1 = tio2_sites(t1)
    oh1 = append(t1, ["H"], [t1.positions[s1["obr"][0]] + [0, 0, 0.97]], name="TiO2(110) 1x1 + H on the bridging O")
    out.append(ads_case("tio2-110-1x1-h-on-obr", oh1, [len(t1)], "geometry",
                        note="1x1: the bridging O bonds twice to images of one Ti; bonds count per image (M3 §3.8)"))
    po = t.positions[sites["ti5"][0]] + [0, 0, 6.0]
    o2 = append(t, ["O", "O"], [po, po + [1.21, 0, 0]], name="TiO2(110) 2x1 + O2 6 Å above")
    out.append(ads_case("tio2-110-o2-6a", o2, [nt, nt + 1], "geometry", note="a free molecule in the vacuum"))
    # upright ethanol and pyridine on thin Pt(111) slabs
    for nl in (3, 4):
        for mesh in ((3, 3), (2, 2)):
            base = pt111(nl, mesh)
            for mol, geo in (("ethanol", ETHANOL), ("pyridine", PYRIDINE)):
                s = on_top(base, geo, f"{base.name} + upright {mol}")
                out.append(ads_case(f"pt111-{nl}l-{mesh[0]}x{mesh[1]}-{mol}", s, range(len(base), len(s)), "geometry"))
    # CO on both sides of a 5-layer slab
    for mesh in ((1, 1), (3, 3)):
        b5 = pt111(5, mesh)
        two = co_upright(co_upright(b5, 1.85), 1.85, below=True)
        out.append(ads_case(f"pt111-5l-{mesh[0]}x{mesh[1]}-co-both-sides", two, range(len(b5), len(b5) + 4),
                            "geometry"))
    # low adatoms in four-fold hollows and a substitution
    for cid, kind, el, a, ad, h in (("n-fe100", "bcc", "Fe", A_BCC["Fe"], "N", 0.27),
                                    ("c-ni100", "fcc", "Ni", A_FCC["Ni"], "C", 0.10),
                                    ("o-cu100", "fcc", "Cu", A_FCC["Cu"], "O", 0.25)):
        b = metal_slab(kind, el, a, (1, 0, 0), 4, mesh=(2, 2))
        rows = rows_by_z(b)
        z_top = b.positions[rows[-1][0], 2]
        hollow = b.positions[rows[-2][0]]
        s = append(b, [ad], [[hollow[0], hollow[1], z_top + h]], name=f"{ad} in a {el}(100) hollow, {h:g} Å above")
        out.append(ads_case(f"{cid}-hollow-{h:g}", s, [len(b)], "geometry",
                            note="the adatom sits within the tolerance of the top layer; its low coordination marks it"
                            if cid == "n-fe100" else None))
    sub = pt111(4, (2, 2))
    sym = list(sub.symbols)
    sym[rows_by_z(sub)[-1][0]] = "Au"
    au = with_(sub, symbols=sym, name="Pt(111) 2x2 4L, one top Pt replaced by Au")
    out.append(ads_case("pt111-au-substituted", au, [], "none", note="a substitution: as coordinated as its Pt "
                                                                     "neighbours"))
    ml = pt111(4, (2, 2))
    ml_h = append(ml, ["H"] * 4, [ml.positions[i] + [0, 0, 1.55] for i in rows_by_z(ml)[-1]],
                  name="Pt(111) 2x2 + 1 ML H")
    out.append(ads_case("pt111-1ml-h", ml_h, range(16, 20), "geometry"))
    out.append(ads_case("pt111-bare", pt111(), [], "none"))
    cluster = make(["Pt", "Pt", "Pt", "C", "O"],
                   [[0, 0, 0], [2.77, 0, 0], [1.385, 2.3989, 0], [1.385, 0.7996, 1.30], [1.385, 0.7996, 2.45]], None,
                   (False, False, False), name="Pt3 + CO (no cell)")
    out.append(ads_case("cluster-no-cell", cluster, [], "none", note="no cell, no surface: no guess"))
    # tags and adsorbate ids
    base = pt111()
    co = co_upright(base, 1.85)
    n0 = len(base)
    ft = ref_layers(base)["atomFromTop"]
    oc20 = [1 if ft[i] <= 1 else 0 for i in range(n0)] + [2, 2]
    out.append(ads_case("tags-oc20", with_(co, props={"tags": oc20}, name=co.name + ", OC20 tags"),
                        [n0, n0 + 1], "tags-oc20"))
    ase = [ft[i] + 1 for i in range(n0)] + [0, 0]
    out.append(ads_case("tags-ase", with_(co, props={"tags": ase}, name=co.name + ", ASE tags"), [n0, n0 + 1], "tags"))
    b2 = pt111(2)
    co2 = co_upright(b2, 1.85)
    ft2 = ref_layers(b2)["atomFromTop"]
    out.append(ads_case("tags-ase-two-layers", with_(co2, props={"tags": [ft2[i] + 1 for i in range(len(b2))] + [0, 0]},
                                                     name=co2.name + ", ASE tags 1 and 2"),
                        [len(b2), len(b2) + 1], "tags", note="tags 1, 2 and 0: tag 2 is a periodic layer, so not OC20"))
    bad = [1 if ft[i] <= 1 else 0 for i in range(n0)] + [1, 1]
    out.append(ads_case("tags-zero-periodic", with_(co, props={"tags": bad}, name=co.name + ", tag 0 on two Pt layers"),
                        [n0, n0 + 1], "geometry", notes=[
                            "Atoms with tag 0 form a periodic layer, so the tags don't mark adsorbates; guessed from "
                            "the geometry."]))
    ids = with_(co, props={"adsorbate_id": [0] * n0 + [1, 1]}, name=co.name + ", adsorbate ids")
    out.append(ads_case("adsorbate-id", ids, [n0, n0 + 1], "adsorbate_id"))
    rows = rows_by_z(base)
    hollow = xy_image(base, inplane_nearest(base, base.positions[rows[-1][4]], rows[-3]), base.positions[rows[-1][4]])
    z_top = base.positions[rows[-1][0], 2]
    adatom = append(co, ["Pt"], [[hollow[0], hollow[1], z_top + 2.2]], name=co.name + " + a Pt adatom")
    out.append(ads_case("pt-adatom-not-guessed", adatom, [n0, n0 + 1], "geometry",
                        note="an adatom of the substrate element is not guessed: mark it"))
    out.append(mark_case("mark-pt-adatom", adatom, [n0 + 1, n0 + 2], [0] * n0 + [1, 1, 2],
                         note="promote_adsorbates numbers the CO 1, then mark_adsorbates gives the adatom 2 "
                              "(the CO's O, already numbered, is left alone)"))
    marked = with_(adatom, props={"adsorbate_id": [0] * n0 + [1, 1, 2]}, name=adatom.name + ", marked")
    out.append(ads_case("adsorbate-id-after-mark", marked, [n0, n0 + 1, n0 + 2], "adsorbate_id"))
    top = rows_by_z(base)[-1][1:]                 # top Pt atoms, not the one under the CO
    g = ref_graph(base)
    j, k = next((j, k) for j in top for k in top if j < k and all(e[0] != k for e in g.adj[j]))
    want = [0] * n0 + [1, 1]
    want[j], want[k] = 2, 3
    out.append(mark_case("mark-two-blocks", co, [k, j], want,
                         note="two top Pt atoms that are not bonded: one new id each, the lower atom first"))
    return out


# ------------------------------------------------------------------------------------------------ bonds.json
def family_bonds() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    co = co_top_fcc(pt111())
    n0 = 36
    out.append(bonds_case("pt111-co-top-fcc-all", co, full=True,
                          note="the bond graph reads no display setting (the web's default smart bonds hide Pt-Pt)"))
    out.append(bonds_case("pt111-co-top-fcc-smart", co, {"metalPairs": "smart"},
                          note="Pt-Pt bonds between Pt atoms bonded to C are dropped"))
    rows = rows_by_z(co)
    out.append(bonds_case("pt111-co-top-fcc-indices", co, {"indices": sorted(rows[3] + list(range(n0, n0 + 4)))}))
    out.append(bonds_case("pt111-co-top-fcc-ttf", relabel_ttf(co)))
    t = tio2_110()
    sites = tio2_sites(t)

    def ti5c(data: dict) -> None:
        deg = data["degree"]
        five = sorted(i for i in range(len(t)) if t.symbols[i] == "Ti" and deg[i] < 6)
        bottom = rows_by_z(t)[1]
        need(set(sites["ti5"]) <= set(five) and all(i in sites["ti5"] or i in bottom for i in five), str(five))

    out.append(bonds_case("tio2-110-2x1-smart", t, {"metalPairs": "smart"}, check=ti5c,
                          note="cn < 6 (smart) picks the Ti5c of both surfaces (M3 §7.1)"))
    out.append(bonds_case("tio2-110-2x1-all", t))
    t1 = tio2_110(1, mesh=(1, 1), name="TiO2(110) 1x1, one trilayer")
    out.append(bonds_case("tio2-110-1x1-1tl-all", t1, full=True,
                          note="1x1 along [001]: the bridging O bonds to two images of the same Ti"))
    out.append(bonds_case("graphene-4x4", graphene(4), check=lambda d: need(set(d["degree"]) == {3})))
    out.append(bonds_case("mos2-4x4-smart", mos2(4), {"metalPairs": "smart"}))
    out.append(bonds_case("mos2-4x4-all", mos2(4)))
    out.append(bonds_case("srtio3-001-tio2-7l-smart", perovskite_001(7, "TiO2"), {"metalPairs": "smart"}))
    cluster = make(["Pt", "Pt", "Pt", "C", "O"],
                   [[0, 0, 0], [2.77, 0, 0], [1.385, 2.3989, 0], [1.385, 0.7996, 1.30], [1.385, 0.7996, 2.45]], None,
                   (False, False, False), name="Pt3 + CO (no cell)")
    out.append(bonds_case("cluster-no-cell", cluster, full=True))
    return out


# ------------------------------------------------------------------------------------------------ exposure.json
KAPPA_STAR = {  # M3 §3.9: kappa* of the rows below the top one (the top row has nothing above it)
    ("fcc", (1, 1, 1)): [2 / math.sqrt(3) - 1],
    ("fcc", (1, 0, 0)): [math.sqrt(2) - 1],
    ("fcc", (1, 1, 0)): [1.0],
    ("fcc", (2, 1, 1)): [2 * math.sqrt(3) - 1, math.sqrt(3) - 1],
    ("bcc", (1, 1, 0)): [2 / math.sqrt(3) - 1],
    ("bcc", (1, 0, 0)): [math.sqrt(3) - 1],
    ("bcc", (1, 1, 1)): [2.0, 1.0],
}


def family_exposure() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    series = [("fcc", el, A_FCC[el]) for el in ("Ni", "Cu", "Rh", "Pd", "Pt", "Au", "Ag")] + \
             [("bcc", el, A_BCC[el]) for el in ("Fe", "Mo", "W")]
    for kind, el, a in series:
        for (k2, hkl), kappas in KAPPA_STAR.items():
            if k2 != kind:
                continue
            nl = 6 if hkl in ((2, 1, 1), (1, 1, 1)) and (kind, hkl) != ("fcc", (1, 1, 1)) else 4
            s = metal_slab(kind, el, a, hkl, nl)

            def check(r: dict, s=s, kappas=kappas) -> None:
                rows = list(reversed(rows_by_z(s)))
                need(r["exposure"][rows[0][0]] is None)
                for row, want in zip(rows[1:], kappas):
                    need(all(approx(r["exposure"][i], want) for i in row), f"{s.name}: {r['exposure']}")
                need(approx(r["radius"], a / (2 * math.sqrt(2)) if kind == "fcc" else a * math.sqrt(3) / 4))

            label = "".join(str(x) for x in hkl)
            out.append(surface_case(f"exposure-{el.lower()}{label}", s, check=check, note=(
                f"kappa* of the rows below the top: {', '.join(f'{x:.6f}' for x in kappas)}, the same for every "
                f"{kind} metal (M3 §3.9)") if el in ("Ni", "Fe") else None))
    # the fcc(211) step bottom: relaxation and the probe size
    p211 = metal_slab("fcc", "Pt", A_PT, (2, 1, 1), 9)    # 9 planes: moving the edge leaves R (a median) alone
    top = list(reversed(rows_by_z(p211)))
    edge = set(top[0])
    inwards = np.array([[0.0, 0.0, 0.10 if i in edge else 0.0] for i in range(len(p211))])
    relaxed = with_(p211, positions=p211.positions - inwards, name="Pt(211) 1x1 9L, step edge 0.10 Å inwards")
    out.append(surface_case("exposure-pt211-edge-in-0.1", relaxed,
                            check=lambda r: need(approx(r["exposure"][top[2][0]], 0.77, 0.01)
                                                 and top[2][0] in r["atoms"]),
                            note="M3 §7.1: the step bottom's kappa* rises to about 0.77 and stays exposed"))
    for probe in (0.5, 1.0):
        out.append(surface_case(f"exposure-pt211-probe-{probe:g}", p211, {"probe": probe}))
    # the CONTCAR fixture, adsorbates and the two sides
    out.append(surface_case("exposure-contcar-pt111", {"file": "surface/contcar_pt111.vasp"},
                            check=lambda r: need(len(r["atoms"]) == 9)))
    co = co_top_fcc(pt111())
    out.append(surface_case("exposure-pt111-co", co, check=lambda r: need(len(r["atoms"]) == 9),
                            note="the left-out CO neither counts nor blocks: the Pt under it is exposed"))
    out.append(surface_case("exposure-pt111-co-with-adsorbates", co, {"skipAdsorbates": False}))
    out.append(surface_case("exposure-pt111-bottom", pt111(), {"side": "bottom"},
                            check=lambda r: need(len(r["atoms"]) == 9)))
    two = co_upright(co_upright(pt111(5), 1.85), 1.85, below=True)
    out.append(surface_case("exposure-pt111-5l-both-sides", two, {"side": "both"},
                            check=lambda r: need(len(r["top"]) == 9 and len(r["bottom"]) == 9)))
    out.append(surface_case("exposure-pt111-ttf", relabel_ttf(pt111()), check=lambda r: need(len(r["atoms"]) == 9)))
    out.append(surface_case("exposure-ru0001-1x1", hcp_slab("Ru", RU_A, RU_C, 4),
                            note="a 1x1 cell: every blocking atom is a periodic image"))
    # oxides and a dichalcogenide
    t = tio2_110()
    sites = tio2_sites(t)

    def tio2(r: dict) -> None:
        top_set = set(sites["obr"]) | set(sites["ti5"]) | set(sites["o3"])
        need(set(r["atoms"]) == top_set, f"{r['atoms']} vs {sorted(top_set)}")
        need(all(approx(r["exposure"][i], 0.537, 0.005) for i in sites["ti6"]))

    out.append(surface_case("exposure-tio2-110", t, check=tio2,
                            note="O_br, Ti5c and O3c are exposed; Ti6c (kappa* 0.537) is not (M3 §7.1)"))
    for cid, s in (("exposure-srtio3-tio2-7l", perovskite_001(7, "TiO2")),
                   ("exposure-srtio3-sro-7l", perovskite_001(7, "SrO")), ("exposure-ceo2-111", ceo2_111()),
                   ("exposure-zno-1010", zno_1010()), ("exposure-al2o3-0001", al2o3_0001()),
                   ("exposure-nacl-100", nacl_100()), ("exposure-mos2", mos2(4))):
        out.append(surface_case(cid, s))
    # errors
    b0 = build.crystal("fcc", ["Pt"], a=A_PT)
    bulk = make(b0.symbols, b0.positions, b0.cell, b0.pbc, name="Pt fcc (conventional cell)")
    out.append(error_case("exposure-error-bulk", "surfaceAtoms", bulk, {},
                          "no vacuum gap of 5 Å or more along a cell vector", lambda: ref_surface(bulk),
                          note="the require_gap message (vacuum_gap_hint), as every surface tool"))
    out.append(error_case("exposure-error-direction", "surfaceAtoms", pt111(), {"direction": [1, 2, 3.1]},
                          "surface atoms need the slab normal; this direction is not a cell axis",
                          lambda: ref_surface(pt111(), direction=[1, 2, 3.1])))
    return out


# ================================================================================================= files
FILES: dict[str, tuple[Callable[[], list[dict[str, Any]]], str]] = {
    "pt111.json": (family_pt111, (
        "M3 layer analysis (findLayers), Pt(111): p(3×3) 4L in four placements along c, shuffled and T T F, the "
        "directions and tolerances, the errors of M3 §3.16, CO on top and in an fcc hollow, the shared CONTCAR "
        "(acceptance S14-3) and a jittered CONTCAR-like copy with two CO, CO 6-8 Å above the slab, vacuum along a, "
        "bulk Pt along c / (111) / an irrational vector, a cluster without a cell, partial occupancy, adsorbates "
        "on the bottom side and the 216-atom p(6×6) 6L slab.")),
    "metals.json": (family_metals, (
        "M3 layer analysis (findLayers), metal faces built plane by plane: the spacings of M3 §7.1 (Cu(100), "
        "Ag(111), Ru(0001), Fe(110)/(100)/(111), Pt(110), Pt(211)) and the warnings of the vicinal Pt(554) and "
        "Pt(332).")),
    "oxides.json": (family_oxides, (
        "M3 layer analysis (findLayers) on oxides from the bulk prototypes: TiO2(110) ideal and with LEED-size "
        "displacements, ZnO(10-10) ideal and with the top Zn moved in (the displaced slabs at 0.3 and 0.5 Å), "
        "SrTiO3(001) both terminations, CeO2(111), NaCl(100), Al2O3(0001) at 0.3 and 0.6 Å, stoichiometric units "
        "(group \"units\", M3 §3.6) and bulk wurtzite along four-index directions.")),
    "adsorbates.json": (family_adsorbates, (
        "M3 adsorbate recognition (findAdsorbates, markAdsorbates; findLayers with skipAdsorbates): the sources "
        "adsorbate_id, tags (OC20 and ASE) and geometry on 2D materials, TiO2(110), thin Pt(111) slabs with upright "
        "molecules, CO on both sides, low adatoms, a substitution, 1 ML H and a Pt adatom.")),
    "bonds.json": (family_bonds, (
        "M3 bond graph (bondGraph): CSR with periodic images, the 'all' and 'smart' metal-metal rules, an "
        "indices subgraph and the connected blocks, on Pt(111) + CO, TiO2(110), graphene, MoS2, SrTiO3 and a "
        "cluster.")),
    "exposure.json": (family_exposure, (
        "M3 exposed atoms (surfaceAtoms, closed-form probe, M3 §3.9): the fcc and bcc metal series (kappa* "
        "independent of the lattice constant), the Pt(211) step bottom, the CONTCAR, adsorbates, both sides, a "
        "1x1 cell, oxides, MoS2 and the errors.")),
}

HEADER = ("Generated by scripts/gen_layer_fixtures.py (M3-T2a); the op contracts and the decisions behind the "
          "expectations are in tests/data/surface/layers/README.md. ")


def on_disk(name: str) -> dict[str, Any] | None:
    """The case file *name* as it is on disk (None when there is none)."""
    path = OUT / name
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def render(name: str) -> str:
    """The case file *name*: the cases with their skips (from the ops registered now) and any xfail on disk."""
    fn, description = FILES[name]
    old = on_disk(name)
    xfail = {c["id"]: c["xfail"] for c in (old or {}).get("cases", []) if isinstance(c, dict) and "xfail" in c}
    cases = fn()
    for c in cases:
        skip = skip_for(c["op"], c.get("args", {}), registered_ops())
        if skip:
            c["skip"] = skip
        if c["id"] in xfail:
            c["xfail"] = xfail[c["id"]]
    lines = ["{", f'  "schema": {json.dumps(SCHEMA)},',
             f'  "description": {json.dumps(HEADER + description, ensure_ascii=False)},', '  "cases": [']
    body = [json.dumps(c, ensure_ascii=False, separators=(", ", ": ")) for c in cases]
    lines.append(",\n".join("    " + b for b in body))
    lines += ["  ]", "}"]
    return "\n".join(lines) + "\n"


def differences(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    """What differs between two case files as data: other top-level keys, then the ids of changed, new and
    removed cases, then ``(order)`` when only the order of the cases differs."""
    out = [k for k in sorted(set(old) | set(new)) if k != "cases" and old.get(k) != new.get(k)]
    a = {c.get("id"): c for c in old.get("cases", []) if isinstance(c, dict)}
    b = {c["id"]: c for c in new["cases"]}
    out += [i if i in a else f"{i} (new)" for i in b if a.get(i) != b[i]]
    out += [f"{i} (removed)" for i in a if i not in b]
    if not out and list(a) != list(b):
        out.append("(order)")
    return out


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="compare the cases with the files on disk instead of writing them (layout aside)")
    ap.add_argument("--only", metavar="FILE", action="append", help="limit to these files (e.g. pt111.json)")
    opts = ap.parse_args(argv)
    names = opts.only or list(FILES)
    ids: set[str] = set()
    status = 0
    for name in names:
        text = render(name)
        for c in json.loads(text)["cases"]:
            if c["id"] in ids:
                raise SystemExit(f"duplicate case id {c['id']}")
            ids.add(c["id"])
        path = OUT / name
        if opts.check:
            old = on_disk(name)
            diff = ["(missing)"] if old is None else differences(old, json.loads(text))
            if diff:
                more = f" and {len(diff) - 8} more" if len(diff) > 8 else ""
                print(f"{path.relative_to(ROOT)}: differs from the generator: {', '.join(diff[:8])}{more}")
                status = 1
            elif path.read_text(encoding="utf-8") != text:
                print(f"{path.relative_to(ROOT)}: the same cases in another layout (rewrite it to normalise)")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(json.loads(text)['cases'])} cases, {len(text) // 1024} KB)")
    return status


if __name__ == "__main__":
    sys.exit(main())
