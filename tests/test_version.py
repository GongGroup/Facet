"""The web app's VERSION and the compose image tag match ``facet.__version__``."""

from __future__ import annotations

import re

from facet import __version__

from .conftest import ROOT


def test_web_app_version_matches():
    # the frontend also runs as a static site with no server to ask, so it keeps its own constant
    app = (ROOT / "facet" / "web" / "js" / "app.js").read_text(encoding="utf-8")
    assert re.findall(r"^export const VERSION = '([^']*)'", app, re.M) == [__version__]


def test_compose_image_tag_matches():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert re.findall(r"^\s*image: ghcr\.io/mastreina/facet:(\S+)", compose, re.M) == [__version__]
