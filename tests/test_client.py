"""The stdlib REST client against a real uvicorn server in a background thread."""

from __future__ import annotations

import socket

import pytest

from crystallume import Client, build, read
from crystallume.client import ClientError, ExportResult
from crystallume.config import Settings
from crystallume.server import BackgroundServer, create_app

from .conftest import EXAMPLE_PLUGINS

#: (method, path) of every REST route → the Client method that calls it.
ROUTE_METHODS = {
    ("GET", "/api/v1/health"): "health",
    ("GET", "/api/v1/info"): "info",
    ("GET", "/api/v1/elements"): "elements",
    ("GET", "/api/v1/projects"): "projects",
    ("POST", "/api/v1/projects"): "create_project",
    ("POST", "/api/v1/projects/import"): "import_project",
    ("GET", "/api/v1/projects/{pid}"): "get_project",
    ("PUT", "/api/v1/projects/{pid}"): "update_project",
    ("PATCH", "/api/v1/projects/{pid}"): "patch_project",
    ("DELETE", "/api/v1/projects/{pid}"): "delete_project",
    ("POST", "/api/v1/projects/{pid}/duplicate"): "duplicate_project",
    ("GET", "/api/v1/projects/{pid}/download"): "download_project",
    ("GET", "/api/v1/formats"): "formats",
    ("POST", "/api/v1/io/parse"): "upload_structure",
    ("POST", "/api/v1/io/export"): "export_structure",
    ("POST", "/api/v1/io/convert"): "convert",
    ("GET", "/api/v1/build/prototypes"): "prototypes",
    ("POST", "/api/v1/build/crystal"): "build_crystal",
    ("POST", "/api/v1/build/cluster"): "build_cluster",
    ("POST", "/api/v1/build/supercell"): "supercell",
    ("GET", "/api/v1/build/molecules"): "molecules",
    ("GET", "/api/v1/build/molecule/{name}"): "molecule",
    ("GET", "/api/v1/build/custom"): "custom_builders",
    ("POST", "/api/v1/build/custom/{name}"): "build_custom",
    ("POST", "/api/v1/analysis/bonds"): "bonds",
    ("POST", "/api/v1/analysis/summary"): "summary",
    ("POST", "/api/v1/analysis/coordination"): "coordination",
    ("POST", "/api/v1/analysis/rdf"): "rdf",
    ("GET", "/api/v1/analysis/custom"): "custom_analyses",
    ("POST", "/api/v1/analysis/custom/{name}"): "analysis",
    ("GET", "/api/v1/plugins"): "plugins",
}
#: Routes without a dedicated method on purpose (auth has register/login/logout/me; docs are HTML).
NO_METHOD_PREFIXES = ("/api/v1/auth/", "/api/v1/ext/", "/docs", "/redoc", "/openapi.json")
#: Second methods on a route of ROUTE_METHODS (a different return type, never a flag that changes it).
EXTRA_METHODS = {"export_structure_with_warnings"}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _api_routes(routes, prefix=""):
    """(method, path) of every API route, also through routers included lazily (newer FastAPI)."""
    for r in routes:
        inner = getattr(r, "original_router", None)
        if inner is not None:
            ctx = getattr(r, "include_context", None)
            yield from _api_routes(inner.routes, prefix + (getattr(ctx, "prefix", "") or ""))
        elif getattr(r, "methods", None) and getattr(r, "path", None) is not None:
            for m in r.methods - {"HEAD", "OPTIONS"}:
                yield m, prefix + r.path


def test_every_route_has_a_client_method(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "d", plugin_dirs=[EXAMPLE_PLUGINS], entry_point_plugins=False))
    routes = set(_api_routes(app.routes))
    assert ("GET", "/api/v1/health") in routes and len(routes) > 25
    missing = sorted(f"{m} {p}" for m, p in routes if not p.startswith(NO_METHOD_PREFIXES) and (m, p) not in ROUTE_METHODS)
    assert not missing, f"add Client methods (and ROUTE_METHODS entries) for: {missing}"
    for name in [*ROUTE_METHODS.values(), *sorted(EXTRA_METHODS)]:
        assert callable(getattr(Client, name, None)), name
    stale = sorted(f"{m} {p}" for m, p in ROUTE_METHODS if (m, p) not in routes)
    assert not stale, f"ROUTE_METHODS lists routes the server no longer has: {stale}"


@pytest.fixture(scope="module")
def plugin_server(tmp_path_factory):
    srv = BackgroundServer(Settings(port=_free_port(), data_dir=tmp_path_factory.mktemp("psrv"),
                                    plugin_dirs=[EXAMPLE_PLUGINS], entry_point_plugins=False)).start()
    yield srv
    srv.stop()


