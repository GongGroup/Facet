"""Parameter schemas of plugin builders, analyses and commands: reading typed indices, coercing JSON values, checking a
set of parameters and the defaults of a form.

The JavaScript twin is ``crystallume/web/js/core/params.js``: the same rules and the same messages word for word
(``parse_indices`` <-> ``parseIndices``, ``coerce_param`` <-> ``coerceParam``, ``validate_params`` <-> ``validateParams``,
``default_params`` <-> ``defaultParams``).  :func:`parse_cli_value`, the conversion of command-line strings, is Python
only.

A parameter is a dict ``{"name", "type", "label"?, "description"?, "default"?, "required"?}`` plus the fields of its
type:

* ``int``, ``float``: ``min``, ``max``, ``step``, ``unit`` (shown after the box, e.g. ``"Å"``), ``required`` (no
  default: the box starts empty);
* ``bool``, ``string``, ``element``; ``select`` with ``options`` (values, ``[value, label]`` pairs or
  ``{"value", "label"}`` dicts);
* ``vector``: ``size`` = 3 (2 or 3), ``integer`` = False, ``nonzero`` = False, ``frame`` = ``"cartesian"``,
  ``frames`` = ``[frame]``, ``unit`` = ``"Å"``; the value is ``[x, y, z]`` (``[u, v]`` for size 2) in ``frame``;
* ``miller``: ``max`` = 30 (hard limit), ``warnAbove`` = 12 (soft), ``hexagonal`` = ``"auto"`` (the web control's
  display only); the value is always three indices ``[h, k, l]``: four indices (h k i l) are converted, common
  factors are kept;
* ``imatrix``: ``size`` = 3 (2 or 3), ``max`` = 50, ``maxDet`` = None (no limit), ``warnDet`` = 400 (soft),
  ``positive`` = True, ``presets`` = None (the web control's menu).

Any other type is passed through unchanged.  A limit given as ``None`` (``max``, ``maxDet``, ``warnDet``,
``warnAbove``) is off; a limit not given takes the default above.  Schema keys are camelCase in both languages (they
are JSON shared with the web app).

Messages start with the field's label (``label``, else ``name``) and end with a period, ready for an interface:
``Vacuum: enter a value.``; the formula signs (−, −∞) are U+2212, computed numbers use an ASCII ``-``, and numbers are
written as JavaScript prints them (``1000000`` for ``1e6``, ``0.5``), so both languages give the same text.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Sequence

import numpy as np

from .elements import is_element

__all__ = [
    "ParamError",
    "parse_indices",
    "parse_cli_value",
    "coerce_param",
    "validate_params",
    "default_params",
]


class ParamError(ValueError):
    """A parameter value that does not fit its schema; ``str(error)`` is the text to show."""


_MINUS = "\u2212"
_MAX_SAFE = 2**53 - 1
#: Whitespace as JavaScript's ``\s`` defines it (Python's ``\s`` differs), so that both languages split the same way.
_WS = "\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_TRIM = re.compile(f"^[{_WS}]+|[{_WS}]+\\Z")
_SPLIT = re.compile(f"[{_WS},]+")
_NUMBER = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?")
_FLOAT = re.compile(r"[.eE]")
_FRACTION = re.compile(r"([-+]?[0-9]+)/([0-9]+)")
#: A run of digits and combining overlines (U+0305) or macrons (U+0304); negative when every digit carries a bar.
_BAR_RUN = re.compile("[0-9\u0305\u0304]+")
_BARRED = re.compile("(?:[0-9][\u0305\u0304]+)+")
_BARS = re.compile("[\u0305\u0304]")
_OPEN, _CLOSE = "([{<", ")]}>"
_DEFAULTS = {"miller_max": 30, "warn_above": 12, "matrix_max": 50, "max_det": None, "warn_det": 400}
_TRUE = ("1", "true", "yes", "on", "y", "t")
_FALSE = ("0", "false", "no", "off", "n", "f")


# ------------------------------------------------------------------------------------------------- small helpers
def _is_num(x: Any) -> bool:
    """A finite JSON number (bools are not numbers; numpy scalars are)."""
    if isinstance(x, (bool, np.bool_)) or not isinstance(x, (int, float, np.integer, np.floating)):
        return False
    try:
        return math.isfinite(x)
    except OverflowError:  # an int too large for a float is not a finite number either
        return False


def _is_whole(x: Any) -> bool:
    """A finite number with a whole value whose size JavaScript holds exactly (|x| <= 2**53 - 1)."""
    return _is_num(x) and float(x).is_integer() and abs(x) <= _MAX_SAFE


def _whole(x: Any) -> int:
    return int(x)


def _float(x: Any) -> float:
    """``float(x)``, with integers too large for a float as (signed) infinity, as JavaScript holds them."""
    try:
        return float(x)
    except OverflowError:
        return math.inf if x > 0 else -math.inf


def _num(x: Any) -> str:
    """*x* as JavaScript's ``String(x)`` prints it: ``1``, ``0.5``, ``1000000``, ``1e+21``, ``1e-7``; ``-0`` as ``0``.

    The shortest digits that round-trip (``repr`` gives them, as JavaScript does), laid out by the rules of
    ``Number.prototype.toString``; ints beyond 2**53 - 1 are printed as the double JavaScript would hold.
    """
    if isinstance(x, (int, np.integer)) and not isinstance(x, (bool, np.bool_)):
        if abs(int(x)) <= _MAX_SAFE:
            return str(int(x))
        x = _float(int(x))
    v = float(x)
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    mant, _, exp = repr(abs(v)).partition("e")
    whole, _, frac = mant.partition(".")
    digits = whole + frac
    lead = len(digits) - len(digits.lstrip("0"))
    s = digits.strip("0")
    n = len(whole) - lead + (int(exp) if exp else 0)  # the value is 0.s × 10^n
    k = len(s)
    if k <= n <= 21:
        return sign + s + "0" * (n - k)
    if 0 < n <= 21:
        return sign + s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + s
    e = n - 1
    return sign + s[0] + ("." + s[1:] if k > 1 else "") + ("e+" if e >= 0 else "e-") + str(abs(e))


def _show(v: Any) -> str:
    """A value in a message: strings as they are, numbers as :func:`_num` prints them, anything else as JSON."""
    if isinstance(v, str):
        return v
    if isinstance(v, (bool, np.bool_)):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float, np.integer, np.floating)):
        return _num(v)
    try:
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return str(v)


def _label(spec: dict[str, Any]) -> str:
    return str(spec.get("label") or spec.get("name") or "Value")


def _seq(value: Any) -> list[Any] | None:
    """*value* as a list when it is a list, tuple or array, else ``None`` (a string is not a list here)."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    return list(value) if isinstance(value, (list, tuple)) else None


