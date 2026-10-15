"""Cluster / nanoparticle builders.

``cluster(kind, element, size, a=None)`` with kinds:

=================  ===========================  ============================
kind               size means                   atom counts
=================  ===========================  ============================
icosahedron        number of shells (Mackay)    1, 13, 55, 147, 309, 561 ...
cuboctahedron      number of shells             1, 13, 55, 147, 309 ...
decahedron         atoms per edge (Ino; ``ino`` 1, 7, 23, 54, 105 ... (ino=0)
                   = (100) truncation depth)
octahedron         atoms per edge               1, 6, 19, 44, 85 ...
                   (``truncate`` = vertex cut)
tetrahedron        atoms per edge               1, 4, 10, 20, 35 ...
sphere             radius in Å (fcc lattice)    —
fullerene          ignored (C60)                60
=================  ===========================  ============================

``a`` is the fcc lattice constant (nearest-neighbour distance ``a/√2``).  When
omitted it comes from a table for common metals (Au 4.08, Cu 3.61, Ag 4.09,
Pt 3.92, Pd 3.89, Ni 3.52, Al 4.05, ...) or from ``2 × covalent radius``.
All clusters are centred at the origin and have no cell.
"""

from __future__ import annotations

import itertools
import math
from typing import Any

import numpy as np

from ..core.elements import covalent_radius, normalize_symbol
from ..core.structure import Structure
from .crystal import _REF_A

__all__ = ["CLUSTERS", "cluster", "nearest_neighbor_distance", "c60_positions"]

_PHI = (1.0 + math.sqrt(5.0)) / 2.0

#: Cluster metadata served to the UI (``GET /api/v1/info`` → ``clusters``).
CLUSTERS: dict[str, dict[str, Any]] = {
    "icosahedron": {"label": "Mackay icosahedron", "sizeLabel": "Shells", "sizeMin": 1, "sizeMax": 10,
                    "defaultSize": 3, "defaultElement": "Au", "magicNumbers": [1, 13, 55, 147, 309, 561, 923],
                    "description": "Mackay icosahedron with n concentric shells (n=2 → 13, n=3 → 55 atoms)."},
    "cuboctahedron": {"label": "Cuboctahedron", "sizeLabel": "Shells", "sizeMin": 1, "sizeMax": 10,
                      "defaultSize": 3, "defaultElement": "Cu", "magicNumbers": [1, 13, 55, 147, 309, 561, 923],
                      "description": "FCC cuboctahedron with n shells (same magic numbers as the icosahedron)."},
    "decahedron": {"label": "Ino decahedron", "sizeLabel": "Atoms per edge", "sizeMin": 1, "sizeMax": 12,
                   "defaultSize": 3, "defaultElement": "Ag", "params": {"ino": 0},
                   "description": "Pentagonal bipyramid made of five twinned fcc tetrahedra; "
                                  "'ino' truncates the equatorial edges with (100) facets."},
    "octahedron": {"label": "Octahedron", "sizeLabel": "Atoms per edge", "sizeMin": 1, "sizeMax": 14,
                   "defaultSize": 4, "defaultElement": "Pt", "params": {"truncate": 0},
                   "description": "Regular fcc octahedron with (111) facets; 'truncate' removes vertex layers."},
    "tetrahedron": {"label": "Tetrahedron", "sizeLabel": "Atoms per edge", "sizeMin": 1, "sizeMax": 16,
                    "defaultSize": 4, "defaultElement": "Pd",
                    "description": "Regular fcc tetrahedron with (111) facets."},
    "sphere": {"label": "FCC sphere", "sizeLabel": "Radius (Å)", "sizeMin": 1.0, "sizeMax": 40.0,
               "defaultSize": 6.0, "defaultElement": "Au",
               "description": "All fcc lattice sites within a sphere of the given radius (Å) around an atom."},
    "fullerene": {"label": "Fullerene C60", "sizeLabel": None, "sizeMin": None, "sizeMax": None,
                  "defaultSize": 1, "defaultElement": "C",
                  "description": "Buckminsterfullerene C60 (Ih; 1.455 Å and 1.391 Å bonds)."},
}
for _k, _v in CLUSTERS.items():
    _v.setdefault("name", _k)
    _v.setdefault("params", {})


