import type { FlowStep, StepType } from "./types";
import type { Locale } from "./i18n";
import { isPrivateNetworkIpv4 } from "./utils/privateNetworkIp";

interface LocalizedText {
  en: string;
  "zh-TW": string;
}

interface BlockDefinitionBase {
  type: StepType;
  category: LocalizedText;
  label: LocalizedText;
  description: LocalizedText;
  whenToUse: LocalizedText;
  adbCommand: string;
  template: FlowStep;
}

export interface BlockDefinition {
  type: StepType;
  category: string;
  label: string;
  description: string;
  whenToUse: string;
  adbCommand: string;
  template: FlowStep;
}

const BLOCKS: BlockDefinitionBase[] = [
  {
    type: "wait_for_device",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "Wait For Device", "zh-TW": "等待裝置" },
    description: {
      en: "Wait until ADB confirms the selected device is online.",
      "zh-TW": "等待 ADB 回報裝置為可連線狀態。",
    },
    whenToUse: {
      en: "After reconnecting USB, rebooting, or switching connection mode.",
      "zh-TW": "USB 重連、重開機或切換連線模式後。",
    },
    adbCommand: "adb wait-for-device",
    template: { type: "wait_for_device", name: "Wait For Device", params: {} },
  },
  {
    type: "adb_root",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "ADB Root", "zh-TW": "ADB Root" },
    description: {
      en: "Restart adbd with root privileges on supported rooted devices.",
      "zh-TW": "在支援的 root 裝置上，以 root 權限重啟 adbd。",
    },
    whenToUse: {
      en: "Only when privileged operations are required and device policy allows it.",
      "zh-TW": "僅在需要高權限且裝置政策允許時使用。",
    },
    adbCommand: "adb root",
    template: { type: "adb_root", name: "ADB Root", params: {} },
  },
  {
    type: "wifi_enable_tcpip",
    category: { en: "WiFi ADB", "zh-TW": "WiFi ADB" },
    label: { en: "Enable WiFi ADB (tcpip)", "zh-TW": "啟用 WiFi ADB (tcpip)" },
    description: {
      en: "Switch target device adbd to TCP mode.",
      "zh-TW": "將目標裝置 adbd 切換到 TCP 模式。",
    },
    whenToUse: {
      en: "After initial USB pairing, before connect over WiFi.",
      "zh-TW": "首次 USB 連線配對後、切到 WiFi 前使用。",
    },
    adbCommand: "adb -s <serial> tcpip <port>",
    template: { type: "wifi_enable_tcpip", name: "Enable WiFi ADB", params: { port: 5555 } },
  },
  {
    type: "wifi_connect",
    category: { en: "WiFi ADB", "zh-TW": "WiFi ADB" },
    label: { en: "WiFi Connect", "zh-TW": "WiFi 連線" },
    description: {
      en: "Connect host adb server to device over IP and port.",
      "zh-TW": "透過 IP 與 Port 讓主機 adb 連線到裝置。",
    },
    whenToUse: {
      en: "After tcpip mode is enabled and IP is known.",
      "zh-TW": "已啟用 tcpip 且已取得裝置 IP 後。",
    },
    adbCommand: "adb connect <ip>:<port>",
    template: { type: "wifi_connect", name: "WiFi Connect", params: { host: "192.168.1.100", port: 5555 } },
  },
  {
    type: "wifi_disconnect",
    category: { en: "WiFi ADB", "zh-TW": "WiFi ADB" },
    label: { en: "WiFi Disconnect", "zh-TW": "WiFi 斷線" },
    description: {
      en: "Disconnect one or all WiFi adb targets.",
      "zh-TW": "中斷單一或全部 WiFi adb 連線。",
    },
    whenToUse: {
      en: "Cleanup after tests or when reconnecting unstable links.",
      "zh-TW": "測試結束清理，或網路不穩時重新連線前。",
    },
    adbCommand: "adb disconnect [ip:port]",
    template: { type: "wifi_disconnect", name: "WiFi Disconnect", params: { target: "" } },
  },
  {
    type: "usb_disconnect",
    category: { en: "WiFi ADB", "zh-TW": "WiFi ADB" },
    label: { en: "USB Disconnect", "zh-TW": "USB 斷線" },
    description: {
      en: "Disconnect device by USB serial number. Use this after switching to WiFi to remove USB connection.",
      "zh-TW": "透過 USB 序號中斷裝置連線。在切到 WiFi 後使用此步驟移除 USB 連線。",
    },
    whenToUse: {
      en: "After WiFi Connect, to ensure subsequent commands use WiFi instead of USB.",
      "zh-TW": "在 WiFi 連線後，確保後續指令使用 WiFi 而不是 USB。",
    },
    adbCommand: "adb disconnect <serial>",
    template: { type: "usb_disconnect", name: "USB Disconnect", params: {} },
  },
  {
    type: "wait_for_property",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "Wait For Property", "zh-TW": "等待屬性值" },
    description: {
      en: "Poll a system property until it matches expected value.",
      "zh-TW": "持續輪詢系統屬性，直到符合預期值。",
    },
    whenToUse: {
      en: "Waiting for boot completion or service readiness.",
      "zh-TW": "等待開機完成或服務就緒。",
    },
    adbCommand: "adb shell getprop <property>",
    template: {
      type: "wait_for_property",
      name: "Wait For Property",
      params: { property: "sys.boot_completed", expected: "1", interval_seconds: 1, max_wait_seconds: 60 },
    },
  },
  {
    type: "reboot",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "Reboot", "zh-TW": "重新開機" },
    description: {
      en: "Reboot the selected device with optional mode.",
      "zh-TW": "重啟目前裝置，可選擇模式。",
    },
    whenToUse: { en: "Pre-test reset and reboot scenario testing.", "zh-TW": "測試前重置或重開機情境驗證。" },
    adbCommand: "adb reboot [bootloader|recovery|sideload]",
    template: { type: "reboot", name: "Reboot", params: { mode: "" } },
  },
  {
    type: "wait_boot_completed",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "Check Boot Completed", "zh-TW": "檢查開機完成" },
    description: {
      en: "Read boot completion property once.",
      "zh-TW": "單次讀取開機完成屬性值。",
    },
    whenToUse: { en: "Quick snapshot checks.", "zh-TW": "快速狀態快照檢查。" },
    adbCommand: "adb shell getprop sys.boot_completed",
    template: { type: "wait_boot_completed", name: "Wait Boot Completed", params: {} },
  },
  {
    type: "get_props",
    category: { en: "Device Control", "zh-TW": "裝置控制" },
    label: { en: "Get All Properties", "zh-TW": "取得全部屬性" },
    description: {
      en: "Show one property value or dump all Android properties.",
      "zh-TW": "可查詢單一屬性值，或輸出完整 Android 屬性清單。",
    },
    whenToUse: { en: "Device diagnostics and environment checks.", "zh-TW": "裝置診斷與環境檢查。" },
    adbCommand: "adb shell getprop",
    template: { type: "get_props", name: "Get All Properties", params: { property: "" } },
  },
  {
    type: "wait",
    category: { en: "UI Actions", "zh-TW": "UI 操作" },
    label: { en: "Wait", "zh-TW": "等待" },
    description: { en: "Pause execution for a fixed duration.", "zh-TW": "流程暫停固定秒數。" },
    whenToUse: { en: "Between transitions or animation-heavy actions.", "zh-TW": "介面轉場或動畫後。" },
    adbCommand: "(local delay, no adb command)",
    template: { type: "wait", name: "Wait", params: { seconds: 1 } },
  },
  {
    type: "tap",
    category: { en: "UI Actions", "zh-TW": "UI 操作" },
    label: { en: "Tap", "zh-TW": "點擊" },
    description: { en: "Tap at screen coordinates.", "zh-TW": "點擊螢幕座標。" },
    whenToUse: { en: "Coordinate-based UI interaction tests.", "zh-TW": "以座標做 UI 互動測試。" },
    adbCommand: "adb shell input tap <x> <y>",
    template: { type: "tap", name: "Tap", params: { x: 100, y: 100 } },
  },
  {
    type: "input_text",
    category: { en: "UI Actions", "zh-TW": "UI 操作" },
    label: { en: "Input Text", "zh-TW": "輸入文字" },
    description: { en: "Input text into focused field.", "zh-TW": "在焦點欄位輸入文字。" },
    whenToUse: { en: "Form and search test data injection.", "zh-TW": "表單與搜尋資料輸入。" },
    adbCommand: "adb shell input text <text>",
    template: { type: "input_text", name: "Input Text", params: { text: "hello" } },
  },
  {
    type: "swipe",
    category: { en: "UI Actions", "zh-TW": "UI 操作" },
    label: { en: "Swipe", "zh-TW": "滑動" },
    description: { en: "Swipe with start/end points and duration.", "zh-TW": "依起迄座標與時間進行滑動。" },
    whenToUse: { en: "Scrolling and gesture scenarios.", "zh-TW": "捲動與手勢情境。" },
    adbCommand: "adb shell input swipe <x1> <y1> <x2> <y2> <duration>",
    template: { type: "swipe", name: "Swipe", params: { x1: 100, y1: 500, x2: 100, y2: 100, duration: 300 } },
  },
  {
    type: "keyevent",
    category: { en: "UI Actions", "zh-TW": "UI 操作" },
    label: { en: "Keyevent", "zh-TW": "按鍵事件" },
    description: { en: "Send Android keyevent such as HOME/BACK.", "zh-TW": "送出 Android 按鍵事件（如 HOME/BACK）。" },
    whenToUse: { en: "Navigation and hardware key behavior.", "zh-TW": "導覽與硬體按鍵行為驗證。" },
    adbCommand: "adb shell input keyevent <KEYCODE>",
    template: {
      type: "keyevent",
      name: "Keyevent",
      params: { mode: "preset", preset: "KEYCODE_HOME", custom_keycode: "", keycode: "KEYCODE_HOME" },
    },
  },
  {
    type: "screenshot",
    category: { en: "Capture", "zh-TW": "擷取" },
    label: { en: "Screenshot", "zh-TW": "截圖" },
    description: { en: "Capture screenshot to device storage.", "zh-TW": "擷取螢幕畫面到裝置儲存空間。" },
    whenToUse: { en: "Visual evidence and debug snapshots.", "zh-TW": "視覺證據與除錯快照。" },
    adbCommand: "adb shell screencap -p /sdcard/<file>.png",
    template: {
      type: "screenshot",
      name: "Screenshot",
      params: { save_path: "/sdcard", filename: "", local_pull_dir: "" },
    },
  },
  {
    type: "app_start",
    category: { en: "App Lifecycle", "zh-TW": "App 生命週期" },
    label: { en: "Start App", "zh-TW": "啟動 App" },
    description: { en: "Start app by package/activity or launcher fallback.", "zh-TW": "用 package/activity 或 launcher 方式啟動 App。" },
    whenToUse: { en: "Launch and startup stability checks.", "zh-TW": "啟動流程與穩定性檢查。" },
    adbCommand: "adb shell am start -n <package>/<activity>",
    template: { type: "app_start", name: "Start App", params: { package: "", activity: "" } },
  },
  {
    type: "app_force_stop",
    category: { en: "App Lifecycle", "zh-TW": "App 生命週期" },
    label: { en: "Force Stop App", "zh-TW": "強制停止 App" },
    description: { en: "Force-stop target package.", "zh-TW": "強制停止目標套件。" },
    whenToUse: { en: "Clean start before each case.", "zh-TW": "每次測試前清理狀態。" },
    adbCommand: "adb shell am force-stop <package>",
    template: { type: "app_force_stop", name: "Force Stop App", params: { package: "" } },
  },
  {
    type: "app_clear_data",
    category: { en: "App Lifecycle", "zh-TW": "App 生命週期" },
    label: { en: "Clear App Data", "zh-TW": "清除 App 資料" },
    description: { en: "Clear package data and cache.", "zh-TW": "清除套件資料與快取。" },
    whenToUse: { en: "First-launch and onboarding checks.", "zh-TW": "首次啟動與導覽測試。" },
    adbCommand: "adb shell pm clear <package>",
    template: { type: "app_clear_data", name: "Clear App Data", params: { package: "" } },
  },
  {
    type: "install_apk",
    category: { en: "App Lifecycle", "zh-TW": "App 生命週期" },
    label: { en: "Install APK", "zh-TW": "安裝 APK" },
    description: { en: "Install or replace APK on device.", "zh-TW": "安裝或覆蓋 APK 到裝置。" },
    whenToUse: { en: "Install, upgrade, and smoke checks.", "zh-TW": "安裝、升級與 smoke test。" },
    adbCommand: "adb install -r <apk_path>",
    template: {
      type: "install_apk",
      name: "Install APK",
      params: { apk_path: "", allow_downgrade: false, grant_permissions: true },
    },
  },
  {
    type: "uninstall_package",
    category: { en: "App Lifecycle", "zh-TW": "App 生命週期" },
    label: { en: "Uninstall Package", "zh-TW": "卸載套件" },
    description: { en: "Uninstall package with optional data retention.", "zh-TW": "卸載套件，可選擇保留資料。" },
    whenToUse: { en: "Cleanup and uninstall/reinstall tests.", "zh-TW": "清理環境與卸載重裝測試。" },
    adbCommand: "adb uninstall [-k] <package>",
    template: { type: "uninstall_package", name: "Uninstall Package", params: { package: "", keep_data: false } },
  },
  {
    type: "custom_command",
    category: { en: "Custom", "zh-TW": "自訂" },
    label: { en: "Custom Command", "zh-TW": "自訂指令" },
    description: { en: "Run user-defined adb command under current safety policy.", "zh-TW": "在目前安全策略下執行自訂 adb 指令。" },
    whenToUse: { en: "Advanced operation not covered by built-ins.", "zh-TW": "內建方塊尚未涵蓋的進階操作。" },
    adbCommand: "adb <custom args>",
    template: { type: "custom_command", name: "Custom Command", params: { command: "adb shell getprop ro.build.version.release" } },
  },
];

