"""Low-level geometry helpers (pure numpy; no dependency on :class:`Structure`).

These functions are used by :class:`atomscope.Structure` and the analysis
routines, and are handy for plugins too.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np

__all__ = [
    "minimum_image_vectors",
    "angle_between",
    "dihedral_from_vectors",
    "distance_matrix",
]


def minimum_image_vectors(vectors: np.ndarray, cell: np.ndarray, pbc: Sequence[bool]) -> np.ndarray:
    """Return the shortest periodic images of displacement *vectors* (M x 3).

    Works for arbitrary (skewed) cells: vectors are first reduced to the
    fractional range [-0.5, 0.5) and then the 27 neighbouring images are
    checked so that the true minimum image is found.
    """
    vec = np.atleast_2d(np.asarray(vectors, dtype=float))
    cell = np.asarray(cell, dtype=float)
    mask = np.asarray(pbc, dtype=bool)
    if not mask.any():
        return vec.copy()
    frac = np.linalg.solve(cell.T, vec.T).T
    frac[:, mask] -= np.round(frac[:, mask])
    reduced = frac @ cell
    rng = [(-1, 0, 1) if m else (0,) for m in mask]
    shifts = np.array([[i, j, k] for i in rng[0] for j in rng[1] for k in rng[2]], dtype=float) @ cell
    cand = reduced[:, None, :] + shifts[None, :, :]
    best = np.argmin(np.einsum("mki,mki->mk", cand, cand), axis=1)
    return cand[np.arange(len(cand)), best]


def angle_between(u: np.ndarray, v: np.ndarray) -> float:
    """Angle between two vectors in degrees (0 if either is zero-length)."""
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu == 0 or nv == 0:
        return 0.0
    c = float(np.clip(np.dot(u, v) / (nu * nv), -1.0, 1.0))
    return float(np.degrees(np.arccos(c)))


def dihedral_from_vectors(b0: np.ndarray, b1: np.ndarray, b2: np.ndarray) -> float:
    """Dihedral angle (degrees, [0, 360)) defined by consecutive bond vectors.

    For atoms i-j-k-l pass ``b0 = r_j - r_i``, ``b1 = r_k - r_j``, ``b2 = r_l - r_k``.
    """
    n1 = np.cross(b0, b1)
    n2 = np.cross(b1, b2)
    nb1 = np.linalg.norm(b1)
    if nb1 == 0 or np.linalg.norm(n1) == 0 or np.linalg.norm(n2) == 0:
        return 0.0
    # IUPAC sign convention (Blondel & Karplus 1996).
    y = float(nb1 * np.dot(b0, n2))
    x = float(np.dot(n1, n2))
    return float(np.degrees(np.arctan2(y, x)) % 360.0)


def distance_matrix(positions: np.ndarray, cell: np.ndarray | None = None, pbc: Sequence[bool] = (False,) * 3) -> np.ndarray:
    """Full N x N distance matrix (minimum image when a periodic cell is given).

    Intended for small systems only (O(N^2) memory); use
    :func:`atomscope.analysis.neighbors` for large structures.
    """
    pos = np.asarray(positions, dtype=float)
    diff = pos[None, :, :] - pos[:, None, :]
    if cell is not None and any(pbc):
        flat = minimum_image_vectors(diff.reshape(-1, 3), cell, pbc)
        diff = flat.reshape(diff.shape)
    return np.linalg.norm(diff, axis=-1)
