"""F0-D data core: ops of the shared cases ``tests/data/surface/f0d/props.json``, ``sourcemap.json`` and ``edits.json``.

They test ``facet/core/structure.py`` and ``core/naming.py`` (the JS halves, for ``web/js/core/structure.js``
and ``core/naming.js``, are in ``tests/js/ops/f0d_structure.mjs``).  Structure documents in ``args`` (``other``,
``parts``, a ``new`` step's ``structure``) are ``facet.structure/1`` objects read with
``Structure.from_dict`` / ``Structure.fromJSON``.  Every op that edits works on a copy of the input and returns it as
``structure``, together with:

- ``frames``: the extra frames of the result, ``[{"positions": [[x, y, z], ...], "cell": 3x3 | null}]`` (frame 1
  first; ``cell`` null when the frame uses the structure's cell);
- ``sourceMap``: the result's ``source_map`` / ``sourceMap`` as a list (``null`` for none); relative to the input.

Pure functions (no input; the result as ``value``):

- ``constants`` (``name``): a constant table as JSON: ``PROP_DEFAULTS``, ``PROP_SYMBOL_DEFAULT``,
  ``PROP_SHAPED_ZERO``, ``RESULT_PROPS``, ``RESULT_INFO``, ``SYMMETRY_INFO_KEYS``, ``BUILD_INFO_KEYS``,
  ``CARTESIAN_VECTOR_PROPS``, ``EDIT_KINDS`` (``core/structure``) or ``TIMES`` (``core/naming``).
- ``defaultFor`` (``key``, ``symbol``, ``column``).
- ``poscarOrder`` (``symbols``, ``order``, ``blocks``), ``canonicalOrder`` (``symbols``, ``layers``, ``blocks``).
- ``invertSourceMap`` (``src``, ``nOld``), ``composeSourceMaps`` (``first``, ``second``).
- ``addWarning`` (``info``, ``msg``), ``normalizeWarnings`` (``info``): the changed info object;
  ``getWarnings`` (``info``), ``newWarnings`` (``before``, ``after``).
- ``formatRepeat`` (``reps``), ``addRepeatSuffix`` (``name``, ``reps``).
- ``concat`` (``parts``, ``cell``, ``pbc``, ``defaults``, ``renumberAdsorbates``): ``concat_structures`` /
  ``concatStructures`` of the documents ``parts``; results ``structure``, ``frames``, ``sourceMap``.

Edits of the input (results ``structure``, ``frames``, ``sourceMap``):

- ``fromJSON``: the input document read again with ``from_dict`` / ``fromJSON`` (its repairs and notes).
- ``setProp`` (``key``, ``values``), ``removeProp`` (``key``).
- ``remap`` (``src``, ``symbols``, ``newSymbols``, ``positions``, ``newPositions``, ``frames`` = ``"keep"`` or a list
  of ``{positions, cell}``, ``addedProps``, ``defaults``).
- ``append`` (``symbol``, ``position``, ``props``): Python ``append(symbol, position, **props)``, JS ``addAtom``.
- ``extend`` (``other``, ``renumberAdsorbates``); ``delete`` (``indices``): Python ``delete``, JS ``deleteAtoms``.
- ``select`` (``elements``, ``indices``, ``mask``); ``repeat`` (``reps`` = [nx, ny, nz]); ``sortBySpecies``
  (``order``).
- ``setSymbols`` (``indices``, ``symbol``), ``setPbc`` (``pbc``), ``wrap``.
- ``getFrame`` (``index``), ``keepFrame`` (``index``), ``setPositions`` (``positions``, ``indices``, ``frame``,
  ``mark``; ``frame`` 0 unless given), ``writeFrame`` (``frame``, ``positions``, ``cell``: missing = unchanged, null
  = none).
- ``markEdited`` (``kind``, ``rotation``).
- ``trackEdit`` (``steps``, ``result``): a change-tracking session.  ``work`` = a copy of the input;
  ``t = work.track_changes()``; each step ``{"do": ..., "on": name (default "work"), ...}`` runs on the structure
  of that name: in place ``delete`` (``indices``), ``append`` (``symbol``, ``position``), ``sortBySpecies``
  (``order``), ``remap`` (``src``, ``newSymbols``, ``newPositions``), ``extend`` (``other``: a name), ``keepFrame``
  (``index``), ``adopt`` (``from``: a name, ``src``; ``_adopt``), ``setSource`` (``parent``: a name, ``src``;
  ``_set_source`` / ``setSource``); derived, stored under ``as``: ``copy`` (JS ``clone``), ``repeat`` (``reps``),
  ``select`` (``elements``, ``indices``, ``mask``), ``getFrame`` (``index``), ``concat`` (``parts``: names), ``new``
  (``structure``: a document, unrelated to the session).  Results: ``sourceMap`` = ``t.stop(<result>)`` (``result``
  names the structure, default ``work``), ``maps`` = the ``source_map`` of every named structure, and the result's
  ``structure``.

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from facet.core import naming
from facet.core import structure as st
from facet.core.structure import Structure

from ..cases import CaseInput, op

_TABLES = ("PROP_DEFAULTS", "PROP_SYMBOL_DEFAULT", "PROP_SHAPED_ZERO", "RESULT_PROPS", "RESULT_INFO",
           "SYMMETRY_INFO_KEYS", "BUILD_INFO_KEYS", "CARTESIAN_VECTOR_PROPS", "EDIT_KINDS")


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


def _json(x: Any) -> Any:
    """Tuples and mapping proxies as lists and dicts (the JSON shape of the JS constants)."""
    if isinstance(x, (dict, type(st.PROP_DEFAULTS))):
        return {k: _json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json(v) for v in x]
    return x


def _map(m: Any) -> list[int] | None:
    return None if m is None else [int(v) for v in np.asarray(m).tolist()]


def _frames(s: Structure) -> list[dict[str, Any]]:
    return [{"positions": fr["positions"].tolist(), "cell": None if fr.get("cell") is None else fr["cell"].tolist()}
            for fr in s.frames]


def _result(s: Structure) -> dict[str, Any]:
    return {"structure": s, "frames": _frames(s), "sourceMap": _map(s.source_map)}


def _doc(value: Any, name: str) -> Structure:
    if not isinstance(value, dict):
        raise ValueError(f"{name}: expected a structure document")
    return Structure.from_dict(value)


# ------------------------------------------------------------------------------------------- pure functions
@op("constants")
def constants_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "constants", ("name",), ("name",))
    name = args["name"]
    if name == "TIMES":
        return {"value": naming.TIMES}
    if name not in _TABLES:
        raise ValueError(f"constants: unknown table {name}")
    return {"value": _json(getattr(st, name))}


@op("defaultFor")
def default_for_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "defaultFor", ("key", "symbol", "column"), ("key", "symbol"))
    return {"value": st.default_for(args["key"], args["symbol"], args.get("column"))}


@op("poscarOrder")
def poscar_order_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "poscarOrder", ("symbols", "order", "blocks"), ("symbols",))
    return {"value": st.poscar_order(args["symbols"], args.get("order"), args.get("blocks"))}


@op("canonicalOrder")
def canonical_order_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "canonicalOrder", ("symbols", "layers", "blocks"), ("symbols",))
    return {"value": st.canonical_order(args["symbols"], args.get("layers"), args.get("blocks"))}


@op("invertSourceMap")
def invert_source_map_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "invertSourceMap", ("src", "nOld"), ("src", "nOld"))
    return {"value": _map(st.invert_source_map(args["src"], args["nOld"]))}


@op("composeSourceMaps")
def compose_source_maps_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "composeSourceMaps", ("first", "second"), ("first", "second"))
    return {"value": _map(st.compose_source_maps(args["first"], args["second"]))}


@op("addWarning")
def add_warning_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "addWarning", ("info", "msg"), ("info", "msg"))
    return {"value": st.add_warning(args["info"], args["msg"])}


@op("getWarnings")
def get_warnings_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "getWarnings", ("info",), ("info",))
    return {"value": st.get_warnings(args["info"])}


@op("newWarnings")
def new_warnings_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "newWarnings", ("before", "after"), ("before", "after"))
    return {"value": st.new_warnings(args["before"], args["after"])}


@op("normalizeWarnings")
def normalize_warnings_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "normalizeWarnings", ("info",), ("info",))
    return {"value": st.normalize_warnings(args["info"])}


@op("formatRepeat")
def format_repeat_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "formatRepeat", ("reps",), ("reps",))
    return {"value": naming.format_repeat(args["reps"])}


@op("addRepeatSuffix")
def add_repeat_suffix_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "addRepeatSuffix", ("name", "reps"), ("name", "reps"))
    return {"value": naming.add_repeat_suffix(args["name"], args["reps"])}


@op("concat")
def concat_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "concat", ("parts", "cell", "pbc", "defaults", "renumberAdsorbates"), ("parts",))
    parts = [_doc(d, "concat") for d in args["parts"]]
    out = st.concat_structures(parts, cell=args.get("cell"), pbc=args.get("pbc"), defaults=args.get("defaults"),
                               renumber_adsorbates=args.get("renumberAdsorbates", True))
    return _result(out)


# ----------------------------------------------------------------------------------------- edits of the input
@op("fromJSON")
def from_json_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "fromJSON", ())
    if inp.kind != "structure":
        raise ValueError("fromJSON: needs a structure input")
    return _result(Structure.from_dict(inp.raw["structure"]))


@op("setProp")
def set_prop_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "setProp", ("key", "values"), ("key", "values"))
    return _result(inp.structure.copy().set_prop(args["key"], args["values"]))


@op("removeProp")
def remove_prop_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "removeProp", ("key",), ("key",))
    return _result(inp.structure.copy().remove_prop(args["key"]))


@op("remap")
def remap_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "remap", ("src", "symbols", "newSymbols", "positions", "newPositions", "frames", "addedProps",
                          "defaults"), ("src",))
    s = inp.structure.copy()
    s._remap(args["src"], symbols=args.get("symbols"), new_symbols=args.get("newSymbols"),
             positions=args.get("positions"), new_positions=args.get("newPositions"),
             frames=args.get("frames", "keep"), added_props=args.get("addedProps"), defaults=args.get("defaults"))
    return _result(s)


@op("append")
def append_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "append", ("symbol", "position", "props"), ("symbol", "position"))
    return _result(inp.structure.copy().append(args["symbol"], args["position"], **(args.get("props") or {})))


@op("extend")
def extend_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "extend", ("other", "renumberAdsorbates"), ("other",))
    s = inp.structure.copy()
    s.extend(_doc(args["other"], "extend"), renumber_adsorbates=args.get("renumberAdsorbates", True))
    return _result(s)


@op("delete")
def delete_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "delete", ("indices",), ("indices",))
    return _result(inp.structure.copy().delete(args["indices"]))


@op("select")
def select_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "select", ("elements", "indices", "mask"))
    return _result(inp.structure.select(elements=args.get("elements"), indices=args.get("indices"),
                                        mask=args.get("mask")))


@op("repeat")
def repeat_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "repeat", ("reps",), ("reps",))
    return _result(inp.structure.repeat(*args["reps"]))


@op("sortBySpecies")
def sort_by_species_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "sortBySpecies", ("order",))
    return _result(inp.structure.copy().sort_by_species(args.get("order")))


@op("setSymbols")
def set_symbols_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "setSymbols", ("indices", "symbol"), ("indices", "symbol"))
    return _result(inp.structure.copy().set_symbols(args["indices"], args["symbol"]))


@op("setPbc")
def set_pbc_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "setPbc", ("pbc",), ("pbc",))
    return _result(inp.structure.copy().set_pbc(args["pbc"]))


@op("wrap")
def wrap_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "wrap", ())
    return _result(inp.structure.copy().wrap())


@op("getFrame")
def get_frame_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "getFrame", ("index",), ("index",))
    return _result(inp.structure.get_frame(args["index"]))


@op("keepFrame")
def keep_frame_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "keepFrame", ("index",))
    return _result(inp.structure.copy().keep_frame(args.get("index", 0)))


@op("setPositions")
def set_positions_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "setPositions", ("positions", "indices", "frame", "mark"), ("positions",))
    s = inp.structure.copy()
    s.set_positions(args["positions"], indices=args.get("indices"), frame=args.get("frame", 0),
                    mark=args.get("mark", "positions"))
    return _result(s)


@op("writeFrame")
def write_frame_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "writeFrame", ("frame", "positions", "cell"), ("frame",))
    s = inp.structure.copy()
    kw: dict[str, Any] = {"positions": args.get("positions")}
    if "cell" in args:
        kw["cell"] = args["cell"]
    return _result(s.write_frame(args["frame"], **kw))


@op("markEdited")
def mark_edited_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "markEdited", ("kind", "rotation"), ("kind",))
    return _result(st.mark_edited(inp.structure.copy(), args["kind"], rotation=args.get("rotation")))


# ------------------------------------------------------------------------------------------ tracking sessions
_STEP_ARGS: dict[str, tuple[str, ...]] = {
    "delete": ("indices",), "append": ("symbol", "position"), "sortBySpecies": ("order",),
    "remap": ("src", "newSymbols", "newPositions"), "extend": ("other",), "keepFrame": ("index",),
    "adopt": ("from", "src"), "setSource": ("parent", "src"),
    "copy": (), "repeat": ("reps",), "select": ("elements", "indices", "mask"), "getFrame": ("index",),
    "concat": ("parts",), "new": ("structure",),
}
_DERIVED = ("copy", "repeat", "select", "getFrame", "concat", "new")


def _step(named: dict[str, Structure], step: dict[str, Any]) -> None:
    if not isinstance(step, dict) or step.get("do") not in _STEP_ARGS:
        raise ValueError(f"trackEdit: unknown step {step!r}")
    do = step["do"]
    allowed = ("do", "on", "as") + _STEP_ARGS[do]
    _args(step, f"trackEdit step {do}", allowed)
    if do in _DERIVED and "as" not in step:
        raise ValueError(f"trackEdit step {do}: give the result a name with as")

    def get(name: Any) -> Structure:
        if name not in named:
            raise ValueError(f"trackEdit: no structure named {name}")
        return named[name]

    s = get(step.get("on", "work")) if do != "new" else None
    if do == "delete":
        s.delete(step["indices"])
    elif do == "append":
        s.append(step["symbol"], step["position"])
    elif do == "sortBySpecies":
        s.sort_by_species(step.get("order"))
    elif do == "remap":
        s._remap(step["src"], new_symbols=step.get("newSymbols"), new_positions=step.get("newPositions"))
    elif do == "extend":
        s.extend(get(step["other"]))
    elif do == "keepFrame":
        s.keep_frame(step.get("index", 0))
    elif do == "adopt":
        s._adopt(get(step["from"]), src=step.get("src"))
    elif do == "setSource":
        s._set_source(get(step["parent"]), step["src"])
    elif do == "copy":
        named[step["as"]] = s.copy()
    elif do == "repeat":
        named[step["as"]] = s.repeat(*step["reps"])
    elif do == "select":
        named[step["as"]] = s.select(elements=step.get("elements"), indices=step.get("indices"),
                                     mask=step.get("mask"))
    elif do == "getFrame":
        named[step["as"]] = s.get_frame(step["index"])
    elif do == "concat":
        named[step["as"]] = st.concat_structures([get(n) for n in step["parts"]])
    else:  # new
        named[step["as"]] = _doc(step["structure"], "trackEdit step new")


@op("trackEdit")
def track_edit_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "trackEdit", ("steps", "result"), ("steps",))
    work = inp.structure.copy()
    named: dict[str, Structure] = {"work": work}
    t = work.track_changes()
    for step in args["steps"]:
        _step(named, step)
    name = args.get("result", "work")
    if name not in named:
        raise ValueError(f"trackEdit: no structure named {name}")
    result = named[name]
    src = t.stop(result)
    return {"sourceMap": _map(src), "maps": {k: _map(v.source_map) for k, v in named.items()},
            "structure": result}
