"""Server settings from CLI arguments and ``CRYSTALLUME_*`` environment variables.

Precedence: explicit arguments (CLI / Python) > environment > defaults. ``ATOMSCOPE_*`` (the package's former
name) is read for any setting that has no ``CRYSTALLUME_*`` value.

===================================  =======================================  ==========================
Environment variable                 Meaning                                  Default
===================================  =======================================  ==========================
``CRYSTALLUME_HOST``                 bind address                             ``127.0.0.1``
``CRYSTALLUME_PORT``                 port                                     ``8765``
``CRYSTALLUME_MODE``                 ``local`` or ``cloud``                   ``local``
``CRYSTALLUME_DATA_DIR``             data directory (alias CRYSTALLUME_DATA)  ``~/.crystallume`` (or an
                                                                              existing ``~/.atomscope``)
``CRYSTALLUME_PLUGIN_DIRS``          plugin dirs (``os.pathsep`` or ``,``)    —
``CRYSTALLUME_ALLOW_REGISTRATION``   allow self-registration (cloud)          ``true`` on loopback,
                                                                              ``false`` otherwise
``CRYSTALLUME_SECRET``               server secret (token hashing)            generated, saved
``CRYSTALLUME_TOKEN``                local mode: require this bearer token    — (no login)
``CRYSTALLUME_TOKEN_TTL_DAYS``       cloud sign-ins expire after N idle       ``30`` (0 = never)
                                     days
``CRYSTALLUME_MAX_ATOMS``            atom limit of builder endpoints          ``200000``
``CRYSTALLUME_FRAME_ANCESTORS``      CSP frame-ancestors (allow embedding)    — (same origin)
``CRYSTALLUME_ROOT_PATH``            URL prefix behind a reverse proxy        — (e.g. ``/crystallume``)
``CRYSTALLUME_FORWARDED_ALLOW_IPS``  reverse-proxy addresses or CIDR          — (127.0.0.1 only)
                                     networks whose X-Forwarded-For/-Proto
                                     are trusted (comma-separated; avoid
                                     ``*``: clients could forge addresses)
``CRYSTALLUME_CORS_ORIGINS``         comma-separated allowed origins          — (same origin)
``CRYSTALLUME_ALLOWED_HOSTS``        extra host names a token-less local      — (localhost names)
                                     server on 127.0.0.1 answers to (``*``
                                     = any; guards against DNS rebinding)
``CRYSTALLUME_MAX_PROJECT_MB``       max project size                         ``50``
``CRYSTALLUME_MAX_UPLOAD_MB``        max upload size                          ``100``
``CRYSTALLUME_WEB_DIR``              alternative frontend directory           package ``web/``
``CRYSTALLUME_LOG_LEVEL``            uvicorn/app log level                    ``info``
===================================  =======================================  ==========================
"""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any, Mapping

__all__ = ["Settings", "MODES", "DEFAULT_PORT", "DEFAULT_DATA_DIR", "PACKAGE_WEB_DIR", "DEFAULT_MAX_ATOMS",
           "is_loopback_host"]

MODES = ("local", "cloud")
DEFAULT_PORT = 8765
DEFAULT_DATA_DIR = Path("~/.crystallume")
LEGACY_DATA_DIR = Path("~/.atomscope")  # used by versions released under the former name
DB_NAME = "crystallume.db"
LEGACY_DB_NAME = "atomscope.db"  # cloud database written by versions released under the former name


def _default_data_dir() -> Path:
    """``~/.crystallume``, or an existing ``~/.atomscope`` from before the rename."""
    new, old = DEFAULT_DATA_DIR.expanduser(), LEGACY_DATA_DIR.expanduser()
    return old if not new.exists() and old.is_dir() else new
PACKAGE_WEB_DIR = Path(__file__).resolve().parent / "web"
DEFAULT_MAX_ATOMS = 200_000

_TRUE = {"1", "true", "yes", "on", "y", "t"}
_FALSE = {"0", "false", "no", "off", "n", "f"}


def _bool(v: str) -> bool:
    s = v.strip().lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    raise ValueError(f"not a boolean: {v!r}")


def _list(v: str) -> list[str]:
    return [p.strip() for p in re.split(rf"[,{re.escape(os.pathsep)}]", v) if p.strip()]


def _db_has_data(path: Path) -> bool | None:
    """True when the SQLite store at *path* holds any account or project; ``None`` when it cannot be read."""
    import sqlite3

    try:
        con = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=2)
        try:
            names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            return any(con.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in ("users", "projects") if t in names)
        finally:
            con.close()
    except sqlite3.Error:
        return None


