from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.adb_service import AdbError, CommandResult, detect_wifi_candidates
from app.main import app


client = TestClient(app)


def test_detect_wifi_candidates_detected_single(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-2:] == ["ip", "route"]:
            return CommandResult(
                command=" ".join(argv),
                output=(
                    "default via 192.168.1.1 dev wlan0 proto dhcp src 192.168.1.23 metric 303\n"
                    "192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.23"
                ),
            )
        if argv[-1] == "ifconfig":
            return CommandResult(command=" ".join(argv), output="")
        raise AssertionError("unexpected command")

    monkeypatch.setattr("app.core.adb_service.run_adb_command", fake_run)

    result = detect_wifi_candidates(device_serial="USB123", port=5555, timeout_seconds=5)

    assert result.success is True
    assert result.status == "detected"
    assert result.selected_host == "192.168.1.23"
    assert result.selected_port == 5555
    assert len(result.candidates) == 1
    assert result.candidates[0].source == "ip_route"


def test_detect_wifi_candidates_ambiguous_multiple_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-2:] == ["ip", "route"]:
            return CommandResult(command=" ".join(argv), output="")
        if argv[-1] == "ifconfig":
            return CommandResult(
                command=" ".join(argv),
                output=(
                    "wlan0: flags=4163\n"
                    "    inet 192.168.1.23 netmask 255.255.255.0\n"
                    "eth0: flags=4163\n"
                    "    inet 10.0.0.20 netmask 255.255.255.0\n"
                ),
            )
        raise AssertionError("unexpected command")

    monkeypatch.setattr("app.core.adb_service.run_adb_command", fake_run)

    result = detect_wifi_candidates(device_serial="USB123", port=5555, timeout_seconds=5)

    assert result.success is False
    assert result.status == "ambiguous"
    assert result.reason_code == "ambiguous_network"
    assert result.selected_host is None
    assert len(result.candidates) == 2


def test_detect_wifi_candidates_failed_when_queries_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        raise AdbError("device offline")

    monkeypatch.setattr("app.core.adb_service.run_adb_command", fake_run)

    result = detect_wifi_candidates(device_serial="USB123", port=5555, timeout_seconds=5)

    assert result.success is False
    assert result.status == "failed"
    assert result.reason_code == "adb_command_failed"
    assert result.candidates == []


def test_wifi_detect_api_returns_response_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-2:] == ["ip", "route"]:
            return CommandResult(
                command=" ".join(argv),
                output="default via 192.168.1.1 dev wlan0 src 192.168.1.23",
            )
        if argv[-1] == "ifconfig":
            return CommandResult(command=" ".join(argv), output="")
        raise AssertionError("unexpected command")

    monkeypatch.setattr("app.core.adb_service.run_adb_command", fake_run)

    response = client.get("/api/wifi/detect", params={"device_serial": "USB123", "port": 5555})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "detected"
    assert payload["selected_host"] == "192.168.1.23"
    assert payload["selected_port"] == 5555
    assert payload["reason_code"] == "detected_single_candidate"
    assert payload["candidates"][0]["source"] == "ip_route"
