"""M1 (cell and lattice tools): the structure recipes of the M1 golden cases and the noise they use.

The M1 cases need large slabs (10 000 atoms, noisy, with vacancies) that are better described than stored (M1 §7.2,
E26): a case names a recipe and its arguments, and both languages build the same structure from them, bit for bit.
``tests/ops/m1.py`` registers the recipes for the shared cases (``tests/cases.py``); the JS twin of this module is
``tests/js/m1_recipes.mjs`` (registered in ``tests/js/ops/m1.mjs``), which computes every number with the same
operations in the same order.  ``tests/data/surface/m1_recipes_check.json`` checks that the two agree exactly, and
``tests/data/surface/make_m1_cases.py`` writes it.  Bulk crystals come from the shared recipe ``bulk`` of M2
(``tests/ops/m2_recipes.py``), which is not registered again here.

Recipes: ``fcc111``, ``fcc100``, ``fcc110``, ``hcp0001`` and ``bcc110``, a slab of one element written layer by
layer from the ideal bulk geometry (no M2 code), and ``graphene``, one honeycomb sheet::

    "input": {"recipe": {"name": "fcc111", "args": {"element": "Pt", "a": 3.92, "layers": 4, "vacuum": 15}}}
    "input": {"recipe": {"name": "fcc111", "args": {"element": "Pt", "a": 3.92, "layers": 25, "vacuum": 15,
              "supercell": [20, 20], "noise": {"sigma": 0.005, "seed": 11}, "delete": "top:25"}}}

Geometry (a1 along x, a2 in the xy plane, c along z; s = a/√2; site fractions on (a1, a2); layer k, counted from the
bottom, uses the entry k mod n of its stacking):

- ``fcc111``: a1 = (s, 0), a2 = (−s/2, s√3/2) (γ = 120°); spacing a/√3; sites (0, 0), (2/3, 1/3), (1/3, 2/3).
- ``fcc100``: a1 = (s, 0), a2 = (0, s); spacing a/2; sites (0, 0), (1/2, 1/2).
- ``fcc110``: a1 = (s, 0) along [1 −1 0], a2 = (0, a) along [0 0 1]; spacing s/2; sites (0, 0), (1/2, 1/2).
- ``hcp0001``: a1 = (a, 0), a2 = (−a/2, a√3/2); spacing c/2; sites (0, 0), (2/3, 1/3).
- ``bcc110``: a1 = (a√3/2, 0), a2 = (−a√3/6, a√6/3) (|a2| = |a1|, γ = 109.47°); spacing a/√2; sites (0, 0), (1/2, 1/2).
- ``graphene``: a1 = (a, 0), a2 = (−a/2, a√3/2); one sheet with the sites (1/3, 2/3) and (2/3, 1/3).

``gamma: 60`` (``fcc111``, ``hcp0001``, ``graphene``) takes a2 = (s/2, s√3/2) (``fcc111``) or (a/2, a√3/2) and the
same atoms in that basis: sites (0, 0), (1/3, 1/3), (2/3, 2/3) (``fcc111``), (0, 0), (1/3, 1/3) (``hcp0001``) and
(1/3, 1/3), (2/3, 2/3) (``graphene``).  The Pt ``fcc111`` slab with ``supercell: [3, 3]``, 4 layers and 15 Å is the
geometry of the CONTCAR fixture ``tests/data/surface/contcar_pt111.vasp`` (stacking A B C A from the bottom).

Arguments (unknown ones are refused; lengths in Å):

- ``element`` (required): a known element symbol, case-sensitive (``"Pt"``).
- ``a`` (required, > 0.5): the cubic a of fcc and bcc, the hexagonal a of hcp and graphene; ``c`` (``hcp0001``,
  required, > 0.5).  Lattice constants are always explicit, as for ``bulk``.
- ``layers`` (required except for ``graphene``): the number of atomic layers, at least 1.
- ``vacuum`` (required, > 0; no default, U4): the gap between the top layer and the periodic image of the bottom
  layer, so the cell height is (layers − 1) × spacing + vacuum (``graphene``: the vacuum).
- ``gamma``: 120 (default) or 60, see above.
- ``supercell``: ``[n1, n2]`` or ``[n1, n2, n3]`` (default ``[1, 1, 1]``): n1 × n2 surface cells, and n3 copies of
  the slab with its vacuum stacked along c (n3 × the cell height).
- ``z0``: the height of the bottom layer (default 0).
- ``tags``: ``true`` writes ``props.tags``, the layer number counted from the top of each copy (1 = top, brief C4).
- ``fix``: n writes ``props.selective_dynamics``: ``[F, F, F]`` for the bottom n layers of each copy and
  ``[T, T, T]`` for the others (0 <= n <= layers; 0 gives the key with every atom free); omitted, there is no key.
- ``noise``: ``{"sigma": σ, "seed": s}`` adds σ·√3·(2u − 1) to x, y and z of every atom, in atom order, with u from
  ``XorShift32(s)``: uniform in (−σ√3, σ√3), standard deviation σ (0 <= σ <= 1; 0 leaves the atoms alone).
- ``delete``: ``"top:N"`` (the last N atoms of the top layer, which are the last N atoms) or a list of atom indices
  (of the slab before the deletion); applied after the noise, so the other atoms keep their positions.
- ``name``: the structure's name; default ``Pt(111) 4L``, ``Pt(111) p(3×3) 4L``, ``Pt(111) 4L ×2`` (n3 = 2),
  ``C graphene p(30×30)``.
- ``info``: an object copied into ``info`` (for example an ``info.surface`` record); default none.

The result has ``pbc = [T, T, T]`` (brief U2; ``graphene`` too, unlike the 2D builder prototype), no frames and no
other props.  Its atoms are ordered layer by layer from the bottom (the n3 copies one after the other), within a layer
by surface cell (i, j) with j fastest, as ``Structure.repeat`` orders its images, then by site; positions are not
wrapped into the cell.  At most :data:`MAX_ATOMS` atoms.  Argument errors read ``recipe <name>: <reason>`` with the
same text in both languages.

Exact arithmetic (the JS twin does the same IEEE-754 operations in the same order; no matrix products, no sums of
arrays, no trigonometry, so no BLAS or libm difference can enter): with S2, S3, S6 = sqrt(2), sqrt(3), sqrt(6) and the
site fractions as ``p / q`` divisions, an atom of site (u, v) in surface cell (i, j) of layer k of copy m is at
x = (i + u)·a1x + (j + v)·a2x, y = (j + v)·a2y, z = z0 + k·d + m·cz (evaluated left to right), with the cell rows
(n1·a1x, 0, 0), (n2·a2x, n2·a2y, 0), (0, 0, n3·cz) and cz = (layers − 1)·d + vacuum.  The mesh values are
``s = a / S2``; ``fcc111``: a1x = s, a2x = −(s / 2) (γ = 60: s / 2), a2y = s·S3 / 2, d = a / S3; ``fcc100``:
a1x = s, a2x = 0, a2y = s, d = a / 2; ``fcc110``: a1x = s, a2x = 0, a2y = a, d = s / 2; ``hcp0001`` and ``graphene``:
a1x = a, a2x = −(a / 2) (γ = 60: a / 2), a2y = a·S3 / 2, d = c / 2 (``graphene``: 0); ``bcc110``: a1x = a·S3 / 2,
a2x = −(a·S3 / 6), a2y = a·S6 / 3, d = a / S2.  The noise adds amp·(2u − 1) with amp = σ·S3 and u = x / 2**32.

Noise generator: :class:`XorShift32` is Marsaglia's xorshift32 (shifts 13, 17, 5; the state 2463534242 of his paper
gives 723471715 first) started from ``mix32(seed)``, the 32-bit finaliser of MurmurHash3: a bijection of the 32-bit
integers, so that small and nearby seeds give unrelated streams (plain xorshift32 from the state 11 starts with
0.0007, 0.17, ...).  Only integer shifts, xor and multiplication modulo 2**32 (JS ``Math.imul``) are used.

:func:`structure_digest` gives SHA-256 digests of the exact contents of a structure (positions and cell as
little-endian float64, symbols and props as canonical text), the same in both languages; the check cases compare
them, so a one-ulp difference anywhere fails.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import struct
from dataclasses import dataclass
from typing import Any, Callable, Sequence

import numpy as np

from crystallume import Structure
from crystallume.core.elements import is_element

__all__ = [
    "MAX_ATOMS",
    "RECIPE_NAMES",
    "FACES",
    "Face",
    "XorShift32",
    "xorshift32_step",
    "mix32",
    "noise_values",
    "uniform_noise",
    "slab",
    "canonical_text",
    "structure_digest",
]

#: The most atoms one recipe builds (a guard against a typing slip in a case file; the M1 cases need 10 000).
MAX_ATOMS = 200_000
#: Seeds and states of :class:`XorShift32` are integers from 1 to this.
U32_MAX = 0xFFFFFFFF

S2, S3, S6 = math.sqrt(2.0), math.sqrt(3.0), math.sqrt(6.0)


# ------------------------------------------------------------------------------------------- the noise generator
def xorshift32_step(x: int) -> int:
    """One step of Marsaglia's xorshift32 (shifts 13, 17, 5) on the 32-bit state *x*; returns the new state."""
    x ^= (x << 13) & U32_MAX
    x ^= x >> 17
    x ^= (x << 5) & U32_MAX
    return x


