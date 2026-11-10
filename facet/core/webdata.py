"""Data files shared by the Python package and the web app: ``facet/web/data/*.json``.

Each table has one copy, in ``facet/web/data``, which the web app fetches and Python reads through
:mod:`importlib.resources` (the package data includes ``web/**/*``, so this works from an installed package, a
wheel or a zip as well as from a checkout).  The modules that own a table wrap :func:`load_web_data` with their own
loader and checks: the formal oxidation states of the cleave tool (``oxidation_states.json``,
:func:`facet.build.surface.load_oxidation_states`), the adsorbate library (``adsorbates.json``).

The JavaScript twin is ``facet/web/js/core/webdata.js`` (``loadWebData``, ``webData``, ``setWebData``): the
browser fetches ``new URL('../../data/<name>', import.meta.url)``, Node tests read the same file with ``fs``.

Example::

    from facet.core.webdata import load_web_data
    table = load_web_data("oxidation_states.json")      # a fresh deep copy on every call
"""

from __future__ import annotations

import copy
import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any

__all__ = ["load_web_data"]

#: A data file name: lower-case letters, digits and underscores, then ``.json`` (no directories).
_NAME = re.compile(r"[a-z0-9_]+\.json")


@lru_cache(maxsize=None)
def _load(name: str) -> Any:
    text = resources.files("facet").joinpath("web", "data", name).read_text(encoding="utf-8")
    return json.loads(text)


def load_web_data(name: str) -> Any:
    """Parsed ``facet/web/data/<name>`` (cached); returns a deep copy so callers cannot change the cache.

    *name* is a file name such as ``"oxidation_states.json"``: lower-case letters, digits and underscores ending in
    ``.json``, without directories (``ValueError: invalid data file name '../x.json'``, the same text as the web
    app's).  A valid name of a file that does not exist raises ``FileNotFoundError``.
    """
    if not isinstance(name, str):
        raise ValueError(f"invalid data file name {name!r}")
    if not _NAME.fullmatch(name):
        raise ValueError(f"invalid data file name '{name}'")
    return copy.deepcopy(_load(name))
