from __future__ import annotations

import secrets
from threading import Lock

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.logging_config import get_logger

logger = get_logger("auth")

_bearer_scheme = HTTPBearer(auto_error=False)

# In-memory set of active session tokens.
# Each login issues one opaque token; logout removes it.
_session_lock: Lock = Lock()
_active_sessions: set[str] = set()


def verify_password(plain: str, stored: str) -> bool:
    """
    Constant-time plaintext password comparison.
    NEVER log *plain* or *stored*.
    """
    try:
        return secrets.compare_digest(
            plain.encode("utf-8"),
            stored.encode("utf-8"),
        )
    except Exception:
        return False


def create_session_token(username: str) -> str:  # noqa: ARG001
    """Create a cryptographically random opaque session token and register it."""
    token = secrets.token_urlsafe(32)
    with _session_lock:
        _active_sessions.add(token)
    return token


def revoke_session_token(token: str) -> None:
    """Remove a session token, effectively logging out the holder."""
    with _session_lock:
        _active_sessions.discard(token)


def _reset_sessions_for_tests() -> None:
    """Test-only helper to clear in-memory auth sessions."""
    with _session_lock:
        _active_sessions.clear()


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """
    FastAPI dependency — validates the opaque session token on every protected request.

    Raises HTTP 401 if the token is absent or not in the active session set.
    Never reveals the reason for rejection to the caller.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    with _session_lock:
        valid = credentials.credentials in _active_sessions
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )
    return credentials.credentials
