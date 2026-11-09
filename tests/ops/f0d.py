"""F0-D (data and file I/O): ops and recipes of the shared cases.  The JS halves are in ``tests/js/ops/f0d.mjs``.

Ops (``args`` in brackets):

- ``load``: the input as a structure, unchanged: a ``structure`` or ``recipe`` input, or a ``text``/``file`` input read
  with the format detected from the file name or the content.
- ``read`` (``format``, optional): a ``text`` or ``file`` input read with that format.
- ``write`` (``format``): the input structure written in that format; result ``text``.
- ``roundtrip`` (``format``): the input structure written and read back in that format; results ``structure`` and
  ``text``.

Recipe ``crystal`` (``prototype``, ``elements``, ``a``, ``c``, ``u``, ``repeat``): a bulk crystal from the builders
(``build.crystal`` / ``buildCrystal``), optionally repeated.  Every lattice parameter of the prototype (``a``; ``c`` and
``u`` where the prototype has them) must be given, because the default tables of the two builders differ until
F0-D T10; so do the atom orders of ``fluorite`` and ``mos2``, and ``hbn`` exists only in JS.

Vacuum gaps (``crystallume.analysis.vacuum`` / ``web/js/core/vacuum.js``; results with the JS key names, arrays as lists):

- ``axisGaps`` (``axis``, ``frame``, ``exclude``), ``findVacuumGaps`` (``frame``, ``periodicOnly``), ``findVacuumGap``
  (``axis``, ``minWidth``, ``frame``, ``periodicOnly``), ``gapCut`` (``axis``, ``frame``, ``hint``, ``exclude``),
  ``displayCuts`` (``frame``), ``surfaceNormal`` (``frame``, ``requireGap``, ``exclude``), ``findSurfaceGap``,
  ``requireGap``, ``vacuumAxis``, ``vacuumGapHint`` (``frame``, ``exclude``), ``contiguousShifts`` (``axis``, ``cut``,
  ``frame``): the function's return value as ``value``.
- ``makeContiguous`` (``axis``, ``cut``, ``frame``): the number of atoms moved as ``value`` and the edited ``structure``.
- ``unwrapAlongGap`` (``frac``, ``cut``) and ``wrapFractional`` (``frac``, ``pbc``, ``eps``): pure functions, no input.
- ``unwrapAtoms`` (``axis``, ``cut`` = ``"display"`` | ``"surface"`` | a window start | null): the stored fractional
  coordinates of the input along ``axis``, unwrapped with that cut.
- ``vacuumReport`` (``frame``, ``exclude``): ``gaps`` and ``allGaps`` (``findVacuumGaps``, periodic axes only / all),
  ``gap`` and ``widest`` (``findVacuumGap`` with the default threshold / ``minWidth: 0``), ``cuts`` (``gapCut`` of each
  axis, hint on ``info.surface.axis``), ``displayCuts``, ``normal``, ``surfaceGap``, ``vacuumAxis``, ``hint``
  (``vacuumGapHint``) and ``shifts`` (``contiguousShifts`` along the vacuum axis, or null).

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

import re
from typing import Any, Sequence

import numpy as np

from crystallume import Structure, build
from crystallume.analysis import vacuum
from crystallume.build.crystal import PROTOTYPES
from crystallume.core.lattice import wrap_fractional
from crystallume.io import parse_text, to_text

from ..cases import CaseInput, op, recipe


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


def _whole(n: Any) -> bool:
    """An integer, or a float with an integer value (JSON ``2.0``; JS cannot tell the two apart)."""
    return (isinstance(n, int) and not isinstance(n, bool)) or (isinstance(n, float) and n.is_integer())


@op("load")
def load_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input as a structure, unchanged."""
    _args(args, "load", ())
    return {"structure": inp.structure}


@op("read")
def read_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """Read a text or file input with ``args.format`` (detected from the file name or content when omitted)."""
    _args(args, "read", ("format",))
    if inp.kind not in ("text", "file"):
        raise ValueError("read: needs a text or file input")
    return {"structure": parse_text(inp.text, format=args.get("format"), filename=inp.filename)}


@op("write")
def write_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input structure written in ``args.format``."""
    _args(args, "write", ("format",), ("format",))
    return {"text": to_text(inp.structure, args["format"])}


@op("roundtrip")
def roundtrip_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input structure written in ``args.format`` and read back with the same format."""
    _args(args, "roundtrip", ("format",), ("format",))
    text = to_text(inp.structure, args["format"])
    return {"structure": parse_text(text, format=args["format"]), "text": text}


@recipe("crystal")
def crystal_recipe(args: dict[str, Any]) -> Structure:
    """A bulk crystal with every lattice parameter given explicitly, optionally repeated (``repeat: [nx, ny, nz]``)."""
    name = "recipe crystal"
    _args(args, name, ("prototype", "elements", "a", "c", "u", "repeat"), ("prototype", "elements", "a"))
    proto = args["prototype"]
    meta = PROTOTYPES.get(proto) if isinstance(proto, str) else None
    if meta is None:
        raise ValueError(f"{name}: unknown prototype {proto}")
    for k in (["c"] if meta["hasC"] else []) + (["u"] if "u" in meta["params"] else []):
        if k not in args:
            raise ValueError(f"{name}: give {k} for {proto} (the default tables of the two languages differ)")
    elements = args["elements"]
    if not isinstance(elements, list) or not elements or not all(isinstance(e, str) for e in elements):
        raise ValueError(f"{name}: elements must be a list of element symbols")
    rep = args.get("repeat", [1, 1, 1])
    if not isinstance(rep, list) or len(rep) != 3 or not all(_whole(n) and n >= 1 for n in rep):
        raise ValueError(f"{name}: repeat must be three positive integers")
    kw = {k: args[k] for k in ("c", "u") if k in args}
    if "repeat" in args:
        kw["repeat"] = [int(n) for n in rep]
    return build.crystal(proto, list(elements), a=args["a"], **kw)


