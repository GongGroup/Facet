"""Neighbour / bond detection with an O(N) cell list, plus derived analyses.

Bond criterion (default): ``0.1 Å < d < scale * (r_cov(i) + r_cov(j))`` with
Cordero covalent radii and ``scale = 1.15``.  When ``cutoff`` is given, a
uniform distance cutoff is used instead.

Periodic boundary conditions are handled by generating only those periodic
images ("ghost atoms") that lie within the cutoff of the unit cell, so the
search is exact for any cell shape and any cutoff (also cutoffs larger than
the cell).  Atoms are binned on a cubic grid with bin size >= cutoff and only
the 27 neighbouring bins are searched, which makes the cost linear in N.

Each bond is reported once as ``(i, j, distance, (ox, oy, oz))`` where the
offset is the integer lattice translation to apply to atom *j*::

    r_j_image = positions[j] + offset @ cell

so that ``|r_j_image - positions[i]| == distance`` (offsets refer to the
*unwrapped* input positions).  Pairs are ordered ``i < j``; a bond between an
atom and its own periodic image (``i == j``) is listed once with a
lexicographically positive offset.
"""

from __future__ import annotations

import math
from typing import Any, NamedTuple, Sequence

import numpy as np

from ..core.elements import covalent_radius
from ..core.lattice import cart_to_frac, plane_spacings
from ..core.structure import Structure

__all__ = [
    "NeighborList",
    "neighbor_arrays",
    "neighbors",
    "coordination_numbers",
    "rdf",
    "summary",
]

_CHUNK = 4096  # originals processed per batch (bounds memory use)


class NeighborList(NamedTuple):
    """Vectorised bond list: parallel arrays of length M."""

    i: np.ndarray  #: first atom index (int)
    j: np.ndarray  #: second atom index (int)
    distance: np.ndarray  #: bond length in Å (float)
    offset: np.ndarray  #: (M, 3) int lattice offsets applied to atom j

    @property
    def count(self) -> int:
        """Number of bonds."""
        return int(self.i.shape[0])

    def to_list(self, decimals: int = 4) -> list[list[Any]]:
        """``[[i, j, d, [ox, oy, oz]], ...]`` — the REST API representation."""
        d = np.round(self.distance, decimals).tolist()
        return [[int(a), int(b), dd, [int(x) for x in o]] for a, b, dd, o in zip(self.i.tolist(), self.j.tolist(), d, self.offset.tolist())]


def _radii(symbols: Sequence[str]) -> np.ndarray:
    cache: dict[str, float] = {}
    out = np.empty(len(symbols))
    for k, s in enumerate(symbols):
        r = cache.get(s)
        if r is None:
            r = cache[s] = covalent_radius(s)
        out[k] = r
    return out


def _empty() -> NeighborList:
    return NeighborList(np.zeros(0, int), np.zeros(0, int), np.zeros(0), np.zeros((0, 3), int))