def mix32(h: int) -> int:
    """MurmurHash3's 32-bit finaliser (fmix32): a bijection of the 32-bit integers that maps 0 to 0 only."""
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & U32_MAX
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & U32_MAX
    h ^= h >> 16
    return h


def _u32(v: Any) -> int | None:
    """*v* as an integer from 1 to 2**32 - 1 (an int, or a float with an integer value), else ``None``."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and not v.is_integer():
        return None
    return int(v) if 1 <= v <= U32_MAX else None


class XorShift32:
    """The deterministic random numbers of the M1 recipes (the JS twin gives the same numbers).

    ``XorShift32(seed)`` starts from ``mix32(seed)``; ``XorShift32(state=x)`` from the raw state *x* (Marsaglia's
    stream).  Seeds and states are integers from 1 to 2**32 - 1 (``ValueError`` otherwise).
    """

    __slots__ = ("state",)

    def __init__(self, seed: int | None = None, *, state: int | None = None) -> None:
        if (seed is None) == (state is None):
            raise ValueError("xorshift32 needs a seed or a state")
        if state is not None:
            raw = _u32(state)
            if raw is None:
                raise ValueError("xorshift32 state must be an integer from 1 to 4294967295")
            self.state = raw
        else:
            s = _u32(seed)
            if s is None:
                raise ValueError("xorshift32 seed must be an integer from 1 to 4294967295")
            self.state = mix32(s)

    def next_u32(self) -> int:
        """The next number: the state after one more step, an integer from 1 to 2**32 - 1."""
        self.state = xorshift32_step(self.state)
        return self.state

    def take(self, count: int) -> list[int]:
        """The next *count* numbers."""
        return [self.next_u32() for _ in range(count)]

    def uniform(self) -> float:
        """The next number divided by 2**32: uniform in (0, 1), exact in float64."""
        return self.next_u32() / 4294967296.0


def noise_values(sigma: float, numbers: Sequence[int]) -> np.ndarray:
    """The displacements σ·√3·(2u − 1) (Å) for the generator outputs *numbers* (u = number / 2**32).

    ``amp = sigma * sqrt(3)`` is rounded once and ``2u − 1`` is exact, so each value is one rounding of
    ``amp * (2u − 1)``, as in JS.
    """
    u = np.array(numbers, dtype=np.float64) / 4294967296.0
    return float(sigma) * S3 * (2.0 * u - 1.0)


def uniform_noise(sigma: float, seed: int, count: int) -> np.ndarray:
    """*count* displacements from ``XorShift32(seed)``: uniform in (−σ√3, σ√3), standard deviation σ."""
    return noise_values(sigma, XorShift32(seed).take(count))


# --------------------------------------------------------------------------------------------- the face table
#: Fractions of the layer sites (computed as p / q divisions, like the JS table).
_O = (0.0, 0.0)
_H = (1 / 2, 1 / 2)


@dataclass(frozen=True)
class Face:
    """One recipe's geometry: the 1×1 surface mesh, the layer spacing and the sites of each layer of the stacking."""

    name: str
    label: str                                   # the name part after the element: "(111)", " graphene"
    lattice: tuple[str, ...]                     # the required lattice constants: ("a",) or ("a", "c")
    layered: bool                                # takes ``layers`` (False: one sheet)
    hexagonal: bool                              # takes ``gamma`` (120 or 60)
    mesh: Callable[[float, float, int], tuple[float, float, float, float]]   # (a, c, gamma) -> a1x, a2x, a2y, d
    sites: Callable[[int], tuple[tuple[tuple[float, float], ...], ...]]     # gamma -> sites of each stacking layer