def _limit(spec: dict[str, Any], key: str, default: Any) -> Any:
    """A limit of the schema: the default when the field is not given, ``None`` (no limit) when it is given as None."""
    return spec[key] if key in spec else default


def _bound(spec: dict[str, Any], key: str) -> Any:
    """The numeric bound ``min``/``max`` of an int or float parameter, or ``None``."""
    v = spec.get(key)
    return v if _is_num(v) else None


def _flag(spec: dict[str, Any], key: str, default: bool = False) -> bool:
    return bool(spec[key]) if key in spec else default


def _named(p: Any) -> bool:
    return isinstance(p, dict) and p.get("name") is not None and p.get("name") != ""


def _copy(v: Any) -> Any:
    """A deep copy of a JSON-like value (lists, tuples and dicts; other values as they are)."""
    if isinstance(v, (list, tuple)):
        return [_copy(x) for x in v]
    if isinstance(v, dict):
        return {k: _copy(x) for k, x in v.items()}
    return v


def _same_json(a: Any, b: Any) -> bool:
    """JSON equality: numbers by value (``1 == 1.0``, bools are not numbers), lists and dicts item by item."""
    la, lb = _seq(a), _seq(b)
    if la is not None or lb is not None:
        return la is not None and lb is not None and len(la) == len(lb) and all(_same_json(x, y) for x, y in zip(la, lb))
    if isinstance(a, dict) or isinstance(b, dict):
        return (isinstance(a, dict) and isinstance(b, dict) and a.keys() == b.keys()
                and all(_same_json(a[k], b[k]) for k in a))
    if isinstance(a, (bool, np.bool_)) or isinstance(b, (bool, np.bool_)):
        return isinstance(a, (bool, np.bool_)) and isinstance(b, (bool, np.bool_)) and bool(a) == bool(b)
    if isinstance(a, (int, float, np.integer, np.floating)) and isinstance(b, (int, float, np.integer, np.floating)):
        return a == b
    return type(a) is type(b) and a == b


