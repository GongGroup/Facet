"""Request-size and compute limits of the server."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from atomscope.config import Settings
from atomscope.server import create_app

NACL = {"symbols": ["Na", "Cl"], "positions": [[0, 0, 0], [2.82, 0, 0]], "cell": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]], "pbc": [True, True, True]}


def _small_limits(tmp_path: Path, mode: str = "local") -> Settings:
    return Settings(mode=mode, data_dir=tmp_path / mode, entry_point_plugins=False, web_dir=tmp_path / "no-web",
                    max_upload_mb=0.05, max_project_mb=0.05)


def test_chunked_body_over_limit_is_refused(tmp_path):
    with TestClient(create_app(_small_limits(tmp_path))) as c:
        def chunks():
            for _ in range(200):
                yield b"x" * 4096  # ~800 KB, no Content-Length header
        r = c.post("/api/v1/projects/import", content=chunks(), headers={"Content-Type": "application/json"})
        assert r.status_code == 413


def test_small_chunked_body_still_works(tmp_path):
    with TestClient(create_app(_small_limits(tmp_path))) as c:
        def chunks():
            yield b'{"structure": '
            yield str(NACL).replace("'", '"').replace("True", "true").encode()
            yield b"}"
        r = c.post("/api/v1/analysis/summary", content=chunks(), headers={"Content-Type": "application/json"})
        assert r.status_code == 200, r.text


def test_analysis_refuses_degenerate_cells(local_client):
    tiny = {**NACL, "symbols": ["Na"], "positions": [[0, 0, 0]], "cell": [[0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3]]}
    r = local_client.post("/api/v1/analysis/rdf", json={"structure": tiny, "rmax": 20})
    assert r.status_code == 400 and "too small" in r.json()["detail"]
    many = {"symbols": ["C"] * 3000, "positions": [[i * 1.5, 0, 0] for i in range(3000)], "cell": None, "pbc": [False] * 3}
    r = local_client.post("/api/v1/analysis/rdf", json={"structure": many, "rmax": 8})
    assert r.status_code == 200  # 4.5 M pairs is within the limit
    ok = local_client.post("/api/v1/analysis/rdf", json={"structure": NACL, "rmax": 6})
    assert ok.status_code == 200


def test_cloud_analysis_needs_sign_in(cloud_client):
    r = cloud_client.post("/api/v1/analysis/summary", json={"structure": NACL})
    assert r.status_code == 401
    tok = cloud_client.post("/api/v1/auth/register", json={"username": "ana", "password": "long-enough-pw-1"}).json()["token"]
    r = cloud_client.post("/api/v1/analysis/summary", json={"structure": NACL}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