def _fcc111_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    s = a / S2
    return s, (-(s / 2) if gamma == 120 else s / 2), s * S3 / 2, a / S3


def _fcc100_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    s = a / S2
    return s, 0.0, s, a / 2


def _fcc110_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    s = a / S2
    return s, 0.0, a, s / 2


def _hex_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    return a, (-(a / 2) if gamma == 120 else a / 2), a * S3 / 2, c / 2


def _bcc110_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    return a * S3 / 2, -(a * S3 / 6), a * S6 / 3, a / S2


def _graphene_mesh(a: float, c: float, gamma: int) -> tuple[float, float, float, float]:
    return a, (-(a / 2) if gamma == 120 else a / 2), a * S3 / 2, 0.0


FACES: dict[str, Face] = {f.name: f for f in (
    Face("fcc111", "(111)", ("a",), True, True, _fcc111_mesh,
         lambda g: ((_O,), ((2 / 3, 1 / 3),), ((1 / 3, 2 / 3),)) if g == 120
         else ((_O,), ((1 / 3, 1 / 3),), ((2 / 3, 2 / 3),))),
    Face("fcc100", "(100)", ("a",), True, False, _fcc100_mesh, lambda g: ((_O,), (_H,))),
    Face("fcc110", "(110)", ("a",), True, False, _fcc110_mesh, lambda g: ((_O,), (_H,))),
    Face("hcp0001", "(0001)", ("a", "c"), True, True, _hex_mesh,
         lambda g: ((_O,), ((2 / 3, 1 / 3),)) if g == 120 else ((_O,), ((1 / 3, 1 / 3),))),
    Face("bcc110", "(110)", ("a",), True, False, _bcc110_mesh, lambda g: ((_O,), (_H,))),
    Face("graphene", " graphene", ("a",), False, True, _graphene_mesh,
         lambda g: (((1 / 3, 2 / 3), (2 / 3, 1 / 3)),) if g == 120 else (((1 / 3, 1 / 3), (2 / 3, 2 / 3)),)),
)}
#: The recipe names, in registration order.
RECIPE_NAMES: tuple[str, ...] = tuple(FACES)

