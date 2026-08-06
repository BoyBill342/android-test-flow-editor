from __future__ import annotations

import base64
from pathlib import Path

import pytest

from app.core.adb_service import AdbError, CommandResult
from app.core.device_explorer_service import DeviceExplorerError, list_directory, push_uploaded_file


def test_list_directory_sorts_directory_first(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="\n".join(
                [
                    "-rw-r--r-- 1 root root 12 2009-01-01 08:00 z_file.txt",
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 b_folder",
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 a_folder",
                    "-rw-r--r-- 1 root root 12 2009-01-01 08:00 a_file.txt",
                ]
            ),
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard")
    assert [item.name for item in result.items] == ["a_folder", "b_folder", "a_file.txt", "z_file.txt"]
    assert [item.item_type for item in result.items[:2]] == ["directory", "directory"]


def test_list_directory_fallbacks_to_ls_a_p_when_long_listing_unparsable(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        calls.append(argv)
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        if argv[5:7] == ["-lan", "/sdcard"]:
            return CommandResult(command=" ".join(argv), output="acct\napex\n")
        if argv[5:8] == ["-a", "-p", "/sdcard"]:
            return CommandResult(command=" ".join(argv), output=".\n..\nDownload/\ndemo.txt\n")
        raise AssertionError(f"Unexpected argv: {argv}")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard")
    assert [item.name for item in result.items] == ["Download", "demo.txt"]
    assert result.items[0].item_type == "directory"
    assert result.items[1].item_type == "file"
    assert any(cmd[5:7] == ["-lan", "/sdcard"] for cmd in calls)
    assert any(cmd[5:8] == ["-a", "-p", "/sdcard"] for cmd in calls)


def test_list_directory_supports_root_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        assert argv[-1] == "/"
        return CommandResult(
            command=" ".join(argv),
            output="\n".join(
                [
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 sdcard",
                    "-rw-r--r-- 1 root root 12 2009-01-01 08:00 init.rc",
                ]
            ),
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/")
    assert result.path == "/"
    assert [item.path for item in result.items] == ["/sdcard", "/init.rc"]


def test_list_directory_normalizes_duplicate_slashes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        calls.append(argv)
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="drwxr-xr-x 2 root root 4096 2009-01-01 08:00 Download",
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="//sdcard///")
    assert result.path == "/sdcard"
    assert any(cmd[-1] == "/sdcard" for cmd in calls if "ls" in cmd)


def test_list_directory_marks_invalid_entries_as_other(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="-rw-r--r-- 1 root root 12 2009-01-01 08:00 /?",
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/")
    assert len(result.items) == 1
    assert result.items[0].item_type == "other"
    assert result.items[0].is_valid is False
    assert result.items[0].invalid_reason


def test_list_directory_raises_offline_device_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            raise AdbError("error: device 'USB123' is offline")
        raise AssertionError("ls should not run when device is offline")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    with pytest.raises(DeviceExplorerError, match="DEVICE_OFFLINE"):
        list_directory(device_serial="USB123", path="/sdcard")


def test_list_directory_returns_denied_when_remote_path_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        raise AdbError("ls: /sdcard2: No such file or directory")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard2")
    assert result.path == "/sdcard2"
    assert result.permission_state == "denied"
    assert result.items == []
    assert "does not exist" in result.message


def test_list_directory_treats_symlink_entries_as_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="lrwxrwxrwx 1 root root 21 2009-01-01 08:00 sdcard -> /storage/self/primary",
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/")
    assert len(result.items) == 1
    assert result.items[0].name == "sdcard"
    assert result.items[0].item_type == "directory"
    assert result.items[0].path == "/sdcard"


def test_list_directory_skips_duplicate_self_symlink_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="\n".join(
                [
                    "lrwxrwxrwx 1 root root 21 2009-01-01 08:00 sdcard -> /storage/self/primary",
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 DCIM",
                ]
            ),
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard")
    assert [item.path for item in result.items] == ["/sdcard/DCIM"]


def test_list_directory_normalizes_absolute_entry_name_in_long_listing(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        return CommandResult(
            command=" ".join(argv),
            output="\n".join(
                [
                    "lrwxrwxrwx 1 root root 21 2009-01-01 08:00 /sdcard -> /storage/self/primary",
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 Alarms",
                    "drwxr-xr-x 2 root root 4096 2009-01-01 08:00 Android",
                ]
            ),
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard")
    assert [item.path for item in result.items] == ["/sdcard/Alarms", "/sdcard/Android"]


def test_list_directory_normalizes_absolute_entry_name_in_simple_listing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        calls.append(argv)
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        if argv[5:7] == ["-lan", "/sdcard"]:
            return CommandResult(command=" ".join(argv), output="")
        if argv[5:8] == ["-a", "-p", "/sdcard"]:
            return CommandResult(command=" ".join(argv), output="/sdcard/\n/sdcard/Alarms/\n")
        raise AssertionError(f"Unexpected argv: {argv}")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    result = list_directory(device_serial="USB123", path="/sdcard")
    assert [item.path for item in result.items] == ["/sdcard/Alarms"]
    assert any(cmd[5:8] == ["-a", "-p", "/sdcard"] for cmd in calls)


def test_push_uploaded_file_validates_and_pushes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    seen_paths: list[str] = []

    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        seen_paths.append(argv[4])
        return CommandResult(command=" ".join(argv), output="ok")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)

    payload = base64.b64encode(b"hello").decode("ascii")
    result = push_uploaded_file(
        device_serial="USB123",
        target_directory="/sdcard/Download",
        file_name="hello.txt",
        content_base64=payload,
    )

    assert result.operation == "push"
    assert "adb -s USB123 push" in result.command
    assert seen_paths


def test_push_uploaded_file_rejects_invalid_base64() -> None:
    with pytest.raises(DeviceExplorerError, match="valid base64"):
        push_uploaded_file(
            device_serial="USB123",
            target_directory="/sdcard/Download",
            file_name="hello.txt",
            content_base64="%%%%",
        )


def test_push_uploaded_file_rejects_invalid_file_name() -> None:
    payload = base64.b64encode(b"hello").decode("ascii")
    with pytest.raises(DeviceExplorerError, match="file name is invalid"):
        push_uploaded_file(
            device_serial="USB123",
            target_directory="/sdcard/Download",
            file_name="../evil.txt",
            content_base64=payload,
        )


def test_push_uploaded_file_wraps_adb_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        raise AdbError("push failed")

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)
    payload = base64.b64encode(b"hello").decode("ascii")

    with pytest.raises(DeviceExplorerError, match="push failed"):
        push_uploaded_file(
            device_serial="USB123",
            target_directory="/sdcard/Download",
            file_name="hello.txt",
            content_base64=payload,
        )


def test_push_uploaded_file_maps_read_only_error_without_temp_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
        if argv[-1] == "get-state":
            return CommandResult(command=" ".join(argv), output="device")
        raise AdbError(
            "C:\\Users\\bill\\AppData\\Local\\Temp\\adb_upload_demo.txt: 1 file pushed, 0 skipped. "
            "adb: error: failed to copy 'C:\\Users\\bill\\AppData\\Local\\Temp\\adb_upload_demo.txt' "
            "to '/demo.txt': remote couldn't create file: Read-only file system"
        )

    monkeypatch.setattr("app.core.device_explorer_service.run_adb_command", fake_run_adb_command)
    payload = base64.b64encode(b"hello").decode("ascii")

    with pytest.raises(DeviceExplorerError) as exc_info:
        push_uploaded_file(
            device_serial="USB123",
            target_directory="/",
            file_name="demo.txt",
            content_base64=payload,
        )

    message = str(exc_info.value)
    assert "read-only" in message.lower()
    assert "/sdcard" in message
    assert "AppData" not in message