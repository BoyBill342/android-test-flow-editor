from __future__ import annotations

import time
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.adb_service import AdbError, run_adb_command
from app.core.command_validator import ValidationError, validate_custom_command
from app.core.logging_config import (
    get_logger,
    mask_device_identifier,
    sanitize_adb_command_string_for_log,
)
from app.core.network_validator import is_private_network_ipv4
from app.core.device_explorer_service import validate_device_path
from app.core.device_explorer_service import DeviceExplorerError
from app.models.schemas import FlowStep, StepResult

MAX_OUTPUT_CHARS = 200000
logger = get_logger("executor")
_KEYCODE_PATTERN = re.compile(r"^(KEYCODE_[A-Z0-9_]+|\d+)$")
_SCREENSHOT_TEMP_DIR = Path(tempfile.gettempdir()) / "adb_editor_screenshots"
_SCREENSHOT_WEB_DIR = Path(tempfile.gettempdir()) / "adb_editor_web_artifacts" / "screenshots"


def _cleanup_old_files(base_dir: Path, ttl_hours: int = 24) -> None:
    if not base_dir.exists():
        return
    now_ts = time.time()
    ttl_seconds = max(1, ttl_hours) * 3600
    for file_path in base_dir.glob("**/*"):
        if not file_path.is_file():
            continue
        try:
            if now_ts - file_path.stat().st_mtime > ttl_seconds:
                file_path.unlink(missing_ok=True)
        except OSError:
            continue


@dataclass
class _FlowState:
    """Mutable execution state shared across helper calls."""

    current_device_target: str
    wifi_address: str | None
    last_output: str = ""


def _trim_output(text: str, max_chars: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}\n\n[truncated: total={len(text)} chars, shown={max_chars} chars]"


def _verify_wifi_target_ready(target: str, timeout_seconds: int) -> str:
    """Verify the connected WiFi target is actually usable by adb -s <target> get-state."""
    verify = run_adb_command(
        ["adb", "-s", target, "get-state"],
        timeout_seconds=min(max(1, timeout_seconds), 15),
    )
    state = verify.output.strip().lower()
    if "device" not in state:
        raise AdbError(
            f"WiFi target verification failed for {target}. adb get-state output: {verify.output.strip() or '(empty)'}"
        )
    return verify.output.strip()


def _ensure_device_target(argv: list[str], device_serial: str) -> list[str]:
    if not argv or argv[0] != "adb":
        return argv

    if "-s" in argv or "-d" in argv or "-e" in argv:
        return argv

    global_commands = {
        "devices",
        "start-server",
        "kill-server",
        "version",
        "connect",
        "disconnect",
    }
    if len(argv) > 1 and argv[1] in global_commands:
        return argv

    return ["adb", "-s", device_serial, *argv[1:]]


def _execute_wait_for_property(
    device_serial: str,
    step: FlowStep,
    command_timeout_seconds: int,
) -> tuple[str, str]:
    """
    Execute wait_for_property step.
    
    device_serial: current device target (USB serial or WiFi IP:port)
    """
    prop = str(step.params.get("property", "sys.boot_completed")).strip()
    expected = str(step.params.get("expected", "1")).strip()
    interval_seconds = float(step.params.get("interval_seconds", 1))
    max_wait_seconds = int(step.params.get("max_wait_seconds", 60))

    if not prop:
        raise ValidationError("wait_for_property requires params.property")

    interval_seconds = max(0.1, min(interval_seconds, 10.0))
    max_wait_seconds = max(1, min(max_wait_seconds, 600))
    deadline = time.monotonic() + max_wait_seconds

    attempts = 0
    last_value = ""

    while time.monotonic() <= deadline:
        attempts += 1
        
        # Use current device target (automatically USB or WiFi depending on connection state)
        adb_command = ["adb", "-s", device_serial, "shell", "getprop", prop]
        command = f"adb -s {device_serial} shell getprop {prop}"
        
        try:
            result = run_adb_command(
                adb_command,
                timeout_seconds=min(command_timeout_seconds, 10),
            )
            last_value = result.output.strip()
        except AdbError:
            # Connection error, wait and retry
            time.sleep(interval_seconds)
            continue
        
        # Check if property value matches expected
        matched = (expected == "*" and bool(last_value)) or (last_value == expected)
        if matched:
            output = (
                "wait_for_property matched.\n"
                f"property={prop}\n"
                f"expected={expected}\n"
                f"actual={last_value}\n"
                f"attempts={attempts}\n"
                f"target={device_serial}"
            )
            return command, output

        time.sleep(interval_seconds)

    raise AdbError(
        "wait_for_property timed out "
        f"after {max_wait_seconds}s: property={prop}, expected={expected}, last={last_value!r}"
    )


