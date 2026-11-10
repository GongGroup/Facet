"""Shared tolerances and defaults of the surface-modeling tools (``SURFACE_DEFAULTS``).

Every module that needs a tolerance or a default value takes it from here instead of writing a literal, so that
the Python and JavaScript implementations use the same numbers: the JS twin is
``crystallume/web/js/core/defaults.js``, with the same keys in camelCase (``vacuum_gap_min`` <-> ``vacuumGapMin``)
and the same values, which a test checks key by key.  Modules add their own keys in both files at once.

``SURFACE_DEFAULTS`` is read-only and supports both attribute and item access::

    from crystallume.core.defaults import SURFACE_DEFAULTS
    SURFACE_DEFAULTS.vacuum_gap_min          # 5.0
    SURFACE_DEFAULTS["position_tolerance"]   # 1e-05

There is deliberately no ``vacuum`` key: the vacuum of a slab has no default and must always be given.

==========================  =======  ========  ==========================================================
Key                         Value    Unit      Use
==========================  =======  ========  ==========================================================
``vacuum_gap_min``          5.0      Å         a vacuum gap along a cell vector (never below 4.4 Å: the
                                               widest atom-free plane spacing of a bulk crystal, bcc Cs
                                               d110, is 4.34 Å)
``surface_hint_gap_min``    2.0      Å         the threshold on the axis recorded in ``info.surface.axis``
``block_gap_min``           3.5      Å         the gap that splits the atoms along an axis into blocks
``small_block_fraction``    0.5      --        a block with at most this fraction of the atoms of the main
                                               block floats in the vacuum (a molecule above a surface)
``gap_wrap_eps``            1e-6     fraction  vacuum-gap wrapping: ``w = f - floor(f)``, ``w > 1 - eps`` -> 0
``position_tolerance``      1e-5     Å         positions, gap widths and thresholds compare within this
``flag_tolerance``          1e-6     relative  constraint flags under a change of cell basis
``overlap_distance``        0.5      Å         atoms closer than this overlap (export check)
``mic_tie``                 1e-8     Å         equal-length candidates of the minimum-image search
# --- surface-modeling M1 ---
# --- end M1 ---

# --- surface-modeling M2 ---
# --- end M2 ---

# --- surface-modeling M3 ---
# --- end M3 ---

# --- surface-modeling M4 ---
# --- end M4 ---

# --- surface-modeling M5-adsorbates ---
# --- end M5-adsorbates ---

# --- surface-modeling M5-sites ---
# --- end M5-sites ---

# --- surface-modeling M6 ---
# --- end M6 ---
==========================  =======  ========  ==========================================================
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

__all__ = ["Defaults", "SURFACE_DEFAULTS"]


class Defaults(Mapping):
    """A read-only mapping whose keys are also attributes (``d.key`` and ``d["key"]``).

    An unknown attribute raises ``AttributeError("<name> has no key 'x'")`` and an unknown item ``KeyError('x')``;
    setting or deleting anything raises ``AttributeError("<name> is read-only")``.
    """

    __slots__ = ("_name", "_values")

    def __init__(self, name: str, values: Mapping[str, Any]) -> None:
        object.__setattr__(self, "_name", str(name))
        object.__setattr__(self, "_values", dict(values))

    def __getattr__(self, key: str) -> Any:
        values = object.__getattribute__(self, "_values")
        try:
            return values[key]
        except KeyError:
            raise AttributeError(f"{object.__getattribute__(self, '_name')} has no key {key!r}") from None

    def __getitem__(self, key: str) -> Any:
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __setattr__(self, key: str, value: Any) -> None:
        raise AttributeError(f"{self._name} is read-only")

    def __delattr__(self, key: str) -> None:
        raise AttributeError(f"{self._name} is read-only")

    def __dir__(self) -> list[str]:
        return sorted(set(super().__dir__()) | set(self._values))

    def __repr__(self) -> str:
        inner = ", ".join(f"{k}={v!r}" for k, v in self._values.items())
        return f"{self._name}({inner})"

    def __reduce__(self) -> tuple[Any, ...]:
        return (type(self), (self._name, dict(self._values)))

    def __copy__(self) -> "Defaults":
        return self

    def __deepcopy__(self, memo: dict[int, Any]) -> "Defaults":
        return self


#: The shared constants (the table in the module docstring); keep ``web/js/core/defaults.js`` in step.
SURFACE_DEFAULTS = Defaults("SURFACE_DEFAULTS", {
    "vacuum_gap_min": 5.0,
    "surface_hint_gap_min": 2.0,
    "block_gap_min": 3.5,
    "small_block_fraction": 0.5,
    "gap_wrap_eps": 1e-6,
    "position_tolerance": 1e-5,
    "flag_tolerance": 1e-6,
    "overlap_distance": 0.5,
    "mic_tie": 1e-8,
    # --- surface-modeling M1 ---
    # --- end M1 ---

    # --- surface-modeling M2 ---
    # --- end M2 ---

    # --- surface-modeling M3 ---
    # --- end M3 ---

    # --- surface-modeling M4 ---
    # --- end M4 ---

    # --- surface-modeling M5-adsorbates ---
    # --- end M5-adsorbates ---

    # --- surface-modeling M5-sites ---
    # --- end M5-sites ---

    # --- surface-modeling M6 ---
    # --- end M6 ---
})