function t(text: LocalizedText, locale: Locale): string {
  return text[locale];
}

export function getBlockDefinitions(locale: Locale): BlockDefinition[] {
  return BLOCKS.map((block) => ({
    type: block.type,
    category: t(block.category, locale),
    label: t(block.label, locale),
    description: t(block.description, locale),
    whenToUse: t(block.whenToUse, locale),
    adbCommand: block.adbCommand,
    template: {
      ...block.template,
      params: { ...block.template.params },
    },
  }));
}

export function getBlockDefinitionByType(type: StepType, locale: Locale): BlockDefinition | undefined {
  return getBlockDefinitions(locale).find((item) => item.type === type);
}

function isPositiveNumber(value: unknown): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function isNonNegativeNumber(value: unknown): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
}

function makeMessage(locale: Locale, en: string, zh: string): string {
  return locale === "en" ? en : zh;
}

export function validateStep(step: FlowStep, locale: Locale): string[] {
  const errors: string[] = [];

  if (!step.name.trim()) {
    errors.push(makeMessage(locale, "Step name is required.", "步驟名稱必填。"));
  }

  if (step.timeout_seconds != null) {
    const tmo = Number(step.timeout_seconds);
    if (!Number.isInteger(tmo) || tmo < 1 || tmo > 600) {
      errors.push(makeMessage(locale, "timeout_seconds must be between 1 and 600.", "timeout_seconds 必須介於 1 到 600。"));
    }
  }

  const p = step.params;
  switch (step.type) {
    case "wait": {
      const v = Number(p.seconds);
      if (!Number.isFinite(v) || v < 0 || v > 300) {
        errors.push(makeMessage(locale, "seconds must be 0-300.", "seconds 必須在 0-300。"));
      }
      break;
    }
    case "tap": {
      if (!isNonNegativeNumber(p.x) || !isNonNegativeNumber(p.y)) {
        errors.push(makeMessage(locale, "x and y must be non-negative numbers.", "x 與 y 必須為非負數。"));
      }
      break;
    }
    case "input_text": {
      if (!String(p.text ?? "").trim()) {
        errors.push(makeMessage(locale, "text is required.", "text 必填。"));
      }
      break;
    }
    case "swipe": {
      const keys = ["x1", "y1", "x2", "y2"] as const;
      for (const key of keys) {
        if (!isNonNegativeNumber(p[key])) {
          errors.push(makeMessage(locale, `${key} must be a non-negative number.`, `${key} 必須為非負數。`));
        }
      }
      if (!isPositiveNumber(p.duration)) {
        errors.push(makeMessage(locale, "duration must be a positive number.", "duration 必須為正數。"));
      }
      break;
    }
    case "reboot": {
      const mode = String(p.mode ?? "").trim();
      if (mode && !["bootloader", "recovery", "sideload"].includes(mode)) {
        errors.push(makeMessage(locale, "mode must be empty or one of bootloader/recovery/sideload.", "mode 只能留空或使用 bootloader/recovery/sideload。"));
      }
      break;
    }
    case "keyevent": {
      const mode = String(p.mode ?? "preset").trim();
      if (mode !== "preset" && mode !== "custom") {
        errors.push(makeMessage(locale, "mode must be preset or custom.", "mode 必須是 preset 或 custom。"));
      }
      if (mode === "custom") {
        if (!String(p.custom_keycode ?? "").trim()) {
          errors.push(makeMessage(locale, "custom_keycode is required in custom mode.", "custom 模式下 custom_keycode 必填。"));
        }
      } else if (!String(p.preset ?? p.keycode ?? "").trim()) {
        errors.push(makeMessage(locale, "preset is required in preset mode.", "preset 模式下 preset 必填。"));
      }
      break;
    }
    case "screenshot": {
      const savePath = String(p.save_path ?? "/sdcard").trim();
      if (!savePath.startsWith("/")) {
        errors.push(makeMessage(locale, "save_path must start with '/'.", "save_path 必須以 '/' 開頭。"));
      }
      const filename = String(p.filename ?? "").trim();
      if (filename.includes("/") || filename.includes("\\")) {
        errors.push(makeMessage(locale, "filename must not include path separators.", "filename 不可包含路徑分隔符。"));
      }
      break;
    }
    case "app_start": {
      if (!String(p.package ?? "").trim()) {
        errors.push(makeMessage(locale, "package is required.", "package 必填。"));
      }
      break;
    }
    case "app_force_stop":
    case "app_clear_data":
    case "uninstall_package": {
      if (!String(p.package ?? "").trim()) {
        errors.push(makeMessage(locale, "package is required.", "package 必填。"));
      }
      break;
    }
    case "install_apk": {
      const apk = String(p.apk_path ?? "").trim();
      if (!apk) {
        errors.push(makeMessage(locale, "apk_path is required.", "apk_path 必填。"));
      } else if (!apk.toLowerCase().endsWith(".apk")) {
        errors.push(makeMessage(locale, "apk_path should end with .apk.", "apk_path 應以 .apk 結尾。"));
      }
      break;
    }
    case "wait_for_property": {
      if (!String(p.property ?? "").trim()) {
        errors.push(makeMessage(locale, "property is required.", "property 必填。"));
      }
      if (!String(p.expected ?? "").trim()) {
        errors.push(makeMessage(locale, "expected is required.", "expected 必填。"));
      }
      if (!isPositiveNumber(p.interval_seconds)) {
        errors.push(makeMessage(locale, "interval_seconds must be a positive number.", "interval_seconds 必須為正數。"));
      }
      if (!isPositiveNumber(p.max_wait_seconds)) {
        errors.push(makeMessage(locale, "max_wait_seconds must be a positive number.", "max_wait_seconds 必須為正數。"));
      }
      break;
    }
    case "adb_root": {
      break;
    }
    case "wifi_enable_tcpip": {
      const port = Number(p.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(makeMessage(locale, "port must be an integer between 1 and 65535.", "port 必須是 1 到 65535 的整數。"));
      }
      break;
    }
    case "wifi_connect": {
      const host = String(p.host ?? "").trim();
      if (!host) {
        errors.push(makeMessage(locale, "host is required.", "host 必填。"));
      } else if (!isPrivateNetworkIpv4(host)) {
        errors.push(
          makeMessage(
            locale,
            "host must be a private-network IPv4 (10.x, 172.16-31.x, 192.168.x, 127.x, or 169.254.x).",
            "host 必須是內網 IPv4（10.x、172.16-31.x、192.168.x、127.x 或 169.254.x）。"
          )
        );
      }
      const port = Number(p.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(makeMessage(locale, "port must be an integer between 1 and 65535.", "port 必須是 1 到 65535 的整數。"));
      }
      break;
    }
    case "wifi_disconnect": {
      const target = String(p.target ?? "").trim();
      if (target && !target.includes(":")) {
        errors.push(makeMessage(locale, "target should be ip:port, or keep empty for all.", "target 應為 ip:port，或留空代表全部。"));
      }
      break;
    }
    case "usb_disconnect": {
      // No parameters required for USB disconnect
      break;
    }
    case "custom_command": {
      if (!String(p.command ?? "").trim()) {
        errors.push(makeMessage(locale, "command is required.", "command 必填。"));
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

export function searchBlocks(blocks: BlockDefinition[], query: string): BlockDefinition[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return blocks;
  }

  return blocks.filter((block) => {
    const text = [
      block.category,
      block.label,
      block.description,
      block.whenToUse,
      block.adbCommand,
      block.type,
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(keyword);
  });
}
