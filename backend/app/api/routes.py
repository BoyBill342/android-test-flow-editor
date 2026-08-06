from __future__ import annotations

import base64
import binascii
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.adb_service import AdbError, detect_wifi_candidates, list_devices, list_third_party_packages
from app.core.block_catalog import list_block_definitions
from app.core.device_explorer_service import (
    DeviceExplorerError,
    list_directory,
    push_local_file,
    push_uploaded_file,
    run_batch_operation,
    run_operation,
    start_listen,
    stop_listen,
    validate_device_path,
)
from app.core.executor import execute_steps
from app.core.log_export_service import export_logs, stream_server_logs
from app.core.logging_config import get_logger, mask_device_identifier
from app.models.schemas import (
    BlockDefinition,
    ApkUploadRequest,
    ApkUploadResponse,
    AppPackageItem,
    AppPackagesResponse,
    DeviceInfo,
    ExecuteFlowRequest,
    ExecuteFlowResponse,
    ExplorerBatchOperationItemResult,
    ExplorerBatchOperationRequest,
    ExplorerBatchOperationResponse,
    ExplorerItem,
    ExplorerListResponse,
    ExplorerListenRequest,
    ExplorerListenResponse,
    ExplorerListenStopRequest,
    ExplorerOperationRequest,
    ExplorerOperationResponse,
    ExplorerUploadRequest,
    ExplorerUploadResponse,
    LogExportInfo,
    ServerLogEntry,
    ServerLogsStreamResponse,
    WifiDetectCandidate,
    WifiDetectResponse,
)

router = APIRouter(prefix="/api", tags=["mvp"])
protected_router = APIRouter(prefix="/api", tags=["mvp"])

logger = get_logger("api.routes")
_APK_UPLOAD_DIR = Path(tempfile.gettempdir()) / "adb_editor_apk_uploads"
_SCREENSHOT_ARTIFACT_DIR = Path(tempfile.gettempdir()) / "adb_editor_web_artifacts" / "screenshots"


def _raise_internal_server_error(message: str = "Internal server error.") -> None:
    raise HTTPException(status_code=500, detail=message)


def _cleanup_old_files(base_dir: Path, ttl_hours: int = 24) -> None:
    if not base_dir.exists():
        return
    cutoff = datetime.now() - timedelta(hours=max(1, ttl_hours))
    for file_path in base_dir.glob("**/*"):
        if not file_path.is_file():
            continue
        try:
            modified = datetime.fromtimestamp(file_path.stat().st_mtime)
        except OSError:
            continue
        if modified < cutoff:
            file_path.unlink(missing_ok=True)