def nearest_neighbor_distance(element: str, a: float | None = None) -> tuple[float, float]:
    """Return ``(d_nn, a_fcc)`` for *element*: from *a*, the metal table, or covalent radii."""
    if a:
        return float(a) / math.sqrt(2.0), float(a)
    if element in _REF_A["fcc"]:
        av = _REF_A["fcc"][element]
        return av / math.sqrt(2.0), av
    d = 2.0 * covalent_radius(element)
    return d, d * math.sqrt(2.0)


# ---------------------------------------------------------------- geometry
def _icosahedron_vertices() -> np.ndarray:
    v = []
    for s1 in (1, -1):
        for s2 in (1, -1):
            v.append((0, s1, s2 * _PHI))
            v.append((s1, s2 * _PHI, 0))
            v.append((s2 * _PHI, 0, s1))
    return np.array(v, dtype=float)


def _icosahedron_faces(verts: np.ndarray) -> list[tuple[int, int, int]]:
    edge = 2.0
    faces = []
    for i, j, k in itertools.combinations(range(len(verts)), 3):
        if (abs(np.linalg.norm(verts[i] - verts[j]) - edge) < 1e-6
                and abs(np.linalg.norm(verts[j] - verts[k]) - edge) < 1e-6
                and abs(np.linalg.norm(verts[i] - verts[k]) - edge) < 1e-6):
            faces.append((i, j, k))
    return faces


def _unique_rows(points: np.ndarray, decimals: int = 5) -> np.ndarray:
    if len(points) == 0:
        return points.reshape(0, 3)
    key = np.round(points, decimals) + 0.0
    _, idx = np.unique(key, axis=0, return_index=True)
    return points[np.sort(idx)]


def _mackay(shells: int, d: float) -> np.ndarray:
    verts = _icosahedron_vertices()
    faces = _icosahedron_faces(verts)
    unit = verts / np.linalg.norm(verts[0])  # vertex radius 1
    pts = [np.zeros(3)]
    for k in range(1, shells):
        for (a, b, c) in faces:
            for i in range(k + 1):
                for j in range(k + 1 - i):
                    l = k - i - j
                    pts.append((i * unit[a] + j * unit[b] + l * unit[c]) * d)
    return _unique_rows(np.array(pts))


def _fcc_points(bound: int) -> np.ndarray:
    r = np.arange(-bound, bound + 1)
    g = np.array(np.meshgrid(r, r, r, indexing="ij")).reshape(3, -1).T
    return g[(g.sum(axis=1) % 2) == 0]


def _cuboctahedron(shells: int, d: float) -> np.ndarray:
    m = shells - 1
    g = _fcc_points(max(m, 0))
    ag = np.abs(g)
    norm = np.maximum(ag.sum(axis=1) / 2.0, ag.max(axis=1))
    pts = g[norm <= m + 1e-9].astype(float)
    return pts * d / math.sqrt(2.0)


def _octahedron(edge_atoms: int, d: float, truncate: int = 0) -> np.ndarray:
    m = edge_atoms - 1
    c = np.array([m % 2, 0, 0])
    g = _fcc_points(m + 1)
    rel = g - c
    ok = np.abs(rel).sum(axis=1) <= m
    if truncate > 0:
        ok &= np.abs(rel).max(axis=1) <= m - truncate
    pts = rel[ok].astype(float)
    return pts * d / math.sqrt(2.0)


def _tetrahedron(edge_atoms: int, d: float) -> np.ndarray:
    a1 = np.array([1.0, 0.0, 0.0])
    a2 = np.array([0.5, math.sqrt(3) / 2, 0.0])
    a3 = np.array([0.5, math.sqrt(3) / 6, math.sqrt(2.0 / 3.0)])
    n = edge_atoms - 1
    pts = [i * a1 + j * a2 + k * a3 for i in range(n + 1) for j in range(n + 1 - i) for k in range(n + 1 - i - j)]
    return np.array(pts) * d


def _decahedron(edge_atoms: int, d: float, ino: int = 0) -> np.ndarray:
    n = edge_atoms - 1
    if n <= 0:
        return np.zeros((1, 3))
    radius = n * d / (2.0 * math.sin(math.pi / 5.0))
    top = np.array([0.0, 0.0, n * d / 2.0])
    bottom = -top
    eq = [np.array([radius * math.cos(2 * math.pi * k / 5), radius * math.sin(2 * math.pi * k / 5), 0.0]) for k in range(5)]
    pts = []
    for k in range(5):
        e1, e2 = eq[k], eq[(k + 1) % 5]
        for i in range(n + 1):  # towards top
            for j in range(n + 1 - i):  # towards e1
                for l in range(n + 1 - i - j):  # towards e2
                    if ino > 0 and j + l > n - ino:
                        continue
                    pts.append(bottom + (i * (top - bottom) + j * (e1 - bottom) + l * (e2 - bottom)) / n)
    return _unique_rows(np.array(pts))


