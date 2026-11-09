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

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any, Sequence

from crystallume import Structure, build
from crystallume.build.crystal import PROTOTYPES
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
