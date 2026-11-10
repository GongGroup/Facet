"""Former name of :mod:`facet`, kept so code written for Crystallume keeps working.

``import crystallume`` gives the :mod:`facet` package itself, and ``crystallume.<sub>`` (``crystallume.io``,
``crystallume.plugins``, ``crystallume.core.structure`` ...) the matching ``facet.<sub>`` module, so old plugins
(``from crystallume import PluginContext, Structure``) and scripts (``import crystallume as ats``) run unchanged.
New code should import ``facet``.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys
import warnings

import facet

_OLD, _NEW = "crystallume", "facet"


class _AliasFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Import ``crystallume.<x>`` as the same module object as ``facet.<x>`` (no second copy)."""

    @staticmethod
    def _target(fullname):
        return importlib.util.find_spec(_NEW + fullname[len(_OLD):])

    def find_spec(self, fullname, path=None, target=None):  # noqa: D401 - importlib protocol
        if not fullname.startswith(_OLD + "."):
            return None
        real = self._target(fullname)
        if real is None:
            return None
        return importlib.util.spec_from_loader(fullname, self, origin=real.origin,
                                               is_package=real.submodule_search_locations is not None)

    # runpy (``python -m crystallume``, ``python -m crystallume.cli``) and other tools read the code via the loader
    def get_code(self, fullname):
        real = self._target(fullname)
        return real.loader.get_code(real.name)

    def get_source(self, fullname):
        real = self._target(fullname)
        return real.loader.get_source(real.name)

    def is_package(self, fullname):
        return self._target(fullname).submodule_search_locations is not None

    def create_module(self, spec):
        module = importlib.import_module(_NEW + spec.name[len(_OLD):])
        spec.loader_state = module.__spec__
        return module

    def exec_module(self, module):
        # importlib set __spec__ to the alias spec; give the facet module its own back
        alias = module.__spec__
        if alias is not None and alias.loader is self:
            module.__spec__ = alias.loader_state


if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())

warnings.warn("the 'crystallume' package is now called 'facet'; import facet instead",
              DeprecationWarning, stacklevel=2)

sys.modules[__name__] = facet
