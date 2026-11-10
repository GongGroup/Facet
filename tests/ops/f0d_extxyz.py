"""F0-D T5 (extended XYZ): ops of ``tests/data/surface/f0d/extxyz.json``.  The JS halves are in
``tests/js/ops/f0d_extxyz.mjs``.  The file also uses the F0-D ops ``read``, ``write`` and ``roundtrip``
(``tests/ops/f0d.py``).

- ``kvTokenize`` (``line``): the pairs of the comment line, ``[[key, raw], ...]`` (raw null for a word without ``=``),
  as ``value``.
- ``convertValue`` (``raw``: a string or null): the converted value as ``value``.
- ``formatInfoValue`` (``key``, ``value``): the text written for ``key=``, or null, as ``value``.
- ``extxyzColumns``: ``{"columns", "skipped"}`` of the input structure as ``value`` (``skipped`` as ``[key, reason]``).
- ``writeExtxyz`` (``constraints``, default ``"exact"``): the input written as extended XYZ (``text``) and read back
  (``structure``).
- ``extxyzFrames`` (``constraints``): one ``{"properties", "keys"}`` per frame of the extended XYZ text of the input,
  as ``value``: the ``Properties`` text and the keys of the comment line, in order.

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any, Sequence

from facet.io import parse_text
from facet.io.xyz import convert_value, extxyz_columns, format_info_value, kv_tokenize, write_extxyz

from ..cases import CaseInput, op


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


@op("kvTokenize")
def kv_tokenize_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "kvTokenize", ("line",), ("line",))
    return {"value": [[key, raw] for key, raw in kv_tokenize(args["line"])]}


@op("convertValue")
def convert_value_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "convertValue", ("raw",), ("raw",))
    return {"value": convert_value(args["raw"])}


@op("formatInfoValue")
def format_info_value_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "formatInfoValue", ("key", "value"), ("key", "value"))
    return {"value": format_info_value(args["key"], args["value"])}


@op("extxyzColumns")
def extxyz_columns_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "extxyzColumns", ())
    columns, skipped = extxyz_columns(inp.structure)
    return {"value": {"columns": columns, "skipped": [list(s) for s in skipped]}}


@op("writeExtxyz")
def write_extxyz_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "writeExtxyz", ("constraints",))
    text = write_extxyz(inp.structure, constraints=args.get("constraints", "exact"))
    return {"text": text, "structure": parse_text(text, "extxyz")}


def _headers(text: str) -> list[dict[str, Any]]:
    """``{"properties", "keys"}`` of each frame of an extended XYZ text written by the writer (no blank lines)."""
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines) and lines[i].strip():
        n = int(lines[i])
        pairs = kv_tokenize(lines[i + 1])
        out.append({"properties": next(raw for key, raw in pairs if key == "Properties"),
                    "keys": [key for key, _ in pairs]})
        i += 2 + n
    return out


@op("extxyzFrames")
def extxyz_frames_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "extxyzFrames", ("constraints",))
    return {"value": _headers(write_extxyz(inp.structure, constraints=args.get("constraints", "exact")))}
