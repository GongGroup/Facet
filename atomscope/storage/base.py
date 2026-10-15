"""Abstract project store and shared helpers.

Every back-end implements the same owner-scoped CRUD interface so the REST
layer does not care where projects live.  Documents follow
``atomscope.project/1`` (``docs/SCHEMA.md``); summaries are produced by
:func:`atomscope.project.project_summary`.
"""

from __future__ import annotations

import copy
import json
from abc import ABC, abstractmethod
from typing import Any

from ..project import (
    ProjectNotFound,
    ProjectTooLarge,
    ProjectValidationError,
    is_project_id,
    new_project_id,
    normalize_project,
    now_iso,
)

__all__ = [
    "ProjectStore",
    "ProjectNotFound",
    "ProjectTooLarge",
    "ProjectValidationError",
    "DEFAULT_MAX_PROJECT_BYTES",
    "encode_project",
    "matches_query",
]

#: Default maximum serialised project size (50 MB).
DEFAULT_MAX_PROJECT_BYTES = 50 * 1024 * 1024

#: Keys clients may not change through ``patch``.
_IMMUTABLE = {"id", "created", "schema"}


def encode_project(doc: dict[str, Any]) -> bytes:
    """Compact UTF-8 JSON encoding used for storage and size accounting."""
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def matches_query(summary: dict[str, Any], q: str | None) -> bool:
    """Case-insensitive search over project name and tags."""
    if not q:
        return True
    needle = q.strip().lower()
    if needle in str(summary.get("name", "")).lower():
        return True
    return any(needle in str(t).lower() for t in summary.get("tags") or [])


class ProjectStore(ABC):
    """Owner-scoped project storage.

    Concrete stores implement the ``_``-prefixed primitives; validation, id
    assignment, timestamps and size limits are handled here.
    """

    def __init__(self, max_project_bytes: int = DEFAULT_MAX_PROJECT_BYTES) -> None:
        self.max_project_bytes = int(max_project_bytes)

    # ----------------------------------------------------------- primitives
    @abstractmethod
    def _list_summaries(self, owner: str) -> list[dict[str, Any]]:
        """All project summaries of *owner* (any order)."""

    @abstractmethod
    def _load(self, owner: str, pid: str) -> dict[str, Any] | None:
        """Full document or ``None``."""

    @abstractmethod
    def _save(self, owner: str, doc: dict[str, Any], data: bytes, is_new: bool) -> None:
        """Persist *doc* (already normalised; *data* is its encoding)."""

    @abstractmethod
    def _remove(self, owner: str, pid: str) -> bool:
        """Delete; return False if it did not exist."""

    def _exists_anywhere(self, pid: str) -> bool:
        """True if *pid* is used by any owner (ids are globally unique)."""
        return False

    # ------------------------------------------------------------- helpers
    def _encode_checked(self, doc: dict[str, Any]) -> bytes:
        data = encode_project(doc)
        if len(data) > self.max_project_bytes:
            raise ProjectTooLarge(
                f"project is {len(data) / 1e6:.1f} MB, larger than the limit of {self.max_project_bytes / 1e6:.0f} MB"
            )
        return data

    def _fresh_id(self, owner: str) -> str:
        while True:
            pid = new_project_id()
            if self._load(owner, pid) is None and not self._exists_anywhere(pid):
                return pid

    # ------------------------------------------------------------ public API
    def list(self, owner: str, q: str | None = None) -> list[dict[str, Any]]:
        """Project summaries, newest ``updated`` first, optionally filtered by *q*."""
        items = [s for s in self._list_summaries(owner) if matches_query(s, q)]
        items.sort(key=lambda s: (str(s.get("updated") or ""), str(s.get("id"))), reverse=True)
        return items

    def get(self, owner: str, pid: str) -> dict[str, Any]:
        """Full project document; raises :class:`ProjectNotFound`."""
        doc = self._load(owner, pid) if isinstance(pid, str) else None
        if doc is None:
            raise ProjectNotFound(f"project {pid!r} not found")
        return doc

    def create(self, owner: str, project: dict[str, Any]) -> dict[str, Any]:
        """Create a project from a full or partial document; returns the stored document.

        A client-supplied ``id`` is kept if it is well-formed and unused,
        otherwise a new one is assigned.  ``created``/``updated`` are filled in
        when missing.
        """
        doc = normalize_project(copy.deepcopy(project))
        pid = doc.get("id")
        if not is_project_id(pid) or self._load(owner, pid) is not None or self._exists_anywhere(pid):
            pid = self._fresh_id(owner)
        doc["id"] = pid
        ts = now_iso()
        doc.setdefault("created", ts)
        doc.setdefault("updated", ts)
        doc = self._order(doc)
        self._save(owner, doc, self._encode_checked(doc), True)
        return doc

    def update(self, owner: str, pid: str, project: dict[str, Any]) -> dict[str, Any]:
        """Replace a project entirely (``id``/``created`` kept, ``updated`` bumped)."""
        old = self.get(owner, pid)
        doc = normalize_project(copy.deepcopy(project))
        doc["id"] = pid
        doc["created"] = old.get("created") or now_iso()
        doc["updated"] = now_iso()
        doc = self._order(doc)
        self._save(owner, doc, self._encode_checked(doc), False)
        return doc

    def patch(self, owner: str, pid: str, partial: dict[str, Any]) -> dict[str, Any]:
        """Merge top-level keys of *partial* into the project (``updated`` bumped)."""
        if not isinstance(partial, dict):
            raise ProjectValidationError("patch body must be a JSON object")
        old = self.get(owner, pid)
        merged = dict(old)
        for k, v in partial.items():
            if k in _IMMUTABLE:
                continue
            merged[k] = v
        return self.update(owner, pid, merged)

    def delete(self, owner: str, pid: str) -> None:
        """Delete a project; raises :class:`ProjectNotFound`."""
        if not self._remove(owner, pid):
            raise ProjectNotFound(f"project {pid!r} not found")

    def duplicate(self, owner: str, pid: str) -> dict[str, Any]:
        """Copy a project under a new id with ``" (copy)"`` appended to the name."""
        doc = copy.deepcopy(self.get(owner, pid))
        doc.pop("id", None)
        doc.pop("created", None)
        doc.pop("updated", None)
        doc["name"] = f"{doc.get('name') or 'Untitled project'} (copy)"
        return self.create(owner, doc)

    def close(self) -> None:  # pragma: no cover - default no-op
        """Release resources."""

    @staticmethod
    def _order(doc: dict[str, Any]) -> dict[str, Any]:
        """Stable, readable key order (schema/id/name first, structures/scene last)."""
        head = ["schema", "id", "name", "description", "tags", "created", "updated", "thumbnail", "activeStructure"]
        tail = ["structures", "scene"]
        out = {k: doc[k] for k in head if k in doc}
        out.update({k: v for k, v in doc.items() if k not in head and k not in tail})
        out.update({k: doc[k] for k in tail if k in doc})
        return out