def _next_result_index(counter: list[int]) -> int:
    idx = counter[0]
    counter[0] += 1
    return idx


def _resolve_keyevent(step: FlowStep) -> str:
    mode = str(step.params.get("mode", "preset")).strip().lower()
    if mode not in {"preset", "custom"}:
        mode = "preset"

    if mode == "custom":
        raw = str(step.params.get("custom_keycode", step.params.get("keycode", ""))).strip()
    else:
        raw = str(step.params.get("preset", step.params.get("keycode", "KEYCODE_HOME"))).strip()

    if not raw:
        raw = "KEYCODE_HOME"

    upper = raw.upper()
    if upper.isalpha() and not upper.startswith("KEYCODE_"):
        upper = f"KEYCODE_{upper}"

    if not _KEYCODE_PATTERN.fullmatch(upper):
        raise ValidationError("keyevent expects KEYCODE_* or numeric keycode.")

    return upper


def _to_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _safe_file_name(raw_name: str, fallback: str) -> str:
    name = raw_name.strip() or fallback
    name = Path(name).name
    if "/" in name or "\\" in name:
        return fallback
    return name


def _normalize_screenshot_file_name(file_name: str) -> str:
    base = _safe_file_name(file_name, "screenshot")
    stem = Path(base).stem.strip() or "screenshot"
    # Android screencap -p produces PNG bytes. Keep extension consistent for host readability.
    return f"{stem}.png"


def _resolve_screenshot_paths(step: FlowStep) -> tuple[str, str]:
    save_path_raw = str(step.params.get("save_path", "/sdcard")).strip() or "/sdcard"
    try:
        save_path = validate_device_path(save_path_raw)
    except DeviceExplorerError as exc:
        raise ValidationError(str(exc)) from exc

    default_name = datetime.now(timezone.utc).strftime("screen_%Y%m%d_%H%M%S.png")
    custom_name = str(step.params.get("filename", "")).strip()
    if custom_name:
        if "/" in custom_name or "\\" in custom_name:
            raise ValidationError("screenshot filename must not include path separators.")
        file_name = custom_name
    else:
        file_name = default_name

    remote_path = f"{save_path.rstrip('/')}/{file_name}"
    return file_name, remote_path


def _collect_screenshot_artifact(
    device_serial: str,
    step: FlowStep,
    timeout_seconds: int,
) -> tuple[str, str]:
    file_name, remote_path = _resolve_screenshot_paths(step)

    _cleanup_old_files(_SCREENSHOT_TEMP_DIR, ttl_hours=24)
    _cleanup_old_files(_SCREENSHOT_WEB_DIR, ttl_hours=24)

    local_pull_dir_raw = str(step.params.get("local_pull_dir", "")).strip()
    local_pull_dir = Path(local_pull_dir_raw).expanduser() if local_pull_dir_raw else _SCREENSHOT_TEMP_DIR
    local_pull_dir.mkdir(parents=True, exist_ok=True)

    fallback_name = datetime.now(timezone.utc).strftime("screen_%Y%m%d_%H%M%S")
    safe_file_name = _normalize_screenshot_file_name(file_name or fallback_name)
    local_file = local_pull_dir / safe_file_name

    run_adb_command(
        ["adb", "-s", device_serial, "pull", remote_path, str(local_file)],
        timeout_seconds=min(max(30, timeout_seconds), 180),
    )

    _SCREENSHOT_WEB_DIR.mkdir(parents=True, exist_ok=True)
    web_name = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{safe_file_name}"
    web_file = _SCREENSHOT_WEB_DIR / web_name
    shutil.copy2(local_file, web_file)

    return str(local_file), web_name


