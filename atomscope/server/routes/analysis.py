"""Analysis endpoints: bonds, summary, coordination, RDF and plugin analyses."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from ...analysis import coordination_numbers, neighbor_arrays, rdf, summary
from ...core.structure import Structure, jsonable
from ...plugins import PluginManager
from ..deps import get_plugins, json_response
from ..models import BondsRequest, BondsResponse, CoordinationRequest, CustomAnalysisRequest, RdfRequest, StructureRequest

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _structure(model: Any) -> Structure:
    try:
        return model.to_structure()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/bonds", response_model=BondsResponse, summary="Detect bonds")
def bonds(body: BondsRequest):
    """Bonds with ``0.1 < d < scale·(r_i + r_j)`` (Cordero covalent radii) or ``d < cutoff``.

    Periodic images are included; ``[i, j, d, [ox, oy, oz]]`` means atom *j*
    translated by ``ox·a + oy·b + oz·c`` bonds to atom *i*.
    """
    s = _structure(body.structure)
    nl = neighbor_arrays(s, cutoff=body.cutoff, scale=body.scale, pbc=body.pbc)
    return json_response({"bonds": nl.to_list(), "count": int(len(nl.i))})


@router.post("/summary", summary="Structure summary")
def structure_summary(body: StructureRequest):
    """``{"summary": {formula, reducedFormula, natoms, nframes, composition, pbc, volume, density,
    cellpar, cell, mass, boundingBox, spacegroup}}``."""
    return json_response({"summary": summary(_structure(body.structure))})


@router.post("/coordination", summary="Coordination numbers")
def coordination(body: CoordinationRequest):
    """``{"coordination": [cn per atom], "average": float, "byElement": {El: mean cn}}``."""
    s = _structure(body.structure)
    cn = coordination_numbers(s, cutoff=body.cutoff, scale=body.scale, pbc=body.pbc)
    by: dict[str, list[int]] = defaultdict(list)
    for sym, c in zip(s.symbols, cn.tolist()):
        by[sym].append(c)
    return json_response({
        "coordination": cn.tolist(),
        "average": float(cn.mean()) if len(cn) else 0.0,
        "byElement": {k: float(np.mean(v)) for k, v in by.items()},
    })


@router.post("/rdf", summary="Radial distribution function")
def radial_distribution(body: RdfRequest):
    """``{"r": [...], "g": [...], "rmax", "nbins", "elements"}`` (bin centres in Å)."""
    s = _structure(body.structure)
    try:
        r, g = rdf(s, rmax=body.rmax, nbins=body.nbins, elements=tuple(body.elements) if body.elements else None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return json_response({"r": np.round(r, 6).tolist(), "g": np.round(g, 6).tolist(), "rmax": body.rmax,
                          "nbins": body.nbins, "elements": body.elements})


@router.get("/custom", summary="Plugin analyses")
def custom_analyses(plugins: PluginManager = Depends(get_plugins)) -> dict[str, Any]:
    """``{"analyses": [{name, plugin, label, description, params}]}``."""
    return {"analyses": [a.to_json() for a in plugins.analyses.values()]}


@router.post("/custom/{name}", summary="Run a plugin analysis")
def run_custom_analysis(name: str, body: CustomAnalysisRequest, plugins: PluginManager = Depends(get_plugins)):
    """Call plugin analysis ``name(structure, **params)`` → ``{"result": ...}``."""
    spec = plugins.analyses.get(name)
    if spec is None:
        raise HTTPException(404, f"unknown analysis {name!r}; available: {', '.join(plugins.analyses) or 'none'}")
    s = _structure(body.structure)
    try:
        result = spec.func(s, **(body.params or {}))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"analysis {name!r} failed: {exc}") from exc
    return json_response({"result": jsonable(result), "analysis": name, "plugin": spec.plugin})
