"""Network-deployment hardening: build caps, body limits, auth limits, tokens,
security headers, sub-path serving and degenerate cells."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from facet import build
from facet.build.cluster import CLUSTERS, cluster, estimate_cluster_atoms
from facet.config import Settings
from facet.core.structure import Structure
from facet.project import display_formula
from facet.server import create_app, print_banner, security_warnings
from facet.server.deps import read_json_body


def _client(tmp_path, **kw):
    kw.setdefault("data_dir", tmp_path / "data")
    kw.setdefault("entry_point_plugins", False)
    kw.setdefault("web_dir", tmp_path / "no-web")
    return TestClient(create_app(Settings(**kw)))


# ------------------------------------------------------------------ build caps
def test_cluster_estimate_matches_builder():
    for kind in ("icosahedron", "cuboctahedron", "octahedron", "tetrahedron", "decahedron"):
        for n in (1, 2, 4):
            assert estimate_cluster_atoms(kind, n, "Au") == len(cluster(kind, "Au", n))
    sph = len(cluster("sphere", "Au", 10.0))
    assert abs(estimate_cluster_atoms("sphere", 10.0, "Au") - sph) < 0.1 * sph
    assert estimate_cluster_atoms("fullerene") == 60


def test_build_requests_are_capped(tmp_path):
    with _client(tmp_path) as c:
        r = c.post("/api/v1/build/cluster", json={"kind": "sphere", "size": 10, "a": 0.5})
        assert r.status_code == 422  # a >= 1 Å
        r = c.post("/api/v1/build/cluster", json={"kind": "sphere", "size": 40, "a": 1.0})
        assert r.status_code == 400 and "atoms (limit 200,000)" in r.json()["detail"]
        hi = CLUSTERS["icosahedron"]["sizeMax"]
        r = c.post("/api/v1/build/cluster", json={"kind": "ico", "size": hi + 1})
        assert r.status_code == 400 and f"between 1 and {hi}" in r.json()["detail"]
        assert c.post("/api/v1/build/cluster", json={"kind": "icosahedron", "size": hi}).status_code == 200
        assert c.post("/api/v1/build/crystal", json={"prototype": "fcc", "a": 0.2}).status_code == 422
    with _client(tmp_path, max_atoms=100) as c:
        r = c.post("/api/v1/build/crystal", json={"prototype": "fcc", "elements": ["Cu"], "supercell": [3, 3, 3]})
        assert r.status_code == 400 and "about 108 atoms (limit 100)" in r.json()["detail"]
        si = build.crystal("diamond", "Si").to_dict()
        assert c.post("/api/v1/build/supercell", json={"structure": si, "repeat": [3, 3, 2]}).status_code == 400
        assert c.post("/api/v1/build/supercell", json={"structure": si, "repeat": [2, 2, 1]}).status_code == 200
        assert c.post("/api/v1/build/cluster", json={"kind": "icosahedron", "size": 4}).status_code == 400


# ------------------------------------------------------------------ body limits
class _FakeRequest:
    """Just enough of a Starlette Request for read_json_body."""

    def __init__(self, chunks, content_length=None):
        self.headers = {"content-type": "application/json"}
        if content_length is not None:
            self.headers["content-length"] = str(content_length)
        self._chunks = chunks
        self.consumed = 0

    async def stream(self):
        for ch in self._chunks:
            self.consumed += 1
            yield ch


def test_read_json_body_rejects_before_buffering():
    settings = Settings(max_project_mb=1, max_upload_mb=1, entry_point_plugins=False)
    limit = settings.body_limit_bytes

    def boom():
        raise AssertionError("body must not be read")
        yield b""  # pragma: no cover

    req = _FakeRequest(boom(), content_length=limit + 1)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_json_body(req, settings))
    assert exc.value.status_code == 413 and req.consumed == 0

    # no Content-Length (chunked): stop as soon as the running total passes the limit
    piece = b" " * (256 * 1024)
    req = _FakeRequest([piece] * 40)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_json_body(req, settings))
    assert exc.value.status_code == 413 and req.consumed <= limit // len(piece) + 1 < 40

    ok = _FakeRequest([b'{"a":', b" 1}"], content_length=8)
    assert asyncio.run(read_json_body(ok, settings)) == {"a": 1}


def test_oversized_request_gets_413(tmp_path):
    with _client(tmp_path, max_project_mb=1, max_upload_mb=1) as c:
        big = b"{" + b" " * (2 * 1024 * 1024) + b"}"
        r = c.post("/api/v1/projects", content=big, headers={"Content-Type": "application/json"})
        assert r.status_code == 413 and "limit" in r.json()["detail"]
        r = c.post("/api/v1/projects/import", content=big, headers={"Content-Type": "application/json"})
        assert r.status_code == 413


# ------------------------------------------------------------------ accounts
def test_register_rate_limit(tmp_path):
    with _client(tmp_path, mode="cloud") as c:
        codes = [c.post("/api/v1/auth/register", json={"username": f"user{i}", "password": "secret12"}).status_code
                 for i in range(6)]
        assert codes == [201] * 5 + [429]
    with _client(tmp_path / "other", mode="cloud") as c:  # limits are per app
        assert c.post("/api/v1/auth/register", json={"username": "fresh", "password": "secret12"}).status_code == 201


def test_registration_defaults_follow_host(monkeypatch):
    assert Settings(mode="cloud").allow_registration is True
    assert Settings(mode="cloud", host="0.0.0.0").allow_registration is False
    assert Settings(mode="cloud", host="0.0.0.0", allow_registration=True).allow_registration is True
    assert Settings(mode="cloud").with_(host="0.0.0.0").allow_registration is False
    env = {"FACET_HOST": "0.0.0.0", "FACET_ALLOW_REGISTRATION": "true"}
    assert Settings.from_env(env).allow_registration is True
    assert Settings.from_env({"FACET_HOST": "0.0.0.0"}).allow_registration is False


def test_expired_token_is_rejected(tmp_path):
    with _client(tmp_path, mode="cloud", token_ttl_days=30) as c:
        tok = c.post("/api/v1/auth/register", json={"username": "alice", "password": "secret12"}).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        assert c.get("/api/v1/projects", headers=h).status_code == 200
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        c.app.state.users._x("UPDATE tokens SET last_used=?, created=?", (old, old))
        r = c.get("/api/v1/projects", headers=h)
        assert r.status_code == 401
        assert c.app.state.users._q("SELECT COUNT(*) AS n FROM tokens")[0]["n"] == 0  # expired token removed


def test_local_mode_token(tmp_path):
    with _client(tmp_path, token="sekrit-token") as c:
        assert c.get("/api/v1/info").status_code == 200  # capabilities stay public
        assert c.get("/api/v1/projects").status_code == 401
        assert c.get("/api/v1/projects", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert c.get("/api/v1/auth/me").status_code == 401
        assert c.post("/api/v1/auth/login", json={"username": "local", "password": "nope"}).status_code == 401
        r = c.post("/api/v1/auth/login", json={"username": "local", "password": "sekrit-token"})
        assert r.status_code == 200 and r.json()["user"]["username"] == "local"
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        assert c.get("/api/v1/projects", headers=h).status_code == 200
        assert c.get("/api/v1/auth/me", headers=h).json()["user"]["id"] == "local"
    with _client(tmp_path) as c:  # no token configured: unchanged behaviour
        assert c.get("/api/v1/projects").status_code == 200
        assert c.post("/api/v1/build/cluster", json={"kind": "icosahedron", "size": 2}).status_code == 200
        assert c.get("/api/v1/auth/me").json()["authRequired"] is False


def test_local_token_guards_every_api_route(tmp_path):
    """With FACET_TOKEN, compute and plugin routes need the token too; only info/health/login stay open."""
    from pathlib import Path

    plugins = Path(__file__).resolve().parents[1] / "examples" / "plugins"
    xyz = "1\nH\nH 0 0 0\n"
    with _client(tmp_path, token="tok123", plugin_dirs=[plugins]) as c:
        calls = [
            ("post", "/api/v1/build/cluster", {"json": {"kind": "icosahedron", "size": 2}}),
            ("post", "/api/v1/build/crystal", {"json": {"prototype": "fcc", "elements": ["Cu"]}}),
            ("post", "/api/v1/io/parse", {"json": {"text": xyz, "format": "xyz"}}),
            ("post", "/api/v1/analysis/summary", {"json": {"structure": build.crystal("fcc", "Cu").to_dict()}}),
            ("get", "/api/v1/elements", {}),
            ("get", "/api/v1/plugins", {}),
            ("get", "/api/v1/ext/hello", {}),  # a plugin's own router
        ]
        for method, path, kw in calls:
            r = getattr(c, method)(path, **kw)
            assert r.status_code == 401, (path, r.status_code)
            assert r.headers["www-authenticate"] == "Bearer"
            assert getattr(c, method)(path, headers={"Authorization": "Bearer nope"}, **kw).status_code == 401
            assert getattr(c, method)(path, headers={"Authorization": "Bearer tok123"}, **kw).status_code == 200, path
        assert c.get("/api/v1/elements", params={"access_token": "tok123"}).status_code == 200
        for path in ("/api/v1/info", "/api/v1/health"):  # the UI probes these before signing in
            assert c.get(path).status_code == 200
        assert c.post("/api/v1/auth/logout").status_code == 200
        assert c.get("/plugins/hello/hello.js").status_code == 200  # static plugin scripts stay loadable
        me = c.get("/api/v1/auth/me", headers={"Authorization": "Bearer tok123"}).json()
        assert me["authRequired"] is True and me["mode"] == "local"
        info = c.get("/api/v1/info").json()  # /info agrees with /auth/me for API clients
        assert info["authRequired"] is True and info["limits"]["maxAtoms"] > 0
        # the public routes keep a schema without a security requirement
        assert "security" not in c.get("/openapi.json").json()["paths"]["/api/v1/info"]["get"]
    with _client(tmp_path, token="tok123", root_path="/facet") as c:  # behind a reverse proxy sub-path
        assert c.get("/facet/api/v1/info").status_code == 200
        assert c.get("/api/v1/health").status_code == 200  # prefix stripped by the proxy
        assert c.get("/facet/api/v1/elements").status_code == 401
        assert c.get("/facet/api/v1/elements", headers={"Authorization": "Bearer tok123"}).status_code == 200


def test_network_warnings(capsys):
    assert security_warnings(Settings(mode="local")) == []
    warn = security_warnings(Settings(mode="local", host="0.0.0.0"))
    assert len(warn) == 1 and "local mode has no login" in warn[0] and "FACET_TOKEN" in warn[0]
    assert security_warnings(Settings(mode="local", host="0.0.0.0", token="x7Gq2-long-random-token-value")) == []
    weak = security_warnings(Settings(mode="local", host="0.0.0.0", token="change-me"))
    assert len(weak) == 1 and "easy to guess" in weak[0]
    assert security_warnings(Settings(mode="cloud", host="0.0.0.0")) == []
    assert security_warnings(Settings(mode="cloud", host="0.0.0.0", allow_registration=True))
    print_banner(Settings(mode="cloud", host="0.0.0.0"))
    out = capsys.readouterr().out
    assert "registration disabled" in out and "facet user create" in out


# ------------------------------------------------------------------ headers & sub-path
def test_security_headers_and_cache_policy(tmp_path):
    web = tmp_path / "web"
    (web / "vendor" / "three").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>Facet</title>")
    (web / "vendor" / "three" / "three.module.js").write_text("export {}")
    with _client(tmp_path, web_dir=web) as c:
        r = c.get("/")
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "SAMEORIGIN"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert r.headers["cache-control"] == "no-cache"
        assert "max-age=" in c.get("/vendor/three/three.module.js").headers["cache-control"]
        api = c.get("/api/v1/info")
        assert api.headers["cache-control"] == "no-store" and api.headers["x-content-type-options"] == "nosniff"
        assert "max-age=86400" in c.get("/api/v1/elements").headers["cache-control"]  # endpoint's own policy kept
    with _client(tmp_path, web_dir=web, frame_ancestors="'self' https://lab.example.org") as c:
        r = c.get("/")
        assert "x-frame-options" not in r.headers
        assert r.headers["content-security-policy"] == "frame-ancestors 'self' https://lab.example.org"


def test_root_path(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Facet UI</title>")
    with _client(tmp_path, web_dir=web, root_path="/facet/") as c:
        assert c.app.state.settings.root_path == "/facet"
        assert c.get("/facet/api/v1/info").json()["name"] == "Facet"  # prefix passed through
        assert c.get("/api/v1/info").json()["name"] == "Facet"  # prefix stripped by a proxy
        assert "Facet UI" in c.get("/facet/").text
        r = c.get("/facet", follow_redirects=False)
        assert r.status_code == 307 and r.headers["location"] == "/facet/"
        assert c.get("/facet/api/v1/nope").status_code == 404


# ------------------------------------------------------------------ singular cells
def test_degenerate_cells_are_repaired():
    s = Structure(["Mo", "S", "S"], [[0, 0, 0], [1.6, 0.9, 1.5], [1.6, 0.9, -1.5]],
                  cell=[[3.2, 0, 0], [-1.6, 2.77, 0], [0, 0, 0]], pbc=[True, True, False])
    assert s.pbc == [True, True, False] and s.volume > 0
    assert np.allclose(s.cell[2], [0, 0, 13.0]) and "vacuum" in s.info["warnings"][0]
    flat = Structure(["Si"], [[0, 0, 0]], cell=[[4, 0, 0], [0, 4, 0], [0, 0, 0]], pbc=True)
    assert flat.cell is None and flat.pbc == [False, False, False] and flat.info["warnings"]
    none = Structure(["Si"], [[0, 0, 0]], cell=np.zeros((3, 3)), pbc=False)
    assert none.cell is None and "warnings" not in none.info
    ok = build.crystal("fcc", "Cu")
    assert "warnings" not in ok.info and ok.volume > 0


def test_singular_cell_never_500(tmp_path):
    from fastapi.routing import APIRoute

    st = {"symbols": ["Si", "Si"], "positions": [[0, 0, 0], [1.2, 1.2, 1.2]],
          "cell": [[3.8, 0, 0], [0, 3.8, 0], [0, 0, 0]], "pbc": [True, True, False]}
    with _client(tmp_path) as c:
        for path in ("coordination", "bonds", "summary", "rdf"):
            r = c.post(f"/api/v1/analysis/{path}", json={"structure": st})
            assert r.status_code in (200, 400), (path, r.status_code)
        st["pbc"] = [True, True, True]
        assert c.post("/api/v1/analysis/coordination", json={"structure": st}).status_code in (200, 400)

        def boom():
            raise np.linalg.LinAlgError("Singular matrix")

        c.app.router.routes.insert(0, APIRoute("/boom", boom))
        r = c.get("/boom")
        assert r.status_code == 400 and r.json()["detail"] == "cell is singular (zero volume)"


def test_display_formula_matches_web_info_card():
    assert display_formula(["Sr", "Ti", "O", "O", "O"]) == "SrTiO3"
    assert display_formula(["C", "Si"]) == "SiC"  # Hill order only with C and H
    assert display_formula(["Ca", "C", "O", "O", "O"]) == "CaCO3"
    assert display_formula(["H", "C", "H", "H", "H"]) == "CH4"
    assert display_formula([]) == ""


# ------------------------------------------------------------------ token guessing, methods, other sites
def test_wrong_local_token_counts_as_failed_login(tmp_path):
    token = "s3cret-token-1234567890"
    with _client(tmp_path, token=token) as c:
        bad = {"Authorization": "Bearer wrong"}
        codes = [c.get("/api/v1/projects", headers=bad).status_code for _ in range(12)]
        assert codes[:10] == [401] * 10 and codes[10:] == [429, 429]
        # locked out everywhere, the right token included (else guessing would just move to other routes)
        assert c.get("/api/v1/projects", headers={"Authorization": f"Bearer {token}"}).status_code == 429
        assert c.post("/api/v1/auth/login", json={"username": "local", "password": token}).status_code == 429
        assert c.get("/api/v1/health").status_code == 200
    with _client(tmp_path, token=token) as c:
        # a request without any token is not a guess
        assert [c.get("/api/v1/projects").status_code for _ in range(12)] == [401] * 12
        assert c.get("/api/v1/projects", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_known_api_path_with_other_method(tmp_path):
    with _client(tmp_path) as c:
        r = c.delete("/api/v1/projects")
        assert r.status_code == 405 and r.headers["allow"] == "GET, HEAD, POST"
        assert c.post("/api/v1/health").status_code == 405
        h = c.head("/api/v1/health")
        assert h.status_code == 200 and h.content == b""
        assert c.get("/api/v1/nope").status_code == 404


def test_other_sites_cannot_write(tmp_path):
    doc = '{"name": "planted", "structures": []}'
    with _client(tmp_path) as c:
        # a "simple" cross-site request (text/plain body, no preflight) is refused twice over
        r = c.post("/api/v1/projects/import", content=doc, headers={"Content-Type": "text/plain", "Origin": "https://evil.example",
                                                                    "Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 403
        assert c.post("/api/v1/projects/import", content=doc, headers={"Content-Type": "text/plain"}).status_code == 415
        r = c.post("/api/v1/projects/import", files={"file": ("x.json", doc.encode())}, headers={"Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 403
        r = c.post("/api/v1/projects/import", files={"file": ("x.json", doc.encode())}, headers={"Origin": "http://localhost:9830"})
        assert r.status_code == 403
        assert c.get("/api/v1/projects").json() == []
        # the app itself (same origin; Origin may be "null" under Referrer-Policy: no-referrer)
        for extra in ({"Sec-Fetch-Site": "same-origin", "Origin": "null"}, {"Origin": "null"}, {"Origin": "http://testserver"}, {}):
            assert c.post("/api/v1/projects/import", content=doc, headers={"Content-Type": "application/json", **extra}).status_code == 201
        # DNS rebinding: a token-less local server on 127.0.0.1 only answers to localhost names
        assert c.get("/api/v1/projects", headers={"Host": "attacker.example:8765"}).status_code == 400
        assert c.get("/api/v1/projects", headers={"Host": "localhost:8765"}).status_code == 200
    with _client(tmp_path, cors_origins=["https://lab.example"], allowed_hosts=["facet.lan"]) as c:
        r = c.post("/api/v1/projects", json={"name": "ok"}, headers={"Origin": "https://lab.example", "Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 201
        assert c.get("/api/v1/health", headers={"Host": "facet.lan:8765"}).status_code == 200
    with _client(tmp_path, token="s3cret-token-1234567890") as c:   # a token protects it: any host name
        assert c.get("/api/v1/health", headers={"Host": "lab.example.org"}).status_code == 200


def test_forwarded_allow_ips_setting():
    assert Settings.from_env({"FACET_FORWARDED_ALLOW_IPS": " 10.0.0.2, ::1 "}).forwarded_allow_ips == "10.0.0.2,::1"
    assert Settings().forwarded_allow_ips is None


def test_forwarded_wildcard_cannot_dodge_rate_limits(tmp_path, monkeypatch):
    """With '*' the client writes the leftmost X-Forwarded-For entry (nginx appends the real address): the
    limits count the entry the nearest proxy added, so a new forged entry per request does not reset them."""
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    with _client(tmp_path, mode="cloud", allow_registration=True, forwarded_allow_ips="*") as c:
        codes = [c.post("/api/v1/auth/login", json={"username": "x", "password": "bad-password"},
                        headers={"X-Forwarded-For": f"10.9.9.{i}, 203.0.113.1"}).status_code for i in range(12)]
        assert codes == [401] * 10 + [429, 429]
        # another real client (another rightmost entry) is not locked out
        assert c.post("/api/v1/auth/login", json={"username": "x", "password": "bad-password"},
                      headers={"X-Forwarded-For": "10.9.9.1, 203.0.113.2"}).status_code == 401
        codes = [c.post("/api/v1/auth/register", json={"username": f"user{i}", "password": "secret12"},
                        headers={"X-Forwarded-For": f"10.7.7.{i}, 203.0.113.5"}).status_code for i in range(6)]
        assert codes == [201] * 5 + [429]
    warn = security_warnings(Settings(mode="cloud", forwarded_allow_ips="*"))
    assert len(warn) == 1 and "FORWARDED_ALLOW_IPS" in warn[0]
    assert security_warnings(Settings(mode="cloud", forwarded_allow_ips="172.28.0.0/16")) == []

