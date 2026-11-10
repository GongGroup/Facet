"""Shared cross-language test cases (``facet.cases/1``): loader, op and recipe registries, runner, comparator.

A case file is a JSON document anywhere under ``tests/data`` (for example ``tests/data/surface/f0d/poscar.json``)::

    {"schema": "facet.cases/1",
     "cases": [{"id": "poscar-read-dot-true", "op": "read", "args": {"format": "poscar"},
                "input": {"text": "..."}, "expect": {"structure": {...}, "warnings": {"equals": []}},
                "tol": {"positions": 1e-6}}]}

Every case runs against the Python implementation (``tests/test_cases.py``) and against the web modules
(``tests/js/cases.test.mjs``, mirrored in ``tests/js/helpers.mjs`` and ``tests/js/cases.mjs``) with the same
expectation, so a case that passes on both sides is a cross-language parity check.  The format, the comparators
and the tolerances are documented in ``tests/data/surface/README.md``.

Each module registers its ops and recipes in its own ``tests/ops/<module>.py`` (imported by ``tests/ops``), never
here::

    from ..cases import CaseInput, op

    @op("findVacuumGap")
    def find_vacuum_gap_op(inp: CaseInput, args: dict) -> dict:
        return {"value": find_vacuum_gap(inp.structure, axis=args.get("axis"))}
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any, Callable

import numpy as np

from facet import Structure
from facet.io import parse_text

__all__ = [
    "SCHEMA",
    "DATA",
    "DEFAULT_TOL",
    "OPS",
    "RECIPES",
    "CaseFileError",
    "CaseInput",
    "op",
    "recipe",
    "load_cases",
    "resolve_input",
    "run_case",
    "compare",
    "snake_case",
    "snake_args",
]

SCHEMA = "facet.cases/1"
REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "tests" / "data"

#: Tolerances used when a case's ``tol`` does not give one: Cartesian positions and cell vectors in Å, ``value``
#: for every other number (``tol.props`` / ``tol.info`` / ``tol.<expect key>`` default to it).
DEFAULT_TOL: dict[str, float] = {"positions": 1e-6, "cell": 1e-6, "value": 1e-9}

CASE_KEYS = ("args", "expect", "id", "input", "note", "op", "skip", "tol", "xfail")
INPUT_KINDS = ("structure", "text", "file", "recipe")
STRUCTURE_KEYS = ("cell", "info", "nFrames", "name", "pbc", "positions", "props", "symbols")
WARNINGS_KEYS = ("contains", "count", "equals")
TEXT_KEYS = ("contains", "excludes")
TOL_KEYS = ("cell", "info", "positions", "props", "value")
LANGS = ("js", "py")

_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*\Z")
_MAX_PROBLEMS = 20

OpFunc = Callable[["CaseInput", dict[str, Any]], Any]
RecipeFunc = Callable[[dict[str, Any]], Structure]

#: Python side of every case op, by name (filled by the modules in ``tests/ops``).
OPS: dict[str, OpFunc] = {}
#: Structure constructors for ``"input": {"recipe": {"name": ..., "args": {...}}}``, by name.
RECIPES: dict[str, RecipeFunc] = {}


class CaseFileError(ValueError):
    """A ``facet.cases/1`` file (or a case in it) is malformed."""


# ------------------------------------------------------------------ registries
def _register(kind: str, table: dict[str, Any], name: str) -> Callable[[Any], Any]:
    if not isinstance(name, str) or not _NAME.match(name):
        raise ValueError(f"invalid {kind} name {_q(name)}")

    def deco(fn: Any) -> Any:
        if name in table:
            raise ValueError(f"{kind} {_q(name)} is already registered")
        table[name] = fn
        return fn

    return deco


def op(name: str) -> Callable[[OpFunc], OpFunc]:
    """Decorator: register the Python side of the case op *name* (camelCase, as written in the case files).

    The function gets ``(inp: CaseInput, args: dict)`` (``args`` as written, camelCase keys) and returns a
    :class:`Structure` or a dict of results keyed like ``expect`` (``structure``, ``value``, ``sourceMap``,
    ``warnings``, ``text`` or op-specific keys).  Registering a name twice raises :class:`ValueError`.
    """
    return _register("op", OPS, name)


def recipe(name: str) -> Callable[[RecipeFunc], RecipeFunc]:
    """Decorator: register a structure recipe; the function gets the recipe's ``args`` and returns a Structure.

    The JS recipe of the same name (``tests/js/ops/<module>.mjs``) must build the same structure; one case per
    recipe checks that.  Registering a name twice raises :class:`ValueError`.
    """
    return _register("recipe", RECIPES, name)


def snake_case(name: str) -> str:
    """``minWidth`` -> ``min_width``: the mechanical camelCase to snake_case rule of the API ledger."""
    return re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), name)


def snake_args(args: dict[str, Any]) -> dict[str, Any]:
    """*args* with :func:`snake_case` keys, for ops whose arguments map one-to-one onto Python keywords."""
    return {snake_case(k): v for k, v in args.items()}


# ---------------------------------------------------------------------- loading
def _q(value: Any) -> str:
    """JSON quoting for messages (the JS loader formats the same messages with ``JSON.stringify``)."""
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_int(v: Any) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def _unknown(keys: list[str], where: str = "") -> str:
    return f"unknown key{'s' if len(keys) > 1 else ''} {', '.join(map(_q, keys))}{where}"


def _no_constants(token: str) -> Any:
    raise ValueError(f"{token} is not valid JSON")


def load_cases(root: Path | str = DATA) -> list[dict[str, Any]]:
    """Every case of every ``facet.cases/1`` file under *root*, recursively, files in path order.

    Other JSON files are ignored.  A ``facet.cases/<n>`` file of another version, invalid JSON in a case file,
    a malformed case or an id used twice raises :class:`CaseFileError`.  Each returned case also has ``_file``
    (its file, relative to *root*) and ``_root`` (*root*, absolute; ``input.file`` paths are relative to it).
    """
    root = Path(root).resolve()
    if not root.is_dir():
        raise CaseFileError(f"{root}: not a directory")
    files = sorted(
        (p for p in root.rglob("*.json")
         if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts)),
        key=lambda p: p.relative_to(root).as_posix(),
    )
    cases: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    for path in files:
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        try:
            doc = json.loads(text, parse_constant=_no_constants)
        except ValueError as exc:
            if '"facet.cases/' in text:
                raise CaseFileError(f"{rel}: not valid JSON ({exc})") from None
            continue  # some other (non-standard) JSON file
        if not _is_obj(doc):
            continue
        schema = doc.get("schema")
        if schema != SCHEMA:
            if isinstance(schema, str) and schema.startswith("facet.cases/"):
                raise CaseFileError(f"{rel}: unsupported schema {_q(schema)} (this loader reads {_q(SCHEMA)})")
            continue
        items = doc.get("cases")
        if not isinstance(items, list) or not items:
            raise CaseFileError(f'{rel}: "cases" must be a non-empty list')
        for i, case in enumerate(items):
            _check_case(case, f"{rel}: cases[{i}]", rel, root)
            if case["id"] in seen:
                raise CaseFileError(f"{rel}: case {_q(case['id'])} is also defined in {seen[case['id']]}")
            seen[case["id"]] = rel
            cases.append({**case, "_file": rel, "_root": str(root)})
    return cases


def _check_case(case: Any, where: str, rel: str, root: Path) -> None:
    """Validate one case; the JS loader (``tests/js/helpers.mjs``) applies the same rules with the same messages."""
    def fail(msg: str) -> None:
        raise CaseFileError(f"{where}: {msg}")

    if not _is_obj(case):
        fail("must be an object")
    cid = case.get("id")
    if not isinstance(cid, str) or not cid or re.search(r"\s", cid):
        fail('"id" must be a non-empty string without spaces')
    where = f"{rel}: case {_q(cid)}"
    unknown = sorted(k for k in case if k not in CASE_KEYS)
    if unknown:
        fail(f"{_unknown(unknown)} (allowed: {', '.join(CASE_KEYS)})")
    if not isinstance(case.get("op"), str) or not case["op"]:
        fail('"op" must be a non-empty string')
    if "args" in case and not _is_obj(case["args"]):
        fail('"args" must be an object')
    if "note" in case and not isinstance(case["note"], str):
        fail('"note" must be a string')
    if "input" in case:
        _check_input(case["input"], fail, root)
    expect = case.get("expect")
    if not _is_obj(expect) or not expect:
        fail('"expect" must be a non-empty object')
    _check_expect(expect, fail)
    if "tol" in case:
        tol = case["tol"]
        if not _is_obj(tol):
            fail('"tol" must be an object')
        for k, v in tol.items():
            if not _is_num(v) or v < 0:
                fail(f'"tol.{k}" must be a non-negative number')
            if k not in TOL_KEYS and k not in expect:
                fail(f'"tol.{k}" matches nothing in "expect" (tolerances: {", ".join(TOL_KEYS)} or an expect key)')
    for key in ("skip", "xfail"):
        if key in case:
            v = case[key]
            if not _is_obj(v) or not v or any(k not in LANGS for k in v) \
                    or any(not isinstance(r, str) or not r.strip() for r in v.values()):
                fail(f'"{key}" must map "py" and/or "js" to a reason')
    for lang in LANGS:
        if lang in (case.get("skip") or {}) and lang in (case.get("xfail") or {}):
            fail(f'"skip" and "xfail" both name "{lang}"')


def _check_input(inp: Any, fail: Callable[[str], None], root: Path) -> None:
    if not _is_obj(inp):
        fail('"input" must be an object')
    unknown = sorted(k for k in inp if k not in INPUT_KINDS)
    if unknown:
        fail(_unknown(unknown, ' in "input"') + f" (allowed: {', '.join(INPUT_KINDS)})")
    if len(inp) != 1:
        fail(f'"input" must have exactly one of {", ".join(map(_q, INPUT_KINDS))}')
    kind, value = next(iter(inp.items()))
    if kind == "structure" and not _is_obj(value):
        fail('"input.structure" must be a structure object')
    if kind == "text" and not isinstance(value, str):
        fail('"input.text" must be a string')
    if kind == "file":
        if not isinstance(value, str) or not value or "\\" in value or PurePosixPath(value).is_absolute() \
                or ".." in PurePosixPath(value).parts:
            fail(f"input file {_q(value)} must be a relative path inside the data directory")
        if not (root / value).is_file():
            fail(f"input file {_q(value)} not found")
    if kind == "recipe":
        if not _is_obj(value) or not isinstance(value.get("name"), str) or not value["name"] \
                or any(k not in ("args", "name") for k in value) or ("args" in value and not _is_obj(value["args"])):
            fail('"input.recipe" must be {"name": "...", "args": {...}}')


def _check_expect(expect: dict[str, Any], fail: Callable[[str], None]) -> None:
    if "error" in expect:
        if not isinstance(expect["error"], str) or not expect["error"]:
            fail('"expect.error" must be a non-empty string')
        if len(expect) > 1:
            fail('"expect.error" cannot be combined with other expectations')
    if "structure" in expect:
        st = expect["structure"]
        if not _is_obj(st):
            fail('"expect.structure" must be an object')
        unknown = sorted(k for k in st if k not in STRUCTURE_KEYS)
        if unknown:
            fail(_unknown(unknown, ' in "expect.structure"') + f" (allowed: {', '.join(STRUCTURE_KEYS)})")
        for k in ("props", "info"):
            if k in st and not _is_obj(st[k]):
                fail(f'"expect.structure.{k}" must be an object')
    if "warnings" in expect:
        w = expect["warnings"]
        if not _is_obj(w) or not w or any(k not in WARNINGS_KEYS for k in w):
            fail(f'"expect.warnings" must be an object with {", ".join(map(_q, WARNINGS_KEYS))}')
        for k in ("equals", "contains"):
            if k in w and not _is_str_list(w[k]):
                fail(f'"expect.warnings.{k}" must be a list of strings')
        if "count" in w and (not _is_int(w["count"]) or w["count"] < 0):
            fail('"expect.warnings.count" must be a non-negative integer')
    if "text" in expect:
        t = expect["text"]
        if not _is_obj(t) or not t or any(k not in TEXT_KEYS for k in t) or not all(_is_str_list(v) for v in t.values()):
            fail(f'"expect.text" must be an object with {", ".join(map(_q, TEXT_KEYS))} lists of strings')
    if "sourceMap" in expect:
        m = expect["sourceMap"]
        if m is not None and (not isinstance(m, list) or not all(v is None or _is_int(v) for v in m)):
            fail('"expect.sourceMap" must be a list of atom indices (or null)')


# ---------------------------------------------------------------------- running
class CaseInput:
    """A case's ``input``, resolved for an op.

    ``kind`` is ``"structure"``, ``"text"``, ``"file"``, ``"recipe"`` or ``"none"`` and ``raw`` the input object as
    written.  :attr:`structure` builds a :class:`Structure` on first use (``Structure.from_dict``, the recipe's
    result, or the text or file parsed with the format detected from the file name or the content) and returns the
    same object afterwards (``inp.structure.copy()`` for a second one).  :attr:`text` is the text of a text or file
    input, :attr:`path` the absolute path of a file input.
    """

    def __init__(self, kind: str, raw: dict[str, Any], *, path: Path | None = None,
                 structure: Structure | None = None) -> None:
        self.kind = kind
        self.raw = raw
        self.path = path
        self._structure = structure
        self._text: str | None = raw.get("text") if kind == "text" else None

    def __repr__(self) -> str:
        return f"CaseInput(kind={self.kind!r})"

    @property
    def filename(self) -> str | None:
        """Base name of a file input (``None`` otherwise)."""
        return self.path.name if self.path is not None else None

    @property
    def text(self) -> str:
        """The text of a ``text`` input, or the content of a ``file`` input (UTF-8)."""
        if self.kind == "file" and self._text is None:
            assert self.path is not None
            self._text = self.path.read_text(encoding="utf-8")
        if self._text is None:
            raise ValueError(f"the case input has no text (it is a {self.kind} input)")
        return self._text

    @property
    def structure(self) -> Structure:
        """The input as a :class:`Structure` (built on first use, then cached)."""
        if self._structure is None:
            if self.kind == "structure":
                self._structure = Structure.from_dict(self.raw["structure"])
            elif self.kind in ("text", "file"):
                self._structure = parse_text(self.text, filename=self.filename)
            else:
                raise ValueError("the case has no input")
        return self._structure


def resolve_input(case: dict[str, Any]) -> CaseInput:
    """The :class:`CaseInput` of *case*; a recipe input is built here (an unknown recipe fails the case)."""
    raw = copy.deepcopy(case.get("input") or {})
    if not raw:
        return CaseInput("none", raw)
    kind = next(k for k in INPUT_KINDS if k in raw)
    if kind == "file":
        return CaseInput(kind, raw, path=Path(case.get("_root") or DATA) / raw["file"])
    if kind == "recipe":
        name = raw["recipe"]["name"]
        fn = RECIPES.get(name)
        if fn is None:
            raise AssertionError(f"[{case.get('id')}] recipe {_q(name)} is not registered in tests/ops/")
        s = fn(dict(raw["recipe"].get("args") or {}))
        if not isinstance(s, Structure):
            raise TypeError(f"recipe {_q(name)} returned {type(s).__name__}, not a Structure")
        return CaseInput(kind, raw, structure=s)
    return CaseInput(kind, raw)


def as_actual(result: Any) -> dict[str, Any]:
    """An op's return value as a dict of results (a bare :class:`Structure` means ``{"structure": ...}``)."""
    if isinstance(result, Structure):
        return {"structure": result}
    if isinstance(result, dict):
        return result
    raise TypeError(f"an op must return a dict of results or a Structure, not {type(result).__name__}")