def neighbor_arrays(
    structure: Structure,
    cutoff: float | None = None,
    scale: float = 1.15,
    pbc: bool = True,
    min_distance: float = 0.1,
    radii: Sequence[float] | None = None,
) -> NeighborList:
    """Find all bonded pairs; returns a :class:`NeighborList` of numpy arrays.

    Parameters
    ----------
    cutoff:
        Uniform distance cutoff (Å).  ``None`` uses the covalent-radius criterion.
    scale:
        Multiplier for the sum of covalent radii (ignored when *cutoff* is set).
    pbc:
        Honour the structure's periodic boundary conditions (requires a cell).
    min_distance:
        Pairs closer than this (overlapping atoms) are ignored.
    radii:
        Optional per-atom radii overriding the covalent radii.
    """
    pos = np.asarray(structure.positions, dtype=float)
    n = len(pos)
    if n == 0:
        return _empty()
    rad = np.asarray(radii, dtype=float) if radii is not None else _radii(structure.symbols)
    rc = float(cutoff) if cutoff is not None else float(scale * 2.0 * rad.max())
    if not rc > 0:
        return _empty()

    use_pbc = bool(pbc) and structure.cell is not None and any(structure.pbc)
    pmask = np.array(structure.pbc if use_pbc else [False] * 3, dtype=bool)
    wrap = np.zeros((n, 3), dtype=np.int64)
    if use_pbc:
        cell = np.asarray(structure.cell, dtype=float)
        frac = cart_to_frac(pos, cell)
        wrap[:, pmask] = np.floor(frac[:, pmask]).astype(np.int64)
        fw = frac - wrap
        base = fw @ cell
        h = plane_spacings(cell)
        margin = np.where(pmask, rc / h, 0.0)
        nrep = [int(math.ceil(margin[k])) if pmask[k] else 0 for k in range(3)]
        all_pos = [base]
        all_idx = [np.arange(n)]
        all_shift = [np.zeros((n, 3), dtype=np.int64)]
        for sx in range(-nrep[0], nrep[0] + 1):
            for sy in range(-nrep[1], nrep[1] + 1):
                for sz in range(-nrep[2], nrep[2] + 1):
                    if sx == sy == sz == 0:
                        continue
                    s = np.array([sx, sy, sz])
                    f = fw + s
                    ok = np.ones(n, dtype=bool)
                    for k in range(3):
                        if pmask[k]:
                            ok &= (f[:, k] >= -margin[k]) & (f[:, k] < 1.0 + margin[k])
                    if not ok.any():
                        continue
                    idx = np.nonzero(ok)[0]
                    all_pos.append(f[idx] @ cell)
                    all_idx.append(idx)
                    all_shift.append(np.broadcast_to(s, (len(idx), 3)).astype(np.int64))
        P = np.vstack(all_pos)
        I = np.concatenate(all_idx)
        S = np.vstack(all_shift)
    else:
        base = pos
        P, I, S = pos, np.arange(n), np.zeros((n, 3), dtype=np.int64)

    origin = P.min(axis=0)
    bins = np.floor((P - origin) / rc).astype(np.int64)
    dims = bins.max(axis=0) + 1
    lin = (bins[:, 0] * dims[1] + bins[:, 1]) * dims[2] + bins[:, 2]
    order = np.argsort(lin, kind="stable")
    lin_sorted = lin[order]
    obins = bins[:n]  # originals come first in P
    offsets27 = np.array([[a, b, c] for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)], dtype=np.int64)

    out_i, out_j, out_d, out_s = [], [], [], []
    for c0 in range(0, n, _CHUNK):
        ci = np.arange(c0, min(n, c0 + _CHUNK))
        cb = obins[ci]
        for off in offsets27:
            nb = cb + off
            valid = np.all((nb >= 0) & (nb < dims), axis=1)
            if not valid.any():
                continue
            iv = ci[valid]
            nbv = nb[valid]
            nl = (nbv[:, 0] * dims[1] + nbv[:, 1]) * dims[2] + nbv[:, 2]
            start = np.searchsorted(lin_sorted, nl, side="left")
            end = np.searchsorted(lin_sorted, nl, side="right")
            counts = end - start
            total = int(counts.sum())
            if total == 0:
                continue
            i_rep = np.repeat(iv, counts)
            run_start = np.cumsum(counts) - counts
            sorted_pos = np.repeat(start - run_start, counts) + np.arange(total)
            jj = order[sorted_pos]
            jo = I[jj]
            sh = S[jj]
            # dedupe: keep i < j, or i == j with lexicographically positive shift
            lexpos = (sh[:, 0] > 0) | ((sh[:, 0] == 0) & ((sh[:, 1] > 0) | ((sh[:, 1] == 0) & (sh[:, 2] > 0))))
            keep = (i_rep < jo) | ((i_rep == jo) & lexpos)
            if not keep.any():
                continue
            i_rep, jj, jo, sh = i_rep[keep], jj[keep], jo[keep], sh[keep]
            dvec = P[jj] - base[i_rep]
            dist = np.sqrt(np.einsum("ij,ij->i", dvec, dvec))
            thr = rc if cutoff is not None else scale * (rad[i_rep] + rad[jo])
            ok = (dist < thr) & (dist > min_distance)
            if not ok.any():
                continue
            out_i.append(i_rep[ok])
            out_j.append(jo[ok])
            out_d.append(dist[ok])
            out_s.append(sh[ok])

    if not out_i:
        return _empty()
    bi = np.concatenate(out_i)
    bj = np.concatenate(out_j)
    bd = np.concatenate(out_d)
    bs = np.vstack(out_s)
    offset = bs - wrap[bj] + wrap[bi]
    srt = np.lexsort((bj, bi))
    return NeighborList(bi[srt], bj[srt], bd[srt], offset[srt].astype(int))