def _raise_explorer_http_error(exc: DeviceExplorerError) -> None:
    detail = str(exc)
    if detail == "Listen session not found.":
        raise HTTPException(status_code=404, detail=detail) from exc
    if detail.startswith("DEVICE_OFFLINE:"):
        raise HTTPException(status_code=409, detail=detail) from exc
    if detail.startswith("DEVICE_NOT_FOUND:"):
        raise HTTPException(status_code=404, detail=detail) from exc
    if detail.startswith("DEVICE_UNAUTHORIZED:"):
        raise HTTPException(status_code=403, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/health")
def health() -> dict:
    import os

    logger.debug("health_check")
    return {"status": "ok", "auth_enabled": os.environ.get("ENABLE_LOGIN", "0").strip() == "1"}


@protected_router.get("/devices", response_model=list[DeviceInfo])
def devices() -> list[DeviceInfo]:
    try:
        items = [DeviceInfo(**item) for item in list_devices()]
        logger.info("devices_listed count=%s", len(items))
        return items
    except AdbError as exc:
        logger.exception("devices_list_failed")
        _raise_internal_server_error("Failed to list devices.")


@protected_router.get("/blocks", response_model=list[BlockDefinition])
def blocks(
    locale: Literal["en", "zh-TW"] = Query(default="zh-TW"),
    q: str = Query(default="", max_length=100),
    include_condition: bool = Query(default=True),
    profile: Literal["full", "simple"] = Query(default="full"),
) -> list[BlockDefinition]:
    # Keep query params for API compatibility; current catalog implementation does not branch by them.
    _ = include_condition, profile
    items = [
        BlockDefinition(**item)
        for item in list_block_definitions(
            locale=locale,
            query=q,
        )
    ]
    logger.info(
        "blocks_listed locale=%s include_condition=%s profile=%s query_len=%s count=%s",
        locale,
        include_condition,
        profile,
        len(q),
        len(items),
    )
    return items


@protected_router.post("/flows/execute", response_model=ExecuteFlowResponse)
def execute_flow(payload: ExecuteFlowRequest) -> ExecuteFlowResponse:
    flow_id = uuid4().hex[:10]
    logger.info(
        "flow_started flow_id=%s device=%s step_count=%s experimental_shell=%s command_timeout=%s flow_timeout=%s",
        flow_id,
        mask_device_identifier(payload.device_serial),
        len(payload.steps),
        payload.enable_experimental_shell,
        payload.command_timeout_seconds,
        payload.flow_timeout_seconds,
    )

    results, success, message = execute_steps(
        device_serial=payload.device_serial,
        steps=payload.steps,
        experimental_shell=payload.enable_experimental_shell,
        command_timeout_seconds=payload.command_timeout_seconds,
        flow_timeout_seconds=payload.flow_timeout_seconds,
        flow_id=flow_id,
    )
    logger.info(
        "flow_finished flow_id=%s success=%s result_count=%s message=%s",
        flow_id,
        success,
        len(results),
        message,
    )
    return ExecuteFlowResponse(success=success, results=results, message=message)


@protected_router.get("/apps/third-party-packages", response_model=AppPackagesResponse)
def list_installed_third_party_packages(
    device_serial: str = Query(min_length=1, max_length=128),
) -> AppPackagesResponse:
    try:
        packages = list_third_party_packages(device_serial)
    except AdbError as exc:
        logger.exception("apps_third_party_list_failed")
        _raise_internal_server_error("Failed to list third-party packages.")

    return AppPackagesResponse(
        success=True,
        packages=[AppPackageItem(package=name) for name in packages],
        message="ok",
    )


@protected_router.post("/apk/upload", response_model=ApkUploadResponse)
def upload_apk_file(payload: ApkUploadRequest) -> ApkUploadResponse:
    _APK_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_files(_APK_UPLOAD_DIR, ttl_hours=24)

    safe_name = Path(payload.file_name).name.strip()
    if not safe_name.lower().endswith(".apk"):
        raise HTTPException(status_code=400, detail="Only .apk file is supported.")

    upload_id = uuid4().hex
    save_path = _APK_UPLOAD_DIR / f"{upload_id}_{safe_name}"

    try:
        binary_data = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 payload.") from exc

    if len(binary_data) == 0:
        raise HTTPException(status_code=400, detail="APK file is empty.")

    if len(binary_data) > 500 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="APK file exceeds 500MB limit.")

    try:
        save_path.write_bytes(binary_data)
    except OSError as exc:
        logger.exception("apk_upload_write_failed")
        raise HTTPException(status_code=500, detail="Failed to save uploaded APK.") from exc

    return ApkUploadResponse(
        success=True,
        host_path=str(save_path),
        message="APK uploaded successfully.",
    )


@protected_router.post("/apk/upload-file", response_model=ApkUploadResponse)
async def upload_apk_file_stream(apk_file: UploadFile = File(...)) -> ApkUploadResponse:
    _APK_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_files(_APK_UPLOAD_DIR, ttl_hours=24)

    safe_name = Path(apk_file.filename or "").name.strip()
    if not safe_name.lower().endswith(".apk"):
        raise HTTPException(status_code=400, detail="Only .apk file is supported.")

    upload_id = uuid4().hex
    save_path = _APK_UPLOAD_DIR / f"{upload_id}_{safe_name}"
    total_bytes = 0
    chunk_size = 2 * 1024 * 1024

    try:
        with save_path.open("wb") as output_file:
            while True:
                chunk = await apk_file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > 500 * 1024 * 1024:
                    output_file.close()
                    save_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=400, detail="APK file exceeds 500MB limit.")
                output_file.write(chunk)
    except HTTPException:
        raise
    except OSError as exc:
        logger.exception("apk_stream_upload_write_failed")
        raise HTTPException(status_code=500, detail="Failed to save uploaded APK.") from exc
    finally:
        await apk_file.close()

    if total_bytes == 0:
        save_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="APK file is empty.")

    return ApkUploadResponse(
        success=True,
        host_path=str(save_path),
        message="APK uploaded successfully.",
    )