_COMMON = ("element", "a", "vacuum", "supercell", "z0", "tags", "fix", "noise", "delete", "name", "info")
_TOP = re.compile(r"top:([1-9][0-9]*)\Z")


# ------------------------------------------------------------------------------------------------ the builder
def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _whole(v: Any) -> bool:
    """An integer, or a float with an integer value (JSON ``2.0``; JS cannot tell the two apart)."""
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _allowed(face: Face) -> tuple[str, ...]:
    keys = list(_COMMON)
    if "c" in face.lattice:
        keys.append("c")
    if face.layered:
        keys.append("layers")
    if face.hexagonal:
        keys.append("gamma")
    return tuple(keys)


def slab(face: str, args: dict[str, Any] | None = None, /, **kw: Any) -> Structure:
    """Build the recipe *face* (``"fcc111"``, ...) from *args* (a dict as in a case file) or keyword arguments.

    See the module docstring for the arguments, the geometry and the atom order.  Raises ``ValueError`` with the same
    message as the JS twin (``recipe fcc111: missing arg vacuum``).
    """
    if face not in FACES:
        raise ValueError(f"unknown slab recipe {json.dumps(face)} (known: {', '.join(RECIPE_NAMES)})")
    f = FACES[face]
    name = f"recipe {face}"
    if args is None:
        args = dict(kw)
    elif kw:
        raise TypeError("give the recipe arguments as one dict or as keywords, not both")
    if not isinstance(args, dict):
        raise ValueError(f"{name}: the arguments must be an object")
    allowed = _allowed(f)
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for key in ("element", *f.lattice, *(("layers",) if f.layered else ()), "vacuum"):
        if key not in args:
            raise ValueError(f"{name}: missing arg {key}")

    element = args["element"]
    if not (isinstance(element, str) and is_element(element)):
        raise ValueError(f'{name}: element must be an element symbol such as "Pt"')
    for key in f.lattice:
        if not (_number(args[key]) and args[key] > 0.5):
            raise ValueError(f"{name}: {key} must be a number larger than 0.5 (Å)")
    a = float(args["a"])
    c = float(args["c"]) if "c" in f.lattice else 0.0
    layers = 1
    if f.layered:
        if not (_whole(args["layers"]) and args["layers"] >= 1):
            raise ValueError(f"{name}: layers must be a positive integer")
        layers = int(args["layers"])
    if not (_number(args["vacuum"]) and args["vacuum"] > 0):
        raise ValueError(f"{name}: vacuum must be a positive number (Å)")
    vacuum = float(args["vacuum"])
    gamma = 120
    if "gamma" in args:
        if not (_number(args["gamma"]) and args["gamma"] in (120, 60)):
            raise ValueError(f"{name}: gamma must be 120 or 60")
        gamma = int(args["gamma"])
    reps = [1, 1, 1]
    if "supercell" in args:
        sc = args["supercell"]
        if not (isinstance(sc, list) and len(sc) in (2, 3) and all(_whole(n) and n >= 1 for n in sc)):
            raise ValueError(f"{name}: supercell must be [n1, n2] or [n1, n2, n3] with positive integers")
        reps = [int(n) for n in sc] + ([1] if len(sc) == 2 else [])
    z0 = 0.0
    if "z0" in args:
        if not _number(args["z0"]):
            raise ValueError(f"{name}: z0 must be a number (Å)")
        z0 = float(args["z0"])
    tags = False
    if "tags" in args:
        if not isinstance(args["tags"], bool):
            raise ValueError(f"{name}: tags must be true or false")
        tags = args["tags"]
    fix: int | None = None
    if "fix" in args:
        if not (_whole(args["fix"]) and 0 <= args["fix"] <= layers):
            raise ValueError(f"{name}: fix must be an integer from 0 to {layers} (the number of layers)")
        fix = int(args["fix"])
    sigma, seed = 0.0, 1
    if "noise" in args:
        noise = args["noise"]
        if not (isinstance(noise, dict) and sorted(noise) == ["seed", "sigma"]):
            raise ValueError(f'{name}: noise must be {{"sigma": ..., "seed": ...}}')
        if not (_number(noise["sigma"]) and 0 <= noise["sigma"] <= 1):
            raise ValueError(f"{name}: noise sigma must be a number from 0 to 1 (Å)")
        s = _u32(noise["seed"])
        if s is None:
            raise ValueError(f"{name}: noise seed must be an integer from 1 to 4294967295")
        sigma, seed = float(noise["sigma"]), s
    if "name" in args and not (isinstance(args["name"], str) and args["name"]):
        raise ValueError(f"{name}: name must be a non-empty string")
    if "info" in args and not isinstance(args["info"], dict):
        raise ValueError(f"{name}: info must be an object")

    n1, n2, n3 = reps
    stacking = f.sites(gamma)
    per_layer = n1 * n2 * len(stacking[0])
    total = n3 * layers * per_layer
    if total > MAX_ATOMS:
        raise ValueError(f"{name}: {total} atoms are more than a recipe may build ({MAX_ATOMS})")
    deleted = _deleted(name, args.get("delete"), total, per_layer) if "delete" in args else np.zeros(0, dtype=np.int64)

    a1x, a2x, a2y, d = f.mesh(a, c, gamma)
    cz = (layers - 1) * d + vacuum
    positions = np.empty((total, 3), dtype=np.float64)
    # the in-plane positions of one layer, for each layer of the stacking: (i + u)·a1x + (j + v)·a2x, (j + v)·a2y
    planes = []
    for sites in stacking:
        ns = len(sites)
        fu = np.repeat(np.arange(n1), n2 * ns) + np.tile(np.array([s[0] for s in sites]), n1 * n2)
        fv = np.tile(np.repeat(np.arange(n2), ns), n1) + np.tile(np.array([s[1] for s in sites]), n1 * n2)
        planes.append((fu * a1x + fv * a2x, fv * a2y))
    row = 0
    layer_of = np.empty(total, dtype=np.int64)
    for m in range(n3):
        for k in range(layers):
            x, y = planes[k % len(stacking)]
            positions[row:row + per_layer, 0] = x
            positions[row:row + per_layer, 1] = y
            positions[row:row + per_layer, 2] = z0 + k * d + m * cz
            layer_of[row:row + per_layer] = k
            row += per_layer
    if sigma > 0:
        flat = positions.reshape(-1)
        flat += uniform_noise(sigma, seed, flat.size)

    props: dict[str, Any] = {}
    if tags:
        props["tags"] = [layers - int(k) for k in layer_of]
    if fix is not None:
        props["selective_dynamics"] = [[False] * 3 if k < fix else [True] * 3 for k in layer_of]
    keep = np.ones(total, dtype=bool)
    keep[deleted] = False
    if not keep.all():
        positions = positions[keep]
        props = {key: [v for v, kept in zip(vals, keep) if kept] for key, vals in props.items()}

    if "name" in args:
        title = args["name"]
    else:
        mesh = "" if (n1, n2) == (1, 1) else f" p({n1}×{n2})"
        title = f"{element}{f.label}{mesh}" + (f" {layers}L" if f.layered else "") + (f" ×{n3}" if n3 > 1 else "")
    cell = [[n1 * a1x, 0.0, 0.0], [n2 * a2x, n2 * a2y, 0.0], [0.0, 0.0, n3 * cz]]
    return Structure([element] * int(keep.sum()), positions, cell=cell, pbc=[True, True, True], props=props,
                     info=copy.deepcopy(args.get("info") or {}), name=title)


