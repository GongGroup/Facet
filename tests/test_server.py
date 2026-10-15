"""REST API tests (FastAPI TestClient)."""

from __future__ import annotations

import json

from atomscope import build

POSCAR_TEXT = """Si8 diamond
5.431
 1.0 0.0 0.0
 0.0 1.0 0.0
 0.0 0.0 1.0
Si
8
Direct
0.00 0.00 0.00
0.00 0.50 0.50
0.50 0.00 0.50
0.50 0.50 0.00
0.25 0.25 0.25
0.25 0.75 0.75
0.75 0.25 0.75
0.75 0.75 0.25
"""


def test_health_and_info(local_client):
    r = local_client.get("/api/v1/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "version": "0.1.0"}
    info = local_client.get("/api/v1/info").json()
    assert info["name"] == "AtomScope" and info["mode"] == "local"
    assert info["authRequired"] is False and info["allowRegistration"] is False
    readers = {f["name"] for f in info["formats"]["readers"]}
    writers = {f["name"] for f in info["formats"]["writers"]}
    assert {"xyz", "extxyz", "poscar", "cif", "pdb", "json"} <= readers <= writers | {"xyz"}
    assert "fcc" in info["prototypes"] and info["prototypes"]["perovskite"]["nElements"] == 3
    assert "icosahedron" in info["clusters"] and "caffeine" in info["molecules"]
    assert set(info["presets"]) == {"lighting", "colorSchemes", "styles"}
    assert info["plugins"] == [] and info["customBuilders"] == []


def test_meta_misc(local_client):
    assert local_client.get("/api/v1/formats").json()["readers"]
    el = local_client.get("/api/v1/elements").json()["elements"]
    assert len(el) >= 103 and el[0]["symbol"] == "H"
    assert local_client.get("/openapi.json").status_code == 200
    assert local_client.get("/docs").status_code == 200
    page = local_client.get("/")
    assert page.status_code == 200 and "AtomScope" in page.text  # placeholder without frontend
    assert local_client.get("/api/v1/does-not-exist").status_code == 404


def test_local_projects_crud(local_client):
    c = local_client
    me = c.get("/api/v1/auth/me").json()
    assert me == {"user": {"id": "local", "username": "local", "created": None}, "mode": "local", "authRequired": False}

    cu = c.post("/api/v1/build/crystal", json={"prototype": "fcc", "elements": ["Cu"]}).json()["structure"]
    body = {"name": "Copper 铜", "tags": ["metal"], "structures": [{"name": "Cu", "structure": cu}],
            "scene": {"style": {"bonds": False}, "camera": {"fov": 30}}}
    r = c.post("/api/v1/projects", json=body)
    assert r.status_code == 201
    doc = r.json()
    pid = doc["id"]
    assert doc["structures"][0]["id"] == "s_1" and doc["activeStructure"] == "s_1"
    assert doc["scene"] == body["scene"]

    lst = c.get("/api/v1/projects").json()
    assert [p["id"] for p in lst] == [pid]
    assert lst[0]["nAtoms"] == 4 and lst[0]["nStructures"] == 1 and "structures" not in lst[0]
    assert c.get("/api/v1/projects", params={"q": "metal"}).json()[0]["id"] == pid
    assert c.get("/api/v1/projects", params={"q": "zzz"}).json() == []

    got = c.get(f"/api/v1/projects/{pid}").json()
    assert got["name"] == "Copper 铜"

    put = c.put(f"/api/v1/projects/{pid}", json={**got, "description": "full replace"}).json()
    assert put["description"] == "full replace" and put["created"] == doc["created"]
    pat = c.patch(f"/api/v1/projects/{pid}", json={"scene": {"lighting": {"preset": "studio"}}}).json()
    assert pat["scene"] == {"lighting": {"preset": "studio"}} and pat["description"] == "full replace"

    dup = c.post(f"/api/v1/projects/{pid}/duplicate")
    assert dup.status_code == 201 and dup.json()["name"] == "Copper 铜 (copy)"

    dl = c.get(f"/api/v1/projects/{pid}/download")
    assert dl.status_code == 200
    assert "attachment" in dl.headers["content-disposition"]
    assert ".atomscope.json" in dl.headers["content-disposition"]
    assert dl.json()["id"] == pid

    imp = c.post("/api/v1/projects/import", files={"file": ("x.atomscope.json", dl.content, "application/json")})
    assert imp.status_code == 201 and imp.json()["id"] != pid and imp.json()["name"] == "Copper 铜"
    imp2 = c.post("/api/v1/projects/import", files={"file": ("POSCAR", POSCAR_TEXT.encode())})
    assert imp2.status_code == 201 and imp2.json()["structures"][0]["structure"]["symbols"] == ["Si"] * 8
    imp3 = c.post("/api/v1/projects/import", json={"name": "From JSON", "structures": []})
    assert imp3.status_code == 201

    assert c.delete(f"/api/v1/projects/{pid}").json() == {"ok": True, "id": pid}
    assert c.get(f"/api/v1/projects/{pid}").status_code == 404
    assert len(c.get("/api/v1/projects").json()) == 4


def test_project_validation_errors(local_client):
    r = local_client.post("/api/v1/projects", json={"structures": [{"structure": {"symbols": ["H"], "positions": []}}]})
    assert r.status_code == 400 and "positions" in r.json()["detail"]
    r = local_client.post("/api/v1/projects", json={"tags": "must-be-a-list"})
    assert r.status_code == 422
    r = local_client.patch("/api/v1/projects/p_0000000000", json={"name": "x"})
    assert r.status_code == 404


def test_cloud_auth_and_isolation(cloud_client):
    c = cloud_client
    info = c.get("/api/v1/info").json()
    assert info["mode"] == "cloud" and info["authRequired"] is True and info["allowRegistration"] is True

    r = c.get("/api/v1/projects")
    assert r.status_code == 401 and r.headers.get("www-authenticate") == "Bearer"
    assert c.get("/api/v1/auth/me").status_code == 401
    assert c.get("/api/v1/projects", headers={"Authorization": "Bearer nope"}).status_code == 401

    a = c.post("/api/v1/auth/register", json={"username": "alice", "password": "alicepass"})
    assert a.status_code == 201
    ta = a.json()["token"]
    assert a.json()["user"]["username"] == "alice"
    assert c.post("/api/v1/auth/register", json={"username": "alice", "password": "other123"}).status_code == 409
    assert c.post("/api/v1/auth/register", json={"username": "bob", "password": "x"}).status_code == 400
    c.post("/api/v1/auth/register", json={"username": "bob", "password": "bobpass1"})
    assert c.post("/api/v1/auth/login", json={"username": "bob", "password": "wrong"}).status_code == 401
    tb = c.post("/api/v1/auth/login", json={"username": "bob", "password": "bobpass1"}).json()["token"]
    ha, hb = {"Authorization": f"Bearer {ta}"}, {"Authorization": f"Bearer {tb}"}

    me = c.get("/api/v1/auth/me", headers=ha).json()
    assert me["user"]["username"] == "alice" and me["authRequired"] is True
    pa = c.post("/api/v1/projects", json={"name": "Alice's"}, headers=ha).json()["id"]
    pb = c.post("/api/v1/projects", json={"name": "Bob's"}, headers=hb).json()["id"]
    assert [p["id"] for p in c.get("/api/v1/projects", headers=ha).json()] == [pa]
    assert [p["id"] for p in c.get("/api/v1/projects", headers=hb).json()] == [pb]
    assert c.get(f"/api/v1/projects/{pb}", headers=ha).status_code == 404
    assert c.delete(f"/api/v1/projects/{pb}", headers=ha).status_code == 404
    assert c.put(f"/api/v1/projects/{pb}", json={"name": "hijack"}, headers=ha).status_code == 404
    # download link works with ?access_token=
    assert c.get(f"/api/v1/projects/{pa}/download", params={"access_token": ta}).status_code == 200

    assert c.post("/api/v1/auth/logout", headers=ha).json() == {"ok": True}
    assert c.get("/api/v1/projects", headers=ha).status_code == 401
    # non-project endpoints stay public
    assert c.post("/api/v1/build/cluster", json={"kind": "icosahedron", "element": "Au", "size": 2}).status_code == 200


def test_cloud_registration_disabled(tmp_path):
    from fastapi.testclient import TestClient

    from atomscope.config import Settings
    from atomscope.server import create_app

    s = Settings(mode="cloud", data_dir=tmp_path, allow_registration=False, entry_point_plugins=False)
    with TestClient(create_app(s)) as c:
        assert c.get("/api/v1/info").json()["allowRegistration"] is False
        assert c.post("/api/v1/auth/register", json={"username": "eve", "password": "evepass1"}).status_code == 403
        c.app.state.users.create_user("admin", "adminpass")
        assert c.post("/api/v1/auth/login", json={"username": "admin", "password": "adminpass"}).status_code == 200


def test_local_mode_auth_endpoints(local_client):
    assert local_client.post("/api/v1/auth/login", json={"username": "a", "password": "b"}).status_code == 400
    assert local_client.post("/api/v1/auth/logout").json() == {"ok": True}


def test_io_parse(local_client):
    r = local_client.post("/api/v1/io/parse", json={"text": POSCAR_TEXT, "format": "poscar"})
    assert r.status_code == 200
    s = r.json()["structure"]
    assert s["symbols"] == ["Si"] * 8 and s["cell"][0][0] == 5.431 and r.json()["format"] == "poscar"
    # filename-based detection via multipart upload
    r = local_client.post("/api/v1/io/parse", files={"file": ("POSCAR", POSCAR_TEXT.encode())})
    assert r.status_code == 200 and r.json()["format"] == "poscar" and r.json()["filename"] == "POSCAR"
    # content sniffing without a name
    r = local_client.post("/api/v1/io/parse", json={"text": "1\nH atom\nH 0 0 0\n"})
    assert r.json()["structure"]["symbols"] == ["H"]
    assert local_client.post("/api/v1/io/parse", json={"text": "junk", "format": "cif"}).status_code == 422
    assert local_client.post("/api/v1/io/parse", json={"text": "junk", "format": "doc"}).status_code == 400
    assert local_client.post("/api/v1/io/parse", content=b"{", headers={"content-type": "application/json"}).status_code == 400


def test_io_export_and_convert(local_client, data_dir):
    sto = build.crystal("perovskite", "SrTiO3").to_dict()
    r = local_client.post("/api/v1/io/export", json={"structure": sto, "format": "cif"})
    assert r.status_code == 200
    body = r.json()
    assert body["filename"].endswith(".cif") and body["mimetype"] == "chemical/x-cif" and "data_" in body["text"]
    assert local_client.post("/api/v1/io/export", json={"structure": sto, "format": "nope"}).status_code == 400
    with open(data_dir / "NaCl.cif", "rb") as fh:
        r = local_client.post("/api/v1/io/convert", files={"file": ("NaCl.cif", fh)}, data={"to": "extxyz"})
    assert r.status_code == 200 and r.text.startswith("8\nLattice=")
    assert "attachment" in r.headers["content-disposition"]


def test_build_endpoints(local_client):
    c = local_client
    r = c.post("/api/v1/build/crystal", json={"prototype": "fcc", "elements": ["Cu"], "a": 3.61, "supercell": [3, 3, 3]})
    assert r.status_code == 200
    s = r.json()["structure"]
    assert len(s["symbols"]) == 108 and abs(s["cell"][0][0] - 10.83) < 1e-9
    assert s["info"]["prototype"] == "fcc"
    r = c.post("/api/v1/build/crystal", json={"prototype": "wurtzite", "elements": ["Ga", "N"], "params": {"u": 0.377}})
    assert r.status_code == 200 and r.json()["structure"]["info"]["u"] == 0.377
    assert c.post("/api/v1/build/crystal", json={"prototype": "nope"}).status_code == 400
    assert c.post("/api/v1/build/crystal", json={"prototype": "fcc", "a": -1}).status_code == 422
    assert c.post("/api/v1/build/crystal", json={"prototype": "fcc", "supercell": [200, 200, 200]}).status_code == 400

    r = c.post("/api/v1/build/cluster", json={"kind": "icosahedron", "element": "Au", "size": 3})
    assert len(r.json()["structure"]["symbols"]) == 55 and r.json()["structure"]["cell"] is None
    r = c.post("/api/v1/build/supercell", json={"structure": build.crystal("diamond", "Si").to_dict(), "repeat": [2, 1, 1]})
    assert len(r.json()["structure"]["symbols"]) == 16
    mol = c.post("/api/v1/build/supercell", json={"structure": build.molecule("water").to_dict(), "repeat": [2, 2, 2]})
    assert mol.status_code == 400

    protos = c.get("/api/v1/build/prototypes").json()
    assert "rutile" in protos["prototypes"] and "decahedron" in protos["clusters"]
    mols = c.get("/api/v1/build/molecules").json()["molecules"]
    assert any(m["name"] == "caffeine" and m["natoms"] == 24 for m in mols)
    assert len(c.get("/api/v1/build/molecule/C60").json()["structure"]["symbols"]) == 60
    assert c.get("/api/v1/build/molecule/unknown").status_code == 404


def test_analysis_endpoints(local_client):
    si = build.crystal("diamond", "Si").to_dict()
    r = local_client.post("/api/v1/analysis/bonds", json={"structure": si})
    assert r.status_code == 200
    bonds = r.json()["bonds"]
    assert r.json()["count"] == 16 == len(bonds)
    i, j, d, off = bonds[0]
    assert isinstance(i, int) and isinstance(j, int) and abs(d - 2.3517) < 1e-3 and len(off) == 3
    r = local_client.post("/api/v1/analysis/bonds", json={"structure": si, "cutoff": 4.0})
    assert r.json()["count"] > 16
    cn = local_client.post("/api/v1/analysis/coordination", json={"structure": si}).json()
    assert cn["coordination"] == [4] * 8 and cn["average"] == 4.0 and cn["byElement"] == {"Si": 4.0}
    summ = local_client.post("/api/v1/analysis/summary", json={"structure": si}).json()["summary"]
    assert summ["formula"] == "Si8" and summ["natoms"] == 8
    rdf = local_client.post("/api/v1/analysis/rdf", json={"structure": si, "rmax": 5, "nbins": 50}).json()
    assert len(rdf["r"]) == 50 == len(rdf["g"])
    bad = local_client.post("/api/v1/analysis/bonds", json={"structure": {"symbols": ["H", "H"], "positions": [[0, 0, 0]]}})
    assert bad.status_code == 400
    missing = local_client.post("/api/v1/analysis/bonds", json={})
    assert missing.status_code == 422 and "structure" in missing.json()["detail"]


def test_frontend_served_with_spa_fallback(tmp_path):
    from fastapi.testclient import TestClient

    from atomscope.config import Settings
    from atomscope.server import create_app

    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>AtomScope UI</title>")
    (web / "assets" / "app.js").write_text("console.log('hi')")
    s = Settings(data_dir=tmp_path / "d", web_dir=web, entry_point_plugins=False)
    with TestClient(create_app(s)) as c:
        assert "AtomScope UI" in c.get("/").text
        assert c.get("/assets/app.js").text == "console.log('hi')"
        assert "AtomScope UI" in c.get("/projects/some-route").text  # SPA fallback
        assert c.get("/assets/missing.js").status_code == 404
        assert c.get("/api/v1/health").json()["status"] == "ok"


def test_cors(tmp_path):
    from fastapi.testclient import TestClient

    from atomscope.config import Settings
    from atomscope.server import create_app

    s = Settings(data_dir=tmp_path, cors_origins=["http://localhost:5173"], entry_point_plugins=False)
    with TestClient(create_app(s)) as c:
        r = c.options("/api/v1/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_large_project_payload_gzip(local_client):
    big = build.crystal("fcc", "Cu").repeat(10, 10, 10).to_dict()
    r = local_client.post("/api/v1/projects", json={"name": "big", "structures": [big]})
    assert r.status_code == 201
    got = local_client.get(f"/api/v1/projects/{r.json()['id']}", headers={"Accept-Encoding": "gzip"})
    assert got.headers.get("content-encoding") == "gzip"
    assert len(got.json()["structures"][0]["structure"]["symbols"]) == 4000
    json.dumps(got.json())


def test_project_etag_if_match_and_conflict(local_client):
    c = local_client
    created = c.post("/api/v1/projects", json={"name": "Lock", "structures": [build.crystal("perovskite", "SrTiO3").to_dict()]})
    pid, v1 = created.json()["id"], created.json()["updated"]
    assert created.headers["etag"] == f'"{v1}"'
    got = c.get(f"/api/v1/projects/{pid}")
    assert got.headers["etag"] == f'"{v1}"' and got.headers["cache-control"] == "no-store"
    summary = c.get("/api/v1/projects").json()[0]
    assert summary["formula"] == "SrTiO3" and summary["nAtoms"] == 5

    body = got.json()
    r1 = c.put(f"/api/v1/projects/{pid}", json={**body, "name": "Tab A"}, headers={"If-Match": f'"{v1}"'})
    assert r1.status_code == 200 and r1.headers["etag"] == f'"{r1.json()["updated"]}"'
    r2 = c.put(f"/api/v1/projects/{pid}", json={**body, "name": "Tab B"}, headers={"If-Match": f'"{v1}"'})
    assert r2.status_code == 409 and r2.json()["detail"] == "project was changed elsewhere"
    assert r2.json()["updated"] == r1.json()["updated"]
    # the same check through a body field (clients that cannot set headers)
    r3 = c.put(f"/api/v1/projects/{pid}", json={**body, "name": "Tab C", "baseUpdated": v1})
    assert r3.status_code == 409
    assert c.get(f"/api/v1/projects/{pid}").json()["name"] == "Tab A"
    # rename with the current version, then a plain PUT without If-Match (old clients) still wins
    v2 = r1.json()["updated"]
    ren = c.patch(f"/api/v1/projects/{pid}", json={"name": "Renamed"}, headers={"If-Match": f'W/"{v2}"'})
    assert ren.status_code == 200 and ren.json()["name"] == "Renamed" and "baseUpdated" not in ren.json()
    plain = c.put(f"/api/v1/projects/{pid}", json={**body, "name": "Plain"})
    assert plain.status_code == 200 and plain.json()["name"] == "Plain"
    assert c.put(f"/api/v1/projects/{pid}", json=body, headers={"If-Match": "*"}).status_code == 200