@protected_router.post("/explorer/upload-file", response_model=ExplorerUploadResponse)
async def explorer_upload_file(
    device_serial: str = Form(...),
    target_directory: str = Form(...),
    upload_file: UploadFile = File(...),
) -> ExplorerUploadResponse:
    _APK_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_files(_APK_UPLOAD_DIR, ttl_hours=24)

    safe_name = Path(upload_file.filename or "").name.strip()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Upload file name is invalid.")

    suffix = Path(safe_name).suffix
    temp_path = _APK_UPLOAD_DIR / f"explorer_{uuid4().hex}{suffix}"
    total_bytes = 0
    chunk_size = 2 * 1024 * 1024

    try:
        with temp_path.open("wb") as output_file:
            while True:
                chunk = await upload_file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > 500 * 1024 * 1024:
                    output_file.close()
                    temp_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=400, detail="Upload file exceeds 500MB limit.")
                output_file.write(chunk)
    except HTTPException:
        raise
    except OSError as exc:
        logger.exception("explorer_upload_file_write_failed")
        raise HTTPException(status_code=500, detail="Failed to save upload file.") from exc
    finally:
        await upload_file.close()

    if total_bytes == 0:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Upload file is empty.")

    safe_target_directory = validate_device_path(target_directory)
    try:
        result = push_local_file(
            device_serial=device_serial,
            target_directory=safe_target_directory,
            local_file_path=str(temp_path),
            file_name=safe_name,
        )
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)
    except AdbError as exc:
        logger.exception("explorer_upload_file_push_failed")
        raise HTTPException(status_code=500, detail="Upload push failed unexpectedly.") from exc
    finally:
        temp_path.unlink(missing_ok=True)

    remote_path = f"{safe_target_directory.rstrip('/')}/{safe_name}"
    return ExplorerUploadResponse(
        success=True,
        message="Upload and push completed.",
        remote_path=remote_path,
        command=result.command,
    )


@protected_router.get("/artifacts/screenshot")
def get_screenshot_artifact(name: str = Query(min_length=1, max_length=255)) -> FileResponse:
    _cleanup_old_files(_SCREENSHOT_ARTIFACT_DIR, ttl_hours=24)
    safe_name = Path(name).name
    if safe_name != name:
        raise HTTPException(status_code=400, detail="Invalid artifact name.")

    target = _SCREENSHOT_ARTIFACT_DIR / safe_name
    try:
        resolved = target.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Screenshot artifact not found.") from exc

    artifact_root = _SCREENSHOT_ARTIFACT_DIR.resolve()
    if artifact_root not in resolved.parents and resolved != artifact_root:
        raise HTTPException(status_code=400, detail="Invalid artifact path.")

    media_type = "image/png"
    lower = safe_name.lower()
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        media_type = "image/jpeg"
    elif lower.endswith(".webp"):
        media_type = "image/webp"

    return FileResponse(path=str(resolved), media_type=media_type, filename=safe_name)


@protected_router.get("/wifi/detect", response_model=WifiDetectResponse)
def detect_wifi_target(
    device_serial: str = Query(min_length=1, max_length=128),
    port: int = Query(default=5555, ge=1, le=65535),
    timeout_seconds: int = Query(default=8, ge=1, le=20),
) -> WifiDetectResponse:
    try:
        result = detect_wifi_candidates(
            device_serial=device_serial,
            port=port,
            timeout_seconds=timeout_seconds,
        )
    except AdbError as exc:
        logger.exception("wifi_detect_failed_unexpected device=%s", mask_device_identifier(device_serial))
        _raise_internal_server_error("WiFi detect failed.")

    logger.info(
        "wifi_detect_finished device=%s status=%s candidates=%s reason=%s",
        mask_device_identifier(device_serial),
        result.status,
        len(result.candidates),
        result.reason_code,
    )
    return WifiDetectResponse(
        success=result.success,
        status=result.status,
        selected_host=result.selected_host,
        selected_port=result.selected_port,
        candidates=[
            WifiDetectCandidate(
                host=item.host,
                port=item.port,
                interface=item.interface,
                gateway=item.gateway,
                source=item.source,
            )
            for item in result.candidates
        ],
        reason_code=result.reason_code,
        message=result.message,
    )


