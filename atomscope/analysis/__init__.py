"""Structure analysis: bonds/neighbours, coordination, RDF and summaries.

Example::

    from atomscope import build, analysis
    si = build.crystal("diamond", "Si")
    bonds = analysis.neighbors(si)            # [(i, j, d, (ox, oy, oz)), ...]
    cn = analysis.coordination_numbers(si)    # array([4, 4, ...])
    r, g = analysis.rdf(si.repeat(3, 3, 3), rmax=6.0, nbins=120)
    info = analysis.summary(si)
"""

from __future__ import annotations

from .geometry import angle_between, dihedral_from_vectors, distance_matrix, minimum_image_vectors
from .neighbors import NeighborList, coordination_numbers, neighbor_arrays, neighbors, rdf, summary

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
]
