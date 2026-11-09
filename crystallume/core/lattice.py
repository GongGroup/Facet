"""Lattice utilities: cell parameters <-> cell matrices, fractional <-> Cartesian.

Conventions
-----------
* A cell is a 3x3 array whose **rows** are the lattice vectors a, b, c (Å).
* ``cellpar_to_cell`` uses the standard crystallographic orientation:
  ``a`` along x, ``b`` in the xy-plane, ``c`` completing a right-handed set.
* Angles are in degrees.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

__all__ = [
    "cellpar_to_cell",
    "cell_to_cellpar",
    "frac_to_cart",
    "cart_to_frac",
    "cell_volume",
    "plane_spacings",
    "reciprocal_cell",
    "wrap_fractional",
]


def cellpar_to_cell(
    a: float,
    b: float,
    c: float,
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
) -> np.ndarray:
    """Build a cell matrix (rows = lattice vectors) from lengths and angles.

    Raises ``ValueError`` if the parameters do not describe a valid cell.
    """
    if min(a, b, c) <= 0:
        raise ValueError("cell lengths must be positive")
    al, be, ga = np.radians([alpha, beta, gamma])
    ca, cb, cg = np.cos(al), np.cos(be), np.cos(ga)
    sg = np.sin(ga)
    # Snap tiny numerical noise for right angles so e.g. 90° gives exact zeros.
    ca, cb, cg = (0.0 if abs(v) < 1e-12 else v for v in (ca, cb, cg))
    if abs(sg) < 1e-12:
        raise ValueError("gamma must not be 0 or 180 degrees")
    va = np.array([a, 0.0, 0.0])
    vb = np.array([b * cg, b * sg, 0.0])
    cx = cb
    cy = (ca - cb * cg) / sg
    cz2 = 1.0 - cx * cx - cy * cy
    if cz2 <= 0:
        raise ValueError("cell angles are inconsistent (zero or negative volume)")
    vc = c * np.array([cx, cy, np.sqrt(cz2)])
    return np.array([va, vb, vc], dtype=float)


def cell_to_cellpar(cell: np.ndarray | Sequence[Sequence[float]]) -> tuple[float, float, float, float, float, float]:
    """Return ``(a, b, c, alpha, beta, gamma)`` for a cell matrix (angles in degrees)."""
    m = np.asarray(cell, dtype=float).reshape(3, 3)
    lengths = np.linalg.norm(m, axis=1)

    def angle(u: np.ndarray, v: np.ndarray, lu: float, lv: float) -> float:
        if lu == 0 or lv == 0:
            return 90.0
        x = float(np.clip(np.dot(u, v) / (lu * lv), -1.0, 1.0))
        return float(np.degrees(np.arccos(x)))

    a, b, c = (float(v) for v in lengths)
    alpha = angle(m[1], m[2], b, c)
    beta = angle(m[0], m[2], a, c)
    gamma = angle(m[0], m[1], a, b)
    return a, b, c, alpha, beta, gamma


def frac_to_cart(frac: np.ndarray, cell: np.ndarray) -> np.ndarray:
    """Convert fractional coordinates (N x 3) to Cartesian using *cell*."""
    return np.asarray(frac, dtype=float) @ np.asarray(cell, dtype=float)


def cart_to_frac(cart: np.ndarray, cell: np.ndarray) -> np.ndarray:
    """Convert Cartesian coordinates (N x 3) to fractional using *cell*."""
    return np.linalg.solve(np.asarray(cell, dtype=float).T, np.asarray(cart, dtype=float).T).T


def cell_volume(cell: np.ndarray) -> float:
    """Absolute volume of the parallelepiped spanned by *cell* (Å^3)."""
    return float(abs(np.linalg.det(np.asarray(cell, dtype=float))))


def reciprocal_cell(cell: np.ndarray) -> np.ndarray:
    """Reciprocal cell without the 2π factor (rows b1, b2, b3; ``a_i·b_j = δ_ij``)."""
    return np.linalg.inv(np.asarray(cell, dtype=float)).T


def plane_spacings(cell: np.ndarray) -> np.ndarray:
    """Distances between opposite faces of the cell (perpendicular heights)."""
    rec = reciprocal_cell(cell)
    return 1.0 / np.linalg.norm(rec, axis=1)


def wrap_fractional(frac: Any, pbc: bool | Sequence[bool] = (True, True, True), eps: float = 1e-12) -> np.ndarray:
    """Fractional coordinates wrapped into the cell along the periodic axes (a new array, same shape).

    *frac* is one point ``(3,)`` or ``(N, 3)``; *pbc* a bool or three bools.  Along a periodic axis
    ``w = f - floor(f + eps)``, and ``w >= 1 - eps`` becomes 0: a coordinate within *eps* below a whole number is
    taken as that number, so an atom at ``f = -1e-17`` or ``0.9999999999999`` stays on the lower face instead of
    jumping to the upper one (the result can be a hair, at most *eps*, below 0).  Non-periodic axes are copied.
    This is the rule of :meth:`Structure.wrap`; the vacuum-gap analysis uses its own wrap
    (``SURFACE_DEFAULTS.gap_wrap_eps``, :mod:`crystallume.analysis.vacuum`).  JS: ``wrapFractional`` in
    ``web/js/core/lattice.js``.
    """
    out = np.array(frac, dtype=float)
    if out.shape[-1:] != (3,) or out.ndim > 2:
        raise ValueError(f"frac must be one point (3,) or an N x 3 array (got shape {out.shape})")
    mask = np.broadcast_to(np.asarray(pbc, dtype=bool), (3,))
    view = out[None, :] if out.ndim == 1 else out  # a view: writing it writes out
    sub = view[:, mask]
    sub = sub - np.floor(sub + eps)
    view[:, mask] = np.where(sub >= 1.0 - eps, 0.0, sub)
    return out