def build_step_command(device_serial: str, step: FlowStep, experimental_shell: bool) -> list[str]:
    if step.type == "wait":
        seconds = int(step.params.get("seconds", 1))
        time.sleep(max(0, min(seconds, 10)))
        return ["adb", "-s", device_serial, "shell", "echo", f"waited_{seconds}s"]

    if step.type == "tap":
        x = int(step.params.get("x", 100))
        y = int(step.params.get("y", 100))
        return ["adb", "-s", device_serial, "shell", "input", "tap", str(x), str(y)]

    if step.type == "input_text":
        text = str(step.params.get("text", "hello"))
        return ["adb", "-s", device_serial, "shell", "input", "text", text]

    if step.type == "swipe":
        x1 = int(step.params.get("x1", 100))
        y1 = int(step.params.get("y1", 500))
        x2 = int(step.params.get("x2", 100))
        y2 = int(step.params.get("y2", 100))
        duration = int(step.params.get("duration", 300))
        return [
            "adb",
            "-s",
            device_serial,
            "shell",
            "input",
            "swipe",
            str(x1),
            str(y1),
            str(x2),
            str(y2),
            str(duration),
        ]

    if step.type == "screenshot":
        _, remote_path = _resolve_screenshot_paths(step)
        return ["adb", "-s", device_serial, "shell", "screencap", "-p", remote_path]

    if step.type == "wait_for_device":
        return ["adb", "-s", device_serial, "wait-for-device"]

    if step.type == "adb_root":
        return ["adb", "-s", device_serial, "root"]

    if step.type == "wifi_enable_tcpip":
        port = int(step.params.get("port", 5555))
        port = max(1, min(port, 65535))
        return ["adb", "-s", device_serial, "tcpip", str(port)]

    if step.type == "wifi_connect":
        host = str(step.params.get("host", "")).strip()
        if not host:
            raise ValidationError("wifi_connect requires params.host")
        if not is_private_network_ipv4(host):
            raise ValidationError(
                "wifi_connect host must be a private-network IPv4 (10.x, 172.16-31.x, 192.168.x, 127.x, or 169.254.x)."
            )
        port = int(step.params.get("port", 5555))
        port = max(1, min(port, 65535))
        return ["adb", "connect", f"{host}:{port}"]

    if step.type == "wifi_disconnect":
        target = str(step.params.get("target", "")).strip()
        if target:
            return ["adb", "disconnect", target]
        return ["adb", "disconnect"]

    if step.type == "usb_disconnect":
        return ["adb", "disconnect", device_serial]

    if step.type == "wait_for_property":
        prop = str(step.params.get("property", "sys.boot_completed")).strip()
        return ["adb", "-s", device_serial, "shell", "getprop", prop]

    if step.type == "reboot":
        mode = str(step.params.get("mode", "")).strip()
        if mode in {"bootloader", "recovery", "sideload"}:
            return ["adb", "-s", device_serial, "reboot", mode]
        return ["adb", "-s", device_serial, "reboot"]

    if step.type == "get_props":
        prop = str(step.params.get("property", "")).strip()
        if prop:
            return ["adb", "-s", device_serial, "shell", "getprop", prop]
        return ["adb", "-s", device_serial, "shell", "getprop"]

    if step.type == "keyevent":
        keycode = _resolve_keyevent(step)
        return ["adb", "-s", device_serial, "shell", "input", "keyevent", keycode]

    if step.type == "app_start":
        package = str(step.params.get("package", "")).strip()
        activity = str(step.params.get("activity", "")).strip()
        if not package:
            raise ValidationError("app_start requires params.package")
        if activity:
            return [
                "adb",
                "-s",
                device_serial,
                "shell",
                "am",
                "start",
                "-n",
                f"{package}/{activity}",
            ]
        return ["adb", "-s", device_serial, "shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"]

    if step.type == "app_force_stop":
        package = str(step.params.get("package", "")).strip()
        if not package:
            raise ValidationError("app_force_stop requires params.package")
        return ["adb", "-s", device_serial, "shell", "am", "force-stop", package]

    if step.type == "app_clear_data":
        package = str(step.params.get("package", "")).strip()
        if not package:
            raise ValidationError("app_clear_data requires params.package")
        return ["adb", "-s", device_serial, "shell", "pm", "clear", package]

    if step.type == "install_apk":
        apk_path = str(step.params.get("apk_path", "")).strip()
        if not apk_path:
            raise ValidationError("install_apk requires params.apk_path")
        allow_downgrade = _to_bool(step.params.get("allow_downgrade"), default=False)
        grant_permissions = _to_bool(step.params.get("grant_permissions"), default=True)

        argv = ["adb", "-s", device_serial, "install", "-r"]
        if allow_downgrade:
            argv.append("-d")
        if grant_permissions:
            argv.append("-g")
        argv.append(apk_path)
        return argv

    if step.type == "uninstall_package":
        package = str(step.params.get("package", "")).strip()
        if not package:
            raise ValidationError("uninstall_package requires params.package")
        keep_data = str(step.params.get("keep_data", "false")).strip().lower() == "true"
        if keep_data:
            return ["adb", "-s", device_serial, "uninstall", "-k", package]
        return ["adb", "-s", device_serial, "uninstall", package]

    if step.type == "wait_boot_completed":
        return ["adb", "-s", device_serial, "shell", "getprop", "sys.boot_completed"]

    if step.type == "custom_command":
        raw_command = str(step.params.get("command", "")).strip()
        validated = validate_custom_command(raw_command, experimental_shell=experimental_shell)
        return _ensure_device_target(validated.argv, device_serial)

    raise ValidationError(f"Unsupported step type: {step.type}")


