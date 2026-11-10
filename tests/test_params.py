"""The parameter schema in ``facet.core.params`` (F0-A T8): typed indices, coercion, validation, form defaults,
the command line's ``--param`` and the REST plugin endpoints.

The shared cases ``tests/data/surface/coerce.json`` run in both languages (``tests/test_cases.py``,
``tests/js/cases.test.mjs``).  The tests here cover the Python API (types, numpy inputs, copies, ``parse_cli_value``),
the CLI (``--param hkl=1,0,-1,0``, the option named once in messages, required parameters), the REST endpoints
``/build/custom/{name}`` and ``/analysis/custom/{name}`` (normalized values, 422 with the message, plugins without a
schema unchanged, 500 naming a plugin whose declared schema is invalid) and, through the Node bridge, compare the
module with ``web/js/core/params.js`` on generated inputs: parsing, coercion, validation and the way numbers are
written in messages.
"""

from __future__ import annotations

import json
import math
import random
import socket
import textwrap
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from facet import Client
from facet import io as cl_io
from facet.cli import main, parse_params
from facet.client import ClientError
from facet.config import Settings
from facet.core import params
from facet.core.params import (
    ParamError,
    coerce_param,
    default_params,
    parse_cli_value,
    parse_indices,
    validate_params,
)
from facet.server import BackgroundServer, create_app

DATA = Path(__file__).resolve().parent / "data"
M = "\u2212"
BAR = "\u0305"

PLUGIN = textwrap.dedent('''
    """A plugin whose builders and analysis declare the new parameter types (tests/test_params.py)."""
    from facet import Structure

    PLUGIN = {"name": "paramtest", "version": "0.1"}

    SLAB = [
        {"name": "hkl", "type": "miller", "label": "Miller indices"},
        {"name": "P", "type": "imatrix", "default": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"name": "layers", "type": "int", "label": "Layers", "min": 1, "max": 30, "default": 4},
        {"name": "vacuum", "type": "float", "label": "Vacuum", "min": 0, "unit": "Å", "required": True},
        {"name": "shift", "type": "vector", "default": [0, 0, 0]},
        {"name": "colour", "type": "colour", "default": "red"},
    ]

    def _record(name, params):
        s = Structure(["Cu"], [[0.0, 0.0, 0.0]], name=name)
        s.info["received"] = params
        return s

    def slab(**params):
        return _record("slab", params)

    def raw(**params):
        return _record("raw", params)

    def probe(structure, **params):
        return {"received": params}

    def register(ctx):
        ctx.register_builder("slab", slab, {"label": "Slab", "params": SLAB})
        ctx.register_builder("raw", raw, {"label": "No schema"})
        ctx.register_analysis("probe", probe, {"label": "Probe", "params": [
            {"name": "hkl", "type": "miller"}, {"name": "n", "type": "int", "min": 1, "default": 2}]})
''')


@pytest.fixture
def plugin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "plugins"
    d.mkdir()
    (d / "paramtest.py").write_text(PLUGIN, encoding="utf-8")
    return d


@pytest.fixture
def client(tmp_path: Path, plugin_dir: Path):
    settings = Settings(mode="local", data_dir=tmp_path / "data", plugin_dirs=[plugin_dir], entry_point_plugins=False,
                        web_dir=tmp_path / "no-web")
    with TestClient(create_app(settings)) as c:
        yield c


# ------------------------------------------------------------------------------------------------------ module
def test_names_and_error_class():
    assert params.__all__ == ["ParamError", "parse_indices", "parse_cli_value", "coerce_param", "validate_params",
                              "default_params"]
    assert issubclass(ParamError, ValueError)
    with pytest.raises(ParamError) as exc:
        coerce_param({"name": "hkl", "type": "miller"}, [0, 0, 0])
    assert str(exc.value) == "hkl: (0 0 0) is not a plane."


