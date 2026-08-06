# Android Test Flow Editor

**A no-code Android automation tool built for test engineers who don't write scripts.**

Android Test Flow Editor lets you build, run, and export Android ADB test flows through a visual block-based interface — no programming knowledge required. Simply pick the actions you need, configure the parameters, connect your Android device, and run.

---

## Why this tool exists

Traditional ADB automation requires writing shell scripts or using complex frameworks. This creates a barrier for QA / test engineers who understand the test scenarios but are not developers.

Android Test Flow Editor removes that barrier:

- **No scripting** — every action is a visual block with a form to fill in
- **No environment complexity** — one-click startup on Windows, no Docker required
- **No guesswork** — built-in tooltips explain what each block does and when to use it
- **No black box** — execution results and logs are visible in the UI and exportable

---

## Who this is for

- QA engineers and test engineers without a programming background
- Teams that need repeatable Android device workflows (setup, reset, testing sequences)
- Anyone who wants to automate Android device interactions through ADB without writing code

---

## Key features

| Feature | Details |
|---|---|
| Block-based flow editor | Drag and assemble steps visually |
| 21 built-in action blocks | Covers tap, swipe, input, app control, WiFi ADB, reboot, and more |
| Device selector | Lists connected ADB devices and lets you pick the target |
| WiFi ADB Quick Setup | One-panel setup to switch from USB to wireless ADB |
| Flow import / export | Save and share your flows as `.json` files |
| Execution log panel | See live step-by-step results in the UI |
| Log export | Export full execution logs to a `.txt` file for bug reports |
| Per-step timeout | Configure how long each step is allowed to run |
| Restricted command mode | Blocks dangerous shell patterns by default |

---

## Built-in action blocks

| Block | What it does |
|---|---|
| `wait` | Pause execution for a specified duration |
| `tap` | Tap a screen coordinate |
| `input_text` | Type text into the focused field |
| `swipe` | Swipe between two screen coordinates |
| `screenshot` | Take a screenshot and pull it to the host machine |
| `wait_for_device` | Wait until a device becomes available over ADB |
| `adb_root` | Restart adbd with root permissions |
| `wifi_enable_tcpip` | Switch the device to TCP/IP ADB mode |
| `wifi_connect` | Connect to the device over WiFi ADB |
| `wifi_disconnect` | Disconnect a WiFi ADB session |
| `wait_for_property` | Poll a system property until the expected value appears |
| `reboot` | Reboot the device |
| `wait_boot_completed` | Wait until the device finishes booting |
| `get_props` | Retrieve device system properties |
| `keyevent` | Send a hardware key event (e.g. Home, Back, Power) |
| `app_start` | Launch an app by package name |
| `app_force_stop` | Force-stop an app |
| `app_clear_data` | Clear an app's data and cache |
| `install_apk` | Install an APK from a local file path |
| `uninstall_package` | Uninstall an app by package name |
| `custom_command` | Run a restricted custom ADB command |

---

## Prerequisites

| Requirement | Version |
|---|---|
| Windows | 10 or later |
| Python | 3.10 or later (in PATH) |
| Node.js | 18 or later, with npm (in PATH) |
| Android platform-tools | `adb` in PATH |

---

## Quick start (Windows)

**1. Clone the repository**

```powershell
git clone https://github.com/BoyBill342/android-test-flow-editor.git
cd android-test-flow-editor
```

**2. Start the application**

```powershell
scripts\start-windows.bat
```

This installs all dependencies on the first run and opens the UI in your browser automatically.

**3. Connect your Android device**

Connect via USB (USB debugging must be enabled on the device) or set up WiFi ADB using the built-in WiFi Quick Setup panel.

**4. Build your test flow**

- Click **Add Block** to add action steps
- Configure each step's parameters using the form
- Select your connected device from the device list
- Click **Run** to execute the flow

---

## Startup options

Copy `scripts\start-windows.flags.txt.example` to `scripts\start-windows.flags.txt` and edit the values to customize startup behavior. The file uses `KEY=VALUE` format — no spaces around `=`, lines starting with `#` are ignored.

| Key | Default | Description |
|---|---|---|
| `BACKEND_HOST` | `127.0.0.1` | Backend bind address |
| `BACKEND_PORT` | `8000` | Backend port |
| `FRONTEND_HOST` | `127.0.0.1` | Frontend bind address |
| `FRONTEND_PORT` | `5173` | Frontend port |
| `FRONTEND_API_BASE` | *(auto)* | Override API base URL; leave empty to use `http://BACKEND_HOST:BACKEND_PORT/api` |
| `OPEN_BROWSER` | `1` | Set to `0` to skip auto-opening the browser |
| `FORCE_INSTALL` | `0` | Set to `1` to always reinstall backend dependencies |
| `REBUILD_VENV` | `0` | Set to `1` to rebuild the Python virtual environment from scratch |
| `ENABLE_LOGIN` | `0` | Set to `1` to require username and password before using the app |
| `LOGIN_USERNAME` | *(none)* | Required when `ENABLE_LOGIN=1` |
| `LOGIN_PASSWORD` | *(none)* | Required when `ENABLE_LOGIN=1` |

You can also pass one-time flags directly on the command line:

```powershell
scripts\start-windows.bat --install       # force reinstall backend dependencies
scripts\start-windows.bat --rebuild-venv  # rebuild the Python virtual environment
```

> **Note:** Run `start-windows.bat` directly in PowerShell or CMD. Do not prefix it with `python`.

---

## WiFi ADB quick guide

Typical sequence for switching to wireless ADB:

```
wait_for_device  →  wifi_enable_tcpip  →  wifi_connect
```

The **WiFi Quick Setup** panel in the UI automates this entire sequence. Enter the device IP and port, confirm the private-network check, and click **Run WiFi Quick Setup**.

> WiFi ADB does not persist after a device reboot. Re-run the setup or keep a USB fallback step in your flow.

---

## Flow management

- **Export** — saves the current flow to a `.json` file on your machine
- **Import** — loads a previously saved `.json` flow back into the editor
- Flows can be shared between team members by sharing the `.json` file

---

## Logging and troubleshooting

- Execution results are displayed step-by-step in the UI log panel
- Full logs are written to `backend/logs/app.log`
- Export execution logs from the UI and attach `backend/logs/app.log` when reporting issues

Optional environment variables for backend logging:

| Variable | Example | Description |
|---|---|---|
| `ADB_EDITOR_LOG_LEVEL` | `DEBUG` | Log verbosity |
| `ADB_EDITOR_LOG_DIR` | `C:\logs` | Custom log folder |
| `ADB_EDITOR_LOG_MAX_BYTES` | `5242880` | Max size per log file |
| `ADB_EDITOR_LOG_BACKUP_COUNT` | `5` | Number of rotated backup files |

---

## Security

- Restricted command mode is **enabled by default** — dangerous shell metacharacters are blocked
- Experimental arbitrary shell mode is disabled by default and should only be used in trusted local environments
- See [docs/SECURITY.md](docs/SECURITY.md) for the full security baseline

---

## Repository structure

```
android-test-flow-editor/
├── backend/          # FastAPI API and execution engine
├── frontend/         # React + TypeScript UI
├── scripts/          # Windows one-click startup scripts
├── docs/             # Architecture, security, and setup guides
└── .github/
    └── workflows/    # CI for backend and frontend tests
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit style, and CI requirements.

---

## License

This project is licensed under the MIT License. See the LICENSE file for the full license text.