def run_case(case: dict[str, Any]) -> None:
    """Run *case* against the Python implementation; a mismatch raises :class:`AssertionError` naming the case.

    ``skip`` and ``xfail`` are applied by the caller (``tests/test_cases.py`` turns them into pytest marks).
    """
    cid = case["id"]
    fn = OPS.get(case["op"])
    if fn is None:
        raise AssertionError(f"[{cid}] op {_q(case['op'])} is not registered in tests/ops/ "
                             f"(register it, or give the case a skip.py reason)")
    inp = resolve_input(case)
    args = copy.deepcopy(case.get("args") or {})
    expect = case["expect"]
    if "error" in expect:
        try:
            fn(inp, args)
        except Exception as exc:  # noqa: BLE001 - any error raised by the op is the one being tested
            if expect["error"] not in str(exc):
                raise AssertionError(f"[{cid}] expected an error containing {_q(expect['error'])}, "
                                     f"got {type(exc).__name__}: {exc}") from exc
            return
        raise AssertionError(f"[{cid}] expected an error containing {_q(expect['error'])}, but {case['op']} succeeded")
    compare(expect, as_actual(fn(inp, args)), case.get("tol"), case_id=cid)


# -------------------------------------------------------------------- comparing
def _plain(x: Any) -> Any:
    """JSON-like copy of an actual value: numpy arrays and scalars as lists and numbers, tuples as lists."""
    if isinstance(x, Structure):
        return x.to_dict(decimals=12)
    if isinstance(x, np.ndarray):
        return _plain(x.tolist())
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_plain(v) for v in x]
    return x