def test_golden_file_covers_every_message():
    doc = json.loads((DATA / "surface" / "coerce.json").read_text(encoding="utf-8"))
    assert doc["schema"] == "facet.cases/1"
    cases = doc["cases"]
    assert len(cases) >= 50
    assert {c["op"] for c in cases} == {"parseIndices", "coerceText", "coerceParam", "validateParams", "defaultParams"}
    for c in cases:
        assert c["id"].startswith("f0a-params-"), c["id"]
        assert "skip" not in c and "xfail" not in c, f"{c['id']} must run in both languages"
    texts = []
    for c in cases:
        e = c["expect"]
        texts += [e.get("error", "")] + e.get("errors", []) + e.get("warnings", {}).get("equals", [])
    every = "\n".join(texts)
    for fragment in [  # each message of F0-A §3.15 (and the ones this module adds for the other types)
        ": enter a value.", ": enter a number.", ": enter a whole number.", ": use a value from ",
        ": enter three numbers, like 0 0 1.", ": enter three whole numbers, like 1 1 0.",
        ": enter two numbers, like 0.5 0.5.",
        ": enter two whole numbers, like 1 0.", ": the vector cannot be zero.",
        ": enter three whole numbers (h k l) or four (h k i l), like 1 1 1.", f": in (h k i l), i must be {M}(h + k) = ",
        ": (0 0 0) is not a plane.", f": use indices from {M}", "matrix of whole numbers, rows separated by ';'.",
        ": every entry must be a whole number.", f": use entries from {M}", ": the matrix is singular (determinant 0).",
        "; a negative determinant mirrors the cell. Swap two rows or negate one.", " is too large (at most ",
        "High-index plane; the surface cell may be large.", "× the atoms.", ": unknown parameter “",
        "Unknown parameter “", "(it takes no parameters)", ": use true or false.", ": enter text.",
        ": enter an element symbol, like Cu.", ": use one of ",
        "” is not a number", "” is not a finite number", "” divides by zero",
    ]:
        assert fragment in every, fragment


def test_parse_indices_types_and_errors():
    assert parse_indices("1 2 3") == [1, 2, 3] and all(type(x) is int for x in parse_indices("1 2 3"))
    assert [type(x) for x in parse_indices("1. 2e0 .5")] == [float, float, float]
    assert parse_indices("2 1; -1 1") == [[2, 1], [-1, 1]]
    assert parse_indices("[[1, 0], [0, 1]]") == [[1, 0], [0, 1]]
    assert parse_indices(f"(1{BAR}2{BAR} 1{BAR} 3)") == [-12, -1, 3]
    big = parse_indices("12345678901234567890")
    assert big == [12345678901234567890.0] and type(big[0]) is float  # as JavaScript holds it
    assert math.copysign(1, parse_indices("-0.0")[0]) == 1  # no negative zero
    for bad in ["1 x", "\u0661 0 0", "1\x1c2", "1 2 3)(", "NaN", "inf", "1e400", "--1"]:
        with pytest.raises(ParamError):
            parse_indices(bad)
    with pytest.raises(TypeError, match="text must be a string"):
        parse_indices([1, 2, 3])  # type: ignore[arg-type]


def test_coerce_accepts_tuples_numpy_and_returns_plain_values():
    hkl = {"name": "hkl", "type": "miller"}
    assert coerce_param(hkl, (1, 0, -1, 0)) == [1, 0, 0]
    out = coerce_param(hkl, np.array([2, 2, 2]))
    assert out == [2, 2, 2] and all(type(x) is int for x in out)
    v = coerce_param({"name": "v", "type": "vector"}, np.array([0.5, -0.0, 1]))
    assert v == [0.5, 0.0, 1.0] and all(type(x) is float for x in v) and math.copysign(1, v[1]) == 1
    m = coerce_param({"name": "P", "type": "imatrix", "size": 2}, np.array([[2, 1], [-1, 1]]))
    assert m == [[2, 1], [-1, 1]] and all(type(x) is int for r in m for x in r)
    seven = coerce_param({"name": "n", "type": "int"}, np.int64(7))
    assert seven == 7 and type(seven) is int
    assert coerce_param({"name": "x", "type": "float"}, np.float64(2.5)) == 2.5
    assert coerce_param({"name": "b", "type": "bool"}, np.bool_(True)) is True
    with pytest.raises(ParamError, match="enter a whole number"):
        coerce_param({"name": "n", "type": "int"}, 2**60)  # beyond what JavaScript holds exactly
    with pytest.raises(ParamError, match="enter a number"):
        coerce_param({"name": "x", "type": "float"}, 10**400)
    with pytest.raises(TypeError, match="spec must be a dict"):
        coerce_param([("name", "x")], 1)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="size must be 2 or 3"):
        coerce_param({"name": "P", "type": "imatrix", "size": 4}, [[1]])


