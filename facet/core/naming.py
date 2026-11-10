"""Names of generated structures, built by the same rules in both languages (design brief C9).

The multiplication sign is always ``×`` (:data:`TIMES`), never the letter x.  :func:`add_repeat_suffix` names a
repeated structure: ``Cu fcc`` repeated 2×2×2 is ``Cu fcc 2×2×2``, and repeating that again by 2×1×1 gives
``Cu fcc 4×2×2`` instead of a second suffix.  Names written by older versions are recognised: the letter x
(``Cu fcc 2x2x2``, Python before 0.4) and the web app's parentheses (``Cu (Face-centred cubic) (2×2×2)``).

The JavaScript twin is ``facet/web/js/core/naming.js`` (``TIMES``, ``formatRepeat``, ``addRepeatSuffix``);
the shared cases are in ``tests/data/surface/f0d/edits.json``.  Other modules add their naming rules (surface
labels, Wood notation, interfaces) to these two files.

Example::

    from facet.core.naming import add_repeat_suffix, format_repeat
    format_repeat((2, 2, 1))                      # '2×2×1'
    add_repeat_suffix("Cu fcc 2x2x2", (2, 1, 1))  # 'Cu fcc 4×2×2'
"""

from __future__ import annotations

import math
import re
from typing import Any, Sequence

import numpy as np

__all__ = ["TIMES", "format_repeat", "add_repeat_suffix"]

#: The multiplication sign of every generated name and label.
TIMES = "×"

#: A repeat suffix at the end of a name: `` A×B×C``, the older `` AxBxC`` or the web app's former `` (A×B×C)``
#: (groups: base, "(", A, B, C, ")"; the parentheses must come as a pair).  ASCII digits only, as in JavaScript.
_SUFFIX = re.compile(r"(.*\S)\s+(\()?([0-9]+)[x×]([0-9]+)[x×]([0-9]+)(\))?")


def _whole(value: Any) -> int:
    """*value* as an int: an integer, or a float with an integer value (JSON and JavaScript cannot tell them apart)."""
    if isinstance(value, (bool, np.bool_)):
        raise TypeError(f"repeat counts must be whole numbers (got {value!r})")
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)) and math.isfinite(value) and float(value).is_integer():
        return int(value)
    raise TypeError(f"repeat counts must be whole numbers (got {value!r})")


def format_repeat(reps: Sequence[int]) -> str:
    """The counts joined by ``×``: ``(2, 2, 1)`` -> ``"2×2×1"``.  Floats with integer values print as integers."""
    return TIMES.join(str(_whole(r)) for r in reps)


def add_repeat_suffix(name: str, reps: Sequence[int]) -> str:
    """*name* with the repeat suffix of a ``reps = (nx, ny, nz)`` supercell.

    * every count 1: *name* unchanged;
    * an empty name stays empty;
    * a name that already ends in a repeat suffix (`` 2×2×1``, the older `` 2x2x1`` or `` (2×2×1)``, parentheses in
      pairs) gets the products of the old and the new counts, written with ``×`` and without parentheses:
      ``add_repeat_suffix("Cu fcc 2×2×1", (2, 1, 1))`` -> ``"Cu fcc 4×2×1"``;
    * any other name gets `` nx×ny×nz`` appended.

    The counts must be whole numbers >= 1 (``ValueError``; ``TypeError`` when they are not numbers).
    """
    counts = [_whole(r) for r in reps]
    if len(counts) != 3:
        raise ValueError(f"a repeat suffix needs 3 counts (got {len(counts)})")
    for c in counts:
        if c < 1:
            raise ValueError(f"repeat counts must be whole numbers >= 1 (got {c})")
    name = str(name)
    if all(c == 1 for c in counts) or not name:
        return name
    m = _SUFFIX.fullmatch(name)
    if m is not None and (m.group(2) is None) == (m.group(6) is None):
        old = (int(m.group(3)), int(m.group(4)), int(m.group(5)))
        return f"{m.group(1)} {format_repeat([a * b for a, b in zip(old, counts)])}"
    return f"{name} {format_repeat(counts)}"


# --- surface-modeling M1 ---
# --- end M1 ---

# --- surface-modeling M2 ---
# --- end M2 ---

# --- surface-modeling M6 ---
# --- end M6 ---
