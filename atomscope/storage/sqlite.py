"""SQLite store for cloud (multi-user) mode: users, API tokens and projects.

Tables::

    users(id, username UNIQUE, password_hash, created)
    tokens(token, user_id, created, last_used)       -- token column holds a hash
    projects(id, owner, name, summary_json, doc_json, created, updated)

* Passwords are hashed with ``hashlib.scrypt`` (n=2^14, r=8, p=1) and a random
  salt; PBKDF2-SHA256 is used where scrypt is unavailable.  Both are verified.
* API tokens are random 256-bit strings; only an HMAC-SHA256 of each token
  (keyed with the server secret) is stored, so a leaked database does not leak
  usable tokens.  Tokens unused for ``token_ttl_days`` stop working (0 = never);
  ``last_used`` is written at most once a minute per token.
* One connection guarded by a lock makes the store safe to share between
  threads (FastAPI runs sync endpoints in a thread pool).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..project import is_project_id, now_iso, project_summary
from .base import DEFAULT_MAX_PROJECT_BYTES, ProjectStore

__all__ = ["SQLiteStore", "UserExists", "hash_password", "verify_password"]

_USERNAME_RE = re.compile(r"^[\w.@\-]{2,64}$", re.UNICODE)
MIN_PASSWORD_LENGTH = 6
#: Default sign-in lifetime without use (days).
DEFAULT_TOKEN_TTL_DAYS = 30.0
_TOUCH_SECONDS = 60.0


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


class UserExists(ValueError):
    """The username is already taken."""


def hash_password(password: str) -> str:
    """Return a self-describing salted hash string for *password*."""
    salt = secrets.token_bytes(16)
    try:
        n, r, p = 2**14, 8, 1
        dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
        return f"scrypt${n}${r}${p}${salt.hex()}${dk.hex()}"
    except (AttributeError, ValueError):  # pragma: no cover - OpenSSL without scrypt
        it = 310_000
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, it)
        return f"pbkdf2_sha256${it}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of *password* against a :func:`hash_password` string."""
    try:
        parts = stored.split("$")
        if parts[0] == "scrypt":
            n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
            salt, want = bytes.fromhex(parts[4]), bytes.fromhex(parts[5])
            dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(want))
        elif parts[0] == "pbkdf2_sha256":
            it, salt, want = int(parts[1]), bytes.fromhex(parts[2]), bytes.fromhex(parts[3])
            dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, it)
        else:
            return False
        return hmac.compare_digest(dk, want)
    except (ValueError, IndexError):
        return False


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created TEXT NOT NULL,
    last_used TEXT
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    doc_json TEXT NOT NULL,
    created TEXT NOT NULL,
    updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner, updated);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