def test_validate_and_defaults_copy_their_values():
    default = [[1, 0], [0, 1]]
    schema = [{"name": "P", "type": "imatrix", "size": 2, "default": default}]
    values, errors, warnings = validate_params(schema, {})
    assert values == {"P": default} and errors == [] and warnings == []
    values["P"][0][0] = 9
    assert default == [[1, 0], [0, 1]]
    form = default_params(schema)
    form["P"][1][1] = 9
    assert default == [[1, 0], [0, 1]]
    assert validate_params(schema, None) == ({"P": [[1, 0], [0, 1]]}, [], [])
    with pytest.raises(TypeError, match="values must be a dict"):
        validate_params(schema, [1])  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="^validate_params: schema must be a list$"):
        validate_params({"name": "x"}, {})  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="^default_params: schema must be a list$"):
        default_params({"name": "x"})  # type: ignore[arg-type]
    assert default_params(None) == {} and default_params(()) == {}


def test_validate_keeps_unknown_keys_and_types_when_not_strict():
    schema = [{"name": "a", "type": "int"}, {"name": "c", "type": "colour"}]
    marker = object()
    values, errors, _ = validate_params(schema, {"a": 1, "c": marker, "extra": marker})
    assert errors == [] and values["c"] is marker and values["extra"] is marker
    _, errors, _ = validate_params(schema, {"extra": 1}, strict=True, title="Make supercell…")
    assert errors == ["Make supercell: unknown parameter “extra” (use a, c)."]


# ------------------------------------------------------------------------------------------------ command line
@pytest.mark.parametrize(("spec", "text", "value"), [
    ({"type": "int"}, "12", 12), ({"type": "int"}, " 7 ", 7), ({"type": "int"}, "2.0", 2.0),
    ({"type": "int"}, "1e3", 1000.0),
    ({"type": "float"}, "0.25", 0.25), ({"type": "float"}, "-3", -3.0),
    ({"type": "bool"}, "Yes", True), ({"type": "bool"}, "off", False), ({"type": "bool"}, "T", True),
    ({"type": "string"}, " a b ", " a b "), ({"type": "element"}, "cu", "cu"),
    ({"type": "select", "options": [1, 2, 3]}, "2", 2), ({"type": "select", "options": ["fcc", "bcc"]}, "bcc", "bcc"),
    ({"type": "select", "options": [True, False]}, "true", True), ({"type": "select", "options": [0.5]}, "0.5", 0.5),
    ({"type": "select", "options": [1, 2]}, "4", "4"),
    ({"type": "vector"}, "1/3,2/3,0", [1 / 3, 2 / 3, 0]), ({"type": "vector", "integer": True}, "1 -1 0", [1, -1, 0]),
    ({"type": "miller"}, "1,0,-1,0", [1, 0, -1, 0]), ({"type": "miller"}, f"(1 0 1{BAR} 0)", [1, 0, -1, 0]),
    ({"type": "imatrix"}, "2 1 0; -1 1 0; 0 0 1", [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]),
    ({"type": "color"}, "[1, 2]", [1, 2]), ({"type": "color"}, "red", "red"), (None, "3", 3), (None, "{\"a\": 1}", {"a": 1}),
])
def test_parse_cli_value(spec, text, value):
    got = parse_cli_value({"name": "p", **spec} if spec else None, text)
    assert got == value and type(got) is type(value)


@pytest.mark.parametrize(("spec", "text", "message"), [
    ({"type": "int"}, "abc", "n: enter a number."), ({"type": "float"}, "1/3", "n: enter a number."),
    ({"type": "bool"}, "maybe", "n: use true or false."),
    ({"type": "vector", "integer": True}, "1/2 0 0", "n: enter three whole numbers, like 1 1 0."),
    ({"type": "vector", "size": 2}, "a b", "n: enter two numbers, like 0.5 0.5."),
    ({"type": "miller"}, "1 x 1", "n: enter three whole numbers (h k l) or four (h k i l), like 1 1 1."),
    ({"type": "imatrix", "size": 2}, "1 2; x", "n: enter a 2×2 matrix of whole numbers, rows separated by ';'."),
    ({"type": "float", "required": True}, "  ", "n: enter a value."),
    ({"type": "miller", "required": True}, "", "n: enter a value."),
])
def test_parse_cli_value_messages(spec, text, message):
    with pytest.raises(ParamError) as exc:
        parse_cli_value({"name": "n", **spec}, text)
    assert str(exc.value) == message


