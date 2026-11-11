"""What each file writer can store: the capability table of the export check (F0-D §3.12.1).

:func:`facet.io.export_report` reads a writer's capabilities to tell, before or after a file is written, what
the file loses (warnings) and what changes without affecting a calculation (notes).  The built-in writers carry the
rows of :data:`WRITER_CAPABILITIES`; a plugin declares its own with ``ctx.register_writer(..., capabilities={...})``
(or :func:`facet.io.register_writer`; validated by :func:`validate_capabilities`), and a writer without
capabilities gets no report at all (nothing is guessed).  ``GET /api/v1/formats`` lists the capabilities of every
writer, and the web app copies them for the server-only formats, so both languages decide from the same table.

======  ====================  ======  ========  ===========  =========  =======  ========  =======  ==========  ==========
id      label                 frames  cell      constraints  occupancy  order    pbc       overlap  handedness  velocities
======  ====================  ======  ========  ===========  =========  =======  ========  =======  ==========  ==========
json    Facet JSON            all     true      lattice      true       keep     stored    false    false       true
extxyz  Extended XYZ          all     true      cartesian    true       keep     stored    true     false       true
xyz     plain XYZ             all     false     none         false      keep     none      false    false       false
poscar  POSCAR                one     required  lattice      false      species  periodic  true     true        true
cif     CIF                   one     required  none         true       keep     periodic  true     false       false
pdb     PDB                   all     true      none         false      keep     periodic  false    false       false
xsd     Materials Studio XSD  one     true      atoms        false      keep     periodic  true     false       false
======  ====================  ======  ========  ===========  =========  =======  ========  =======  ==========  ==========

- ``label``: the format's name in the messages.
- ``frames``: ``all`` frames of a trajectory, or ``one`` (the export check names the frame written).
- ``cell``: the unit cell is stored (``true``), not stored (``false``), or ``required`` (a structure without one is
  boxed with 10 Å of vacuum on each side).
- ``constraints``: selective dynamics along the cell vectors (``lattice``, exact), along x, y and z (``cartesian``:
  ASE's ``move_mask``, partial constraints that do not follow x, y and z are tightened), whole atoms only
  (``atoms``: an atom fixed along some directions is written as fixed) or not at all (``none``).
- ``occupancy``: partial occupancies are kept.
- ``order``: the atom order is kept, or the atoms are grouped by ``species`` (POSCAR).
- ``pbc``: the file stores the periodicity (``stored``); reading it back gives T T T whenever there is a cell
  (``periodic``: a 2D structure with ``pbc = T T F`` comes back as T T T); no cell at all (``none``).
- ``overlap``, ``handedness``: the export check looks for atoms closer than 0.5 Å and for a left-handed cell (VASP
  stops on one).
- ``velocities`` (optional, see :data:`OPTIONAL_CAPABILITIES`): ``props["velocities"]`` is written.  Lead decision
  L-01 asks for a note when velocities are dropped; the column is an addition to the nine of F0-D §3.12.1 (ledger
  L-F0-25), so a writer may leave it out, and then the export check says nothing about velocities.

The JavaScript twin is ``facet/web/js/io/capabilities.js``: the same table, the same validation and, word for
word, the same messages (a test compares the two tables).
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Any

__all__ = [
    "CAPABILITY_VALUES",
    "OPTIONAL_CAPABILITIES",
    "WRITER_CAPABILITIES",
    "OVERLAP_CHECK_MAX_ATOMS",
    "OCCUPANCY_TOLERANCE",
    "validate_capabilities",
]

#: The capabilities, in table order, with their allowed values (``None``: a non-empty string).
CAPABILITY_VALUES: Mapping[str, tuple[Any, ...] | None] = MappingProxyType({
    "label": None,
    "frames": ("all", "one"),
    "cell": (True, False, "required"),
    "constraints": ("lattice", "cartesian", "atoms", "none"),
    "occupancy": (True, False),
    "order": ("keep", "species"),
    "pbc": ("stored", "periodic", "none"),
    "overlap": (True, False),
    "handedness": (True, False),
    "velocities": (True, False),
})
#: The capabilities a writer may leave out (``None`` counts as left out): ``velocities``, which lead decision L-01
#: added to the table of F0-D §3.12.1.  Every other key of :data:`CAPABILITY_VALUES` is required.
OPTIONAL_CAPABILITIES: tuple[str, ...] = ("velocities",)
_REQUIRED = [k for k in CAPABILITY_VALUES if k not in OPTIONAL_CAPABILITIES]


def _row(label: str, frames: str, cell: bool | str, constraints: str, occupancy: bool, order: str, pbc: str,
         overlap: bool, handedness: bool, velocities: bool) -> Mapping[str, Any]:
    return MappingProxyType({"label": label, "frames": frames, "cell": cell, "constraints": constraints,
                             "occupancy": occupancy, "order": order, "pbc": pbc, "overlap": overlap,
                             "handedness": handedness, "velocities": velocities})


#: The capabilities of the built-in writers (read-only; the table in the module docstring).
WRITER_CAPABILITIES: Mapping[str, Mapping[str, Any]] = MappingProxyType({
    "json": _row("Facet JSON", "all", True, "lattice", True, "keep", "stored", False, False, True),
    "extxyz": _row("Extended XYZ", "all", True, "cartesian", True, "keep", "stored", True, False, True),
    "xyz": _row("plain XYZ", "all", False, "none", False, "keep", "none", False, False, False),
    "poscar": _row("POSCAR", "one", "required", "lattice", False, "species", "periodic", True, True, True),
    "cif": _row("CIF", "one", "required", "none", True, "keep", "periodic", True, False, False),
    "pdb": _row("PDB", "all", True, "none", False, "keep", "periodic", False, False, False),
    "xsd": _row("Materials Studio XSD", "one", True, "atoms", False, "keep", "periodic", True, False, False),
})

#: The overlap check of the export is skipped (with a note) for structures with more atoms than this.
OVERLAP_CHECK_MAX_ATOMS = 200_000
#: A site whose occupancy differs from 1 by more than this is partially occupied.
OCCUPANCY_TOLERANCE = 1e-6


def _choices(values: tuple[Any, ...]) -> str:
    if all(isinstance(v, bool) for v in values):
        return "true or false"
    words = ["true" if v is True else "false" if v is False else str(v) for v in values]
    return "one of " + ", ".join(words)


def _allowed(value: Any, values: tuple[Any, ...]) -> bool:
    if isinstance(value, bool):
        return value in [v for v in values if isinstance(v, bool)]
    return isinstance(value, str) and value in [v for v in values if isinstance(v, str)]


def validate_capabilities(name: str, caps: Any) -> dict[str, Any]:
    """Check the capabilities *caps* of writer *name* and return them as a new dict in table order.

    Every key of :data:`CAPABILITY_VALUES` is required except those of :data:`OPTIONAL_CAPABILITIES`, which may be
    left out or ``None`` (and are then left out of the result), and no other key is allowed; booleans must be
    ``True`` or ``False`` (not 1 or 0).  Raises ``ValueError`` naming the writer and the key, for example
    ``writer 'myfmt': capabilities.constraints must be one of lattice, cartesian, atoms, none``.
    """
    where = f"writer '{name}'"
    if not isinstance(caps, Mapping):
        raise ValueError(f"{where}: capabilities must be an object with the keys {', '.join(_REQUIRED)} "
                         f"(optional: {', '.join(OPTIONAL_CAPABILITIES)})")
    unknown = [str(k) for k in caps if k not in CAPABILITY_VALUES]
    if unknown:
        raise ValueError(f"{where}: unknown capability '{unknown[0]}' (known: {', '.join(CAPABILITY_VALUES)})")
    out: dict[str, Any] = {}
    for key, values in CAPABILITY_VALUES.items():
        value = caps.get(key)
        if value is None and key in OPTIONAL_CAPABILITIES:
            continue
        if values is None:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{where}: capabilities.{key} must be a non-empty string")
        elif not _allowed(value, values):
            raise ValueError(f"{where}: capabilities.{key} must be {_choices(values)}")
        out[key] = value
    return out
