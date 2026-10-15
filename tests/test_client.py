"""The stdlib REST client against a real uvicorn server in a background thread."""

from __future__ import annotations

import socket

import pytest

from atomscope import Client, build
from atomscope.client import ClientError
from atomscope.config import Settings
from atomscope.server import BackgroundServer


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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