def test_parse_params_uses_the_whole_spec_and_names_the_option_once():
    schema = [{"name": "hkl", "type": "miller", "label": "Miller indices"}, {"name": "P", "type": "imatrix"},
              {"name": "n", "type": "int", "min": 1}, {"name": "vacuum", "type": "float", "required": True}]
    got = parse_params(["hkl=1,0,-1,0", "P=2 1 0; -1 1 0; 0 0 1", "n=3", "vacuum=0", "extra=[1, 2]", "word=abc"], schema)
    assert got == {"hkl": [1, 0, 0], "P": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], "n": 3, "vacuum": 0.0, "extra": [1, 2],
                   "word": "abc"}
    for pairs, message in [
        (["hkl=1,0,0,0", "vacuum=1"], f"--param hkl: in (h k i l), i must be {M}(h + k) = -1."),
        (["hkl=0 0 0", "vacuum=1"], "--param hkl: (0 0 0) is not a plane."),
        (["n=0", "vacuum=1"], "--param n: use a value from 1 to ∞."),
        (["P=1 0 0; 0 1 0; 0 0 -1", "vacuum=1"],
         "--param P: the determinant is -1; a negative determinant mirrors the cell. Swap two rows or negate one."),
        (["hkl=1 1 1"], "--param vacuum: enter a value."),
        (["vacuum="], "--param vacuum: enter a value."),
    ]:
        with pytest.raises(ParamError) as exc:
            parse_params(pairs, schema)
        assert str(exc.value) == message
    with pytest.raises(ValueError, match="--param expects KEY=VALUE"):
        parse_params(["hkl"], schema)
    assert parse_params(["rmax=5", "nbins=10"]) == {"rmax": 5, "nbins": 10}  # no schema: JSON, as before
    defaults = [{"name": "a", "type": "int", "default": 3}, {"name": "b", "type": "imatrix", "default": None},
                {"name": "c", "type": "miller"}, {"name": "d", "type": "vector", "default": [0, 0, 1]}]
    got = parse_params(["a=5"], defaults)
    assert got == {"a": 5, "b": None, "d": [0, 0, 1]}, "declared defaults fill in, as validate_params does"
    got["d"][2] = 9
    assert defaults[3]["default"] == [0, 0, 1]


def test_cli_build_custom_with_new_types(tmp_path, plugin_dir, capsys):
    out = tmp_path / "slab.json"
    plugins = ["--plugins", str(plugin_dir)]
    assert main(["build", "custom", "slab", "--param", "hkl=1,0,-1,0", "--param", "P=2 1 0; -1 1 0; 0 0 1",
                 "--param", "vacuum=15", "-o", str(out), *plugins]) == 0
    s = cl_io.read(out)
    assert s.info["received"] == {"hkl": [1, 0, 0], "P": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], "vacuum": 15.0,
                                  "layers": 4, "shift": [0, 0, 0], "colour": "red"}  # declared defaults, as over REST
    capsys.readouterr()
    assert main(["build", "custom", "slab", "--param", "hkl=1,0,0,0", "--param", "vacuum=15", *plugins]) == 1
    err = capsys.readouterr().err
    assert err.strip() == f"facet: error: --param hkl: in (h k i l), i must be {M}(h + k) = -1."
    assert main(["build", "custom", "slab", "--param", "hkl=1,1,1", *plugins]) == 1
    assert capsys.readouterr().err.strip() == "facet: error: --param vacuum: enter a value."
    # a builder without a schema gets the old conversion
    raw = tmp_path / "raw.json"
    assert main(["build", "custom", "raw", "--param", "hkl=[1, 0, -1, 0]", "--param", "name=x", "-o", str(raw),
                 *plugins]) == 0
    assert cl_io.read(raw).info["received"] == {"hkl": [1, 0, -1, 0], "name": "x"}


