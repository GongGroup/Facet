"""M1 (cell and lattice tools): ops and recipes of the shared cases.  The JS halves are in ``tests/js/ops/m1.mjs``.

Recipes (built by ``tests/m1_recipes.py``, whose docstring documents the arguments, the geometry and the atom order):
``fcc111``, ``fcc100``, ``fcc110``, ``hcp0001``, ``bcc110`` (slabs of one element written layer by layer) and
``graphene`` (one sheet), with ``supercell``, ``noise``, ``delete``, ``tags``, ``fix``, ``z0``, ``gamma``, ``name`` and
``info``; ``vacuum`` and the lattice constants are always given.  Both languages build them bit for bit alike.  Bulk
crystals are the shared recipe ``bulk`` of ``tests/ops/m2_recipes.py``.

Ops of the recipe check (``tests/data/surface/m1_recipes_check.json``):

- ``xorshift32`` (``seed`` or ``state``, ``count``, ``sigma``): ``value``, the first ``count`` numbers of
  ``XorShift32(seed)`` (or of Marsaglia's raw stream from ``state``); ``uniform``, each divided by 2**32; with
  ``sigma``, ``noise``: the displacements σ·√3·(2u − 1) the recipes add.  No input.
- ``buildRecipe`` (``name``, ``args``): the structure the recipe ``name`` builds from ``args``, as ``structure``.  A
  recipe input fails before the op runs, so argument errors are checked through this op (``expect.error``).
- ``structureDigest``: the input as ``structure``, its number of atoms as ``atoms`` and
  :func:`tests.m1_recipes.structure_digest` as ``digest`` (SHA-256 of the exact float64 positions and cell, and of the
  symbols and props), so that a case compares the whole structure bit for bit without storing its coordinates.

The ops of the M1 golden cases (``tests/data/surface/m1_cases.json``) follow, added by M1-T5b.  Argument errors use the
same messages as the JS side.
"""

from __future__ import annotations

import functools
import json
import math
from typing import Any, Sequence

from ..cases import RECIPES, CaseInput, op, recipe
from ..m1_recipes import RECIPE_NAMES, XorShift32, noise_values, slab, structure_digest

#: The most numbers one ``xorshift32`` case asks for.
MAX_COUNT = 100_000


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


def _whole(n: Any) -> bool:
    """An integer, or a float with an integer value (JSON ``2.0``; JS cannot tell the two apart)."""
    return (isinstance(n, int) and not isinstance(n, bool)) or (isinstance(n, float) and n.is_integer())


for _name in RECIPE_NAMES:
    recipe(_name)(functools.partial(slab, _name))


@op("xorshift32")
def xorshift32_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The first ``count`` numbers of the recipes' generator, divided by 2**32, and as noise displacements."""
    _args(args, "xorshift32", ("seed", "state", "count", "sigma"), ("count",))
    if ("seed" in args) == ("state" in args):
        raise ValueError("xorshift32: give seed or state")
    count = args["count"]
    if not (_whole(count) and 0 <= count <= MAX_COUNT):
        raise ValueError(f"xorshift32: count must be an integer from 0 to {MAX_COUNT}")
    rng = XorShift32(args["seed"]) if "seed" in args else XorShift32(state=args["state"])
    values = rng.take(int(count))
    out: dict[str, Any] = {"value": values, "uniform": [v / 4294967296.0 for v in values]}
    if "sigma" in args:
        sigma = args["sigma"]
        if isinstance(sigma, bool) or not isinstance(sigma, (int, float)) or not math.isfinite(sigma) \
                or not 0 <= sigma <= 1:
            raise ValueError("xorshift32: sigma must be a number from 0 to 1 (Å)")
        out["noise"] = noise_values(float(sigma), values).tolist()
    return out


@op("buildRecipe")
def build_recipe_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The structure that the recipe ``args.name`` builds from ``args.args`` (default ``{}``)."""
    _args(args, "buildRecipe", ("name", "args"), ("name",))
    name = args["name"]
    if not isinstance(name, str):
        raise ValueError("buildRecipe: name must be a recipe name")
    fn = RECIPES.get(name)
    if fn is None:
        raise ValueError(f"buildRecipe: no recipe {json.dumps(name, ensure_ascii=False)}")
    given = args.get("args", {})
    if not isinstance(given, dict):
        raise ValueError("buildRecipe: args must be an object")
    return {"structure": fn(dict(given))}


@op("structureDigest")
def structure_digest_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input structure, its number of atoms and the SHA-256 digests of its exact contents."""
    _args(args, "structureDigest", ())
    s = inp.structure
    return {"structure": s, "atoms": len(s), "digest": structure_digest(s)}