def test_client_plugins_and_discovery(plugin_server, tmp_path, data_dir):
    c = Client(plugin_server.url)
    s = c.build_custom("hello-chain", n=4, element="Cu")
    res = c.analysis("hello-com", s)
    assert abs(res["centerOfMass"][0] - 3.9) < 1e-6 and res["totalMass"] > 0
    assert [a["name"] for a in c.custom_analyses()] == ["hello-com"]
    assert [b["name"] for b in c.custom_builders()] == ["hello-chain"]
    assert c.plugins()[0]["name"] == "hello" and c.plugins()[0]["status"] == "loaded"
    assert "fcc" in c.prototypes()["prototypes"] and "icosahedron" in c.prototypes()["clusters"]
    assert any(m["name"] == "water" for m in c.molecules())
    assert any(e["symbol"] == "Fe" for e in c.elements())
    cn = c.coordination(build.crystal("fcc", "Cu", a=3.61))
    assert cn["average"] == 12.0 and cn["byElement"] == {"Cu": 12.0}
    out = tmp_path / "nacl.hello"
    text = c.convert(data_dir / "NaCl.cif", "hello", out)
    assert text.startswith("HELLO") and out.read_text() == text
    assert len(c.rdf(s, rmax=5, nbins=10, elements=["Cu", "Cu"])["g"]) == 10
    with pytest.raises(ClientError) as exc:
        c.analysis("missing", s)
    assert exc.value.status == 404


@pytest.fixture(scope="module")
def servers(tmp_path_factory):
    base = tmp_path_factory.mktemp("srv")
    local = BackgroundServer(Settings(port=_free_port(), data_dir=base / "local", entry_point_plugins=False)).start()
    cloud = BackgroundServer(Settings(port=_free_port(), mode="cloud", data_dir=base / "cloud",
                                      entry_point_plugins=False)).start()
    yield local, cloud
    local.stop()
    cloud.stop()


def test_client_local(servers, data_dir):
    local, _ = servers
    c = Client(local.url)
    assert c.health()["status"] == "ok"
    s = c.upload_structure(data_dir / "NaCl.cif")
    assert s.formula == "Na4Cl4"
    p = c.create_project("Client test", structures=[s, build.molecule("water")], scene={"a": 1})
    assert p["scene"] == {"a": 1} and len(p["structures"]) == 2
    assert c.projects()[0]["id"] == p["id"]
    p2 = c.patch_project(p["id"], name="Renamed")
    assert p2["name"] == "Renamed"
    full = c.get_project(p["id"])
    full["description"] = "via PUT"
    assert c.update_project(p["id"], full)["description"] == "via PUT"
    assert c.duplicate_project(p["id"])["name"] == "Renamed (copy)"
    si = c.build_crystal("diamond", ["Si"], supercell=[2, 1, 1])
    assert len(si) == 16
    assert len(c.bonds(si)) == 32
    assert len(c.build_cluster("icosahedron", "Au", 3)) == 55
    assert "data_" in c.export_structure(si, "cif")
    slab = read(data_dir / "surface" / "contcar_pt111.vasp")
    res = c.export_structure_with_warnings(slab, "cif")
    assert isinstance(res, ExportResult) and res.text.startswith("# Generated") and res.notes == []
    assert (res.filename, res.mimetype) == ("Pt_111_p_3x3_4L_relaxed.cif", "chemical/x-cif")
    assert res.warnings == ["18 atom(s) are fixed or partly fixed (selective dynamics), but CIF cannot store "
                            "constraints; use POSCAR, Extended XYZ or Crystallume JSON to keep them"]
    clean = c.export_structure_with_warnings(slab.to_dict(), "poscar")
    assert clean.warnings == [] and clean.notes == [] and "Selective dynamics" in clean.text
    assert c.summary(si)["formula"] == "Si16"
    c.delete_project(p["id"])
    with pytest.raises(ClientError) as exc:
        c.get_project(p["id"])
    assert exc.value.status == 404


def test_client_cloud(servers):
    _, cloud = servers
    c = Client(cloud.url)
    with pytest.raises(ClientError) as exc:
        c.projects()
    assert exc.value.status == 401
    c.register("dave", "davepass")
    assert c.me()["user"]["username"] == "dave"
    c.create_project("Dave's")
    other = Client(cloud.url)
    other.register("erin", "erinpass")
    assert other.projects() == []
    c2 = Client(cloud.url)
    c2.login("dave", "davepass")
    assert [p["name"] for p in c2.projects()] == ["Dave's"]
    c2.logout()
    with pytest.raises(ClientError):
        c2.projects()