def _show(v: Any) -> str:
    text = _q(v)
    return text if len(text) <= 80 else text[:77] + "..."


def _same(exp: Any, act: Any, tol: float, path: str, out: list[str]) -> None:
    """Append to *out* every difference between the expected JSON value *exp* and *act* (numbers within *tol*)."""
    if len(out) > 200:
        return
    if exp is None:
        if act is not None:
            out.append(f"{path}: expected null, got {_show(act)}")
    elif isinstance(exp, bool):
        if not isinstance(act, bool) or act != exp:
            out.append(f"{path}: expected {_show(exp)}, got {_show(act)}")
    elif _is_num(exp):
        if not _is_num(act):
            out.append(f"{path}: expected {_show(exp)}, got {_show(act)}")
        elif not abs(exp - act) <= tol:
            out.append(f"{path}: expected {exp!r}, got {act!r} (tolerance {tol:g})")
    elif isinstance(exp, str):
        if act != exp:
            out.append(f"{path}: expected {_show(exp)}, got {_show(act)}")
    elif isinstance(exp, list):
        if not isinstance(act, list):
            out.append(f"{path}: expected a list, got {_show(act)}")
        elif len(act) != len(exp):
            out.append(f"{path}: expected {len(exp)} items, got {len(act)}")
        else:
            for i, (e, a) in enumerate(zip(exp, act)):
                _same(e, a, tol, f"{path}[{i}]", out)
    elif isinstance(exp, dict):
        if not isinstance(act, dict):
            out.append(f"{path}: expected an object, got {_show(act)}")
            return
        missing = [k for k in exp if k not in act]
        extra = sorted(k for k in act if k not in exp)
        if missing:
            out.append(f"{path}: missing {', '.join(map(_q, missing))}")
        if extra:
            out.append(f"{path}: unexpected {', '.join(map(_q, extra))}")
        for k, e in exp.items():
            if k in act:
                _same(e, act[k], tol, f"{path}.{k}", out)
    else:  # pragma: no cover - JSON has no other types
        out.append(f"{path}: cannot compare {_show(exp)}")


