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


def test_local_store_copied_folder_never_takes_the_id(tmp_path):
    import shutil

    root = tmp_path / "projects"
    store = LocalFileStore(root)
    doc = store.create("local", ats.new_project("Study", [build.molecule("water")]))
    pid, original = doc["id"], store.folder_of(doc["id"])
    # copied while the project stays open, which then saves again (the original becomes the newer folder)
    shutil.copytree(original, root / "backup copy")
    time.sleep(0.01)
    cur = store.get("local", pid)
    cur["description"] = "latest work"
    store.update("local", pid, cur, expected_updated=cur["updated"])
    store.list("local")
    assert store.folder_of(pid) == original and store.get("local", pid)["description"] == "latest work"
    # a fresh process (nothing indexed yet), mtimes kept by the copy: the "<name>-<id>" folder keeps the id
    shutil.copytree(original, root / "another copy")
    fresh = LocalFileStore(root)
    fresh.list("local")
    assert fresh.folder_of(pid) == original
    assert len({p["id"] for p in fresh.list("local")}) == 3



@pytest.mark.parametrize("case", ["renamed-original", "copy-of-prefix", "renamed-after-save"])
def test_local_store_copy_then_save_keeps_id_on_latest_work(tmp_path, case):
    """Neither the index nor the folder names tell the two apart: the folder saved last keeps the id."""
    import shutil

    root = tmp_path / "projects"
    store = LocalFileStore(root)
    pid = store.create("local", ats.new_project("Study", [build.molecule("water")]))["id"]
    original = store.folder_of(pid)
    if case == "renamed-original":   # renamed by hand (no "-<id>" suffix), then copied
        original = original.rename(root / "My Study")
        store.list("local")
        copy = root / "My Study copy"
    else:                            # "Copy of study-p_…" also ends in "-<id>"
        copy = root / f"Copy of {original.name}"
    time.sleep(0.02)
    shutil.copytree(original, copy)
    time.sleep(0.02)
    cur = store.get("local", pid)
    cur["description"] = "latest work"
    store.update("local", pid, cur, expected_updated=cur["updated"])
    if case == "renamed-after-save":  # same process: the indexed folder is gone, and neither name is canonical
        original = original.rename(root / "Renamed")
        check = store
    else:                             # restarted before the next listing
        check = LocalFileStore(root)
    check.list("local")
    assert check.folder_of(pid) == original
    assert check.get("local", pid)["description"] == "latest work"
    assert len({p["id"] for p in check.list("local")}) == 2

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


# ---------------------------------------------------------------- optimistic locking & summaries
@pytest.mark.parametrize("kind", ["local", "sqlite"])
def test_update_conflicts_and_formula(tmp_path, kind):
    from atomscope.storage.base import ProjectConflict

    store = LocalFileStore(tmp_path / "p") if kind == "local" else SQLiteStore(tmp_path / "db.sqlite", secret="x")
    doc = store.create("u", {**_project(), "baseUpdated": "junk", "location": {"provider": "server"}})
    assert "baseUpdated" not in doc and "location" not in doc  # client bookkeeping is never stored
    assert store.list("u")[0]["formula"] == "SrTiO3"
    assert [p["id"] for p in store.list("u", q="srtio3")] == [doc["id"]]  # search covers the formula

    v1 = doc["updated"]
    a = store.update("u", doc["id"], {**doc, "name": "A"}, expected_updated=v1)
    assert a["updated"] != v1
    with pytest.raises(ProjectConflict) as exc:
        store.update("u", doc["id"], {**doc, "name": "B"}, expected_updated=v1)  # stale copy
    assert exc.value.current == a["updated"]
    with pytest.raises(ProjectConflict):
        store.patch("u", doc["id"], {"name": "C"}, expected_updated=v1)
    assert store.get("u", doc["id"])["name"] == "A"
    assert store.patch("u", doc["id"], {"name": "C"}, expected_updated=a["updated"])["name"] == "C"
    assert store.update("u", doc["id"], {**doc, "name": "D"})["name"] == "D"  # no version: last write wins
    # versions strictly increase even for writes within one millisecond
    seen = [store.update("u", doc["id"], {**doc, "name": f"n{i}"})["updated"] for i in range(5)]
    assert seen == sorted(set(seen))
    store.close()


