"""Authentication: bearer-token dependency and the ``/api/v1/auth`` routes.

* **local** mode — no authentication; every request acts as the implicit user
  ``{"id": "local", "username": "local"}``.
* **cloud** mode — project routes require ``Authorization: Bearer <token>``
  (or ``?access_token=`` for plain links such as downloads).  Tokens come from
  ``/auth/register`` or ``/auth/login`` and are revoked by ``/auth/logout``.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..storage.sqlite import SQLiteStore, UserExists
from .models import AuthResponse, Credentials, MeResponse, OkResponse

__all__ = ["LOCAL_USER", "router", "current_user", "bearer_token"]

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


_limiter = _RateLimiter()


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


def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, Any]:
    """Dependency resolving the acting user (401 in cloud mode without a valid token)."""
    if request.app.state.settings.mode == "local":
        return LOCAL_USER
    token = bearer_token(request, creds)
    if not token:
        raise HTTPException(401, "authentication required: send 'Authorization: Bearer <token>'",
                            headers={"WWW-Authenticate": "Bearer"})
    user = request.app.state.users.user_for_token(token)
    if user is None:
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201, summary="Create an account (cloud mode)")
def register(body: Credentials, request: Request) -> dict[str, Any]:
    """Register a new user and return an API token. Disabled when registration is off."""
    users = _users(request)
    if not request.app.state.settings.allow_registration:
        raise HTTPException(403, "registration is disabled on this server; ask an administrator for an account")
    try:
        user = users.create_user(body.username, body.password)
    except UserExists as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"token": users.create_token(user["id"]), "user": user}


@router.post("/login", response_model=AuthResponse, summary="Log in and obtain a token")
def login(body: Credentials, request: Request) -> dict[str, Any]:
    """Exchange username/password for an API token."""
    users = _users(request)
    key = request.client.host if request.client else "unknown"
    if _limiter.blocked(key):
        raise HTTPException(429, "too many failed login attempts; try again in a few minutes")
    user = users.authenticate(body.username, body.password)
    if user is None:
        _limiter.fail(key)
        raise HTTPException(401, "invalid username or password")
    _limiter.reset(key)
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
    """The acting user and server mode (local mode needs no token)."""
    return {"user": user, "mode": request.app.state.settings.mode}
