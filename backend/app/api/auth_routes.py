from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.core.auth import create_session_token, revoke_session_token, verify_password
from app.core.logging_config import get_logger

logger = get_logger("auth.routes")

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


def _get_auth_config() -> tuple[str, str]:
    """Return (expected_username, expected_password) from environment only."""
    username = os.environ.get("LOGIN_USERNAME", "").strip()
    password = os.environ.get("LOGIN_PASSWORD", "").strip()
    return username, password

# ---------------------------------------------------------------------------
# In-process rate limiter (per remote IP)
# ---------------------------------------------------------------------------

_RATE_LIMIT_MAX_ATTEMPTS: int = 5
_RATE_LIMIT_WINDOW_SECONDS: int = 900  # 15 minutes

_attempt_lock: Lock = Lock()
_attempts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    with _attempt_lock:
        _attempts[ip] = [t for t in _attempts[ip] if now - t < _RATE_LIMIT_WINDOW_SECONDS]
        if len(_attempts[ip]) >= _RATE_LIMIT_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
            )


def _record_failure(ip: str) -> None:
    with _attempt_lock:
        _attempts[ip].append(time.monotonic())


def _clear_failures(ip: str) -> None:
    with _attempt_lock:
        _attempts.pop(ip, None)


def _reset_rate_limit_for_tests() -> None:
    """Test-only helper to clear in-memory login rate-limit state."""
    with _attempt_lock:
        _attempts.clear()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "session"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@auth_router.post("/login", response_model=TokenResponse)
async def login(request: Request, body: LoginRequest) -> TokenResponse:
    """
    Authenticate with username + password and return an opaque session token.

    Security properties:
    - Rate-limited: 5 failed attempts per IP locks out for 15 minutes.
    - Constant-time password comparison to prevent timing-based enumeration.
    - Failure responses are identical regardless of whether the username or
      password is wrong, preventing enumeration.
    - Credentials are NEVER written to any log.
    """
    client_ip: str = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    expected_username, expected_password = _get_auth_config()
    if not expected_username or not expected_password:
        logger.error("login_rejected_missing_auth_config ip=%s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Login is not configured on this server.",
        )

    username_ok: bool = verify_password(body.username, expected_username)
    password_ok: bool = verify_password(body.password, expected_password)

    if not (username_ok and password_ok):
        _record_failure(client_ip)
        logger.warning("login_failed ip=%s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )

    _clear_failures(client_ip)
    token = create_session_token(body.username)
    logger.info("login_success ip=%s", client_ip)
    return TokenResponse(access_token=token)


class LogoutRequest(BaseModel):
    token: str = ""


@auth_router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(body: LogoutRequest) -> dict[str, str]:
    """
    Revoke the session token so it can no longer authenticate requests.
    """
    if body.token:
        revoke_session_token(body.token)
    return {"message": "Logged out."}
