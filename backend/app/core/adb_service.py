from __future__ import annotations

import locale
import ipaddress
import re
import subprocess
import time
from dataclasses import dataclass

from app.core.logging_config import (
    get_logger,
    mask_device_identifier,
    sanitize_adb_argv_for_log,
)

logger = get_logger("adb_service")


class AdbError(Exception):
    pass


@dataclass(frozen=True)
class CommandResult:
    command: str
    output: str


@dataclass(frozen=True)
class WifiDetectCandidate:
    host: str
    port: int
    interface: str
    gateway: str
    source: str


@dataclass(frozen=True)
class WifiDetectResult:
    success: bool
    status: str
    selected_host: str | None
    selected_port: int
    candidates: list[WifiDetectCandidate]
    reason_code: str
    message: str


def _decode_subprocess_stream(data: bytes | None) -> str:
    if not data:
        return ""

    candidates = ["utf-8", locale.getpreferredencoding(False), "cp950"]
    attempted: set[str] = set()
    for encoding in candidates:
        if not encoding or encoding in attempted:
            continue
        attempted.add(encoding)
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue

    return data.decode("utf-8", errors="replace")


def _safe_get_device_name(serial: str) -> str:
    queries = ["ro.product.marketname", "ro.product.model", "ro.product.device"]
    for prop in queries:
        try:
            result = run_adb_command(
                ["adb", "-s", serial, "shell", "getprop", prop],
                timeout_seconds=5,
            )
            name = result.output.strip()
            if name:
                return name
        except AdbError:
            continue
    return "Unknown Device"


def list_devices() -> list[dict[str, str]]:
    started = time.monotonic()
    process = subprocess.run(
        ["adb", "devices"],
        capture_output=True,
        text=False,
        timeout=10,
        check=False,
    )

    stdout_text = _decode_subprocess_stream(process.stdout)
    stderr_text = _decode_subprocess_stream(process.stderr)

    if process.returncode != 0:
        logger.error("list_devices_failed stderr=%s", stderr_text.strip() or "(empty)")
        raise AdbError(stderr_text.strip() or "Failed to list adb devices.")

    lines = stdout_text.splitlines()[1:]
    devices: list[dict[str, str]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) >= 2:
            serial = parts[0]
            state = parts[1]
            devices.append(
                {
                    "serial": serial,
                    "state": state,
                    "device_name": _safe_get_device_name(serial),
                }
            )

    logger.info(
        "list_devices_success count=%s duration_ms=%.2f",
        len(devices),
        (time.monotonic() - started) * 1000,
    )

    return devices


