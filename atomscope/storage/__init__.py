"""Project storage back-ends.

* :class:`LocalFileStore` — one folder per project on disk (local mode).
* :class:`SQLiteStore` — multi-user database with accounts and tokens (cloud mode).

Both implement :class:`ProjectStore`::

    store.list(owner, q=None)            -> [summary, ...]   (newest first)
    store.get(owner, pid)                -> project
    store.create(owner, project)         -> project
    store.update(owner, pid, project)    -> project          (full replace)
    store.patch(owner, pid, partial)     -> project          (merge top-level keys)
    store.delete(owner, pid)
    store.duplicate(owner, pid)          -> project
"""

from __future__ import annotations

from .base import (
    DEFAULT_MAX_PROJECT_BYTES,
    ProjectNotFound,
    ProjectStore,
    ProjectTooLarge,
    ProjectValidationError,
)
from .local import LocalFileStore
from .sqlite import SQLiteStore, UserExists, hash_password, verify_password

__all__ = [
    "ProjectStore",
    "LocalFileStore",
    "SQLiteStore",
    "ProjectNotFound",
    "ProjectTooLarge",
    "ProjectValidationError",
    "UserExists",
    "DEFAULT_MAX_PROJECT_BYTES",
    "hash_password",
    "verify_password",
]
