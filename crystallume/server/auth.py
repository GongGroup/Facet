"""Authentication: bearer-token dependency and the ``/api/v1/auth`` routes.

* **local** mode — no accounts; every request acts as the implicit user
  ``{"id": "local", "username": "local"}``.  When ``CRYSTALLUME_TOKEN`` is set,
  every API request (projects, build, io, analysis and plugin routes) must send
  ``Authorization: Bearer <that token>``; only ``/info``, ``/health`` and
  ``/auth/login``/``/auth/logout`` stay open (:func:`require_local_token`).  The
  web app signs in with username ``local`` and the token as password.
* **cloud** mode — project routes require ``Authorization: Bearer <token>``
  (or ``?access_token=`` for plain links such as downloads).  Tokens come from
  ``/auth/register`` or ``/auth/login`` and are revoked by ``/auth/logout``.

Failed logins (10 per 5 minutes) and registrations (5 per hour) are rate-limited
per client address.  In local mode with ``CRYSTALLUME_TOKEN`` a wrong bearer token
counts as a failed login too (the token *is* the password), so it cannot be
guessed through other API routes either.  Behind a reverse proxy, set
``CRYSTALLUME_FORWARDED_ALLOW_IPS`` so the client address is the real client's.
"""

from __future__ import annotations

import hmac
import os
import threading
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..storage.sqlite import SQLiteStore, UserExists
from .models import AuthResponse, Credentials, MeResponse, OkResponse

__all__ = ["LOCAL_USER", "PUBLIC_API_PATHS", "router", "current_user", "bearer_token", "require_local_token"]

LOCAL_USER: dict[str, Any] = {"id": "local", "username": "local", "created": None}

_bearer = HTTPBearer(auto_error=False, description="API token from /api/v1/auth/login or /auth/register")


class _RateLimiter:
    """Tiny in-memory limiter for failed logins (per client address)."""

    def __init__(self, max_failures: int = 10, window: float = 300.0) -> None:
        self.max_failures = max_failures
        self.window = window
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._events[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.max_failures

    def fail(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


_limiter = _RateLimiter()  # kept for compatibility; each app gets its own limiters (see _limits)

#: Self-registrations allowed per client address and hour.
REGISTER_LIMIT = (5, 3600.0)


def _limits(request: Request) -> dict[str, _RateLimiter]:
    """Per-app rate limiters (so separate apps, e.g. in tests, do not share state)."""
    state = request.app.state
    limits = getattr(state, "rate_limits", None)
    if limits is None:
        limits = {"login": _RateLimiter(), "register": _RateLimiter(*REGISTER_LIMIT)}
        state.rate_limits = limits
    return limits


def _trusts_any_proxy(request: Request) -> bool:
    """True when X-Forwarded-For is trusted from anyone (``*``; uvicorn's own FORWARDED_ALLOW_IPS when ours is unset)."""
    value = getattr(request.app.state.settings, "forwarded_allow_ips", None)
    if value is None:
        value = os.environ.get("FORWARDED_ALLOW_IPS")
    return value is not None and value.strip() == "*"


def _client_key(request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    if _trusts_any_proxy(request):
        # With "*" uvicorn reports the LEFTMOST X-Forwarded-For entry, which the client writes itself (nginx's
        # $proxy_add_x_forwarded_for appends to what the client sent), so it could pick a new key per request.
        # Count by the entry the nearest proxy added instead.
        hops = [h.strip() for v in request.headers.getlist("x-forwarded-for") for h in v.split(",") if h.strip()]
        if hops:
            host = hops[-1]
    return host


def _local_token(request: Request) -> str | None:
    settings = request.app.state.settings
    return getattr(settings, "token", None) if settings.mode == "local" else None


def _users(request: Request) -> SQLiteStore:
    users = getattr(request.app.state, "users", None)
    if users is None:
        raise HTTPException(400, "authentication is disabled in local mode")
    return users


def bearer_token(request: Request, creds: HTTPAuthorizationCredentials | None) -> str | None:
    """Extract the token from the Authorization header or ``access_token`` query parameter."""
    if creds is not None and creds.scheme.lower() == "bearer" and creds.credentials:
        return creds.credentials
    return request.query_params.get("access_token") or None


#: API routes that stay open in local mode with ``CRYSTALLUME_TOKEN``: capabilities, liveness and signing in.
PUBLIC_API_PATHS = frozenset({"/api/v1/info", "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/logout"})

_AUTH_REQUIRED = "authentication required: send 'Authorization: Bearer <token>'"


def _token_ok(token: str | None, required: str) -> bool:
    return bool(token) and hmac.compare_digest(token.encode("utf-8"), required.encode("utf-8"))


def _check_local_token(request: Request, token: str | None, required: str) -> None:
    """Accept the local-mode token, else answer 401 — or 429 while this client is locked out after
    too many failed sign-ins or wrong tokens (shared with ``/auth/login``, so guessing is just as slow)."""
    limiter, key = _limits(request)["login"], _client_key(request)
    if limiter.blocked(key):
        raise HTTPException(429, "too many failed sign-in attempts; try again in a few minutes",
                            headers={"Retry-After": str(int(limiter.window))})
    if _token_ok(token, required):
        return
    if token:  # a wrong guess (no token at all is just a signed-out request)
        limiter.fail(key)
    raise HTTPException(401, _AUTH_REQUIRED, headers={"WWW-Authenticate": "Bearer"})


def require_local_token(request: Request) -> None:
    """App-wide dependency: in local mode with ``CRYSTALLUME_TOKEN`` set, every API route
    except :data:`PUBLIC_API_PATHS` answers 401 without that token.  Plugin routes are
    covered too; static files (the web UI, plugin scripts) are not API routes.

    The header is read directly (not through ``HTTPBearer``) so the OpenAPI schema
    of the public routes stays unchanged.
    """
    required = _local_token(request)
    if not required:
        return
    # the matched URL path without a sub-path prefix (root_path); route objects of included
    # routers do not carry the /api/v1 prefix in every FastAPI version, the URL always does
    path, root = request.scope.get("path", ""), request.scope.get("root_path") or ""
    if root and path.startswith(root + "/"):
        path = path[len(root):]
    if path in PUBLIC_API_PATHS:
        return
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    token = value.strip() if scheme.lower() == "bearer" else ""
    _check_local_token(request, token or request.query_params.get("access_token"), required)


def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, Any]:
    """Dependency resolving the acting user (401 in cloud mode without a valid token)."""
    if request.app.state.settings.mode == "local":
        required = _local_token(request)
        if required:
            _check_local_token(request, bearer_token(request, creds), required)
        return LOCAL_USER
    token = bearer_token(request, creds)
    if not token:
        raise HTTPException(401, _AUTH_REQUIRED, headers={"WWW-Authenticate": "Bearer"})
    user = request.app.state.users.user_for_token(token)
    if user is None:
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201, summary="Create an account (cloud mode)")
def register(body: Credentials, request: Request) -> dict[str, Any]:
    """Register a new user and return an API token. Disabled when registration is off;
    limited to 5 attempts per hour and client address."""
    users = _users(request)
    if not request.app.state.settings.allow_registration:
        raise HTTPException(403, "registration is disabled on this server; ask an administrator for an account")
    limiter, key = _limits(request)["register"], _client_key(request)
    if limiter.blocked(key):
        raise HTTPException(429, "too many new accounts from this address; try again later")
    limiter.fail(key)  # every attempt counts
    try:
        user = users.create_user(body.username, body.password)
    except UserExists as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"token": users.create_token(user["id"]), "user": user}


