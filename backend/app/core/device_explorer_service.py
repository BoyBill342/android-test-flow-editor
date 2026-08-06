from __future__ import annotations

import base64
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

from app.core.adb_service import AdbError, CommandResult, run_adb_command
from app.core.logging_config import get_logger

_DEVICE_PATH_PATTERN = re.compile(r"^/[A-Za-z0-9._/-]{0,511}$")
_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,255}$")
_UPLOAD_FILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_MAX_UPLOAD_BYTES = 500 * 1024 * 1024

logger = get_logger("device_explorer_service")


class DeviceExplorerError(Exception):
    pass


@dataclass(frozen=True)
class ExplorerItemData:
    name: str
    path: str
    item_type: str
    size: int
    mtime: str
    permission_state: str
    is_valid: bool = True
    invalid_reason: str = ""


@dataclass(frozen=True)
class ExplorerListData:
    path: str
    items: list[ExplorerItemData]
    permission_state: str
    message: str


@dataclass(frozen=True)
class OperationResult:
    operation: str
    message: str
    command: str


@dataclass(frozen=True)
class BatchOperationItemResult:
    source_path: str
    success: bool
    message: str
    command: str


@dataclass(frozen=True)
class BatchOperationResult:
    operation: Literal["pull", "delete"]
    results: list[BatchOperationItemResult]
    total_count: int
    success_count: int
    failure_count: int
    message: str


@dataclass
class _ListenSession:
    session_id: str
    device_serial: str
    path: str
    listening: bool


_LISTEN_SESSIONS: dict[str, _ListenSession] = {}


def _is_permission_denied(output: str) -> bool:
    lowered = output.lower()
    return "permission denied" in lowered or "operation not permitted" in lowered


def _is_read_only_filesystem(output: str) -> bool:
    return "read-only file system" in output.lower()


def _is_missing_remote_directory(output: str) -> bool:
    lowered = output.lower()
    return "no such file or directory" in lowered or "failed to stat remote object" in lowered


def _normalize_device_path(path: str) -> str:
    cleaned = path.strip().replace("\\", "/")
    if not cleaned:
        raise DeviceExplorerError("Path is required.")
    if not cleaned.startswith("/"):
        cleaned = f"/{cleaned}"
    cleaned = re.sub(r"/{2,}", "/", cleaned)

    parts = cleaned.split("/")
    if any(part == ".." for part in parts):
        raise DeviceExplorerError("Path traversal is not allowed.")

    if cleaned != "/":
        cleaned = cleaned.rstrip("/")

    if not cleaned:
        cleaned = "/"
    return cleaned


def _map_device_state_error(device_serial: str, output: str) -> DeviceExplorerError:
    lowered = output.lower()
    if "device offline" in lowered or " offline" in lowered:
        return DeviceExplorerError(
            f"DEVICE_OFFLINE: Device '{device_serial}' is offline. Reconnect the device and refresh before file operations."
        )

    if "device not found" in lowered or "not found" in lowered or "no devices/emulators found" in lowered:
        return DeviceExplorerError(
            f"DEVICE_NOT_FOUND: Device '{device_serial}' is not available. Connect the device and refresh before file operations."
        )

    if "unauthorized" in lowered:
        return DeviceExplorerError(
            f"DEVICE_UNAUTHORIZED: Device '{device_serial}' is unauthorized. Confirm USB debugging authorization on device."
        )

    return DeviceExplorerError(output)


def _ensure_device_ready(device_serial: str) -> None:
    last_error_output = ""
    for _ in range(2):
        try:
            result = run_adb_command(["adb", "-s", device_serial, "get-state"], timeout_seconds=6)
        except AdbError as exc:
            last_error_output = str(exc)
            continue

        state = result.output.strip().lower()
        if state == "device":
            return

        last_error_output = result.output

    lowered = last_error_output.lower().strip()
    if lowered in {"", "unknown"}:
        raise DeviceExplorerError(
            f"DEVICE_OFFLINE: Device '{device_serial}' state is unstable right now. Refresh and retry file operations."
        )

    raise _map_device_state_error(device_serial=device_serial, output=last_error_output)


def _map_upload_push_error(output: str, target_directory: str) -> str:
    if _is_read_only_filesystem(output):
        return (
            f"Target directory '{target_directory}' is read-only. "
            "Choose a writable directory such as /sdcard or /sdcard/Download."
        )

    if _is_missing_remote_directory(output):
        return (
            f"Target directory '{target_directory}' does not exist or is not writable. "
            "Choose a valid writable directory such as /sdcard or /sdcard/Download."
        )

    if _is_permission_denied(output):
        return (
            f"Target directory '{target_directory}' is not writable with current device permissions. "
            "Try a writable directory such as /sdcard or /sdcard/Download."
        )

    return "Upload push failed. Check the target directory and try again."


