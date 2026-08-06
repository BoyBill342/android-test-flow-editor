from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Locale = Literal["en", "zh-TW"]


@dataclass(frozen=True)
class _LocalizedText:
    en: str
    zh_tw: str


@dataclass(frozen=True)
class _BlockItem:
    type: str
    category: _LocalizedText
    label: _LocalizedText
    description: _LocalizedText
    when_to_use: _LocalizedText
    adb_command: str
    template_params: dict[str, str | int | float | bool]


def _t(text: _LocalizedText, locale: Locale) -> str:
    return text.en if locale == "en" else text.zh_tw


_BLOCKS: tuple[_BlockItem, ...] = (
    _BlockItem(
        type="wait_for_device",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("Wait For Device", "等待裝置"),
        description=_LocalizedText(
            "Wait until ADB confirms the selected device is online.",
            "等待 ADB 回報裝置為可連線狀態。",
        ),
        when_to_use=_LocalizedText(
            "After reconnecting USB, rebooting, or switching connection mode.",
            "USB 重連、重開機或切換連線模式後。",
        ),
        adb_command="adb wait-for-device",
        template_params={},
    ),
    _BlockItem(
        type="adb_root",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("ADB Root", "ADB Root"),
        description=_LocalizedText(
            "Restart adbd with root privileges on supported rooted devices.",
            "在支援的 root 裝置上，以 root 權限重啟 adbd。",
        ),
        when_to_use=_LocalizedText(
            "Only when privileged operations are required and device policy allows it.",
            "僅在需要高權限且裝置政策允許時使用。",
        ),
        adb_command="adb root",
        template_params={},
    ),
    _BlockItem(
        type="wifi_enable_tcpip",
        category=_LocalizedText("WiFi ADB", "WiFi ADB"),
        label=_LocalizedText("Enable WiFi ADB (tcpip)", "啟用 WiFi ADB (tcpip)"),
        description=_LocalizedText("Switch target device adbd to TCP mode.", "將目標裝置 adbd 切換到 TCP 模式。"),
        when_to_use=_LocalizedText(
            "After initial USB pairing, before connect over WiFi.",
            "首次 USB 連線配對後、切到 WiFi 前使用。",
        ),
        adb_command="adb -s <serial> tcpip <port>",
        template_params={"port": 5555},
    ),
    _BlockItem(
        type="wifi_connect",
        category=_LocalizedText("WiFi ADB", "WiFi ADB"),
        label=_LocalizedText("WiFi Connect", "WiFi 連線"),
        description=_LocalizedText(
            "Connect host adb server to device over IP and port.",
            "透過 IP 與 Port 讓主機 adb 連線到裝置。",
        ),
        when_to_use=_LocalizedText(
            "After tcpip mode is enabled and IP is known.",
            "已啟用 tcpip 且已取得裝置 IP 後。",
        ),
        adb_command="adb connect <ip>:<port>",
        template_params={"host": "192.168.1.100", "port": 5555},
    ),
    _BlockItem(
        type="wifi_disconnect",
        category=_LocalizedText("WiFi ADB", "WiFi ADB"),
        label=_LocalizedText("WiFi Disconnect", "WiFi 斷線"),
        description=_LocalizedText("Disconnect one or all WiFi adb targets.", "中斷單一或全部 WiFi adb 連線。"),
        when_to_use=_LocalizedText(
            "Cleanup after tests or when reconnecting unstable links.",
            "測試結束清理，或網路不穩時重新連線前。",
        ),
        adb_command="adb disconnect [ip:port]",
        template_params={"target": ""},
    ),
    _BlockItem(
        type="usb_disconnect",
        category=_LocalizedText("WiFi ADB", "WiFi ADB"),
        label=_LocalizedText("USB Disconnect", "USB 斷線"),
        description=_LocalizedText(
            "Disconnect device by USB serial number after switching to WiFi.",
            "在切換到 WiFi 後，用 USB 序號中斷裝置連線。",
        ),
        when_to_use=_LocalizedText(
            "After WiFi Connect, to force the next commands onto WiFi target.",
            "WiFi Connect 後，強制後續指令走 WiFi 目標。",
        ),
        adb_command="adb disconnect <serial>",
        template_params={},
    ),
    _BlockItem(
        type="wait_for_property",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("Wait For Property", "等待屬性值"),
        description=_LocalizedText(
            "Poll a system property until it matches expected value.",
            "持續輪詢系統屬性，直到符合預期值。",
        ),
        when_to_use=_LocalizedText("Waiting for boot completion or service readiness.", "等待開機完成或服務就緒。"),
        adb_command="adb shell getprop <property>",
        template_params={"property": "sys.boot_completed", "expected": "1", "interval_seconds": 1, "max_wait_seconds": 60},
    ),
    _BlockItem(
        type="reboot",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("Reboot", "重新開機"),
        description=_LocalizedText("Reboot the selected device with optional mode.", "重啟目前裝置，可選擇模式。"),
        when_to_use=_LocalizedText("Pre-test reset and reboot scenario testing.", "測試前重置或重開機情境驗證。"),
        adb_command="adb reboot [bootloader|recovery|sideload]",
        template_params={"mode": ""},
    ),
    _BlockItem(
        type="wait_boot_completed",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("Check Boot Completed", "檢查開機完成"),
        description=_LocalizedText("Read boot completion property once.", "單次讀取開機完成屬性值。"),
        when_to_use=_LocalizedText("Quick snapshot checks.", "快速狀態快照檢查。"),
        adb_command="adb shell getprop sys.boot_completed",
        template_params={},
    ),
    _BlockItem(
        type="get_props",
        category=_LocalizedText("Device Control", "裝置控制"),
        label=_LocalizedText("Get All Properties", "取得全部屬性"),
        description=_LocalizedText("Show one property value or dump all Android properties.", "可查詢單一屬性值，或輸出完整 Android 屬性清單。"),
        when_to_use=_LocalizedText("Device diagnostics and environment checks.", "裝置診斷與環境檢查。"),
        adb_command="adb shell getprop",
        template_params={"property": ""},
    ),
    _BlockItem(
        type="wait",
        category=_LocalizedText("UI Actions", "UI 操作"),
        label=_LocalizedText("Wait", "等待"),
        description=_LocalizedText("Pause execution for a fixed duration.", "流程暫停固定秒數。"),
        when_to_use=_LocalizedText("Between transitions or animation-heavy actions.", "介面轉場或動畫後。"),
        adb_command="(local delay, no adb command)",
        template_params={"seconds": 1},
    ),
    _BlockItem(
        type="tap",
        category=_LocalizedText("UI Actions", "UI 操作"),
        label=_LocalizedText("Tap", "點擊"),
        description=_LocalizedText("Tap at screen coordinates.", "點擊螢幕座標。"),
        when_to_use=_LocalizedText("Coordinate-based UI interaction tests.", "以座標做 UI 互動測試。"),
        adb_command="adb shell input tap <x> <y>",
        template_params={"x": 100, "y": 100},
    ),
    _BlockItem(
        type="input_text",
        category=_LocalizedText("UI Actions", "UI 操作"),
        label=_LocalizedText("Input Text", "輸入文字"),
        description=_LocalizedText("Input text into focused field.", "在焦點欄位輸入文字。"),
        when_to_use=_LocalizedText("Form and search test data injection.", "表單與搜尋資料輸入。"),
        adb_command="adb shell input text <text>",
        template_params={"text": "hello"},
    ),
    _BlockItem(
        type="swipe",
        category=_LocalizedText("UI Actions", "UI 操作"),
        label=_LocalizedText("Swipe", "滑動"),
        description=_LocalizedText("Swipe with start/end points and duration.", "依起迄座標與時間進行滑動。"),
        when_to_use=_LocalizedText("Scrolling and gesture scenarios.", "捲動與手勢情境。"),
        adb_command="adb shell input swipe <x1> <y1> <x2> <y2> <duration>",
        template_params={"x1": 100, "y1": 500, "x2": 100, "y2": 100, "duration": 300},
    ),
    _BlockItem(
        type="keyevent",
        category=_LocalizedText("UI Actions", "UI 操作"),
        label=_LocalizedText("Keyevent", "按鍵事件"),
        description=_LocalizedText("Send Android keyevent such as HOME/BACK.", "送出 Android 按鍵事件（如 HOME/BACK）。"),
        when_to_use=_LocalizedText("Navigation and hardware key behavior.", "導覽與硬體按鍵行為驗證。"),
        adb_command="adb shell input keyevent <KEYCODE>",
        template_params={"mode": "preset", "preset": "3", "custom_keycode": "", "keycode": "3"},
    ),
    _BlockItem(
        type="screenshot",
        category=_LocalizedText("Capture", "擷取"),
        label=_LocalizedText("Screenshot", "截圖"),
        description=_LocalizedText("Capture screenshot to device storage.", "擷取螢幕畫面到裝置儲存空間。"),
        when_to_use=_LocalizedText("Visual evidence and debug snapshots.", "視覺證據與除錯快照。"),
        adb_command="adb shell screencap -p /sdcard/<file>.png",
        template_params={"save_path": "/sdcard", "filename": "", "local_pull_dir": ""},
    ),
    _BlockItem(
        type="app_start",
        category=_LocalizedText("App Lifecycle", "App 生命週期"),
        label=_LocalizedText("Start App", "啟動 App"),
        description=_LocalizedText(
            "Start app by package/activity or launcher fallback.",
            "用 package/activity 或 launcher 方式啟動 App。",
        ),
        when_to_use=_LocalizedText("Launch and startup stability checks.", "啟動流程與穩定性檢查。"),
        adb_command="adb shell am start -n <package>/<activity>",
        template_params={"package": "", "activity": ""},
    ),
    _BlockItem(
        type="app_force_stop",
        category=_LocalizedText("App Lifecycle", "App 生命週期"),
        label=_LocalizedText("Force Stop App", "強制停止 App"),
        description=_LocalizedText("Force-stop target package.", "強制停止目標套件。"),
        when_to_use=_LocalizedText("Clean start before each case.", "每次測試前清理狀態。"),
        adb_command="adb shell am force-stop <package>",
        template_params={"package": ""},
    ),
    _BlockItem(
        type="app_clear_data",
        category=_LocalizedText("App Lifecycle", "App 生命週期"),
        label=_LocalizedText("Clear App Data", "清除 App 資料"),
        description=_LocalizedText("Clear package data and cache.", "清除套件資料與快取。"),
        when_to_use=_LocalizedText("First-launch and onboarding checks.", "首次啟動與導覽測試。"),
        adb_command="adb shell pm clear <package>",
        template_params={"package": ""},
    ),
    _BlockItem(
        type="install_apk",
        category=_LocalizedText("App Lifecycle", "App 生命週期"),
        label=_LocalizedText("Install APK", "安裝 APK"),
        description=_LocalizedText("Install an APK from host path.", "從主機路徑安裝 APK。"),
        when_to_use=_LocalizedText("Build verification and smoke installs.", "建置驗證與冒煙安裝測試。"),
        adb_command="adb install -r <apk_path>",
        template_params={"apk_path": "C:/builds/app.apk", "allow_downgrade": False, "grant_permissions": True},
    ),
    _BlockItem(
        type="uninstall_package",
        category=_LocalizedText("App Lifecycle", "App 生命週期"),
        label=_LocalizedText("Uninstall Package", "移除套件"),
        description=_LocalizedText("Uninstall package from target device.", "從目標裝置移除套件。"),
        when_to_use=_LocalizedText("Cleanup between test rounds.", "測試輪次之間的清理。"),
        adb_command="adb uninstall <package>",
        template_params={"package": "", "keep_data": False},
    ),
    _BlockItem(
        type="custom_command",
        category=_LocalizedText("Advanced", "進階"),
        label=_LocalizedText("Custom Command", "自訂指令"),
        description=_LocalizedText("Run a restricted adb command string.", "執行受限制模式下允許的 adb 指令字串。"),
        when_to_use=_LocalizedText("For edge operations not covered by built-in blocks.", "需要內建方塊尚未覆蓋的操作時。"),
        adb_command="adb <restricted-subcommand>",
        template_params={"command": "adb shell getprop ro.build.version.release"},
    ),
)


def list_block_definitions(
    locale: Locale,
    query: str = "",
) -> list[dict[str, object]]:
    keyword = query.strip().lower()

    results: list[dict[str, object]] = []
    for block in _BLOCKS:
        searchable_text = " ".join(
            [
                block.type,
                block.adb_command,
                block.category.en,
                block.category.zh_tw,
                block.label.en,
                block.label.zh_tw,
                block.description.en,
                block.description.zh_tw,
                block.when_to_use.en,
                block.when_to_use.zh_tw,
            ]
        ).lower()

        if keyword and keyword not in searchable_text:
            continue

        results.append(
            {
                "type": block.type,
                "category": _t(block.category, locale),
                "label": _t(block.label, locale),
                "description": _t(block.description, locale),
                "when_to_use": _t(block.when_to_use, locale),
                "adb_command": block.adb_command,
                "template_params": dict(block.template_params),
                "template": {
                    "type": block.type,
                    "name": _t(block.label, locale),
                    "params": dict(block.template_params),
                },
            }
        )

    return results