def neighbors(
    structure: Structure,
    cutoff: float | None = None,
    scale: float = 1.15,
    pbc: bool = True,
    min_distance: float = 0.1,
) -> list[tuple[int, int, float, tuple[int, int, int]]]:
    """Bond list ``[(i, j, distance, (ox, oy, oz)), ...]`` (see module docstring)."""
    nl = neighbor_arrays(structure, cutoff=cutoff, scale=scale, pbc=pbc, min_distance=min_distance)
    return [
        (int(a), int(b), float(d), (int(o[0]), int(o[1]), int(o[2])))
        for a, b, d, o in zip(nl.i.tolist(), nl.j.tolist(), nl.distance.tolist(), nl.offset.tolist())
    ]


def coordination_numbers(
    structure: Structure,
    cutoff: float | None = None,
    scale: float = 1.15,
    pbc: bool = True,
) -> np.ndarray:
    """Number of bonded neighbours of every atom (int array of length N)."""
    nl = neighbor_arrays(structure, cutoff=cutoff, scale=scale, pbc=pbc)
    n = len(structure)
    return np.bincount(nl.i, minlength=n) + np.bincount(nl.j, minlength=n)


def rdf(
    structure: Structure,
    rmax: float = 8.0,
    nbins: int = 160,
    elements: tuple[str, str] | None = None,
    pbc: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """Radial distribution function g(r).

    Returns ``(r, g)`` where ``r`` are bin centres.  For periodic structures the
    number density uses the cell volume; for finite systems the bounding-box
    volume is used (so absolute values are only indicative).  With
    ``elements=("Si", "O")`` the partial g_AB(r) is computed.
    """
    if rmax <= 0 or nbins < 1:
        raise ValueError("rmax must be > 0 and nbins >= 1")
    n = len(structure)
    edges = np.linspace(0.0, rmax, nbins + 1)
    centers = 0.5 * (edges[1:] + edges[:-1])
    if n < 2 and not (structure.cell is not None and any(structure.pbc)):
        return centers, np.zeros(nbins)
    nl = neighbor_arrays(structure, cutoff=rmax, pbc=pbc, min_distance=1e-8)
    syms = np.asarray(structure.symbols)
    if elements is not None:
        a, b = elements
        sa, sb = syms[nl.i], syms[nl.j]
        sel = ((sa == a) & (sb == b)) | ((sa == b) & (sb == a))
        dist = nl.distance[sel]
        na, nb = int((syms == a).sum()), int((syms == b).sum())
        pair_factor = 2.0 if a == b else 1.0
    else:
        dist = nl.distance
        na = nb = n
        pair_factor = 2.0
    hist, _ = np.histogram(dist, bins=edges)
    use_pbc = pbc and structure.cell is not None and any(structure.pbc)
    if use_pbc and structure.volume:
        volume = structure.volume
    else:
        lo, hi = structure.bounding_box
        volume = float(np.prod(np.maximum(hi - lo, 1.0)))
    if na == 0 or nb == 0:
        return centers, np.zeros(nbins)
    shell = 4.0 / 3.0 * np.pi * (edges[1:] ** 3 - edges[:-1] ** 3)
    # Each unordered pair is counted once in ``hist``; the ideal-gas expectation
    # for ordered A-B pairs in a shell is na * nb * shell / V.
    g = pair_factor * hist / (na * nb * shell / volume)
    return centers, g


def summary(structure: Structure) -> dict[str, Any]:
    """Human/UI-friendly summary of a structure (JSON-serialisable dict).

    Keys: ``name, formula, reducedFormula, natoms, nframes, composition, pbc,
    volume, density, cellpar, cell, mass, boundingBox, spacegroup``.
    """
    lo, hi = structure.bounding_box
    cellpar = structure.cellpar
    vol = structure.volume
    dens = structure.density
    return {
        "name": structure.name,
        "formula": structure.formula,
        "reducedFormula": structure.get_formula(reduce=True),
        "natoms": len(structure),
        "nframes": structure.n_frames,
        "composition": structure.composition,
        "pbc": [bool(p) for p in structure.pbc],
        "volume": None if vol is None else round(vol, 6),
        "density": None if dens is None else round(dens, 6),
        "cellpar": None if cellpar is None else [round(float(v), 6) for v in cellpar],
        "cell": None if structure.cell is None else (np.round(structure.cell, 6) + 0.0).tolist(),
        "mass": round(float(structure.masses.sum()), 6),
        "boundingBox": {
            "min": (np.round(lo, 6) + 0.0).tolist(),
            "max": (np.round(hi, 6) + 0.0).tolist(),
            "size": (np.round(hi - lo, 6) + 0.0).tolist(),
        },
        "spacegroup": structure.info.get("spacegroup"),
    }
