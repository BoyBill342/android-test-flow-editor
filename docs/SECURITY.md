# Security Baseline (MVP)

## Defaults

- Restricted command mode is enabled by default.
- Experimental arbitrary shell mode is disabled by default.

## Restricted mode policy

Allowed command shape in custom blocks:

- `adb shell ...`
- `adb push ...`
- `adb pull ...`
- `adb wait-for-device` / `wait-for-usb-device` / `wait-for-local-device`
- `adb root`
- `adb reboot`
- `adb get-state` / `get-serialno`
- `adb start-server` / `kill-server` / `reconnect`
- `adb tcpip` / `connect` / `disconnect`
- `adb version` / `devices`

Blocked patterns include shell metacharacters such as:

- `&&`, `||`, `;`, backticks, redirection operators

## Operational safeguards

- Per-command timeout
- Flow-level early stop on failure
- Truncated output to prevent oversized response payloads

## Risk statement

If experimental arbitrary shell mode is enabled, the tool should be treated as high risk.
Use it only in trusted local environments and keep full execution logs.
