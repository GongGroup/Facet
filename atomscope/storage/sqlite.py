"""SQLite store for cloud (multi-user) mode: users, API tokens and projects.

Tables::

    users(id, username UNIQUE, password_hash, created)
    tokens(token, user_id, created, last_used)       -- token column holds a hash
    projects(id, owner, name, summary_json, doc_json, created, updated)

* Passwords are hashed with ``hashlib.scrypt`` (n=2^14, r=8, p=1) and a random
  salt; PBKDF2-SHA256 is used where scrypt is unavailable.  Both are verified.
* API tokens are random 256-bit strings; only an HMAC-SHA256 of each token
  (keyed with the server secret) is stored, so a leaked database does not leak
  usable tokens.
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
from pathlib import Path
from typing import Any

from ..project import is_project_id, now_iso, project_summary
from .base import DEFAULT_MAX_PROJECT_BYTES, ProjectStore

__all__ = ["SQLiteStore", "UserExists", "hash_password", "verify_password"]

_USERNAME_RE = re.compile(r"^[\w.@\-]{2,64}$", re.UNICODE)
MIN_PASSWORD_LENGTH = 6


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
                 secret: str | None = None) -> None:
        super().__init__(max_project_bytes)
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

    def create_token(self, user_id: str) -> str:
        """Issue a new API token for *user_id* (returned once; only its hash is stored)."""
        token = "ats_" + secrets.token_urlsafe(32)
        ts = now_iso()
        self._x("INSERT INTO tokens(token, user_id, created, last_used) VALUES (?,?,?,?)",
                (self._token_key(token), user_id, ts, ts))
        return token

    def user_for_token(self, token: str) -> dict[str, Any] | None:
        """Resolve a bearer token to its user (updates ``last_used``)."""
        if not token:
            return None
        key = self._token_key(token)
        rows = self._q("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token=?", (key,))
        if not rows:
            return None
        self._x("UPDATE tokens SET last_used=? WHERE token=?", (now_iso(), key))
        return self._user_json(rows[0])

    def revoke_token(self, token: str) -> bool:
        return bool(self._x("DELETE FROM tokens WHERE token=?", (self._token_key(token),)))

    # -------------------------------------------------------------- projects
    def _list_summaries(self, owner: str) -> list[dict[str, Any]]:
        return [json.loads(r["summary_json"]) for r in self._q("SELECT summary_json FROM projects WHERE owner=?", (owner,))]

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
