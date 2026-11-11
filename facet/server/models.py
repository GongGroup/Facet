"""Pydantic request/response models (they drive the OpenAPI docs at ``/docs``)."""

from __future__ import annotations

from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from ..core.structure import Structure

__all__ = [
    "StructureModel",
    "StructureEnvelope",
    "ProjectIn",
    "ParseTextRequest",
    "ParseResponse",
    "ExportRequest",
    "ExportResponse",
    "CrystalRequest",
    "ClusterRequest",
    "SupercellRequest",
    "BondsRequest",
    "BondsResponse",
    "StructureRequest",
    "CoordinationRequest",
    "RdfRequest",
    "CustomAnalysisRequest",
    "Credentials",
    "UserOut",
    "AuthResponse",
    "MeResponse",
    "HealthResponse",
    "OkResponse",
]

_NACL_EXAMPLE = {
    "schema": "facet.structure/1",
    "name": "NaCl",
    "symbols": ["Na", "Cl"],
    "positions": [[0.0, 0.0, 0.0], [2.82, 2.82, 2.82]],
    "cell": [[0.0, 2.82, 2.82], [2.82, 0.0, 2.82], [2.82, 2.82, 0.0]],
    "pbc": [True, True, True],
    "frames": [],
    "props": {},
    "info": {},
}


class StructureModel(BaseModel):
    """A ``facet.structure/1`` object (see ``docs/SCHEMA.md``)."""

    model_config = ConfigDict(extra="allow", populate_by_name=True, json_schema_extra={"examples": [_NACL_EXAMPLE]})

    schema_: Optional[str] = Field("facet.structure/1", alias="schema", description="Schema identifier.")
    name: Optional[str] = Field("", description="Display name.")
    symbols: list[str] = Field(..., description="Element symbol per atom.")
    positions: list[list[float]] = Field(..., description="Cartesian coordinates in Å, one [x, y, z] per atom.")
    cell: Optional[list[list[float]]] = Field(None, description="3x3 lattice vectors (rows a, b, c) or null.")
    pbc: Optional[Union[list[bool], bool]] = Field(None, description="Periodicity along a, b, c.")
    frames: Optional[list[dict[str, Any]]] = Field(None, description="Trajectory frames 1..n-1: {positions, cell?}.")
    props: Optional[dict[str, Any]] = Field(None, description="Per-atom arrays, e.g. {\"charges\": [...]}.")
    info: Optional[dict[str, Any]] = Field(None, description="Free-form metadata.")

    def to_structure(self) -> Structure:
        """Convert to :class:`~facet.Structure` (raises ``ValueError`` when inconsistent)."""
        return Structure.from_dict(self.model_dump(by_alias=True, exclude_none=False))


class StructureEnvelope(BaseModel):
    """``{"structure": {...}}`` response."""

    structure: dict[str, Any] = Field(..., description="facet.structure/1 object.")


class ProjectIn(BaseModel):
    """A full or partial ``facet.project/1`` document. Unknown keys are preserved;
    ``scene`` is opaque and round-tripped unchanged."""

    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "examples": [{
                "name": "Perovskite study",
                "description": "",
                "tags": ["oxide"],
                "structures": [{"id": "s_1", "name": "NaCl", "structure": _NACL_EXAMPLE}],
                "scene": {"style": {}, "lighting": {}},
            }]
        },
    )

    schema_: Optional[str] = Field(None, alias="schema")
    id: Optional[str] = Field(None, description="p_ + 10 hex chars; assigned by the server when missing.")
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    thumbnail: Optional[str] = Field(None, description="data:image/jpeg;base64,... (optional)")
    activeStructure: Optional[str] = None
    structures: Optional[list[dict[str, Any]]] = Field(None, description="[{id, name, structure}] entries.")
    scene: Optional[dict[str, Any]] = Field(None, description="Frontend render settings (opaque).")
    created: Optional[str] = None
    updated: Optional[str] = None

    def to_doc(self) -> dict[str, Any]:
        """Only the keys the client actually sent (important for PATCH)."""
        return self.model_dump(by_alias=True, exclude_unset=True)


