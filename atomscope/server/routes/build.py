"""Builder endpoints: crystals, clusters, supercells, molecules and plugin builders.

Requests that would create more than ``Settings.max_atoms`` atoms (``ATOMSCOPE_MAX_ATOMS``)
are refused with 400 *before* anything is built.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from ...build import CLUSTERS, MOLECULES, PROTOTYPES, cluster, crystal, molecule
from ...build.cluster import cluster_kind, estimate_cluster_atoms
from ...config import Settings
from ...core.structure import Structure
from ...plugins import PluginManager
from ..deps import MAX_ATOMS, get_plugins, get_settings, json_response, structure_response
from ..models import ClusterRequest, CrystalRequest, StructureEnvelope, SupercellRequest

router = APIRouter(prefix="/build", tags=["build"])


def _limit(settings: Settings | None) -> int:
    return int(getattr(settings, "max_atoms", None) or MAX_ATOMS)


def _too_many(n: int, limit: int) -> HTTPException:
    return HTTPException(400, f"This would create about {n:,} atoms (limit {limit:,}).")


def _check_repeat(n_atoms: int, rep: list[int] | None, limit: int = MAX_ATOMS) -> None:
    if rep is None:
        return
    if any(int(r) < 1 for r in rep):
        raise HTTPException(400, "supercell repeats must be >= 1")
    total = n_atoms * int(rep[0]) * int(rep[1]) * int(rep[2])
    if total > limit:
        raise _too_many(total, limit)


@router.get("/prototypes", summary="Crystal prototypes and cluster kinds")
def prototypes() -> dict[str, Any]:
    """``{"prototypes": PROTOTYPES, "clusters": CLUSTERS}`` (metadata for builder forms)."""
    return {"prototypes": PROTOTYPES, "clusters": CLUSTERS}


@router.post("/crystal", response_model=StructureEnvelope, summary="Build a crystal")
def build_crystal(body: CrystalRequest, settings: Settings = Depends(get_settings)):
    """Conventional cell of ``prototype`` (optionally repeated by ``supercell``)."""
    try:
        if body.supercell and any(int(r) < 1 for r in body.supercell):
            raise HTTPException(400, "supercell repeats must be >= 1")
        s = crystal(body.prototype, body.elements, a=body.a, c=body.c, **{**body.params, **({"name": body.name} if body.name else {})})
        if body.supercell:
            _check_repeat(len(s), body.supercell, _limit(settings))
            s = s.repeat(*body.supercell)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return structure_response(s)


def _check_cluster_request(body: ClusterRequest, limit: int) -> tuple[str, float]:
    """Validate kind and size against the ranges advertised in ``/api/v1/info`` and the atom limit."""
    kind = cluster_kind(body.kind)
    meta = CLUSTERS[kind]
    size = body.size if body.size is not None else meta.get("defaultSize", 3)
    lo, hi = meta.get("sizeMin"), meta.get("sizeMax")
    if kind != "fullerene" and lo is not None and hi is not None and not (lo <= size <= hi):
        what = str(meta.get("sizeLabel") or "size").lower()
        raise HTTPException(400, f"{what} for a {meta['label'].lower()} must be between {lo:g} and {hi:g} (got {size:g})")
    n = estimate_cluster_atoms(kind, size, body.element, body.a, **body.params)
    if n > limit:
        raise _too_many(n, limit)
    return kind, size


@router.post("/cluster", response_model=StructureEnvelope, summary="Build a cluster")
def build_cluster(body: ClusterRequest, settings: Settings = Depends(get_settings)):
    """Nanoparticle of ``kind``; ``size`` must lie in the kind's ``sizeMin..sizeMax``
    (see ``clusters`` in ``/api/v1/info``)."""
    try:
        kind, size = _check_cluster_request(body, _limit(settings))
        s = cluster(kind, body.element, size, a=body.a, **body.params)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return structure_response(s)


@router.post("/supercell", response_model=StructureEnvelope, summary="Make a supercell")
def build_supercell(body: SupercellRequest, settings: Settings = Depends(get_settings)):
    """Repeat a periodic structure ``[nx, ny, nz]`` times."""
    try:
        s = body.structure.to_structure()
        _check_repeat(len(s), body.repeat, _limit(settings))
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
    settings: Settings = Depends(get_settings),
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
    limit = _limit(settings)
    if len(s) > limit:
        raise _too_many(len(s), limit)
    s.info.setdefault("source", f"plugin:{spec.plugin}:{name}")
    return json_response({"structure": s.to_dict()})
