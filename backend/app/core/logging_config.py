from __future__ import annotations

import logging
import os
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_LOG_FILE_BACKUP_COUNT = 5


def _to_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _resolve_log_directory() -> Path:
    # backend/app/core/logging_config.py -> backend/
    backend_root = Path(__file__).resolve().parents[2]
    custom_dir = os.getenv("ADB_EDITOR_LOG_DIR", "").strip()
    if custom_dir:
        return Path(custom_dir)
    return backend_root / "logs"


def setup_logging() -> None:
    if getattr(setup_logging, "_configured", False):
        return

    log_level_name = os.getenv("ADB_EDITOR_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    log_dir = _resolve_log_directory()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(log_level)
    stream_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        filename=log_file,
        maxBytes=_to_int(os.getenv("ADB_EDITOR_LOG_MAX_BYTES"), DEFAULT_LOG_FILE_MAX_BYTES),
        backupCount=_to_int(os.getenv("ADB_EDITOR_LOG_BACKUP_COUNT"), DEFAULT_LOG_FILE_BACKUP_COUNT),
        encoding="utf-8",
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.addHandler(stream_handler)
    root_logger.addHandler(file_handler)

    # Keep uvicorn loggers aligned with the same level and handlers.
    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(logger_name)
        uvicorn_logger.setLevel(log_level)

    setup_logging._configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"adb_editor.{name}")


def mask_device_identifier(device_serial: str) -> str:
    """Mask serial for logs while preserving enough detail for debugging."""
    value = (device_serial or "").strip()
    if not value:
        return "(empty)"
    if len(value) <= 6:
        return value
    return f"{value[:3]}***{value[-3:]}"


def sanitize_adb_argv_for_log(argv: list[str]) -> str:
    if not argv:
        return ""
    if argv[0] != "adb":
        return " ".join(argv)

    sanitized: list[str] = []
    index = 0
    while index < len(argv):
        token = argv[index]

        if token == "-s" and index + 1 < len(argv):
            sanitized.append(token)
            sanitized.append(mask_device_identifier(argv[index + 1]))
            index += 2
            continue

        if token in {"connect", "disconnect"} and index + 1 < len(argv):
            sanitized.append(token)
            sanitized.append(mask_device_identifier(argv[index + 1]))
            index += 2
            continue

        sanitized.append(token)
        index += 1

    return " ".join(sanitized)


def sanitize_adb_command_string_for_log(command: str) -> str:
    if not command.strip():
        return command

    masked = re.sub(
        r"(\badb\s+-s\s+)(\S+)",
        lambda m: f"{m.group(1)}{mask_device_identifier(m.group(2))}",
        command,
    )
    masked = re.sub(
        r"(\badb\s+(?:connect|disconnect)\s+)(\S+)",
        lambda m: f"{m.group(1)}{mask_device_identifier(m.group(2))}",
        masked,
    )
    return masked
