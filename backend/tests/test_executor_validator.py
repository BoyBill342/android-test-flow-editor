from __future__ import annotations

import pytest

from app.core.adb_service import CommandResult
from app.core.command_validator import ValidationError, validate_custom_command
from app.core.executor import (
    _ensure_device_target,
    _trim_output,
    build_step_command,
    execute_steps,
)
from app.models.schemas import FlowStep


def _step(step_type: str, **params: object) -> FlowStep:
    return FlowStep(type=step_type, name=step_type, params=params)


def test_validate_custom_command_rejects_empty() -> None:
    with pytest.raises(ValidationError, match="empty"):
        validate_custom_command("   ", experimental_shell=False)


def test_validate_custom_command_rejects_forbidden_metacharacters() -> None:
    with pytest.raises(ValidationError, match="forbidden shell metacharacters"):
        validate_custom_command("adb shell getprop; whoami", experimental_shell=False)


def test_validate_custom_command_rejects_non_adb_in_restricted_mode() -> None:
    with pytest.raises(ValidationError, match="Only adb-prefixed"):
        validate_custom_command("echo hello", experimental_shell=False)


def test_validate_custom_command_accepts_adb_shell_with_device_option() -> None:
    result = validate_custom_command(
        "adb -s emulator-5554 shell getprop ro.product.model",
        experimental_shell=False,
    )
    assert result.argv[:4] == ["adb", "-s", "emulator-5554", "shell"]


def test_validate_custom_command_rejects_disallowed_adb_subcommand() -> None:
    with pytest.raises(ValidationError, match="allows only adb subcommands"):
        validate_custom_command("adb install app.apk", experimental_shell=False)


def test_validate_custom_command_allows_non_adb_in_experimental_shell() -> None:
    result = validate_custom_command("echo hello", experimental_shell=True)
    assert result.argv == ["echo", "hello"]


def test_ensure_device_target_injects_serial_for_device_command() -> None:
    argv = _ensure_device_target(["adb", "shell", "id"], "USB123")
    assert argv == ["adb", "-s", "USB123", "shell", "id"]


def test_ensure_device_target_keeps_global_command_untouched() -> None:
    argv = _ensure_device_target(["adb", "devices"], "USB123")
    assert argv == ["adb", "devices"]


def test_build_step_command_wifi_connect_rejects_public_ip() -> None:
    with pytest.raises(ValidationError, match="private-network IP"):
        build_step_command(
            "USB123",
            _step("wifi_connect", host="8.8.8.8", port=5555),
            experimental_shell=False,
        )


def test_build_step_command_wifi_connect_accepts_private_ipv4() -> None:
    command = build_step_command(
        "USB123",
        _step("wifi_connect", host="192.168.1.10", port=5555),
        experimental_shell=False,
    )
    assert command == ["adb", "connect", "192.168.1.10:5555"]


def test_build_step_command_wifi_connect_rejects_ipv6_private_address() -> None:
    with pytest.raises(ValidationError, match="private-network IPv4"):
        build_step_command(
            "USB123",
            _step("wifi_connect", host="fd00::1", port=5555),
            experimental_shell=False,
        )


def test_build_step_command_keyevent_preset_mode() -> None:
    command = build_step_command(
        "USB123",
        _step("keyevent", mode="preset", preset="KEYCODE_BACK"),
        experimental_shell=False,
    )
    assert command[-1] == "KEYCODE_BACK"


def test_build_step_command_keyevent_custom_mode_numeric() -> None:
    command = build_step_command(
        "USB123",
        _step("keyevent", mode="custom", custom_keycode="4"),
        experimental_shell=False,
    )
    assert command[-1] == "4"


def test_build_step_command_keyevent_rejects_invalid_custom() -> None:
    with pytest.raises(ValidationError, match="keyevent expects"):
        build_step_command(
            "USB123",
            _step("keyevent", mode="custom", custom_keycode="HOME; rm -rf /"),
            experimental_shell=False,
        )


def test_build_step_command_screenshot_supports_custom_save_path() -> None:
    command = build_step_command(
        "USB123",
        _step("screenshot", save_path="/sdcard/DCIM", filename="case1.png"),
        experimental_shell=False,
    )
    assert command[:6] == ["adb", "-s", "USB123", "shell", "screencap", "-p"]
    assert command[-1] == "/sdcard/DCIM/case1.png"