"""


class SQLiteStore(ProjectStore):
    """Multi-user project store plus user/token management backed by SQLite."""

    def __init__(self, path: str | Path, max_project_bytes: int = DEFAULT_MAX_PROJECT_BYTES,
                 secret: str | None = None, token_ttl_days: float = DEFAULT_TOKEN_TTL_DAYS) -> None:
        super().__init__(max_project_bytes)
        self.token_ttl_days = float(token_ttl_days or 0)
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        self._secret = (secret or "").encode("utf-8")
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            if self.path != ":memory:":
                self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _q(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def _x(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        with self._lock:
            return self._conn.execute(sql, params).rowcount

    # ----------------------------------------------------------------- users
    @staticmethod
    def _user_json(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "username": row["username"], "created": row["created"]}

    def create_user(self, username: str, password: str) -> dict[str, Any]:
        """Create a user; raises :class:`UserExists` or ``ValueError``."""
        username = (username or "").strip()
        if not _USERNAME_RE.match(username):
            raise ValueError("username must be 2-64 characters: letters, digits, '_', '.', '@' or '-'")
        if len(password or "") < MIN_PASSWORD_LENGTH:
            raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
        uid = "u_" + secrets.token_hex(5)
        try:
            self._x("INSERT INTO users(id, username, password_hash, created) VALUES (?,?,?,?)",
                    (uid, username, hash_password(password), now_iso()))
        except sqlite3.IntegrityError as exc:
            raise UserExists(f"username {username!r} is already taken") from exc
        return self.get_user(uid)  # type: ignore[return-value]

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        rows = self._q("SELECT * FROM users WHERE id=?", (user_id,))
        return self._user_json(rows[0]) if rows else None

    def get_user_by_name(self, username: str) -> dict[str, Any] | None:
        rows = self._q("SELECT * FROM users WHERE username=?", (username.strip(),))
        return self._user_json(rows[0]) if rows else None

    def list_users(self) -> list[dict[str, Any]]:
        return [self._user_json(r) for r in self._q("SELECT * FROM users ORDER BY created")]

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        """Return the user if the credentials are valid, else ``None``."""
        rows = self._q("SELECT * FROM users WHERE username=?", ((username or "").strip(),))
        if not rows:
            hash_password(password or "x")  # equalise timing for unknown users
            return None
        if not verify_password(password or "", rows[0]["password_hash"]):
            return None
        return self._user_json(rows[0])

    def set_password(self, username: str, password: str) -> None:
        if len(password or "") < MIN_PASSWORD_LENGTH:
            raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
        if not self._x("UPDATE users SET password_hash=? WHERE username=?", (hash_password(password), username)):
            raise KeyError(username)

    def delete_user(self, username: str, delete_projects: bool = True) -> None:
        user = self.get_user_by_name(username)
        if user is None:
            raise KeyError(username)
        with self._lock:
            if delete_projects:
                self._conn.execute("DELETE FROM projects WHERE owner=?", (user["id"],))
            self._conn.execute("DELETE FROM tokens WHERE user_id=?", (user["id"],))
            self._conn.execute("DELETE FROM users WHERE id=?", (user["id"],))

    # ---------------------------------------------------------------- tokens
    def _token_key(self, token: str) -> str:
        if self._secret:
            return hmac.new(self._secret, token.encode("utf-8"), hashlib.sha256).hexdigest()
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _expiry_cutoff(self) -> str | None:
        """ISO time before which an unused token has expired (``None`` = never expires)."""
        if self.token_ttl_days <= 0:
            return None
        return _iso(datetime.now(timezone.utc) - timedelta(days=self.token_ttl_days))

    def create_token(self, user_id: str) -> str:
        """Issue a new API token for *user_id* (returned once; only its hash is stored)."""
        token = "ats_" + secrets.token_urlsafe(32)
        ts = now_iso()
        with self._lock:
            cutoff = self._expiry_cutoff()
            if cutoff:  # housekeeping: forget expired sign-ins
                self._conn.execute("DELETE FROM tokens WHERE COALESCE(last_used, created) < ?", (cutoff,))
            self._conn.execute("INSERT INTO tokens(token, user_id, created, last_used) VALUES (?,?,?,?)",
                               (self._token_key(token), user_id, ts, ts))
        return token

    def user_for_token(self, token: str) -> dict[str, Any] | None:
        """Resolve a bearer token to its user; ``None`` when unknown or expired.

        ``last_used`` is refreshed at most once a minute, so busy clients do not
        turn every request into a database write.
        """
        if not token:
            return None
        key = self._token_key(token)
        rows = self._q("SELECT u.*, t.created AS t_created, t.last_used AS t_last_used "
                       "FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token=?", (key,))
        if not rows:
            return None
        row = rows[0]
        last = row["t_last_used"] or row["t_created"]
        cutoff = self._expiry_cutoff()
        if cutoff and (not last or str(last) < cutoff):
            self._x("DELETE FROM tokens WHERE token=?", (key,))
            return None
        now = datetime.now(timezone.utc)
        seen = _parse_iso(last)
        if seen is None or (now - seen).total_seconds() >= _TOUCH_SECONDS:
            self._x("UPDATE tokens SET last_used=? WHERE token=?", (_iso(now), key))
        return self._user_json(row)

    def revoke_token(self, token: str) -> bool:
        return bool(self._x("DELETE FROM tokens WHERE token=?", (self._token_key(token),)))

    # -------------------------------------------------------------- projects
    def _list_summaries(self, owner: str) -> list[dict[str, Any]]:
        out = []
        for r in self._q("SELECT id, summary_json FROM projects WHERE owner=?", (owner,)):
            summary = json.loads(r["summary_json"])
            if "formula" not in summary or "formulas" not in summary:  # saved by an older version: backfill once
                summary = self._refresh_summary(owner, r["id"]) or summary
            out.append(summary)
        return out

    def _refresh_summary(self, owner: str, pid: str) -> dict[str, Any] | None:
        rows = self._q("SELECT doc_json FROM projects WHERE id=? AND owner=?", (pid, owner))
        if not rows:
            return None
        text = rows[0]["doc_json"]
        summary = project_summary(json.loads(text), len(text.encode("utf-8")))
        self._x("UPDATE projects SET summary_json=? WHERE id=? AND owner=?",
                (json.dumps(summary, ensure_ascii=False), pid, owner))
        return summary

    def _load(self, owner: str, pid: str) -> dict[str, Any] | None:
        if not is_project_id(pid):
            return None
        rows = self._q("SELECT doc_json FROM projects WHERE id=? AND owner=?", (pid, owner))
        return json.loads(rows[0]["doc_json"]) if rows else None

    def _exists_anywhere(self, pid: str) -> bool:
        return bool(self._q("SELECT 1 FROM projects WHERE id=?", (pid,)))

    def _save(self, owner: str, doc: dict[str, Any], data: bytes, is_new: bool) -> None:
        summary = json.dumps(project_summary(doc, len(data)), ensure_ascii=False)
        text = data.decode("utf-8")
        with self._lock:
            if is_new:
                self._conn.execute(
                    "INSERT INTO projects(id, owner, name, summary_json, doc_json, created, updated) VALUES (?,?,?,?,?,?,?)",
                    (doc["id"], owner, doc["name"], summary, text, doc["created"], doc["updated"]),
                )
            else:
                self._conn.execute(
                    "UPDATE projects SET name=?, summary_json=?, doc_json=?, updated=? WHERE id=? AND owner=?",
                    (doc["name"], summary, text, doc["updated"], doc["id"], owner),
                )

    def _remove(self, owner: str, pid: str) -> bool:
        return bool(self._x("DELETE FROM projects WHERE id=? AND owner=?", (pid, owner)))
