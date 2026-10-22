"""Plugin discovery, registration and the example hello plugin."""

from __future__ import annotations

import textwrap

from fastapi.testclient import TestClient

from crystallume import io as cl_io
from crystallume.config import Settings
from crystallume.plugins import PluginManager
from crystallume.server import create_app

from .conftest import EXAMPLE_PLUGINS

HELLO_FILE = "HELLO tiny chain\nCu 0 0 0\nCu 2.5 0 0\n"


def test_example_plugin_via_api(plugin_client):
    c = plugin_client
    info = c.get("/api/v1/info").json()
    hello = next(p for p in info["plugins"] if p["name"] == "hello")
    assert hello["status"] == "loaded" and hello["version"] == "1.0.0"
    assert hello["frontend"] == ["plugins/hello/hello.js"]  # relative: works under a sub-path
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
    assert "rollbackfmt" not in {r.name for r in cl_io.readers()}  # rolled back
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


def test_frontend_urls_are_relative_and_look_alias(tmp_path):
    mgr = PluginManager([EXAMPLE_PLUGINS], use_entry_points=False).load_all()
    (rec,) = mgr.records
    assert rec.frontend == ["plugins/hello/hello.js"]
    assert rec.to_json()["static"] == "plugins/hello/"
    d = tmp_path / "p"
    d.mkdir()
    (d / "looky.py").write_text(textwrap.dedent("""
        def register(ctx):
            ctx.add_preset("look", {"id": "dusk", "scene": {"post": {"bloom": {"enabled": True}}}})
            ctx.add_preset("looks", {"id": "dawn", "scene": {}})
    """))
    presets = PluginManager([d], use_entry_points=False).load_all().presets()
    assert [p["id"] for p in presets["styles"]] == ["dusk", "dawn"]
    assert presets["styles"][0]["plugin"] == "looky"


def test_load_plugins_helper():
    import crystallume as cl

    mgr = cl.load_plugins([EXAMPLE_PLUGINS], entry_points=False)
    s = mgr.builders["hello-chain"].func(n=3)
    assert len(s) == 3
    assert "centerOfMass" in mgr.analyses["hello-com"].func(s)
    assert cl.parse_text(HELLO_FILE, format="hello").formula == "Cu2"


def test_plugin_template_names():
    import pytest

    from crystallume.plugins import plugin_template

    files = plugin_template("my_plugin")
    assert set(files) == {"plugin.py", "static/my_plugin.js"}
    with pytest.raises(ValueError):
        plugin_template("../evil")


def test_former_package_name_imports():
    """Plugins and scripts written for AtomScope import ``atomscope``: it is the crystallume package."""
    import importlib
    import warnings

    import crystallume
    import crystallume.core.structure

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        atomscope = importlib.import_module("atomscope")
        legacy_structure = importlib.import_module("atomscope.core.structure")
    assert atomscope is crystallume and legacy_structure is crystallume.core.structure
    assert crystallume.core.structure.__spec__.name == "crystallume.core.structure"
    from atomscope import PluginContext, Structure  # noqa: F401  (the old plugin template's import)
    assert Structure is crystallume.Structure


def test_entry_point_in_both_groups_loads_once(tmp_path, monkeypatch):
    import sys

    site = tmp_path / "site"
    (site / "dualplug").mkdir(parents=True)
    (site / "dualplug" / "__init__.py").write_text("PLUGIN = {'name': 'dualplug'}\ndef register(ctx):\n    pass\n")
    dist = site / "dualplug-0.1.dist-info"
    dist.mkdir()
    (dist / "METADATA").write_text("Metadata-Version: 2.1\nName: dualplug\nVersion: 0.1\n")
    (dist / "entry_points.txt").write_text("[crystallume.plugins]\ndualplug = dualplug\n\n"
                                           "[atomscope.plugins]\ndualplug = dualplug\n")
    monkeypatch.syspath_prepend(str(site))
    try:
        mgr = PluginManager([], use_entry_points=True).load_all()
        recs = [r for r in mgr.records if r.name == "dualplug"]
        assert [r.status for r in recs] == ["loaded"]
    finally:
        sys.modules.pop("dualplug", None)