def run_adb_command(argv: list[str], timeout_seconds: int = 30) -> CommandResult:
    started = time.monotonic()
    command_for_log = sanitize_adb_argv_for_log(argv)
    logger.debug("adb_command_started timeout_sec=%s command=%s", timeout_seconds, command_for_log)

    try:
        process = subprocess.run(
            argv,
            capture_output=True,
            text=False,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logger.warning("adb_command_timeout timeout_sec=%s command=%s", timeout_seconds, command_for_log)
        raise AdbError(f"Command timed out after {timeout_seconds}s: {' '.join(argv)}") from exc

    stdout_text = _decode_subprocess_stream(process.stdout)
    stderr_text = _decode_subprocess_stream(process.stderr)
    output = (stdout_text + "\n" + stderr_text).strip()
    if process.returncode != 0:
        logger.error(
            "adb_command_failed code=%s duration_ms=%.2f command=%s output=%s",
            process.returncode,
            (time.monotonic() - started) * 1000,
            command_for_log,
            output[:500],
        )
        raise AdbError(output or "ADB command failed.")

    maybe_device = ""
    if "-s" in argv:
        try:
            device_index = argv.index("-s") + 1
            maybe_device = argv[device_index]
        except (ValueError, IndexError):
            maybe_device = ""

    logger.info(
        "adb_command_succeeded duration_ms=%.2f command=%s device=%s output_chars=%s",
        (time.monotonic() - started) * 1000,
        command_for_log,
        mask_device_identifier(maybe_device),
        len(output),
    )

    return CommandResult(command=" ".join(argv), output=output)


def list_third_party_packages(device_serial: str) -> list[str]:
    """Return sorted third-party package names from `pm list packages -3`."""
    result = run_adb_command(
        ["adb", "-s", device_serial, "shell", "pm", "list", "packages", "-3"],
        timeout_seconds=20,
    )
    packages: set[str] = set()
    for raw_line in result.output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("package:"):
            line = line[len("package:"):]
        candidate = line.strip()
        if candidate:
            packages.add(candidate)
    return sorted(packages)


_IPV4_PATTERN = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def _is_wifi_connectable_ipv4(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False

    if ip.version != 4:
        return False

    if not ip.is_private:
        return False

    if ip.is_loopback or ip.is_link_local:
        return False

    return True


def _extract_ip_route_candidates(raw_text: str, port: int) -> list[WifiDetectCandidate]:
    candidates: list[WifiDetectCandidate] = []
    default_by_interface: dict[str, str] = {}

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        default_match = re.search(r"^default\s+via\s+([^\s]+)\s+dev\s+([^\s]+)", line)
        if default_match:
            gateway, iface = default_match.group(1), default_match.group(2)
            default_by_interface[iface] = gateway

        src_match = re.search(r"\bsrc\s+([^\s]+)", line)
        dev_match = re.search(r"\bdev\s+([^\s]+)", line)
        if not src_match:
            continue

        host = src_match.group(1)
        if not _is_wifi_connectable_ipv4(host):
            continue

        iface = dev_match.group(1) if dev_match else ""
        gateway = default_by_interface.get(iface, "")
        candidates.append(
            WifiDetectCandidate(
                host=host,
                port=port,
                interface=iface,
                gateway=gateway,
                source="ip_route",
            )
        )

    return candidates


def _extract_ifconfig_candidates(raw_text: str, port: int) -> list[WifiDetectCandidate]:
    candidates: list[WifiDetectCandidate] = []
    current_interface = ""

    for raw_line in raw_text.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        if raw_line and not raw_line[0].isspace():
            head = line.split(":", 1)[0].strip()
            if head and " " not in head:
                current_interface = head

        inet_match = re.search(r"\binet\s+(?:addr:)?((?:\d{1,3}\.){3}\d{1,3})\b", line)
        if not inet_match:
            continue

        host = inet_match.group(1)
        if not _is_wifi_connectable_ipv4(host):
            continue

        candidates.append(
            WifiDetectCandidate(
                host=host,
                port=port,
                interface=current_interface,
                gateway="",
                source="ifconfig",
            )
        )

    return candidates


def _score_candidate(item: WifiDetectCandidate) -> tuple[int, int]:
    score = 0
    iface = item.interface.lower()
    if iface.startswith("wlan") or "wifi" in iface:
        score += 3
    if item.gateway:
        score += 1
    if item.source == "ip_route":
        score += 1
    return score, len(item.interface)


def _dedupe_and_rank(candidates: list[WifiDetectCandidate]) -> list[WifiDetectCandidate]:
    ranked: dict[str, WifiDetectCandidate] = {}
    for candidate in candidates:
        existing = ranked.get(candidate.host)
        if existing is None or _score_candidate(candidate) > _score_candidate(existing):
            ranked[candidate.host] = candidate
    return sorted(ranked.values(), key=_score_candidate, reverse=True)


def detect_wifi_candidates(device_serial: str, port: int = 5555, timeout_seconds: int = 8) -> WifiDetectResult:
    ip_route_output = ""
    ifconfig_output = ""
    ip_route_error = ""
    ifconfig_error = ""

    try:
        ip_route_output = run_adb_command(
            ["adb", "-s", device_serial, "shell", "ip", "route"],
            timeout_seconds=timeout_seconds,
        ).output
    except AdbError as exc:
        ip_route_error = str(exc)

    try:
        ifconfig_output = run_adb_command(
            ["adb", "-s", device_serial, "shell", "ifconfig"],
            timeout_seconds=timeout_seconds,
        ).output
    except AdbError as exc:
        ifconfig_error = str(exc)

    candidates = _dedupe_and_rank(
        _extract_ip_route_candidates(ip_route_output, port)
        + _extract_ifconfig_candidates(ifconfig_output, port)
    )

    if len(candidates) == 1:
        selected = candidates[0]
        return WifiDetectResult(
            success=True,
            status="detected",
            selected_host=selected.host,
            selected_port=selected.port,
            candidates=candidates,
            reason_code="detected_single_candidate",
            message="Detected a single private IPv4 candidate for WiFi ADB.",
        )

    if len(candidates) > 1:
        return WifiDetectResult(
            success=False,
            status="ambiguous",
            selected_host=None,
            selected_port=port,
            candidates=candidates,
            reason_code="ambiguous_network",
            message="Detected multiple private IPv4 candidates. Please choose one manually.",
        )

    if ip_route_error and ifconfig_error:
        message = "WiFi detect failed: both ip route and ifconfig queries failed."
        logger.warning(
            "wifi_detect_failed device=%s reason=%s ip_route_error=%s ifconfig_error=%s",
            mask_device_identifier(device_serial),
            "adb_command_failed",
            ip_route_error[:200],
            ifconfig_error[:200],
        )
        return WifiDetectResult(
            success=False,
            status="failed",
            selected_host=None,
            selected_port=port,
            candidates=[],
            reason_code="adb_command_failed",
            message=message,
        )

    return WifiDetectResult(
        success=False,
        status="failed",
        selected_host=None,
        selected_port=port,
        candidates=[],
        reason_code="parse_failed",
        message="No usable private IPv4 candidate was found from ip route/ifconfig output.",
    )