class ParseTextRequest(BaseModel):
    """Parse structure text (JSON alternative to a multipart upload)."""

    model_config = ConfigDict(json_schema_extra={"examples": [{
        "text": "3\nwater\nO 0 0 0\nH 0.76 0.59 0\nH -0.76 0.59 0\n", "format": "xyz", "filename": "water.xyz"}]})

    text: str = Field(..., description="File contents.")
    format: Optional[str] = Field(None, description="Reader name (xyz, extxyz, poscar, cif, pdb, json, ...); "
                                                    "detected from filename/content when omitted.")
    filename: Optional[str] = Field(None, description="Original file name (used for detection and naming).")
    index: Optional[Union[int, str]] = Field(None, description="Frame selection: int (-1 = last) or 'start:stop:step'.")


class ParseResponse(BaseModel):
    structure: dict[str, Any]
    format: str
    filename: Optional[str] = None
    warnings: list[str] = []


class ExportRequest(BaseModel):
    structure: StructureModel
    format: str = Field(..., description="Writer name, e.g. extxyz, poscar, cif, pdb, xyz, json.",
                        examples=["cif"])


class ExportResponse(BaseModel):
    text: str
    filename: str
    mimetype: str
    warnings: list[str] = Field([], description="What the file loses (constraints, frames, the cell, ...): the "
                                                "export check of facet.io.export_report.")
    notes: list[str] = Field([], description="What changes without affecting a calculation (POSCAR atom order, "
                                             "periodicity, velocities).")


class CrystalRequest(BaseModel):
    """Build a crystal from a prototype (see ``GET /api/v1/build/prototypes``)."""

    model_config = ConfigDict(json_schema_extra={"examples": [
        {"prototype": "fcc", "elements": ["Cu"], "a": 3.61, "supercell": [3, 3, 3]},
        {"prototype": "perovskite", "elements": ["Sr", "Ti", "O"], "a": 3.905},
    ]})

    prototype: str = Field(..., description="sc, bcc, fcc, hcp, diamond, zincblende, wurtzite, rocksalt, cscl, "
                                            "fluorite, perovskite, rutile, graphene, mos2, graphite")
    elements: Optional[Union[list[str], str]] = Field(None, description="Elements in role order; defaults per prototype.")
    a: Optional[float] = Field(None, ge=1.0, description="Lattice constant a (Å, at least 1).")
    c: Optional[float] = Field(None, gt=0, description="Lattice constant c (Å) for hexagonal/tetragonal/2D cells.")
    supercell: Optional[list[int]] = Field(None, min_length=3, max_length=3, description="Repeat [nx, ny, nz].")
    params: dict[str, Any] = Field(default_factory=dict, description="Extra prototype parameters: u, thickness, vacuum.")
    name: Optional[str] = None


class ClusterRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"kind": "icosahedron", "element": "Au", "size": 3}]})

    kind: str = Field(..., description="icosahedron, cuboctahedron, decahedron, octahedron, tetrahedron, sphere, fullerene")
    element: Optional[str] = Field(None, description="Element symbol (default per kind).")
    size: Optional[float] = Field(None, description="Shells / atoms per edge / radius in Å, depending on kind "
                                                   "(range: sizeMin..sizeMax of the kind in /api/v1/info).")
    a: Optional[float] = Field(None, ge=1.0, description="fcc lattice constant (Å, at least 1); nearest-neighbour = a/√2.")
    params: dict[str, Any] = Field(default_factory=dict, description="Extra parameters: ino (decahedron), truncate (octahedron).")


class SupercellRequest(BaseModel):
    structure: StructureModel
    repeat: list[int] = Field(..., min_length=3, max_length=3, description="[nx, ny, nz], each >= 1.",
                              examples=[[2, 2, 2]])


class StructureRequest(BaseModel):
    structure: StructureModel


class TerminationsRequest(BaseModel):
    """Describe a lattice plane of a crystal (``facet.build.surface_analysis``)."""

    model_config = ConfigDict(populate_by_name=True)

    structure: StructureModel
    miller: list[int] = Field(..., min_length=3, max_length=4, description="(h, k, l) of the structure's cell, or "
                              "(h, k, i, l) on a hexagonal cell.", examples=[[1, 1, 1]])
    miller_basis: str = Field("input", alias="millerBasis", description="'input' or 'conventional'.")
    primitive: bool = Field(True, description="Reduce to the primitive cell first (the smallest surface cell).")
    translation_tolerance: Optional[float] = Field(None, alias="translationTolerance", gt=0, le=1)
    layer_tolerance: Optional[float] = Field(None, alias="layerTolerance", ge=0.01, le=2)
    charges: Optional[dict[str, float]] = Field(None, description="Formal charges per element (default: estimated).")


