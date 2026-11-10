"""M2 (cleave and slab): the shared recipe ``bulk``.  The JS half is ``tests/js/ops/m2_recipes.mjs``.

``bulk`` builds a bulk crystal from a built-in prototype of the crystal builders (``build.crystal`` in Python,
``buildCrystal`` in ``facet/web/js/build/crystal.js``) with the lattice constants given explicitly, so that a
case never depends on the reference tables of the builders (acceptance §0.4)::

    "input": {"recipe": {"name": "bulk", "args": {"prototype": "fcc", "elements": ["Pt"], "a": 3.92}}}

Arguments (``tests/data/surface/cleave/README.md`` documents them for every module that reuses the recipe):

- ``prototype`` (required): a prototype id of ``facet.build.crystal.PROTOTYPES`` (``fcc``, ``hcp``, ``rutile``,
  ``graphene``, ...); aliases such as ``nacl`` are refused;
- ``elements`` (required): one element symbol per role of the prototype, in role order (``["Sr", "Ti", "O"]``);
- ``a`` (required) and ``c`` (required for the prototypes with a c axis, refused for the others), in Å, above 0.5;
- ``u`` (wurtzite, rutile) and ``thickness`` (mos2: the X-X height, Å): optional, refused for the other
  prototypes; when omitted they come from the shared reference table (the same in both languages since F0-D T10);
- ``repeat`` (optional): ``[nx, ny, nz]``, three positive integers (the ``Structure.repeat`` atom order);
- ``name`` (optional): the structure's name.  Without it the two builders name the crystal differently (``Pt fcc``
  and ``Pt (Face-centred cubic)``) until M7 unifies the bulk names (lead decisions L-11, L-22).

The recipe is shared by the whole repository: other modules reuse it and do not register their own ``bulk``
(registering a name twice raises).  ``tests/data/surface/cleave/recipes.json`` checks that both languages build the
same structures.  Argument errors have the same text in both languages.
"""

from __future__ import annotations

import math
from typing import Any

from facet import Structure, build
from facet.build.crystal import PROTOTYPES

from ..cases import recipe

NAME = "recipe bulk"
ALLOWED = ("prototype", "elements", "a", "c", "u", "thickness", "repeat", "name")


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _whole(n: Any) -> bool:
    """An integer, or a float with an integer value (JSON ``2.0``; JS cannot tell the two apart)."""
    return (isinstance(n, int) and not isinstance(n, bool)) or (isinstance(n, float) and n.is_integer())


@recipe("bulk")
def bulk_recipe(args: dict[str, Any]) -> Structure:
    """A bulk crystal of any built-in prototype with explicit lattice constants (see the module docstring)."""
    unknown = sorted(k for k in args if k not in ALLOWED)
    if unknown:
        raise ValueError(f"{NAME}: unknown args {', '.join(unknown)}")
    for key in ("prototype", "elements", "a"):
        if key not in args:
            raise ValueError(f"{NAME}: missing arg {key}")
    proto = args["prototype"]
    meta = PROTOTYPES.get(proto) if isinstance(proto, str) else None
    if meta is None:
        raise ValueError(f"{NAME}: unknown prototype {proto}")
    elements = args["elements"]
    roles = len(meta["elementRoles"])
    if not isinstance(elements, list) or not all(isinstance(e, str) and e for e in elements):
        raise ValueError(f"{NAME}: elements must be a list of element symbols")
    if len(elements) != roles:
        raise ValueError(f"{NAME}: {proto} needs {roles} element{'s' if roles > 1 else ''}, got {len(elements)}")
    has_c = bool(meta["hasC"])
    if has_c and "c" not in args:
        raise ValueError(f"{NAME}: give c for {proto} (lattice constants are always explicit)")
    if not has_c and "c" in args:
        raise ValueError(f"{NAME}: {proto} has no c axis")
    for key in ("a", "c"):
        if key in args and not (_number(args[key]) and args[key] > 0.5):
            raise ValueError(f"{NAME}: {key} must be a number larger than 0.5 (Å)")
    kw: dict[str, Any] = {}
    for key in ("u", "thickness"):
        if key in args:
            if key not in meta["params"]:
                raise ValueError(f"{NAME}: {proto} has no parameter {key}")
            if not (_number(args[key]) and args[key] > 0):
                raise ValueError(f"{NAME}: {key} must be a positive number")
            kw[key] = float(args[key])
    if "repeat" in args:
        rep = args["repeat"]
        if not isinstance(rep, list) or len(rep) != 3 or not all(_whole(n) and n >= 1 for n in rep):
            raise ValueError(f"{NAME}: repeat must be three positive integers")
        kw["repeat"] = [int(n) for n in rep]
    if "name" in args and not (isinstance(args["name"], str) and args["name"]):
        raise ValueError(f"{NAME}: name must be a non-empty string")
    s = build.crystal(proto, list(elements), a=float(args["a"]), c=float(args["c"]) if has_c else None, **kw)
    if "name" in args:
        s.name = args["name"]
    return s