def test_build_step_command_screenshot_rejects_invalid_path() -> None:
    with pytest.raises(ValidationError, match="unsupported characters|Path traversal"):
        build_step_command(
            "USB123",
            _step("screenshot", save_path="/sdcard/../data"),
            experimental_shell=False,
        )


def test_trim_output_truncates_and_appends_marker() -> None:
    trimmed = _trim_output("x" * 12, max_chars=5)
    assert trimmed.startswith("xxxxx")
    assert "[truncated:" in trimmed


def test_execute_steps_wait_for_property_success(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        return CommandResult(command=" ".join(argv), output="1")

    monkeypatch.setattr("app.core.executor.run_adb_command", fake_run_adb_command)

    steps = [_step("wait_for_property", property="sys.boot_completed", expected="1")]
    results, success, message = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=30,
    )

    assert success is True
    assert message == "Flow executed successfully."
    assert len(results) == 1
    assert results[0].success is True
    assert "getprop sys.boot_completed" in results[0].command


def test_execute_steps_wifi_connect_switches_target_for_next_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    wifi_target = "192.168.1.10:5555"

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        calls.append(argv)
        if argv[:2] == ["adb", "connect"]:
            return CommandResult(command=" ".join(argv), output=f"connected to {wifi_target}")
        if argv == ["adb", "-s", wifi_target, "get-state"]:
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(command=" ".join(argv), output="ok")

    monkeypatch.setattr("app.core.executor.run_adb_command", fake_run_adb_command)

    steps = [
        _step("wifi_connect", host="192.168.1.10", port=5555),
        _step("tap", x=7, y=9),
    ]

    results, success, message = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=30,
    )

    assert success is True
    assert message == "Flow executed successfully."
    assert len(results) == 2
    assert results[0].success is True
    assert "[verify] adb -s 192.168.1.10:5555 get-state" in results[0].output

    assert ["adb", "connect", "192.168.1.10:5555"] in calls
    assert ["adb", "-s", "192.168.1.10:5555", "get-state"] in calls
    assert ["adb", "-s", "192.168.1.10:5555", "shell", "input", "tap", "7", "9"] in calls


def test_execute_steps_flow_timeout_before_step_execution() -> None:
    steps = [_step("tap", x=1, y=2)]

    results, success, message = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=-1,
    )

    assert success is False
    assert "timed out" in message
    assert len(results) == 1
    assert results[0].success is False
    assert "Flow timeout reached" in results[0].output


def test_execute_steps_returns_failure_when_adb_command_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        raise ValueError("boom")

    monkeypatch.setattr("app.core.executor.run_adb_command", failing_run_adb_command)

    steps = [_step("tap", x=10, y=20)]
    results, success, message = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=30,
    )

    assert success is False
    assert message == "Failed at step 1: tap"
    assert len(results) == 1
    assert results[0].success is False
    assert results[0].command == "adb -s USB123 shell input tap 10 20"
    assert "boom" in results[0].output


def test_execute_steps_wifi_connect_verification_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[:2] == ["adb", "connect"]:
            return CommandResult(command=" ".join(argv), output="connected")
        if argv[:3] == ["adb", "-s", "192.168.1.10:5555"] and argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="offline")
        return CommandResult(command=" ".join(argv), output="ok")

    monkeypatch.setattr("app.core.executor.run_adb_command", fake_run_adb_command)

    steps = [_step("wifi_connect", host="192.168.1.10", port=5555)]
    results, success, message = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=30,
    )

    assert success is False
    assert message == "Failed at step 1: wifi_connect"
    assert len(results) == 1
    assert results[0].success is False
    assert "verification failed" in results[0].output.lower()


def test_execute_steps_custom_command_auto_inserts_device_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[list[str]] = []

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        seen.append(argv)
        return CommandResult(command=" ".join(argv), output="ok")

    monkeypatch.setattr("app.core.executor.run_adb_command", fake_run_adb_command)

    steps = [_step("custom_command", command="adb shell getprop ro.build.version.release")]
    results, success, _ = execute_steps(
        device_serial="USB123",
        steps=steps,
        experimental_shell=False,
        command_timeout_seconds=5,
        flow_timeout_seconds=30,
    )

    assert success is True
    assert results[0].success is True
    assert seen[0] == ["adb", "-s", "USB123", "shell", "getprop", "ro.build.version.release"]
