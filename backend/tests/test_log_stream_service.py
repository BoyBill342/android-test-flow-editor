from __future__ import annotations

from pathlib import Path

from app.core.log_export_service import stream_server_logs


def test_stream_server_logs_supports_cursor_and_levels(tmp_path: Path, monkeypatch) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"
    log_file.write_text(
        "\n".join(
            [
                "2026-08-04 09:00:00 | INFO | adb_editor.api | flow started",
                "2026-08-04 09:00:01 | ERROR | adb_editor.api | flow failed",
                "2026-08-04 09:00:02 | INFO | adb_editor.api | wifi connected",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("app.core.log_export_service._resolve_log_directory", lambda: log_dir)

    first = stream_server_logs(cursor=0, limit=1, keyword="", levels=["INFO"], max_buffer_lines=500)
    assert len(first.items) == 1
    assert first.items[0].level == "INFO"
    assert first.next_cursor == 1
    assert first.total_available == 2

    second = stream_server_logs(cursor=1, limit=5, keyword="", levels=["INFO"], max_buffer_lines=500)
    assert len(second.items) == 1
    assert second.items[0].message == "wifi connected"
    assert second.next_cursor == 2


def test_stream_server_logs_reports_dropped_count(tmp_path: Path, monkeypatch) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"

    lines = [
        f"2026-08-04 10:00:{idx:02d} | INFO | adb_editor.api | line {idx}"
        for idx in range(0, 12)
    ]
    log_file.write_text("\n".join(lines), encoding="utf-8")

    monkeypatch.setattr("app.core.log_export_service._resolve_log_directory", lambda: log_dir)

    result = stream_server_logs(cursor=0, limit=50, keyword="", levels=[], max_buffer_lines=5)
    assert result.dropped_count == 7
    assert result.total_available == 12
    assert len(result.items) == 5
    assert result.items[0].message == "line 7"
    assert result.next_cursor == 12
