"""Cleaving surfaces and the slab tools (M2): new slabs from a bulk crystal, and tools for existing slabs.

``surface(bulk, miller, vacuum=...)`` cleaves a crystal along (hkl) or (h k i l) and returns a new slab (pbc
T T T, a along x, c perpendicular to the surface and along z, the vacuum along c); ``surface_analysis`` and
``terminations`` describe the surface first (surface cell, atomic layers, inequivalent terminations, broken bonds,
polarity and Tasker type); ``set_vacuum``, ``add_vacuum``, ``center_slab`` and ``flip_slab`` change an existing slab
in place (methods of :class:`~facet.core.structure.Structure`), and ``slab_report``, ``surface_top`` and
``standardize_slab`` read or prepare one.  Everything is computed in Python with numpy; the web app has the same
algorithms in ``facet/web/js/build/surface.js`` (same names in camelCase, same results; design brief P1).

``vacuum`` is always the total gap between the slab and its periodic image along the surface normal, in Å
(0 = no vacuum: the slab repeats as in the bulk), never per side as in ASE ``surface()`` or
``Structure.center(vacuum=)``; it is required and has no default (user decision U4).

The module is written by several tasks, each inside its own segment, between ``# --- surface-modeling <name> ---``
and ``# --- end <name> ---``; each segment brings its own imports and adds its public names to ``__all__`` itself
(plan.md §2.2):

- ``M2-T2`` -- the formal oxidation states (M2 §3.9.1): :func:`load_oxidation_states` and
  :func:`estimate_oxidation_states`, from the shared table ``facet/web/data/oxidation_states.json``;
- ``M2-T3`` -- the cleave analysis: ``surface_analysis``, ``SurfaceAnalysis``, ``terminations`` (M2 §3.2-3.9);
- ``M2-T3b`` -- surface coordination and exposed layers of each termination (M2 §3.8);
- ``M2-T4`` -- the slab: ``surface``, ``estimate_surface_atoms``, ``oriented_cell`` (M2 §3.10-3.13, §3.16, §4);
- ``M2-T5`` -- tools for existing structures: ``slab_report``, ``surface_top``, ``standardize_slab`` and the
  ``Structure`` methods they share (M2 §3.14, §3.15, §6.1.1).

``facet.build`` exports the public names (M2-T4); it then also has a function ``surface`` with the name of this
module, so import module-level names with ``from facet.build.surface import ...`` or from
``facet.build`` itself, never as ``facet.build.surface.<name>``.
"""

from __future__ import annotations

__all__: list[str] = []

# --- surface-modeling M2-T2 ---
import math
import numbers
from collections.abc import Iterable, Mapping
from functools import lru_cache
from typing import Any

from ..core.elements import METALS, electronegativity, is_element
from ..core.webdata import load_web_data

__all__ += ["load_oxidation_states", "estimate_oxidation_states"]

#: The shared table of formal oxidation states (written by scripts/gen_oxidation_states.py).
_OXIDATION_FILE = "oxidation_states.json"
_OXIDATION_SCHEMA = "facet.oxidation-states/1"
#: Elements of the anion table within this much (Pauling) of the most electronegative element are anions.
_ANION_WINDOW = 0.6
#: Slack of the electronegativity comparisons (the values have two decimals).
_EN_SLACK = 1e-9


def load_oxidation_states() -> dict[str, Any]:
    """The formal oxidation-state table of the cleave tool (M2 §3.9.1), read synchronously.

    The table is ``facet/web/data/oxidation_states.json``, the copy the web app loads too (through
    :func:`facet.core.webdata.load_web_data`): ``{"schema": "facet.oxidation-states/1", "source",
    "anions": {element: charge}, "cations": {element: [valence, ...]}}``, cation valences in order of preference.
    Returns a deep copy; a malformed table raises ``ValueError``.  :func:`estimate_oxidation_states` reads the table
    by itself (once per process), so calling this first is never needed.
    """
    _oxidation_table()
    return load_web_data(_OXIDATION_FILE)


def estimate_oxidation_states(symbols: Iterable[str] | Mapping[str, int], *,
                              charges: Mapping[str, float] | None = None) -> dict[str, float] | None:
    """Formal charge of each element of a composition, or ``None`` when it cannot be estimated (M2 §3.9.1).

    *symbols* is a list of element symbols (one per atom, e.g. ``structure.symbols``) or a mapping of element to
    count (``{"Sr": 1, "Ti": 1, "O": 3}``).  The rules, the same in the web app (``estimateOxidationStates``):

    * only metals (``facet.core.elements.METALS``), or a single element: every charge is 0 (no ionic charges);
    * the anions are the elements of the table's anion list within 0.6 (Pauling) of the most electronegative element
      (O and N in TaON, O and Cl in BiOCl; C is a cation in CaCO3, H in Ca(OH)2), each with its anion charge; the
      other elements are cations;
    * the cation valences come from the table: the first combination in order of preference (the cations in formula
      order, see below) that makes the formula neutral (SrTiO3: Sr +2, Ti +4, O -2; TiH2: Ti +2, H -1);
    * when none does, each cation's first valence is scaled so that the charges add up to zero (Fe3O4: Fe +2.67);
    * ``None`` (unknown) when the most electronegative element has no anion charge, an element has no Pauling
      electronegativity (He, Ne, Ar, X), a cation is not in the table, or every element is an anion.

    *charges* gives the charges instead (``{"Sr": 2, "Ti": 4, "O": -2}``): it must give every element of the
    composition (``charges must give every element: missing O``); other elements in it are ignored.  The result has
    the elements in formula order (Pauling electronegativity, then symbol), charges as floats.

    Example::

        estimate_oxidation_states(["Sr", "Ti", "O", "O", "O"])   # {'Sr': 2.0, 'Ti': 4.0, 'O': -2.0}
        estimate_oxidation_states({"Fe": 3, "O": 4})             # {'Fe': 2.6666666666666665, 'O': -2.0}
        estimate_oxidation_states(["Pt", "Ti"])                  # {'Ti': 0.0, 'Pt': 0.0}
    """
    return _formal_charges(symbols, charges=charges)["charges"]


def _formal_charges(symbols: Iterable[str] | Mapping[str, int], *,
                    charges: Mapping[str, float] | None = None) -> dict[str, Any]:
    """:func:`estimate_oxidation_states` with where the charges come from, for the cleave analysis (internal).

    Returns ``{"charges": dict | None, "source": str, "notes": [str]}``; ``source`` is ``"user"`` (*charges* given),
    ``"metal"`` (only metals), ``"element"`` (one element that is not a metal), ``"formal"`` (a neutral combination
    of the table's valences), ``"averaged"`` (scaled first valences; ``notes`` holds the note W11,
    ``formal charges were averaged (Fe +2.67)``) or ``"unknown"`` (charges None).  The web app's ``formalCharges``
    gives the same, word for word.
    """
    counts = _composition(symbols)
    elements = sorted(counts, key=_formula_key)
    if charges is not None:
        return {"charges": _given_charges(elements, charges), "source": "user", "notes": []}
    anion_charge, valences = _oxidation_table()
    if all(e in METALS for e in elements):
        return {"charges": {e: 0.0 for e in elements}, "source": "metal", "notes": []}
    if len(elements) == 1:
        return {"charges": {elements[0]: 0.0}, "source": "element", "notes": []}
    unknown: dict[str, Any] = {"charges": None, "source": "unknown", "notes": []}
    en = {e: _pauling(e) for e in elements}
    if any(v is None for v in en.values()):
        return unknown
    en_max = max(en.values())
    if not any(e in anion_charge for e in elements if en[e] >= en_max - _EN_SLACK):
        return unknown
    anions = [e for e in elements if e in anion_charge and en[e] >= en_max - _ANION_WINDOW - _EN_SLACK]
    cations = [e for e in elements if e not in anions]
    if not cations or any(e not in valences for e in cations):
        return unknown
    need = -sum(counts[e] * anion_charge[e] for e in anions)
    states = _neutral_valences([counts[e] for e in cations], [valences[e] for e in cations], need)
    notes: list[str] = []
    if states is not None:
        cation_charge = {e: float(v) for e, v in zip(cations, states)}
        source = "formal"
    else:
        first = [valences[e][0] for e in cations]
        total = sum(counts[e] * v for e, v in zip(cations, first))
        cation_charge = {e: v * need / total for e, v in zip(cations, first)}
        source = "averaged"
        notes.append("formal charges were averaged ("
                     + ", ".join(f"{e} {_signed_charge(cation_charge[e])}" for e in cations) + ")")
    out = {e: cation_charge[e] if e in cation_charge else float(anion_charge[e]) for e in elements}
    return {"charges": out, "source": source, "notes": notes}


@lru_cache(maxsize=1)
def _oxidation_table() -> tuple[dict[str, int], dict[str, tuple[int, ...]]]:
    """The checked table, read once per process: (anion charges, cation valences)."""
    return _check_oxidation_table(load_web_data(_OXIDATION_FILE))


def _check_oxidation_table(table: Any) -> tuple[dict[str, int], dict[str, tuple[int, ...]]]:
    """(anion charges, cation valences) of an oxidation-state table; ``ValueError`` (the web app's text) if malformed."""
    if not isinstance(table, dict) or table.get("schema") != _OXIDATION_SCHEMA:
        raise ValueError(f"{_OXIDATION_FILE} is not a {_OXIDATION_SCHEMA} table")
    anions_in, cations_in = table.get("anions"), table.get("cations")
    if not isinstance(anions_in, dict) or not isinstance(cations_in, dict):
        raise ValueError(f"{_OXIDATION_FILE} needs the objects anions and cations")
    anions: dict[str, int] = {}
    for e, q in anions_in.items():
        if not _whole(q) or q >= 0:
            raise ValueError(f"{_OXIDATION_FILE}: anions.{e} must be a negative whole number")
        anions[e] = int(q)
    cations: dict[str, tuple[int, ...]] = {}
    for e, qs in cations_in.items():
        if (not isinstance(qs, list) or not qs or any(not _whole(q) or q <= 0 for q in qs)
                or len(set(qs)) != len(qs)):
            raise ValueError(f"{_OXIDATION_FILE}: cations.{e} must be a list of distinct positive whole numbers")
        cations[e] = tuple(int(q) for q in qs)
    return anions, cations


def _whole(x: Any) -> bool:
    """A whole number (an int, or a float with an integer value: JSON and JavaScript cannot tell them apart)."""
    return (isinstance(x, numbers.Real) and not isinstance(x, bool) and math.isfinite(x)
            and float(x).is_integer())


def _composition(symbols: Any) -> dict[str, int]:
    """Element -> number of atoms of a list of symbols or a mapping of counts (zero counts are left out)."""
    if isinstance(symbols, str) or not isinstance(symbols, (Mapping, Iterable)):
        raise TypeError("symbols must be a list of element symbols or a mapping of counts")
    counts: dict[str, int] = {}
    if isinstance(symbols, Mapping):
        for key, n in symbols.items():
            e = str(key)
            if not _whole(n) or n < 0:
                raise ValueError(f"the count of {e} must be a whole number")
            if n:
                counts[e] = counts.get(e, 0) + int(n)
        return counts
    for s in symbols:
        counts[str(s)] = counts.get(str(s), 0) + 1
    return counts


def _pauling(e: str) -> float | None:
    """The Pauling electronegativity of the element symbol *e* exactly as written (no normalisation), or None."""
    return electronegativity(e) if is_element(e) else None


def _formula_key(e: str) -> tuple[float, str]:
    """The formula order: Pauling electronegativity (2.0 when it has none), then the symbol."""
    en = _pauling(e)
    return (2.0 if en is None else en, e)


def _given_charges(elements: list[str], charges: Any) -> dict[str, float]:
    if not isinstance(charges, Mapping):
        raise TypeError("charges must be a mapping of element symbols to charges")
    missing = [e for e in elements if e not in charges]
    if missing:
        raise ValueError(f"charges must give every element: missing {', '.join(missing)}")
    out: dict[str, float] = {}
    for e in elements:
        q = charges[e]
        if not isinstance(q, numbers.Real) or isinstance(q, bool) or not math.isfinite(q):
            raise ValueError(f"the charge given for {e} is not a finite number")
        out[e] = float(q)
    return out


def _neutral_valences(counts: list[int], options: list[tuple[int, ...]], need: int) -> list[int] | None:
    """The first valence combination, in order of preference, with ``sum(count * valence) == need``, or None.

    Combinations are ordered lexicographically by the position of each valence in its list (the first list varies
    slowest), as ``itertools.product`` would list them; the sets of sums the remaining cations can still reach
    (at most *need* + 1 values each) keep the search linear in the number of cations.
    """
    reach: list[set[int]] = [set() for _ in range(len(options) + 1)]
    reach[-1] = {0}
    for i in range(len(options) - 1, -1, -1):
        sums = (counts[i] * v + r for v in options[i] for r in reach[i + 1])
        reach[i] = {s for s in sums if s <= need}
    if need not in reach[0]:
        return None
    chosen: list[int] = []
    for i, vs in enumerate(options):
        v = next(v for v in vs if need - counts[i] * v in reach[i + 1])
        chosen.append(v)
        need -= counts[i] * v
    return chosen


def _signed_charge(q: float) -> str:
    """``+2.67``: *q* with its sign and two decimals, rounded half up as ``format_decimal`` rounds (ledger L-M1-15)."""
    s = math.floor(abs(q) * 100 + 0.5)
    text = f"{s // 100}.{s % 100:02d}"
    return text if s == 0 else ("+" if q > 0 else "-") + text
# --- end M2-T2 ---

# --- surface-modeling M2-T3 ---
import numpy as np