def _sphere(radius: float, a: float) -> np.ndarray:
    half = a / 2.0
    bound = int(math.ceil(radius / half)) + 1
    g = _fcc_points(bound).astype(float) * half
    return g[np.linalg.norm(g, axis=1) <= radius + 1e-6]


def c60_positions(bond_56: float = 1.455, bond_66: float = 1.391) -> np.ndarray:
    """Cartesian coordinates (Å) of icosahedral C60 with the given bond lengths.

    Each atom sits on an edge of an icosahedron at fraction ``f`` from a
    vertex; ``f`` and the icosahedron edge ``L`` are chosen so that pentagon
    edges (5:6 bonds) equal ``f·L`` and hexagon-hexagon bonds (6:6) ``(1-2f)·L``.
    """
    ratio = bond_56 / bond_66
    f = ratio / (1.0 + 2.0 * ratio)
    edge = bond_56 / f
    verts = _icosahedron_vertices() * (edge / 2.0)  # unit vertices have edge 2
    pts = []
    for i in range(12):
        for j in range(12):
            if i != j and abs(np.linalg.norm(verts[i] - verts[j]) - edge) < 1e-6:
                pts.append((1.0 - f) * verts[i] + f * verts[j])
    return np.array(pts)


def cluster(kind: str, element: str | None = None, size: float = 3, a: float | None = None, **kw: Any) -> Structure:
    """Build a cluster/nanoparticle (see module docstring for *kind* and *size*).

    Extra keyword parameters: ``ino`` (decahedron), ``truncate`` (octahedron).
    """
    k = kind.strip().lower()
    aliases = {"ico": "icosahedron", "mackay": "icosahedron", "cubo": "cuboctahedron", "deca": "decahedron",
               "ino": "decahedron", "octa": "octahedron", "tetra": "tetrahedron", "c60": "fullerene",
               "buckyball": "fullerene"}
    k = aliases.get(k, k)
    if k not in CLUSTERS:
        raise ValueError(f"unknown cluster kind {kind!r}; available: {', '.join(CLUSTERS)}")
    meta = CLUSTERS[k]
    elem = normalize_symbol(element) if element else meta["defaultElement"]
    info: dict[str, Any] = {"source": f"builder:cluster:{k}", "cluster": k}
    if k == "fullerene":
        elem = normalize_symbol(element) if element else "C"
        pos = c60_positions()
        info["size"] = 60
    else:
        if size is None:
            size = meta["defaultSize"]
        if k == "sphere":
            radius = float(size)
            if radius <= 0:
                raise ValueError("sphere radius must be positive")
            if radius > 100:
                raise ValueError("sphere radius is limited to 100 Å")
        else:
            n = int(size)
            if n < 1:
                raise ValueError(f"{meta['sizeLabel'].lower()} must be >= 1")
            if n > 40:
                raise ValueError("size is limited to 40 for polyhedral clusters")
        d, a_fcc = nearest_neighbor_distance(elem, a)
        info["nnDistance"] = round(d, 6)
        info["a"] = round(a_fcc, 6)
        info["size"] = float(size) if k == "sphere" else int(size)
        if k == "icosahedron":
            pos = _mackay(int(size), d)
        elif k == "cuboctahedron":
            pos = _cuboctahedron(int(size), d)
        elif k == "octahedron":
            t = int(kw.get("truncate", 0) or 0)
            info["truncate"] = t
            pos = _octahedron(int(size), d, t)
        elif k == "tetrahedron":
            pos = _tetrahedron(int(size), d)
        elif k == "decahedron":
            ino = int(kw.get("ino", 0) or 0)
            info["ino"] = ino
            pos = _decahedron(int(size), d, ino)
        else:
            pos = _sphere(float(size), a_fcc)
    if len(pos) == 0:
        raise ValueError("cluster parameters produce no atoms")
    pos = pos - pos.mean(axis=0)
    pos[np.abs(pos) < 1e-10] = 0.0
    s = Structure([elem] * len(pos), pos, cell=None, pbc=False, info=info)
    s.name = f"{elem}{len(s)} {k}"
    return s
