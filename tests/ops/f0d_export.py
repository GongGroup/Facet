"""F0-D export check: ops of the shared cases ``tests/data/surface/f0d/export.json``.

They test ``crystallume/io/capabilities.py``, :func:`crystallume.io.export_report` and
``crystallume/analysis/contacts.py``; the JS halves, for ``web/js/io/capabilities.js``, ``exportReport`` in
``web/js/io/index.js`` and ``web/js/core/contacts.js``, are in ``tests/js/ops/f0d_export.mjs``:

- ``writerCapabilities``: no input; ``value`` = ``{"table", "keys", "optional", "overlapCheckMaxAtoms",
  "occupancyTolerance"}`` (the capability table of the built-in writers, the capability names in order, the ones a
  writer may leave out, and the two limits).
- ``validateCapabilities`` (``name``, ``caps``): ``value`` = the validated capabilities (or the error).
- ``exportReport`` (``format``, ``frame``, ``capabilities``): results ``warnings`` and ``notes`` of the input written
  as ``format``; with ``capabilities``, ``format`` (not registered yet) is registered for the case as a plugin's
  writer with those capabilities, and unregistered afterwards.
- ``closeContacts`` (``cutoff``, ``pbc``, ``limit``): ``value`` = the pairs ``[i, j, d]`` of the input.

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any, Sequence

from crystallume.analysis.contacts import close_contacts
from crystallume.io import export_report, register_writer, unregister_writer, writers
from crystallume.io.capabilities import (
    CAPABILITY_VALUES,
    OCCUPANCY_TOLERANCE,
    OPTIONAL_CAPABILITIES,
    OVERLAP_CHECK_MAX_ATOMS,
    WRITER_CAPABILITIES,
    validate_capabilities,
)

from ..cases import CaseInput, op


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


@op("writerCapabilities")
def writer_capabilities_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The capability table of the built-in writers and the limits of the export check."""
    _args(args, "writerCapabilities", ())
    return {"value": {"table": {k: dict(v) for k, v in WRITER_CAPABILITIES.items()}, "keys": list(CAPABILITY_VALUES),
                      "optional": list(OPTIONAL_CAPABILITIES), "overlapCheckMaxAtoms": OVERLAP_CHECK_MAX_ATOMS,
                      "occupancyTolerance": OCCUPANCY_TOLERANCE}}


@op("validateCapabilities")
def validate_capabilities_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``validate_capabilities(name, caps)``."""
    _args(args, "validateCapabilities", ("name", "caps"), ("name", "caps"))
    return {"value": validate_capabilities(args["name"], args["caps"])}


@op("exportReport")
def export_report_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``export_report(structure, format, frame=frame)``: results ``warnings`` and ``notes`` (with ``capabilities``:
    of a writer registered for the case as ``format``)."""
    _args(args, "exportReport", ("format", "frame", "capabilities"), ("format",))
    fmt = args["format"]
    if "capabilities" not in args:
        report = export_report(inp.structure, fmt, frame=args.get("frame"))
        return {"warnings": report["warnings"], "notes": report["notes"]}
    if fmt in {w.name for w in writers()}:
        raise ValueError(f"exportReport: format {fmt} is registered already")
    register_writer(fmt, lambda s: "", capabilities=args["capabilities"], source="case")
    try:
        report = export_report(inp.structure, fmt, frame=args.get("frame"))
    finally:
        unregister_writer(fmt)
    return {"warnings": report["warnings"], "notes": report["notes"]}


@op("closeContacts")
def close_contacts_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """``close_contacts(structure, cutoff, pbc=pbc, limit=limit)`` as ``[[i, j, d], ...]``."""
    _args(args, "closeContacts", ("cutoff", "pbc", "limit"))
    pairs = close_contacts(inp.structure, args.get("cutoff"), pbc=args.get("pbc"), limit=args.get("limit"))
    return {"value": [list(p) for p in pairs]}