def _structure_doc(s: Any) -> Any:
    return s.to_dict(decimals=12) if isinstance(s, Structure) else _plain(s)


def _cmp_structure(exp: dict[str, Any], actual: dict[str, Any], tols: dict[str, float], out: list[str]) -> None:
    if "structure" not in actual:
        out.append("structure: missing from the op result")
        return
    d = _structure_doc(actual["structure"])
    if not isinstance(d, dict):
        out.append(f"structure: expected a structure, got {_show(d)}")
        return
    for key, e in exp.items():
        path = f"structure.{key}"
        if key in ("props", "info"):
            have = d.get(key) or {}
            tol = tols.get(key, tols["value"])
            for k, v in e.items():
                if v is None:
                    if k in have:
                        out.append(f"{path}.{k}: expected no such key, got {_show(have[k])}")
                elif k not in have:
                    out.append(f"{path}.{k}: missing")
                else:
                    _same(v, have[k], tol, f"{path}.{k}", out)
        elif key == "nFrames":
            _same(e, 1 + len(d.get("frames") or []), 0, path, out)
        else:
            _same(e, d.get(key), tols.get(key, 0.0) if key in ("positions", "cell") else 0.0, path, out)


def _warnings_of(actual: dict[str, Any]) -> Any:
    if "warnings" in actual:
        return _plain(actual["warnings"])
    if "structure" in actual:
        s = actual["structure"]
        info = s.info if isinstance(s, Structure) else ((_plain(s) or {}).get("info") or {})
        if "warnings" in info:
            return _plain(info["warnings"])
        legacy = info.get("warning")  # the single-string key the web app used before F0-D T2
        return [legacy] if isinstance(legacy, str) and legacy else []
    return None


