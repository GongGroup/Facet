"""F0-A T8 (parameter schema): ops of the shared cases in ``tests/data/surface/coerce.json``.

The JS halves are in ``tests/js/ops/f0a_params.mjs``.  Every op calls a function of ``facet.core.params`` on its
literal ``args`` (the cases have no input structure):

- ``parseIndices`` (``text``, ``fractions``) -> ``value``;
- ``coerceParam`` (``spec``, ``value``; a missing value is ``None``) -> ``value``;
- ``coerceText`` (``spec`` of a ``vector``, ``miller`` or ``imatrix`` parameter, ``text``) -> ``value``: here
  ``coerce_param(spec, parse_cli_value(spec, text))``, the command line's path; the JS side reads the text the way
  the input controls do (``parseIndices``, unreadable text left to ``coerceParam``), so the case checks that both
  paths give the same values and messages;
- ``validateParams`` (``schema``, ``values``, ``strict``, ``title``) -> ``values``, ``errors``, ``warnings``;
- ``defaultParams`` (``schema``) -> ``value``.

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any, Sequence

from facet.core import params

from ..cases import CaseInput, op


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


@op("parseIndices")
def parse_indices_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "parseIndices", ("text", "fractions"), ("text",))
    return {"value": params.parse_indices(args["text"], fractions=args.get("fractions", False))}


@op("coerceParam")
def coerce_param_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "coerceParam", ("spec", "value"), ("spec",))
    return {"value": params.coerce_param(args["spec"], args.get("value"))}


@op("coerceText")
def coerce_text_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "coerceText", ("spec", "text"), ("spec", "text"))
    spec = args["spec"]
    if spec.get("type") not in ("vector", "miller", "imatrix"):
        raise ValueError("coerceText: the spec must be a vector, miller or imatrix parameter")
    return {"value": params.coerce_param(spec, params.parse_cli_value(spec, args["text"]))}


@op("validateParams")
def validate_params_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "validateParams", ("schema", "values", "strict", "title"), ("schema",))
    values, errors, warnings = params.validate_params(args["schema"], args.get("values"), strict=args.get("strict", False),
                                                      title=args.get("title"))
    return {"values": values, "errors": errors, "warnings": warnings}


@op("defaultParams")
def default_params_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    _args(args, "defaultParams", ("schema",), ("schema",))
    return {"value": params.default_params(args["schema"])}