# ------------------------------------------------------------------------------- vacuum gaps (F0-D T7)
def _camel(x: Any) -> Any:
    """A vacuum result with the JS key names (``vacuum_axes`` -> ``vacuumAxes``) and arrays as lists."""
    if isinstance(x, dict):
        return {re.sub(r"_([a-z])", lambda m: m.group(1).upper(), k): _camel(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_camel(v) for v in x]
    if isinstance(x, np.ndarray):
        return _camel(x.tolist())
    if isinstance(x, np.generic):
        return x.item()
    return x


def _kw(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    """The checked *args* as Python keywords (camelCase -> snake_case)."""
    _args(args, name, allowed, required)
    return {re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), k): v for k, v in args.items()}


def _vacuum_op(name: str, fn: Any, allowed: Sequence[str], required: Sequence[str] = ()) -> None:
    @op(name)
    def run(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
        kw = _kw(args, name, allowed, required)
        if "axis" in required:
            return {"value": _camel(fn(inp.structure, kw.pop("axis"), **kw))}
        return {"value": _camel(fn(inp.structure, **kw))}


_vacuum_op("axisGaps", vacuum.axis_gaps, ("axis", "frame", "exclude"), ("axis",))
_vacuum_op("findVacuumGaps", vacuum.find_vacuum_gaps, ("frame", "periodicOnly"))
_vacuum_op("findVacuumGap", vacuum.find_vacuum_gap, ("axis", "minWidth", "frame", "periodicOnly"))
_vacuum_op("gapCut", vacuum.gap_cut, ("axis", "frame", "hint", "exclude"), ("axis",))
_vacuum_op("displayCuts", vacuum.display_cuts, ("frame",))
_vacuum_op("surfaceNormal", vacuum.surface_normal, ("frame", "requireGap", "exclude"))
_vacuum_op("findSurfaceGap", vacuum.find_surface_gap, ("frame", "exclude"))
_vacuum_op("requireGap", vacuum.require_gap, ("frame", "exclude"))
_vacuum_op("vacuumAxis", vacuum.vacuum_axis, ("frame", "exclude"))
_vacuum_op("vacuumGapHint", vacuum.vacuum_gap_hint, ("frame", "exclude"))
_vacuum_op("contiguousShifts", vacuum.contiguous_shifts, ("axis", "cut", "frame"), ("axis",))


@op("makeContiguous")
def make_contiguous_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """Move the input's atoms into one piece; the number moved as ``value`` and the edited structure."""
    kw = _kw(args, "makeContiguous", ("axis", "cut", "frame"), ("axis",))
    s = inp.structure.copy()
    return {"value": vacuum.make_contiguous(s, kw.pop("axis"), **kw), "structure": s}


@op("unwrapAlongGap")
def unwrap_along_gap_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``unwrap_along_gap(frac, cut)`` on the literal arguments."""
    _args(args, "unwrapAlongGap", ("frac", "cut"), ("frac", "cut"))
    return {"value": _camel(vacuum.unwrap_along_gap(args["frac"], args["cut"]))}


@op("unwrapAtoms")
def unwrap_atoms_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input's stored fractional coordinates along ``axis``, unwrapped with the display or surface cut."""
    _args(args, "unwrapAtoms", ("axis", "cut"), ("axis", "cut"))
    s, k, cut = inp.structure, args["axis"], args["cut"]
    if cut == "display":
        cut = vacuum.display_cuts(s)[k]
    elif cut == "surface":
        cut = vacuum.find_surface_gap(s)
    return {"value": _camel(vacuum.unwrap_along_gap(s.frac_positions[:, k], cut))}


@op("wrapFractional")
def wrap_fractional_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``wrap_fractional(frac, pbc, eps)`` on flat triples (the JS shape): the wrapped triples, flat."""
    kw = _kw(args, "wrapFractional", ("frac", "pbc", "eps"), ("frac",))
    frac = np.asarray(kw.pop("frac"), dtype=float).reshape(-1, 3)
    return {"value": _camel(wrap_fractional(frac, **kw).ravel())}


@op("vacuumReport")
def vacuum_report_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """Every vacuum-gap result of the input at once (see the module docstring)."""
    kw = _kw(args, "vacuumReport", ("frame", "exclude"))
    s, frame, exclude = inp.structure, kw.get("frame"), kw.get("exclude")
    hint = vacuum._hint_axis(s)
    axis = vacuum.vacuum_axis(s, frame=frame, exclude=exclude)
    return _camel({
        "gaps": vacuum.find_vacuum_gaps(s, frame=frame),
        "allGaps": vacuum.find_vacuum_gaps(s, frame=frame, periodic_only=False),
        "gap": vacuum.find_vacuum_gap(s, frame=frame),
        "widest": vacuum.find_vacuum_gap(s, min_width=0, frame=frame),
        "cuts": [vacuum.gap_cut(s, k, frame=frame, hint=(k == hint), exclude=exclude) for k in range(3)],
        "displayCuts": vacuum.display_cuts(s, frame=frame),
        "normal": vacuum.surface_normal(s, frame=frame, exclude=exclude),
        "surfaceGap": vacuum.find_surface_gap(s, frame=frame, exclude=exclude),
        "vacuumAxis": axis,
        "hint": vacuum.vacuum_gap_hint(s, frame=frame, exclude=exclude),
        "shifts": None if axis is None or not s.pbc[axis] else vacuum.contiguous_shifts(s, axis, frame=frame),
    })