@pytest.mark.parametrize("kind", ["local", "sqlite"])
def test_summary_covers_every_structure(tmp_path, kind):
    store = LocalFileStore(tmp_path / "p") if kind == "local" else SQLiteStore(tmp_path / "db.sqlite", secret="x")
    salt = build.crystal("rocksalt", ["Na", "Cl"], a=5.64).to_dict()
    chain = {"symbols": ["Au"] * 8, "positions": [[2.9 * i, 0.0, 0.0] for i in range(8)]}
    doc = store.create("u", {"name": "Salt study", "activeStructure": "s_2", "structures": [
        {"id": "s_1", "name": "NaCl", "structure": salt}, {"id": "s_2", "name": "Au chain", "structure": chain}]})
    s = store.list("u")[0]
    assert s["formula"] == "Au8" and s["nAtoms"] == 8  # the active structure, as before
    assert s["formulas"] == ["Na4Cl4", "Au8"] and s["nAtomsTotal"] == 16
    assert [p["id"] for p in store.list("u", q="Na4Cl4")] == [doc["id"]]
    assert [p["id"] for p in store.list("u", q="nacl")] == [doc["id"]]  # letters only: counts are ignored
    assert store.list("u", q="au9") == []
    store.close()


def test_sqlite_summary_backfill_and_token_expiry(tmp_path):
    store = SQLiteStore(tmp_path / "db.sqlite", secret="s", token_ttl_days=7)
    doc = store.create("u", _project())
    # simulate a row written by an older version (no formula in the stored summary)
    old = json.loads(store._q("SELECT summary_json FROM projects")[0]["summary_json"])
    old.pop("formula")
    old.pop("formulas")
    store._x("UPDATE projects SET summary_json=?", (json.dumps(old),))
    assert store.list("u")[0]["formula"] == "SrTiO3"
    assert store.list("u")[0]["formulas"] == ["SrTiO3"]
    assert "formula" in json.loads(store._q("SELECT summary_json FROM projects")[0]["summary_json"])
    assert store.get("u", doc["id"])["name"] == "Perovskite study"

    u = store.create_user("alice", "password1")
    token = store.create_token(u["id"])
    first = store._q("SELECT last_used FROM tokens")[0]["last_used"]
    time.sleep(0.01)
    assert store.user_for_token(token)["username"] == "alice"
    assert store._q("SELECT last_used FROM tokens")[0]["last_used"] == first  # touched at most once a minute
    store._x("UPDATE tokens SET last_used='2000-01-01T00:00:00.000Z', created='2000-01-01T00:00:00.000Z'")
    assert store.user_for_token(token) is None
    never = SQLiteStore(tmp_path / "db2.sqlite", secret="s", token_ttl_days=0)
    t2 = never.create_token(never.create_user("bob", "password1")["id"])
    never._x("UPDATE tokens SET last_used='2000-01-01T00:00:00.000Z'")
    assert never.user_for_token(t2)["username"] == "bob"
    store.close()
    never.close()


@pytest.mark.parametrize("kind", ["local", "sqlite"])
def test_search_fields_match_web_app(tmp_path, kind):
    """``q`` matches name, formula, description and tags, like the web app's matchesQuery."""
    store = LocalFileStore(tmp_path / "p") if kind == "local" else SQLiteStore(tmp_path / "db.sqlite")
    try:
        a = store.create("u1", {**_project("Alpha"), "description": "Strain study near the Curie point", "tags": ["oxide"]})
        b = store.create("u1", {**_project("Beta"), "description": "", "tags": ["Thin-Film"]})

        def ids(q):
            return {s["id"] for s in store.list("u1", q=q)}

        assert ids("curie") == {a["id"]}  # description only
        assert ids("thin-film") == {b["id"]}  # tag, case-insensitive
        assert ids("srtio3") == {a["id"], b["id"]}  # formula
        assert ids("  ALPHA ") == {a["id"]}  # name, trimmed
        assert ids("") == ids(None) == ids("   ") == {a["id"], b["id"]}
        assert ids("nothing-like-this") == set()
    finally:
        store.close()


def test_copied_folder_with_same_timestamps_keeps_original_id(tmp_path):
    """A folder copied while the server was stopped ('Copy of …', timestamps preserved) gets the new id."""
    import shutil
    from atomscope.storage.local import LocalFileStore

    store = LocalFileStore(tmp_path)
    doc = store.create("local", {"name": "study", "structures": []})
    pid = doc["id"]
    original = store.folder_of(pid)
    shutil.copytree(original, tmp_path / f"Copy of {original.name}")
    fresh = LocalFileStore(tmp_path)
    ids = {s["id"] for s in fresh.list("local")}
    assert len(ids) == 2 and pid in ids
    assert fresh.folder_of(pid) == original
