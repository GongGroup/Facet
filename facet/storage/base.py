"""Abstract project store and shared helpers.

Every back-end implements the same owner-scoped CRUD interface so the REST
layer does not care where projects live.  Documents follow
``facet.project/1`` (``docs/SCHEMA.md``); summaries are produced by
:func:`facet.project.project_summary`.
"""

from __future__ import annotations

import copy
import json
import re
import threading
from abc import ABC, abstractmethod
from typing import Any

from ..project import (
    ProjectError,
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
    "ProjectConflict",
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

#: Client-side bookkeeping keys that are never stored.
_TRANSIENT = ("baseUpdated", "location")


class ProjectConflict(ProjectError):
    """The project changed since the client loaded it (optimistic locking).

    ``current`` holds the stored ``updated`` timestamp so callers can report it.
    """

    def __init__(self, message: str = "project was changed elsewhere", current: str | None = None) -> None:
        super().__init__(message)
        self.current = current


def encode_project(doc: dict[str, Any]) -> bytes:
    """Compact UTF-8 JSON encoding used for storage and size accounting."""
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def matches_query(summary: dict[str, Any], q: str | None) -> bool:
    """Case-insensitive search over project name, formula, description and tags
    (the same fields as the web app's ``matchesQuery``)."""
    needle = (q or "").strip().lower()
    if not needle:
        return True
    formulas = [str(f or "").lower() for f in (summary.get("formula"), *(summary.get("formulas") or []))]
    # "nacl" also finds Na4Cl4: a query without digits is compared with the formulas' element letters too
    if not any(ch.isdigit() for ch in needle) and any(needle in re.sub(r"\d+", "", f) for f in formulas):
        return True
    fields = [summary.get("name"), *formulas, summary.get("description"), *(summary.get("tags") or [])]
    return any(needle in str(v if v is not None else "").lower() for v in fields)


def _strip_transient(doc: dict[str, Any]) -> dict[str, Any]:
    for key in _TRANSIENT:
        doc.pop(key, None)
    return doc


class ProjectStore(ABC):
    """Owner-scoped project storage.

    Concrete stores implement the ``_``-prefixed primitives; validation, id
    assignment, timestamps and size limits are handled here.
    """

    def __init__(self, max_project_bytes: int = DEFAULT_MAX_PROJECT_BYTES) -> None:
        self.max_project_bytes = int(max_project_bytes)
        # Serialises check-and-write in update(); subclasses may replace it with their own RLock.
        self._lock = threading.RLock()

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
        doc = _strip_transient(normalize_project(copy.deepcopy(project)))
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

    def update(self, owner: str, pid: str, project: dict[str, Any],
               expected_updated: str | None = None) -> dict[str, Any]:
        """Replace a project entirely (``id``/``created`` kept, ``updated`` bumped).

        With *expected_updated* (the ``updated`` value the client loaded) the write
        only happens when the stored project still has that value; otherwise
        :class:`ProjectConflict` is raised.
        """
        with self._lock:
            old = self.get(owner, pid)
            self._check_version(old, expected_updated)
            doc = _strip_transient(normalize_project(copy.deepcopy(project)))
            doc["id"] = pid
            doc["created"] = old.get("created") or now_iso()
            ts = now_iso()
            if ts <= str(old.get("updated") or ""):
                ts = _bump(str(old["updated"]))  # keep versions strictly increasing within one millisecond
            doc["updated"] = ts
            doc = self._order(doc)
            self._save(owner, doc, self._encode_checked(doc), False)
            return doc

    def patch(self, owner: str, pid: str, partial: dict[str, Any],
              expected_updated: str | None = None) -> dict[str, Any]:
        """Merge top-level keys of *partial* into the project (``updated`` bumped)."""
        if not isinstance(partial, dict):
            raise ProjectValidationError("patch body must be a JSON object")
        with self._lock:
            old = self.get(owner, pid)
            self._check_version(old, expected_updated)
            merged = dict(old)
            for k, v in partial.items():
                if k in _IMMUTABLE or k in _TRANSIENT:
                    continue
                merged[k] = v
            return self.update(owner, pid, merged)

    @staticmethod
    def _check_version(old: dict[str, Any], expected_updated: str | None) -> None:
        if expected_updated is None or expected_updated == "*":
            return
        current = str(old.get("updated") or "")
        if str(expected_updated) != current:
            raise ProjectConflict("project was changed elsewhere", current=current or None)

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


def _bump(ts: str) -> str:
    """``ts`` plus one millisecond (ISO ``...SS.mmmZ`` as produced by :func:`now_iso`)."""
    from datetime import datetime, timedelta, timezone

    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(milliseconds=1)
        return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return now_iso()
