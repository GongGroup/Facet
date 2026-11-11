"""Structure builders: crystals, supercells, clusters and molecules.

    from facet import build
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

# --- surface-modeling M1 ---
# --- end M1 ---

# --- surface-modeling M2 ---
from .surface import (
    SurfaceAnalysis,
    center_slab,
    estimate_oxidation_states,
    fix_layers,
    flip_slab,
    free_atoms,
    oriented_cell,
    parse_surface_supercell,
    set_vacuum,
    slab_extent,
    slab_layers,
    surface,
    surface_analysis,
    surface_mesh_label,
    terminations,
)
# --- end M2 ---

# --- surface-modeling M5-T1 ---
# --- end M5-T1 ---

# --- surface-modeling M5-T5 ---
# --- end M5-T5 ---

# --- surface-modeling M5-T6 ---
# --- end M5-T6 ---

# --- surface-modeling M5-T7 ---
# --- end M5-T7 ---

# --- surface-modeling M6 ---
# --- end M6 ---

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
    # --- surface-modeling M1 ---
    # --- end M1 ---

    # --- surface-modeling M2 ---
    "SurfaceAnalysis",
    "surface",
    "surface_analysis",
    "terminations",
    "oriented_cell",
    "set_vacuum",
    "center_slab",
    "flip_slab",
    "slab_extent",
    "slab_layers",
    "fix_layers",
    "free_atoms",
    "parse_surface_supercell",
    "surface_mesh_label",
    "estimate_oxidation_states",
    # --- end M2 ---

    # --- surface-modeling M5-T1 ---
    # --- end M5-T1 ---

    # --- surface-modeling M5-T5 ---
    # --- end M5-T5 ---

    # --- surface-modeling M5-T6 ---
    # --- end M5-T6 ---

    # --- surface-modeling M5-T7 ---
    # --- end M5-T7 ---

    # --- surface-modeling M6 ---
    # --- end M6 ---
]
