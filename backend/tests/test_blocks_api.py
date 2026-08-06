from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_blocks_endpoint_returns_data_in_default_locale() -> None:
    response = client.get("/api/blocks")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert len(payload) > 0
    assert payload[0]["label"]
    assert "when_to_use" in payload[0]
    assert "template" in payload[0]
    assert payload[0]["template"]["type"] == payload[0]["type"]
    assert payload[0]["template"]["name"]


def test_blocks_endpoint_filters_by_query_keyword() -> None:
    response = client.get("/api/blocks", params={"q": "wifi connect", "locale": "en"})

    assert response.status_code == 200
    payload = response.json()
    assert any(item["type"] == "wifi_connect" for item in payload)
    assert all("wifi" in (item["label"] + item["description"] + item["adb_command"]).lower() for item in payload)


def test_blocks_endpoint_rejects_unsupported_locale() -> None:
    response = client.get("/api/blocks", params={"locale": "zh-CN"})

    assert response.status_code == 422


def test_blocks_endpoint_accepts_compatibility_query_params() -> None:
    response = client.get(
        "/api/blocks",
        params={
            "locale": "en",
            "q": "wifi",
            "include_condition": "false",
            "profile": "simple",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert all("type" in item and "label" in item for item in payload)
