"""Analysis endpoints: bonds, summary, coordination, RDF and plugin analyses."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request

from ...analysis import coordination_numbers, neighbor_arrays, rdf, summary
from ...core.structure import Structure, jsonable
from ...plugins import PluginManager
from ...core.elements import covalent_radius
from ..auth import current_user
from ..deps import MAX_ATOMS, get_plugins, get_settings, json_response
from ..models import BondsRequest, BondsResponse, CoordinationRequest, CustomAnalysisRequest, RdfRequest, StructureRequest

def _signed_in_on_cloud(request: Request) -> None:
    """Analyses run on the server's CPU: in cloud mode only signed-in users may start them
    (local mode is covered by the app-wide token check)."""
    if request.app.state.settings.mode == "cloud" and request.method != "GET":
        current_user(request, None if not request.headers.get("authorization") else _creds(request))


def _creds(request: Request):
    from fastapi.security import HTTPAuthorizationCredentials

    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    return HTTPAuthorizationCredentials(scheme=scheme, credentials=value.strip()) if value else None


router = APIRouter(prefix="/analysis", tags=["analysis"], dependencies=[Depends(_signed_in_on_cloud)])

#: Upper bound on atom pairs one analysis request may examine (``CRYSTALLUME_MAX_PAIRS`` overrides).
MAX_PAIRS = 50_000_000
#: Upper bound on periodic images searched around the cell.
MAX_IMAGES = 9_261  # 21³


def _guard_work(s: Structure, radius: float, settings: Any) -> None:
    """Refuse requests whose neighbour search would be unreasonably large (tiny cells, huge radii, many atoms)."""
    n = len(s)
    limit = int(getattr(settings, "max_atoms", None) or MAX_ATOMS)
    if n > limit:
        raise HTTPException(400, f"This structure has {n:,} atoms; the analysis limit is {limit:,}.")
    max_pairs = int(getattr(settings, "max_pairs", None) or MAX_PAIRS)
    cell = None if s.cell is None else np.asarray(s.cell, dtype=float)
    pbc = list(getattr(s, "pbc", (False, False, False)) or (False, False, False))
    if cell is not None and any(pbc):
        vol = abs(float(np.linalg.det(cell)))
        if not np.isfinite(vol) or vol < 1e-6:
            raise HTTPException(400, "The unit cell has (almost) zero volume.")
        heights = [vol / float(np.linalg.norm(np.cross(cell[(k + 1) % 3], cell[(k + 2) % 3]))) for k in range(3)]
        images = 1
        for k in range(3):
            if pbc[k]:
                images *= 2 * int(np.ceil(radius / heights[k])) + 1
        if images > MAX_IMAGES:
            raise HTTPException(400, f"The cell is too small for a {radius:.1f} Å search ({images:,} periodic images; "
                                     f"limit {MAX_IMAGES:,}). Use a supercell or a smaller radius.")
        pairs = n * n / vol * (4.0 / 3.0) * np.pi * radius ** 3
    else:
        pairs = n * (n - 1) / 2
    if pairs > max_pairs:
        raise HTTPException(400, f"This would compare about {pairs:,.0f} atom pairs (limit {max_pairs:,}). "
                                 "Use fewer atoms or a smaller radius.")


def _bond_radius(s: Structure, cutoff: float | None, scale: float) -> float:
    if cutoff:
        return float(cutoff)
    rmax = max((covalent_radius(x) for x in set(s.symbols)), default=1.0)
    return 2.0 * float(scale) * rmax


def _structure(model: Any) -> Structure:
    try:
        return model.to_structure()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/bonds", response_model=BondsResponse, summary="Detect bonds")
def bonds(body: BondsRequest, settings=Depends(get_settings)):
    """Bonds with ``0.1 < d < scale·(r_i + r_j)`` (Cordero covalent radii) or ``d < cutoff``.

    Periodic images are included; ``[i, j, d, [ox, oy, oz]]`` means atom *j*
    translated by ``ox·a + oy·b + oz·c`` bonds to atom *i*.
    """
    s = _structure(body.structure)
    _guard_work(s, _bond_radius(s, body.cutoff, body.scale), settings)
    nl = neighbor_arrays(s, cutoff=body.cutoff, scale=body.scale, pbc=body.pbc)
    return json_response({"bonds": nl.to_list(), "count": int(len(nl.i))})


@router.post("/summary", summary="Structure summary")
def structure_summary(body: StructureRequest):
    """``{"summary": {formula, reducedFormula, natoms, nframes, composition, pbc, volume, density,
    cellpar, cell, mass, boundingBox, spacegroup}}``."""
    return json_response({"summary": summary(_structure(body.structure))})


@router.post("/coordination", summary="Coordination numbers")
def coordination(body: CoordinationRequest, settings=Depends(get_settings)):
    """``{"coordination": [cn per atom], "average": float, "byElement": {El: mean cn}}``."""
    s = _structure(body.structure)
    _guard_work(s, _bond_radius(s, body.cutoff, body.scale), settings)
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
def radial_distribution(body: RdfRequest, settings=Depends(get_settings)):
    """``{"r": [...], "g": [...], "rmax", "nbins", "elements"}`` (bin centres in Å)."""
    s = _structure(body.structure)
    _guard_work(s, float(body.rmax), settings)
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
    """Call plugin analysis ``name(structure, **params)`` → ``{"result": ...}``.

    When the analysis declares ``params``, ``params`` is checked against them first (``validate_params``, not strict:
    keys and types it does not declare pass unchanged): a value that does not fit gives 422 with the message, and the
    analysis gets the normalized values (declared defaults for parameters not given).
    """
    from ...core.params import validate_params

    spec = plugins.analyses.get(name)
    if spec is None:
        raise HTTPException(404, f"unknown analysis {name!r}; available: {', '.join(plugins.analyses) or 'none'}")
    params = dict(body.params or {})
    if spec.meta.get("params"):
        params, errors, _ = validate_params(spec.meta["params"], params, strict=False)
        if errors:
            raise HTTPException(422, " ".join(errors))
    s = _structure(body.structure)
    try:
        result = spec.func(s, **params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"analysis {name!r} failed: {exc}") from exc
    return json_response({"result": jsonable(result), "analysis": name, "plugin": spec.plugin})
