"""XYZ and extended XYZ (extxyz) reader/writers, compatible with ASE 3.29.

Reading handles plain XYZ (``symbol x y z [ignored...]``; the comment line is the name) and the extended XYZ
convention where the comment line carries ``key=value`` pairs, notably::

    Lattice="ax ay az bx by bz cx cy cz" Properties=species:S:1:pos:R:3:forces:R:3 pbc="T T T" energy=-12.5

**Comment line.**  :func:`kv_tokenize` splits it like ASE's ``key_val_str_to_dict``: values may be quoted with
``"..."``, ``'...'``, ``{...}`` or ``[...]``, a backslash takes the next character as it is, and ``key = value`` may
have spaces around ``=``.  ``Lattice``, ``Properties`` and ``pbc`` (in any letter case) describe the frame, ``name``
is the structure name (always text), and every other pair goes to ``info`` through :func:`convert_value` (integers,
floats, booleans and lists of them, ``_JSON`` values; anything else stays text).  Words without ``=`` on such a line
are free text, kept (joined by single spaces) in ``info["comment"]`` unless the line has a ``comment=`` pair; ASE
would read each of them as a flag set to True.  A comment line without any ``key=value`` pair is the name.

**Columns.**  ``Properties`` lists ``name:type:width`` triples (types R, I, L and S in any letter case; other letters
are read as S).  Every column becomes ``props[name]`` (one value per atom, a list for widths above 1), except the
element column (``species``, ``element`` or ``symbols``; else ``Z`` or ``numbers``), the positions (``pos`` or
``positions``) and the constraints: ASE's ``move_mask`` (True = may move, along x, y and z; one column for whole
atoms) and the ``selective_dynamics`` column that Crystallume 0.3.1 wrote (along a, b and c) become
``props["selective_dynamics"]`` (along a, b and c, see :mod:`facet.core.constraints`).  A ``charge`` column is
read as ``charges``, ASE's name for calculated charges (input charges are ``initial_charges``).

**Writing** (:func:`write_extxyz`): ``Lattice`` (when there is a cell), ``Properties``, ``pbc``, ``name``, then the
other info in the form of :func:`format_info_value`, which ASE and this reader read back unchanged.  The columns
after ``species`` and ``pos`` are those of :func:`extxyz_columns`: the constraints as ``move_mask`` (one column when
every atom is fixed or free, three otherwise, none when every atom is free; the ``selective_dynamics`` column is no
longer written), then every property that fits a column.  Calculated results (:data:`RESULT_PROPS`,
:data:`RESULT_INFO`) describe the first frame and are written for it only.  The notes (``info["warnings"]``),
``format``, ``filename`` and ``source`` are not written.

Multiple concatenated frames are supported: :func:`read_xyz` returns one structure per frame, and
:func:`facet.io.parse_text` joins them into one trajectory with the properties and info of the first frame.

Lines end with ``\\n``, ``\\r\\n`` or ``\\r``; whitespace is what :meth:`str.isspace` accepts.  The JavaScript twin is
``facet/web/js/io/xyz.js``, with the same rules and messages; the shared cases are
``tests/data/surface/f0d/extxyz.json``.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Sequence

import numpy as np

from ..core import constraints as _con
from ..core.elements import normalize_symbol
from ..core.structure import RESULT_INFO, RESULT_PROPS, Structure, add_warning

__all__ = [
    "read_xyz",
    "write_xyz",
    "write_extxyz",
    "parse_comment",
    "kv_tokenize",
    "convert_value",
    "format_info_value",
    "extxyz_columns",
]

#: The characters :meth:`str.isspace` accepts, as a regular-expression class (the JS twin spells out the same list).
_WS = "\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"
_LINES_RE = re.compile(r"\r\n|\r|\n")
_SPLIT_RE = re.compile(r"[ \t,]+")                       # parts of a value: ASCII spaces, tabs and commas
_INT_RE = re.compile(r"[+-]?[0-9]+", re.ASCII)
_DIGITS_RE = re.compile(r"[0-9]+", re.ASCII)              # atom counts and column widths
_FLOAT_RE = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][+-]?[0-9]+)?", re.ASCII)
_BOOL_RE = re.compile(r"t|true|f|false", re.ASCII | re.IGNORECASE)
_NEEDS_QUOTES_RE = re.compile(f"[{_WS}\"'=\\\\{{}}\\[\\]]")
_LINE_BREAK_RE = re.compile(r"[\r\n]")
_INFO_KEY_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_\-.:]*", re.ASCII)
_COLUMN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*", re.ASCII)
_MAX_SAFE = 2**53 - 1
_JSON_PREFIX = "_JSON "
_DELIMITERS = {"'": "'", '"': '"', "{": "}", "[": "]"}
_ASE_SPLIT_RE = re.compile(f"[^{_WS},]+")                # how ASE splits a value (re.findall(r'[^\s,]+', value))
_ASE_BOOLS = frozenset({"T", "F", "true", "false", "True", "False", "TRUE", "FALSE"})

_RESERVED_KEYS = ("lattice", "properties", "pbc")
#: Info keys that are never written: set by the reading code, the notes (F0-D 3.6), and the name (written apart).
_SKIP_INFO = ("format", "filename", "source", "warnings", "name")
#: ASE reads these info keys as 3x3 matrices and fails on anything but 9 numbers.
_SPECIAL_3X3 = ("stress", "virial")
_ELEMENT_COLUMNS = ("species", "element", "symbols")
_NUMBER_COLUMNS = ("z", "numbers")
_POSITION_COLUMNS = ("pos", "positions")
#: Property names that are not written as columns: the reader (or ASE) gives these columns a meaning of their own.
_RESERVED_COLUMNS = frozenset(_ELEMENT_COLUMNS + _NUMBER_COLUMNS + _POSITION_COLUMNS + ("move_mask",))
#: Numeric properties written as R columns even when every value is a whole number (ASE expects floats for them).
_FLOAT_COLUMNS = frozenset(RESULT_PROPS) | {"masses", "initial_charges", "initial_magmoms", "momenta", "velocities",
                                            "occupancy"}
_MOVE_MASK = "move_mask"
_TRUE_TOKENS = ("T", "TRUE", "1")
_CONSTRAINT_MODES = ("exact", "fix-partial")
_NAME_LIMIT = 120

_MISSING = "it has missing values"
_RAGGED = "its rows have different lengths"
_MIXED = "its values are not all numbers, booleans or single words"
_BAD_NAME = "its name is not a valid column name"


# ------------------------------------------------------------------------------------------------- comment line
def kv_tokenize(line: str) -> list[tuple[str, str | None]]:
    """The ``key=value`` pairs of an extended XYZ comment line, split like ASE's ``key_val_str_to_dict``.

    Character by character: a backslash adds the next character as it is; within quotes (``"``, ``'``) or brackets
    (``{}``, ``[]``) everything up to the matching closing character is added as it is; whitespace ends a word (a run
    of it counts once); ``=`` starts the value of the current key (further ``=`` signs stay in the value).  Returns
    ``[(key, raw_value)]`` in order, ``raw_value`` ``None`` for a word without ``=`` (ASE reads it as True).  Pairs
    with an empty key are dropped (ASE fails on such lines).  Nothing is converted, see :func:`convert_value`::

        kv_tokenize('a=1 b="x y" c={4 5} flag d=[1,2]')
        # [('a', '1'), ('b', 'x y'), ('c', '4 5'), ('flag', None), ('d', '1,2')]
    """
    pairs: list[list[list[str]]] = [[[]]]
    closing: str | None = None
    escaped = False
    for ch in line.strip():
        if escaped:
            pairs[-1][-1].append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif closing is not None:
            if ch == closing:
                closing = None
            else:
                pairs[-1][-1].append(ch)
        elif ch in _DELIMITERS:
            closing = _DELIMITERS[ch]
        elif ch.isspace():
            if pairs[-1][-1]:
                pairs.append([[]])
        elif ch == "=":
            if pairs[-1] == [[]]:
                pairs.pop()
                if not pairs:          # the line starts with "=": an empty key, dropped below
                    pairs.append([[]])
            pairs[-1].append([])
        else:
            pairs[-1][-1].append(ch)
    out: list[tuple[str, str | None]] = []
    for pair in pairs:
        key = "".join(pair[0])
        if key:
            out.append((key, None) if len(pair) == 1 else (key, "=".join("".join(part) for part in pair[1:])))
    return out


def parse_comment(comment: str) -> tuple[dict[str, str], str]:
    """Split an XYZ comment line into ``({key: raw_value}, free_text)`` with :func:`kv_tokenize`.

    The free text is the words without ``=``, joined by single spaces; of two pairs with the same key the later one
    counts.
    """
    pairs: dict[str, str] = {}
    words: list[str] = []
    for key, raw in kv_tokenize(comment):
        if raw is None:
            words.append(key)
        else:
            pairs[key] = raw
    return pairs, " ".join(words)


def _int_value(token: str) -> int | float:
    """An INT token as an int, or as a float beyond 2**53 - 1 (what JavaScript can hold exactly)."""
    value = int(token)
    return value if -_MAX_SAFE <= value <= _MAX_SAFE else float(token)


def _float_value(token: str) -> float:
    return float(token.replace("d", "e").replace("D", "e"))


def _json_int(text: str) -> int | float:
    return _int_value(text)


def _no_constant(name: str) -> Any:
    raise ValueError(f"{name} is not a JSON number")


def _all_finite(value: Any) -> bool:
    """Whether every number in *value* (nested lists and dicts included) is finite."""
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_all_finite(v) for v in value)
    if isinstance(value, dict):
        return all(_all_finite(v) for v in value.values())
    return True


def convert_value(raw: str | None) -> Any:
    """The value of one ``key=value`` pair of the comment line (*raw* as :func:`kv_tokenize` gives it), for ``info``.

    - ``None`` (a word without ``=``): ``True``;
    - ``_JSON <json>``: the decoded JSON value (integers beyond 2**53 - 1 as floats, as JavaScript reads them); text
      that is not valid JSON, or that holds NaN or an infinite number, stays as it is;
    - otherwise the parts between ASCII spaces, tabs and commas, when all of them are integers: an int (one part) or
      a list of ints (beyond 2**53 - 1 as floats); all integers or decimals (``1.5``, ``.5``, ``1e5``, the Fortran
      ``1.5D3``): floats; all ``T``, ``true``, ``F`` or ``false`` in any letter case: bools;
    - anything else, numbers that overflow included: the text as it is.

    Only ASCII digits count, and Python's own conversions are not used: ``int("1_000")``, ``float("inf")`` and
    ``int("\u0661\u0662")`` would accept more than JavaScript does.  ``inf`` and ``nan`` stay text, so ``info`` can always be
    written as JSON.
    """
    if raw is None:
        return True
    if raw.startswith(_JSON_PREFIX):
        try:
            value = json.loads(raw[len(_JSON_PREFIX):], parse_int=_json_int, parse_constant=_no_constant)
        except (ValueError, RecursionError):
            return raw
        return value if _all_finite(value) else raw
    parts = [p for p in _SPLIT_RE.split(raw) if p]
    if not parts:
        return raw
    if all(_INT_RE.fullmatch(p) for p in parts):
        values: list[Any] = [_int_value(p) for p in parts]
    elif all(_FLOAT_RE.fullmatch(p) for p in parts):
        values = [_float_value(p) for p in parts]
    elif all(_BOOL_RE.fullmatch(p) for p in parts):
        values = [p[0] in "tT" for p in parts]
    else:
        return raw
    if not _all_finite(values):
        return raw
    return values[0] if len(values) == 1 else values


def _decode_failed(raw: str | None, value: Any) -> bool:
    return raw is not None and raw.startswith(_JSON_PREFIX) and value is raw


# --------------------------------------------------------------------------------------------------- info values
def _escape(text: str) -> str:
    """*text* as one value of the comment line: quoted (``\\`` and ``"`` escaped) when it is empty or holds
    whitespace, quotes, ``=``, braces, brackets or a backslash."""
    if text == "" or _NEEDS_QUOTES_RE.search(text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _ase_keeps_text(text: str) -> bool:
    """Whether ASE's extxyz reader keeps *text* (a value without ``_JSON``) as a string.

    ASE reads a value as numbers when every part between whitespace and commas is accepted by Python's ``float()``
    (``inf``, ``1_000``, Unicode digits included), and as booleans when every part is T, F, true, false, True, False,
    TRUE or FALSE; a value without parts becomes an empty array.
    """
    parts = _ASE_SPLIT_RE.findall(text)
    if not parts or all(p in _ASE_BOOLS for p in parts):
        return False
    try:
        for p in parts:
            float(p)
    except ValueError:
        return True
    return False


def _plain(value: Any) -> Any:
    """numpy arrays and scalars as Python lists and numbers, tuples as lists (recursively)."""
    if isinstance(value, np.ndarray):
        return _plain(value.tolist())
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _int_text(x: int) -> str | None:
    try:
        float(x)
    except OverflowError:        # read back it would become an infinite float
        return None
    return str(x)


def _float_text(x: int | float) -> str | None:
    try:
        f = float(x)
    except OverflowError:
        return None
    return repr(f) if math.isfinite(f) else None


def _number_text(x: Any, key: str) -> str | None:
    """A finite number: an int in decimal (as a float for the calculated results of RESULT_INFO), a float as
    ``repr``; ``None`` for anything else."""
    if not _is_number(x):
        return None
    if isinstance(x, int) and key not in RESULT_INFO:
        return _int_text(x)
    return _float_text(x)


def _flat3x3(value: Any) -> list[Any] | None:
    """``stress``/``virial`` as 9 values (row by row): a 3x3 nested list, 9 values, or 6 Voigt components
    ``xx yy zz yz xz xy`` (expanded like ASE's ``voigt_6_to_full_3x3_stress``)."""
    if not isinstance(value, list):
        return None
    if len(value) == 3 and all(isinstance(r, list) and len(r) == 3 for r in value):
        return [x for r in value for x in r]
    if len(value) == 9:
        return list(value)
    if len(value) == 6:
        xx, yy, zz, yz, xz, xy = value
        return [xx, xy, xz, xy, yy, yz, xz, yz, zz]
    return None


def _json_text(value: Any) -> str | None:
    try:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        return None
    return _escape(_JSON_PREFIX + text)


def format_info_value(key: str, value: Any) -> str | None:
    """*value* written for ``key=<here>`` on the comment line, so that ASE and :func:`convert_value` read it back
    unchanged; ``None`` when it cannot be written (skip the key).

    - ``None``: skipped; a bool: ``T`` or ``F``;
    - a finite number: an int in decimal (for the calculated results of :data:`RESULT_INFO` as a float, ``5.0``), a
      float as ``repr``; NaN and infinities are skipped;
    - ``stress`` and ``virial``: a 3x3 nested list, 9 numbers or 6 Voigt components ``xx yy zz yz xz xy`` as 9
      quoted numbers, row by row (ASE reads nothing else for these keys; any other value is skipped);
    - a string: as it is (quoted when needed) when it has no line break and both :func:`convert_value` and ASE read
      it back as this string, otherwise as a ``_JSON`` string, so ``"225"``, ``"T"``, ``"1 2 3"``, ``""``, ``"inf"``
      and ``"1_000"`` stay strings;
    - a flat list of two or more bools (``"T F T"``) or finite numbers (``"2 2 1"``; floats when one is a float);
    - any other list or dict (one item, nested, strings, mixed types): ``_JSON`` and compact JSON; skipped when it
      cannot be JSON (NaN, infinities, other objects).

    Quoted values escape ``\\`` and ``"`` (ASE does not escape the backslash, so its own ``_JSON`` text with quotes
    or backslashes does not read back; this one does).
    """
    value = _plain(value)
    if key in _SPECIAL_3X3:
        flat = _flat3x3(value)
        texts = [_number_text(x, key) for x in flat] if flat is not None else [None]
        return None if None in texts else '"' + " ".join(texts) + '"'   # type: ignore[arg-type]
    if value is None:
        return None
    if isinstance(value, bool):
        return "T" if value else "F"
    if _is_number(value):
        return _number_text(value, key)
    if isinstance(value, str):
        if value and not _LINE_BREAK_RE.search(value) and not value.startswith(_JSON_PREFIX) \
                and convert_value(value) == value and _ase_keeps_text(value):
            return _escape(value)
        return _json_text(value)
    if isinstance(value, list) and len(value) >= 2:
        if all(isinstance(x, bool) for x in value):
            return '"' + " ".join("T" if x else "F" for x in value) + '"'
        if all(_is_number(x) for x in value):
            whole = all(isinstance(x, int) for x in value) and key not in RESULT_INFO
            texts = [_int_text(x) if whole else _float_text(x) for x in value]
            if None not in texts:
                return '"' + " ".join(texts) + '"'   # type: ignore[arg-type]
    if isinstance(value, (list, dict)):
        return _json_text(value)
    return None


def _info_pairs(info: dict[str, Any], *, results: bool) -> list[str]:
    """The ``key=value`` texts of *info* (without the calculated results of RESULT_INFO when *results* is False)."""
    out = []
    for key, value in info.items():
        if not isinstance(key, str) or key in _SKIP_INFO or not _INFO_KEY_RE.fullmatch(key) \
                or key.lower() in _RESERVED_KEYS or (not results and key in RESULT_INFO):
            continue
        text = format_info_value(key, value)
        if text is not None:
            out.append(f"{key}={text}")
    return out


# ------------------------------------------------------------------------------------------------------ columns
def _column_of(key: str, values: Sequence[Any]) -> dict[str, Any] | str:
    """Property *key* as a column ``{"name", "type", "width", "values"}``, or the reason it cannot be one."""
    if not _COLUMN_RE.fullmatch(key) or key.lower() in _RESERVED_COLUMNS:
        return _BAD_NAME
    rows: list[list[Any]] = []
    for v in values:
        if isinstance(v, np.ndarray):
            v = v.tolist()
        if isinstance(v, (list, tuple)):
            row = [x.item() if isinstance(x, np.generic) else x for x in v]
        else:
            row = [v.item() if isinstance(v, np.generic) else v]
        if not row or any(x is None for x in row):
            return _MISSING
        rows.append(row)
    if not rows:
        return _MISSING
    width = len(rows[0])
    if any(len(r) != width for r in rows):
        return _RAGGED
    kind = None
    for row in rows:
        for x in row:
            if isinstance(x, bool):
                t = "L"
            elif isinstance(x, int):
                t = "I"
            elif isinstance(x, float) and math.isfinite(x):
                t = "R"
            elif isinstance(x, str) and x and not any(c.isspace() for c in x):
                t = "S"
            else:
                return _MIXED
            if kind is None or kind == t:
                kind = t
            elif {kind, t} == {"I", "R"}:
                kind = "R"
            else:
                return _MIXED
    if kind == "I" and key in _FLOAT_COLUMNS:
        kind = "R"
    if kind == "R":
        rows = [[float(x) for x in r] for r in rows]
    elif kind == "I" and any(_int_text(x) is None for r in rows for x in r):
        return _MIXED
    return {"name": key, "type": kind, "width": width, "values": [r[0] for r in rows] if width == 1 else rows}


def _move_mask_column(structure: Structure, constraints: str) -> dict[str, Any] | None:
    """The ``move_mask`` column (ASE: True = may move along x, y, z) of the constraint flags, or ``None``."""
    if _con.MOVE_FLAGS_KEY not in structure.props:
        return None
    flags = _con.move_flags(structure)
    if all(all(row) for row in flags):
        return None                  # every atom free: ASE writes no column either
    mask, tightened = _con.lattice_to_cartesian_mask(flags, structure.cell)
    if constraints == "fix-partial":
        mask = [[False, False, False] if (any(r) and not all(r)) else r for r in mask]
    if all(all(r) or not any(r) for r in mask):
        return {"name": _MOVE_MASK, "type": "L", "width": 1, "values": [r[0] for r in mask], "tightened": tightened}
    return {"name": _MOVE_MASK, "type": "L", "width": 3, "values": mask, "tightened": tightened}


def _columns(structure: Structure, constraints: str) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    if constraints not in _CONSTRAINT_MODES:
        raise ValueError('constraints must be "exact" or "fix-partial"')
    columns: list[dict[str, Any]] = []
    skipped: list[tuple[str, str]] = []
    mm = _move_mask_column(structure, constraints)
    if mm is not None:
        columns.append(mm)
    for key, values in structure.props.items():
        if key == _con.MOVE_FLAGS_KEY:
            continue
        col = _column_of(str(key), values)
        if isinstance(col, str):
            skipped.append((str(key), col))
        else:
            columns.append(col)
    return columns, skipped


def extxyz_columns(structure: Structure) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    """The per-atom columns :func:`write_extxyz` writes after ``species`` and ``pos``, and the properties it leaves out.

    ``columns`` lists ``{"name", "type", "width", "values"}`` in file order (``type`` R, I, L or S; ``values`` one
    value per atom, a list for widths above 1): first ``move_mask`` when an atom is fixed or partly fixed, along x, y
    and z of the cell of frame 0, with ``tightened``, the number of atoms whose constraints along the cell vectors
    have no exact Cartesian form and were tightened (see
    :func:`~facet.core.constraints.lattice_to_cartesian_mask`); then the properties in their order.
    ``skipped`` lists ``(key, reason)`` for each property that does not fit a column, the reason being ``it has
    missing values``, ``its rows have different lengths``, ``its values are not all numbers, booleans or single
    words`` or ``its name is not a valid column name`` (also for the names the reader gives a meaning, such as
    ``pos``, ``Z`` or ``move_mask``).  Numbers become I (all whole) or R columns; results, masses, charges, magnetic
    moments, momenta, velocities and occupancies are always R.
    """
    return _columns(structure, "exact")


def _column_token(kind: str, value: Any) -> str:
    if kind == "L":
        return "T" if value else "F"
    if kind == "I":
        return str(value)
    if kind == "R":
        return f"{value:.8f}"
    return str(value)


# ------------------------------------------------------------------------------------------------------ reading
def _clip(text: str, n: int = 32) -> str:
    return text[:n]


def _number_error(line: int, name: str, token: str, what: str = "a number") -> ValueError:
    return ValueError(f'XYZ: line {line}: column \'{name}\' expects {what}, found "{_clip(token)}"')


def _real(token: str) -> float | None:
    if not _FLOAT_RE.fullmatch(token):
        return None
    value = _float_value(token)
    return value if math.isfinite(value) else None


def _integer(token: str) -> int | float | None:
    if not _INT_RE.fullmatch(token):
        return None
    value = _int_value(token)
    return value if not isinstance(value, float) or math.isfinite(value) else None


def _parse_properties(raw: str, line: int) -> list[tuple[str, str, int]]:
    parts = raw.split(":")
    bad = ValueError(f'XYZ: line {line}: Properties must be name:type:width triples, found "{_clip(raw, 48)}"')
    if len(parts) % 3 or not raw:
        raise bad
    spec: list[tuple[str, str, int]] = []
    seen: set[str] = set()
    for k in range(0, len(parts), 3):
        name, kind, width = parts[k], parts[k + 1].upper(), parts[k + 2]
        if not name or not _DIGITS_RE.fullmatch(width) or int(width) < 1:
            raise bad
        if name in seen:
            raise ValueError(f"XYZ: line {line}: Properties lists the column '{name}' twice")
        seen.add(name)
        spec.append((name, kind if kind in ("R", "I", "L", "S") else "S", int(width)))
    return spec


def _first(spec: list[tuple[str, str, int]], names: tuple[str, ...]) -> int | None:
    return next((i for i, (n, _, _) in enumerate(spec) if n.lower() in names), None)


def _parse_frame(natoms: int, comment: str, atom_lines: list[str], start: int, frame: int) -> Structure:
    """One frame: *start* is the 0-based index of its atom-count line, *frame* its 1-based number."""
    head_line = start + 2                         # the comment line, 1-based
    pairs = kv_tokenize(comment)
    extended = any(raw is not None for _, raw in pairs)
    info: dict[str, Any] = {}
    notes: list[str] = []
    words: list[str] = []
    name = ""
    lattice = props_raw = pbc_raw = warnings_raw = None
    if extended:
        for key, raw in pairs:
            low = key.lower()
            if raw is None:
                words.append(key)
            elif low == "lattice":
                lattice = raw
            elif low == "properties":
                props_raw = raw
            elif low == "pbc":
                pbc_raw = raw
            elif low == "name":
                name = raw
            else:
                value = convert_value(raw)
                info[key] = value
                if key == "warnings":
                    warnings_raw = raw
                if _decode_failed(raw, value):
                    notes.append(f"info '{key}': could not decode the _JSON value; kept as text")
        if words and "comment" not in info:
            info["comment"] = " ".join(words)
        if warnings_raw is not None:    # notes of another program: kept as notes (shown once on import)
            w = info["warnings"]
            info["warnings"] = list(dict.fromkeys(w)) if isinstance(w, list) and all(isinstance(x, str) for x in w) \
                else [w if isinstance(w, str) else warnings_raw]
        for note in notes:
            add_warning(info, note)
    else:
        name = comment.strip()[:_NAME_LIMIT]

    cell = None
    if lattice is not None:
        parts = [p for p in _SPLIT_RE.split(lattice) if p]
        if len(parts) != 9:
            raise ValueError(f"XYZ: line {head_line}: Lattice needs 9 numbers, found {len(parts)}")
        vals = []
        for p in parts:
            v = _real(p)
            if v is None:
                raise ValueError(f'XYZ: line {head_line}: Lattice needs 9 numbers, found "{_clip(p)}"')
            vals.append(v)
        cell = np.array(vals, dtype=float).reshape(3, 3)
    pbc: list[bool] | None = None
    if pbc_raw is not None:
        flags = [t.upper() in _TRUE_TOKENS for t in _SPLIT_RE.split(pbc_raw) if t]
        pbc = flags if len(flags) == 3 else ([flags[0]] * 3 if flags else None)
    if pbc is None and cell is not None:
        pbc = [True, True, True]

    spec = [("species", "S", 1), ("pos", "R", 3)] if props_raw is None else _parse_properties(props_raw, head_line)
    el = _first(spec, _ELEMENT_COLUMNS)
    if el is None:
        el = _first(spec, _NUMBER_COLUMNS)
    if el is None or spec[el][2] != 1:
        raise ValueError(f"XYZ: line {head_line}: Properties must include species:S:1 (or Z:I:1)")
    numbers = spec[el][0].lower() in _NUMBER_COLUMNS
    pos = _first(spec, _POSITION_COLUMNS)
    if pos is None or spec[pos][2] != 3 or spec[pos][1] not in ("R", "I"):
        raise ValueError(f"XYZ: line {head_line}: Properties must include pos:R:3")
    starts, ncols = [], 0
    for _, _, width in spec:
        starts.append(ncols)
        ncols += width

    symbols: list[str] = []
    positions: list[list[float]] = []          # grown line by line: the count line may promise more than the file has
    columns: dict[int, list[Any]] = {i: [] for i in range(len(spec)) if i not in (el, pos)}
    for k in range(natoms):
        ln = start + 3 + k
        line = atom_lines[k] if k < len(atom_lines) else None
        toks = line.split() if line is not None else []
        if not toks or (len(toks) == 1 and _DIGITS_RE.fullmatch(toks[0])):   # blank, or the next frame's count
            raise ValueError(f"XYZ: file ended early at line {ln} (frame {frame} declares {natoms} atoms, found {k})")
        if len(toks) < ncols:
            if props_raw is None:
                raise ValueError(f'XYZ: line {ln}: expected an element and three coordinates, found '
                                 f'"{_clip(line.strip(), 48)}"')
            raise ValueError(f"XYZ: line {ln}: expected {ncols} columns, found {len(toks)}")
        tok = toks[starts[el]]
        if numbers:
            z = _integer(tok)
            if z is None or isinstance(z, float):
                raise _number_error(ln, spec[el][0], tok, "an integer")
            symbols.append(normalize_symbol(int(z)))
        else:
            symbols.append(normalize_symbol(tok))
        xyz = []
        for d in range(3):
            v = _real(toks[starts[pos] + d])
            if v is None:
                raise _number_error(ln, spec[pos][0], toks[starts[pos] + d])
            xyz.append(v)
        positions.append(xyz)
        for i, values in columns.items():
            cname, kind, width = spec[i]
            if cname == _MOVE_MASK:
                kind = "L"                # read as logical whatever type it declares
            row: list[Any] = []
            for tok in toks[starts[i]: starts[i] + width]:
                if kind == "R":
                    v = _real(tok)
                    if v is None:
                        raise _number_error(ln, cname, tok)
                elif kind == "I":
                    v = _integer(tok)
                    if v is None:
                        raise _number_error(ln, cname, tok, "an integer")
                elif kind == "L":
                    v = tok.upper() in _TRUE_TOKENS
                else:
                    v = tok
                row.append(v)
            values.append(row[0] if width == 1 else row)

    names = [spec[i][0] for i in columns]
    props: dict[str, Any] = {}
    mask = old = None
    mask_width = 0
    for i, values in columns.items():
        cname, _, width = spec[i]
        if cname == _MOVE_MASK:
            mask, mask_width = values, width
        elif cname == _con.MOVE_FLAGS_KEY:
            old = values
        elif cname == "charge" and "charges" not in names:
            props["charges"] = values
        else:
            props[cname] = values
    s = Structure(symbols, np.array(positions, dtype=float).reshape(-1, 3), cell=cell, pbc=pbc, props=props, info=info,
                  name=name)
    flags: Any = None
    if mask is not None:
        if mask_width == 1:
            flags = [[b, b, b] for b in mask]
        elif mask_width == 3:
            flags, tightened = _con.cartesian_to_lattice_flags(mask, s.cell)
            if tightened:
                add_warning(s.info, f"move_mask: the Cartesian constraints of {tightened} atom(s) do not follow the "
                                    "cell vectors and were tightened")
        else:
            add_warning(s.info, "move_mask must have 1 or 3 columns; it was ignored")
        if flags is not None and old is not None:
            add_warning(s.info, "both move_mask and selective_dynamics columns were found; move_mask was used")
    if flags is None and old is not None:
        flags = old
    if flags is not None:
        s.set_prop(_con.MOVE_FLAGS_KEY, flags)
    return s


def read_xyz(text: str) -> list[Structure]:
    """Parse (extended) XYZ text; returns one :class:`Structure` per frame.

    Errors name the line (``XYZ: line 12: column 'forces' expects a number, found "abc"``); notes go to
    ``info["warnings"]`` (a ``_JSON`` value that does not decode, constraints that were tightened or ignored).
    """
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = _LINES_RE.split(text)
    frames: list[Structure] = []
    i = 0
    nlines = len(lines)
    while i < nlines:
        toks = lines[i].split()
        if not toks:
            i += 1
            continue
        if not _DIGITS_RE.fullmatch(toks[0]):
            raise ValueError(f'XYZ: line {i + 1}: expected the number of atoms, found "{_clip(lines[i].strip(), 40)}"')
        natoms = int(toks[0])
        comment = lines[i + 1] if i + 1 < nlines else ""
        frames.append(_parse_frame(natoms, comment, lines[i + 2: i + 2 + natoms], i, len(frames) + 1))
        i += 2 + natoms
    if not frames:
        raise ValueError("XYZ: no frames found")
    return frames


# ------------------------------------------------------------------------------------------------------ writing
def _fmt(v: float) -> str:
    return f"{v:16.8f}"


def write_xyz(structure: Structure) -> str:
    """Plain XYZ: every frame as ``N / comment / symbol x y z``."""
    out: list[str] = []
    comment = _LINE_BREAK_RE.sub(" ", structure.name or structure.formula or "Facet")
    for frame in structure.iter_frames():
        out.append(str(len(frame)))
        out.append(comment)
        for s, p in zip(frame.symbols, frame.positions):
            out.append(f"{s:<3s}{_fmt(p[0])}{_fmt(p[1])}{_fmt(p[2])}")
    return "\n".join(out) + "\n"


def write_extxyz(structure: Structure, *, constraints: str = "exact") -> str:
    """Extended XYZ of every frame: ``Lattice``, ``Properties``, ``pbc``, ``name`` and the info, then one line per atom.

    The columns are those of :func:`extxyz_columns` (constraints as ASE's ``move_mask``, along x, y and z).
    ``constraints="fix-partial"`` writes every partly fixed atom as fixed, so that the mask is one column, which ASE
    reads as ``FixAtoms`` (its VASP writer ignores the per-axis ``FixCartesian`` of a three-column mask); it only ever
    tightens.  Calculated results (:data:`RESULT_PROPS` columns, :data:`RESULT_INFO` keys) are written for the first
    frame only: they describe it, not the others.  Without a cell there is no ``Lattice`` and ``pbc="F F F"``.
    """
    columns, _ = _columns(structure, constraints)
    later = [c for c in columns if c["name"] not in RESULT_PROPS]
    name = _LINE_BREAK_RE.sub(" ", structure.name or "")
    pbc = 'pbc="' + " ".join("T" if p else "F" for p in structure.pbc) + '"'
    out: list[str] = []
    for k in range(structure.n_frames):
        if k == 0:
            pos, cell = structure.positions, structure.cell
        else:
            fr = structure.frames[k - 1]
            pos = fr["positions"]
            cell = fr["cell"] if fr.get("cell") is not None else structure.cell
        cols = columns if k == 0 else later
        parts = []
        if cell is not None:
            parts.append('Lattice="' + " ".join(f"{v:.8f}" for v in np.asarray(cell, dtype=float).reshape(-1)) + '"')
        parts.append("Properties=species:S:1:pos:R:3" + "".join(f":{c['name']}:{c['type']}:{c['width']}" for c in cols))
        parts.append(pbc)
        if name:
            parts.append(f"name={_escape(name)}")
        parts.extend(_info_pairs(structure.info, results=k == 0))
        out.append(str(len(structure)))
        out.append(" ".join(parts))
        for i, (s, p) in enumerate(zip(structure.symbols, pos)):
            line = f"{s:<3s}{_fmt(p[0])}{_fmt(p[1])}{_fmt(p[2])}"
            for c in cols:
                v = c["values"][i]
                line += " " + (" ".join(_column_token(c["type"], x) for x in v) if c["width"] > 1
                               else _column_token(c["type"], v))
            out.append(line)
    return "\n".join(out) + "\n"
