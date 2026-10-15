"""Server settings from CLI arguments and ``ATOMSCOPE_*`` environment variables.

Precedence: explicit arguments (CLI / Python) > environment > defaults.

==============================  =====================================  ==================
Environment variable            Meaning                                Default
==============================  =====================================  ==================
``ATOMSCOPE_HOST``              bind address                           ``127.0.0.1``
``ATOMSCOPE_PORT``              port                                   ``8765``
``ATOMSCOPE_MODE``              ``local`` or ``cloud``                 ``local``
``ATOMSCOPE_DATA_DIR``          data directory (alias ATOMSCOPE_DATA)  ``~/.atomscope``
``ATOMSCOPE_PLUGIN_DIRS``       plugin dirs (``os.pathsep`` or ``,``)  —
``ATOMSCOPE_ALLOW_REGISTRATION`` allow self-registration (cloud)       ``true``
``ATOMSCOPE_SECRET``            server secret (token hashing)          generated, saved
``ATOMSCOPE_CORS_ORIGINS``      comma-separated allowed origins        — (same origin)
``ATOMSCOPE_MAX_PROJECT_MB``    max project size                       ``50``
``ATOMSCOPE_MAX_UPLOAD_MB``     max upload size                        ``100``
``ATOMSCOPE_WEB_DIR``           alternative frontend directory         package ``web/``
``ATOMSCOPE_LOG_LEVEL``         uvicorn/app log level                  ``info``
==============================  =====================================  ==================
"""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any, Mapping

__all__ = ["Settings", "MODES", "DEFAULT_PORT", "DEFAULT_DATA_DIR", "PACKAGE_WEB_DIR"]

MODES = ("local", "cloud")
DEFAULT_PORT = 8765
DEFAULT_DATA_DIR = Path("~/.atomscope")
PACKAGE_WEB_DIR = Path(__file__).resolve().parent / "web"

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


@dataclass
class Settings:
    """Runtime configuration of the AtomScope server."""

    host: str = "127.0.0.1"
    port: int = DEFAULT_PORT
    mode: str = "local"
    data_dir: Path = field(default_factory=lambda: DEFAULT_DATA_DIR.expanduser())
    plugin_dirs: list[Path] = field(default_factory=list)
    allow_registration: bool = True
    secret: str | None = None
    cors_origins: list[str] = field(default_factory=list)
    max_project_mb: float = 50.0
    max_upload_mb: float = 100.0
    web_dir: Path | None = None
    entry_point_plugins: bool = True
    log_level: str = "info"

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir).expanduser()
        self.plugin_dirs = [Path(p).expanduser() for p in self.plugin_dirs]
        if self.web_dir is not None:
            self.web_dir = Path(self.web_dir).expanduser()
        self.mode = str(self.mode).lower()
        self.port = int(self.port)
        self.validate()

    # ------------------------------------------------------------ factory
    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, **overrides: Any) -> "Settings":
        """Build settings from ``ATOMSCOPE_*`` variables, then apply non-``None`` *overrides*."""
        env = os.environ if env is None else env
        kw: dict[str, Any] = {}

        def get(*names: str) -> str | None:
            for n in names:
                v = env.get(n)
                if v is not None and v != "":
                    return v
            return None

        if (v := get("ATOMSCOPE_HOST")) is not None:
            kw["host"] = v
        if (v := get("ATOMSCOPE_PORT")) is not None:
            kw["port"] = int(v)
        if (v := get("ATOMSCOPE_MODE")) is not None:
            kw["mode"] = v
        if (v := get("ATOMSCOPE_DATA_DIR", "ATOMSCOPE_DATA")) is not None:
            kw["data_dir"] = Path(v)
        if (v := get("ATOMSCOPE_PLUGIN_DIRS")) is not None:
            kw["plugin_dirs"] = [Path(p) for p in _list(v)]
        if (v := get("ATOMSCOPE_ALLOW_REGISTRATION")) is not None:
            kw["allow_registration"] = _bool(v)
        if (v := get("ATOMSCOPE_SECRET")) is not None:
            kw["secret"] = v
        if (v := get("ATOMSCOPE_CORS_ORIGINS")) is not None:
            kw["cors_origins"] = _list(v.replace(os.pathsep, ","))
        if (v := get("ATOMSCOPE_MAX_PROJECT_MB")) is not None:
            kw["max_project_mb"] = float(v)
        if (v := get("ATOMSCOPE_MAX_UPLOAD_MB")) is not None:
            kw["max_upload_mb"] = float(v)
        if (v := get("ATOMSCOPE_WEB_DIR")) is not None:
            kw["web_dir"] = Path(v)
        if (v := get("ATOMSCOPE_LOG_LEVEL")) is not None:
            kw["log_level"] = v.lower()
        names = {f.name for f in fields(cls)}
        for key, val in overrides.items():
            if key not in names:
                raise TypeError(f"unknown setting {key!r}")
            if val is not None:
                kw[key] = val
        return cls(**kw)

    def with_(self, **changes: Any) -> "Settings":
        """Return a copy with *changes* applied."""
        return replace(self, **changes)

    # ----------------------------------------------------------- derived
    def validate(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}, got {self.mode!r}")
        if not 0 <= self.port <= 65535:
            raise ValueError("port must be between 0 and 65535")
        if self.max_project_mb <= 0 or self.max_upload_mb <= 0:
            raise ValueError("size limits must be positive")

    @property
    def projects_dir(self) -> Path:
        """Folder of the local file store."""
        return self.data_dir / "projects"

    @property
    def db_path(self) -> Path:
        """SQLite database used in cloud mode."""
        return self.data_dir / "atomscope.db"

    @property
    def max_project_bytes(self) -> int:
        return int(self.max_project_mb * 1024 * 1024)

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

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
