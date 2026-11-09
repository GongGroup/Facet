"""Run Crystallume's browser ES modules (``crystallume/web/js``) under Node.js from Python tests.

The cross-language test bridge.  Python tests send parameters to Node, run the web module there and compare
the result with the Python implementation (:func:`run_js`); the pure-JS unit tests in ``tests/js/*.test.mjs``
run under ``node --test`` from pytest (:func:`run_node_tests`), so one ``pytest`` covers both languages::

    out = run_js("const { buildCrystal } = await web('build/crystal.js');"
                 "return buildCrystal('fcc', input).toJSON({ precision: 12 });",
                 {"elements": ["Cu"], "a": 3.61})

In tests use the ``js`` fixture (``tests/conftest.py``), which is :func:`run_js` after :func:`require_node`.

Node discovery: ``$CRYSTALLUME_NODE`` (a path, or ``0``/``off``/``false``/``no`` to disable), then ``node`` on
``PATH``; Node.js 22 or newer is required.  Without it the JS tests are skipped, unless
``$CRYSTALLUME_REQUIRE_NODE`` is ``1``/``true``/``yes`` (CI), which turns the skip into a failure.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

__all__ = [
    "REPO",
    "WEB_JS",
    "MIN_NODE_MAJOR",
    "NodeUnavailable",
    "JSError",
    "find_node",
    "node_required",
    "require_node",
    "run_js",
    "run_node_tests",
    "tap_summary",
    "tap_failures",
]

REPO = Path(__file__).resolve().parents[1]
WEB_JS = REPO / "crystallume" / "web" / "js"

#: Node 20 is end-of-life (2026-04-30); 22 runs ``node --test`` with explicit file lists and the web modules
#: as ES modules (``crystallume/web/js/package.json`` declares ``"type": "module"``).
MIN_NODE_MAJOR = 22

_OFF = ("0", "off", "false", "no")
_ON = ("1", "true", "yes")

#: JSON has no NaN or infinities: both directions send them as ``{"$float": "NaN" | "Infinity" | "-Infinity"}``.
_FLOAT_KEY = "$float"

# The driver: reads {"source", "input"} from stdin, runs ``source`` as the body of an async
# function(input, web, repo) and prints the JSON result on stdout.  web(rel) imports crystallume/web/js/<rel>,
# repo(rel) any module of the checkout (e.g. 'tests/js/helpers.mjs').  console.log/info/debug go to stderr so
# that stdout carries only the result; typed arrays become arrays, Map/Set objects/arrays, NaN and infinities
# the $float objects above.
_DRIVER = r"""
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
for (const k of ['log', 'info', 'debug']) console[k] = (...a) => console.error(...a);
const nonFinite = (v) => (Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity');
const revive = (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1
  && typeof v.$float === 'string' ? Number(v.$float) : v);
const replace = (k, v) => {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v, Number);
  if (v instanceof Map) return Object.fromEntries(v);
  if (v instanceof Set) return [...v];
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && !Number.isFinite(v)) return { $float: nonFinite(v) };
  return v;
};
const done = (stream, text, code) => stream.write(text, () => process.exit(code));
const env = process.env;
const load = (base, rel) => import(pathToFileURL(`${base}/${rel}`).href);
const web = (rel) => load(env.CRYSTALLUME_WEB_JS, rel);
const repo = (rel) => load(env.CRYSTALLUME_REPO, rel);
try {
  const req = JSON.parse(readFileSync(0, 'utf8'), revive);
  const AsyncFunction = (async () => {}).constructor;
  const out = await new AsyncFunction('input', 'web', 'repo', req.source)(req.input, web, repo);
  done(process.stdout, JSON.stringify(out === undefined ? null : out, replace), 0);
} catch (err) {
  done(process.stderr, String((err && err.stack) || err), 3);
}
"""


class NodeUnavailable(RuntimeError):
    """No usable Node.js; tests skip (or fail when ``$CRYSTALLUME_REQUIRE_NODE`` is set)."""


class JSError(RuntimeError):
    """The JavaScript side threw, timed out or printed no result; ``stderr`` has Node's output."""

    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


def find_node() -> tuple[str, tuple[int, int, int]]:
    """Path and version of a usable ``node``; raises :class:`NodeUnavailable` with the reason.

    The lookup is cached for the current ``$CRYSTALLUME_NODE`` and ``$PATH``.
    """
    return _find_node(os.environ.get("CRYSTALLUME_NODE", "").strip(), os.environ.get("PATH", ""))


@lru_cache(maxsize=8)
def _find_node(env: str, path: str) -> tuple[str, tuple[int, int, int]]:
    if env.lower() in _OFF:
        raise NodeUnavailable(f"disabled by CRYSTALLUME_NODE={env}")
    node = shutil.which(env, path=path) if env else shutil.which("node", path=path)
    if not node:
        raise NodeUnavailable(f"node not found (CRYSTALLUME_NODE={env})" if env else "node not found on PATH")
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        raise NodeUnavailable(f"cannot run {node}: {exc}") from None
    ver = out.stdout.strip()
    m = re.match(r"v(\d+)\.(\d+)\.(\d+)", ver)
    if not m:
        raise NodeUnavailable(f"unexpected `{node} --version` output {ver or out.stderr.strip()!r}")
    version = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if version[0] < MIN_NODE_MAJOR:
        raise NodeUnavailable(f"{node} is {ver}, older than v{MIN_NODE_MAJOR}")
    if not (WEB_JS / "core" / "structure.js").is_file():
        raise NodeUnavailable(f"web modules not found in {WEB_JS}")
    return node, version


