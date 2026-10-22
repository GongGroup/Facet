"""Structure builders: crystals, supercells, clusters and molecules.

    from crystallume import build
    cu = build.crystal("fcc", "Cu", a=3.61)
    cu333 = build.supercell(cu, 3, 3, 3)
    au55 = build.cluster("icosahedron", "Au", 3)
    caffeine = build.molecule("caffeine")

``PROTOTYPES``, ``CLUSTERS`` and ``MOLECULES`` hold UI metadata.
"""

from __future__ import annotations

from .cluster import CLUSTERS, c60_positions, cluster, nearest_neighbor_distance
from .crystal import PROTOTYPES, crystal, reference_lattice_constant, supercell
from .molecules import MOLECULES, molecule, molecule_names

__all__ = [
    "PROTOTYPES",
    "CLUSTERS",
    "MOLECULES",
    "crystal",
    "supercell",
    "cluster",
    "molecule",
    "molecule_names",
    "reference_lattice_constant",
    "nearest_neighbor_distance",
    "c60_positions",
]
