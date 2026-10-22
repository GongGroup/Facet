"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from crystallume.config import Settings
from crystallume.server import create_app

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"
EXAMPLE_PLUGINS = ROOT / "examples" / "plugins"


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
