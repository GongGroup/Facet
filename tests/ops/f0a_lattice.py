"""F0-A T7a (lattice directions): ops of the shared cases in ``tests/data/surface/directions.json``.

The JS halves are in ``tests/js/ops/f0a_lattice.mjs``.  Every op calls functions of ``facet.core.lattice`` on
its literal ``args`` (the cases have no input structure) and returns the result as ``value``, with the JS key names
(``to_conventional`` -> ``toConventional``) and arrays as lists:

- ``reciprocalCell`` (``cell``), ``centeredCellHint`` (``cell``), ``isHexagonalCell`` (``cell``, ``lengthTol``,
  ``angleTol``);
- ``millerNormal`` (``cell`` and one of ``hkl`` or ``hkil``: four indices go through ``hkil_to_hkl`` first) and
  ``latticeDirection`` (``cell`` and one of ``uvw`` or ``uvtw``, through ``uvtw_to_uvw``);
- ``hklToHkil`` (``hkl``), ``hkilToHkl`` (``hkil``), ``uvwToUvtw`` (``uvw``, ``integer``), ``uvtwToUvw`` (``uvtw``).

``primitiveMiller`` (``cell``, ``hkl``) is a row of the table in F0-A §3.14.4 for a primitive cell: ``normal``
(``miller_normal``), ``spacing`` (``1 / |hkl @ reciprocal_cell(cell)|``, Å), ``kind`` and ``conventional`` (from
``centered_cell_hint``: the conventional indices ``Q @ hkl`` reduced to the smallest whole numbers; both null without a
hint) and ``angle``, the angle in degrees between the plane and the plane with the same indices in the conventional
cell ``Q @ cell`` (``atan2(|n1 x n2|, |n1 . n2|)``, well conditioned at 0° and 90°; null without a hint).

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

import math
import re
from typing import Any, Sequence

import numpy as np

from facet.core import lattice

from ..cases import CaseInput, op


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


def _one_of(args: dict[str, Any], name: str, keys: Sequence[str]) -> str:
    given = [k for k in keys if k in args]
    if len(given) != 1:
        raise ValueError(f"{name}: give exactly one of {' or '.join(keys)}")
    return given[0]


def _camel(x: Any) -> Any:
    """A result with the JS key names and arrays (numpy included) and tuples as lists."""
    if isinstance(x, dict):
        return {re.sub(r"_([a-z])", lambda m: m.group(1).upper(), k): _camel(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_camel(v) for v in x]
    if isinstance(x, (np.ndarray, np.generic)):
        return _camel(x.tolist())
    return x


@op("reciprocalCell")
def reciprocal_cell_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "reciprocalCell", ("cell",), ("cell",))
    return {"value": _camel(lattice.reciprocal_cell(args["cell"]))}


@op("millerNormal")
def miller_normal_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``miller_normal(cell, hkl)``; with ``hkil``, ``miller_normal(cell, hkil_to_hkl(hkil))``."""
    name = "millerNormal"
    _args(args, name, ("cell", "hkl", "hkil"), ("cell",))
    key = _one_of(args, name, ("hkl", "hkil"))
    hkl = args["hkl"] if key == "hkl" else lattice.hkil_to_hkl(args["hkil"])
    return {"value": _camel(lattice.miller_normal(args["cell"], hkl))}


@op("latticeDirection")
def lattice_direction_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``lattice_direction(cell, uvw)``; with ``uvtw``, ``lattice_direction(cell, uvtw_to_uvw(uvtw))``."""
    name = "latticeDirection"
    _args(args, name, ("cell", "uvw", "uvtw"), ("cell",))
    key = _one_of(args, name, ("uvw", "uvtw"))
    uvw = args["uvw"] if key == "uvw" else lattice.uvtw_to_uvw(args["uvtw"])
    return {"value": _camel(lattice.lattice_direction(args["cell"], uvw))}


@op("isHexagonalCell")
def is_hexagonal_cell_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "isHexagonalCell", ("cell", "lengthTol", "angleTol"), ("cell",))
    kw = {snake: args[camel] for camel, snake in (("lengthTol", "length_tol"), ("angleTol", "angle_tol")) if camel in args}
    return {"value": _camel(lattice.is_hexagonal_cell(args["cell"], **kw))}


@op("hklToHkil")
def hkl_to_hkil_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "hklToHkil", ("hkl",), ("hkl",))
    return {"value": _camel(lattice.hkl_to_hkil(args["hkl"]))}


@op("hkilToHkl")
def hkil_to_hkl_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "hkilToHkl", ("hkil",), ("hkil",))
    return {"value": _camel(lattice.hkil_to_hkl(args["hkil"]))}


@op("uvwToUvtw")
def uvw_to_uvtw_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "uvwToUvtw", ("uvw", "integer"), ("uvw",))
    return {"value": _camel(lattice.uvw_to_uvtw(args["uvw"], integer=args.get("integer", False)))}


@op("uvtwToUvw")
def uvtw_to_uvw_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "uvtwToUvw", ("uvtw",), ("uvtw",))
    return {"value": _camel(lattice.uvtw_to_uvw(args["uvtw"]))}


@op("centeredCellHint")
def centered_cell_hint_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "centeredCellHint", ("cell",), ("cell",))
    return {"value": _camel(lattice.centered_cell_hint(args["cell"]))}


def _cross(u: Sequence[float], v: Sequence[float]) -> list[float]:
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]


def _length(v: Sequence[float]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


@op("primitiveMiller")
def primitive_miller_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """A row of the table in F0-A §3.14.4 (see the module docstring)."""
    _args(args, "primitiveMiller", ("cell", "hkl"), ("cell", "hkl"))
    cell, hkl = args["cell"], args["hkl"]
    normal = lattice.miller_normal(cell, hkl).tolist()
    g = np.asarray(hkl, dtype=float) @ lattice.reciprocal_cell(cell)
    out: dict[str, Any] = {"normal": normal, "spacing": 1.0 / _length(g.tolist()),
                           "kind": None, "conventional": None, "angle": None}
    hint = lattice.centered_cell_hint(cell)
    if hint is not None:
        q = hint["to_conventional"]
        qh = [q[i][0] * hkl[0] + q[i][1] * hkl[1] + q[i][2] * hkl[2] for i in range(3)]
        div = math.gcd(math.gcd(abs(qh[0]), abs(qh[1])), abs(qh[2]))
        conventional_cell = [[q[i][0] * cell[0][x] + q[i][1] * cell[1][x] + q[i][2] * cell[2][x] for x in range(3)]
                             for i in range(3)]
        same = lattice.miller_normal(conventional_cell, hkl).tolist()
        dot = normal[0] * same[0] + normal[1] * same[1] + normal[2] * same[2]
        out.update(kind=hint["kind"], conventional=[x // div for x in qh],
                   angle=math.atan2(_length(_cross(normal, same)), abs(dot)) * 180.0 / math.pi)
    return out
