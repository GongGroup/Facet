"""Builder endpoints: crystals, clusters, supercells, molecules and plugin builders."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from ...build import CLUSTERS, MOLECULES, PROTOTYPES, cluster, crystal, molecule
from ...core.structure import Structure
from ...plugins import PluginManager
from ..deps import MAX_ATOMS, get_plugins, json_response, structure_response
from ..models import ClusterRequest, CrystalRequest, StructureEnvelope, SupercellRequest

router = APIRouter(prefix="/build", tags=["build"])


def _check_repeat(n_atoms: int, rep: list[int] | None) -> None:
    if rep is None:
        return
    if any(int(r) < 1 for r in rep):
        raise HTTPException(400, "supercell repeats must be >= 1")
    total = n_atoms * int(rep[0]) * int(rep[1]) * int(rep[2])
    if total > MAX_ATOMS:
        raise HTTPException(400, f"supercell would contain {total} atoms (limit {MAX_ATOMS})")


@router.get("/prototypes", summary="Crystal prototypes and cluster kinds")
def prototypes() -> dict[str, Any]:
    """``{"prototypes": PROTOTYPES, "clusters": CLUSTERS}`` (metadata for builder forms)."""
    return {"prototypes": PROTOTYPES, "clusters": CLUSTERS}


@router.post("/crystal", response_model=StructureEnvelope, summary="Build a crystal")
def build_crystal(body: CrystalRequest):
    """Conventional cell of ``prototype`` (optionally repeated by ``supercell``)."""
    try:
        s = crystal(body.prototype, body.elements, a=body.a, c=body.c, **{**body.params, **({"name": body.name} if body.name else {})})
        if body.supercell:
            _check_repeat(len(s), body.supercell)
            s = s.repeat(*body.supercell)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return structure_response(s)


@router.post("/cluster", response_model=StructureEnvelope, summary="Build a cluster")
def build_cluster(body: ClusterRequest):
    """Nanoparticle of ``kind`` (see ``clusters`` in ``/api/v1/info`` for size semantics)."""
    try:
        s = cluster(body.kind, body.element, body.size if body.size is not None else CLUSTERS.get(body.kind.lower(), {}).get("defaultSize", 3),
                    a=body.a, **body.params)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return structure_response(s)


@router.post("/supercell", response_model=StructureEnvelope, summary="Make a supercell")
def build_supercell(body: SupercellRequest):
    """Repeat a periodic structure ``[nx, ny, nz]`` times."""
    try:
        s = body.structure.to_structure()
        _check_repeat(len(s), body.repeat)
        out = s.repeat(*body.repeat)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return structure_response(out)


@router.get("/molecules", summary="Molecule library")
def molecules() -> dict[str, Any]:
    """``{"molecules": [{name, label, formula, natoms, aliases, description}]}``."""
    out = []
    for name, meta in MOLECULES.items():
        s = molecule(name)
        out.append({"name": name, "label": meta["label"], "formula": s.formula, "natoms": len(s),
                    "aliases": meta["aliases"], "description": meta["description"]})
    return {"molecules": out}


@router.get("/molecule/{name}", response_model=StructureEnvelope, summary="Get a molecule")
def get_molecule(name: str):
    """A molecule by name or alias (e.g. ``water``, ``caffeine``, ``C60``)."""
    try:
        return structure_response(molecule(name))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/custom", summary="Plugin builders")
def custom_builders(plugins: PluginManager = Depends(get_plugins)) -> dict[str, Any]:
    """``{"builders": [{name, plugin, label, description, params}]}``."""
    return {"builders": [b.to_json() for b in plugins.builders.values()]}


@router.post("/custom/{name}", response_model=StructureEnvelope, summary="Run a plugin builder")
def run_custom_builder(
    name: str,
    params: dict[str, Any] = Body(default_factory=dict, examples=[{"element": "Au", "n": 8}]),
    plugins: PluginManager = Depends(get_plugins),
):
    """Call the plugin builder ``name`` with the JSON body as keyword parameters."""
    spec = plugins.builders.get(name)
    if spec is None:
        raise HTTPException(404, f"unknown builder {name!r}; available: {', '.join(plugins.builders) or 'none'}")
    try:
        result = spec.func(**(params or {}))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"builder {name!r} failed: {exc}") from exc
    s = result if isinstance(result, Structure) else Structure.from_dict(result)
    s.info.setdefault("source", f"plugin:{spec.plugin}:{name}")
    return json_response({"structure": s.to_dict()})