def validate_device_path(path: str) -> str:
    cleaned = _normalize_device_path(path)
    if not _DEVICE_PATH_PATTERN.fullmatch(cleaned):
        raise DeviceExplorerError("Path contains unsupported characters.")
    return cleaned


def _derive_item_path(base_path: str, name: str) -> tuple[str, bool, str]:
    candidate = f"{base_path.rstrip('/')}/{name}"
    if base_path == "/":
        candidate = f"/{name}"

    if not name or name.startswith("/") or "\\" in name:
        return candidate, False, "Invalid entry name."

    try:
        normalized = validate_device_path(candidate)
    except DeviceExplorerError as exc:
        return candidate, False, str(exc)

    return normalized, True, ""


def _is_duplicate_self_reference(base_path: str, name: str, is_symlink: bool) -> bool:
    """Drop symlink rows that point to a repeated current-folder name (e.g. /sdcard -> sdcard)."""
    if not is_symlink or base_path == "/":
        return False
    base_name = base_path.rsplit("/", 1)[-1]
    return bool(base_name) and name == base_name


def _normalize_ls_entry_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        return ""

    # Some Android shells may emit absolute/relative paths in ls rows.
    # File names cannot contain '/', so use basename for stable path derivation.
    cleaned = cleaned.rstrip("/")
    if "/" in cleaned:
        cleaned = cleaned.rsplit("/", 1)[-1]
    return cleaned


def _validate_local_path(path: str, must_exist: bool) -> str:
    raw = path.strip()
    if not raw:
        raise DeviceExplorerError("Local path is required.")

    target = Path(raw).expanduser()
    if must_exist and not target.exists():
        raise DeviceExplorerError(f"Local path does not exist: {target}")

    if target.is_dir() and must_exist:
        return str(target)
    if not must_exist:
        return str(target)

    return str(target)


def _parse_ls_output(base_path: str, output: str) -> list[ExplorerItemData]:
    items: list[ExplorerItemData] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("total "):
            continue

        parts = line.split(maxsplit=8)
        if len(parts) < 6:
            continue

        mode = parts[0]
        size_text = parts[4] if len(parts) >= 5 else "0"

        # Symlink rows can appear as: "... <date> <time> name -> /target"
        # With split(maxsplit=8), the trailing token becomes "-> /target" and
        # the real entry name is at index 7.
        if mode.startswith("l") and len(parts) >= 9 and parts[8].startswith("-> "):
            mtime = " ".join(parts[5:7]) if len(parts) >= 7 else ""
            name = parts[7]
        else:
            mtime = " ".join(parts[5:8]) if len(parts) >= 8 else ""
            name = parts[8] if len(parts) >= 9 else parts[-1]
        if " -> " in name:
            name = name.split(" -> ", 1)[0]
        name = _normalize_ls_entry_name(name)
        if name in {".", ".."}:
            continue
        if _is_duplicate_self_reference(base_path=base_path, name=name, is_symlink=mode.startswith("l")):
            continue

        item_type = "other"
        if mode.startswith("d"):
            item_type = "directory"
        elif mode.startswith("-"):
            item_type = "file"
        elif mode.startswith("l"):
            # Android root paths like /sdcard are often symlinks to writable storage.
            # Treat symlinks as directory-like entries so they remain visible and navigable.
            item_type = "directory"

        try:
            size = max(0, int(size_text))
        except ValueError:
            size = 0

        item_path, is_valid, invalid_reason = _derive_item_path(base_path=base_path, name=name)
        safe_item_type = item_type if is_valid else "other"
        items.append(
            ExplorerItemData(
                name=name,
                path=item_path,
                item_type=safe_item_type,
                size=size,
                mtime=mtime,
                permission_state="readable",
                is_valid=is_valid,
                invalid_reason=invalid_reason,
            )
        )

    return items


def _parse_ls_simple_output(base_path: str, output: str) -> list[ExplorerItemData]:
    items: list[ExplorerItemData] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line in {".", ".."}:
            continue

        is_directory = line.endswith("/")
        clean_name = line[:-1] if is_directory else line
        clean_name = _normalize_ls_entry_name(clean_name)
        if not clean_name or clean_name in {".", ".."}:
            continue
        if base_path != "/" and clean_name == base_path.rsplit("/", 1)[-1]:
            continue

        item_path, is_valid, invalid_reason = _derive_item_path(base_path=base_path, name=clean_name)
        safe_item_type = "directory" if is_directory else "file"
        if not is_valid:
            safe_item_type = "other"
        items.append(
            ExplorerItemData(
                name=clean_name,
                path=item_path,
                item_type=safe_item_type,
                size=0,
                mtime="",
                permission_state="readable",
                is_valid=is_valid,
                invalid_reason=invalid_reason,
            )
        )
    return items


