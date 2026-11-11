"""M2 (cleave and slab): the ops ``terminations`` and ``surface`` of the shared cases under
``tests/data/surface/cleave/`` (its README documents the contracts).  The JS half is ``tests/js/ops/m2_analysis.mjs``.

- ``terminations``: ``facet.build.surface_analysis(bulk, miller, ...)``.  The result (``SurfaceAnalysis.to_dict()``)
  is flattened from the top (``mesh.a``, ``terminations.0.label``, ...), plus ``terminationCount``, ``labels``,
  ``brokenBonds``, ``polar`` (per termination) and the views that do not depend on where the ring of one period
  starts: ``stack``, ``gapsBelow`` and ``topIndices``.
- ``surface``: ``facet.build.surface(bulk, miller, vacuum=..., ...)``.  Returns the slab as ``structure`` (its
  ``info.warnings`` are the case's ``warnings``), ``info.surface`` flattened under ``surface``, ``zRange``, ``volume``
  and ``minDistance``.

Arguments are camelCase in the cases and become snake_case keywords here; ``keepMolecules`` (an optional feature
of the design that is not implemented) raises ``ValueError``.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from facet import build

from ..cases import CaseInput, op, snake_args

TERMINATION_ARGS = ("miller", "millerBasis", "primitive", "translationTolerance", "layerTolerance", "charges",
                    "keepMolecules")
SURFACE_ARGS = ("miller", "vacuum", "layers", "periods", "thickness", "termination", "cut", "symmetric", "position",
                "offset", "supercell", "primitive", "millerBasis", "translationTolerance", "fixBottom", "fixMiddle",
                "fixAxes", "layerTolerance", "charges", "keepMolecules", "name")


def flatten(prefix: str, value: Any, out: dict[str, Any]) -> dict[str, Any]:
    """Every node of a JSON tree under its dotted path: ``p`` maps to the node and ``p.k`` to its children."""
    if prefix:
        out[prefix] = value
    if isinstance(value, dict):
        for k, v in value.items():
            flatten(f"{prefix}.{k}" if prefix else str(k), v, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            flatten(f"{prefix}.{i}" if prefix else str(i), v, out)
    return out


def _keywords(args: dict[str, Any], allowed: tuple[str, ...], name: str) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    kw = snake_args({k: v for k, v in args.items() if k != "miller"})
    if kw.pop("keep_molecules", False):
        raise ValueError(f"{name}: keep_molecules is not implemented")
    return kw


@op("terminations")
def terminations_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    kw = _keywords(args, TERMINATION_ARGS, "terminations")
    d = build.surface_analysis(inp.structure, args.get("miller"), **kw).to_dict()
    out = flatten("", d, {})
    m = d["layersPerPeriod"]
    terms, layers, cuts = d["terminations"], d["layers"], d["cuts"]
    p0 = cuts[terms[0]["cut"]]["layer"]
    out.update({
        "terminationCount": len(terms),
        "labels": [t["label"] for t in terms],
        "brokenBonds": [t["brokenBonds"] for t in terms],
        "polar": [t["polar"] for t in terms],
        "stack": [layers[(p0 - j) % m]["composition"] for j in range(m)],
        "gapsBelow": [layers[(p0 - j - 1) % m]["gapAbove"] for j in range(m)],
        "topIndices": [sorted((p0 - cuts[c]["layer"]) % m for c in t["cuts"]) for t in terms],
    })
    return out


def min_distance(s: Any) -> float:
    """The shortest distance between two atoms of the periodic structure (images along the periodic axes only)."""
    pos = np.asarray(s.positions, dtype=float)
    cell = np.asarray(s.cell, dtype=float)
    best = math.inf
    ranges = [range(-2, 3) if p else range(0, 1) for p in s.pbc]
    for i in ranges[0]:
        for j in ranges[1]:
            for k in ranges[2]:
                shift = i * cell[0] + j * cell[1] + k * cell[2]
                for a in range(len(pos)):
                    d = pos + shift - pos[a]
                    r = np.sqrt((d * d).sum(axis=1))
                    if (i, j, k) == (0, 0, 0):
                        r[a] = math.inf
                    best = min(best, float(r.min()))
    return best


def slab_result(s: Any) -> dict[str, Any]:
    """What the slab ops return for a structure (README, "surface, setVacuum, flipSlab, standardizeSlab")."""
    z = np.asarray(s.positions, dtype=float)[:, 2]
    rec = s.info.get("surface")
    out: dict[str, Any] = {"structure": s, "zRange": [float(z.min()), float(z.max())],
                           "volume": abs(float(np.linalg.det(np.asarray(s.cell, dtype=float)))),
                           "minDistance": min_distance(s)}
    flatten("surface", rec, out)
    return out


@op("surface")
def surface_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    kw = _keywords(args, SURFACE_ARGS, "surface")
    vacuum = kw.pop("vacuum", None)
    return slab_result(build.surface(inp.structure, args.get("miller"), vacuum=vacuum, **kw))
