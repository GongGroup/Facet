"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from facet.config import Settings
from facet.server import create_app

from .js_bridge import require_node, run_js

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"
EXAMPLE_PLUGINS = ROOT / "examples" / "plugins"


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Tests that use the ``js`` fixture get the ``js`` marker (``pytest -m "not js"`` leaves them out)."""
    for item in items:
        if "js" in getattr(item, "fixturenames", ()):
            item.add_marker(pytest.mark.js)


@pytest.fixture(scope="session")
def js():
    """``js(source, payload=None, timeout=30.0)`` runs web-module code under Node.js (``tests/js_bridge.run_js``).

    Skips the test when Node.js >= 22 is missing; ``FACET_REQUIRE_NODE=1`` makes that a failure.
    """
    require_node()
    return run_js


@pytest.fixture
def data_dir() -> Path:
    return DATA


@pytest.fixture
def local_settings(tmp_path: Path) -> Settings:
    return Settings(mode="local", data_dir=tmp_path / "data", entry_point_plugins=False,
                    web_dir=tmp_path / "no-web")


@pytest.fixture
def local_client(local_settings: Settings):
    with TestClient(create_app(local_settings)) as client:
        yield client


@pytest.fixture
def cloud_client(tmp_path: Path):
    settings = Settings(mode="cloud", data_dir=tmp_path / "cloud", entry_point_plugins=False,
                        web_dir=tmp_path / "no-web")
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def plugin_client(tmp_path: Path):
    settings = Settings(mode="local", data_dir=tmp_path / "data", plugin_dirs=[EXAMPLE_PLUGINS],
                        entry_point_plugins=False, web_dir=tmp_path / "no-web")
    with TestClient(create_app(settings)) as client:
        yield client
