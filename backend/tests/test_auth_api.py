from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.auth_routes import auth_router, _reset_rate_limit_for_tests
from app.api.routes import protected_router
from app.core.auth import _reset_sessions_for_tests, require_auth


def _build_auth_test_client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(protected_router, dependencies=[Depends(require_auth)])
    return TestClient(app)


def _set_auth_env(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_USERNAME", "admin")
    monkeypatch.setenv("LOGIN_PASSWORD", "pass123")


def _mock_devices(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.list_devices",
        lambda: [
            {
                "serial": "USB123",
                "state": "device",
                "device_name": "Pixel",
            }
        ],
    )


def setup_function() -> None:
    _reset_sessions_for_tests()
    _reset_rate_limit_for_tests()


def test_login_success_returns_session_token(monkeypatch) -> None:
    _set_auth_env(monkeypatch)
    client = _build_auth_test_client()

    response = client.post("/api/auth/login", json={"username": "admin", "password": "pass123"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "session"
    assert isinstance(payload["access_token"], str)
    assert payload["access_token"]


def test_login_rejects_invalid_credentials(monkeypatch) -> None:
    _set_auth_env(monkeypatch)
    client = _build_auth_test_client()

    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_login_rate_limit_after_failed_attempts(monkeypatch) -> None:
    _set_auth_env(monkeypatch)
    client = _build_auth_test_client()

    for _ in range(5):
        response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert response.status_code == 401

    blocked = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert blocked.status_code == 429


def test_login_missing_auth_config_returns_503(monkeypatch) -> None:
    monkeypatch.delenv("LOGIN_USERNAME", raising=False)
    monkeypatch.delenv("LOGIN_PASSWORD", raising=False)
    client = _build_auth_test_client()

    response = client.post("/api/auth/login", json={"username": "admin", "password": "pass123"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Login is not configured on this server."


def test_protected_route_requires_token(monkeypatch) -> None:
    _set_auth_env(monkeypatch)
    _mock_devices(monkeypatch)
    client = _build_auth_test_client()

    response = client.get("/api/devices")

    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_logout_revokes_session_token(monkeypatch) -> None:
    _set_auth_env(monkeypatch)
    _mock_devices(monkeypatch)
    client = _build_auth_test_client()

    login_response = client.post("/api/auth/login", json={"username": "admin", "password": "pass123"})
    token = login_response.json()["access_token"]

    ok_response = client.get("/api/devices", headers={"Authorization": f"Bearer {token}"})
    assert ok_response.status_code == 200

    logout_response = client.post("/api/auth/logout", json={"token": token})
    assert logout_response.status_code == 200

    rejected_response = client.get("/api/devices", headers={"Authorization": f"Bearer {token}"})
    assert rejected_response.status_code == 401