def _cmp_warnings(exp: dict[str, Any], actual: dict[str, Any], out: list[str]) -> None:
    w = _warnings_of(actual)
    if w is None:
        out.append("warnings: missing from the op result (and no structure to read them from)")
        return
    if not _is_str_list(w):
        out.append(f"warnings: expected a list of strings, got {_show(w)}")
        return
    if "equals" in exp:
        _same(exp["equals"], w, 0.0, "warnings", out)
    for sub in exp.get("contains", []):
        if not any(sub in x for x in w):
            out.append(f"warnings: none contains {_q(sub)} (got {_show(w)})")
    if "count" in exp and len(w) != exp["count"]:
        out.append(f"warnings: expected {int(exp['count'])}, got {len(w)} ({_show(w)})")


def _cmp_text(exp: dict[str, Any], actual: dict[str, Any], out: list[str]) -> None:
    text = actual.get("text")
    if "text" not in actual or not isinstance(text, str):
        out.append("text: missing from the op result" if "text" not in actual else f"text: expected a string, got {_show(text)}")
        return
    for sub in exp.get("contains", []):
        if sub not in text:
            out.append(f"text: does not contain {_q(sub)}")
    for sub in exp.get("excludes", []):
        if sub in text:
            out.append(f"text: contains {_q(sub)}")