def is_loopback_host(host: str | None) -> bool:
    """True when *host* only accepts connections from this machine (127.x, ::1, localhost)."""
    h = str(host or "").strip().strip("[]").lower()
    return h == "localhost" or h == "::1" or h.startswith("127.")


@dataclass
class Settings:
    """Runtime configuration of the Crystallume server."""

    host: str = "127.0.0.1"
    port: int = DEFAULT_PORT
    mode: str = "local"
    data_dir: Path = field(default_factory=_default_data_dir)
    plugin_dirs: list[Path] = field(default_factory=list)
    #: ``None`` = automatic: allowed on a loopback host, disabled when the server is reachable from the network.
    allow_registration: bool | None = None
    secret: str | None = None
    cors_origins: list[str] = field(default_factory=list)
    max_project_mb: float = 50.0
    max_upload_mb: float = 100.0
    web_dir: Path | None = None
    entry_point_plugins: bool = True
    log_level: str = "info"
    #: Local mode: when set, every API request needs ``Authorization: Bearer <token>``.
    token: str | None = None
    #: Cloud mode: sign-in tokens unused for this many days stop working (0 = never).
    token_ttl_days: float = 30.0
    #: Upper bound on atoms produced by builder endpoints.
    max_atoms: int = DEFAULT_MAX_ATOMS
    #: CSP ``frame-ancestors`` value (e.g. ``'self' https://lab.example.org``); unset = same-origin framing only.
    frame_ancestors: str | None = None
    #: URL prefix when served behind a reverse proxy under a sub-path (e.g. ``/crystallume``).
    root_path: str = ""
    #: Addresses or networks (CIDR) of reverse proxies whose ``X-Forwarded-For``/``-Proto`` headers are trusted
    #: (comma-separated). Unset = uvicorn's default (``FORWARDED_ALLOW_IPS`` or 127.0.0.1). Behind a proxy on another
    #: host or container, set it so rate limits apply per real client instead of to everyone at once. ``*`` (any)
    #: lets a client that reaches the port directly forge its address; name the proxy instead.
    forwarded_allow_ips: str | None = None
    #: Local mode without a token on a loopback address answers only to localhost names (against DNS
    #: rebinding); these host names are accepted too (``*`` = any).
    allowed_hosts: list[str] = field(default_factory=list)
    _registration_auto: bool = field(default=False, init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir).expanduser()
        self.plugin_dirs = [Path(p).expanduser() for p in self.plugin_dirs]
        if self.web_dir is not None:
            self.web_dir = Path(self.web_dir).expanduser()
        self.mode = str(self.mode).lower()
        self.port = int(self.port)
        if self.allow_registration is None:
            self._registration_auto = True
            self.allow_registration = is_loopback_host(self.host)
        self.allow_registration = bool(self.allow_registration)
        self.token = (str(self.token).strip() or None) if self.token is not None else None
        self.max_atoms = int(self.max_atoms)
        self.token_ttl_days = float(self.token_ttl_days)
        rp = str(self.root_path or "").strip().rstrip("/")
        self.root_path = ("/" + rp.lstrip("/")) if rp else ""
        if self.forwarded_allow_ips is not None:
            # comma-separated only (IPv6 addresses contain ':')
            self.forwarded_allow_ips = ",".join(p.strip() for p in str(self.forwarded_allow_ips).split(",") if p.strip()) or None
        self.validate()

    # ------------------------------------------------------------ factory
    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, **overrides: Any) -> "Settings":
        """Build settings from ``CRYSTALLUME_*`` variables, then apply non-``None`` *overrides*."""
        env = os.environ if env is None else env
        kw: dict[str, Any] = {}

        def get(*names: str) -> str | None:
            # ATOMSCOPE_* (the package's former name) is read when no CRYSTALLUME_* value is set
            for n in (*names, *(x.replace("CRYSTALLUME_", "ATOMSCOPE_", 1) for x in names)):
                v = env.get(n)
                if v is not None and v != "":
                    return v
            return None

        if (v := get("CRYSTALLUME_HOST")) is not None:
            kw["host"] = v
        if (v := get("CRYSTALLUME_PORT")) is not None:
            kw["port"] = int(v)
        if (v := get("CRYSTALLUME_MODE")) is not None:
            kw["mode"] = v
        if (v := get("CRYSTALLUME_DATA_DIR", "CRYSTALLUME_DATA")) is not None:
            kw["data_dir"] = Path(v)
        if (v := get("CRYSTALLUME_PLUGIN_DIRS")) is not None:
            kw["plugin_dirs"] = [Path(p) for p in _list(v)]
        if (v := get("CRYSTALLUME_ALLOW_REGISTRATION")) is not None:
            kw["allow_registration"] = _bool(v)
        if (v := get("CRYSTALLUME_SECRET")) is not None:
            kw["secret"] = v
        if (v := get("CRYSTALLUME_CORS_ORIGINS")) is not None:
            kw["cors_origins"] = _list(v.replace(os.pathsep, ","))
        if (v := get("CRYSTALLUME_MAX_PROJECT_MB")) is not None:
            kw["max_project_mb"] = float(v)
        if (v := get("CRYSTALLUME_MAX_UPLOAD_MB")) is not None:
            kw["max_upload_mb"] = float(v)
        if (v := get("CRYSTALLUME_WEB_DIR")) is not None:
            kw["web_dir"] = Path(v)
        if (v := get("CRYSTALLUME_LOG_LEVEL")) is not None:
            kw["log_level"] = v.lower()
        if (v := get("CRYSTALLUME_TOKEN")) is not None:
            kw["token"] = v
        if (v := get("CRYSTALLUME_TOKEN_TTL_DAYS")) is not None:
            kw["token_ttl_days"] = float(v)
        if (v := get("CRYSTALLUME_MAX_ATOMS")) is not None:
            kw["max_atoms"] = int(v)
        if (v := get("CRYSTALLUME_FRAME_ANCESTORS")) is not None:
            kw["frame_ancestors"] = v
        if (v := get("CRYSTALLUME_ROOT_PATH")) is not None:
            kw["root_path"] = v
        if (v := get("CRYSTALLUME_FORWARDED_ALLOW_IPS")) is not None:
            kw["forwarded_allow_ips"] = v
        if (v := get("CRYSTALLUME_ALLOWED_HOSTS")) is not None:
            kw["allowed_hosts"] = [h.strip() for h in v.split(",") if h.strip()]
        names = {f.name for f in fields(cls) if f.init}
        for key, val in overrides.items():
            if key not in names:
                raise TypeError(f"unknown setting {key!r}")
            if val is not None:
                kw[key] = val
        return cls(**kw)

    def with_(self, **changes: Any) -> "Settings":
        """Return a copy with *changes* applied (automatic registration follows a changed host)."""
        if self._registration_auto and "allow_registration" not in changes:
            changes["allow_registration"] = None
        return replace(self, **changes)

    # ----------------------------------------------------------- derived
    def validate(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}, got {self.mode!r}")
        if not 0 <= self.port <= 65535:
            raise ValueError("port must be between 0 and 65535")
        if self.max_project_mb <= 0 or self.max_upload_mb <= 0:
            raise ValueError("size limits must be positive")
        if self.max_atoms < 1:
            raise ValueError("max_atoms must be positive")
        if self.token_ttl_days < 0:
            raise ValueError("token_ttl_days must be >= 0 (0 = tokens never expire)")

    @property
    def projects_dir(self) -> Path:
        """Folder of the local file store."""
        return self.data_dir / "projects"

    @property
    def db_path(self) -> Path:
        """SQLite database used in cloud mode.

        ``crystallume.db``; a data directory from before the rename keeps using its ``atomscope.db`` (also when an
        empty ``crystallume.db`` was created next to it by an earlier start of this version).
        """
        new, old = self.data_dir / DB_NAME, self.data_dir / LEGACY_DB_NAME
        if old.is_file() and (not new.exists() or (_db_has_data(new) is False and _db_has_data(old))):
            return old
        return new

    @property
    def max_project_bytes(self) -> int:
        return int(self.max_project_mb * 1024 * 1024)

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    @property
    def body_limit_bytes(self) -> int:
        """Largest accepted request body (project or upload plus multipart overhead)."""
        return max(self.max_upload_bytes, self.max_project_bytes) + 64 * 1024

    @property
    def is_public(self) -> bool:
        """True when the server is bound to a non-loopback address (reachable from the network)."""
        return not is_loopback_host(self.host)

    @property
    def resolved_web_dir(self) -> Path:
        """Directory served at ``/`` (may not exist yet)."""
        return self.web_dir or PACKAGE_WEB_DIR

    def resolve_secret(self) -> str:
        """Return the configured secret, or read/create ``<data_dir>/secret.key`` (mode 0600)."""
        if self.secret:
            return self.secret
        path = self.data_dir / "secret.key"
        try:
            if path.is_file():
                value = path.read_text(encoding="utf-8").strip()
                if value:
                    self.secret = value
                    return value
            self.data_dir.mkdir(parents=True, exist_ok=True)
            value = secrets.token_urlsafe(48)
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(value + "\n")
            self.secret = value
            return value
        except OSError:  # pragma: no cover - read-only data dir
            self.secret = secrets.token_urlsafe(48)
            return self.secret

    def urls(self) -> list[str]:
        """Human-facing URLs for the configured host/port (LAN IPs for 0.0.0.0)."""
        from .server.netutil import display_urls

        return display_urls(self.host, self.port)