# ---------------------------------------------------------------------------
# Single-step runner (shared by main loop and condition group runner)
# ---------------------------------------------------------------------------

def _run_one_step(
    idx: int,
    step: FlowStep,
    state: _FlowState,
    experimental_shell: bool,
    command_timeout_seconds: int,
    flow_tag: str,
    device_serial: str,
) -> StepResult:
    """
    Execute one non-condition step.

    Updates *state* in-place (device target, last_output).
    Always returns a StepResult — success=False on any execution error.
    Never raises.
    """
    step_started = time.monotonic()
    effective_timeout = command_timeout_seconds
    if step.timeout_seconds is not None:
        effective_timeout = max(1, min(step.timeout_seconds, 600))

    logger.info(
        "step_started flow_id=%s index=%s type=%s name=%s timeout_sec=%s target=%s",
        flow_tag,
        idx,
        step.type,
        step.name,
        effective_timeout,
        mask_device_identifier(state.current_device_target),
    )

    command: list[str] = []
    try:
        if step.type == "wait_for_property":
            command_str, output_str = _execute_wait_for_property(
                device_serial=state.current_device_target,
                step=step,
                command_timeout_seconds=effective_timeout,
            )
            state.last_output = output_str
            logger.info(
                "step_succeeded flow_id=%s index=%s type=%s duration_ms=%.2f",
                flow_tag, idx, step.type,
                (time.monotonic() - step_started) * 1000,
            )
            return StepResult(
                index=idx,
                name=step.name,
                type=step.type,
                success=True,
                command=command_str,
                output=_trim_output(output_str),
            )

        command = build_step_command(state.current_device_target, step, experimental_shell)
        command_result = run_adb_command(command, timeout_seconds=effective_timeout)

        # Update device target tracking after successful execution
        if step.type == "wifi_connect":
            host = str(step.params.get("host", "")).strip()
            port = int(step.params.get("port", 5555))
            state.wifi_address = f"{host}:{port}"
            verification_output = _verify_wifi_target_ready(state.wifi_address, effective_timeout)
            state.current_device_target = state.wifi_address
            command_result = command_result.__class__(
                command=command_result.command,
                output=(
                    f"{command_result.output}\n\n"
                    f"[verify] adb -s {state.wifi_address} get-state\n{verification_output}"
                ),
            )
        elif step.type == "wifi_disconnect":
            if not str(step.params.get("target", "")).strip():
                state.current_device_target = device_serial
                state.wifi_address = None
        # usb_disconnect: keep WiFi target if it exists (no state change needed)

        state.last_output = command_result.output

        if step.type == "screenshot":
            local_path, web_name = _collect_screenshot_artifact(
                device_serial=state.current_device_target,
                step=step,
                timeout_seconds=effective_timeout,
            )
            command_result = command_result.__class__(
                command=command_result.command,
                output=(
                    f"{command_result.output}\n"
                    f"[screenshot_local_path] {local_path}\n"
                    f"[screenshot_web_name] {web_name}"
                ),
            )
            state.last_output = command_result.output

        logger.info(
            "step_succeeded flow_id=%s index=%s type=%s duration_ms=%.2f command=%s output_chars=%s",
            flow_tag, idx, step.type,
            (time.monotonic() - step_started) * 1000,
            sanitize_adb_command_string_for_log(command_result.command),
            len(command_result.output),
        )
        return StepResult(
            index=idx,
            name=step.name,
            type=step.type,
            success=True,
            command=command_result.command,
            output=_trim_output(command_result.output),
        )

    except (ValidationError, AdbError, TimeoutError, ValueError) as exc:
        logger.exception(
            "step_failed flow_id=%s index=%s type=%s duration_ms=%.2f error=%s",
            flow_tag, idx, step.type,
            (time.monotonic() - step_started) * 1000,
            str(exc),
        )
        return StepResult(
            index=idx,
            name=step.name,
            type=step.type,
            success=False,
            command=" ".join(command) if command else "",
            output=_trim_output(str(exc), max_chars=20000),
        )



# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def execute_steps(
    device_serial: str,
    steps: list[FlowStep],
    experimental_shell: bool,
    command_timeout_seconds: int,
    flow_timeout_seconds: int,
    flow_id: str | None = None,
) -> tuple[list[StepResult], bool, str]:
    results: list[StepResult] = []
    started_at = time.monotonic()
    flow_tag = flow_id or "n/a"

    logger.info(
        "execute_steps_started flow_id=%s steps=%s device=%s",
        flow_tag,
        len(steps),
        mask_device_identifier(device_serial),
    )

    state = _FlowState(current_device_target=device_serial, wifi_address=None)

    for idx, step in enumerate(steps):
        if (time.monotonic() - started_at) > flow_timeout_seconds:
            results.append(
                StepResult(
                    index=idx,
                    name=step.name,
                    type=step.type,
                    success=False,
                    command="",
                    output=(
                        "Flow timeout reached. "
                        f"Elapsed>{flow_timeout_seconds}s before executing this step."
                    ),
                )
            )
            logger.warning(
                "flow_timeout flow_id=%s step_index=%s elapsed_sec=%.2f limit_sec=%s",
                flow_tag, idx,
                time.monotonic() - started_at, flow_timeout_seconds,
            )
            return results, False, f"Flow timed out after {flow_timeout_seconds}s"

        result = _run_one_step(
            idx=idx,
            step=step,
            state=state,
            experimental_shell=experimental_shell,
            command_timeout_seconds=command_timeout_seconds,
            flow_tag=flow_tag,
            device_serial=device_serial,
        )
        results.append(result)
        if not result.success:
            return results, False, f"Failed at step {idx + 1}: {step.name}"

    logger.info(
        "execute_steps_finished flow_id=%s success=true duration_sec=%.2f step_count=%s",
        flow_tag,
        time.monotonic() - started_at,
        len(results),
    )
    return results, True, "Flow executed successfully."
