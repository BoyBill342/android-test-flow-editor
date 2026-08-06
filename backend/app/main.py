from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import protected_router, router
from app.core.logging_config import get_logger, setup_logging

setup_logging()
logger = get_logger("api")


def _read_flag(key: str, default: str = "") -> str:
    """Read a single flag from env var, falling back to flags.txt."""
    val = os.environ.get(key, "").strip()
    if val:
        return val
    flags_file = Path(__file__).parent.parent.parent / "scripts" / "start-windows.flags.txt"
    try:
        if flags_file.exists():
            for raw in flags_file.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == key:
                    return v.strip()
    except Exception:
        pass
    return default


_ENABLE_LOGIN: bool = _read_flag("ENABLE_LOGIN", "0") == "1"

app = FastAPI(title="Android Test Flow Editor", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Always mount public router (health check, no auth required)
app.include_router(router)

if _ENABLE_LOGIN:
    from app.core.auth import require_auth  # noqa: F401
    from fastapi import Depends

    from app.api.auth_routes import auth_router

    app.include_router(auth_router)
    # Protected routes require a valid session token
    app.include_router(protected_router, dependencies=[Depends(require_auth)])
    logger.info("startup auth_enabled=true")
else:
    app.include_router(protected_router)
    logger.info("startup auth_enabled=false")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex[:12]
    started = perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - started) * 1000
        logger.exception(
            "request_failed request_id=%s method=%s path=%s duration_ms=%.2f",
            request_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response
