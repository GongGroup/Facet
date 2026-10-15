"""Plugin discovery, registration and the example hello plugin."""

from __future__ import annotations

import textwrap

from fastapi.testclient import TestClient

from atomscope import io as ats_io
from atomscope.config import Settings
from atomscope.plugins import PluginManager
from atomscope.server import create_app

from .conftest import EXAMPLE_PLUGINS

HELLO_FILE = "HELLO tiny chain\nCu 0 0 0\nCu 2.5 0 0\n"


def test_example_plugin_via_api(plugin_client):
    c = plugin_client
    info = c.get("/api/v1/info").json()
    hello = next(p for p in info["plugins"] if p["name"] == "hello")
    assert hello["status"] == "loaded" and hello["version"] == "1.0.0"
    assert hello["frontend"] == ["/plugins/hello/hello.js"]
    assert any(b["name"] == "hello-chain" for b in info["customBuilders"])
    assert any(a["name"] == "hello-com" for a in info["customAnalyses"])
    assert [p["id"] for p in info["presets"]["lighting"]] == ["hello-sunset"]
    assert any(r["name"] == "hello" for r in info["formats"]["readers"])

    # frontend module is served
    js = c.get("/plugins/hello/hello.js")
    assert js.status_code == 200 and "export default function activate" in js.text

    # extension route
    assert c.get("/api/v1/ext/hello").json()["message"].startswith("Hello")

    # reader: by extension and explicit format
    r = c.post("/api/v1/io/parse", files={"file": ("x.hello", HELLO_FILE.encode())})
    assert r.status_code == 200 and r.json()["format"] == "hello"
    assert r.json()["structure"]["symbols"] == ["Cu", "Cu"] and r.json()["structure"]["name"] == "tiny chain"

    # writer
    r = c.post("/api/v1/io/export", json={"structure": r.json()["structure"], "format": "hello"})
    assert r.json()["text"].startswith("HELLO tiny chain")

    # custom builder and analysis
    r = c.post("/api/v1/build/custom/hello-chain", json={"element": "Ag", "n": 5, "spacing": 2.9})
    assert r.status_code == 200 and r.json()["structure"]["symbols"] == ["Ag"] * 5
    assert c.post("/api/v1/build/custom/hello-chain", json={"n": 0}).status_code == 400
    assert c.post("/api/v1/build/custom/missing", json={}).status_code == 404
    r = c.post("/api/v1/analysis/custom/hello-com", json={"structure": r.json()["structure"]})
    assert abs(r.json()["result"]["centerOfMass"][0] - 5.8) < 1e-6

    plugins = c.get("/api/v1/plugins").json()["plugins"]
    assert plugins[0]["routes"] == ["/api/v1/ext/hello"]


def test_broken_plugins_are_reported_not_fatal(tmp_path):
    d = tmp_path / "plugins"
    d.mkdir()
    (d / "syntax_error.py").write_text("def register(ctx):\n    return (\n")
    (d / "raises.py").write_text(textwrap.dedent("""
        PLUGIN = {"name": "raiser", "version": "0.1"}
        def bad_reader(text):
            return None
        def register(ctx):
            ctx.register_reader("rollbackfmt", bad_reader, extensions=[".rb1"])
            raise RuntimeError("boom")
    """))
    (d / "noreg.py").write_text("X = 1\n")
    good = d / "good"
    good.mkdir()
    (good / "plugin.py").write_text(textwrap.dedent("""
        '''A good plugin.'''
        def register(ctx):
            ctx.add_preset("colorScheme", {"id": "mono", "name": "Mono"})
            ctx.add_preset("style", {"id": "sticks"})
    """))
    (d / "_ignored.py").write_text("raise SystemExit")

    mgr = PluginManager([d], use_entry_points=False).load_all()
    by_name = {r.name: r for r in mgr.records}
    assert by_name["raiser"].status == "error" and "boom" in by_name["raiser"].error
    assert "rollbackfmt" not in {r.name for r in ats_io.readers()}  # rolled back
    assert by_name["syntax_error"].status == "error"
    assert by_name["noreg"].status == "error"
    assert by_name["good"].status == "loaded" and by_name["good"].description == "A good plugin."
    assert mgr.presets()["colorSchemes"][0]["id"] == "mono"
    assert mgr.presets()["styles"][0]["name"] == "sticks"

    settings = Settings(data_dir=tmp_path / "data", plugin_dirs=[d], entry_point_plugins=False)
    with TestClient(create_app(settings)) as c:
        info = c.get("/api/v1/info").json()
        statuses = {p["name"]: p["status"] for p in info["plugins"]}
        assert statuses == {"good": "loaded", "noreg": "error", "raiser": "error", "syntax_error": "error"}


def test_missing_plugin_dir_is_ignored(tmp_path):
    mgr = PluginManager([tmp_path / "missing"], use_entry_points=False).load_all()
    assert mgr.records == []


def test_load_example_directly():
    mgr = PluginManager([EXAMPLE_PLUGINS], use_entry_points=False).load_all()
    (rec,) = mgr.records
    assert rec.status == "loaded" and rec.static_dir is not None and rec.static_dir.name == "static"
    assert set(rec.readers) == {"hello"} and set(rec.builders) == {"hello-chain"}