def _options(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """The options of a select parameter as ``[{"value", "label"}]``."""
    raw = _seq(spec.get("options"))
    if raw is None:
        return []
    out = []
    for o in raw:
        if isinstance(o, (list, tuple)):
            value = o[0] if o else None
            out.append({"value": value, "label": o[1] if len(o) > 1 and o[1] is not None else _show(value)})
        elif isinstance(o, dict):
            label = o.get("label")
            out.append({"value": o.get("value"), "label": label if label is not None else _show(o.get("value"))})
        else:
            out.append({"value": o, "label": _show(o)})
    return out


# ---------------------------------------------------------------------------------------------------- parsing
def _trim(t: str) -> str:
    return _TRIM.sub("", t)


def _js_number(x: Any) -> Any:
    """A parsed number as JavaScript holds it: ints beyond 2**53 - 1 become (rounded) floats or infinity, -0.0 is 0.0."""
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x if abs(x) <= _MAX_SAFE else _float(x)
    return float(x) + 0.0


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def _json_indices(t: str) -> list | None:
    """The finite numbers (or rows of them) of a JSON text, or ``None`` when the text is not such a list."""
    try:
        v = json.loads(t, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return None
    if not isinstance(v, list):
        return None
    if all(_is_num(x) for x in v):
        return [_js_number(x) for x in v]
    if all(isinstance(r, list) and all(_is_num(x) for x in r) for r in v):
        return [[_js_number(x) for x in r] for r in v]
    return None


def _parse_row(row: str, fractions: bool) -> list:
    out: list = []
    for tok in _SPLIT.split(_trim(row)):
        if tok == "":
            continue
        f = _FRACTION.fullmatch(tok) if fractions else None
        if _NUMBER.fullmatch(tok):
            try:
                x = float(tok) + 0.0 if _FLOAT.search(tok) else _js_number(int(tok))
            except ValueError:  # more digits than int() reads: the double the text rounds to
                x = float(tok)
        elif f:
            if int(f.group(2)) == 0:
                raise ParamError(f"“{tok}” divides by zero")
            x = _float(int(f.group(1))) / _float(int(f.group(2)))
            if math.isnan(x):  # inf / inf
                x = math.inf
        else:
            raise ParamError(f"“{tok}” is not a number")
        if not math.isfinite(x):
            raise ParamError(f"“{tok}” is not a finite number")
        out.append(x)
    return out


def parse_indices(text: str, *, fractions: bool = False) -> list:
    """Numbers typed as text, for vectors, Miller indices and matrices: ``"[1, 1, 0]"``, ``"1 1 0"``, ``"1,1,0"``,
    ``"(1 0 1̅ 0)"``, ``"1 0 −1 0"``, ``"2 1 0; -1 1 0; 0 0 1"``, ``"[[2, 1], [-1, 1]]"``; with *fractions* also
    ``"1/3 2/3 0"``.  Returns a list of numbers, or a list of rows when the text has ``;`` (a trailing empty row is
    ignored) or is a JSON list of lists.

    A text starting with ``[`` or ``{`` that has a comma and is a JSON list of finite numbers (or of lists of them) is
    read as JSON.  Otherwise U+2212 counts as a minus sign, and a number written with a bar (U+0305 or U+0304) after
    each of its digits is negative, as the web app's ``formatIndices`` writes it (``1̅2̅`` is -12; a bar over only
    some digits is an error); one pair of outer brackets is dropped, rows are split at ``;`` and numbers at blanks and
    commas.  A number is an integer or a decimal (``1``, ``-2``, ``0.5``, ``.5``, ``1e-3``); every number must be
    finite; integers beyond 2**53 - 1 become floats, as in JavaScript.

    Raises :class:`ParamError` (``“x” is not a number``, ``“1e999” is not a finite number``, ``“1/0” divides by
    zero``); callers show their type's message instead.  JS: ``parseIndices``.
    """
    if not isinstance(text, str):
        raise TypeError("parse_indices: text must be a string")
    t = _trim(text)
    if t[:1] in ("[", "{") and "," in t:
        v = _json_indices(t)
        if v is not None:
            return v
    t = t.replace("\u2212", "-")
    t = _BAR_RUN.sub(lambda m: "-" + _BARS.sub("", m.group(0)) if _BARRED.fullmatch(m.group(0)) else m.group(0), t)
    if len(t) >= 2 and t[0] in _OPEN and t[-1] in _CLOSE:
        t = t[1:-1]
    if ";" not in t:
        return _parse_row(t, fractions)
    rows = [_parse_row(r, fractions) for r in t.split(";")]
    while rows and not rows[-1]:
        rows.pop()
    return rows


# --------------------------------------------------------------------------------------------------- coercion
def _size(spec: dict[str, Any], label: str) -> int:
    n = spec.get("size", 3)
    if n is None:
        n = 3
    if isinstance(n, bool) or n not in (2, 3):
        raise TypeError(f"{label}: size must be 2 or 3 (got {_show(n)})")
    return int(n)


def _vector_message(spec: dict[str, Any], label: str) -> str:
    n = spec.get("size", 3)
    whole = _flag(spec, "integer")
    if n == 2:
        return f"{label}: enter two whole numbers, like 1 0." if whole else f"{label}: enter two numbers, like 0.5 0.5."
    return f"{label}: enter three whole numbers, like 1 1 0." if whole else f"{label}: enter three numbers, like 0 0 1."


def _type_message(spec: dict[str, Any], label: str) -> str:
    """The message of a value that is not of the parameter's type at all (also used for unreadable text)."""
    kind = spec.get("type")
    if kind in ("int", "float"):
        return f"{label}: enter a number."
    if kind == "bool":
        return f"{label}: use true or false."
    if kind == "string":
        return f"{label}: enter text."
    if kind == "element":
        return f"{label}: enter an element symbol, like Cu."
    if kind == "vector":
        return _vector_message(spec, label)
    if kind == "miller":
        return f"{label}: enter three whole numbers (h k l) or four (h k i l), like 1 1 1."
    if kind == "imatrix":
        n = _size(spec, label)
        return f"{label}: enter a {n}×{n} matrix of whole numbers, rows separated by ';'."
    return f"{label}: enter a value."


def _in_range(spec: dict[str, Any], x: Any, label: str) -> Any:
    lo, hi = _bound(spec, "min"), _bound(spec, "max")
    if (lo is not None and x < lo) or (hi is not None and x > hi):
        a = f"{_MINUS}∞" if lo is None else _num(lo)
        b = "∞" if hi is None else _num(hi)
        raise ParamError(f"{label}: use a value from {a} to {b}.")
    return x


def _coerce_vector(spec: dict[str, Any], value: Any, label: str) -> list:
    n = _size(spec, label)
    msg = _vector_message(spec, label)
    items = _seq(value)
    if items is None or len(items) != n or not all(_is_num(x) for x in items):
        raise ParamError(msg)
    if _flag(spec, "integer"):
        if not all(_is_whole(x) for x in items):
            raise ParamError(msg)
        v: list = [_whole(x) for x in items]
    else:
        v = [float(x) + 0.0 for x in items]
    if _flag(spec, "nonzero") and all(x == 0 for x in v):
        raise ParamError(f"{label}: the vector cannot be zero.")
    return v


def _coerce_miller(spec: dict[str, Any], value: Any, label: str) -> list[int]:
    items = _seq(value)
    if items is None or len(items) not in (3, 4) or not all(_is_whole(x) for x in items):
        raise ParamError(_type_message(spec, label))
    v = [_whole(x) for x in items]
    if len(v) == 4:
        h, k, i, l = v
        if h + k + i != 0:
            raise ParamError(f"{label}: in (h k i l), i must be {_MINUS}(h + k) = {-(h + k)}.")
        v = [h, k, l]
    if all(x == 0 for x in v):
        raise ParamError(f"{label}: (0 0 0) is not a plane.")
    top = _limit(spec, "max", _DEFAULTS["miller_max"])
    if _is_num(top) and max(abs(x) for x in v) > top:
        raise ParamError(f"{label}: use indices from {_MINUS}{_num(top)} to {_num(top)}.")
    return v


def _determinant(m: Sequence[Sequence[int]]) -> int:
    """det of an integer matrix (2×2 or 3×3), exactly."""
    if len(m) == 2:
        return m[0][0] * m[1][1] - m[0][1] * m[1][0]
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _coerce_matrix(spec: dict[str, Any], value: Any, label: str) -> list[list[int]]:
    n = _size(spec, label)
    rows = _seq(value)
    if rows is not None and len(rows) == n * n and all(_is_num(x) for x in rows):
        rows = [rows[r * n:(r + 1) * n] for r in range(n)]  # n² numbers fill row by row
    grid = [_seq(r) for r in rows] if rows is not None else None
    if grid is None or len(grid) != n or not all(r is not None and len(r) == n and all(_is_num(x) for x in r) for r in grid):
        raise ParamError(_type_message(spec, label))
    if not all(_is_whole(x) for r in grid for x in r):  # type: ignore[union-attr]
        raise ParamError(f"{label}: every entry must be a whole number.")
    m = [[_whole(x) for x in r] for r in grid]  # type: ignore[union-attr]
    top = _limit(spec, "max", _DEFAULTS["matrix_max"])
    if _is_num(top) and max(abs(x) for r in m for x in r) > top:
        raise ParamError(f"{label}: use entries from {_MINUS}{_num(top)} to {_num(top)}.")
    det = _determinant(m)
    if det == 0:
        raise ParamError(f"{label}: the matrix is singular (determinant 0).")
    if det < 0 and _flag(spec, "positive", True):
        raise ParamError(f"{label}: the determinant is {det}; a negative determinant mirrors the cell. "
                         "Swap two rows or negate one.")
    max_det = _limit(spec, "maxDet", _DEFAULTS["max_det"])
    if _is_num(max_det) and abs(det) > max_det:
        raise ParamError(f"{label}: determinant {abs(det)} is too large (at most {_num(max_det)}).")
    return m


def coerce_param(spec: dict[str, Any], value: Any) -> Any:
    """The value of parameter *spec* normalized, or a :class:`ParamError` with the message to show.

    Only JSON values are accepted: numbers for ``int`` (whole) and ``float`` (finite, within ``min``/``max``),
    ``True``/``False`` for ``bool``, strings for ``string``, element symbols for ``element`` (any case: ``"cu"`` ->
    ``"Cu"``), one of the option values for ``select``, lists (or tuples, arrays) for the new types.  A string is never
    a number here (``"4"`` is not an int, ``"1 1 1"`` is not a Miller index): command-line text goes through
    :func:`parse_cli_value` first.  ``None``: ``<Label>: enter a value.`` when ``required``, else ``None``.  Other
    types are returned unchanged.  JS: ``coerceParam``.
    """
    if not isinstance(spec, dict):
        raise TypeError("coerce_param: spec must be a dict")
    label = _label(spec)
    if value is None:
        if _flag(spec, "required"):
            raise ParamError(f"{label}: enter a value.")
        return None
    kind = spec.get("type")
    if kind == "int":
        if not _is_num(value):
            raise ParamError(_type_message(spec, label))
        if not _is_whole(value):
            raise ParamError(f"{label}: enter a whole number.")
        return _in_range(spec, _whole(value), label)
    if kind == "float":
        if not _is_num(value):
            raise ParamError(_type_message(spec, label))
        return _in_range(spec, float(value) + 0.0, label)
    if kind == "bool":
        if not isinstance(value, (bool, np.bool_)):
            raise ParamError(_type_message(spec, label))
        return bool(value)
    if kind == "string":
        if not isinstance(value, str):
            raise ParamError(_type_message(spec, label))
        if value == "" and _flag(spec, "required"):
            raise ParamError(f"{label}: enter a value.")
        return value
    if kind == "element":
        if not isinstance(value, str):
            raise ParamError(_type_message(spec, label))
        t = value.strip(" \t\n\r")
        if t == "" and _flag(spec, "required"):
            raise ParamError(f"{label}: enter a value.")
        sym = t[0].upper() + t[1:].lower() if re.fullmatch(r"[A-Za-z]{1,3}", t) else ""
        if not sym or not is_element(sym):
            raise ParamError(_type_message(spec, label))
        return sym
    if kind == "select":
        if callable(spec.get("options")):
            return value
        opts = _options(spec)
        if not opts:
            return value
        for o in opts:
            if _same_json(o["value"], value):
                return _copy(o["value"])
        raise ParamError(f"{label}: use one of {', '.join(_show(o['value']) for o in opts)}.")
    if kind == "vector":
        return _coerce_vector(spec, value, label)
    if kind == "miller":
        return _coerce_miller(spec, value, label)
    if kind == "imatrix":
        return _coerce_matrix(spec, value, label)
    return value


def _soft_warnings(spec: dict[str, Any], value: Any) -> list[str]:
    """The soft warnings of a coerced value (they never block): high Miller indices, large matrix determinants."""
    kind = spec.get("type")
    if kind == "miller":
        above = _limit(spec, "warnAbove", _DEFAULTS["warn_above"])
        if _is_num(above) and max(abs(x) for x in value) > above:
            return ["High-index plane; the surface cell may be large."]
    elif kind == "imatrix":
        warn_det = _limit(spec, "warnDet", _DEFAULTS["warn_det"])
        size = abs(_determinant(value))
        if _is_num(warn_det) and size > warn_det:
            return [f"This makes {size}× the atoms."]
    return []


def _unknown_message(title: Any, key: str, names: list[str]) -> str:
    known = f"use {', '.join(names)}" if names else "it takes no parameters"
    head = "" if title is None else re.sub(r"(?:…|\.\.\.)\s*$", "", str(title)).strip()
    return f"{head}: unknown parameter “{key}” ({known})." if head else f"Unknown parameter “{key}” ({known})."


def validate_params(schema: Sequence[dict[str, Any]] | None, values: dict[str, Any] | None, *, strict: bool = False,
                    title: str | None = None) -> tuple[dict[str, Any], list[str], list[str]]:
    """Check the parameter *values* (a dict; ``None`` means none) against *schema*.

    Returns ``(values, errors, warnings)``: the normalized values, the messages of the values that do not fit (each
    starting with its field's label) and soft warnings.  A parameter that is not given (or is ``None``) takes its
    ``default`` when the schema has one (also a ``None`` default) and is otherwise left out: nothing is made up for the
    caller.  A missing ``required`` parameter is an error, ``<Label>: enter a value.``.  Keys the schema does not have
    are kept as they are, or with *strict* each is an error, ``<title>: unknown parameter “key” (use a, b, c).``
    (*title* without a trailing ellipsis).  A *schema* that is not a list (``None``: no parameters) or *values* that
    are not a dict raise :class:`TypeError`.  JS: ``validateParams`` (returning ``{values, errors, warnings}``).
    """
    if schema is not None and not isinstance(schema, (list, tuple)):
        raise TypeError("validate_params: schema must be a list")
    given = {} if values is None else values
    if not isinstance(given, dict):
        raise TypeError("validate_params: values must be a dict")
    specs = [p for p in schema or () if _named(p)]
    names = [str(p["name"]) for p in specs]
    known = set(names)
    out: dict[str, Any] = {}
    errors: list[str] = []
    warnings: list[str] = []
    extra = []
    for k in given:
        if k in known:
            continue
        if strict:
            errors.append(_unknown_message(title, str(k), names))
        else:
            extra.append(k)
    for p in specs:
        name = str(p["name"])
        v = given.get(name)
        if v is None:
            if _flag(p, "required"):
                errors.append(f"{_label(p)}: enter a value.")
            elif "default" in p:
                out[name] = _copy(p["default"])
            continue
        try:
            c = coerce_param(p, v)
        except ParamError as exc:
            errors.append(str(exc))
            continue
        out[name] = c
        warnings.extend(_soft_warnings(p, c))
    for k in extra:
        out[k] = given[k]
    return out, errors, warnings


def default_params(schema: Sequence[dict[str, Any]] | None) -> dict[str, Any]:
    """The values a form starts with: each parameter's ``default`` (a copy; a ``None`` default stays ``None``), else the
    default of its type: False for ``bool``, the first option for ``select``, ``min`` (or 0) for ``int`` and ``float``,
    ``"C"`` for ``element``, zeros for ``vector``, ``[1, 1, 1]`` for ``miller``, the unit matrix for ``imatrix``, ``""``
    otherwise; ``None`` (an empty box) for a ``required`` parameter without a default, except ``bool`` and ``select``.
    The parameters are those :func:`validate_params` reads (a name that is neither ``None`` nor ``""``); a *schema*
    that is not a list (``None``: none) raises :class:`TypeError`.  JS: ``defaultParams(schema, structure)`` (where
    options may be a function of the structure).
    """
    if schema is not None and not isinstance(schema, (list, tuple)):
        raise TypeError("default_params: schema must be a list")
    out: dict[str, Any] = {}
    for p in schema or ():
        if not _named(p):
            continue
        out[str(p["name"])] = _copy(p["default"]) if "default" in p else _type_default(p)
    return out


def _type_default(p: dict[str, Any]) -> Any:
    kind = p.get("type")
    if _flag(p, "required") and kind not in ("bool", "select"):
        return None
    n = 2 if p.get("size") == 2 else 3
    if kind == "bool":
        return False
    if kind == "select":
        opts = _options(p)
        return _copy(opts[0]["value"]) if opts else None
    if kind in ("int", "float"):
        return p["min"] if _is_num(p.get("min")) else 0
    if kind == "element":
        return "C"
    if kind == "vector":
        return [0] * n
    if kind == "miller":
        return [1, 1, 1]
    if kind == "imatrix":
        return [[1 if r == c else 0 for c in range(n)] for r in range(n)]
    return ""


# ---------------------------------------------------------------------------------------------- command line
def _cli_text(v: Any) -> str:
    """How an option value is typed on the command line (``2``, ``0.5``, ``true``, ``fcc``)."""
    return _show(v)


def parse_cli_value(spec: dict[str, Any] | None, text: str) -> Any:
    """A command-line string (``--param KEY=VALUE``) as the JSON value :func:`coerce_param` expects, by type.

    ``int`` and ``float``: ``int()`` / ``float()`` (an int parameter also takes ``2.0`` or ``1e3``, which
    :func:`coerce_param` checks for a whole value); ``bool``: ``1/true/yes/on/y/t`` or ``0/false/no/off/n/f`` (any
    case); ``string`` and ``element``: the text; ``select``: the option whose value is written as *text* (``2`` for the
    option 2), else the text; ``vector`` (with fractions ``1/3`` unless ``integer``), ``miller`` and ``imatrix``:
    :func:`parse_indices`, so ``1,0,-1,0`` and ``"2 1 0; -1 1 0; 0 0 1"`` work.  An empty text for a ``required``
    parameter (other than a string) is ``<Label>: enter a value.``.  Unreadable text raises :class:`ParamError` with
    the type's message.  No schema or another type: JSON if the text parses, else the text (the rule before typed
    parameters).
    """
    spec = spec if isinstance(spec, dict) else {}
    kind = spec.get("type")
    label = _label(spec)
    if kind not in (None, "string") and text.strip() == "" and _flag(spec, "required"):
        raise ParamError(f"{label}: enter a value.")
    if kind == "int":
        try:
            return int(text)
        except ValueError:
            pass
        try:
            return float(text)
        except ValueError:
            raise ParamError(_type_message(spec, label)) from None
    if kind == "float":
        try:
            return float(text)
        except ValueError:
            raise ParamError(_type_message(spec, label)) from None
    if kind == "bool":
        v = text.strip().lower()
        if v in _TRUE:
            return True
        if v in _FALSE:
            return False
        raise ParamError(_type_message(spec, label))
    if kind in ("string", "element"):
        return text
    if kind == "select":
        for o in _options(spec):
            if _cli_text(o["value"]) == text:
                return _copy(o["value"])
        return text
    if kind in ("vector", "miller", "imatrix"):
        try:
            return parse_indices(text, fractions=kind == "vector" and not _flag(spec, "integer"))
        except ValueError:
            raise ParamError(_type_message(spec, label)) from None
    try:
        return json.loads(text)
    except ValueError:
        return text
