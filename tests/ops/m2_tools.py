"""M2 (cleave and slab): the op ``flipSlab`` of the shared cases ``tests/data/surface/cleave/tools/flip.json``.
The JS half is ``tests/js/ops/m2_tools.mjs``.

``flipSlab`` runs ``facet.build.flip_slab`` on a copy of the input and returns what the slab ops return
(``tests/ops/m2_analysis.py`` ``slab_result``): the structure, ``info.surface`` flattened under ``surface``, ``zRange``,
``volume`` and ``minDistance``.  The ops ``setVacuum`` and ``standardizeSlab`` of the same directory are not registered:
``set_vacuum`` here keeps the cell's axes and orientation (the cases expect the relabelling and re-orientation of the
full design), and ``standardize_slab`` does not exist yet, so their cases keep their skips.
"""

from __future__ import annotations

from typing import Any

from facet import build

from ..cases import CaseInput, op
from .m2_analysis import slab_result


@op("flipSlab")
def flip_slab_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    if args:
        raise ValueError(f"flipSlab: unknown args {', '.join(sorted(args))}")
    return slab_result(build.flip_slab(inp.structure.copy()))