from ..core.defaults import SURFACE_DEFAULTS
from ..core.elements import ANIONS, covalent_radius
from ..core.intmath import egcd
from ..core.lattice import is_hexagonal_cell
from ..core.params import coerce_param
from ..core.structure import Structure

__all__ += ["SurfaceAnalysis", "surface_analysis", "terminations", "conventional_cell_hint"]

_AXIS_NAMES = "abc"
_MIDDOT = "·"
_TIMES = "×"


# ------------------------------------------------------------------------------------ small vector helpers
# Plain lists of floats and explicit sums, written the same way as the web module (`build/surface.js`), so that
# both languages run the same floating-point operations in the same order.
def _dot(a: Any, b: Any) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Any, b: Any) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a: Any) -> float:
    return math.sqrt(_dot(a, a))


def _sub(a: Any, b: Any) -> list[float]:
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _comb(coeffs: Any, rows: Any) -> list[float]:
    """``coeffs @ rows``: the combination ``sum(coeffs[i] * rows[i])`` of three row vectors."""
    return [coeffs[0] * rows[0][k] + coeffs[1] * rows[1][k] + coeffs[2] * rows[2][k] for k in range(3)]


def _det3f(m: Any) -> float:
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _inv3f(m: Any) -> list[list[float]]:
    d = _det3f(m)
    return [[(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d,
             (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d],
            [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d,
             (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d],
            [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d,
             (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d]]


def _wrap01(x: float) -> float:
    w = x - math.floor(x)
    return 0.0 if w >= 1.0 - 1e-9 else w


def _idet3(m: Any) -> int:
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _iadj3(m: Any) -> list[list[int]]:
    return [[m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2],
             m[0][1] * m[1][2] - m[0][2] * m[1][1]],
            [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0],
             m[0][2] * m[1][0] - m[0][0] * m[1][2]],
            [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1],
             m[0][0] * m[1][1] - m[0][1] * m[1][0]]]


def _gcd3(v: Any) -> int:
    return math.gcd(math.gcd(abs(int(v[0])), abs(int(v[1]))), abs(int(v[2])))


def _r6(x: float) -> float:
    """*x* rounded half up to 6 decimals (the values ``info.surface`` stores, ledger L-X-01); never ``-0.0``."""
    v = math.floor(abs(x) * 1e6 + 0.5) / 1e6
    return v if x >= 0 or v == 0 else -v


def _fmt2(x: float) -> str:
    """Two decimals, halves up: ``1.07``, ``-0.50``."""
    s = math.floor(abs(x) * 100 + 0.5)
    text = f"{s // 100}.{s % 100:02d}"
    return text if x >= 0 or s == 0 else "-" + text


def _num(x: float) -> str:
    """A number in a message: ``15`` for 15.0, ``1.5`` for 1.5 (the shortest text, as JavaScript writes it)."""
    x = float(x)
    return str(int(x)) if x.is_integer() and abs(x) < 1e15 else repr(x)


def _count(n: int) -> str:
    return f"{int(n):,}"


def _comp_formula(comp: Mapping[str, int]) -> str:
    """``Ti2O2``: the elements in formula order (Pauling electronegativity, then symbol), counts above 1 written."""
    return "".join(f"{e}{n if n != 1 else ''}" for e, n in sorted(comp.items(), key=lambda kv: _formula_key(kv[0])))


def _reduced(comp: Mapping[str, int]) -> dict[str, int]:
    g = 0
    for n in comp.values():
        g = math.gcd(g, int(n))
    return {e: int(n) // g for e, n in comp.items()} if g else dict(comp)


def _counts(symbols: Iterable[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in symbols:
        out[s] = out.get(s, 0) + 1
    return out


def _miller_token(idx: Any) -> str:
    """``(111)``, ``(10-10)``; indices above 9 are spaced: ``(1 1 12)``."""
    sep = "" if all(abs(x) <= 9 for x in idx) else " "
    return "(" + sep.join(str(int(x)) for x in idx) + ")"


def _miller_spaced(idx: Any) -> str:
    return "(" + " ".join(str(int(x)) for x in idx) + ")"


# ------------------------------------------------------------------------------------ integer bases of a plane
def _plane_basis(hkl: Any, handedness: int) -> list[list[int]]:
    """Integer rows ``[v1, v2, v3]`` with ``v1·hkl = v2·hkl = 0``, ``v3·hkl = 1`` and ``det = handedness`` (M2 §3.3).

    *hkl* are coprime integers.  ``v1`` and ``v2`` span the lattice plane (hkl) and ``v3`` is one stacking step, so
    with ``det(cell) · handedness > 0`` the vectors ``v1 @ cell``, ``v2 @ cell``, ``v3 @ cell`` are right-handed
    and ``a × b`` points to the +hkl side: the top of a slab is the (hkl) face, never its mirror image.
    """
    h, k, l = (int(x) for x in hkl)
    g, p, q = egcd(k, l)
    if g == 0:
        v1, v2, v3 = [0, 1, 0], [0, 0, 1], [h, 0, 0]
    else:
        _, x, y = egcd(g, h)
        v1, v2, v3 = [g, -p * h, -q * h], [0, l // g, -k // g], [y, x * p, x * q]
    if _idet3([v1, v2, v3]) != handedness:
        v1 = [-t for t in v1]
    return [v1, v2, v3]


def _gauss_reduce_2d(a: Any, b: Any) -> tuple[list[float], list[float], list[list[int]]]:
    """The reduced in-plane basis ``(u, v, M)`` of the net spanned by *a* and *b*: ``[u; v] = M @ [a; b]``, det M = 1.

    Gauss reduction, then the obtuse convention: γ from 90° to 120°.  At the tie ``|u·v| = |u|²/2`` (a hexagonal
    60° pair, and every centred rectangular net) u is kept and v becomes ``v - u``; any other acute pair becomes
    ``(v, -u)``; u then points along *a* rather than against it.  The handedness of the pair is kept.
    """
    tau = SURFACE_DEFAULTS.gauss_tolerance
    u, v = [float(x) for x in a], [float(x) for x in b]
    M = [[1, 0], [0, 1]]
    for _ in range(10000):
        if _dot(u, u) > _dot(v, v) * (1 + tau):
            u, v = v, [-u[0], -u[1], -u[2]]
            M = [M[1], [-M[0][0], -M[0][1]]]
        x = _dot(u, v) / _dot(u, u)
        mu = 0
        if abs(x) > 0.5 + tau:
            mu = int(math.floor(abs(x) + 0.5 - tau))
            if x < 0:
                mu = -mu
        if mu == 0:
            break
        v = [v[0] - mu * u[0], v[1] - mu * u[1], v[2] - mu * u[2]]
        M = [M[0], [M[1][0] - mu * M[0][0], M[1][1] - mu * M[0][1]]]
    d = _dot(u, v)
    if d > tau * math.sqrt(_dot(u, u)) * math.sqrt(_dot(v, v)):
        if abs(d) >= _dot(u, u) / 2 * (1 - 1e-6):
            v = [v[0] - u[0], v[1] - u[1], v[2] - u[2]]
            M = [M[0], [M[1][0] - M[0][0], M[1][1] - M[0][1]]]
        else:
            u, v = v, [-u[0], -u[1], -u[2]]
            M = [M[1], [-M[0][0], -M[0][1]]]
    cu = _dot(u, a) / math.sqrt(_dot(u, u) * _dot(a, a))
    cv = _dot(v, b) / math.sqrt(_dot(v, v) * _dot(b, b))
    if cu < -tau or (abs(cu) <= tau and cv < -tau):
        u, v = [-u[0], -u[1], -u[2]], [-v[0], -v[1], -v[2]]
        M = [[-M[0][0], -M[0][1]], [-M[1][0], -M[1][1]]]
    return u, v, M


def _angle_deg(u: Any, v: Any) -> float:
    c = _dot(u, v) / (_norm(u) * _norm(v))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _mesh_kind(u: Any, v: Any, rel: float, deg: float) -> str:
    la, lb = _norm(u), _norm(v)
    gamma = _angle_deg(u, v)
    same = abs(la - lb) <= rel * max(la, lb)
    if same and abs(gamma - 120.0) <= deg:
        return "hexagonal"
    if abs(gamma - 90.0) <= deg:
        return "square" if same else "rectangular"
    if same or abs(2 * abs(_dot(u, v)) - la * la) <= rel * la * la:
        return "centred-rectangular"
    return "oblique"


def _mesh_type(u: Any, v: Any) -> str:
    """``hexagonal``, ``square``, ``rectangular``, ``centred-rectangular`` or ``oblique`` for a reduced pair: within
    1e-3 (relative) and 0.1°, and for the last two also within 3 % and 2° (a slightly distorted net keeps its name)."""
    kind = _mesh_kind(u, v, 1e-3, 0.1)
    if kind in ("centred-rectangular", "oblique"):
        wide = _mesh_kind(u, v, 0.03, 2.0)
        if wide in ("hexagonal", "square", "rectangular"):
            return wide
    return kind


def _lateral(v: Any, n: Any) -> list[float]:
    d = _dot(v, n)
    return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]


def _solve2(a1: Any, b1: Any, w: Any) -> tuple[float, float]:
    """The coordinates of the in-plane vector *w* in the basis (a1, b1)."""
    aa, ab, bb = _dot(a1, a1), _dot(a1, b1), _dot(b1, b1)
    wa, wb = _dot(w, a1), _dot(w, b1)
    det = aa * bb - ab * ab
    return (wa * bb - wb * ab) / det, (wb * aa - wa * ab) / det


def _mic2d(w: Any, a1: Any, b1: Any) -> float:
    """The shortest length of ``w + i·a1 + j·b1`` (w in the plane of the reduced pair a1, b1)."""
    f0, f1 = _solve2(a1, b1, w)
    i0, j0 = math.floor(f0 + 0.5), math.floor(f1 + 0.5)
    best = math.inf
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            x = [w[k] - (i0 + di) * a1[k] - (j0 + dj) * b1[k] for k in range(3)]
            best = min(best, _norm(x))
    return best


# ------------------------------------------------------------------------------------ the primitive cell
def _primitive_reduction(symbols: list[str], frac: list[list[float]], cell: list[list[float]],
                         tol: float) -> dict[str, Any] | None:
    """The primitive cell of a crystal given in a larger cell, or ``None`` when the cell is already primitive.

    The pure translations of the structure are searched among the vectors from the first atom of its rarest
    element to the other atoms of that element; each must map every atom onto an atom of the same element within
    *tol* Å.  The m - 1 translations found are snapped to multiples of 1/m, the three shortest lattice vectors
    with the right volume make the new cell (same handedness as the input) and ``M`` is the integer matrix with
    ``cell = M @ primitive``.  Returns ``{"cell", "M", "points", "keep"}`` (``keep``: one input atom per primitive
    site, in input order).  Raises ``ValueError`` when the translations do not form a lattice.
    """
    n = len(symbols)
    by_el: dict[str, list[int]] = {}
    for i, s in enumerate(symbols):
        by_el.setdefault(s, []).append(i)
    order = sorted(by_el, key=lambda e: (len(by_el[e]), by_el[e][0]))
    rare = by_el[order[0]]
    if len(rare) < 2:
        return None
    C = np.array(cell, dtype=float)
    F = np.array(frac, dtype=float)
    tol2 = tol * tol
    groups = [np.array(by_el[e], dtype=int) for e in order]

    def maps(t: np.ndarray) -> bool:
        for idx in groups:
            A = F[idx]
            D = A[:, None, :] + t[None, None, :] - A[None, :, :]
            D -= np.floor(D + 0.5)
            R = D @ C
            if not bool(np.all(np.min(np.einsum("ijk,ijk->ij", R, R), axis=1) < tol2)):
                return False
        return True

    found: list[list[float]] = []
    f0 = frac[rare[0]]
    for j in rare[1:]:
        t = [_wrap01(frac[j][k] - f0[k]) for k in range(3)]
        if maps(np.array(t)):
            found.append(t)
    if not found:
        return None
    m = len(found) + 1
    if n % m:
        raise ValueError(f"{m - 1} translations do not divide the {n} atoms")
    # exact translations: multiples of 1/m, as integer numerators K over m
    nums = [[0, 0, 0]]
    for t in found:
        K = [int(math.floor(t[k] * m + 0.5)) % m for k in range(3)]
        d = [t[k] - K[k] / m for k in range(3)]
        d = [x - math.floor(x + 0.5) for x in d]
        if _norm(_comb(d, cell)) > tol:
            raise ValueError("a translation is not a simple fraction of the cell")
        nums.append(K)
    cands = []
    for K in nums:
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    v = [K[0] + i * m, K[1] + j * m, K[2] + k * m]
                    if v[0] == 0 and v[1] == 0 and v[2] == 0:
                        continue
                    r = _comb([v[0] / m, v[1] / m, v[2] / m], cell)
                    cands.append((int(math.floor(_dot(r, r) * 1e6 + 0.5)), -v[0], -v[1], -v[2]))
    cands.sort()
    vecs = [[-c[1], -c[2], -c[3]] for c in cands]
    v1 = vecs[0]
    v2 = next((v for v in vecs if any(x != 0 for x in _cross(v1, v))), None)
    v3 = None
    if v2 is not None:
        for v in vecs:
            d = _idet3([v1, v2, v])
            if abs(d) == m * m:
                v3 = v if d > 0 else [-v[0], -v[1], -v[2]]
                break
    if v3 is None:
        raise ValueError("no primitive cell was found among the translations")
    K3 = [v1, v2, v3]
    adj = _iadj3(K3)
    if any(x % m for row in adj for x in row):
        raise ValueError("the translations do not form a lattice")
    M = [[x // m for x in row] for row in adj]                 # cell = M @ primitive
    P = [_comb([v[0] / m, v[1] / m, v[2] / m], cell) for v in K3]
    # one atom per primitive site
    FP = F @ np.array(M, dtype=float)
    FP -= np.floor(FP)
    Pn = np.array(P, dtype=float)
    keep: list[int] = []
    kept_by_el: dict[str, list[int]] = {}
    lim2 = (2 * tol) * (2 * tol)
    for i in range(n):
        mine = kept_by_el.setdefault(symbols[i], [])
        if mine:
            D = FP[mine] - FP[i]
            D -= np.floor(D + 0.5)
            R = D @ Pn
            if bool(np.any(np.einsum("ij,ij->i", R, R) < lim2)):
                continue
        mine.append(i)
        keep.append(i)
    if len(keep) * m != n:
        raise ValueError(f"{len(keep)} sites were found where {n // m} were expected")
    return {"cell": P, "M": M, "points": m, "keep": keep}


# ------------------------------------------------------------------------------------ bonds
def _bonds_and_dmin(symbols: list[str], cart: list[list[float]], cell: list[list[float]]) -> tuple[list[tuple], float]:
    """Every bond of the periodic crystal once, ``(i, j, v)`` with ``v = r_j + image - r_i``, and the shortest
    distance between two atoms.  A pair is bonded when its distance lies between ``bond_min`` and
    ``min(bond_max, bond_scale · (r_i + r_j))`` (covalent radii); a metal–metal pair is left out when both metals
    also bond to a non-metal anion (the "smart" rule of the bond display)."""
    D = SURFACE_DEFAULTS
    n = len(symbols)
    els = sorted(set(symbols))
    cov = {e: covalent_radius(e) for e in els}
    cut_max = max(min(D.bond_max, D.bond_scale * (cov[a] + cov[b])) for a in els for b in els)
    vol = abs(_det3f(cell))
    reach = []
    for k in range(3):
        area = _norm(_cross(cell[(k + 1) % 3], cell[(k + 2) % 3]))
        reach.append(int(math.ceil(cut_max / (vol / area))) + 1)
    R = np.array(cart, dtype=float)
    radii = np.array([cov[s] for s in symbols], dtype=float)
    edges: list[tuple[int, int, list[float]]] = []
    d_min = math.inf
    for la in range(-reach[0], reach[0] + 1):
        for lb in range(-reach[1], reach[1] + 1):
            for lc in range(-reach[2], reach[2] + 1):
                shift = np.array(_comb([la, lb, lc], cell))
                positive = (la, lb, lc) > (0, 0, 0)
                for i in range(n):
                    j0 = i if positive else i + 1          # the pair (i, i) only with an image "after" the origin
                    if j0 >= n:
                        continue
                    V = R[j0:] + shift - R[i]
                    dist = np.sqrt(np.einsum("ij,ij->i", V, V))
                    if dist.size:
                        d_min = min(d_min, float(dist.min()))
                    cut = np.minimum(D.bond_max, D.bond_scale * (radii[i] + radii[j0:]))
                    for t in np.nonzero((dist > D.bond_min) & (dist < cut))[0]:
                        edges.append((i, j0 + int(t), [float(x) for x in V[t]]))
    nonmetal = {e for e in ANIONS if e not in METALS}
    tied = set()
    for i, j, _ in edges:
        if symbols[i] in METALS and symbols[j] in nonmetal:
            tied.add(i)
        if symbols[j] in METALS and symbols[i] in nonmetal:
            tied.add(j)
    bonds = [(i, j, v) for i, j, v in edges
             if not (symbols[i] in METALS and symbols[j] in METALS and i in tied and j in tied)]
    return bonds, d_min


# ------------------------------------------------------------------------------------ the analysis
class SurfaceAnalysis:
    """What cleaving a crystal along one lattice plane gives: the result of :func:`surface_analysis`.

    Attributes (lengths in Å, angles in degrees):

    - ``miller`` (three coprime integers of the input cell), ``miller_input`` (as given), ``miller_basis``, ``hkil``
      (four indices when the input cell, or its conventional cell, is hexagonal with γ = 120°, else ``None``),
      ``conventional`` and ``miller_conventional`` (:func:`conventional_cell_hint` and the indices in that cell, or
      ``None``), ``normal`` (unit vector, Cartesian);
    - ``mesh``: the surface cell ``{"a", "b", "gamma", "area", "type"}``; ``period``: the height of one stacking
      period; ``layers_per_period``;
    - ``layers``: the atomic layers of one period, bottom to top, each ``{"index", "composition", "formula",
      "z", "min", "max", "gapAbove", "charge", "atoms"}``;
    - ``cuts``: one per gap between two layers, ``{"index", "layer", "z", "gap", "brokenBonds", "dipole", "polar",
      "termination"}`` (``layer``: the layer just below the cut, the top layer of a slab cut there);
    - ``terminations``: the inequivalent cuts, best first, each ``{"index", "label", "cut", "cuts", "composition",
      "below", "brokenBonds", "polar"}``; ``tasker`` (1, 2, 3 or ``None`` when the charges are unknown);
    - ``charges``, ``charges_source``, ``layer_tolerance``, ``layer_grouping``, ``d_min`` (shortest distance in the
      bulk), ``primitive``, ``translation_tolerance``, ``notes`` and ``warnings`` (sentences for the user).

    :meth:`to_dict` gives the same as JSON (camelCase keys, as the web app's ``surfaceAnalysis``).
    """

    def __init__(self) -> None:
        self.notes: list[str] = []
        self.warnings: list[str] = []

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "miller": list(self.miller), "millerInput": list(self.miller_input), "millerBasis": self.miller_basis,
            "millerConventional": None if self.miller_conventional is None else list(self.miller_conventional),
            "conventional": None if self.conventional is None else dict(self.conventional),
            "hkil": None if self.hkil is None else list(self.hkil),
            "primitive": self.primitive, "translationTolerance": self.translation_tolerance,
            "normal": [_r6(x) for x in self.normal], "period": _r6(self.period), "layersPerPeriod": self.m,
            "mesh": {"a": _r6(self.mesh["a"]), "b": _r6(self.mesh["b"]), "gamma": _r6(self.mesh["gamma"]),
                     "area": _r6(self.mesh["area"]), "type": self.mesh["type"]},
            "layerTolerance": _r6(self.layer_tolerance), "layerGrouping": self.layer_grouping,
            "tasker": self.tasker, "charges": None if self.charges is None else dict(self.charges),
            "chargesSource": self.charges_source, "dMin": _r6(self.d_min), "atomsPerCell": len(self.symbols),
            "bulkAtoms": self.bulk_atoms,
            "layers": [dict(L) for L in self.layers], "cuts": [dict(c) for c in self.cuts],
            "terminations": [dict(t) for t in self.terminations],
            "notes": list(self.notes), "warnings": list(self.warnings),
        }
        return out

    @property
    def layers_per_period(self) -> int:
        return self.m

    # -- stacking: layer J = k + q·m is layer k of the ring, q periods up
    def _Z(self, J: int) -> float:
        return self._lay[J % self.m]["mean"] + (J // self.m) * self.period

    def _zmin(self, J: int) -> float:
        return self._lay[J % self.m]["min"] + (J // self.m) * self.period

    def _zmax(self, J: int) -> float:
        return self._lay[J % self.m]["max"] + (J // self.m) * self.period

    def _atoms_of(self, J: int) -> list[tuple[int, list[float]]]:
        """The atoms of layer *J*: (index in the oriented cell, position in the bulk's Cartesian frame)."""
        L = self._lay[J % self.m]
        q = J // self.m
        out = []
        for i, z in zip(L["members"], L["zs"]):
            shift = int(math.floor((z - self.z[i]) / self.period + 0.5)) + q
            out.append((i, [self.r[i][k] + shift * self.c0[k] for k in range(3)]))
        return out

    def _fingerprint(self, J0: int, sign: int) -> list[tuple]:
        """What a face looks like from outside, layer by layer for one period: composition, depth and, for every
        atom, its in-plane distance to the nearest atom of each element of the outermost layer."""
        top = self._atoms_of(J0)
        elements = sorted({self.symbols[i] for i, _ in top})
        fp = []
        for j in range(self.m):
            J = J0 + sign * j
            atoms = self._atoms_of(J)
            depth = abs(self._Z(J) - self._Z(J0))
            comp = tuple(sorted(_counts(self.symbols[i] for i, _ in atoms).items()))
            rows = []
            for ia, (i, r) in enumerate(atoms):
                lam = []
                for el in elements:
                    best = math.inf
                    for it, (i2, r2) in enumerate(top):
                        if self.symbols[i2] != el:
                            continue
                        w = _lateral(_sub(r, r2), self.normal)
                        d = _mic2d(w, self.a1, self.b1)
                        if j == 0 and it == ia and d < 1e-9:      # the atom itself: its nearest image
                            d = math.inf
                            for x in (-1, 0, 1):
                                for y in (-1, 0, 1):
                                    if x or y:
                                        d = min(d, _norm([w[k] + x * self.a1[k] + y * self.b1[k] for k in range(3)]))
                        best = min(best, d)
                    lam.append(best)
                rows.append((self.symbols[i], tuple(lam)))
            fp.append((comp, depth, sorted(rows)))
        return fp

    @staticmethod
    def _same(fa: list[tuple], fb: list[tuple], level: int = 2) -> bool:
        tol = SURFACE_DEFAULTS.match_tolerance
        if len(fa) != len(fb):
            return False
        for (ca, da, Da), (cb, db, Db) in zip(fa, fb):
            if ca != cb or abs(da - db) > tol:
                return False
            if level == 2:
                if len(Da) != len(Db):
                    return False
                # each atom of one layer must find its own partner in the other (rows that differ only by
                # rounding noise have no fixed order, so the lists are matched, not compared in order)
                free = list(Db)
                for sa, la in Da:
                    hit = next((t for t, (sb, lb) in enumerate(free)
                                if sa == sb and all(abs(x - y) <= tol for x, y in zip(la, lb))), None)
                    if hit is None:
                        return False
                    del free[hit]
        return True

    def _match(self, fa: list[tuple], fb: list[tuple]) -> bool:
        return self._same(fa, fb, 1) and self._same(fa, fb, 2)

    def _bottom_label(self, k: int, L: int) -> str:
        """The label of the bottom face of an *L*-layer slab whose top is cut *k*: the label of the termination it
        matches, else the bottom faces are named among themselves (composition, then ``·`` and the next layer)."""
        fb = self._fingerprint(k - L + 1, +1)
        for c in self._classes:
            if self._match(self._fps[c["rep"]], fb):
                return c["label"]
        faces: list[tuple[list[tuple], int]] = []
        for kk in range(self.m):
            f = self._fingerprint(kk + 1, +1)
            if not any(self._match(f, g) for g, _ in faces):
                faces.append((f, kk + 1))
        bases = [_comp_formula(self._lay[b % self.m]["composition"]) for _, b in faces]
        mine = next(i for i, (g, _) in enumerate(faces) if self._match(fb, g))
        twins = [i for i, b in enumerate(bases) if b == bases[mine]]
        if len(twins) == 1:
            return bases[mine]
        ext = [bases[i] + _MIDDOT + _comp_formula(self._lay[(faces[i][1] + 1) % self.m]["composition"]) for i in twins]
        if len(set(ext)) == len(ext):
            return ext[twins.index(mine)]
        n = twins.index(mine)
        return bases[mine] + (f"-{chr(65 + n)}" if len(twins) <= 26 else f"-{n + 1}")

    def _symmetric_layers(self, k: int, L0: int) -> int | None:
        """The smallest number of layers from *L0* on whose bottom face matches the top face of cut *k*."""
        for e in range(self.m):
            L = L0 + e
            if self._match(self._fps[k], self._fingerprint(k - L + 1, +1)):
                return L
        return None


def _check_bulk(bulk: Any) -> None:
    if not isinstance(bulk, Structure):
        raise TypeError("cleaving needs a Structure")
    if bulk.cell is None:
        raise ValueError("cleaving needs a periodic crystal with a unit cell")
    if not all(bulk.pbc):
        on = [_AXIS_NAMES[k] for k in range(3) if bulk.pbc[k]]
        which = "it is not periodic" if not on else f"this one is periodic along {' and '.join(on)} only"
        raise ValueError(f"cleaving needs a structure that is periodic along a, b and c ({which})")
    limit = SURFACE_DEFAULTS.max_cleave_bulk_atoms
    if len(bulk) > limit:
        raise ValueError(f"cleaving supports bulk cells with up to {_count(limit)} atoms (this one has {_count(len(bulk))})")
    if len(bulk) == 0:
        raise ValueError("cleaving needs a crystal with atoms")


_QF = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]]
_QI = [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
_QR = [[1, -1, 0], [0, 1, -1], [1, 1, 1]]
_QC = [[1, 1, 0], [-1, 1, 0], [0, 0, 1]]
#: (Pearson symbol, matrix to the conventional cell, the kind of cell that matrix must give), tried in this order.
_CENTRED = (("cF", _QF, "cubic"), ("cI", _QI, "cubic"), ("hR", _QR, "hexagonal"), ("tI", _QI, "tetragonal"),
            ("oF", _QF, "orthorhombic"), ("oI", _QI, "orthorhombic"), ("oC", _QC, "orthorhombic"),
            ("mC", _QC, "monoclinic"))


def _cell_kind(cell: Any) -> str | None:
    """``cubic``, ``tetragonal``, ``orthorhombic``, ``hexagonal`` (γ = 120°), ``monoclinic`` or ``None``, from the
    lengths (within 1e-3, relative) and angles (within 0.1°) of the cell alone."""
    rel, deg = 1e-3, 0.1
    a, b, c = _norm(cell[0]), _norm(cell[1]), _norm(cell[2])
    al, be, ga = _angle_deg(cell[1], cell[2]), _angle_deg(cell[0], cell[2]), _angle_deg(cell[0], cell[1])
    eq = lambda x, y: abs(x - y) <= rel * max(x, y)   # noqa: E731
    right = lambda x: abs(x - 90.0) <= deg   # noqa: E731
    if right(al) and right(be) and right(ga):
        if eq(a, b) and eq(b, c):
            return "cubic"
        return "tetragonal" if eq(a, b) else "orthorhombic"
    if right(al) and right(be) and abs(ga - 120.0) <= deg and eq(a, b):
        return "hexagonal"
    if right(al) and right(ga):
        return "monoclinic"
    return None


def conventional_cell_hint(cell: Any) -> dict[str, Any] | None:
    """Whether *cell* is the standard primitive cell of a centred lattice: ``{"kind", "toConventional"}`` or ``None``.

    ``kind`` is the Pearson symbol of the lattice (``cF``, ``cI``, ``hR``, ``tI``, ``oF``, ``oI``, ``oC``, ``mC``) and
    ``toConventional`` the integer matrix Q with ``conventional = Q @ cell``: the primitive settings that Materials
    Project, spglib and ASE write.  Judged from the lengths and angles alone, so a cell that only looks like one
    is reported too, and other settings of a primitive cell are not recognised.  A cell that already looks cubic,
    tetragonal, orthorhombic or hexagonal gives ``None``.
    """
    rows = [[float(x) for x in row] for row in np.asarray(cell, dtype=float)]
    if _cell_kind(rows) in ("cubic", "hexagonal", "tetragonal", "orthorhombic"):
        return None
    for kind, Q, target in _CENTRED:
        if _cell_kind([_comb(q, rows) for q in Q]) == target:
            return {"kind": kind, "toConventional": [list(q) for q in Q]}
    return None


def _miller_indices(miller: Any, cell: Any, basis: str = "input") -> dict[str, Any]:
    """The plane *miller* of the input cell: ``{"miller", "given", "hkil", "conventional", "millerConventional",
    "notes"}`` (``miller``: three coprime integers in the input cell's basis, whatever *basis* the indices came in)."""
    if basis not in ("input", "conventional"):
        raise ValueError("miller_basis must be 'input' or 'conventional'")
    try:
        hkl = coerce_param({"type": "miller", "name": "miller"}, miller)
    except ValueError as exc:
        text = str(exc)
        text = text[len("miller: "):] if text.startswith("miller: ") else text
        raise ValueError(text.rstrip(".")) from None
    given = [int(x) for x in miller]
    hexagonal = is_hexagonal_cell(cell)
    hex120 = bool(hexagonal) and hexagonal.get("axis") == 2 and hexagonal.get("gamma") == 120
    hint = conventional_cell_hint(cell)
    conv_hex = hint is not None and hint["kind"] == "hR"
    if basis == "conventional" and hint is None:
        raise ValueError("conventional indices need a standard primitive cell of a centred lattice; this cell is not "
                         "one, so enter indices for this cell")
    if len(given) == 4 and not (conv_hex if basis == "conventional" else hex120):
        raise ValueError("four-index (h k i l) notation needs a hexagonal cell with \u03b3 = 120\u00b0")
    g = _gcd3(hkl)
    notes = []
    red = [x // g for x in hkl]
    if g > 1:
        notes.append(f"{_miller_spaced(hkl)} was reduced to {_miller_spaced(red)}")
    conv = None
    if hint is not None:
        Q = hint["toConventional"]
        if basis == "conventional":
            conv = red
            adj = _iadj3(Q)
            v = [adj[i][0] * conv[0] + adj[i][1] * conv[1] + adj[i][2] * conv[2] for i in range(3)]
            gv = _gcd3(v)
            red = [x // gv for x in v]
        else:
            v = [Q[i][0] * red[0] + Q[i][1] * red[1] + Q[i][2] * red[2] for i in range(3)]
            gv = _gcd3(v)
            conv = [x // gv for x in v]
    hkil = None
    if hex120:
        hkil = [red[0], red[1], -(red[0] + red[1]), red[2]]
    elif conv_hex and conv is not None:
        hkil = [conv[0], conv[1], -(conv[0] + conv[1]), conv[2]]
    return {"miller": red, "given": given, "hkil": hkil, "conventional": hint, "millerConventional": conv,
            "notes": notes}


def surface_analysis(bulk: Structure, miller: Any, *, miller_basis: str = "input", primitive: bool = True,
                     translation_tolerance: float | None = None, layer_tolerance: float | None = None,
                     charges: Mapping[str, float] | None = None) -> SurfaceAnalysis:
    """Describe the surface that cleaving *bulk* along the plane *miller* gives (nothing is built).

    *bulk* is a crystal periodic along a, b and c; *miller* three integers (h, k, l) of its cell, or four
    (h, k, i, l) on a hexagonal cell with γ = 120°.  With ``miller_basis="conventional"`` on the standard primitive
    cell of a centred lattice (:func:`conventional_cell_hint`: a Materials Project fcc, bcc or rhombohedral cell) the
    indices are those of the conventional cell instead.  The result (:class:`SurfaceAnalysis`) has the smallest surface
    cell, the atomic layers of one stacking period, every cut between two layers and the inequivalent
    terminations, best first: non-polar before polar, then fewest broken bonds, then the highest cation valence
    and the most anions in the top layer.

    - *primitive* (default on): reduce a conventional cell or supercell to its primitive cell first, so that the
      surface cell is the smallest one and one period is the shortest; the indices always refer to the input cell.
      Translations are found within *translation_tolerance* (default 0.05 Å).
    - Atomic layers: atoms within 0.1 Å along the normal are one plane; two planes less than 0.45 Å apart joined
      by a cation–anion bond lying nearly flat (under 15°) are one rumpled layer (the FeO2 layer of a tilted
      perovskite).  *layer_tolerance* (Å) replaces both rules: atoms closer than it along the normal share a layer.
    - Polarity uses formal charges (:func:`estimate_oxidation_states`, or *charges*): a termination is polar when
      the repeat unit under it has a dipole; the Tasker type is 1 (every layer neutral), 2 (some cut has no
      dipole) or 3.

    Example::

        an = surface_analysis(build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959), (1, 1, 0))
        [t["label"] for t in an.terminations]        # ['O·Ti2O2', 'Ti2O2', 'O·O']
    """
    D = SURFACE_DEFAULTS
    _check_bulk(bulk)
    cell = [[float(x) for x in row] for row in np.asarray(bulk.cell, dtype=float)]
    an = SurfaceAnalysis()
    mi = _miller_indices(miller, bulk.cell, miller_basis)
    an.miller, an.miller_input, an.hkil = mi["miller"], mi["given"], mi["hkil"]
    an.miller_basis, an.conventional, an.miller_conventional = miller_basis, mi["conventional"], mi["millerConventional"]
    an.notes += mi["notes"]
    an.primitive = bool(primitive)
    tol = D.translation_tolerance if translation_tolerance is None else float(translation_tolerance)
    if not (math.isfinite(tol) and 0 < tol <= 1.0):
        raise ValueError("translation_tolerance must be between 0 and 1 Å")
    an.translation_tolerance = tol
    symbols_in = list(bulk.symbols)
    an.bulk_atoms = len(symbols_in)
    inv_c = _inv3f(cell)
    frac = [[_wrap01(x) for x in _comb([float(p[0]), float(p[1]), float(p[2])], inv_c)] for p in bulk.positions]
    # the primitive cell: P, the integer M with cell = M @ P, and one atom per primitive site
    P, M, keep = cell, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], list(range(len(symbols_in)))
    if primitive:
        if len(symbols_in) > D.max_primitive_search_atoms:
            an.warnings.append(f"the primitive-cell search was skipped for a cell of more than "
                               f"{_count(D.max_primitive_search_atoms)} atoms; the input cell was used")
        else:
            try:
                red = _primitive_reduction(symbols_in, frac, cell, tol)
            except ValueError as exc:
                red = None
                an.warnings.append(f"the primitive-cell search failed ({exc}); the input cell was used")
            if red is not None:
                P, M, keep = red["cell"], red["M"], red["keep"]
                n1 = len(keep)
                an.notes.append(f"the {len(symbols_in)}-atom input cell was reduced to its {n1}-atom primitive cell; "
                                f"turn off Minimal surface cell to keep the input cell (for example for magnetic "
                                f"order set in INCAR)")
    if len(keep) > D.max_cleave_cell_atoms:
        raise ValueError(f"the cell has {_count(len(keep))} atoms after reduction to the primitive cell; cleaving "
                         f"supports up to {_count(D.max_cleave_cell_atoms)}")
    an.points = len(symbols_in) // len(keep)
    an.keep = keep
    an.symbols = [symbols_in[i] for i in keep]
    # the plane in the primitive basis: adj(M) @ hkl (M has a positive determinant)
    adj = _iadj3(M)
    v = [adj[i][0] * an.miller[0] + adj[i][1] * an.miller[1] + adj[i][2] * an.miller[2] for i in range(3)]
    g = _gcd3(v)
    hkl_p = [x // g for x in v]
    G = [an.miller[0] * inv_c[k][0] + an.miller[1] * inv_c[k][1] + an.miller[2] * inv_c[k][2] for k in range(3)]
    gn = _norm(G)
    an.normal = [x / gn for x in G]
    handed = 1 if _det3f(P) > 0 else -1
    v1, v2, v3 = _plane_basis(hkl_p, handed)
    A1, B1, V3 = _comb(v1, P), _comb(v2, P), _comb(v3, P)
    a1, b1, _ = _gauss_reduce_2d(A1, B1)
    an.a1, an.b1 = a1, b1
    # c0: the stacking vector with the smallest in-plane part
    lat3 = _lateral(V3, an.normal)
    f0, f1 = _solve2(a1, b1, lat3)
    best, bi, bj = math.inf, 0, 0
    for di in (0, 1):
        for dj in (0, 1):
            i, j = math.floor(f0) + di, math.floor(f1) + dj
            d = _norm([lat3[k] - i * a1[k] - j * b1[k] for k in range(3)])
            if d < best - 1e-9:
                best, bi, bj = d, i, j
    an.c0 = [V3[k] - bi * a1[k] - bj * b1[k] for k in range(3)]
    an.ouc_cell = [a1, b1, an.c0]
    an.period = _dot(an.c0, an.normal)
    area = _norm(_cross(a1, b1))
    an.mesh = {"a": _norm(a1), "b": _norm(b1), "gamma": _angle_deg(a1, b1), "area": area, "type": _mesh_type(a1, b1)}
    an.area = area
    # the atoms of one primitive cell, then wrapped into the oriented cell
    inv_p = _inv3f(P)
    inv_o = _inv3f(an.ouc_cell)
    an.prim_cart, an.r, an.z = [], [], []
    for i in keep:
        cart = _comb(frac[i], cell)
        fp = [_wrap01(x) for x in _comb(cart, inv_p)]
        pc = _comb(fp, P)
        fo = [_wrap01(x) for x in _comb(pc, inv_o)]
        r = _comb(fo, an.ouc_cell)
        an.prim_cart.append(pc)
        an.r.append(r)
        an.z.append(_dot(r, an.normal))
    an.composition = _counts(an.symbols)
    fc = _formal_charges(an.composition, charges=charges)
    an.charges, an.charges_source = fc["charges"], fc["source"]
    an.notes += fc["notes"]
    an._bonds, an.d_min = _bonds_and_dmin(an.symbols, an.prim_cart, P)
    _find_planes(an, layer_tolerance)
    _find_layers(an, layer_tolerance)
    _find_cuts(an)
    _find_classes(an)
    return an


def _ring_start(zs: list[float], h: float) -> int:
    """The index after the widest circular gap of the sorted heights *zs* (the first of equal gaps)."""
    n = len(zs)
    best, at = -math.inf, 0
    for k in range(n):
        gap = (zs[(k + 1) % n] + (h if k == n - 1 else 0.0)) - zs[k] - 1e-9 * k
        if gap > best:
            best, at = gap, k
    return (at + 1) % n


def _find_planes(an: SurfaceAnalysis, layer_tolerance: float | None) -> None:
    D = SURFACE_DEFAULTS
    h = an.period
    if layer_tolerance is not None:
        tau = float(layer_tolerance)
        if not (math.isfinite(tau) and 0.01 <= tau <= 2.0):
            raise ValueError("layer_tolerance must be between 0.01 and 2 Å")
        tries = [tau]
    else:
        tries = [D.plane_resolution, D.plane_resolution_min]
    order = sorted(range(len(an.z)), key=lambda i: (an.z[i], i))
    zs = [an.z[i] for i in order]
    n = len(order)
    start = _ring_start(zs, h)
    seq = [(order[(start + t) % n], zs[(start + t) % n] + (h if start + t >= n else 0.0)) for t in range(n)]
    for res in tries:
        planes, cur = [], [seq[0]]
        for a, b in zip(seq, seq[1:]):
            if b[1] - a[1] > res:
                planes.append(cur)
                cur = [b]
            else:
                cur.append(b)
        planes.append(cur)
        if planes[-1][-1][1] - planes[0][0][1] < h - res:
            an._planes = [{"members": [i for i, _ in p], "zs": [z for _, z in p]} for p in planes]
            an._inner = max((max(b - a for a, b in zip(p["zs"], p["zs"][1:])) if len(p["zs"]) > 1 else 0.0)
                            for p in an._planes)
            an._resolution = res
            return
    closest = min(b[1] - a[1] for a, b in zip(seq, seq[1:])) if n > 1 else h
    closest = min(closest, seq[0][1] + h - seq[-1][1])
    raise ValueError(f"no separate atomic layers along {_miller_spaced(an.miller)} even at {_num(tries[-1])} Å: the "
                     f"closest atoms are {_fmt2(closest)} Å apart along the normal; give a layer tolerance below "
                     f"{_fmt2(max(closest, 0.02))} Å")


def _crossings(z_lo: float, z_hi: float, z_cut: float, h: float) -> int:
    """How many of the planes ``z_cut + n·h`` lie strictly between *z_lo* and *z_hi*."""
    lo, hi = min(z_lo, z_hi), max(z_lo, z_hi)
    return max(0, math.ceil((hi - z_cut) / h - 1e-12) - math.floor((lo - z_cut) / h + 1e-12) - 1)


def _find_layers(an: SurfaceAnalysis, layer_tolerance: float | None) -> None:
    D = SURFACE_DEFAULTS
    h, P = an.period, an._planes
    m = len(P)
    lo_hi = [(min(p["zs"]), max(p["zs"])) for p in P]
    gaps = [(lo_hi[(k + 1) % m][0] + (h if k == m - 1 else 0.0)) - lo_hi[k][1] for k in range(m)]
    z_cut = [lo_hi[k][1] + gaps[k] / 2 for k in range(m)]
    all_metal = all(e in METALS for e in an.composition)
    nonmetal = {e for e in ANIONS if e not in METALS}
    flags = [False] * m
    if layer_tolerance is None and not all_metal and m > 1:
        for k in range(m):
            if gaps[k] >= D.sublayer_gap:
                continue
            best = None
            for i, j, v in an._bonds:
                if (an.symbols[i] in nonmetal) == (an.symbols[j] in nonmetal):
                    continue
                zi = _dot(an.prim_cart[i], an.normal)
                vz = _dot(v, an.normal)
                if _crossings(zi, zi + vz, z_cut[k], h):
                    tilt = math.degrees(math.asin(min(1.0, abs(vz) / _norm(v))))
                    best = tilt if best is None else min(best, tilt)
            flags[k] = best is not None and best < D.sublayer_tilt
    merged = any(flags) and not all(flags)
    lo = hi = 0.0
    if merged:
        lo = max(max(g for g, f in zip(gaps, flags) if f), an._inner) + D.layer_tolerance_margin
        hi = min(g for g, f in zip(gaps, flags) if not f) - D.layer_tolerance_margin
        merged = lo <= hi
    if merged:
        kbest, gbest = 0, -math.inf
        for k in range(m):
            if not flags[k] and gaps[k] > gbest:
                kbest, gbest = k, gaps[k]
        start = (kbest + 1) % m
        groups, cur = [], [(start, 0.0)]
        for t in range(1, m):
            k = (start + t) % m
            item = (k, h if start + t >= m else 0.0)
            if flags[(k - 1) % m]:
                cur.append(item)
            else:
                groups.append(cur)
                cur = [item]
        groups.append(cur)
        an.layer_tolerance, an.layer_grouping = min(max(D.layer_tolerance, lo), hi), "merged"
    else:
        groups = [[(k, 0.0)] for k in range(m)]
        if layer_tolerance is not None:
            an.layer_tolerance, an.layer_grouping = float(layer_tolerance), "explicit"
        else:
            lo, hi = an._inner + D.layer_tolerance_margin, min(gaps) - D.layer_tolerance_margin
            an.layer_tolerance = min(max(D.layer_tolerance, lo), hi) if lo <= hi else (an._inner + min(gaps)) / 2
            an.layer_grouping = "planes"
    q = an.charges
    layers = []
    for grp in groups:
        members: list[int] = []
        zs: list[float] = []
        for k, shift in grp:
            members += P[k]["members"]
            zs += [z + shift for z in P[k]["zs"]]
        comp = _counts(an.symbols[i] for i in members)
        layers.append({"members": members, "zs": zs, "min": min(zs), "max": max(zs), "mean": sum(zs) / len(zs),
                       "composition": comp, "sublayers": len(grp),
                       "charge": None if q is None else sum(q[an.symbols[i]] for i in members)})
    base = math.floor(layers[0]["min"] / h + 1e-12)
    if base:
        for L in layers:
            L["zs"] = [z - base * h for z in L["zs"]]
            for key in ("min", "max", "mean"):
                L[key] -= base * h
    an._lay = layers
    an.m = len(layers)


def _find_cuts(an: SurfaceAnalysis) -> None:
    m, h = an.m, an.period
    an._gaps_above = [an._zmin(k + 1) - an._zmax(k) for k in range(m)]
    an._z_cut = [(an._zmax(k) + an._zmin(k + 1)) / 2 for k in range(m)]
    an._broken = []
    for k in range(m):
        n = 0
        for i, _, v in an._bonds:
            zi = _dot(an.prim_cart[i], an.normal)
            n += _crossings(zi, zi + _dot(v, an.normal), an._z_cut[k], h)
        an._broken.append(n)
    if an.charges is None:
        an._dipole = [None] * m
        an._polar = [None] * m
        an.tasker = None
    else:
        sig = [L["charge"] for L in an._lay]
        an._dipole = [sum(sig[(k - j) % m] * (an._Z(k - j) - an._Z(k)) for j in range(m)) for k in range(m)]
        an._polar = [abs(mu) / an.area > SURFACE_DEFAULTS.polar_threshold for mu in an._dipole]
        if all(abs(s) <= 1e-6 for s in sig):
            an.tasker = 1
        elif not all(an._polar):
            an.tasker = 2
        else:
            an.tasker = 3


def _find_classes(an: SurfaceAnalysis) -> None:
    m = an.m
    fps = [an._fingerprint(k, -1) for k in range(m)]
    an._fps = fps
    parent = list(range(m))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a in range(m):
        for b in range(a + 1, m):
            if an._match(fps[a], fps[b]):
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    groups: dict[int, list[int]] = {}
    for k in range(m):
        groups.setdefault(find(k), []).append(k)
    q = an.charges
    classes = []
    for cuts in groups.values():
        rep = min(cuts)
        top = an._lay[rep]
        qs = [] if q is None else [q[an.symbols[i]] for i in top["members"]]
        classes.append({"cuts": sorted(cuts), "rep": rep, "polar": an._polar[rep], "broken": an._broken[rep],
                        "qmax": max([x for x in qs if x > 0], default=0), "nanion": sum(1 for x in qs if x < 0),
                        "top": top["composition"], "below": an._lay[(rep - 1) % m]["composition"]})
    classes.sort(key=lambda c: (1 if c["polar"] else 0, c["broken"], -c["qmax"], -c["nanion"], c["rep"]))
    # labels: the top layer's composition; twins add the layer below, then -A, -B, ...
    bases = [_comp_formula(c["top"]) for c in classes]
    labels = list(bases)
    for base in dict.fromkeys(bases):
        idx = [i for i, b in enumerate(bases) if b == base]
        if len(idx) == 1:
            continue
        ext = [base + _MIDDOT + _comp_formula(classes[i]["below"]) for i in idx]
        if len(set(ext)) == len(ext):
            for i, e in zip(idx, ext):
                labels[i] = e
        else:
            for n, i in enumerate(idx):
                labels[i] = base + (f"-{chr(65 + n)}" if len(idx) <= 26 else f"-{n + 1}")
    for c, lab in zip(classes, labels):
        c["label"] = lab
    an._classes = classes
    of_cut = {k: t for t, c in enumerate(classes) for k in c["cuts"]}
    an.layers = [{"index": k, "composition": dict(L["composition"]), "formula": _comp_formula(L["composition"]),
                  "z": _r6(L["mean"]), "min": _r6(L["min"]), "max": _r6(L["max"]), "gapAbove": _r6(an._gaps_above[k]),
                  "charge": None if L["charge"] is None else _r6(L["charge"]), "atoms": len(L["members"]),
                  "sublayers": L["sublayers"]}
                 for k, L in enumerate(an._lay)]
    an.cuts = [{"index": k, "layer": k, "z": _r6(an._z_cut[k]), "gap": _r6(an._gaps_above[k]),
                "brokenBonds": an._broken[k], "dipole": None if an._dipole[k] is None else _r6(an._dipole[k]),
                "polar": an._polar[k], "termination": of_cut[k]} for k in range(m)]
    an.terminations = [{"index": t, "label": c["label"], "cut": c["rep"], "cuts": list(c["cuts"]),
                        "composition": dict(c["top"]), "below": dict(c["below"]), "brokenBonds": c["broken"],
                        "polar": c["polar"]} for t, c in enumerate(classes)]
    if len(classes) == 2:
        a, b = classes
        if an._bottom_label(a["rep"], m) == b["label"] and an._bottom_label(b["rep"], m) == a["label"]:
            an.notes.append(f"for a whole number of periods, the {a['label']} and {b['label']} choices give the same "
                            f"slab upside down")


def terminations(bulk: Structure, miller: Any, **kwargs: Any) -> list[dict[str, Any]]:
    """The inequivalent terminations of the plane *miller* of *bulk*, best first: ``surface_analysis(...)
    .terminations`` (the same keyword arguments).  Each is ``{"index", "label", "cut", "cuts", "composition",
    "below", "brokenBonds", "polar"}``; pass ``termination=<index or label>`` to :func:`surface` to build it."""
    return surface_analysis(bulk, miller, **kwargs).terminations
# --- end M2-T3 ---

# --- surface-modeling M2-T3b ---
# --- end M2-T3b ---

# --- surface-modeling M2-T4 ---
import re

from ..core.structure import CARTESIAN_VECTOR_PROPS, RESULT_PROPS, add_warning

__all__ += ["surface", "oriented_cell", "parse_surface_supercell", "surface_mesh_label"]

_SQRT = "√"
_DEG = "°"
#: Per-atom columns of the bulk that a slab does not take over (constraints, layer tags, adsorbate numbers).
_NOT_COPIED = ("selective_dynamics", "tags", "adsorbate_id")
#: Surface supercells that can be given by name, on the meshes they fit: rows = the new a and b in the 1×1 mesh.
_WOOD_PRESETS = {
    "c2x2": ([[1, 1], [-1, 1]], ("square", "rectangular")),
    "sqrt2xsqrt2r45": ([[1, 1], [-1, 1]], ("square",)),
    "sqrt3xsqrt3r30": ([[2, 1], [-1, 1]], ("hexagonal",)),
    "2sqrt3x2sqrt3r30": ([[4, 2], [-2, 2]], ("hexagonal",)),
    "sqrt7xsqrt7r19.1": ([[3, 1], [-1, 2]], ("hexagonal",)),
    "sqrt5xsqrt5r26.6": ([[2, 1], [-1, 2]], ("square",)),
}


def _whole_number(x: Any) -> bool:
    return isinstance(x, numbers.Real) and not isinstance(x, bool) and math.isfinite(x) and float(x).is_integer()


def parse_surface_supercell(spec: Any, mesh_type: str | None = None) -> list[list[int]]:
    """The 2×2 integer matrix of a surface supercell: rows are the new a and b in units of the 1×1 surface cell.

    *spec* is ``None`` (1×1), two whole numbers ``(n, m)``, a 2×2 matrix, or text: ``"p(3×3)"``, ``"3x3"``,
    ``"c(2×2)"`` (square and rectangular meshes), ``"(√2×√2)R45°"``, ``"(√3×√3)R30°"``, ``"(2√3×2√3)R30°"``,
    ``"(√7×√7)R19.1°"`` (hexagonal meshes) or ``"(√5×√5)R26.6°"`` (square); ``sqrt3`` may be written for ``√3``.
    *mesh_type* (``SurfaceAnalysis.mesh["type"]``) is needed for the named cells.  The determinant must be positive.
    """
    limit = SURFACE_DEFAULTS.supercell_max_entry
    if spec is None:
        return [[1, 0], [0, 1]]
    if isinstance(spec, str):
        text = spec.strip()
        # the name without blanks, brackets and the degree sign: "(√3×√3)R30°" and "sqrt3xsqrt3R30" are the same
        key = (text.lower().replace(" ", "").replace(_TIMES, "x").replace(_SQRT, "sqrt").replace(_DEG, "")
               .replace("(", "").replace(")", ""))
        mm = re.fullmatch(r"p?(\d+)x(\d+)", key)
        if mm:
            S = [[int(mm.group(1)), 0], [0, int(mm.group(2))]]
        else:
            preset = _WOOD_PRESETS.get(key)
            if preset is None:
                raise ValueError(f"unknown surface supercell '{text}' (use for example p(2{_TIMES}2), "
                                 f"({_SQRT}3{_TIMES}{_SQRT}3)R30{_DEG}, c(2{_TIMES}2) or a 2{_TIMES}2 matrix)")
            S, fits = preset
            if mesh_type is not None and mesh_type not in fits:
                raise ValueError(f"{text} does not fit this surface cell ({mesh_type})")
            S = [list(S[0]), list(S[1])]
    else:
        rows = list(spec) if isinstance(spec, (list, tuple, np.ndarray)) else None
        if rows is not None and len(rows) == 2 and all(_whole_number(x) for x in rows):
            S = [[int(rows[0]), 0], [0, int(rows[1])]]
        elif (rows is not None and len(rows) == 2
              and all(isinstance(r, (list, tuple, np.ndarray)) and len(r) == 2 and all(_whole_number(x) for x in r)
                      for r in rows)):
            S = [[int(x) for x in rows[0]], [int(x) for x in rows[1]]]
        else:
            raise ValueError(f"the surface supercell must be a 2{_TIMES}2 matrix of whole numbers")
    if any(abs(x) > limit for row in S for x in row):
        raise ValueError(f"surface supercell entries must be between -{limit} and {limit}")
    det = S[0][0] * S[1][1] - S[0][1] * S[1][0]
    if det <= 0:
        raise ValueError(f"the surface supercell has determinant {det}; " + ("swap the two rows" if det < 0 else
                         "its rows must be independent"))
    return S


def _root_token(n: int) -> str:
    """``√3`` for 3, ``2`` for 4, ``2√3`` for 12."""
    k = int(math.isqrt(n))
    if k * k == n:
        return str(k)
    out, rest = 1, n
    f = 2
    while f * f <= rest:
        while rest % (f * f) == 0:
            out *= f
            rest //= f * f
        f += 1
    return f"{out if out > 1 else ''}{_SQRT}{rest}"


def surface_mesh_label(S: Any, a1: Any, b1: Any) -> str:
    """The name of the surface supercell *S* of the 1×1 mesh (a1, b1): ``''`` for 1×1, ``p(3×3)`` for a diagonal
    matrix, Wood's notation ``(√3×√3)R30°`` when both sides are turned by the same angle, else the matrix as
    ``[2 1 0, -1 3 0, 0 0 1]``."""
    s11, s12, s21, s22 = int(S[0][0]), int(S[0][1]), int(S[1][0]), int(S[1][1])
    if (s11, s12, s21, s22) == (1, 0, 0, 1):
        return ""
    if s12 == 0 and s21 == 0:
        return f"p({s11}{_TIMES}{s22})"
    A = [s11 * a1[k] + s12 * b1[k] for k in range(3)]
    B = [s21 * a1[k] + s22 * b1[k] for k in range(3)]
    na, nb = _dot(A, A) / _dot(a1, a1), _dot(B, B) / _dot(b1, b1)
    ia, ib = int(math.floor(na + 0.5)), int(math.floor(nb + 0.5))
    ta, tb = _angle_deg(A, a1), _angle_deg(B, b1)
    if abs(na - ia) < 1e-6 and abs(nb - ib) < 1e-6 and abs(ta - tb) < 0.05:
        tenths = int(math.floor(ta * 10 + 0.5))
        angle = str(tenths // 10) if tenths % 10 == 0 else f"{tenths // 10}.{tenths % 10}"
        return f"({_root_token(ia)}{_TIMES}{_root_token(ib)})R{angle}{_DEG}"
    return f"[{s11} {s12} 0, {s21} {s22} 0, 0 0 1]"


def _signed(q: float) -> str:
    """``+2``, ``-2``, ``+2.67``, ``0``."""
    if float(q).is_integer():
        return f"{int(q):+d}" if q else "0"
    return _signed_charge(q)


def _stoichiometry(comp: Mapping[str, int], unit: Mapping[str, int]) -> tuple[bool, str | None]:
    n = min(comp.get(e, 0) // u for e, u in unit.items())
    rest = {e: comp.get(e, 0) - n * unit.get(e, 0) for e in {**comp, **unit}}
    rest = {e: x for e, x in rest.items() if x}
    return (not rest), (_comp_formula(rest) if rest else None)


def _thickness_layers(an: SurfaceAnalysis, k: int, thickness: float) -> int:
    """The fewest layers under cut *k* whose atoms span at least *thickness* Å."""
    top = an._zmax(k)
    L = 1
    while top - an._zmin(k - L + 1) < thickness - 1e-9 and L < SURFACE_DEFAULTS.max_layers:
        L += 1
    return L


def surface(bulk: Structure, miller: Any, *, vacuum: float | None, layers: int | None = None,
            periods: int | None = None, thickness: float | None = None, termination: int | str = 0,
            cut: int | None = None, symmetric: bool = False, position: str = "center", offset: float = 0.0,
            supercell: Any = None, primitive: bool = True, miller_basis: str = "input",
            translation_tolerance: float | None = None,
            fix_bottom: int = 0, fix_middle: int = 0, fix_axes: str = "abc", layer_tolerance: float | None = None,
            charges: Mapping[str, float] | None = None, name: str | None = None) -> Structure:
    """Cleave *bulk* along the plane *miller* and return the slab as a new structure.

    The slab has a along x, the surface normal along z and c perpendicular to the surface; it is periodic along a,
    b and c (``pbc`` T T T), the vacuum is along c and the top face is the (hkl) face.

    - *miller*: (h, k, l) of the cell of *bulk*, or (h, k, i, l) on a hexagonal cell with γ = 120°.
    - *vacuum* (required, Å): the total gap between the top atoms and the bottom atoms of the next periodic image,
      never per side.  ``0`` gives no vacuum: the slab then repeats as in the bulk (a whole number of periods, c
      tilted as the stacking needs), which is the bulk re-oriented with (hkl) in the ab plane.
    - Thickness: *layers* atomic layers (default 4), or *periods* stacking periods, or the fewest layers that are
      at least *thickness* Å thick.  *symmetric* adds up to one period of layers until the bottom face matches
      the top face (an error when the crystal has no such slab, as for a polar surface).
    - *termination*: an index or a label of :func:`terminations` (0, the default, is the first: non-polar and
      with the fewest broken bonds); *cut* instead picks one of the cuts of ``surface_analysis(...).cuts``.
    - *position*: ``"center"`` (the slab in the middle of the cell) or ``"bottom"`` (the lowest atoms *offset* Å
      above the cell's bottom face).
    - *supercell*: a surface supercell, see :func:`parse_surface_supercell` (``(2, 2)``, ``"(√3×√3)R30°"``, ...).
    - *fix_bottom* / *fix_middle*: fix the lowest (or the middle) N layers with selective dynamics; *fix_axes*
      names the fixed directions (``"abc"``: F F F; ``"c"``: T T F).
    - *miller_basis*, *primitive*, *translation_tolerance*, *layer_tolerance*, *charges*: as for
      :func:`surface_analysis`.

    Atoms are ordered by element (in the order of the bulk), each element from the bottom layer up; ``props["tags"]``
    holds the layer number counted from the top (1 = top layer); ``info["surface"]`` records how the slab was made
    and ``info["warnings"]`` what to check (a slab that is not stoichiometric, polar or charged).

    Example::

        pt = build.crystal("fcc", "Pt", a=3.92)
        slab = build.surface(pt, (1, 1, 1), vacuum=15, layers=4, supercell=(3, 3), fix_bottom=2)
        slab.name                                    # 'Pt(111) p(3×3) 4L'
    """
    D = SURFACE_DEFAULTS
    _check_bulk(bulk)
    if vacuum is None:
        raise ValueError("vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)")
    if isinstance(vacuum, bool) or not isinstance(vacuum, numbers.Real) or not math.isfinite(vacuum) \
            or not 0 <= vacuum <= D.max_vacuum:
        raise ValueError(f"vacuum must be between 0 and {_num(D.max_vacuum)} Å")
    vacuum = float(vacuum)
    given = [x for x in (layers, periods, thickness) if x is not None]
    if len(given) > 1:
        raise ValueError("give only one of layers, periods or thickness")
    for label, value in (("layers", layers), ("periods", periods)):
        if value is not None and (not _whole_number(value) or not 1 <= value <= D.max_layers):
            raise ValueError(f"{label} must be a whole number from 1 to {D.max_layers}")
    if thickness is not None and (isinstance(thickness, bool) or not isinstance(thickness, numbers.Real)
                                  or not math.isfinite(thickness) or not 0 < thickness <= 500):
        raise ValueError("thickness must be between 0 and 500 Å")
    if position not in ("center", "bottom"):
        raise ValueError("position must be 'center' or 'bottom'")
    if not _whole_number(fix_bottom) or not _whole_number(fix_middle) or fix_bottom < 0 or fix_middle < 0:
        raise ValueError("fix_bottom and fix_middle must be whole numbers of layers")
    if fix_bottom and fix_middle:
        raise ValueError("give only one of fix_bottom or fix_middle")
    if not isinstance(fix_axes, str) or not fix_axes or any(ax not in "abc" for ax in fix_axes):
        raise ValueError("fix_axes must name the fixed directions: 'abc', 'c', ...")
    an = surface_analysis(bulk, miller, miller_basis=miller_basis, primitive=primitive,
                          translation_tolerance=translation_tolerance, layer_tolerance=layer_tolerance,
                          charges=charges)
    m, classes = an.m, an._classes
    # the cut
    if cut is not None:
        if not _whole_number(cut) or not 0 <= cut < m:
            raise ValueError(f"cut {cut} does not exist (this surface has {m} cut{'s' if m != 1 else ''} per period)")
        k = int(cut)
        t_index = an.cuts[k]["termination"]
    else:
        listing = ", ".join(f"{i} {c['label']}" for i, c in enumerate(classes))
        if isinstance(termination, str):
            found = [i for i, c in enumerate(classes) if c["label"] == termination]
            if not found:
                raise ValueError(f"unknown termination '{termination}' (use {' or '.join(c['label'] for c in classes)})")
            t_index = found[0]
        elif _whole_number(termination) and not isinstance(termination, bool):
            t_index = int(termination)
            if not 0 <= t_index < len(classes):
                raise ValueError(f"termination {t_index} does not exist (this surface has {len(classes)}: {listing})")
        else:
            raise ValueError("termination must be an index or a label")
        k = classes[t_index]["rep"]
    cls = classes[t_index]
    # the number of layers
    if periods is not None:
        L, spec = int(periods) * m, {"mode": "periods", "value": int(periods)}
    elif thickness is not None:
        L, spec = _thickness_layers(an, k, float(thickness)), {"mode": "thickness", "value": float(thickness)}
    elif layers is not None:
        L, spec = int(layers), {"mode": "layers", "value": int(layers)}
    else:
        L, spec = D.layers, {"mode": "default", "value": D.layers}
    if symmetric:
        Ls = an._symmetric_layers(k, L)
        if Ls is None:
            idx = an.hkil if an.hkil is not None else (an.miller_conventional or an.miller)
            raise ValueError(
                f"no symmetric slab exists with the {cls['label']} termination: no bottom layer matches the top "
                f"(the {_miller_spaced(idx)} and {_miller_spaced([-x for x in idx])} faces of this crystal differ); "
                f"for a polar surface, passivate the bottom (for example with pseudo-hydrogen) or use an asymmetric "
                f"slab with a dipole correction")
        L = Ls
    if L > D.max_layers:
        raise ValueError(f"layers must be a whole number from 1 to {D.max_layers}")
    if max(fix_bottom, fix_middle) > L:
        which = "fix_bottom" if fix_bottom else "fix_middle"
        raise ValueError(f"{which} must be from 0 to the number of layers ({L})")
    if vacuum == 0 and L % m:
        raise ValueError(f"a vacuum of 0 Å needs a whole number of periods (this slab has {_num(L / m)}); choose "
                         f"Periods or another thickness")
    if vacuum > 0 and not 0 <= offset <= vacuum:
        raise ValueError(f"offset must be between 0 and the vacuum ({_num(vacuum)} Å)")
    S = parse_surface_supercell(supercell, an.mesh["type"])
    det = S[0][0] * S[1][1] - S[0][1] * S[1][0]
    # the frame of the slab: the supercell's a along x, the normal along z
    a1, b1, n3 = an.a1, an.b1, an.normal
    A2b = [S[0][0] * a1[i] + S[0][1] * b1[i] for i in range(3)]
    B2b = [S[1][0] * a1[i] + S[1][1] * b1[i] for i in range(3)]
    la = _norm(A2b)
    e1 = [x / la for x in A2b]
    e2 = _cross(n3, e1)
    rot = lambda v: [_dot(e1, v), _dot(e2, v), _dot(n3, v)]   # noqa: E731
    a1r, b1r = rot(a1), rot(b1)
    A2, B2 = rot(A2b), rot(B2b)
    det2 = A2[0] * B2[1] - A2[1] * B2[0]
    span = max(abs(x) for row in S for x in row) + 1
    images = []
    for i in range(-span, span + 1):
        for j in range(-span, span + 1):
            px, py = i * a1r[0] + j * b1r[0], i * a1r[1] + j * b1r[1]
            fa, fb = (px * B2[1] - py * B2[0]) / det2, (py * A2[0] - px * A2[1]) / det2
            if -1e-9 < fa < 1 - 1e-9 and -1e-9 < fb < 1 - 1e-9:
                images.append((px, py))
    if len(images) != det:
        raise ValueError("the surface supercell could not be filled (an internal error: please report the matrix)")
    rank = {e: r for r, e in enumerate(dict.fromkeys(bulk.symbols))}
    Jb = k - L + 1
    rows = []
    for ell, J in enumerate(range(Jb, k + 1)):
        for i, r in an._atoms_of(J):
            p = rot(r)
            for g, (px, py) in enumerate(images):
                rows.append((rank[an.symbols[i]], ell, g, i, [p[0] + px, p[1] + py, p[2]]))
    zs = [row[4][2] for row in rows]
    z_lo, z_hi = min(zs), max(zs)
    t = z_hi - z_lo
    if vacuum > 0:
        cell = [[la, 0.0, 0.0], [B2[0], B2[1], 0.0], [0.0, 0.0, t + vacuum]]
        z0 = vacuum / 2 if position == "center" else float(offset)
    else:
        c0r = rot(an.c0)
        cell = [[la, 0.0, 0.0], [B2[0], B2[1], 0.0], [(L // m) * x for x in c0r]]
        z0 = 0.0
    cell = [[0.0 if abs(x) < 1e-12 else x for x in row] for row in cell]
    # the contact across the cell edge (top atoms and the bottom atoms of the next image)
    if vacuum > 0:
        top, bottom = an._atoms_of(k), an._atoms_of(Jb)
        d_x = math.inf
        for _, rt in top:
            for _, rb in bottom:
                dz = _dot(rb, n3) + (t + vacuum) - _dot(rt, n3)
                w = _lateral(_sub(rb, rt), n3)
                d_x = min(d_x, math.sqrt(_mic2d(w, a1, b1) ** 2 + dz * dz))
        if d_x < D.contact_error_fraction * an.d_min:
            need = math.ceil(7.5 * an.d_min) / 10
            raise ValueError(
                f"the vacuum ({_num(vacuum)} Å) is too small: atoms would be {_fmt2(d_x)} Å apart across the "
                f"cell edge (shortest distance in the bulk {_fmt2(an.d_min)} Å); use at least {_num(need)} Å, "
                f"or 0 for a bulk-like stacking")
        contact = d_x if d_x < D.contact_warn_fraction * an.d_min - 1e-9 else None
    else:
        contact = None
    # in-plane origin on the first atom of the top layer, then wrapped into the cell
    anchor = next(row for row in rows if row[1] == L - 1)[4]
    ox, oy = anchor[0], anchor[1]
    inv = _inv3f(cell)
    rows.sort(key=lambda row: row[:4])
    symbols, positions, tags, src = [], [], [], []
    for _, ell, _, i, p in rows:
        q = [p[0] - ox, p[1] - oy, p[2] - z_lo + z0]
        f = _comb(q, inv)
        for ax in (0, 1):
            w = f[ax] - math.floor(f[ax] + 1e-9)
            f[ax] = 0.0 if (w < 0 or w >= 1 - 1e-9) else w
        positions.append(_comb(f, cell))
        symbols.append(an.symbols[i])
        tags.append(L - ell)
        src.append(an.keep[i])
    # constraints
    fixed_layers: list[int] = []
    if fix_bottom:
        fixed_layers = list(range(int(fix_bottom)))
    elif fix_middle:
        lo = (L - int(fix_middle)) // 2
        fixed_layers = list(range(lo, lo + int(fix_middle)))
    props: dict[str, Any] = {"tags": tags}
    if fixed_layers:
        flag = [ax not in fix_axes for ax in "abc"]
        on = set(fixed_layers)
        props["selective_dynamics"] = [list(flag) if (L - tg) in on else [True, True, True] for tg in tags]
    for key, col in bulk.props.items():
        if key in _NOT_COPIED or key in RESULT_PROPS or key in CARTESIAN_VECTOR_PROPS:
            continue
        props[key] = [col[j] for j in src]
    # what the slab is made of
    comp1: dict[str, int] = {}
    heights: list[tuple[float, str]] = []
    for J in range(Jb, k + 1):
        for i, r in an._atoms_of(J):
            comp1[an.symbols[i]] = comp1.get(an.symbols[i], 0) + 1
            heights.append((_dot(r, n3), an.symbols[i]))
    composition = {e: n * det for e, n in comp1.items()}
    unit = _reduced(_counts(bulk.symbols))
    stoich, excess = _stoichiometry(composition, unit)
    q = an.charges
    if q is None:
        polarity: dict[str, Any] = {"polar": None, "netCharge": None, "dipole": None, "dipoleDensity": None}
    else:
        z_mid = z_lo + t / 2
        dipole1 = sum(q[s] * (z - z_mid) for z, s in heights)
        net = sum(q[s] for _, s in heights) * det
        density = dipole1 / an.area
        polarity = {"polar": abs(density) > D.polar_threshold, "netCharge": _r6(net), "dipole": _r6(dipole1 * det),
                    "dipoleDensity": _r6(density)}
    n_terms = len(classes)
    top_label = cls["label"]
    bottom_label = an._bottom_label(k, L) if n_terms > 1 else top_label
    idx = an.hkil if an.hkil is not None else (an.miller_conventional or an.miller)
    bulk_formula = _comp_formula(unit)
    mesh_token = surface_mesh_label(S, a1, b1)
    term = ""
    if n_terms > 1:
        term = f"{top_label}-term" if top_label == bottom_label else f"{top_label}/{bottom_label}-term"
    auto = " ".join(p for p in (bulk_formula + _miller_token(idx), mesh_token, term, f"{L}L") if p)
    record: dict[str, Any] = {
        "version": 2, "kind": "cleave", "autoName": auto if name is None else None,
        "miller": list(an.miller), "millerInput": list(an.miller_input), "millerBasis": an.miller_basis,
        "primitive": an.primitive, "translationTolerance": an.translation_tolerance,
        "bulkNormal": [_r6(x) for x in n3], "normal": [0, 0, 1], "axis": 2,
        "period": _r6(an.period), "layersPerPeriod": m,
        "layerTolerance": _r6(an.layer_tolerance), "layerGrouping": an.layer_grouping,
        "meshParams": {"a": _r6(an.mesh["a"]), "b": _r6(an.mesh["b"]), "gamma": _r6(an.mesh["gamma"]),
                       "area": _r6(an.mesh["area"]), "type": an.mesh["type"]},
        "termination": {"index": t_index, "count": n_terms, "label": top_label, "top": top_label,
                        "bottom": bottom_label, "topComposition": dict(an._lay[k % m]["composition"]),
                        "bottomComposition": dict(an._lay[Jb % m]["composition"]),
                        "brokenBonds": an._broken[k], "polar": an._polar[k]},
        "tasker": an.tasker, "layers": L, "thicknessSpec": spec, "thickness": _r6(t), "vacuum": _r6(vacuum),
        "stacking": "vacuum" if vacuum > 0 else "bulk", "position": position,
        "offset": _r6(float(offset) if position == "bottom" else 0.0),
        "symmetric": bool(symmetric), "symmetryCheck": "fingerprint", "flipped": False,
        "asBuilt": {"composition": composition, "stoichiometric": stoich, "excess": excess, "polarity": polarity},
        "bulk": {"name": bulk.name, "formula": _comp_formula(_counts(bulk.symbols)), "reducedFormula": bulk_formula,
                 "natoms": len(bulk), "cell": [[_r6(float(x)) for x in row] for row in np.asarray(bulk.cell)]},
    }
    if an.hkil is not None:
        record["hkil"] = list(an.hkil)
    if an.miller_conventional is not None:
        record["millerConventional"] = list(an.miller_conventional)
        record["conventional"] = dict(an.conventional)
    if mesh_token:
        record["asBuilt"]["supercell"] = [list(S[0]), list(S[1])]
    if fixed_layers:
        record["asBuilt"]["fixed"] = {"layers": len(fixed_layers), "from": "bottom" if fix_bottom else "middle",
                                      "axes": fix_axes}
    for key in ("spacegroup", "source"):
        if bulk.info.get(key) is not None:
            record["bulk"][key] = bulk.info[key]
    info: dict[str, Any] = {"source": "builder:surface", "surface": record}
    if mesh_token:
        info["supercellMatrix"] = [[S[0][0], S[0][1], 0], [S[1][0], S[1][1], 0], [0, 0, 1]]
    slab = Structure(symbols, positions, cell=cell, pbc=[True, True, True], props=props, info=info,
                     name=auto if name is None else str(name))
    # what to check
    for w in an.warnings:
        add_warning(slab.info, w)
    if bulk.n_frames > 1:
        add_warning(slab.info, f"only the first frame was used (the structure has {bulk.n_frames} frames)")
    if "selective_dynamics" in bulk.props:
        add_warning(slab.info, "the bulk constraints (selective dynamics) were not copied")
    if not stoich:
        add_warning(slab.info, f"the slab is not stoichiometric: {_comp_formula(composition)} per cell "
                               f"(bulk {bulk_formula}), excess {excess}")
    if q is not None:
        if polarity["polar"]:
            shown = ", ".join(f"{e} {_signed(q[e])}" for e in sorted(q, key=_formula_key))
            add_warning(slab.info, f"the slab is polar: dipole {_fmt2(dipole1 * det)} e{_MIDDOT}Å per cell "
                                   f"({_fmt2(density)} e/Å), from formal charges {shown}")
        if abs(net) > 1e-6:
            add_warning(slab.info, f"the slab has a net formal charge of {_signed(net)} per cell")
    if contact is not None:
        add_warning(slab.info, f"the vacuum ({_num(vacuum)} Å) leaves atoms {_fmt2(contact)} Å apart across the "
                               f"cell edge, closer than in the bulk ({_fmt2(an.d_min)} Å)")
    if fixed_layers and len(fixed_layers) == L:
        add_warning(slab.info, "all layers are fixed")
    return slab


def oriented_cell(bulk: Structure, miller: Any, *, periods: int = 1, **kwargs: Any) -> Structure:
    """The bulk re-oriented with the plane *miller* in the ab plane: ``surface(bulk, miller, vacuum=0,
    periods=periods, ...)``, a 3D crystal with a along x, the plane normal along z and c one stacking vector (times
    *periods*).  Its shortest distances are those of the bulk; use it as the bulk reference of a slab calculation."""
    return surface(bulk, miller, vacuum=0, periods=periods, **kwargs)
# --- end M2-T4 ---

# --- surface-modeling M2-T5 ---
from ..analysis.vacuum import contiguous_shifts, find_vacuum_gap, surface_normal
from ..core.constraints import apply_basis_change
from ..core.structure import mark_edited

__all__ += ["slab_extent", "slab_layers", "set_vacuum", "center_slab", "flip_slab", "fix_layers", "free_atoms"]

_NO_SLAB = "flipping needs a slab: a vacuum gap or a non-periodic axis"


def _slab_axis(structure: Structure, axis: int | None) -> tuple[int, Any, bool]:
    """(axis, cut, has a vacuum gap) of the structure's surface: the vacuum axis, else *axis* or c."""
    sn = surface_normal(structure)
    if sn is None:
        raise ValueError("setting the vacuum needs a unit cell")
    if axis is not None:
        if axis not in (0, 1, 2):
            raise ValueError("axis must be 0, 1 or 2 (a, b or c)")
        k = int(axis)
        cut = sn["cut"] if sn["surface"] and sn["axis"] == k else None
    else:
        k = int(sn["axis"])
        cut = sn["cut"] if sn["surface"] else None
    return k, cut, cut is not None


def _unwrapped(structure: Structure, k: int, cut: Any) -> tuple[np.ndarray, np.ndarray, list[float], float]:
    """(positions in one piece along axis *k*, the whole-cell shifts applied, the unit normal, the cell height)."""
    cell = np.asarray(structure.cell, dtype=float)
    a, b, c = (list(map(float, cell[(k + 1) % 3])), list(map(float, cell[(k + 2) % 3])), list(map(float, cell[k])))
    n = _cross(a, b)
    ln = _norm(n)
    n = [x / ln for x in n]
    if _dot(c, n) < 0:
        n = [-x for x in n]
    pos = np.array(structure.positions, dtype=float)
    shifts = np.zeros(len(structure), dtype=np.int64)
    if structure.pbc[k] and len(structure):
        if cut is None:
            gap = find_vacuum_gap(structure, k, min_width=0, periodic_only=False)
            window = None if gap is None else gap["center"] - 1.0
        else:
            window = cut
        if window is not None:
            shifts = contiguous_shifts(structure, k, cut=window)
            pos = pos + shifts[:, None].astype(float) * cell[k]
    return pos, shifts, n, _dot(c, n)


def slab_extent(structure: Structure, *, axis: int | None = None) -> dict[str, Any] | None:
    """Where the atoms are along the surface normal: ``{"axis", "normal", "bottom", "top", "thickness", "gap",
    "height", "vacuum"}`` in Å (``gap``: the cell height minus the thickness, the space between the top atoms and
    the next image; ``vacuum``: whether that is a vacuum gap), or ``None`` without a unit cell.  Read-only."""
    if structure.cell is None or len(structure) == 0:
        return None
    k, cut, has_gap = _slab_axis(structure, axis)
    pos, _, n, height = _unwrapped(structure, k, cut)
    z = pos @ np.array(n)
    bottom, top = float(z.min()), float(z.max())
    return {"axis": k, "normal": n, "bottom": bottom, "top": top, "thickness": top - bottom,
            "gap": height - (top - bottom), "height": height, "vacuum": has_gap}


def slab_layers(structure: Structure, *, tolerance: float | None = None, axis: int | None = None) -> dict[str, Any]:
    """The atomic layers of a slab along its surface normal: ``{"axis", "count", "layer", "heights", "sizes"}``.

    ``layer[i]`` is the layer of atom i counted from the bottom (0 = bottom layer), ``heights`` the mean height of
    each layer above the lowest atom (Å) and ``sizes`` its number of atoms.  Atoms closer than *tolerance* along
    the normal share a layer (default: ``info["surface"]["layerTolerance"]``, else 0.3 Å).
    """
    if structure.cell is None:
        raise ValueError("layers need a unit cell")
    if tolerance is None:
        rec = structure.info.get("surface")
        tolerance = rec.get("layerTolerance") if isinstance(rec, dict) else None
        if not isinstance(tolerance, (int, float)) or isinstance(tolerance, bool) or not 0 < tolerance <= 2:
            tolerance = SURFACE_DEFAULTS.layer_tolerance
    k, cut, _ = _slab_axis(structure, axis)
    pos, _, n, _ = _unwrapped(structure, k, cut)
    z = [float(x) for x in pos @ np.array(n)]
    order = sorted(range(len(z)), key=lambda i: (z[i], i))
    layer = [0] * len(z)
    heights: list[float] = []
    sizes: list[int] = []
    cur: list[int] = []
    for t, i in enumerate(order):
        if cur and z[i] - z[order[t - 1]] > tolerance:
            heights.append(sum(z[j] for j in cur) / len(cur))
            sizes.append(len(cur))
            cur = []
        cur.append(i)
        layer[i] = len(heights)
    if cur:
        heights.append(sum(z[j] for j in cur) / len(cur))
        sizes.append(len(cur))
    z0 = min(z) if z else 0.0
    return {"axis": k, "count": len(heights), "layer": layer, "heights": [h - z0 for h in heights], "sizes": sizes}


def _place(structure: Structure, gap: float | None, position: str, offset: float, axis: int | None,
           label: str) -> Structure:
    k, cut, has_gap = _slab_axis(structure, axis)
    if structure.n_frames > 1:
        n_frames = structure.n_frames
        structure.keep_frame(0)
        add_warning(structure.info, f"only the first frame was kept (the structure had {n_frames} frames)")
    pos, _, n, height = _unwrapped(structure, k, cut)
    nv = np.array(n)
    z = pos @ nv
    bottom, top = float(z.min()), float(z.max())
    t = top - bottom
    cell = np.array(structure.cell, dtype=float)
    if gap is None:
        gap = height - t
    elif not has_gap and structure.pbc[k]:
        widest = find_vacuum_gap(structure, k, min_width=0, periodic_only=False)
        add_warning(structure.info, f"no vacuum gap of at least {_num(SURFACE_DEFAULTS.vacuum_gap_min)} Å was found; "
                                    f"the structure was cut at its widest gap along {_AXIS_NAMES[k]} "
                                    f"({_fmt2(widest['width'] if widest else 0.0)} Å)")
    new_height = t + gap
    cell[k] = cell[k] * (new_height / height)
    z0 = gap / 2 if position == "center" else float(offset)
    pos = pos + (z0 - bottom) * nv
    structure.cell = cell
    structure.positions = pos
    mark_edited(structure, "cell")
    rec = structure.info.get("surface")
    update = {"axis": k, "normal": [_r6(x) for x in n], "thickness": _r6(t), "vacuum": _r6(gap),
              "position": position, "offset": _r6(float(offset) if position == "bottom" else 0.0),
              "stacking": "vacuum"}
    if isinstance(rec, dict):
        rec.update(update)
    elif label == "vacuum":
        structure.info["surface"] = {"version": 2, "kind": "vacuum", "autoName": None, **update}
    return structure


def set_vacuum(structure: Structure, vacuum: float | None, *, position: str = "center", offset: float = 0.0,
               axis: int | None = None) -> Structure:
    """Set the vacuum of a slab, in place: the total gap (Å) between its top atoms and the bottom atoms of the next
    periodic image along the surface normal (Materials Studio's "Build Vacuum Slab").

    The vacuum axis is the cell vector with the vacuum gap (:func:`facet.analysis.surface_normal`), or *axis*
    (0, 1, 2); a crystal without a gap is cut at its widest gap along c (a warning says so).  A slab that crosses
    the cell edge is put in one piece first.  The cell vector along the vacuum keeps its direction and gets the
    length that makes the gap *vacuum* Å; the atoms keep their distances and are moved along the normal:
    *position* ``"center"`` puts the slab in the middle, ``"bottom"`` its lowest atoms *offset* Å above the bottom
    face.  ``pbc`` and the constraints are kept.  Returns the structure.

    ``vacuum`` has no default and must be larger than 0 (0 Å is only possible when cleaving, where the slab then
    repeats as in the bulk).  The existing :meth:`Structure.center` instead takes the vacuum on each side.
    """
    D = SURFACE_DEFAULTS
    if structure.cell is None:
        raise ValueError("setting the vacuum needs a unit cell")
    if vacuum is None:
        raise ValueError("vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)")
    if isinstance(vacuum, bool) or not isinstance(vacuum, numbers.Real) or not math.isfinite(vacuum) \
            or not 0 <= vacuum <= D.max_vacuum:
        raise ValueError(f"vacuum must be between 0 and {_num(D.max_vacuum)} Å")
    if vacuum == 0:
        raise ValueError("a vacuum of 0 Å is only possible when cleaving (the slab then repeats as in the bulk); "
                         "enter a gap larger than 0 Å")
    if position not in ("center", "bottom"):
        raise ValueError("position must be 'center' or 'bottom'")
    if position == "bottom" and not 0 <= offset <= vacuum:
        raise ValueError(f"offset must be between 0 and the vacuum ({_num(vacuum)} Å)")
    if sum(1 for p in structure.pbc if not p) >= 2:
        raise ValueError("setting the vacuum needs a structure periodic in at least two directions")
    return _place(structure, float(vacuum), position, offset, axis, "vacuum")


def center_slab(structure: Structure, *, axis: int | None = None) -> Structure:
    """Move a slab to the middle of its cell along the surface normal, in place (the cell and the vacuum stay as
    they are; a slab that crosses the cell edge is put in one piece first).  Returns the structure."""
    if structure.cell is None:
        raise ValueError("centring a slab needs a unit cell")
    return _place(structure, None, "center", 0.0, axis, "center")


def flip_slab(structure: Structure) -> Structure:
    """Turn a slab upside down, in place: a rotation by 180° about its a axis (never a mirror image), so the
    bottom face becomes the top face.

    The slab stays where it was along the normal; the in-plane cell is reduced again (γ from 90° to 120°) and a is
    turned back along x, the atoms are wrapped into the cell, the constraints follow the new cell vectors, the
    layer tags are renumbered from the new top, and a cleave record in ``info["surface"]`` is updated: the indices
    change sign, top and bottom termination swap and the automatic name follows (``ZnO(000-1) O/Zn-term 16L``).
    Needs a vacuum gap along c with a and b in the plane of the surface.  Returns the structure.
    """
    if structure.cell is None:
        raise ValueError(_NO_SLAB)
    k, cut, has_gap = _slab_axis(structure, None)
    if not has_gap and all(structure.pbc):
        raise ValueError(_NO_SLAB)
    if k != 2:
        raise ValueError(f"flipping needs the vacuum along c (here it is along {_AXIS_NAMES[k]})")
    if structure.n_frames > 1:
        n_frames = structure.n_frames
        structure.keep_frame(0)
        add_warning(structure.info, f"only the first frame was kept (the structure had {n_frames} frames)")
    pos, _, n_in, _ = _unwrapped(structure, 2, cut)
    cell = [[float(x) for x in row] for row in np.asarray(structure.cell, dtype=float)]
    a, b, c = cell
    la = _norm(a)
    ah = [x / la for x in a]
    R = [[2.0 * ah[i] * ah[j] - (1.0 if i == j else 0.0) for j in range(3)] for i in range(3)]
    turn = lambda v: [_dot(R[0], v), _dot(R[1], v), _dot(R[2], v)]   # noqa: E731
    rb, rc = turn(b), turn(c)
    u, v, M2 = _gauss_reduce_2d(a, [-x for x in rb])
    new = [u, v, [-x for x in rc]]
    n = _cross(u, v)
    ln = _norm(n)
    n = [x / ln for x in n]
    out = [turn([float(p[0]), float(p[1]), float(p[2])]) for p in pos]
    z_before = min(_dot([float(p[0]), float(p[1]), float(p[2])], n_in) for p in pos)
    z_after = min(_dot(p, n) for p in out)
    lift = z_before - z_after
    out = [[p[i] + lift * n[i] for i in range(3)] for p in out]
    # the standard frame: a along x, the normal along z
    lu = _norm(u)
    e1 = [x / lu for x in u]
    e2 = _cross(n, e1)
    frame = lambda w: [_dot(e1, w), _dot(e2, w), _dot(n, w)]   # noqa: E731
    final = [[0.0 if abs(x) < 1e-12 else x for x in frame(row)] for row in new]
    inv = _inv3f(final)
    positions = []
    for p in out:
        f = _comb(frame(p), inv)
        for ax in (0, 1):
            w = f[ax] - math.floor(f[ax] + 1e-12)
            f[ax] = 0.0 if (w < 0 or w >= 1 - 1e-12) else w
        positions.append(_comb(f, final))
    old_vectors = [frame(a), frame(rb), frame(rc)]
    structure.positions = np.array(positions, dtype=float)
    structure.cell = np.array(final, dtype=float)
    apply_basis_change(structure, old_vectors, final)
    mark_edited(structure, "cell")
    # the supercell record refers to the 1×1 mesh, which is turned over and reduced as well (M2 §3.15)
    S3 = structure.info.get("supercellMatrix")
    if (isinstance(S3, list) and len(S3) == 3 and all(isinstance(r, list) and len(r) == 3 for r in S3)
            and S3[2] == [0, 0, 1] and S3[0][2] == 0 and S3[1][2] == 0
            and all(_whole_number(x) for r in S3[:2] for x in r[:2])):
        So = [[int(S3[0][0]), int(S3[0][1])], [int(S3[1][0]), int(S3[1][1])]]
        det = So[0][0] * So[1][1] - So[0][1] * So[1][0]
        if det > 0:
            one_a = [(So[1][1] * a[i] - So[0][1] * b[i]) / det for i in range(3)]
            one_b = [(-So[1][0] * a[i] + So[0][0] * b[i]) / det for i in range(3)]
            _, _, M1 = _gauss_reduce_2d(turn(one_a), [-x for x in turn(one_b)])
            dsd = [[So[0][0], -So[0][1]], [-So[1][0], So[1][1]]]                 # D · S · D with D = diag(1, -1)
            inv1 = [[M1[1][1], -M1[0][1]], [-M1[1][0], M1[0][0]]]                # det M1 = 1
            mul = lambda x, y: [[x[i][0] * y[0][j] + x[i][1] * y[1][j] for j in range(2)] for i in range(2)]   # noqa: E731
            Sn = mul(mul(M2, dsd), inv1)
            structure.info["supercellMatrix"] = [[Sn[0][0], Sn[0][1], 0], [Sn[1][0], Sn[1][1], 0], [0, 0, 1]]
    tags = structure.props.get("tags")
    if isinstance(tags, list) and tags:
        top = max((t for t in tags if isinstance(t, (int, float)) and t > 0), default=0)
        structure.set_prop("tags", [top + 1 - t if isinstance(t, (int, float)) and t > 0 else t for t in tags])
    rec = structure.info.get("surface")
    if isinstance(rec, dict):
        rec["normal"], rec["axis"] = [0, 0, 1], 2
        if rec.get("kind") == "cleave":
            for key in ("miller", "millerInput", "hkil", "bulkNormal"):
                if isinstance(rec.get(key), list):
                    rec[key] = [(-x if x else 0) if isinstance(x, int) else _r6(-x) for x in rec[key]]
            term = rec.get("termination")
            if isinstance(term, dict):
                term["top"], term["bottom"] = term.get("bottom"), term.get("top")
                term["topComposition"], term["bottomComposition"] = term.get("bottomComposition"), term.get("topComposition")
                term["label"] = term["top"]
            rec["flipped"] = not rec.get("flipped", False)
            auto = rec.get("autoName")
            if auto is not None and structure.name == auto:
                new_name = _flipped_name(structure, rec)
                rec["autoName"] = new_name
                structure.name = new_name
            else:
                rec["autoName"] = None
    return structure


def _flipped_name(structure: Structure, rec: dict[str, Any]) -> str:
    """The automatic name of a cleaved slab from its record (after a flip): formula(hkl) mesh term nL."""
    idx = rec.get("hkil") or rec.get("miller")
    bulk = rec.get("bulk") or {}
    term = rec.get("termination") or {}
    token = ""
    if term.get("count", 1) > 1:
        top, bottom = term.get("top"), term.get("bottom")
        token = f"{top}-term" if top == bottom else f"{top}/{bottom}-term"
    mesh = ""
    S = structure.info.get("supercellMatrix")
    old = rec.get("autoName") or ""
    if S is not None:
        mm = re.search(r"\) (.+?) (?:\S+-term )?\d+L$", old)
        mesh = mm.group(1) if mm and not mm.group(1).endswith("-term") else ""
    return " ".join(p for p in (str(bulk.get("reducedFormula", "")) + _miller_token(idx), mesh, token,
                                f"{rec.get('layers')}L") if p)


def fix_layers(structure: Structure, n: int, *, where: str = "bottom", axes: str = "abc",
               tolerance: float | None = None) -> int:
    """Fix the lowest (``where="bottom"``), the highest (``"top"``) or the middle (``"middle"``) *n* atomic layers of
    a slab with selective dynamics, in place; the other atoms keep their flags.  *axes* names the fixed directions
    (``"abc"``: F F F; ``"c"``: T T F).  Layers as in :func:`slab_layers`.  Returns the number of atoms fixed."""
    if where not in ("bottom", "top", "middle"):
        raise ValueError("where must be 'bottom', 'top' or 'middle'")
    if not isinstance(axes, str) or not axes or any(ax not in "abc" for ax in axes):
        raise ValueError("axes must name the fixed directions: 'abc', 'c', ...")
    lay = slab_layers(structure, tolerance=tolerance)
    count = lay["count"]
    if not _whole_number(n) or isinstance(n, bool) or not 0 <= n <= count:
        raise ValueError(f"the number of fixed layers must be from 0 to the number of layers ({count})")
    n = int(n)
    if where == "bottom":
        chosen = set(range(n))
    elif where == "top":
        chosen = set(range(count - n, count))
    else:
        lo = (count - n) // 2
        chosen = set(range(lo, lo + n))
    flags = [list(row) for row in structure.move_flags()]
    flag = [ax not in axes for ax in "abc"]
    fixed = 0
    for i, ell in enumerate(lay["layer"]):
        if ell in chosen:
            flags[i] = list(flag)
            fixed += 1
    structure.set_prop("selective_dynamics", flags)
    return fixed


def free_atoms(structure: Structure, indices: Iterable[int] | None = None) -> int:
    """Let atoms move again, in place: all of them (the constraints are removed), or only *indices*.  Returns the
    number of atoms freed."""
    flags = [list(row) for row in structure.move_flags()]
    which = range(len(flags)) if indices is None else [int(i) for i in indices]
    freed = 0
    for i in which:
        if not all(flags[i]):
            freed += 1
        flags[i] = [True, True, True]
    if all(all(row) for row in flags):
        structure.remove_prop("selective_dynamics")
    else:
        structure.set_prop("selective_dynamics", flags)
    return freed
# --- end M2-T5 ---