def node_required() -> bool:
    """``True`` when ``$CRYSTALLUME_REQUIRE_NODE`` is ``1``, ``true`` or ``yes`` (missing Node fails the tests)."""
    return os.environ.get("CRYSTALLUME_REQUIRE_NODE", "").strip().lower() in _ON


def require_node() -> tuple[str, tuple[int, int, int]]:
    """:func:`find_node` for tests: skip the test when Node is missing, fail it when Node is required."""
    import pytest

    try:
        return find_node()
    except NodeUnavailable as exc:
        if node_required():
            pytest.fail(f"CRYSTALLUME_REQUIRE_NODE is set but the JS tests cannot run: {exc}", pytrace=False)
        pytest.skip(f"JS parity tests need Node.js >= {MIN_NODE_MAJOR}: {exc}")
    raise AssertionError("unreachable")  # pragma: no cover


def _env() -> dict[str, str]:
    return {**os.environ, "CRYSTALLUME_WEB_JS": str(WEB_JS), "CRYSTALLUME_REPO": str(REPO), "NODE_NO_WARNINGS": "1"}


def _encode(obj: Any) -> Any:
    """JSON-ready copy of a payload: numpy arrays and scalars as lists and numbers, tuples as lists,
    NaN and infinities as ``{"$float": ...}``."""
    if isinstance(obj, float):
        if math.isfinite(obj):
            return obj
        return {_FLOAT_KEY: "NaN" if math.isnan(obj) else ("Infinity" if obj > 0 else "-Infinity")}
    if isinstance(obj, dict):
        return {k: _encode(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_encode(v) for v in obj]
    tolist = getattr(obj, "tolist", None)  # numpy arrays and scalars
    if callable(tolist) and type(obj).__module__ == "numpy":
        return _encode(tolist())
    return obj


def _decode(obj: dict[str, Any]) -> Any:
    if len(obj) == 1 and isinstance(obj.get(_FLOAT_KEY), str):
        return float(obj[_FLOAT_KEY].replace("Infinity", "inf"))
    return obj


def run_js(source: str, payload: Any = None, timeout: float = 30.0) -> Any:
    """Run *source*, the body of ``async function(input, web, repo)``, under Node and return its JSON result.

    ``input`` is *payload* (JSON-encoded: lists, dicts, numbers, strings, numpy arrays); ``await web(rel)``
    imports ``crystallume/web/js/<rel>``, ``await repo(rel)`` any module of the checkout.  Typed arrays come back
    as lists.  Raises :class:`JSError` when the code throws or Node times out, :class:`NodeUnavailable` without Node.
    """
    node, _ = find_node()
    request = json.dumps({"source": source, "input": _encode(payload)}, allow_nan=False)
    try:
        proc = subprocess.run([node, "--input-type=module", "-e", _DRIVER], input=request, capture_output=True,
                              text=True, encoding="utf-8", timeout=timeout, env=_env(), cwd=REPO)
    except subprocess.TimeoutExpired as exc:
        raise JSError(f"node did not finish within {timeout:g} s", _text(exc.stderr)) from None
    if proc.returncode != 0:
        first = next((ln for ln in proc.stderr.splitlines() if ln.strip()), "(no output)")
        raise JSError(f"node exited with {proc.returncode}: {first.strip()}", proc.stderr)
    try:
        return json.loads(proc.stdout or "null", object_hook=_decode)
    except json.JSONDecodeError:
        raise JSError(f"node printed something that is not JSON: {proc.stdout[:200]!r}", proc.stderr) from None


def _text(data: str | bytes | None) -> str:
    return data.decode("utf-8", "replace") if isinstance(data, bytes) else (data or "")


def run_node_tests(paths: Sequence[str | Path], *, timeout: float = 300.0) -> subprocess.CompletedProcess:
    """Run node:test files with ``node --test --test-reporter=tap FILE ...`` and return the finished process.

    Pass the test files themselves: ``node --test DIR`` fails on Node 22 and 24, and any file given is run as a
    test file.  Check ``returncode == 0`` and :func:`tap_summary` (``fail == 0``); a timeout raises :class:`JSError`.
    """
    if isinstance(paths, (str, Path)):
        raise TypeError("run_node_tests takes a list of test files")
    files = [Path(p) for p in paths]
    if not files:
        raise ValueError("run_node_tests needs at least one test file")
    for f in files:
        if f.is_dir():
            raise ValueError(f"{f} is a directory: pass the test files (node --test DIR fails on Node 22/24)")
        if not f.is_file():
            raise FileNotFoundError(f"no such test file: {f}")
    node, _ = find_node()
    try:
        return subprocess.run([node, "--test", "--test-reporter=tap", *(str(f.resolve()) for f in files)],
                              capture_output=True, text=True, encoding="utf-8", timeout=timeout, env=_env(), cwd=REPO)
    except subprocess.TimeoutExpired as exc:
        raise JSError(f"node --test did not finish within {timeout:g} s", _text(exc.stderr)) from None


def tap_summary(tap: str) -> dict[str, int]:
    """The ``# tests``, ``# pass``, ``# fail``, ``# cancelled``, ``# skipped`` and ``# todo`` counts of TAP output
    (missing counts are absent from the result)."""
    return {m.group(1): int(m.group(2))
            for m in re.finditer(r"^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$", tap, re.M)}


def tap_failures(tap: str) -> list[str]:
    """Names of the failed tests (``not ok N - name`` lines, nested subtests included) in TAP output."""
    return [m.group(1).strip() for m in re.finditer(r"^\s*not ok \d+ - (.*?)(?: # .*)?$", tap, re.M)]