@protected_router.get("/logs/export", response_model=LogExportInfo)
def export_logs_info(
    background_tasks: BackgroundTasks,
    last_hours: int = Query(default=24, ge=1, le=24 * 30),
    levels: list[str] = Query(default=[]),
    keyword: str = Query(default="", max_length=120),
    max_chunk_size_mb: int = Query(default=10, ge=1, le=200),
) -> LogExportInfo:
    try:
        artifact = export_logs(
            last_hours=last_hours,
            levels=levels,
            keyword=keyword,
            max_chunk_size_mb=max_chunk_size_mb,
        )
    except OSError as exc:
        logger.exception("logs_export_failed")
        _raise_internal_server_error("Failed to export logs.")

    def _cleanup(path: str) -> None:
        from pathlib import Path

        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            logger.warning("logs_export_cleanup_failed path=%s", path)

    background_tasks.add_task(_cleanup, str(artifact.file_path))
    return LogExportInfo(
        file_name=artifact.file_name,
        total_lines=artifact.total_lines,
        exported_lines=artifact.exported_lines,
        chunk_count=artifact.chunk_count,
        max_chunk_size_mb=max_chunk_size_mb,
        from_timestamp=artifact.from_timestamp,
        to_timestamp=artifact.to_timestamp,
        levels=levels,
        keyword=keyword,
    )


@protected_router.get("/logs/download")
def download_logs(
    background_tasks: BackgroundTasks,
    last_hours: int = Query(default=24, ge=1, le=24 * 30),
    levels: list[str] = Query(default=[]),
    keyword: str = Query(default="", max_length=120),
    max_chunk_size_mb: int = Query(default=10, ge=1, le=200),
) -> FileResponse:
    try:
        artifact = export_logs(
            last_hours=last_hours,
            levels=levels,
            keyword=keyword,
            max_chunk_size_mb=max_chunk_size_mb,
        )
    except OSError as exc:
        logger.exception("logs_download_failed")
        _raise_internal_server_error("Failed to prepare log download.")

    def _cleanup(path: str) -> None:
        from pathlib import Path

        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            logger.warning("logs_download_cleanup_failed path=%s", path)

    background_tasks.add_task(_cleanup, str(artifact.file_path))
    media_type = "application/zip" if artifact.file_name.lower().endswith(".zip") else "text/plain; charset=utf-8"
    return FileResponse(path=str(artifact.file_path), media_type=media_type, filename=artifact.file_name)


@protected_router.get("/explorer/list", response_model=ExplorerListResponse)
def explorer_list(
    device_serial: str = Query(min_length=1, max_length=128),
    path: str = Query(default="/", min_length=0, max_length=512),
) -> ExplorerListResponse:
    try:
        normalized_path = path.strip() or "/"
        result = list_directory(device_serial=device_serial, path=normalized_path)
    except DeviceExplorerError as exc:
        logger.exception("explorer_list_failed")
        _raise_explorer_http_error(exc)

    return ExplorerListResponse(
        success=True,
        path=result.path,
        items=[
            ExplorerItem(
                name=item.name,
                path=item.path,
                item_type=item.item_type,
                size=item.size,
                mtime=item.mtime,
                permission_state=item.permission_state,
                is_valid=item.is_valid,
                invalid_reason=item.invalid_reason,
            )
            for item in result.items
        ],
        permission_state=result.permission_state,
        message=result.message,
    )


@protected_router.post("/explorer/listen/start", response_model=ExplorerListenResponse)
def explorer_listen_start(payload: ExplorerListenRequest) -> ExplorerListenResponse:
    try:
        session = start_listen(device_serial=payload.device_serial, path=payload.path)
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)

    return ExplorerListenResponse(
        success=True,
        session_id=session.session_id,
        listening=session.listening,
        path=session.path,
        message="Listen started.",
        refresh_policy="manual",
    )


