"""Structure analysis: bonds/neighbours, coordination, RDF, summaries and vacuum gaps.

Example::

    from crystallume import build, analysis
    si = build.crystal("diamond", "Si")
    bonds = analysis.neighbors(si)            # [(i, j, d, (ox, oy, oz)), ...]
    cn = analysis.coordination_numbers(si)    # array([4, 4, ...])
    r, g = analysis.rdf(si.repeat(3, 3, 3), rmax=6.0, nbins=120)
    info = analysis.summary(si)
    gap = analysis.find_vacuum_gap(si)        # None: a bulk crystal has no vacuum gap (see analysis.vacuum)
"""

from __future__ import annotations

from .contacts import close_contacts
from .geometry import angle_between, dihedral_from_vectors, distance_matrix, minimum_image_vectors
from .neighbors import NeighborList, coordination_numbers, neighbor_arrays, neighbors, rdf, summary
from .vacuum import (
    axis_gaps,
    contiguous_shifts,
    display_cuts,
    find_surface_gap,
    find_vacuum_gap,
    find_vacuum_gaps,
    gap_cut,
    make_contiguous,
    require_gap,
    surface_normal,
    unwrap_along_gap,
    vacuum_axis,
    vacuum_gap_hint,
)

__all__ = [
    "NeighborList",
    "neighbor_arrays",
    "neighbors",
    "coordination_numbers",
    "rdf",
    "summary",
    "angle_between",
    "dihedral_from_vectors",
    "distance_matrix",
    "minimum_image_vectors",
    "axis_gaps",
    "find_vacuum_gaps",
    "find_vacuum_gap",
    "gap_cut",
    "display_cuts",
    "unwrap_along_gap",
    "surface_normal",
    "find_surface_gap",
    "require_gap",
    "vacuum_axis",
    "vacuum_gap_hint",
    "contiguous_shifts",
    "make_contiguous",
    "close_contacts",
]