def compare(expect: dict[str, Any], actual: dict[str, Any], tol: dict[str, float] | None = None, *,
            case_id: str | None = None) -> None:
    """Compare an op's results with a case's ``expect``; raise :class:`AssertionError` listing the differences.

    Comparators: ``structure`` (only the keys given; ``symbols``, ``pbc``, ``name``, ``nFrames`` exactly,
    ``positions``/``cell`` within ``tol``, ``props``/``info`` only the listed keys, ``null`` = key absent),
    ``sourceMap`` (exact, ``null`` entries = -1), ``warnings`` (``equals``/``contains``/``count``; read from the
    structure's ``info`` when the op gives none), ``text`` (``contains``/``excludes``); any other key, ``value``
    included, is a JSON value compared exactly except numbers (``1 == 1.0``, within ``tol.value`` or ``tol.<key>``).
    The message starts with ``[case_id]``.  ``expect.error`` is handled by :func:`run_case`.
    """
    tols = {**DEFAULT_TOL, **(tol or {})}
    out: list[str] = []
    for key, exp in expect.items():
        if key == "error":
            raise ValueError("expect.error is checked by run_case, not by compare")
        if key == "structure":
            _cmp_structure(exp, actual, tols, out)
        elif key == "warnings":
            _cmp_warnings(exp, actual, out)
        elif key == "text":
            _cmp_text(exp, actual, out)
        elif key not in actual:
            out.append(f"{key}: missing from the op result")
        elif key == "sourceMap":
            norm = (lambda m: [-1 if v is None else v for v in m] if isinstance(m, list) else m)  # noqa: E731
            _same(norm(exp), norm(_plain(actual[key])), 0.0, key, out)
        else:
            _same(exp, _plain(actual[key]), tols.get(key, tols["value"]), key, out)
    if out:
        head = f"[{case_id}] " if case_id else ""
        shown = out[:_MAX_PROBLEMS]
        more = f"\n  ... and {len(out) - len(shown)} more" if len(out) > len(shown) else ""
        n = f"{len(out)}+" if len(out) > 200 else str(len(out))
        raise AssertionError(f"{head}{n} mismatch{'es' if len(out) != 1 else ''}:\n  " + "\n  ".join(shown) + more)