def test_cli_analyze_plugin_params(tmp_path, plugin_dir, capsys):
    src = tmp_path / "cu.xyz"
    src.write_text("1\n\nCu 0 0 0\n", encoding="utf-8")
    assert main(["analyze", "probe", str(src), "--param", f"hkl=(1 1{BAR} 0 0)", "--plugins", str(plugin_dir)]) == 0
    assert json.loads(capsys.readouterr().out) == {"received": {"hkl": [1, -1, 0], "n": 2}}


# --------------------------------------------------------------------------------------------------------- REST
def test_rest_builder_gets_normalized_values(client):
    r = client.post("/api/v1/build/custom/slab", json={"hkl": [1, 0, -1, 0], "vacuum": 12, "extra": "kept"})
    assert r.status_code == 200, r.text
    assert r.json()["structure"]["info"]["received"] == {
        "hkl": [1, 0, 0], "P": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "layers": 4, "vacuum": 12.0, "shift": [0, 0, 0],
        "colour": "red", "extra": "kept"}
    r = client.post("/api/v1/build/custom/slab", json={"hkl": [1, 1, 1], "vacuum": 0, "P": [2, 1, 0, -1, 1, 0, 0, 0, 1],
                                                       "shift": [0.5, 0.5, 0], "colour": [1, 2, 3]})
    got = r.json()["structure"]["info"]["received"]
    assert got["P"] == [[2, 1, 0], [-1, 1, 0], [0, 0, 1]] and got["vacuum"] == 0 and got["colour"] == [1, 2, 3]


@pytest.mark.parametrize(("body", "detail"), [
    ({"hkl": [1, 0, 0, 0], "vacuum": 1}, f"Miller indices: in (h k i l), i must be {M}(h + k) = -1."),
    ({"hkl": "1 1 1", "vacuum": 1}, "Miller indices: enter three whole numbers (h k l) or four (h k i l), like 1 1 1."),
    ({"hkl": [1, 1, 1]}, "Vacuum: enter a value."),
    ({"hkl": [1, 1, 1], "vacuum": -1}, "Vacuum: use a value from 0 to ∞."),
    ({"hkl": [1, 1, 1], "vacuum": 1, "layers": 31, "P": [[1, 1], [0, 1]]},
     "P: enter a 3×3 matrix of whole numbers, rows separated by ';'. Layers: use a value from 1 to 30."),
])
def test_rest_builder_refuses_values_that_do_not_fit(client, body, detail):
    r = client.post("/api/v1/build/custom/slab", json=body)
    assert r.status_code == 422 and r.json()["detail"] == detail


def test_rest_builder_without_schema_and_analysis(client):
    r = client.post("/api/v1/build/custom/raw", json={"hkl": [1, 0, -1, 0], "n": "4"})
    assert r.status_code == 200 and r.json()["structure"]["info"]["received"] == {"hkl": [1, 0, -1, 0], "n": "4"}
    s = r.json()["structure"]
    r = client.post("/api/v1/analysis/custom/probe", json={"structure": s, "params": {"hkl": [1, 1, -2, 0]}})
    assert r.status_code == 200 and r.json()["result"] == {"received": {"hkl": [1, 1, 0], "n": 2}}
    r = client.post("/api/v1/analysis/custom/probe", json={"structure": s, "params": {"hkl": [1, 1, 1], "n": 0}})
    assert r.status_code == 422 and r.json()["detail"] == "n: use a value from 1 to ∞."
    assert client.post("/api/v1/analysis/custom/missing", json={"structure": s}).status_code == 404


BAD_PLUGIN = textwrap.dedent('''
    """A plugin whose declared params are themselves invalid (tests/test_params.py)."""
    from facet import Structure

    PLUGIN = {"name": "badparams", "version": "0.1"}

    def build(**params):
        return Structure(["Cu"], [[0.0, 0.0, 0.0]], name="built")

    def probe(structure, **params):
        return {"received": params}

    def register(ctx):
        ctx.register_builder("not-a-list", build, {"params": {"n": {"type": "int"}}})
        ctx.register_builder("size-4", build, {"params": [{"name": "P", "type": "imatrix", "size": 4}]})
        ctx.register_analysis("not-a-list", probe, {"params": {"n": {"type": "int"}}})
        ctx.register_analysis("size-1", probe, {"params": [{"name": "v", "type": "vector", "size": 1}]})
''')