@router.post("/login", response_model=AuthResponse, summary="Log in and obtain a token")
def login(body: Credentials, request: Request) -> dict[str, Any]:
    """Exchange username/password for an API token.

    In local mode with ``CRYSTALLUME_TOKEN`` set, sign in with username ``local``
    and the token as password; the token itself is returned.
    """
    limiter, key = _limits(request)["login"], _client_key(request)
    required = _local_token(request)
    if required is None:
        users = _users(request)
    if limiter.blocked(key):
        raise HTTPException(429, "too many failed login attempts; try again in a few minutes")
    if required is not None:
        ok = body.username.strip().lower() == "local" and hmac.compare_digest(
            body.password.encode("utf-8"), required.encode("utf-8"))
        if not ok:
            limiter.fail(key)
            raise HTTPException(401, "invalid username or password")
        limiter.reset(key)
        return {"token": required, "user": LOCAL_USER}
    user = users.authenticate(body.username, body.password)
    if user is None:
        limiter.fail(key)
        raise HTTPException(401, "invalid username or password")
    limiter.reset(key)
    return {"token": users.create_token(user["id"]), "user": user}


@router.post("/logout", response_model=OkResponse, response_model_exclude_none=True, summary="Revoke the current token")
def logout(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, Any]:
    """Revoke the bearer token used for this request (no-op in local mode)."""
    if request.app.state.settings.mode == "local":
        return {"ok": True}
    token = bearer_token(request, creds)
    if not token or request.app.state.users.user_for_token(token) is None:
        raise HTTPException(401, "not logged in", headers={"WWW-Authenticate": "Bearer"})
    request.app.state.users.revoke_token(token)
    return {"ok": True}


@router.get("/me", response_model=MeResponse, summary="Current user")
def me(request: Request, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    """The acting user, server mode and whether this server requires signing in
    (cloud mode, or local mode with ``CRYSTALLUME_TOKEN``)."""
    settings = request.app.state.settings
    return {"user": user, "mode": settings.mode, "authRequired": settings.mode == "cloud" or bool(_local_token(request))}
