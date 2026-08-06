from __future__ import annotations

import base64
import tempfile
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from app.core.adb_service import AdbError
from app.core.device_explorer_service import (
    BatchOperationItemResult,
    BatchOperationResult,
    DeviceExplorerError,
    ExplorerItemData,
    ExplorerListData,
    OperationResult,
)
from app.core.log_export_service import ExportArtifact, ServerLogEntryData, ServerLogStreamData
from app.main import app


client = TestClient(app)


def test_logs_download_returns_zip(monkeypatch) -> None:
    tmp = tempfile.NamedTemporaryFile(prefix="test_logs_", suffix=".zip", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    with zipfile.ZipFile(tmp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("logs_chunk_001.log", "line\n")

    def fake_export_logs(last_hours: int, levels: list[str], keyword: str, max_chunk_size_mb: int) -> ExportArtifact:
        return ExportArtifact(
            file_path=tmp_path,
            file_name="export.zip",
            total_lines=10,
            exported_lines=1,
            chunk_count=1,
            from_timestamp="2026-08-01 00:00:00",
            to_timestamp="2026-08-01 00:01:00",
        )

    monkeypatch.setattr("app.api.routes.export_logs", fake_export_logs)

    response = client.get("/api/logs/download", params={"last_hours": 4})

    assert response.status_code == 200
    assert "application/zip" in response.headers["content-type"]


def test_explorer_list_returns_denied_as_empty(monkeypatch) -> None:
    def fake_list_directory(device_serial: str, path: str) -> ExplorerListData:
        return ExplorerListData(
            path=path,
            items=[],
            permission_state="denied",
            message="Path is not readable with current device permissions.",
        )

    monkeypatch.setattr("app.api.routes.list_directory", fake_list_directory)

    response = client.get("/api/explorer/list", params={"device_serial": "USB123", "path": "/data"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["permission_state"] == "denied"
    assert payload["items"] == []


def test_explorer_list_returns_readable_items(monkeypatch) -> None:
    def fake_list_directory(device_serial: str, path: str) -> ExplorerListData:
        return ExplorerListData(
            path=path,
            items=[
                ExplorerItemData(
                    name="Download",
                    path="/sdcard/Download",
                    item_type="directory",
                    size=0,
                    mtime="Aug 04 09:30",
                    permission_state="readable",
                )
            ],
            permission_state="readable",
            message="OK",
        )

    monkeypatch.setattr("app.api.routes.list_directory", fake_list_directory)

    response = client.get("/api/explorer/list", params={"device_serial": "USB123", "path": "/sdcard"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["name"] == "Download"
    assert payload["items"][0]["item_type"] == "directory"
    assert payload["items"][0]["mtime"] == "Aug 04 09:30"
    assert payload["items"][0]["is_valid"] is True
    assert payload["items"][0]["invalid_reason"] == ""


def test_explorer_list_maps_device_offline_to_409(monkeypatch) -> None:
    def fake_list_directory(device_serial: str, path: str) -> ExplorerListData:
        raise DeviceExplorerError(
            "DEVICE_OFFLINE: Device 'USB123' is offline. Reconnect the device and refresh before file operations."
        )

    monkeypatch.setattr("app.api.routes.list_directory", fake_list_directory)

    response = client.get("/api/explorer/list", params={"device_serial": "USB123", "path": "/sdcard"})

    assert response.status_code == 409
    assert response.json()["detail"].startswith("DEVICE_OFFLINE:")


def test_explorer_list_defaults_to_root_path(monkeypatch) -> None:
    def fake_list_directory(device_serial: str, path: str) -> ExplorerListData:
        assert path == "/"
        return ExplorerListData(
            path=path,
            items=[],
            permission_state="readable",
            message="OK",
        )

    monkeypatch.setattr("app.api.routes.list_directory", fake_list_directory)

    response = client.get("/api/explorer/list", params={"device_serial": "USB123"})

    assert response.status_code == 200
    assert response.json()["path"] == "/"


def test_explorer_listen_start_and_stop(monkeypatch) -> None:
    class Session:
        def __init__(self, session_id: str, path: str, listening: bool) -> None:
            self.session_id = session_id
            self.path = path
            self.listening = listening

    def fake_start(device_serial: str, path: str):
        return Session(session_id="abc123", path=path, listening=True)

    def fake_stop(session_id: str):
        return Session(session_id=session_id, path="/sdcard", listening=False)

    monkeypatch.setattr("app.api.routes.start_listen", fake_start)
    monkeypatch.setattr("app.api.routes.stop_listen", fake_stop)

    start = client.post("/api/explorer/listen/start", json={"device_serial": "USB123", "path": "/sdcard"})
    assert start.status_code == 200
    assert start.json()["listening"] is True

    stop = client.post("/api/explorer/listen/stop", json={"session_id": "abc123"})
    assert stop.status_code == 200
    assert stop.json()["listening"] is False


def test_explorer_operation_validation_error(monkeypatch) -> None:
    def fake_run_operation(operation: str, device_serial: str, source_path: str, target_path: str, name: str) -> OperationResult:
        raise DeviceExplorerError("invalid path")

    monkeypatch.setattr("app.api.routes.run_operation", fake_run_operation)

    response = client.post(
        "/api/explorer/ops/delete",
        json={"device_serial": "USB123", "source_path": "/sdcard/test.txt"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid path"


def test_explorer_batch_operation_success(monkeypatch) -> None:
    def fake_run_batch_operation(
        operation: str,
        device_serial: str,
        source_paths: list[str],
        target_path: str,
        continue_on_error: bool,
    ) -> BatchOperationResult:
        assert operation == "delete"
        assert device_serial == "USB123"
        assert source_paths == ["/sdcard/a.txt", "/sdcard/b.txt"]
        assert continue_on_error is True
        return BatchOperationResult(
            operation="delete",
            results=[
                BatchOperationItemResult(
                    source_path="/sdcard/a.txt",
                    success=True,
                    message="Delete completed.",
                    command="adb ... rm a",
                ),
                BatchOperationItemResult(
                    source_path="/sdcard/b.txt",
                    success=True,
                    message="Delete completed.",
                    command="adb ... rm b",
                ),
            ],
            total_count=2,
            success_count=2,
            failure_count=0,
            message="Batch delete completed: 2 succeeded, 0 failed.",
        )

    monkeypatch.setattr("app.api.routes.run_batch_operation", fake_run_batch_operation)

    response = client.post(
        "/api/explorer/ops/batch",
        json={
            "device_serial": "USB123",
            "operation": "delete",
            "source_paths": ["/sdcard/a.txt", "/sdcard/b.txt"],
            "continue_on_error": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["total_count"] == 2
    assert payload["success_count"] == 2
    assert payload["failure_count"] == 0


def test_explorer_batch_operation_partial_failure(monkeypatch) -> None:
    def fake_run_batch_operation(
        operation: str,
        device_serial: str,
        source_paths: list[str],
        target_path: str,
        continue_on_error: bool,
    ) -> BatchOperationResult:
        return BatchOperationResult(
            operation="pull",
            results=[
                BatchOperationItemResult(
                    source_path="/sdcard/a.txt",
                    success=True,
                    message="Pull completed.",
                    command="adb ... pull a",
                ),
                BatchOperationItemResult(
                    source_path="/sdcard/b.txt",
                    success=False,
                    message="permission denied",
                    command="",
                ),
            ],
            total_count=2,
            success_count=1,
            failure_count=1,
            message="Batch pull completed: 1 succeeded, 1 failed.",
        )

    monkeypatch.setattr("app.api.routes.run_batch_operation", fake_run_batch_operation)

    response = client.post(
        "/api/explorer/ops/batch",
        json={
            "device_serial": "USB123",
            "operation": "pull",
            "source_paths": ["/sdcard/a.txt", "/sdcard/b.txt"],
            "target_path": "./downloads",
            "continue_on_error": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["success_count"] == 1
    assert payload["failure_count"] == 1
    assert payload["results"][1]["message"] == "permission denied"


def test_explorer_batch_operation_validation_error(monkeypatch) -> None:
    def fake_run_batch_operation(
        operation: str,
        device_serial: str,
        source_paths: list[str],
        target_path: str,
        continue_on_error: bool,
    ) -> BatchOperationResult:
        raise DeviceExplorerError("Batch operation only supports pull or delete.")

    monkeypatch.setattr("app.api.routes.run_batch_operation", fake_run_batch_operation)

    response = client.post(
        "/api/explorer/ops/batch",
        json={
            "device_serial": "USB123",
            "operation": "delete",
            "source_paths": ["/sdcard/a.txt"],
            "continue_on_error": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Batch operation only supports pull or delete."


def test_explorer_upload_success(monkeypatch) -> None:
    def fake_push_uploaded_file(
        device_serial: str,
        target_directory: str,
        file_name: str,
        content_base64: str,
    ) -> OperationResult:
        assert device_serial == "USB123"
        assert target_directory == "/sdcard/Download"
        assert file_name == "demo.txt"
        assert content_base64
        return OperationResult(
            operation="push",
            message="Push completed.",
            command="adb -s USB123 push C:/tmp/demo.txt /sdcard/Download/demo.txt",
        )

    monkeypatch.setattr("app.api.routes.push_uploaded_file", fake_push_uploaded_file)

    response = client.post(
        "/api/explorer/upload",
        json={
            "device_serial": "USB123",
            "target_directory": "//sdcard///Download//",
            "file_name": "demo.txt",
            "content_base64": "aGVsbG8=",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True


def test_list_third_party_packages(monkeypatch) -> None:
    def fake_list_third_party_packages(device_serial: str) -> list[str]:
        assert device_serial == "USB123"
        return ["com.example.alpha", "com.example.beta"]

    monkeypatch.setattr("app.api.routes.list_third_party_packages", fake_list_third_party_packages)

    response = client.get("/api/apps/third-party-packages", params={"device_serial": "USB123"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["packages"] == [
        {"package": "com.example.alpha"},
        {"package": "com.example.beta"},
    ]


def test_devices_endpoint_hides_internal_adb_error(monkeypatch) -> None:
    def fake_list_devices() -> list[dict[str, str]]:
        raise AdbError("adb failed: C:/secret/device/path")

    monkeypatch.setattr("app.api.routes.list_devices", fake_list_devices)

    response = client.get("/api/devices")

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to list devices."


def test_logs_stream_hides_internal_os_error(monkeypatch) -> None:
    def fake_stream_server_logs(
        cursor: int,
        limit: int,
        keyword: str,
        levels: list[str],
        max_buffer_lines: int,
    ) -> ServerLogStreamData:
        raise OSError("open C:/very-secret/app.log failed")

    monkeypatch.setattr("app.api.routes.stream_server_logs", fake_stream_server_logs)

    response = client.get("/api/logs/stream")

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to stream logs."


def test_upload_apk_success() -> None:
    apk_bytes = b"fake-apk-binary"
    response = client.post(
        "/api/apk/upload",
        json={
            "file_name": "demo.apk",
            "content_base64": base64.b64encode(apk_bytes).decode("ascii"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["host_path"].endswith(".apk")


def test_upload_apk_stream_success() -> None:
    response = client.post(
        "/api/apk/upload-file",
        files={"apk_file": ("demo.apk", b"fake-apk-binary", "application/vnd.android.package-archive")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["host_path"].endswith(".apk")


def test_explorer_upload_validation_error(monkeypatch) -> None:
    def fake_push_uploaded_file(
        device_serial: str,
        target_directory: str,
        file_name: str,
        content_base64: str,
    ) -> OperationResult:
        raise DeviceExplorerError("Upload content is not valid base64.")

    monkeypatch.setattr("app.api.routes.push_uploaded_file", fake_push_uploaded_file)

    response = client.post(
        "/api/explorer/upload",
        json={
            "device_serial": "USB123",
            "target_directory": "/sdcard/Download",
            "file_name": "demo.txt",
            "content_base64": "%%%",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Upload content is not valid base64."


def test_explorer_upload_read_only_error_is_clean(monkeypatch) -> None:
    def fake_push_uploaded_file(
        device_serial: str,
        target_directory: str,
        file_name: str,
        content_base64: str,
    ) -> OperationResult:
        raise DeviceExplorerError(
            "Target directory '/' is read-only. Choose a writable directory such as /sdcard or /sdcard/Download."
        )

    monkeypatch.setattr("app.api.routes.push_uploaded_file", fake_push_uploaded_file)

    response = client.post(
        "/api/explorer/upload",
        json={
            "device_serial": "USB123",
            "target_directory": "/",
            "file_name": "demo.txt",
            "content_base64": "aGVsbG8=",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "read-only" in detail.lower()
    assert "/sdcard" in detail
    assert "AppData" not in detail


def test_logs_stream_returns_cursor_payload(monkeypatch) -> None:
    def fake_stream_server_logs(
        cursor: int,
        limit: int,
        keyword: str,
        levels: list[str],
        max_buffer_lines: int,
    ) -> ServerLogStreamData:
        assert cursor == 10
        assert limit == 50
        assert keyword == "wifi"
        assert levels == ["INFO", "ERROR"]
        assert max_buffer_lines == 300
        return ServerLogStreamData(
            items=[
                ServerLogEntryData(
                    timestamp="2026-08-04 09:00:00",
                    level="INFO",
                    logger="adb_editor.api",
                    message="wifi connected",
                )
            ],
            next_cursor=11,
            has_more=False,
            dropped_count=4,
            total_available=20,
        )

    monkeypatch.setattr("app.api.routes.stream_server_logs", fake_stream_server_logs)

    response = client.get(
        "/api/logs/stream",
        params={
            "cursor": 10,
            "limit": 50,
            "keyword": "wifi",
            "levels": ["INFO", "ERROR"],
            "max_buffer_lines": 300,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["next_cursor"] == 11
    assert payload["has_more"] is False
    assert payload["dropped_count"] == 4
    assert payload["total_available"] == 20
    assert payload["items"][0]["message"] == "wifi connected"
