from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
import re
import tempfile
import zipfile

from app.core.logging_config import _resolve_log_directory


@dataclass(frozen=True)
class ExportArtifact:
    file_path: Path
    file_name: str
    total_lines: int
    exported_lines: int
    chunk_count: int
    from_timestamp: str | None
    to_timestamp: str | None


@dataclass(frozen=True)
class ServerLogEntryData:
    timestamp: str
    level: str
    logger: str
    message: str


@dataclass(frozen=True)
class ServerLogStreamData:
    items: list[ServerLogEntryData]
    next_cursor: int
    has_more: bool
    dropped_count: int
    total_available: int


_LOG_LINE_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \| "
    r"(?P<level>[A-Z]+) \| (?P<logger>[^|]+) \| (?P<message>.*)$"
)
_ZIP_THRESHOLD_BYTES = 100 * 1024 * 1024


def _parse_timestamp(line: str) -> datetime | None:
    if len(line) < 19:
        return None
    try:
        return datetime.strptime(line[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _line_matches(line: str, min_ts: datetime | None, levels: set[str], keyword: str) -> bool:
    ts = _parse_timestamp(line)
    if min_ts and ts and ts < min_ts:
        return False

    if levels:
        token = "|"
        if token not in line:
            return False
        if not any(f"| {level} |" in line for level in levels):
            return False

    if keyword and keyword.lower() not in line.lower():
        return False

    return True


def _iter_log_files() -> list[Path]:
    log_dir = _resolve_log_directory()
    if not log_dir.exists():
        return []

    files = sorted(log_dir.glob("app.log*"), key=lambda p: p.name)
    return [path for path in files if path.is_file()]


def _parse_stream_line(line: str) -> ServerLogEntryData:
    match = _LOG_LINE_PATTERN.match(line)
    if match:
        return ServerLogEntryData(
            timestamp=match.group("timestamp"),
            level=match.group("level"),
            logger=match.group("logger").strip(),
            message=match.group("message"),
        )
    return ServerLogEntryData(
        timestamp="",
        level="RAW",
        logger="",
        message=line,
    )


def stream_server_logs(
    cursor: int,
    limit: int,
    keyword: str,
    levels: list[str],
    max_buffer_lines: int,
) -> ServerLogStreamData:
    bounded_cursor = max(0, cursor)
    bounded_limit = max(1, min(limit, 2000))
    bounded_buffer = max(1, min(max_buffer_lines, 5000))
    normalized_keyword = keyword.strip().lower()
    normalized_levels = {item.strip().upper() for item in levels if item.strip()}

    filtered: list[ServerLogEntryData] = []
    for file_path in _iter_log_files():
        for line in file_path.read_text(encoding="utf-8", errors="replace").splitlines():
            parsed = _parse_stream_line(line)
            if normalized_levels and parsed.level.upper() not in normalized_levels:
                continue
            if normalized_keyword and normalized_keyword not in parsed.message.lower() and normalized_keyword not in line.lower():
                continue
            filtered.append(parsed)

    total_available = len(filtered)
    dropped_count = max(0, total_available - bounded_buffer)
    start_index = max(bounded_cursor, dropped_count)
    if start_index > total_available:
        start_index = total_available

    end_index = min(total_available, start_index + bounded_limit)
    items = filtered[start_index:end_index]
    next_cursor = end_index

    return ServerLogStreamData(
        items=items,
        next_cursor=next_cursor,
        has_more=next_cursor < total_available,
        dropped_count=dropped_count,
        total_available=total_available,
    )


def export_logs(last_hours: int, levels: list[str], keyword: str, max_chunk_size_mb: int) -> ExportArtifact:
    bounded_hours = max(1, min(last_hours, 24 * 30))
    bounded_chunk_size_mb = max(1, min(max_chunk_size_mb, 200))
    min_ts = datetime.now() - timedelta(hours=bounded_hours)
    normalized_levels = {item.strip().upper() for item in levels if item.strip()}
    normalized_keyword = keyword.strip()

    total_lines = 0
    exported_lines = 0
    selected_lines: list[str] = []

    for file_path in _iter_log_files():
        for line in file_path.read_text(encoding="utf-8", errors="replace").splitlines():
            total_lines += 1
            if _line_matches(line, min_ts=min_ts, levels=normalized_levels, keyword=normalized_keyword):
                selected_lines.append(line)
                exported_lines += 1

    if not selected_lines:
        selected_lines.append("No logs matched the export filters.")

    selected_text = "\n".join(selected_lines) + "\n"
    selected_bytes = selected_text.encode("utf-8")
    now_text = datetime.now().strftime("%Y%m%d_%H%M%S")

    if len(selected_bytes) <= _ZIP_THRESHOLD_BYTES:
        tmp = tempfile.NamedTemporaryFile(prefix="adb_editor_logs_", suffix=".log", delete=False)
        tmp_path = Path(tmp.name)
        tmp.write(selected_bytes)
        tmp.close()
        return ExportArtifact(
            file_path=tmp_path,
            file_name=f"adb_editor_logs_{now_text}.log",
            total_lines=total_lines,
            exported_lines=exported_lines,
            chunk_count=1,
            from_timestamp=min_ts.strftime("%Y-%m-%d %H:%M:%S"),
            to_timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    max_bytes = bounded_chunk_size_mb * 1024 * 1024
    chunks: list[list[str]] = []
    current_chunk: list[str] = []
    current_bytes = 0

    for line in selected_lines:
        encoded = (line + "\n").encode("utf-8")
        if current_chunk and current_bytes + len(encoded) > max_bytes:
            chunks.append(current_chunk)
            current_chunk = []
            current_bytes = 0
        current_chunk.append(line)
        current_bytes += len(encoded)

    if current_chunk:
        chunks.append(current_chunk)

    tmp = tempfile.NamedTemporaryFile(prefix="adb_editor_logs_", suffix=".zip", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    with zipfile.ZipFile(tmp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for idx, chunk in enumerate(chunks, start=1):
            chunk_name = f"logs_chunk_{idx:03d}.log"
            archive.writestr(chunk_name, "\n".join(chunk) + "\n")

    return ExportArtifact(
        file_path=tmp_path,
        file_name=f"adb_editor_logs_{now_text}.zip",
        total_lines=total_lines,
        exported_lines=exported_lines,
        chunk_count=max(1, len(chunks)),
        from_timestamp=min_ts.strftime("%Y-%m-%d %H:%M:%S"),
        to_timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