@protected_router.post("/explorer/listen/stop", response_model=ExplorerListenResponse)
def explorer_listen_stop(payload: ExplorerListenStopRequest) -> ExplorerListenResponse:
    try:
        session = stop_listen(payload.session_id)
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)

    return ExplorerListenResponse(
        success=True,
        session_id=session.session_id,
        listening=session.listening,
        path=session.path,
        message="Listen stopped.",
        refresh_policy="manual",
    )


@protected_router.post("/explorer/upload", response_model=ExplorerUploadResponse)
def explorer_upload(payload: ExplorerUploadRequest) -> ExplorerUploadResponse:
    safe_target_directory = validate_device_path(payload.target_directory)
    try:
        result = push_uploaded_file(
            device_serial=payload.device_serial,
            target_directory=safe_target_directory,
            file_name=payload.file_name,
            content_base64=payload.content_base64,
        )
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)
    except AdbError as exc:
        logger.exception("explorer_upload_failed")
        raise HTTPException(status_code=500, detail="Upload push failed unexpectedly.") from exc

    remote_path = f"{safe_target_directory.rstrip('/')}/{payload.file_name.strip()}"
    return ExplorerUploadResponse(
        success=True,
        message="Upload and push completed.",
        remote_path=remote_path,
        command=result.command,
    )


@protected_router.post("/explorer/ops/batch", response_model=ExplorerBatchOperationResponse)
def explorer_batch_operation(payload: ExplorerBatchOperationRequest) -> ExplorerBatchOperationResponse:
    try:
        result = run_batch_operation(
            operation=payload.operation,
            device_serial=payload.device_serial,
            source_paths=payload.source_paths,
            target_path=payload.target_path,
            continue_on_error=payload.continue_on_error,
        )
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)
    except AdbError as exc:
        logger.exception("explorer_batch_operation_failed")
        _raise_internal_server_error("Batch operation failed unexpectedly.")

    return ExplorerBatchOperationResponse(
        success=result.failure_count == 0,
        operation=result.operation,
        results=[
            ExplorerBatchOperationItemResult(
                source_path=item.source_path,
                success=item.success,
                message=item.message,
                command=item.command,
            )
            for item in result.results
        ],
        total_count=result.total_count,
        success_count=result.success_count,
        failure_count=result.failure_count,
        message=result.message,
    )


@protected_router.post("/explorer/ops/{operation}", response_model=ExplorerOperationResponse)
def explorer_operation(operation: str, payload: ExplorerOperationRequest) -> ExplorerOperationResponse:
    try:
        result = run_operation(
            operation=operation,
            device_serial=payload.device_serial,
            source_path=payload.source_path,
            target_path=payload.target_path,
            name=payload.name,
        )
    except DeviceExplorerError as exc:
        _raise_explorer_http_error(exc)
    except AdbError as exc:
        logger.exception("explorer_operation_failed operation=%s", operation)
        _raise_internal_server_error("Explorer operation failed unexpectedly.")

    return ExplorerOperationResponse(
        success=True,
        operation=result.operation,  # type: ignore[arg-type]
        message=result.message,
        command=result.command,
    )


@protected_router.get("/logs/stream", response_model=ServerLogsStreamResponse)
def stream_logs(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=2000),
    keyword: str = Query(default="", max_length=120),
    levels: list[str] = Query(default=[]),
    max_buffer_lines: int = Query(default=500, ge=1, le=5000),
) -> ServerLogsStreamResponse:
    try:
        result = stream_server_logs(
            cursor=cursor,
            limit=limit,
            keyword=keyword,
            levels=levels,
            max_buffer_lines=max_buffer_lines,
        )
    except OSError as exc:
        logger.exception("logs_stream_failed")
        _raise_internal_server_error("Failed to stream logs.")

    return ServerLogsStreamResponse(
        success=True,
        items=[
            ServerLogEntry(
                timestamp=item.timestamp,
                level=item.level,
                logger=item.logger,
                message=item.message,
            )
            for item in result.items
        ],
        next_cursor=result.next_cursor,
        has_more=result.has_more,
        dropped_count=result.dropped_count,
        total_available=result.total_available,
    )