class SurfaceRequest(TerminationsRequest):
    """Cleave a slab from a crystal (``facet.build.surface``).  ``vacuum`` is required: the total gap in Å."""

    model_config = ConfigDict(populate_by_name=True, json_schema_extra={"examples": [
        {"structure": {"symbols": ["Pt"], "positions": [[0, 0, 0]], "cell": [[0, 1.96, 1.96], [1.96, 0, 1.96], [1.96, 1.96, 0]]},
         "miller": [1, 1, 1], "millerBasis": "conventional", "vacuum": 15, "layers": 4, "supercell": [3, 3], "fixBottom": 2},
    ]})

    vacuum: float = Field(..., ge=0, le=1000, description="Total gap between the slab and its periodic image (Å); "
                          "0 for none (the slab then repeats as in the bulk).")
    layers: Optional[int] = Field(None, ge=1, le=1000, description="Atomic layers (default 4).")
    periods: Optional[int] = Field(None, ge=1, le=1000, description="Stacking periods, instead of layers.")
    thickness: Optional[float] = Field(None, gt=0, le=500, description="Smallest thickness (Å), instead of layers.")
    termination: Union[int, str] = Field(0, description="Index or label of a termination.")
    cut: Optional[int] = Field(None, ge=0)
    symmetric: bool = False
    position: str = Field("center", description="'center' or 'bottom'.")
    offset: float = Field(0.0, ge=0)
    supercell: Optional[Union[str, list[int], list[list[int]]]] = Field(
        None, description="Surface supercell: [n, m], a 2×2 matrix, or a name such as 'p(2×2)' or '(√3×√3)R30°'.")
    fix_bottom: int = Field(0, alias="fixBottom", ge=0)
    fix_middle: int = Field(0, alias="fixMiddle", ge=0)
    fix_axes: str = Field("abc", alias="fixAxes")
    name: Optional[str] = None


class VacuumRequest(BaseModel):
    """Set the vacuum of a slab (``facet.build.set_vacuum``): the total gap in Å."""

    structure: StructureModel
    vacuum: float = Field(..., gt=0, le=1000, description="Total gap between the slab and its periodic image (Å).")
    position: str = Field("center", description="'center' or 'bottom'.")
    offset: float = Field(0.0, ge=0)
    axis: Optional[int] = Field(None, ge=0, le=2, description="Vacuum axis (default: detected).")


class BondsRequest(BaseModel):
    structure: StructureModel
    scale: float = Field(1.15, gt=0, le=5, description="Bond if d < scale·(r_cov,i + r_cov,j).")
    cutoff: Optional[float] = Field(None, gt=0, le=20, description="Uniform cutoff in Å (overrides scale).")
    pbc: bool = Field(True, description="Search periodic images when the structure is periodic.")


class BondsResponse(BaseModel):
    bonds: list[list[Any]] = Field(..., description="[[i, j, distance, [ox, oy, oz]], ...]; atom j is translated by "
                                                     "offset·cell. Each bond listed once (i <= j).")
    count: int


class CoordinationRequest(BondsRequest):
    pass


class RdfRequest(BaseModel):
    structure: StructureModel
    rmax: float = Field(8.0, gt=0, le=30, description="Maximum distance (Å).")
    nbins: int = Field(160, ge=1, le=5000)
    elements: Optional[list[str]] = Field(None, min_length=2, max_length=2, description="Partial g_AB(r), e.g. [\"Si\", \"O\"].")


class CustomAnalysisRequest(BaseModel):
    structure: StructureModel
    params: dict[str, Any] = Field(default_factory=dict)


class Credentials(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"username": "alice", "password": "s3cret-pass"}]})

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=1024)


class UserOut(BaseModel):
    id: str
    username: str
    created: Optional[str] = None


class AuthResponse(BaseModel):
    token: str = Field(..., description="Bearer token for the Authorization header.")
    user: UserOut


class MeResponse(BaseModel):
    user: UserOut
    mode: str
    #: True when the server needs a sign-in (cloud mode, or local mode with FACET_TOKEN).
    authRequired: bool = False


class HealthResponse(BaseModel):
    status: str
    version: str


class OkResponse(BaseModel):
    ok: bool = True
    id: Optional[str] = None