def _sort_items(items: list[ExplorerItemData]) -> list[ExplorerItemData]:
    rank = {"directory": 0, "file": 1, "other": 2}
    return sorted(items, key=lambda item: (rank.get(item.item_type, 3), item.name.lower()))


def list_directory(device_serial: str, path: str) -> ExplorerListData:
    _ensure_device_ready(device_serial=device_serial)
    safe_path = validate_device_path(path)
    argv = ["adb", "-s", device_serial, "shell", "ls", "-lan", safe_path]

    try:
        result = run_adb_command(argv, timeout_seconds=15)
    except AdbError as exc:
        output = str(exc)
        if _is_missing_remote_directory(output):
            return ExplorerListData(
                path=safe_path,
                items=[],
                permission_state="denied",
                message="Path does not exist on device.",
            )
        if _is_permission_denied(output):
            return ExplorerListData(
                path=safe_path,
                items=[],
                permission_state="denied",
                message="Path is not readable with current device permissions.",
            )
        raise DeviceExplorerError(output) from exc

    items = _parse_ls_output(safe_path, result.output)
    if not items:
        # Some Android shells return malformed metadata for ls -la/-lan. Fall back to name-only listing.
        try:
            fallback = run_adb_command(
                ["adb", "-s", device_serial, "shell", "ls", "-a", "-p", safe_path],
                timeout_seconds=15,
            )
            items = _parse_ls_simple_output(safe_path, fallback.output)
        except AdbError as exc:
            raise DeviceExplorerError(str(exc)) from exc

    return ExplorerListData(
        path=safe_path,
        items=_sort_items(items),
        permission_state="readable",
        message="OK",
    )


def start_listen(device_serial: str, path: str) -> _ListenSession:
    _ensure_device_ready(device_serial=device_serial)
    safe_path = validate_device_path(path)
    session = _ListenSession(
        session_id=uuid4().hex,
        device_serial=device_serial,
        path=safe_path,
        listening=True,
    )
    _LISTEN_SESSIONS[session.session_id] = session
    return session


def stop_listen(session_id: str) -> _ListenSession:
    session = _LISTEN_SESSIONS.get(session_id)
    if session is None:
        raise DeviceExplorerError("Listen session not found.")
    session.listening = False
    return session


def run_operation(operation: str, device_serial: str, source_path: str, target_path: str, name: str) -> OperationResult:
    _ensure_device_ready(device_serial=device_serial)
    op = operation.strip().lower()

    if op == "delete":
        safe_source = validate_device_path(source_path)
        result = run_adb_command(["adb", "-s", device_serial, "shell", "rm", "-rf", safe_source], timeout_seconds=30)
        return OperationResult(operation=op, message="Delete completed.", command=result.command)

    if op == "mkdir":
        safe_target = validate_device_path(target_path)
        result = run_adb_command(["adb", "-s", device_serial, "shell", "mkdir", "-p", safe_target], timeout_seconds=30)
        return OperationResult(operation=op, message="Directory created.", command=result.command)

    if op == "rename":
        safe_source = validate_device_path(source_path)
        safe_name = name.strip()
        if not _NAME_PATTERN.fullmatch(safe_name):
            raise DeviceExplorerError("Rename target name is invalid.")
        base = safe_source.rsplit("/", 1)[0] if "/" in safe_source else "/"
        safe_target = f"{base}/{safe_name}" if base else f"/{safe_name}"
        result = run_adb_command(["adb", "-s", device_serial, "shell", "mv", safe_source, safe_target], timeout_seconds=30)
        return OperationResult(operation=op, message="Rename completed.", command=result.command)

    if op == "pull":
        safe_source = validate_device_path(source_path)
        safe_target = _validate_local_path(target_path, must_exist=False)
        result = run_adb_command(["adb", "-s", device_serial, "pull", safe_source, safe_target], timeout_seconds=120)
        return OperationResult(operation=op, message="Pull completed.", command=result.command)

    if op == "push":
        safe_source = _validate_local_path(source_path, must_exist=True)
        safe_target = validate_device_path(target_path)
        result = run_adb_command(["adb", "-s", device_serial, "push", safe_source, safe_target], timeout_seconds=120)
        return OperationResult(operation=op, message="Push completed.", command=result.command)

    raise DeviceExplorerError("Unsupported operation.")