def _deleted(name: str, spec: Any, total: int, per_layer: int) -> np.ndarray:
    """The atom indices that ``delete`` removes (sorted)."""
    if isinstance(spec, str):
        m = _TOP.match(spec)
        if m is None:
            raise ValueError(f'{name}: delete must be "top:N" or a list of atom indices')
        n = int(m.group(1))
        if n > per_layer:
            raise ValueError(f"{name}: delete top:{n} removes more atoms than the top layer has ({per_layer})")
        idx = list(range(total - n, total))
    elif isinstance(spec, list):
        if not all(_whole(i) and 0 <= i < total for i in spec):
            raise ValueError(f"{name}: delete must list atom indices from 0 to {total - 1}")
        idx = [int(i) for i in spec]
        seen: set[int] = set()
        for i in idx:
            if i in seen:
                raise ValueError(f"{name}: delete lists atom {i} twice")
            seen.add(i)
    else:
        raise ValueError(f'{name}: delete must be "top:N" or a list of atom indices')
    if len(idx) >= total:
        raise ValueError(f"{name}: delete removes every atom")
    return np.array(sorted(idx), dtype=np.int64)


# ---------------------------------------------------------------------------------------------- exact digests
def canonical_text(value: Any) -> str:
    """*value* (JSON-like: dicts, lists, numpy arrays, numbers, strings) as text that both languages write alike.

    Keys sorted, no spaces; integers (other than -0.0) below 2**53 in decimal, every other number as the string
    ``"f<16 hex digits>"`` of its big-endian float64 bits; strings as JSON.
    """
    if isinstance(value, np.ndarray):
        value = value.tolist()
    elif isinstance(value, np.generic):
        value = value.item()
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value) if abs(value) < 2 ** 53 else _float_text(float(value))
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 2 ** 53 and not (value == 0 and math.copysign(1.0, value) < 0):
            return str(int(value))
        return _float_text(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_text(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + canonical_text(value[k])
                              for k in sorted(value, key=str)) + "}"
    raise TypeError(f"cannot write {type(value).__name__} as canonical text")


def _float_text(x: float) -> str:
    return '"f' + struct.pack(">d", x).hex() + '"'


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def structure_digest(s: Structure) -> dict[str, str | None]:
    """SHA-256 digests of *s*: ``positions`` and ``cell`` (``None`` without one) of their little-endian float64
    bytes, row by row; ``symbols`` and ``props`` of :func:`canonical_text`.  The JS twin gives the same digests for
    the same structure, so equal digests mean bit-identical structures."""
    return {
        "symbols": _sha256(canonical_text(list(s.symbols)).encode("utf-8")),
        "positions": _sha256(np.ascontiguousarray(s.positions, dtype="<f8").tobytes()),
        "cell": None if s.cell is None else _sha256(np.ascontiguousarray(s.cell, dtype="<f8").tobytes()),
        "props": _sha256(canonical_text(s.props).encode("utf-8")),
    }
