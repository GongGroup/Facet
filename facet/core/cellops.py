"""Cell and lattice operations of the cell tools (M1): pure functions that return a :class:`CellOpResult`.

Each operation works on a copy of its input structure (which it never modifies) and returns the new structure
together with what callers need to follow the change: the source map, the index map and image shifts that carry the
selection and the measurements of the web app across, the integer change of basis, a label for read-outs and
one-time notes.  The in-place methods of :class:`~facet.core.structure.Structure` (``reduce_cell``,
``set_cell``, ``reorient``, ...) are thin wrappers, ``r = cellops.op(self, ...)`` then ``self._adopt(r.structure)``,
and ``Structure.make_supercell`` returns ``r.structure``; the surface, adsorbate and interface tools and the REST
routes call the functions here when they need the details.

Conventions (design brief C1): the rows of a cell are the lattice vectors and ``cart = frac @ cell``; an integer
matrix ``P`` gives the new cell ``P @ cell`` and the fractional coordinates ``f @ inv(P)``
(:mod:`facet.core.intmath`); a deformation ``F`` acts on row vectors, ``cell' = cell @ F.T``.  Source maps
run new -> old: ``src[j]`` is the input atom that new atom ``j`` comes from.

The module is written by several tasks, each inside its own segment, between ``# --- surface-modeling <name> ---``
and ``# --- end <name> ---`` (each segment adds its public names to ``__all__`` itself, plan.md §2.2):

- ``M1-T3a`` -- the supercell family: ``make_supercell``, ``redefine_lattice``, ``make_right_handed``,
  ``reduce_cell``, ``conventional_cell`` and the wrapping rule (M1 §3.3, §3.7, §3.11.3, §3.14);
- ``M1-T3b`` -- continuous deformations and rigid operations: ``set_cell``, ``set_lattice_parameters``, ``deform``,
  ``apply_strain``, ``reorient``, ``permute_cell_axes``, ``shift_origin``, ``wrap_into_cell`` (M1 §3.8-§3.10, §3.13);
- ``M1-T10`` -- the two hooks :func:`begin_cell_op` and :func:`finish_cell_op` (stubs until M1-T10 fills them in),
  the info-handler registry re-exported from ``core.infohandlers``, and ``reference_mesh`` (M1 §3.15, §3.6.4).

**The hooks** (plan.md P-05).  Every structure operation of M1 -- the ones here and ``primitive_cell`` in
``facet.analysis.translations`` -- calls ``before = begin_cell_op(s)`` on its input first thing and
``finish_cell_op(out, ctx, before)`` on its result as the last step before it makes the :class:`CellOpResult`.  The
operations never drop derived information, call info handlers or rename structures themselves: the hooks do, so
that M1-T10 can add the info handlers and the automatic names in one place.  The signatures and the fields of
``ctx`` (see :func:`finish_cell_op`) are fixed.

The JavaScript twin is ``facet/web/js/core/cellops.js``: the same functions in camelCase, the same contract,
``cellOpResult(fields)`` for the result.  It does not import ``core/structure.js``, which imports it for the thin
methods (ledger L-M1-08): it builds structures with ``s.constructor`` and reaches F0-D's ``markEdited`` through the
structure itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import structure as _structure

__all__ = ["CellOpResult"]


@dataclass(kw_only=True)
class CellOpResult:
    """The result of a cell operation (ledger L-M1-08); keyword arguments only.

    ``structure``, ``changed`` and ``lattice_changed`` are required, the other fields default to "nothing":

    ===================  =====================================================================================
    ``structure``        the new structure (the input is never modified)
    ``src``              new -> old source map (``= structure.source_map``); None: the same atoms
    ``index_map``        old -> new, for the selection and the measurements (a primitive cell: ``orbit_of``, every
                         input atom to the representative of its orbit); None: the inverse of ``src``
    ``image_shift``      per input atom, the integer new-lattice translation ``k`` by which the operation moved it
                         (``r' = r + k @ new cell``, shape ``(n_old, 3)``; M1 §4.3); None: no atom moved
    ``matrix``           the integer change of basis, new cell = ``matrix @`` old cell (supercell, redefined,
                         reduced, conventional and right-handed cells); None for primitive cells and rotations
    ``label``            a label for the read-out and the toast, e.g. ``c(2×2)``; names never use it, they come
                         from the accumulated matrix (lead decision L-19)
    ``notes``            one-time notes (M1 §3.17: N-SC1, N-LH, ...), shown as toasts, REST ``notes`` and CLI
                         stderr; never written into ``info``
    ``changed``          False when the operation did nothing (the cell was already reduced, ...)
    ``lattice_changed``  the lattice basis changed, so image offsets of measurements no longer mean the same
                         (True for supercells and changes of basis, False for strain, cell parameters, shifts and
                         wraps; M1 §4.3)
    ``rotation``         the rotation R of a reorientation (``cart' = cart @ R.T``), else None
    ``moved``            the number of atoms that wrapping moved by a lattice vector
    ===================  =====================================================================================

    ``facet.analysis.translations.PrimitiveResult`` extends it with the fields of a primitive cell.
    """

    structure: _structure.Structure
    src: np.ndarray | None = None
    index_map: np.ndarray | None = None
    image_shift: np.ndarray | None = None
    matrix: list | None = None
    label: str | None = None
    notes: list[str] = field(default_factory=list)
    changed: bool
    lattice_changed: bool
    rotation: np.ndarray | None = None
    moved: int = 0


# --- surface-modeling M1-T3a ---
# --- end M1-T3a ---

# --- surface-modeling M1-T3b ---
# --- end M1-T3b ---

# --- surface-modeling M1-T10 ---
#: The values of ``ctx["kind"]`` (M1 §3.15, ledger L-M1-14).
_CTX_KINDS = ("supercell", "basis", "primitive", "rotation", "deform", "translate")
#: The keys every ``ctx`` must have; the others may be left out (= None).
_CTX_REQUIRED = ("kind", "old", "new", "mark")


def begin_cell_op(structure: _structure.Structure) -> dict[str, Any]:
    """What :func:`finish_cell_op` needs to know about *structure* before a cell operation changes it.

    Call it on the input structure first thing, before anything is computed, and pass the result on to
    :func:`finish_cell_op` unchanged; callers treat it as opaque.  This stub (M1-T1) returns
    ``{"name": structure.name}``.  M1-T10 makes it ``auto_name_state(structure)``, ``{"name", "suffix", "auto"}``
    (ledger L-X-07, rule 1): whether the structure carries its automatic name, judged by ``info.surface.autoName``
    alone, the only sentinel of an automatic name (lead decision L-12).
    """
    return {"name": structure.name}


def finish_cell_op(structure: _structure.Structure, ctx: dict[str, Any], before: dict[str, Any]) -> None:
    """Bring the derived information of *structure*, the result of a cell operation, up to date (in place).

    Call it once on the result, as the last step before the :class:`CellOpResult` is made: after the positions,
    the cell, the per-atom properties, the constraint flags (``apply_basis_change``), the adsorbate ids and
    ``info["supercellMatrix"]`` are final, so that the info handlers and the name see the finished structure.
    *before* is what :func:`begin_cell_op` returned for the input.  *ctx* (ledger L-M1-14):

    ==================  ======================================================================================
    ``kind``            ``"supercell"``, ``"basis"`` (redefined, reduced, conventional or right-handed cell,
                        renamed axes), ``"primitive"``, ``"rotation"``, ``"deform"`` (set_cell, cell parameters,
                        strain) or ``"translate"`` (origin shift, wrap)
    ``old``             the input structure (unchanged)
    ``new``             the result: the same object as *structure*
    ``mark``            the ``mark_edited`` kind (M1 §3.4): ``"repeat"`` for a diagonal supercell, ``"cell"`` for
                        any other new lattice, ``"rotate"`` for a rigid rotation, None when nothing derived goes
                        stale (origin shift, wrap, renamed axes)
    ``matrix``          the integer change of basis, new cell = ``matrix @`` old cell (P, U or C); else None
    ``transform``       a primitive cell: ``{"num": 3x3 int, "den": int}``, new cell = num / den @ old cell
    ``rotation``        a rotation: R (3x3, ``cart' = cart @ R.T``)
    ``deformation``     a deformation: F (``cell' = cell @ F.T``)
    ``src``             the new -> old source map; None: the same atoms
    ``images``          a supercell: ``|det P|``, the number of images
    ``id_offset``       a supercell: V, the ``adsorbate_id`` increment from one image to the next
    ``lattice_points``  a supercell: ``supercell_lattice_points(P)``, the translation of each image
    ``id_map``          a primitive cell: old ``adsorbate_id`` -> new
    ``perm``            renamed axes: the permutation of the cell vectors
    ==================  ======================================================================================

    ``kind``, ``old``, ``new`` and ``mark`` are required; leave out (or set to None) what does not apply.  A *ctx*
    that is not a dict, misses a required key, has another ``kind`` or another ``new`` raises (``TypeError``,
    ``ValueError``) before anything changes.

    This stub (M1-T1) only calls ``mark_edited(structure, ctx["mark"], rotation=ctx.get("rotation"))``, and nothing
    when ``mark`` is None (a rotation turns the Cartesian vector properties, such as velocities, with the atoms).
    M1-T10 replaces the body with ``mark_edited``, then ``apply_info_handlers(ctx)``, then
    ``refresh_auto_name(structure, before, cell_change={"matrix": ctx["matrix"], "cell": the old cell,
    "previous": the old info["supercellMatrix"]})`` and, when that returns False, ``structure.name =
    rename_after_cell_change(...)`` (ledger L-X-07, rule 4: names after the info handlers, so that they see the
    rewritten records and ids).  The surface-cell label in a name is computed from the accumulated
    ``info["supercellMatrix"]`` alone: a preset's own label (``c(2×2)``) goes into ``CellOpResult.label`` for the
    read-out and the toast, never into the name (lead decision L-19).
    """
    _check_context(structure, ctx)
    mark = ctx["mark"]
    if mark is not None:
        _structure.mark_edited(structure, mark, rotation=ctx.get("rotation"))


def _check_context(structure: _structure.Structure, ctx: Any) -> None:
    if not isinstance(ctx, dict):
        raise TypeError("finish_cell_op: ctx must be a dict")
    missing = ", ".join(repr(k) for k in _CTX_REQUIRED if k not in ctx)
    if missing:
        raise ValueError(f"finish_cell_op: ctx needs 'kind', 'old', 'new' and 'mark' (missing {missing})")
    if ctx["kind"] not in _CTX_KINDS:
        raise ValueError(f"finish_cell_op: unknown kind {ctx['kind']!r} "
                         f"(use {', '.join(_CTX_KINDS[:-1])} or {_CTX_KINDS[-1]})")
    if ctx["new"] is not structure:
        raise ValueError("finish_cell_op: ctx['new'] must be the structure being finished")
# --- end M1-T10 ---
