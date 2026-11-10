"""Python ops and recipes of the shared cases, one module per design module (``f0d.py``, ``m1.py``, ...).

Importing this package imports every ``tests/ops/*.py`` in file-name order; each module registers its ops with
``@op("name")`` and its recipes with ``@recipe("name")`` from :mod:`tests.cases`.  The JS halves live in
``tests/js/ops/<module>.mjs``.  See ``tests/data/surface/README.md``.
"""

from __future__ import annotations

import importlib
from pathlib import Path

#: The op modules, in import order.
MODULES: list[str] = [p.stem for p in sorted(Path(__file__).resolve().parent.glob("*.py"), key=lambda p: p.name)
                      if p.stem != "__init__"]

for _name in MODULES:
    importlib.import_module(f"{__name__}.{_name}")