def run_batch_operation(
    operation: str,
    device_serial: str,
    source_paths: list[str],
    target_path: str,
    continue_on_error: bool = True,
) -> BatchOperationResult:
    _ensure_device_ready(device_serial=device_serial)
    op = operation.strip().lower()
    if op not in {"pull", "delete"}:
        raise DeviceExplorerError("Batch operation only supports pull or delete.")

    if not source_paths:
        raise DeviceExplorerError("At least one source path is required.")

    normalized_target = ""
    if op == "pull":
        normalized_target = _validate_local_path(target_path, must_exist=False)

    results: list[BatchOperationItemResult] = []
    success_count = 0

    for raw_source in source_paths:
        try:
            safe_source = validate_device_path(raw_source)
            if op == "delete":
                command_result = run_adb_command(
                    ["adb", "-s", device_serial, "shell", "rm", "-rf", safe_source],
                    timeout_seconds=30,
                )
                results.append(
                    BatchOperationItemResult(
                        source_path=safe_source,
                        success=True,
                        message="Delete completed.",
                        command=command_result.command,
                    )
                )
            else:
                command_result = run_adb_command(
                    ["adb", "-s", device_serial, "pull", safe_source, normalized_target],
                    timeout_seconds=120,
                )
                results.append(
                    BatchOperationItemResult(
                        source_path=safe_source,
                        success=True,
                        message="Pull completed.",
                        command=command_result.command,
                    )
                )
            success_count += 1
        except (DeviceExplorerError, AdbError) as exc:
            source_display = raw_source.strip() or raw_source
            results.append(
                BatchOperationItemResult(
                    source_path=source_display,
                    success=False,
                    message=str(exc),
                    command="",
                )
            )
            if not continue_on_error:
                break

    total_count = len(results)
    failure_count = total_count - success_count
    summary = f"Batch {op} completed: {success_count} succeeded, {failure_count} failed."

    return BatchOperationResult(
        operation=op,
        results=results,
        total_count=total_count,
        success_count=success_count,
        failure_count=failure_count,
        message=summary,
    )


def push_uploaded_file(
    device_serial: str,
    target_directory: str,
    file_name: str,
    content_base64: str,
) -> OperationResult:
    safe_directory = validate_device_path(target_directory)
    normalized_name = file_name.strip()
    if not _UPLOAD_FILE_NAME_PATTERN.fullmatch(normalized_name):
        raise DeviceExplorerError("Upload file name is invalid.")

    try:
        file_bytes = base64.b64decode(content_base64, validate=True)
    except ValueError as exc:
        raise DeviceExplorerError("Upload content is not valid base64.") from exc

    if len(file_bytes) == 0:
        raise DeviceExplorerError("Upload file is empty.")
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise DeviceExplorerError("Upload file exceeds 20MB limit.")

    _ensure_device_ready(device_serial=device_serial)

    suffix = Path(normalized_name).suffix
    temp_path = Path("")
    try:
        with tempfile.NamedTemporaryFile(prefix="adb_upload_", suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            temp_path = Path(tmp.name)

        remote_path = f"{safe_directory.rstrip('/')}/{normalized_name}"
        result = run_adb_command(
            ["adb", "-s", device_serial, "push", str(temp_path), remote_path],
            timeout_seconds=120,
        )
        return OperationResult(
            operation="push",
            message="Push completed.",
            command=result.command,
        )
    except AdbError as exc:
        logger.warning(
            "explorer_upload_push_failed device=%s target=%s remote_path=%s detail=%s",
            device_serial,
            safe_directory,
            remote_path,
            str(exc)[:500],
        )
        raise DeviceExplorerError(_map_upload_push_error(str(exc), safe_directory)) from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def push_local_file(
    device_serial: str,
    target_directory: str,
    local_file_path: str,
    file_name: str,
) -> OperationResult:
    safe_directory = validate_device_path(target_directory)
    normalized_name = file_name.strip()
    if not _UPLOAD_FILE_NAME_PATTERN.fullmatch(normalized_name):
        raise DeviceExplorerError("Upload file name is invalid.")

    source = Path(local_file_path)
    if not source.exists() or not source.is_file():
        raise DeviceExplorerError("Upload source file does not exist.")

    size = source.stat().st_size
    if size <= 0:
        raise DeviceExplorerError("Upload file is empty.")
    if size > _MAX_UPLOAD_BYTES:
        raise DeviceExplorerError("Upload file exceeds 500MB limit.")

    _ensure_device_ready(device_serial=device_serial)

    remote_path = f"{safe_directory.rstrip('/')}/{normalized_name}"
    try:
        result = run_adb_command(
            ["adb", "-s", device_serial, "push", str(source), remote_path],
            timeout_seconds=180,
        )
        return OperationResult(
            operation="push",
            message="Push completed.",
            command=result.command,
        )
    except AdbError as exc:
        logger.warning(
            "explorer_upload_stream_push_failed device=%s target=%s remote_path=%s detail=%s",
            device_serial,
            safe_directory,
            remote_path,
            str(exc)[:500],
        )
        raise DeviceExplorerError(_map_upload_push_error(str(exc), safe_directory)) from exc
