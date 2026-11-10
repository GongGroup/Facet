"""F0-D T9 (geometry): the op of the shared cases in ``tests/data/geometry/mic.json``.

The JS half is in ``tests/js/ops/f0d_geometry.mjs``.  ``micVector`` calls ``mic_vector`` (``micVector``) on its literal
``args``, as the API takes them (the cases have no input structure): ``cell``, ``pbc`` (default all true) and ``axes``
(default all), and either ``v``, one vector (results ``vector`` and ``image``), or ``vectors``, a list of vectors
(results ``vectors`` and ``images``).  Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

from typing import Any

from facet.analysis.geometry import mic_vector

from ..cases import CaseInput, op

_ARGS = ("axes", "cell", "pbc", "v", "vectors")


@op("micVector")
def mic_vector_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in _ARGS)
    if unknown:
        raise ValueError(f"micVector: unknown args {', '.join(unknown)}")
    if ("v" in args) == ("vectors" in args):
        raise ValueError("micVector: give exactly one of v or vectors")
    cell, pbc, axes = args.get("cell"), args.get("pbc", [True, True, True]), args.get("axes")
    if "v" in args:
        w, img = mic_vector(args["v"], cell, pbc, axes=axes)
        return {"vector": w.tolist(), "image": list(img)}
    found = [mic_vector(v, cell, pbc, axes=axes) for v in args["vectors"]]
    return {"vectors": [w.tolist() for w, _ in found], "images": [list(img) for _, img in found]}
