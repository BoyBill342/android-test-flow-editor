from __future__ import annotations

import re
from dataclasses import dataclass


class ValidationError(Exception):
    pass


@dataclass(frozen=True)
class ValidationResult:
    argv: list[str]


FORBIDDEN_PATTERN = re.compile(r"(\|\||&&|;|`|\$\(|>|<)")

# Restricted mode allows only adb operations.
ALLOWED_ROOT_COMMANDS = {"adb"}
ALLOWED_ADB_SUBCOMMANDS = {
    "shell",
    "push",
    "pull",
    "wait-for-device",
    "wait-for-usb-device",
    "wait-for-local-device",
    "root",
    "reboot",
    "get-state",
    "get-serialno",
    "start-server",
    "kill-server",
    "reconnect",
    "tcpip",
    "connect",
    "disconnect",
    "version",
    "devices",
}

ADB_OPTIONS_WITH_VALUE = {"-s", "-H", "-P", "-L", "-t"}


def _find_adb_subcommand(argv: list[str]) -> str | None:
    index = 1
    while index < len(argv):
        token = argv[index]
        if token.startswith("-"):
            if token in ADB_OPTIONS_WITH_VALUE:
                index += 2
                continue
            index += 1
            continue
        return token
    return None


def validate_custom_command(command: str, experimental_shell: bool) -> ValidationResult:
    stripped = command.strip()
    if not stripped:
        raise ValidationError("Custom command is empty.")

    if FORBIDDEN_PATTERN.search(stripped):
        raise ValidationError("Command contains forbidden shell metacharacters.")

    argv = stripped.split()

    if experimental_shell:
        return ValidationResult(argv=argv)

    if argv[0] not in ALLOWED_ROOT_COMMANDS:
        raise ValidationError("Only adb-prefixed commands are allowed in restricted mode.")

    subcommand = _find_adb_subcommand(argv)
    if subcommand is None or subcommand not in ALLOWED_ADB_SUBCOMMANDS:
        raise ValidationError(
            "Restricted mode allows only adb subcommands: shell, push, pull, "
            "wait-for-device, wait-for-usb-device, wait-for-local-device, reboot, "
            "root, get-state, get-serialno, start-server, kill-server, reconnect, tcpip, connect, "
            "disconnect, version, devices."
        )

    return ValidationResult(argv=argv)
