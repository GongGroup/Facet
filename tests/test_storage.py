"""Project stores: LocalFileStore and SQLiteStore."""

from __future__ import annotations

import base64
import json
import time

import pytest

import atomscope as ats
from atomscope import build
from atomscope.storage import (
    LocalFileStore,
    ProjectNotFound,
    ProjectTooLarge,
    ProjectValidationError,
    SQLiteStore,
    UserExists,
)

JPEG_1PX = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////"
    "//////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
)


def _project(name="Perovskite study"):
    return {
        "name": name,
        "tags": ["oxide"],
        "structures": [{"id": "s_1", "name": "SrTiO3", "structure": build.crystal("perovskite", "SrTiO3").to_dict()}],
        "scene": {"style": {"atomScale": 0.4}, "camera": {"zoom": 2}},
        "thumbnail": "data:image/jpeg;base64," + base64.b64encode(JPEG_1PX).decode(),
    }


def _crud(store, owner="u1"):
    doc = store.create(owner, _project())
    pid = doc["id"]
    assert pid.startswith("p_") and len(pid) == 12
    assert doc["created"] and doc["updated"] and doc["schema"] == "atomscope.project/1"
    assert doc["scene"] == {"style": {"atomScale": 0.4}, "camera": {"zoom": 2}}  # opaque round trip

    summaries = store.list(owner)
    assert len(summaries) == 1
    s = summaries[0]
    assert "structures" not in s and "scene" not in s
    assert s["nStructures"] == 1 and s["nAtoms"] == 5 and s["size"] > 0

    got = store.get(owner, pid)
    assert got["structures"][0]["structure"]["symbols"] == ["Sr", "Ti", "O", "O", "O"]

    time.sleep(0.01)  # timestamps have millisecond resolution
    upd = store.update(owner, pid, {**got, "name": "Renamed", "structures": []})
    assert upd["name"] == "Renamed" and upd["structures"] == [] and upd["created"] == doc["created"]
    assert upd["updated"] > doc["updated"]

    pat = store.patch(owner, pid, {"description": "hello", "id": "p_ffffffffff"})
    assert pat["description"] == "hello" and pat["id"] == pid and pat["name"] == "Renamed"
    time.sleep(0.01)

    dup = store.duplicate(owner, pid)
    assert dup["id"] != pid and dup["name"] == "Renamed (copy)"
    assert [x["id"] for x in store.list(owner)][0] == dup["id"]  # newest first
    assert [x["id"] for x in store.list(owner, q="copy")] == [dup["id"]]
    assert [x["id"] for x in store.list(owner, q="OXIDE")] != []  # tag search

    store.delete(owner, pid)
    with pytest.raises(ProjectNotFound):
        store.get(owner, pid)
    with pytest.raises(ProjectNotFound):
        store.delete(owner, pid)
    return dup


def test_local_store_crud(tmp_path):
    store = LocalFileStore(tmp_path / "projects")
    dup = _crud(store)
    folder = store.folder_of(dup["id"])
    assert folder.name.startswith("renamed-copy-")
    assert (folder / "project.json").is_file()
    assert (folder / "thumbnail.jpg").read_bytes() == JPEG_1PX
    assert not (folder / "structures").exists() or not list((folder / "structures").glob("*.xyz"))
    assert (tmp_path / "projects" / ".trash").is_dir()  # deletion is recoverable


def test_local_store_files_and_import(tmp_path):
    root = tmp_path / "projects"
    store = LocalFileStore(root)
    doc = store.create("local", _project("Files"))
    folder = store.folder_of(doc["id"])
    xyz = folder / "structures" / "s_1.xyz"
    assert xyz.is_file() and ats.read(xyz).formula == "SrTiO3"

    # Rename via update -> folder follows the name
    store.patch("local", doc["id"], {"name": "New name"})
    assert store.folder_of(doc["id"]).name == f"new-name-{doc['id']}"

    # Drop a project JSON and a bare structure JSON into the root -> imported
    dropped = ats.new_project("Dropped", [build.molecule("water")])
    (root / "dropped.json").write_text(json.dumps(dropped))
    (root / "si.json").write_text(json.dumps(build.crystal("diamond", "Si").to_dict()))
    names = {p["name"] for p in store.list("local")}
    assert {"New name", "Dropped", "si"} <= names
    assert not (root / "dropped.json").exists() and (root / ".imported").is_dir()

    # A copied folder with the same id gets a new id
    import shutil

    shutil.copytree(store.folder_of(doc["id"]), root / "my-copy")
    time.sleep(0.01)
    (root / "my-copy" / "project.json").touch()
    ids = [p["id"] for p in store.list("local")]
    assert len(ids) == len(set(ids)) == 4

    # A second store instance (another process) sees the same projects
    assert len(LocalFileStore(root).list("anyone")) == 4


def test_local_store_validation_and_limits(tmp_path):
    store = LocalFileStore(tmp_path / "p", max_project_bytes=2000)
    with pytest.raises(ProjectValidationError):
        store.create("local", {"name": 5})
    with pytest.raises(ProjectValidationError):
        store.create("local", {"structures": [{"structure": {"symbols": ["H"], "positions": []}}]})
    with pytest.raises(ProjectTooLarge):
        store.create("local", {"structures": [build.crystal("fcc", "Cu").repeat(3, 3, 3)]})
    doc = store.create("local", {})
    assert doc["name"] == "Untitled project" and doc["structures"] == [] and doc["activeStructure"] is None


def test_sqlite_store_crud_and_isolation(tmp_path):
    store = SQLiteStore(tmp_path / "db.sqlite", secret="test")
    _crud(store, owner="alice")
    bob_doc = store.create("bob", {"name": "Bob's"})
    assert all(p["id"] != bob_doc["id"] for p in store.list("alice"))
    with pytest.raises(ProjectNotFound):
        store.get("alice", bob_doc["id"])
    with pytest.raises(ProjectNotFound):
        store.delete("alice", bob_doc["id"])
    # client-supplied id is kept when free, replaced when taken
    assert store.create("alice", {"id": "p_0123456789"})["id"] == "p_0123456789"
    assert store.create("bob", {"id": "p_0123456789"})["id"] != "p_0123456789"
    store.close()


def test_sqlite_users_and_tokens(tmp_path):
    store = SQLiteStore(tmp_path / "db.sqlite", secret="s3cret")
    u = store.create_user("alice", "password1")
    assert u["username"] == "alice" and u["id"].startswith("u_")
    with pytest.raises(UserExists):
        store.create_user("ALICE", "password2")
    with pytest.raises(ValueError):
        store.create_user("bob", "123")
    assert store.authenticate("alice", "password1")["id"] == u["id"]
    assert store.authenticate("alice", "wrong") is None
    assert store.authenticate("nobody", "x") is None
    token = store.create_token(u["id"])
    assert store.user_for_token(token)["username"] == "alice"
    raw = store._q("SELECT token FROM tokens")[0]["token"]
    assert raw != token  # only a hash is stored
    assert store.revoke_token(token) and store.user_for_token(token) is None
    store.set_password("alice", "newpassword")
    assert store.authenticate("alice", "newpassword")
    store.delete_user("alice")
    assert store.list_users() == []
    store.close()
