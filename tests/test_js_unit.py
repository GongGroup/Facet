"""The node:test files in ``tests/js`` (``*.test.mjs``), run from pytest so that one ``pytest`` covers both languages,
and the tests of the bridge itself (``tests/js_bridge.py``).

Without Node.js >= 22 the JS tests are skipped; ``CRYSTALLUME_REQUIRE_NODE=1`` makes that a failure.  The JS files
also run on their own: ``node --test tests/js/*.test.mjs`` (pass the files, not the directory).
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from .js_bridge import (
    MIN_NODE_MAJOR,
    REPO,
    WEB_JS,
    JSError,
    NodeUnavailable,
    find_node,
    require_node,
    run_node_tests,
    tap_failures,
    tap_summary,
)

JS_TESTS = sorted((Path(__file__).resolve().parent / "js").glob("*.test.mjs"))


def _report(proc) -> str:
    failed = tap_failures(proc.stdout)
    return (f"node --test exited with {proc.returncode}; failed: {failed}\n"
            + proc.stdout[-6000:] + ("\n--- stderr ---\n" + proc.stderr[-2000:] if proc.stderr.strip() else ""))


def test_node_unit_tests(js):
    """Every tests/js/*.test.mjs passes under node --test (one Node run for all files)."""
    assert JS_TESTS, "no tests/js/*.test.mjs files"
    proc = run_node_tests(JS_TESTS)
    summary = tap_summary(proc.stdout)
    assert proc.returncode == 0 and summary.get("fail") == 0, _report(proc)
    assert "# fail 0" in proc.stdout and summary.get("pass", 0) > 0


def test_bridge_reports_failing_node_tests(js, tmp_path: Path):
    """A deliberately failing file must fail (the bridge must not swallow failures), a broken file too."""
    sample = tmp_path / "deliberate.test.mjs"
    sample.write_text(
        "import { test } from 'node:test';\n"
        "test('passes', () => {});\n"
        "test('fails on purpose', () => { throw new Error('deliberate failure'); });\n"
        "test('skipped', { skip: 'not today' }, () => {});\n", encoding="utf-8")
    broken = tmp_path / "broken.test.mjs"
    broken.write_text("throw new Error('cannot even load');\n", encoding="utf-8")
    proc = run_node_tests([sample, broken])
    summary = tap_summary(proc.stdout)
    assert proc.returncode != 0
    assert summary["pass"] == 1 and summary["fail"] == 2 and summary["skipped"] == 1, proc.stdout
    assert "# fail 0" not in proc.stdout
    failed = tap_failures(proc.stdout)
    assert len(failed) == 2 and "fails on purpose" in failed, failed
    assert any(name.endswith("broken.test.mjs") for name in failed), failed  # a file that does not load


def test_run_node_tests_wants_files(tmp_path: Path):
    with pytest.raises(ValueError, match="is a directory"):
        run_node_tests([tmp_path])
    with pytest.raises(FileNotFoundError):
        run_node_tests([tmp_path / "missing.test.mjs"])
    with pytest.raises(ValueError, match="at least one"):
        run_node_tests([])
    with pytest.raises(TypeError):
        run_node_tests(str(tmp_path))  # type: ignore[arg-type]


def test_run_js_returns_json(js):
    got = js("""
      const { Structure } = await web('core/structure.js');
      const s = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 0.74]] });
      console.log('logging does not disturb the result');
      return { n: s.length, positions: s.positions, twice: input.map((x) => 2 * x), map: new Map([['a', 1]]),
               set: new Set([1, 2]), nothing: undefined };
    """, [1, 2.5])
    assert got == {"n": 2, "positions": [0, 0, 0, 0, 0, 0.74], "twice": [2, 5.0], "map": {"a": 1}, "set": [1, 2]}
    assert js("return undefined;") is None


def test_run_js_carries_numpy_and_non_finite_numbers(js):
    got = js("return { back: input, kinds: input.special.map((v) => String(v)) };",
             {"array": np.arange(3) * 0.5, "special": [math.nan, math.inf, -math.inf, np.float64(1.5)]})
    assert got["kinds"] == ["NaN", "Infinity", "-Infinity", "1.5"]
    assert got["back"]["array"] == [0.0, 0.5, 1.0]
    special = got["back"]["special"]
    assert math.isnan(special[0]) and special[1:] == [math.inf, -math.inf, 1.5]


def test_run_js_imports_repository_modules(js):
    """``repo(rel)`` imports any module of the checkout (here the JS case helpers)."""
    got = js("const h = await repo('tests/js/helpers.mjs'); return [h.SCHEMA, h.REPO, h.WEB_JS];")
    assert got[0] == "crystallume.cases/1"
    assert Path(got[1]) == REPO and Path(got[2]) == WEB_JS


def test_run_js_reports_errors(js):
    with pytest.raises(JSError) as exc:
        js("const { buildCrystal } = await web('build/crystal.js'); return buildCrystal('nope');")
    assert 'Unknown prototype "nope"' in str(exc.value) and 'Unknown prototype "nope"' in exc.value.stderr
    with pytest.raises(JSError, match="SyntaxError"):
        js("return (;")
    with pytest.raises(JSError, match="did not finish within 0.2 s"):
        js("await new Promise(() => setTimeout(() => {}, 60000));", timeout=0.2)


def test_web_modules_load_as_es_modules():
    """crystallume/web/js/package.json makes Node treat the web .js files as ES modules (no syntax sniffing)."""
    assert json.loads((WEB_JS / "package.json").read_text(encoding="utf-8")) == {"type": "module"}


# ------------------------------------------------------------- finding Node
@pytest.fixture
def fake_node(tmp_path: Path):
    """Write an executable that answers ``--version`` with the given text."""
    if sys.platform == "win32":  # pragma: no cover
        pytest.skip("shell-script stand-ins for node need a POSIX shell")

    def make(version: str) -> str:
        path = tmp_path / f"node-{abs(hash(version))}"
        path.write_text(f"#!/bin/sh\necho '{version}'\n", encoding="utf-8")
        path.chmod(0o755)
        try:
            subprocess.run([str(path)], capture_output=True, timeout=20, check=True)
        except (OSError, subprocess.SubprocessError) as exc:  # pragma: no cover - e.g. a noexec temp directory
            pytest.skip(f"cannot run a script from {tmp_path}: {exc}")
        return str(path)

    return make


def test_find_node_follows_crystallume_node(monkeypatch: pytest.MonkeyPatch, fake_node, tmp_path: Path):
    for off in ("0", "off", "False", "no"):
        monkeypatch.setenv("CRYSTALLUME_NODE", off)
        with pytest.raises(NodeUnavailable, match="disabled by CRYSTALLUME_NODE"):
            find_node()
    monkeypatch.setenv("CRYSTALLUME_NODE", str(tmp_path / "no-such-node"))
    with pytest.raises(NodeUnavailable, match="node not found"):
        find_node()
    monkeypatch.setenv("CRYSTALLUME_NODE", fake_node("v20.18.1"))
    with pytest.raises(NodeUnavailable, match=f"older than v{MIN_NODE_MAJOR}"):
        find_node()
    monkeypatch.setenv("CRYSTALLUME_NODE", fake_node("not a version"))
    with pytest.raises(NodeUnavailable, match="unexpected"):
        find_node()
    node = fake_node("v24.1.0")
    monkeypatch.setenv("CRYSTALLUME_NODE", node)
    assert find_node() == (node, (24, 1, 0))
    monkeypatch.delenv("CRYSTALLUME_NODE")
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(NodeUnavailable, match="not found on PATH"):
        find_node()


def test_missing_node_skips_or_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CRYSTALLUME_NODE", "off")
    monkeypatch.delenv("CRYSTALLUME_REQUIRE_NODE", raising=False)
    with pytest.raises(pytest.skip.Exception, match=f"JS parity tests need Node.js >= {MIN_NODE_MAJOR}: disabled"):
        require_node()
    for on in ("1", "true", "YES"):
        monkeypatch.setenv("CRYSTALLUME_REQUIRE_NODE", on)
        with pytest.raises(pytest.fail.Exception, match="CRYSTALLUME_REQUIRE_NODE is set"):
            require_node()
    monkeypatch.setenv("CRYSTALLUME_REQUIRE_NODE", "0")
    with pytest.raises(pytest.skip.Exception):
        require_node()


def test_tests_using_js_get_the_js_marker(request: pytest.FixtureRequest, js):
    assert request.node.get_closest_marker("js") is not None


def test_tap_parsing():
    tap = ("TAP version 13\nok 1 - a\nnot ok 2 - b # TODO later\n    not ok 1 - inner\nnot ok 3 - c.test.mjs\n"
           "# known: pass 9\n1..3\n# tests 4\n# suites 0\n# pass 1\n# fail 3\n# cancelled 0\n# skipped 0\n# todo 1\n")
    assert tap_summary(tap) == {"tests": 4, "suites": 0, "pass": 1, "fail": 3, "cancelled": 0, "skipped": 0, "todo": 1}
    assert tap_failures(tap) == ["b", "inner", "c.test.mjs"]
