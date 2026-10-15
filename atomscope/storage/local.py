"""File-based project store for local (single-user) mode.

Layout under ``root``::

    root/
      perovskite-study-p_8f3a91c2d4/
        project.json              # full atomscope.project/1 document
        structures/s_1.xyz        # extended-XYZ copies for other tools (regenerated on save)
        thumbnail.jpg             # decoded from the project's data-URL thumbnail
      some-file.json              # dropped here → imported as a new project folder
      .imported/                  # originals of imported files
      .trash/                     # deleted projects (moved, not destroyed)

The folder name is ``<slug>-<id>``, but the id inside ``project.json`` is
authoritative, so users may rename or copy folders freely (a copied folder
with a clashing id gets a new id).  Listings are cached by file mtime.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from ..core.structure import Structure
from ..io import to_text
from ..project import is_project_id, new_project_id, normalize_project, project_summary, slugify
from .base import DEFAULT_MAX_PROJECT_BYTES, ProjectStore, encode_project

__all__ = ["LocalFileStore"]

log = logging.getLogger(__name__)

_DATA_URL_RE = re.compile(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", re.S)


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class LocalFileStore(ProjectStore):
    """Projects as folders on disk; the ``owner`` argument is ignored (single user)."""

    PROJECT_FILE = "project.json"

    def __init__(self, root: str | Path, max_project_bytes: int = DEFAULT_MAX_PROJECT_BYTES,
                 export_xyz: bool = True) -> None:
        super().__init__(max_project_bytes)
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.export_xyz = export_xyz
        self._lock = threading.RLock()
        self._index: dict[str, Path] = {}
        self._cache: dict[Path, tuple[int, int, dict[str, Any]]] = {}
        self._bad_imports: dict[Path, int] = {}

    # ------------------------------------------------------------- scanning
    def _import_dropped(self) -> None:
        """Turn top-level ``*.json`` files into project folders."""
        for f in sorted(self.root.glob("*.json")):
            try:
                mtime = f.stat().st_mtime_ns
            except OSError:
                continue
            if self._bad_imports.get(f) == mtime:
                continue
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(raw, dict) and ("structures" in raw or str(raw.get("schema", "")).startswith("atomscope.project")):
                    doc = raw
                else:
                    from ..io.jsonfmt import _from_obj

                    st = _from_obj(raw)
                    structs = st if isinstance(st, list) else [st]
                    doc = {"name": f.stem, "structures": [s.to_dict() for s in structs]}
                doc = normalize_project(doc)
                if doc.get("id") in self._index:
                    doc.pop("id")
                self._create_unlocked(doc)
                dest = self.root / ".imported"
                dest.mkdir(exist_ok=True)
                shutil.move(str(f), str(dest / f"{time.strftime('%Y%m%d-%H%M%S')}-{f.name}"))
                log.info("imported dropped project file %s", f.name)
            except Exception as exc:
                self._bad_imports[f] = mtime
                log.warning("could not import %s: %s", f, exc)

    def _scan(self) -> None:
        self._import_dropped()
        index: dict[str, Path] = {}
        seen: set[Path] = set()
        dirs = [d for d in self.root.iterdir() if d.is_dir() and not d.name.startswith(".")]
        # Older folders keep their id when two folders claim the same one.
        dirs.sort(key=lambda d: (d / self.PROJECT_FILE).stat().st_mtime_ns if (d / self.PROJECT_FILE).exists() else 0)
        for d in dirs:
            pf = d / self.PROJECT_FILE
            if not pf.is_file():
                continue
            seen.add(d)
            try:
                st = pf.stat()
                cached = self._cache.get(d)
                if cached and cached[0] == st.st_mtime_ns and cached[1] == st.st_size:
                    summary = cached[2]
                else:
                    doc = json.loads(pf.read_text(encoding="utf-8"))
                    doc = normalize_project(doc)
                    if not is_project_id(doc.get("id")):
                        doc["id"] = new_project_id()
                        self._write_doc(d, doc)
                        st = pf.stat()
                    summary = project_summary(doc)
                    self._cache[d] = (st.st_mtime_ns, st.st_size, summary)
                pid = summary["id"]
                if pid in index:
                    doc = normalize_project(json.loads(pf.read_text(encoding="utf-8")))
                    doc["id"] = new_project_id()
                    log.warning("project folder %s duplicates id %s; assigned %s", d.name, pid, doc["id"])
                    self._write_doc(d, doc)
                    st = pf.stat()
                    summary = project_summary(doc)
                    self._cache[d] = (st.st_mtime_ns, st.st_size, summary)
                    pid = doc["id"]
                index[pid] = d
            except Exception as exc:
                log.warning("skipping unreadable project folder %s: %s", d, exc)
        for d in list(self._cache):
            if d not in seen:
                self._cache.pop(d, None)
        self._index = index

    def _folder(self, pid: str) -> Path | None:
        d = self._index.get(pid)
        if d is None or not (d / self.PROJECT_FILE).is_file():
            self._scan()
            d = self._index.get(pid)
        return d

    # ------------------------------------------------------------ primitives
    def _list_summaries(self, owner: str) -> list[dict[str, Any]]:
        with self._lock:
            self._scan()
            return [dict(self._cache[d][2]) for d in self._index.values() if d in self._cache]

    def _load(self, owner: str, pid: str) -> dict[str, Any] | None:
        with self._lock:
            if not is_project_id(pid):
                return None
            d = self._folder(pid)
            if d is None:
                return None
            try:
                doc = normalize_project(json.loads((d / self.PROJECT_FILE).read_text(encoding="utf-8")))
            except (OSError, ValueError) as exc:
                log.warning("cannot read %s: %s", d, exc)
                return None
            doc["id"] = pid
            return doc

    def _exists_anywhere(self, pid: str) -> bool:
        with self._lock:
            return self._folder(pid) is not None

    def _create_unlocked(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Used by the dropped-file importer (already holding the lock)."""
        pid = doc.get("id")
        if not is_project_id(pid) or pid in self._index:
            pid = new_project_id()
        doc["id"] = pid
        from ..project import now_iso

        ts = now_iso()
        doc.setdefault("created", ts)
        doc.setdefault("updated", ts)
        doc = self._order(doc)
        self._save("local", doc, self._encode_checked(doc), True)
        return doc

    def _save(self, owner: str, doc: dict[str, Any], data: bytes, is_new: bool) -> None:
        with self._lock:
            pid = doc["id"]
            wanted = self.root / f"{slugify(doc.get('name', 'project'))}-{pid}"
            current = None if is_new else self._index.get(pid)
            if current is not None and current != wanted and current.exists():
                # Rename the folder to follow the project name (only auto-named folders).
                if current.name.endswith(f"-{pid}") and not wanted.exists():
                    try:
                        current.rename(wanted)
                        self._cache.pop(current, None)
                        current = wanted
                    except OSError as exc:  # pragma: no cover - e.g. file locked on Windows
                        log.warning("could not rename %s: %s", current, exc)
                folder = current
            else:
                folder = current or wanted
            folder.mkdir(parents=True, exist_ok=True)
            self._write_doc(folder, doc, data)
            self._index[pid] = folder
            st = (folder / self.PROJECT_FILE).stat()
            self._cache[folder] = (st.st_mtime_ns, st.st_size, project_summary(doc, len(data)))
            self._write_extras(folder, doc)

    def _write_doc(self, folder: Path, doc: dict[str, Any], data: bytes | None = None) -> None:
        payload = data if data is not None else encode_project(doc)
        # Pretty-print small projects for human readability; keep big ones compact.
        if len(payload) < 2_000_000:
            payload = json.dumps(doc, indent=1, ensure_ascii=False).encode("utf-8")
        _atomic_write(folder / self.PROJECT_FILE, payload)

    def _write_extras(self, folder: Path, doc: dict[str, Any]) -> None:
        """Export structures as extxyz and decode the thumbnail (best effort)."""
        if self.export_xyz:
            sdir = folder / "structures"
            wanted: set[str] = set()
            for entry in doc.get("structures", []):
                fname = f"{entry['id']}.xyz"
                wanted.add(fname)
                try:
                    s = Structure.from_dict(entry["structure"])
                    if not s.name:
                        s.name = entry.get("name", "")
                    _atomic_write(sdir / fname, to_text(s, "extxyz").encode("utf-8"))
                except Exception as exc:
                    log.warning("could not export structure %s of %s: %s", entry.get("id"), doc.get("id"), exc)
            if sdir.is_dir():
                for f in sdir.glob("*.xyz"):
                    if f.name not in wanted:
                        f.unlink(missing_ok=True)
        thumb = doc.get("thumbnail")
        m = _DATA_URL_RE.match(thumb) if isinstance(thumb, str) else None
        for old in folder.glob("thumbnail.*"):
            if m is None or old.suffix.lstrip(".") != ("jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)):
                old.unlink(missing_ok=True)
        if m:
            ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
            try:
                _atomic_write(folder / f"thumbnail.{ext}", base64.b64decode(m.group(2), validate=False))
            except (binascii.Error, ValueError) as exc:
                log.warning("invalid thumbnail data for %s: %s", doc.get("id"), exc)

    def _remove(self, owner: str, pid: str) -> bool:
        with self._lock:
            if not is_project_id(pid):
                return False
            d = self._folder(pid)
            if d is None:
                return False
            trash = self.root / ".trash"
            trash.mkdir(exist_ok=True)
            target = trash / f"{d.name}-{time.strftime('%Y%m%d-%H%M%S')}"
            shutil.move(str(d), str(target))
            self._index.pop(pid, None)
            self._cache.pop(d, None)
            return True

    def folder_of(self, pid: str) -> Path:
        """Folder holding project *pid* (raises ``KeyError``)."""
        with self._lock:
            d = self._folder(pid)
            if d is None:
                raise KeyError(pid)
            return d
