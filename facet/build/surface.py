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
# --- end M2-T3 ---

# --- surface-modeling M2-T3b ---
# --- end M2-T3b ---

# --- surface-modeling M2-T4 ---
# --- end M2-T4 ---

# --- surface-modeling M2-T5 ---
# --- end M2-T5 ---