def test_rest_plugin_with_invalid_params_names_its_schema(tmp_path):
    """A schema validate_params cannot read is the plugin's fault: 500 with a message, not an unhandled TypeError."""
    d = tmp_path / "bad"
    d.mkdir()
    (d / "badparams.py").write_text(BAD_PLUGIN, encoding="utf-8")
    settings = Settings(mode="local", data_dir=tmp_path / "data", plugin_dirs=[d], entry_point_plugins=False,
                        web_dir=tmp_path / "no-web")
    cu = {"symbols": ["Cu"], "positions": [[0, 0, 0]]}
    with TestClient(create_app(settings)) as c:
        for path, body, detail in [
            ("/build/custom/not-a-list", {"n": 1},
             "builder 'not-a-list' declares invalid params: validate_params: schema must be a list"),
            ("/build/custom/size-4", {"P": [[1, 0], [0, 1]]},
             "builder 'size-4' declares invalid params: P: size must be 2 or 3 (got 4)"),
            ("/analysis/custom/not-a-list", {"structure": cu, "params": {}},
             "analysis 'not-a-list' declares invalid params: validate_params: schema must be a list"),
            ("/analysis/custom/size-1", {"structure": cu, "params": {"v": [1]}},
             "analysis 'size-1' declares invalid params: v: size must be 2 or 3 (got 1)"),
        ]:
            r = c.post(f"/api/v1{path}", json=body)
            assert (r.status_code, r.json()["detail"]) == (500, detail), path


def test_client_reports_the_422_message(tmp_path, plugin_dir):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    settings = Settings(port=port, data_dir=tmp_path / "srv", plugin_dirs=[plugin_dir], entry_point_plugins=False)
    srv = BackgroundServer(settings).start()
    try:
        c = Client(srv.url)
        assert c.build_custom("slab", hkl=[1, 0, -1, 0], vacuum=10).info["received"]["hkl"] == [1, 0, 0]
        with pytest.raises(ClientError) as exc:
            c.build_custom("slab", hkl=[0, 0, 0], vacuum=10)
        assert exc.value.status == 422 and exc.value.detail == "Miller indices: (0 0 0) is not a plane."
    finally:
        srv.stop()


# ------------------------------------------------------------------------------------------- parity with JS
ALPHABET = ["0", "1", "2", "7", "12", "-", "\u2212", "+", ".", "e", "E", "/", ",", ";", " ", "  ", "\t", "\u00a0", "\u3000",
            "\x1c", "\x85", "\ufeff", BAR, "\u0304", "[", "]", "(", ")", "{", "}", "<", ">", "a", "NaN", "\"", "\u0661", "1e400"]


def _random_texts(n: int, seed: int) -> list[str]:
    rng = random.Random(seed)
    texts = []
    for _ in range(n):
        if rng.random() < 0.5:  # mostly well-formed: numbers, separators, a bracket pair, sometimes bars
            nums = []
            for _ in range(rng.randint(0, 6)):
                x = rng.choice(["1", "0", "12", "3.5", ".25", "1e-3", "1/3", "2/0", "007", "1E2"])
                if rng.random() < 0.3:
                    x = rng.choice(["-", "\u2212", "+"]) + x
                if rng.random() < 0.2 and x.isdigit():
                    x = "".join(d + BAR for d in x)
                nums.append(x)
            sep = rng.choice([" ", ",", ", ", " ; ", ";", "\u00a0"])
            t = sep.join(nums)
            if rng.random() < 0.4:
                o, c = rng.choice(["()", "[]", "{}", "<>", "[)"])
                t = o + t + c
            texts.append(t)
        else:
            texts.append("".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 9))))
    return texts


def _py_outcome(fn, *a, **kw):
    try:
        return {"value": fn(*a, **kw)}
    except ParamError as exc:
        return {"error": str(exc)}


def test_parse_indices_matches_js_on_random_text(js):
    texts = _random_texts(600, 11)
    items = [{"text": t, "fractions": i % 2 == 1} for i, t in enumerate(texts)]
    got = js("""
      const P = await web('core/params.js');
      return input.map(({ text, fractions }) => {
        try { return { value: P.parseIndices(text, { fractions }) }; } catch (e) { return { error: e.message }; }
      });
    """, items)
    for item, out in zip(items, got):
        assert out == _py_outcome(parse_indices, item["text"], fractions=item["fractions"]), item


