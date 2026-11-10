"""The shared cross-language cases (``tests/data/**/*.json``, schema ``facet.cases/1``) and their shell.

``test_case`` runs every case against the Python implementation; the same cases run against the web modules in
``tests/js/cases.test.mjs`` (through ``tests/test_js_unit.py``).  The other tests cover the loader, the comparator
and the runner of ``tests/cases.py``, and check through the Node bridge that the JS loader and comparator
(``tests/js/helpers.mjs``) accept, reject and compare exactly like the Python ones.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from facet import Structure, build

from . import ops
from .cases import (
    DATA,
    DEFAULT_TOL,
    OPS,
    RECIPES,
    SCHEMA,
    CaseFileError,
    compare,
    load_cases,
    op,
    recipe,
    resolve_input,
    run_case,
    snake_args,
    snake_case,
)

try:
    CASES: list[dict[str, Any]] = load_cases()
    LOAD_ERROR: str | None = None
except CaseFileError as exc:  # reported by test_case_files_load, so that the other tests still run
    CASES, LOAD_ERROR = [], str(exc)


def _param(case: dict[str, Any]) -> Any:
    marks = []
    if "py" in case.get("skip", {}):
        marks.append(pytest.mark.skip(reason=case["skip"]["py"]))
    if "py" in case.get("xfail", {}):
        marks.append(pytest.mark.xfail(strict=True, reason=case["xfail"]["py"]))
    return pytest.param(case, id=case["id"], marks=marks)


def test_case_files_load():
    assert LOAD_ERROR is None, LOAD_ERROR
    assert CASES, f"no {SCHEMA} cases under {DATA}"


@pytest.mark.parametrize("case", [_param(c) for c in CASES])
def test_case(case: dict[str, Any]):
    run_case(case)


# ------------------------------------------------------------------ registries
@pytest.fixture
def registry():
    """Ops and recipes registered by the test are removed afterwards."""
    saved_ops, saved_recipes = dict(OPS), dict(RECIPES)
    yield
    OPS.clear()
    OPS.update(saved_ops)
    RECIPES.clear()
    RECIPES.update(saved_recipes)


def test_op_modules_are_imported_in_name_order():
    assert ops.MODULES == sorted(ops.MODULES) and "f0d" in ops.MODULES
    assert {"load", "read", "write", "roundtrip"} <= set(OPS)
    assert "crystal" in RECIPES


def test_names_register_once(registry):
    op("t0Twice")(lambda inp, args: {})
    with pytest.raises(ValueError, match='op "t0Twice" is already registered'):
        op("t0Twice")(lambda inp, args: {})
    recipe("t0Twice")(lambda args: Structure())
    with pytest.raises(ValueError, match='recipe "t0Twice" is already registered'):
        recipe("t0Twice")(lambda args: Structure())
    with pytest.raises(ValueError, match="invalid op name"):
        op("two words")


def test_snake_case_is_the_ledger_rule():
    assert snake_case("vacuumGapMin") == "vacuum_gap_min"
    assert snake_case("nFrames") == "n_frames"
    assert snake_case("axis") == "axis"
    assert snake_args({"minWidth": 5, "axis": 2}) == {"min_width": 5, "axis": 2}


# ---------------------------------------------------------------------- loading
GOOD = {"id": "good", "op": "load", "input": {"text": "x"}, "expect": {"value": 1}}


def _with(**kw: Any) -> dict[str, Any]:
    return {"schema": SCHEMA, "cases": [{**GOOD, **kw}]}


def _without(key: str) -> dict[str, Any]:
    return {"schema": SCHEMA, "cases": [{k: v for k, v in GOOD.items() if k != key}]}


#: (name, files {relative path: document or raw text}, expected error substring or None).  The JS loader must give
#: the same verdict with the same message (``test_js_loader_agrees``).
LOADER_DOCS: list[tuple[str, dict[str, Any], str | None]] = [
    ("good", {"a.json": _with()}, None),
    ("other-json-ignored", {"s.json": {"schema": "facet.structure/1", "symbols": []}, "a.json": _with()}, None),
    ("array-and-broken-json-ignored", {"x.json": "[1, 2]", "y.json": "{not json", "a.json": _with()}, None),
    ("hidden-dirs-ignored", {".cache/a.json": '{"schema": "facet.cases/1", "cases": [',
                             "sub/.b.json": _with(), "a.json": _with()}, None),
    ("broken-case-file", {"a.json": '{"schema": "facet.cases/1", "cases": ['}, "a.json: not valid JSON ("),
    ("nan-is-not-json", {"a.json": '{"schema": "facet.cases/1", "cases": [{"id": "a", "op": "x", '
                                   '"expect": {"value": NaN}}]}'}, "a.json: not valid JSON ("),
    ("other-version", {"a.json": {"schema": "facet.cases/2", "cases": []}},
     'a.json: unsupported schema "facet.cases/2" (this loader reads "facet.cases/1")'),
    ("no-cases", {"a.json": {"schema": SCHEMA, "cases": []}}, 'a.json: "cases" must be a non-empty list'),
    ("case-not-object", {"a.json": {"schema": SCHEMA, "cases": [1]}}, "a.json: cases[0]: must be an object"),
    ("empty-id", {"a.json": _with(id="")}, 'a.json: cases[0]: "id" must be a non-empty string without spaces'),
    ("id-with-space", {"a.json": _with(id="a b")}, '"id" must be a non-empty string without spaces'),
    ("unknown-key", {"a.json": _with(expected={})},
     'a.json: case "good": unknown key "expected" (allowed: args, expect, id, input, note, op, skip, tol, xfail)'),
    ("unknown-keys", {"a.json": _with(params={}, expected={})}, 'unknown keys "expected", "params" (allowed:'),
    ("no-op", {"a.json": _without("op")}, '"op" must be a non-empty string'),
    ("args-list", {"a.json": _with(args=[])}, '"args" must be an object'),
    ("note-number", {"a.json": _with(note=1)}, '"note" must be a string'),
    ("input-two-kinds", {"a.json": _with(input={"text": "a", "structure": {}})},
     '"input" must have exactly one of "structure", "text", "file", "recipe"'),
    ("input-empty", {"a.json": _with(input={})}, '"input" must have exactly one of'),
    ("input-unknown", {"a.json": _with(input={"txt": "a"})},
     'unknown key "txt" in "input" (allowed: structure, text, file, recipe)'),
    ("input-structure-list", {"a.json": _with(input={"structure": []})}, '"input.structure" must be a structure object'),
    ("input-text-number", {"a.json": _with(input={"text": 1})}, '"input.text" must be a string'),
    ("input-file-absolute", {"a.json": _with(input={"file": "/etc/hosts"})},
     'input file "/etc/hosts" must be a relative path inside the data directory'),
    ("input-file-escapes", {"a.json": _with(input={"file": "../x.vasp"})}, "must be a relative path inside"),
    ("input-file-backslash", {"a.json": _with(input={"file": "sub\\x.vasp"})}, "must be a relative path inside"),
    ("input-file-missing", {"a.json": _with(input={"file": "sub/nope.vasp"})}, 'input file "sub/nope.vasp" not found'),
    ("input-file", {"a.json": _with(input={"file": "sub/x.vasp"}), "sub/x.vasp": "text"}, None),
    ("recipe-without-name", {"a.json": _with(input={"recipe": {"args": {}}})},
     '"input.recipe" must be {"name": "...", "args": {...}}'),
    ("recipe-extra-key", {"a.json": _with(input={"recipe": {"name": "crystal", "arg": {}}})}, '"input.recipe" must be'),
    ("recipe-args-list", {"a.json": _with(input={"recipe": {"name": "crystal", "args": []}})}, '"input.recipe" must be'),
    ("expect-missing", {"a.json": _without("expect")}, '"expect" must be a non-empty object'),
    ("expect-empty", {"a.json": _with(expect={})}, '"expect" must be a non-empty object'),
    ("error-and-value", {"a.json": _with(expect={"error": "x", "value": 1})},
     '"expect.error" cannot be combined with other expectations'),
    ("error-empty", {"a.json": _with(expect={"error": ""})}, '"expect.error" must be a non-empty string'),
    ("structure-unknown-key", {"a.json": _with(expect={"structure": {"atoms": 3}})},
     'unknown key "atoms" in "expect.structure" (allowed: cell, info, nFrames, name, pbc, positions, props, symbols)'),
    ("structure-props-list", {"a.json": _with(expect={"structure": {"props": []}})},
     '"expect.structure.props" must be an object'),
    ("warnings-unknown", {"a.json": _with(expect={"warnings": {"has": []}})},
     '"expect.warnings" must be an object with "contains", "count", "equals"'),
    ("warnings-empty", {"a.json": _with(expect={"warnings": {}})}, '"expect.warnings" must be an object with'),
    ("warnings-equals-string", {"a.json": _with(expect={"warnings": {"equals": "a"}})},
     '"expect.warnings.equals" must be a list of strings'),
    ("warnings-count-negative", {"a.json": _with(expect={"warnings": {"count": -1}})},
     '"expect.warnings.count" must be a non-negative integer'),
    ("warnings-count-fraction", {"a.json": _with(expect={"warnings": {"count": 1.5}})}, "must be a non-negative integer"),
    ("warnings-count-2.0", {"a.json": _with(expect={"warnings": {"count": 2.0}})}, None),
    ("text-unknown", {"a.json": _with(expect={"text": {"has": ["a"]}})},
     '"expect.text" must be an object with "contains", "excludes" lists of strings'),
    ("source-map-strings", {"a.json": _with(expect={"sourceMap": [0, "a"]})},
     '"expect.sourceMap" must be a list of atom indices (or null)'),
    ("source-map-null", {"a.json": _with(expect={"sourceMap": None})}, None),
    ("tol-negative", {"a.json": _with(tol={"value": -1})}, '"tol.value" must be a non-negative number'),
    ("tol-boolean", {"a.json": _with(tol={"value": True})}, '"tol.value" must be a non-negative number'),
    ("tol-typo", {"a.json": _with(tol={"posiitons": 0.001})},
     '"tol.posiitons" matches nothing in "expect" (tolerances: cell, info, positions, props, value or an expect key)'),
    ("tol-for-op-key", {"a.json": _with(expect={"gap": 1}, tol={"gap": 0.1})}, None),
    ("skip-language", {"a.json": _with(skip={"python": "later"})}, '"skip" must map "py" and/or "js" to a reason'),
    ("skip-blank-reason", {"a.json": _with(skip={"js": " "})}, '"skip" must map "py" and/or "js" to a reason'),
    ("xfail-empty", {"a.json": _with(xfail={})}, '"xfail" must map "py" and/or "js" to a reason'),
    ("skip-and-xfail", {"a.json": _with(skip={"js": "a"}, xfail={"js": "b", "py": "c"})},
     '"skip" and "xfail" both name "js"'),
    ("duplicate-id", {"a.json": _with(), "b/c.json": _with()}, 'b/c.json: case "good" is also defined in a.json'),
]


def _write_tree(root: Path, files: dict[str, Any]) -> Path:
    for rel, doc in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8")
    return root


def _load_verdict(root: Path) -> dict[str, Any]:
    try:
        return {"ids": [c["id"] for c in load_cases(root)]}
    except CaseFileError as exc:
        return {"error": str(exc)}


@pytest.mark.parametrize("name,files,error", LOADER_DOCS, ids=[d[0] for d in LOADER_DOCS])
def test_loader_validates_case_files(tmp_path: Path, name: str, files: dict[str, Any], error: str | None):
    verdict = _load_verdict(_write_tree(tmp_path, files))
    if error is None:
        assert verdict == {"ids": ["good"]}
    else:
        assert error in verdict.get("error", ""), verdict


def test_loader_reads_nested_files_in_path_order(tmp_path: Path):
    _write_tree(tmp_path, {
        "b/z.json": {"schema": SCHEMA, "cases": [{**GOOD, "id": "b1"}]},
        "a/y/x.json": {"schema": SCHEMA, "cases": [{**GOOD, "id": "a1"}, {**GOOD, "id": "a2"}]},
        "a-z.json": {"schema": SCHEMA, "description": "metadata is ignored", "cases": [{**GOOD, "id": "c1"}]},
    })
    cases = load_cases(tmp_path)
    assert [(c["id"], c["_file"]) for c in cases] == [("c1", "a-z.json"), ("a1", "a/y/x.json"), ("a2", "a/y/x.json"),
                                                      ("b1", "b/z.json")]
    assert all(c["_root"] == str(tmp_path.resolve()) for c in cases)
    with pytest.raises(CaseFileError, match="not a directory"):
        load_cases(tmp_path / "missing")


def test_repository_cases_are_where_the_ledger_puts_them():
    files = {c["_file"] for c in CASES}
    assert "surface/f0d/shell.json" in files
    assert (DATA / "surface" / "contcar_pt111.vasp").is_file()


# -------------------------------------------------------------------- comparing
DOC_H = {"schema": "facet.structure/1", "name": "h", "symbols": ["H"], "positions": [[0, 0, 0.74]], "cell": None,
         "pbc": [False, False, False], "props": {"tags": [1]}, "info": {"energy": -1.0, "source": "test"}}
DOC_W = {**DOC_H, "info": {"warnings": ["one note"]}}
DOC_LEGACY = {**DOC_H, "info": {"warning": "old style; one string"}}

#: (expect, actual, tol, passes).  ``test_js_comparator_agrees`` runs the same vectors through the JS compare().
COMPARE_VECTORS: list[tuple[dict[str, Any], dict[str, Any], dict[str, float] | None, bool]] = [
    ({"value": 1}, {"value": 1.0}, None, True),
    ({"value": 1.0}, {"value": 1.0 + 5e-10}, None, True),
    ({"value": 1.0}, {"value": 1.0 + 5e-9}, None, False),
    ({"value": 1.0}, {"value": 1.05}, {"value": 0.1}, True),
    ({"value": True}, {"value": 1}, None, False),
    ({"value": 1}, {"value": True}, None, False),
    ({"value": None}, {"value": 0}, None, False),
    ({"value": None}, {"value": None}, None, True),
    ({"value": "a"}, {"value": "a"}, None, True),
    ({"value": "a"}, {"value": "A"}, None, False),
    ({"value": [1, 2]}, {"value": [1, 2, 3]}, None, False),
    ({"value": [1, 2]}, {"value": {"0": 1, "1": 2}}, None, False),
    ({"value": {"a": 1}}, {"value": {"a": 1, "b": 2}}, None, False),
    ({"value": {"a": 1, "b": 2}}, {"value": {"a": 1}}, None, False),
    ({"value": {"a": [1, {"b": 2.0}]}}, {"value": {"a": [1, {"b": 2}]}}, None, True),
    ({"value": 1}, {}, None, False),
    ({"gap": 14.9998}, {"gap": 14.99985}, {"gap": 1e-4}, True),
    ({"gap": 14.9998}, {"gap": 14.99985}, None, False),
    ({"structure": {"symbols": ["H"]}}, {"structure": DOC_H}, None, True),
    ({"structure": {"symbols": ["He"]}}, {"structure": DOC_H}, None, False),
    ({"structure": {"positions": [[0, 0, 0.7400005]]}}, {"structure": DOC_H}, None, True),
    ({"structure": {"positions": [[0, 0, 0.74001]]}}, {"structure": DOC_H}, None, False),
    ({"structure": {"positions": [[0, 0, 0.74001]]}}, {"structure": DOC_H}, {"positions": 1e-4}, True),
    ({"structure": {"positions": [[0, 0, 0.74], [0, 0, 0]]}}, {"structure": DOC_H}, None, False),
    ({"structure": {"cell": None, "pbc": [False, False, False], "nFrames": 1, "name": "h"}}, {"structure": DOC_H}, None, True),
    ({"structure": {"cell": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}}, {"structure": DOC_H}, None, False),
    ({"structure": {"nFrames": 2}}, {"structure": DOC_H}, None, False),
    ({"structure": {"name": "H"}}, {"structure": DOC_H}, None, False),
    ({"structure": {"props": {"tags": [1]}}}, {"structure": DOC_H}, None, True),
    ({"structure": {"props": {"tags": [1.0000001]}}}, {"structure": DOC_H}, {"props": 1e-6}, True),
    ({"structure": {"props": {"tags": None}}}, {"structure": DOC_H}, None, False),
    ({"structure": {"props": {"selective_dynamics": None}}}, {"structure": DOC_H}, None, True),
    ({"structure": {"props": {"charges": [0]}}}, {"structure": DOC_H}, None, False),
    ({"structure": {"info": {"energy": -1.0}}}, {"structure": DOC_H}, None, True),
    ({"structure": {"info": {"spacegroup": None}}}, {"structure": DOC_H}, None, True),
    ({"structure": {"symbols": ["H"]}}, {}, None, False),
    ({"sourceMap": [0, None, 2]}, {"sourceMap": [0, -1, 2]}, None, True),
    ({"sourceMap": [0, -1]}, {"sourceMap": [0, None]}, None, True),
    ({"sourceMap": [0, 1]}, {"sourceMap": [1, 0]}, None, False),
    ({"sourceMap": None}, {"sourceMap": None}, None, True),
    ({"sourceMap": None}, {"sourceMap": [0]}, None, False),
    ({"warnings": {"equals": ["a b", "c"]}}, {"warnings": ["a b", "c"]}, None, True),
    ({"warnings": {"equals": ["c", "a b"]}}, {"warnings": ["a b", "c"]}, None, False),
    ({"warnings": {"contains": ["b"], "count": 2}}, {"warnings": ["a b", "c"]}, None, True),
    ({"warnings": {"contains": ["x"]}}, {"warnings": ["a b", "c"]}, None, False),
    ({"warnings": {"count": 1}}, {"warnings": ["a b", "c"]}, None, False),
    ({"warnings": {"equals": ["one note"]}}, {"structure": DOC_W}, None, True),
    ({"warnings": {"count": 0}}, {"structure": DOC_H}, None, True),
    ({"warnings": {"equals": ["old style; one string"]}}, {"structure": DOC_LEGACY}, None, True),
    ({"warnings": {"count": 0}}, {"value": 1}, None, False),
    ({"warnings": {"count": 0}}, {"warnings": "none"}, None, False),
    ({"text": {"contains": ["Direct"], "excludes": ["Selective"]}}, {"text": "x\nDirect\n"}, None, True),
    ({"text": {"excludes": ["Direct"]}}, {"text": "x\nDirect\n"}, None, False),
    ({"text": {"contains": ["Cartesian"]}}, {"text": "x\nDirect\n"}, None, False),
    ({"text": {"contains": ["Direct"]}}, {"value": 1}, None, False),
]


def _passes(expect: dict[str, Any], actual: dict[str, Any], tol: dict[str, float] | None) -> bool:
    try:
        compare(expect, actual, tol)
    except AssertionError:
        return False
    return True


@pytest.mark.parametrize("expect,actual,tol,ok", COMPARE_VECTORS, ids=[str(i) for i in range(len(COMPARE_VECTORS))])
def test_comparator(expect: dict[str, Any], actual: dict[str, Any], tol: dict[str, float] | None, ok: bool):
    assert _passes(expect, actual, tol) is ok


def test_comparator_takes_python_objects():
    s = build.crystal("fcc", ["Pt"], a=3.92)
    s.info["warnings"] = ["a note"]
    expect = {"structure": {"symbols": ["Pt"] * 4, "positions": (s.positions + 1e-9).tolist(), "pbc": [True] * 3},
              "warnings": {"equals": ["a note"]}, "value": [1.0, 2.0], "sourceMap": [0, -1]}
    compare(expect, {"structure": s, "value": np.array([1, 2]), "sourceMap": np.array([0, -1])})
    compare({"value": {"n": 3}}, {"value": {"n": np.int64(3)}})
    compare({"value": [True, False]}, {"value": (np.bool_(True), False)})


def test_comparator_messages_name_the_case_and_the_place():
    with pytest.raises(AssertionError) as exc:
        compare({"structure": {"positions": [[0, 0, 1]]}, "value": 2}, {"structure": DOC_H, "value": 3}, case_id="my-case")
    msg = str(exc.value)
    assert msg.startswith("[my-case] 2 mismatches:")
    assert "structure.positions[0][2]: expected 1, got 0.74 (tolerance 1e-06)" in msg and "value: expected 2, got 3" in msg
    with pytest.raises(AssertionError, match=r"\.\.\. and 30 more"):
        compare({"value": list(range(50))}, {"value": [-1] * 50})
    with pytest.raises(ValueError, match="checked by run_case"):
        compare({"error": "x"}, {})


# ---------------------------------------------------------------------- running
def _case(**kw: Any) -> dict[str, Any]:
    return {"id": "t0-case", "op": "t0Echo", "expect": {"value": 1}, "_root": str(DATA), **kw}


def test_runner_reports_unregistered_ops():
    with pytest.raises(AssertionError, match=r'\[t0-case\] op "t0Missing" is not registered in tests/ops/'):
        run_case(_case(op="t0Missing"))


def test_runner_matches_expected_errors(registry):
    @op("t0Raise")
    def _raise(inp, args):
        raise ValueError(f"layers must be at least 1, got {args['n']}")

    run_case(_case(op="t0Raise", args={"n": 0}, expect={"error": "layers must be at least 1"}))
    with pytest.raises(AssertionError, match=r'expected an error containing "vacuum", got ValueError: layers'):
        run_case(_case(op="t0Raise", args={"n": 0}, expect={"error": "vacuum"}))
    op("t0Fine")(lambda inp, args: {"value": 1})
    with pytest.raises(AssertionError, match="but t0Fine succeeded"):
        run_case(_case(op="t0Fine", expect={"error": "anything"}))
    with pytest.raises(ValueError, match="layers must be"):  # an error nobody expected propagates as it is
        run_case(_case(op="t0Raise", args={"n": 0}))


def test_runner_results_and_structure_shorthand(registry):
    op("t0Bare")(lambda inp, args: inp.structure)
    op("t0List")(lambda inp, args: [1])
    structure = {"structure": {"symbols": ["H"], "positions": [[0, 0, 0]]}}
    run_case(_case(op="t0Bare", input=structure, expect={"structure": {"symbols": ["H"]}, "warnings": {"count": 0}}))
    with pytest.raises(TypeError, match="must return a dict of results or a Structure, not list"):
        run_case(_case(op="t0List", input=structure))
    with pytest.raises(AssertionError, match=r"\[t0-case\] 1 mismatch:\n  structure.symbols\[0\]"):
        run_case(_case(op="t0Bare", input=structure, expect={"structure": {"symbols": ["He"]}}))


def test_runner_passes_args_as_written_and_copies_them(registry):
    seen: list[dict[str, Any]] = []

    @op("t0Args")
    def _args(inp, args):
        seen.append(args)
        args["minWidth"] = 0  # must not leak into the case
        return {"value": 1}

    case = _case(op="t0Args", args={"minWidth": 5.0, "axis": "c"})
    run_case(case)
    assert seen == [{"minWidth": 0, "axis": "c"}] and case["args"] == {"minWidth": 5.0, "axis": "c"}


def test_inputs_resolve(registry, tmp_path: Path):
    (tmp_path / "f").mkdir()
    (tmp_path / "f" / "POSCAR_h2.vasp").write_text("H2\n1.0\n5 0 0\n0 5 0\n0 0 5\nH\n2\nDirect\n0 0 0\n0 0 0.15\n")
    inp = resolve_input({"id": "a", "input": {"file": "f/POSCAR_h2.vasp"}, "_root": str(tmp_path)})
    assert inp.kind == "file" and inp.path == tmp_path / "f" / "POSCAR_h2.vasp" and inp.filename == "POSCAR_h2.vasp"
    assert inp.text.startswith("H2\n") and inp.structure is inp.structure and inp.structure.symbols == ["H", "H"]
    assert np.allclose(inp.structure.positions[1], [0, 0, 0.75])

    doc = {"symbols": ["O"], "positions": [[0, 0, 0]], "props": {"extra": [[1]]}}  # a key without a normalizer
    case = {"id": "b", "input": {"structure": doc}}
    s = resolve_input(case).structure
    s.props["extra"][0].append(2)  # the case document is not touched
    assert case["input"]["structure"]["props"]["extra"] == [[1]]
    with pytest.raises(ValueError, match="has no text"):
        resolve_input(case).text

    text = resolve_input({"id": "c", "input": {"text": "2\nwater?\nH 0 0 0\nH 0 0 0.74\n"}})
    assert text.kind == "text" and text.path is None and text.structure.symbols == ["H", "H"]
    none = resolve_input({"id": "d"})
    assert none.kind == "none"
    with pytest.raises(ValueError, match="the case has no input"):
        none.structure

    recipe("t0Water")(lambda args: build.molecule("water"))
    recipe("t0NotAStructure")(lambda args: {"symbols": []})
    assert resolve_input({"id": "e", "input": {"recipe": {"name": "t0Water"}}}).structure.symbols == ["O", "H", "H"]
    with pytest.raises(AssertionError, match=r'\[f\] recipe "t0Nope" is not registered'):
        resolve_input({"id": "f", "input": {"recipe": {"name": "t0Nope", "args": {}}}})
    with pytest.raises(TypeError, match='recipe "t0NotAStructure" returned dict, not a Structure'):
        resolve_input({"id": "g", "input": {"recipe": {"name": "t0NotAStructure"}}})


def test_crystal_recipe_requires_every_lattice_parameter():
    crystal = RECIPES["crystal"]
    assert len(crystal({"prototype": "fcc", "elements": ["Cu"], "a": 3.61, "repeat": [2, 1, 1.0]})) == 8
    for args, msg in [
        ({"prototype": "fcc", "elements": ["Cu"]}, "recipe crystal: missing arg a"),
        ({"prototype": "fcc", "elements": ["Cu"], "a": 3.61, "b": 1}, "recipe crystal: unknown args b"),
        ({"prototype": "hcp", "elements": ["Mg"], "a": 3.21}, "recipe crystal: give c for hcp"),
        ({"prototype": "wurtzite", "elements": ["Zn", "O"], "a": 3.25, "c": 5.2}, "recipe crystal: give u for wurtzite"),
        ({"prototype": "nope", "elements": ["Cu"], "a": 3.61}, "recipe crystal: unknown prototype nope"),
        ({"prototype": "fcc", "elements": "Cu", "a": 3.61}, "recipe crystal: elements must be a list"),
        ({"prototype": "fcc", "elements": ["Cu"], "a": 3.61, "repeat": [2, 0, 1]}, "repeat must be three positive integers"),
    ]:
        with pytest.raises(ValueError, match=msg):
            crystal(args)


# ------------------------------------------------------- the JS shell agrees
def test_js_loader_agrees(js, tmp_path: Path):
    roots = [str(_write_tree(tmp_path / f"d{i}", files)) for i, (_, files, _) in enumerate(LOADER_DOCS)]
    got = js("""
      const { loadCases } = await repo('tests/js/helpers.mjs');
      return input.map((root) => {
        try { return { ids: loadCases(root).map((c) => c.id) }; } catch (err) { return { error: err.message, name: err.name }; }
      });
    """, roots)
    for (name, _, error), root, verdict in zip(LOADER_DOCS, roots, got):
        mine = _load_verdict(Path(root))
        if "error" in mine:
            assert verdict.get("name") == "CaseFileError", (name, verdict)
            if "not valid JSON" in mine["error"]:  # the parsers' own messages differ
                mine["error"], verdict["error"] = mine["error"].split(" (")[0], verdict["error"].split(" (")[0]
            del verdict["name"]
        assert verdict == mine, name


def test_js_comparator_agrees(js):
    got = js("""
      const { compare, DEFAULT_TOL, SCHEMA } = await repo('tests/js/helpers.mjs');
      const verdicts = input.map(([expect, actual, tol]) => {
        try { compare(expect, actual, tol, 'v'); return true; } catch (err) {
          if (err.name !== 'AssertionError' || !err.message.startsWith('[v] ')) throw err;
          return false;
        }
      });
      return { verdicts, DEFAULT_TOL, SCHEMA };
    """, [[e, a, t] for e, a, t, _ in COMPARE_VECTORS])
    assert got["verdicts"] == [ok for *_, ok in COMPARE_VECTORS]
    assert got["DEFAULT_TOL"] == DEFAULT_TOL and got["SCHEMA"] == SCHEMA