def _random_value(rng: random.Random):
    pick = rng.random()
    if pick < 0.15:
        return rng.choice([None, True, "1 1 1", 3, 2.5, [], {"a": 1}])
    n = rng.choice([2, 3, 3, 4, 4, 9])
    items = [rng.choice([0, 1, -1, 2, -3, 12, 13, 31, 0.5, 2.0, -0.0, 50, 51, 1000, True, "x"]) for _ in range(n)]
    if rng.random() < 0.3 and n in (4, 9):
        k = 2 if n == 4 else 3
        return [items[i * k:(i + 1) * k] for i in range(k)]
    return items


def _random_spec(rng: random.Random) -> dict:
    kind = rng.choice(["miller", "vector", "imatrix", "int", "float"])
    spec: dict = {"name": "p", "type": kind, "label": rng.choice(["p", "Miller indices", "Shift (Å)"])}
    if kind == "miller":
        for k, choices in (("max", [None, 12, 30, 1000]), ("warnAbove", [None, 6, 12])):
            if rng.random() < 0.5:
                spec[k] = rng.choice(choices)
    elif kind == "vector":
        spec.update(size=rng.choice([2, 3]), integer=rng.random() < 0.4, nonzero=rng.random() < 0.4)
    elif kind == "imatrix":
        spec["size"] = rng.choice([2, 3])
        for k, choices in (("max", [None, 50, 1000]), ("maxDet", [None, 1, 8, 1e6]), ("warnDet", [None, 2, 400]),
                           ("positive", [True, False])):
            if rng.random() < 0.5:
                spec[k] = rng.choice(choices)
    else:
        for k in ("min", "max"):
            if rng.random() < 0.5:
                spec[k] = rng.choice([-5, 0, 1, 0.5, 12, 1e21])
    if rng.random() < 0.2:
        spec["required"] = True
    return spec


def test_coerce_and_validate_match_js_on_random_inputs(js):
    rng = random.Random(12)
    items = [{"spec": _random_spec(rng), "value": _random_value(rng)} for _ in range(700)]
    got = js("""
      const P = await web('core/params.js');
      return input.map(({ spec, value }) => {
        let coerced;
        try { coerced = { value: P.coerceParam(spec, value) }; } catch (e) { coerced = { error: e.message }; }
        const v = P.validateParams([spec], value === null ? {} : { p: value });
        return { coerced, validated: [v.values, v.errors, v.warnings], defaults: P.defaultParams([spec]) };
      });
    """, items)
    for item, out in zip(items, got):
        assert out["coerced"] == _py_outcome(coerce_param, item["spec"], item["value"]), item
        values, errors, warnings = validate_params([item["spec"]], {} if item["value"] is None else {"p": item["value"]})
        assert out["validated"] == [values, errors, warnings], item
        assert out["defaults"] == default_params([item["spec"]]), item


def test_numbers_in_messages_are_written_like_javascript(js):
    rng = random.Random(13)
    bounds = [0.1, 1 / 3, 2.5, 100.0, 1e6, 1e16, 1e20, 1e21, 1.5e21, 123456789012345680000.0, 2.0**53, 2.0**60, 1e300,
              5e-324, 1e-6, 1e-7, 1.5e-5, 0.000123, 123.456, -0.5, -1e-7, -2.0**70, 9007199254740993, 2**60]
    bounds += [rng.uniform(1, 10) * 10.0 ** rng.randint(-12, 25) * rng.choice([1, -1]) for _ in range(300)]
    items = [{"min": b} for b in bounds]
    got = js("""
      const P = await web('core/params.js');
      return input.map(({ min }) => {
        try { P.coerceParam({ name: 'x', type: 'float', min }, -1.7976931348623157e308); return null; }
        catch (e) { return e.message; }
      });
    """, items)
    for b, msg in zip(bounds, got):
        with pytest.raises(ParamError) as exc:
            coerce_param({"name": "x", "type": "float", "min": b}, -1.7976931348623157e308)
        assert str(exc.value) == msg, b
