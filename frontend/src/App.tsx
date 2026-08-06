import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { validateStep } from "./blockCatalog";
import { LoginPage } from "./components/LoginPage";
import { StepBuilder } from "./components/StepBuilder";
import { formatText, uiText, type Locale } from "./i18n";
import type {
  ApkUploadResponse,
  AppPackagesResponse,
  DeviceInfo,
  ExplorerBatchOperationResponse,
  ExplorerItem,
  ExplorerListResponse,
  ExplorerOperation,
  ExplorerOperationResponse,
  ExplorerUploadResponse,
  ExecuteFlowResponse,
  FlowStep,
  LogExportInfo,
  ServerLogEntry,
  ServerLogsStreamResponse,
  StepType,
  WifiDetectCandidate,
  WifiDetectResponse,
} from "./types";
import { appLogger } from "./utils/appLogger";
import { clearAuthSession, getAuthHeaders, isLoggedIn, logout } from "./utils/authClient";
import { isPrivateNetworkIpv4 } from "./utils/privateNetworkIp";
import "./styles.css";

const DEFAULT_API_BASE = "http://127.0.0.1:8000/api";
const API_BASE = (import.meta.env.VITE_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
const WIFI_PROFILES_STORAGE_KEY = "adb-editor-wifi-profiles";
const LOCALE_STORAGE_KEY = "adb-editor-locale";
const EXPLORER_LIST_TIMEOUT_MS = 12_000;
const EXPLORER_REFRESH_DEBOUNCE_MS = 250;


interface WifiProfile {
  host: string;
  port: number;
}

type WifiDetectViewState = "idle" | "loading" | "detected" | "partial-success" | "error" | "empty";
type GenericViewState = "idle" | "loading" | "success" | "partial-success" | "error" | "empty";
type AppTab = "flow" | "logs" | "explorer";
type ExecutionPhase = "idle" | "running" | "success" | "failed";

interface ScreenshotPreviewItem {
  stepIndex: number;
  stepName: string;
  imageName: string;
  localPath: string;
}

type ExplorerStatusMessageCode =
  | "idle"
  | "select-device-first"
  | "loading-directory"
  | "http-error"
  | "contract-mismatch"
  | "permission-denied"
  | "directory-empty"
  | "no-valid-items"
  | "directory-loaded"
  | "raw";

type ExplorerOperationMessageCode =
  | "idle"
  | "select-device-first"
  | "unsafe-state"
  | "selected-file-empty"
  | "selected-file-too-large"
  | "uploading"
  | "http-error"
  | "upload-contract-mismatch"
  | "upload-success"
  | "running-operation"
  | "selection-required"
  | "rename-selection-required"
  | "rename-name-required"
  | "mkdir-name-required"
  | "single-selection-only"
  | "batch-contract-mismatch"
  | "batch-success"
  | "batch-partial"
  | "batch-failed"
  | "operation-success"
  | "raw";

interface ExplorerMessageMeta<TCode extends string> {
  code: TCode;
  detail?: string;
}

interface BlockCatalogResponseItem {
  type: StepType;
  category: string;
  label: string;
  description: string;
  when_to_use: string;
  adb_command: string;
  is_condition: boolean;
  template?: {
    type: StepType;
    name: string;
    params: Record<string, string | number | boolean>;
    timeout_seconds?: number;
  };
  template_params?: Record<string, string | number | boolean>;
}

interface ApiErrorMeta {
  detail: string;
  code: string;
  requestId: string;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    if (saved === "en" || saved === "zh-TW") {
      return saved;
    }
    const langs = (typeof navigator !== "undefined" && Array.isArray(navigator.languages) && navigator.languages.length > 0)
      ? navigator.languages
      : [typeof navigator !== "undefined" ? navigator.language : "en"];
    const normalized = langs.map((item) => String(item || "").toLowerCase());
    return normalized.some((item) => item.startsWith("zh")) ? "zh-TW" : "en";
  });
  const text = uiText[locale];
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [results, setResults] = useState<ExecuteFlowResponse | null>(null);
  const [executionPhase, setExecutionPhase] = useState<ExecutionPhase>("idle");
  const [showScreenshots, setShowScreenshots] = useState(true);
  const [loading, setLoading] = useState(false);
  const [experimentalShell, setExperimentalShell] = useState(false);
  const [commandTimeoutSeconds, setCommandTimeoutSeconds] = useState(30);
  const [flowTimeoutSeconds, setFlowTimeoutSeconds] = useState(300);
  const [wifiHost, setWifiHost] = useState("192.168.1.100");
  const [wifiPort, setWifiPort] = useState(5555);
  const [wifiDetectState, setWifiDetectState] = useState<WifiDetectViewState>("idle");
  const [wifiDetectMessage, setWifiDetectMessage] = useState("");
  const [wifiDetectCandidates, setWifiDetectCandidates] = useState<WifiDetectCandidate[]>([]);
  const [wifiInternalConfirmed, setWifiInternalConfirmed] = useState(false);
  const [wifiProfiles, setWifiProfiles] = useState<WifiProfile[]>([]);
  const [originalUsbSerial, setOriginalUsbSerial] = useState(""); // ⭐ Store original USB device
  const [currentWifiTarget, setCurrentWifiTarget] = useState(""); // ⭐ Track current WiFi target (IP:Port)
  // Auth state
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>("flow");

  const [logFilterHours, setLogFilterHours] = useState(24);
  const [logFilterLevels, setLogFilterLevels] = useState("INFO,WARN,ERROR");
  const [logFilterKeyword, setLogFilterKeyword] = useState("");
  const [logChunkMb, setLogChunkMb] = useState(10);
  const [logExportState, setLogExportState] = useState<GenericViewState>("idle");
  const [logExportMessage, setLogExportMessage] = useState("");
  const [logExportInfo, setLogExportInfo] = useState<LogExportInfo | null>(null);

  const [explorerPath, setExplorerPath] = useState("/");
  const [explorerItems, setExplorerItems] = useState<ExplorerItem[]>([]);
  const [explorerState, setExplorerState] = useState<GenericViewState>("idle");
  const [explorerMessage, setExplorerMessage] = useState("");
  const [explorerMessageMeta, setExplorerMessageMeta] = useState<ExplorerMessageMeta<ExplorerStatusMessageCode>>({ code: "idle" });
  const [explorerSearchQuery, setExplorerSearchQuery] = useState("");
  const [explorerSelectedPaths, setExplorerSelectedPaths] = useState<string[]>([]);
  const [explorerOpState, setExplorerOpState] = useState<GenericViewState>("idle");
  const [explorerOpMessage, setExplorerOpMessage] = useState("");
  const [explorerOpMessageMeta, setExplorerOpMessageMeta] = useState<ExplorerMessageMeta<ExplorerOperationMessageCode>>({ code: "idle" });
  const [operationTargetPath, setOperationTargetPath] = useState("");
  const [operationName, setOperationName] = useState("");
  const [explorerUploadFileName, setExplorerUploadFileName] = useState("");
  const [explorerUploadProgress, setExplorerUploadProgress] = useState<number | null>(null);

  const [serverLogState, setServerLogState] = useState<GenericViewState>("idle");
  const [serverLogMessage, setServerLogMessage] = useState("");
  const [serverLogEntries, setServerLogEntries] = useState<ServerLogEntry[]>([]);
  const [serverLogCursor, setServerLogCursor] = useState(0);
  const [serverLogKeyword, setServerLogKeyword] = useState("");
  const [serverLogIntervalSeconds, setServerLogIntervalSeconds] = useState(10);
  const [serverLogAutoRefresh, setServerLogAutoRefresh] = useState(true);
  const [serverLogMaxEntries, setServerLogMaxEntries] = useState(500);

  const hasMultipleExplorerSelection = explorerSelectedPaths.length > 1;
  const hasValidSelectedDevice = selectedDevice !== "" && devices.some((device) => device.serial === selectedDevice);
  const wifiConnectControlsDisabled = loading || !hasValidSelectedDevice;
  const explorerUploadTarget = operationTargetPath.trim() || explorerPath;
  const visibleExplorerItems = explorerItems;
  const validSelectedExplorerPaths = explorerSelectedPaths.filter((path) => visibleExplorerItems.some((item) => item.path === path && item.item_type !== "other" && item.is_valid));
  const hasSelectedExplorerItems = validSelectedExplorerPaths.length > 0;
  const filteredExplorerItems = visibleExplorerItems.filter((item) => {
    const keyword = explorerSearchQuery.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return `${item.name} ${item.path}`.toLowerCase().includes(keyword);
  });
  const explorerListBlocked = explorerState === "loading" || explorerState === "error";
  const explorerHasStatusIssue = explorerState === "loading" || explorerState === "error" || explorerState === "partial-success";
  const explorerOpBlocked = explorerOpState === "loading";
  const explorerBaseOpsAllowed = hasValidSelectedDevice && !explorerHasStatusIssue && !explorerOpBlocked;
  const explorerHasValidItems = explorerItems.some((item) => item.is_valid && item.item_type !== "other");
  const explorerCanUpload = explorerBaseOpsAllowed && (explorerState === "success" || explorerState === "empty");
  const explorerCanPullDelete = explorerBaseOpsAllowed && explorerState === "success" && hasSelectedExplorerItems;
  const explorerCanMkdir = explorerBaseOpsAllowed && (explorerState === "success" || explorerState === "empty");
  const explorerCanRename = explorerBaseOpsAllowed && explorerState === "success" && validSelectedExplorerPaths.length === 1;

  const flowFileInputRef = useRef<HTMLInputElement | null>(null);
  const explorerUploadInputRef = useRef<HTMLInputElement | null>(null);
  const noDeviceAlertShownRef = useRef(false);
  const explorerListInFlightRef = useRef(false);
  const pendingExplorerRefreshRef = useRef<{ silent: boolean; pathOverride?: string } | null>(null);
  const explorerRefreshDebounceRef = useRef<number | null>(null);

  /**
   * Thin fetch wrapper that injects Authorization header when auth is enabled.
   * All API calls must go through this function.
   */
  const apiFetch = (url: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
      ...(authEnabled ? getAuthHeaders() : {}),
    };
    return fetch(url, { ...init, headers }).then((response) => {
      if (authEnabled && response.status === 401) {
        clearAuthSession();
        setAuthed(false);
      }
      return response;
    });
  };

  const loadBlocks = async (targetLocale: Locale): Promise<BlockCatalogResponseItem[]> => {
    const params = new URLSearchParams({
      locale: targetLocale,
    });
    const response = await apiFetch(`${API_BASE}/blocks?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch blocks: ${response.status}`);
    }
    const payload = (await response.json()) as Array<Partial<BlockCatalogResponseItem>>;
    return payload.map((item) => ({
      type: item.type as StepType,
      category: item.category ?? "",
      label: item.label ?? "",
      description: item.description ?? "",
      when_to_use: item.when_to_use ?? "",
      adb_command: item.adb_command ?? "",
      is_condition: item.is_condition ?? false,
      template: item.template,
      template_params: item.template_params,
    }));
  };

  const loadThirdPartyPackages = async (deviceSerial: string): Promise<string[]> => {
    const query = new URLSearchParams({ device_serial: deviceSerial });
    const response = await apiFetch(`${API_BASE}/apps/third-party-packages?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch packages: ${response.status}`);
    }
    const payload = (await response.json()) as AppPackagesResponse;
    if (!payload || !Array.isArray(payload.packages)) {
      return [];
    }
    return payload.packages
      .map((item) => String(item.package ?? "").trim())
      .filter(Boolean);
  };

  const uploadApkToBackendWithProgress = async (file: File, onProgress?: (percent: number) => void): Promise<string> => {
    const formData = new FormData();
    formData.append("apk_file", file, file.name);

    const payload = await uploadWithProgress<ApkUploadResponse>(
      `${API_BASE}/apk/upload-file`,
      formData,
      onProgress
    );
    if (!payload || !payload.host_path) {
      throw new Error("APK upload response contract mismatch");
    }
    return payload.host_path;
  };

  const parseScreenshotFromOutput = (output: string) => {
    const localPathMatch = output.match(/\[screenshot_local_path\]\s+(.+)/);
    const webNameMatch = output.match(/\[screenshot_web_name\]\s+(.+)/);
    const localPath = localPathMatch?.[1]?.trim() ?? "";
    const imageName = webNameMatch?.[1]?.trim() ?? "";
    return {
      localPath,
      imageName,
      previewUrl: imageName ? `${API_BASE}/artifacts/screenshot?name=${encodeURIComponent(imageName)}` : "",
    };
  };

  const formatRequestErrorMessage = (error: unknown) => {
    if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
      return `${text.requestFailedNetworkHint} (${API_BASE})`;
    }
    return `Request failed: ${String(error)}`;
  };

  const parseWifiDetectResponse = (payload: unknown): WifiDetectResponse | null => {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const data = payload as Partial<WifiDetectResponse>;
    const selectedHostValid = data.selected_host === null || typeof data.selected_host === "string";
    const candidatesValid = Array.isArray(data.candidates)
      && data.candidates.every((item) => (
        item
        && typeof item.host === "string"
        && typeof item.port === "number"
        && typeof item.interface === "string"
        && typeof item.gateway === "string"
        && (item.source === "ip_route" || item.source === "ifconfig")
      ));
    if (
      typeof data.success !== "boolean" ||
      (data.status !== "detected" && data.status !== "ambiguous" && data.status !== "failed") ||
      !selectedHostValid ||
      typeof data.selected_port !== "number" ||
      typeof data.reason_code !== "string" ||
      typeof data.message !== "string" ||
      !candidatesValid
    ) {
      return null;
    }

    return data as WifiDetectResponse;
  };

  const t = (en: string, zhTw: string) => (locale === "en" ? en : zhTw);

  const resolveExplorerStatusMessage = (meta: ExplorerMessageMeta<ExplorerStatusMessageCode>) => {
    switch (meta.code) {
      case "select-device-first":
        return t("Select a device first.", "請先選擇裝置。");
      case "loading-directory":
        return t("Loading directory...", "正在讀取目錄...");
      case "http-error":
        return `HTTP: ${meta.detail ?? "unknown"}`;
      case "contract-mismatch":
        return t("Explorer response contract mismatch.", "Explorer 回應契約不一致。");
      case "permission-denied":
        return t("Path permission denied.", "該路徑無讀取權限。");
      case "directory-empty":
        return t("Directory is empty.", "目錄目前為空。");
      case "no-valid-items":
        return t("No valid items are available in this directory.", "目前目錄中沒有可操作的有效項目。");
      case "directory-loaded":
        return t("Directory loaded.", "目錄讀取完成。");
      case "raw":
        return meta.detail ?? "";
      case "idle":
      default:
        return "";
    }
  };

  const resolveExplorerOpMessage = (meta: ExplorerMessageMeta<ExplorerOperationMessageCode>) => {
    switch (meta.code) {
      case "select-device-first":
        return t("Select a device first.", "請先選擇裝置。");
      case "unsafe-state":
        return t(
          "Directory status is not safe for file operations. Refresh and try again.",
          "目前清單狀態不安全，請先重新整理成功後再執行檔案操作。"
        );
      case "selected-file-empty":
        return t("Selected file is empty.", "選取的檔案不可為空。");
      case "selected-file-too-large":
        return t("Selected file exceeds 500MB.", "選取檔案超過 500MB 限制。");
      case "uploading":
        return t("Uploading file...", "正在上傳檔案...");
      case "http-error":
        return `HTTP: ${meta.detail ?? "unknown"}`;
      case "upload-contract-mismatch":
        return t("Upload response contract mismatch.", "上傳回應契約不一致。");
      case "upload-success":
        return t("Upload completed.", "上傳完成。");
      case "running-operation":
        return t("Running operation...", "正在執行操作...");
      case "selection-required":
        return t("Select at least one file or folder first.", "請先選取至少一個檔案或資料夾。");
      case "rename-selection-required":
        return t("Rename requires exactly one selected item.", "重新命名需要且僅允許選取一個項目。");
      case "rename-name-required":
        return t("Rename target name is required.", "請先輸入重新命名目標名稱。");
      case "mkdir-name-required":
        return t("Mkdir requires a directory name.", "新增資料夾需要先輸入名稱。");
      case "single-selection-only":
        return t(
          "Mkdir and rename are only allowed for single selection.",
          "多選時僅允許下載與刪除，無法執行新增資料夾或重新命名。"
        );
      case "batch-contract-mismatch":
        return t("Batch response contract mismatch.", "批次操作回應契約不一致。");
      case "batch-success":
        return t("Batch operation completed.", "批次操作完成。");
      case "batch-partial":
        return meta.detail ?? t("Batch operation partially succeeded.", "批次操作部分成功。");
      case "batch-failed":
        return meta.detail ?? t("Batch operation failed.", "批次操作失敗。");
      case "operation-success":
        return t("Operation completed.", "操作完成。");
      case "raw":
        return meta.detail ?? "";
      case "idle":
      default:
        return "";
    }
  };

  const setExplorerStatusMessage = (meta: ExplorerMessageMeta<ExplorerStatusMessageCode>) => {
    setExplorerMessageMeta(meta);
    setExplorerMessage(resolveExplorerStatusMessage(meta));
  };

  const setExplorerOperationMessage = (meta: ExplorerMessageMeta<ExplorerOperationMessageCode>) => {
    setExplorerOpMessageMeta(meta);
    setExplorerOpMessage(resolveExplorerOpMessage(meta));
  };

  const parseApiError = async (response: Response): Promise<ApiErrorMeta> => {
    const fallbackDetail = response.statusText || "unknown";
    try {
      const data = await response.json();
      if (typeof data === "object" && data !== null) {
        const obj = data as {
          detail?: unknown;
          message?: unknown;
          code?: unknown;
          request_id?: unknown;
        };
        const detail = typeof obj.detail === "string"
          ? obj.detail
          : (typeof obj.message === "string" ? obj.message : fallbackDetail);
        return {
          detail,
          code: typeof obj.code === "string" ? obj.code : "unknown",
          requestId: typeof obj.request_id === "string" ? obj.request_id : "",
        };
      }
      return { detail: JSON.stringify(data), code: "unknown", requestId: "" };
    } catch {
      return { detail: fallbackDetail, code: "unknown", requestId: "" };
    }
  };

  const formatApiHttpError = (status: number, error: ApiErrorMeta): string => {
    const requestSuffix = error.requestId
      ? ` (${t("Request ID", "請求編號")}: ${error.requestId})`
      : "";

    if (status === 401) {
      return `${t("HTTP 401: Unauthorized. Please sign in again.", "HTTP 401: 未授權，請重新登入。")}${requestSuffix}`;
    }
    if (status === 429) {
      return `${t("HTTP 429: Too many attempts. Try again later.", "HTTP 429: 嘗試次數過多，請稍後再試。")}${requestSuffix}`;
    }
    if (status === 503) {
      return `${t("HTTP 503: Login is not configured on this server.", "HTTP 503: 伺服器尚未完成登入設定。")}${requestSuffix}`;
    }
    if (status >= 500) {
      return `${t("HTTP 5xx: Server error. Please try again later.", "HTTP 5xx: 伺服器錯誤，請稍後再試。")}${requestSuffix}`;
    }
    return `HTTP ${status}: ${error.detail || "unknown"}${requestSuffix}`;
  };

  const parseLevels = (raw: string) => raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  const uploadWithProgress = async <T,>(
    url: string,
    formData: FormData,
    onProgress?: (percent: number) => void
  ): Promise<T> => {
    const headers = authEnabled ? getAuthHeaders() : {};

    return await new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);

      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !onProgress) {
          return;
        }
        const percent = Math.max(0, Math.min(100, (event.loaded / event.total) * 100));
        onProgress(percent);
      };

      xhr.onerror = () => reject(new Error("Network upload failed."));
      xhr.onabort = () => reject(new Error("Upload aborted."));
      xhr.onload = () => {
        const textBody = xhr.responseText || "";
        let payload: unknown = null;
        try {
          payload = textBody ? JSON.parse(textBody) : null;
        } catch {
          payload = textBody;
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          const detail = payload && typeof payload === "object" && "detail" in (payload as Record<string, unknown>)
            ? String((payload as Record<string, unknown>).detail ?? "unknown")
            : textBody || `HTTP ${xhr.status}`;
          reject(new Error(`HTTP ${xhr.status}: ${detail}`));
          return;
        }

        resolve(payload as T);
      };

      xhr.send(formData);
    });
  };

  const exportServerLogs = async () => {
    setLogExportState("loading");
    setLogExportMessage(t("Preparing log export...", "正在準備匯出 Logs..."));
    setLogExportInfo(null);

    try {
      const levels = parseLevels(logFilterLevels);
      const query = new URLSearchParams({
        last_hours: String(Math.max(1, Math.min(24 * 30, logFilterHours))),
        keyword: logFilterKeyword.trim(),
        max_chunk_size_mb: String(Math.max(1, Math.min(200, logChunkMb))),
      });
      for (const level of levels) {
        query.append("levels", level);
      }

      const infoResponse = await apiFetch(`${API_BASE}/logs/export?${query.toString()}`);
      if (!infoResponse.ok) {
        const errorMeta = await parseApiError(infoResponse);
        setLogExportState("error");
        setLogExportMessage(formatApiHttpError(infoResponse.status, errorMeta));
        return;
      }

      const info = (await infoResponse.json()) as LogExportInfo;
      setLogExportInfo(info);

      const downloadResponse = await apiFetch(`${API_BASE}/logs/download?${query.toString()}`);
      if (!downloadResponse.ok) {
        const errorMeta = await parseApiError(downloadResponse);
        setLogExportState("error");
        setLogExportMessage(formatApiHttpError(downloadResponse.status, errorMeta));
        return;
      }

      const blob = await downloadResponse.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = info.file_name;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);

      if (info.exported_lines === 0) {
        setLogExportState("empty");
        setLogExportMessage(t("No log lines matched current filters.", "目前篩選條件沒有符合的 Logs。"));
      } else if (info.exported_lines < info.total_lines) {
        setLogExportState("partial-success");
        setLogExportMessage(t("Export succeeded with filtered subset.", "匯出成功，但僅包含篩選後子集合。"));
      } else {
        setLogExportState("success");
        setLogExportMessage(t("Logs exported successfully.", "Logs 匯出成功。"));
      }
    } catch (error) {
      setLogExportState("error");
      setLogExportMessage(formatRequestErrorMessage(error));
    }
  };

  const parseExplorerListResponse = (payload: unknown): ExplorerListResponse | null => {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const data = payload as Partial<ExplorerListResponse>;
    if (
      typeof data.success !== "boolean"
      || typeof data.path !== "string"
      || !Array.isArray(data.items)
      || (data.permission_state !== "readable" && data.permission_state !== "denied")
      || typeof data.message !== "string"
    ) {
      return null;
    }

    const itemsValid = data.items.every((item) => (
      item
      && typeof item.name === "string"
      && typeof item.path === "string"
      && (item.item_type === "file" || item.item_type === "directory" || item.item_type === "other")
      && typeof item.size === "number"
      && typeof item.mtime === "string"
      && (item.permission_state === "readable" || item.permission_state === "denied")
      && typeof item.is_valid === "boolean"
      && typeof item.invalid_reason === "string"
    ));

    if (!itemsValid) {
      return null;
    }

    return data as ExplorerListResponse;
  };

  const normalizeExplorerPath = (rawPath: string) => {
    let normalized = rawPath.trim().replace(/\\/g, "/");
    if (!normalized) {
      return "/";
    }
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }
    normalized = normalized.replace(/\/{2,}/g, "/");
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized || "/";
  };

  const shouldSuppressMalformedExplorerItem = (currentPathRaw: string, item: ExplorerItem) => {
    const currentPath = normalizeExplorerPath(currentPathRaw);
    const rawItemPath = item.path.trim().replace(/\\/g, "/");
    const normalizedItemPath = normalizeExplorerPath(rawItemPath);
    const currentParts = currentPath.split("/").filter(Boolean);
    const currentBaseName = currentParts.length > 0 ? currentParts[currentParts.length - 1] : "";
    const sameAsCurrent = normalizedItemPath === currentPath;
    const duplicatedSelfPath = currentBaseName !== ""
      && item.name === currentBaseName
      && normalizedItemPath === `${currentPath}/${currentBaseName}`
      && rawItemPath.includes("//");

    return sameAsCurrent || duplicatedSelfPath;
  };

  const parseExplorerDeviceErrorMessage = (detail: string) => {
    if (detail.startsWith("DEVICE_OFFLINE:")) {
      return t("Selected device is offline. Reconnect and refresh first.", "目標裝置目前離線，請先重新連線並刷新清單。");
    }
    if (detail.startsWith("DEVICE_NOT_FOUND:")) {
      return t("Selected device was not found. Connect device and refresh first.", "找不到目標裝置，請先連接裝置後重新整理。");
    }
    if (detail.startsWith("DEVICE_UNAUTHORIZED:")) {
      return t("Selected device is unauthorized. Confirm USB debugging authorization first.", "目標裝置尚未授權，請先在裝置上確認 USB 偵錯授權。");
    }
    return "";
  };

  const resetExplorerToSafeState = (message: string) => {
    setExplorerItems([]);
    setExplorerSelectedPaths([]);
    setExplorerState("error");
    setExplorerStatusMessage({ code: "raw", detail: message });
    setExplorerOpState("error");
    setExplorerOperationMessage({ code: "raw", detail: message });
  };

  const handleExplorerApiError = (status: number, detail: string) => {
    const deviceErrorMessage = parseExplorerDeviceErrorMessage(detail);
    if (deviceErrorMessage) {
      resetExplorerToSafeState(deviceErrorMessage);
      if (detail.startsWith("DEVICE_NOT_FOUND:")) {
        refreshDevices(true).catch(() => {
          appLogger.warn("explorer_device_not_found_refresh_failed");
        });
      }
      return true;
    }
    return false;
  };

  const goExplorerParent = () => {
    const currentPath = normalizeExplorerPath(explorerPath);
    if (!currentPath || currentPath === "/") {
      return;
    }
    const normalized = currentPath.endsWith("/") && currentPath.length > 1
      ? currentPath.slice(0, -1)
      : currentPath;
    const slash = normalized.lastIndexOf("/");
    const parent = slash <= 0 ? "/" : normalized.slice(0, slash);
    const nextPath = parent || "/";
    setExplorerPath(nextPath);
    setExplorerSearchQuery("");
    scheduleExplorerRefresh(false, nextPath);
  };

  const getExplorerParentPath = (rawPath: string) => {
    const currentPath = normalizeExplorerPath(rawPath);
    if (!currentPath || currentPath === "/") {
      return "/";
    }
    const normalized = currentPath.endsWith("/") && currentPath.length > 1
      ? currentPath.slice(0, -1)
      : currentPath;
    const slash = normalized.lastIndexOf("/");
    return slash <= 0 ? "/" : normalized.slice(0, slash) || "/";
  };

  const refreshExplorer = async (silent = false, pathOverride?: string) => {
    if (explorerListInFlightRef.current) {
      pendingExplorerRefreshRef.current = { silent, pathOverride };
      return;
    }

    if (!selectedDevice) {
      setExplorerState("error");
      setExplorerStatusMessage({ code: "select-device-first" });
      return;
    }

    const targetPath = normalizeExplorerPath(pathOverride ?? explorerPath);

    if (!silent) {
      setExplorerState("loading");
      setExplorerStatusMessage({ code: "loading-directory" });
    }

    explorerListInFlightRef.current = true;
    try {
      const controller = new AbortController();
      const timeoutHandle = window.setTimeout(() => controller.abort(), EXPLORER_LIST_TIMEOUT_MS);
      const query = new URLSearchParams({
        device_serial: selectedDevice,
        path: targetPath,
      });
      const response = await apiFetch(`${API_BASE}/explorer/list?${query.toString()}`, { signal: controller.signal });
      window.clearTimeout(timeoutHandle);
      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        const detail = errorMeta.detail;
        if (handleExplorerApiError(response.status, detail)) {
          return;
        }

        if (response.status === 400 && targetPath !== "/") {
          const fallbackPath = getExplorerParentPath(targetPath);
          if (fallbackPath !== targetPath) {
            setExplorerPath(fallbackPath);
            setExplorerSearchQuery("");
            setExplorerSelectedPaths([]);
            setExplorerState("loading");
            setExplorerStatusMessage({
              code: "raw",
              detail: t(
                "Current path is unavailable. Falling back to parent path...",
                "目前路徑不可用，正在回退到上一層路徑..."
              ),
            });
            pendingExplorerRefreshRef.current = { silent: true, pathOverride: fallbackPath };
            return;
          }
        }

        if (response.status === 400) {
          setExplorerState("error");
          setExplorerStatusMessage({
            code: "raw",
            detail: t(
              "Explorer request was rejected. Please refresh device and try again.",
              "Explorer 請求被拒絕，請重新整理裝置後再試一次。"
            ),
          });
          return;
        }

        setExplorerState("error");
        setExplorerStatusMessage({ code: "http-error", detail: formatApiHttpError(response.status, errorMeta) });
        return;
      }

      const parsed = parseExplorerListResponse(await response.json());
      if (!parsed) {
        setExplorerState("error");
        setExplorerStatusMessage({ code: "contract-mismatch" });
        return;
      }

      const normalizedPath = normalizeExplorerPath(parsed.path);
      if (normalizedPath !== normalizeExplorerPath(explorerPath)) {
        setExplorerSearchQuery("");
      }
      const sanitizedItems = parsed.items
        .filter((item) => !shouldSuppressMalformedExplorerItem(normalizedPath, item))
        .map((item) => ({
          ...item,
          path: normalizeExplorerPath(item.path),
        }));

      setExplorerItems(sanitizedItems);
      setExplorerPath(normalizedPath);
      setExplorerSelectedPaths((prev) => prev.filter((path) => sanitizedItems.some((item) => item.path === path && item.item_type !== "other" && item.is_valid)));
      if (parsed.permission_state === "denied") {
        setExplorerState("partial-success");
        setExplorerStatusMessage({ code: parsed.message ? "raw" : "permission-denied", detail: parsed.message || undefined });
      } else if (sanitizedItems.length === 0) {
        setExplorerState("empty");
        setExplorerStatusMessage({ code: "directory-empty" });
      } else if (!sanitizedItems.some((item) => item.item_type !== "other" && item.is_valid)) {
        setExplorerState("empty");
        setExplorerStatusMessage({ code: "no-valid-items" });
      } else {
        setExplorerState("success");
        setExplorerStatusMessage({ code: "directory-loaded" });
      }
    } catch (error) {
      setExplorerState("error");
      if (error instanceof DOMException && error.name === "AbortError") {
        setExplorerStatusMessage({
          code: "raw",
          detail: t(
            "Explorer request timed out while waiting for directory list. Please retry.",
            "等待目錄清單逾時，請再試一次。"
          ),
        });
      } else {
        setExplorerStatusMessage({ code: "raw", detail: formatRequestErrorMessage(error) });
      }
    } finally {
      explorerListInFlightRef.current = false;
      const pending = pendingExplorerRefreshRef.current;
      pendingExplorerRefreshRef.current = null;
      if (pending) {
        void refreshExplorer(pending.silent, pending.pathOverride);
      }
    }
  };

  const scheduleExplorerRefresh = (silent = false, pathOverride?: string, debounceMs = EXPLORER_REFRESH_DEBOUNCE_MS) => {
    if (explorerRefreshDebounceRef.current !== null) {
      window.clearTimeout(explorerRefreshDebounceRef.current);
    }
    explorerRefreshDebounceRef.current = window.setTimeout(() => {
      explorerRefreshDebounceRef.current = null;
      void refreshExplorer(silent, pathOverride);
    }, Math.max(0, debounceMs));
  };

  const uploadExplorerFile = async (file: File) => {
    if (!selectedDevice) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "select-device-first" });
      return;
    }

    if (explorerState === "loading" || explorerState === "error" || explorerState === "partial-success") {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "unsafe-state" });
      return;
    }

    if (file.size <= 0) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "selected-file-empty" });
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "selected-file-too-large" });
      return;
    }

    setExplorerOpState("loading");
    setExplorerOperationMessage({ code: "uploading" });
    setExplorerUploadFileName(file.name);
    setExplorerUploadProgress(0);

    try {
      const targetDirectory = explorerUploadTarget;
      const formData = new FormData();
      formData.append("device_serial", selectedDevice);
      formData.append("target_directory", targetDirectory);
      formData.append("upload_file", file, file.name);

      const payload = await uploadWithProgress<ExplorerUploadResponse>(
        `${API_BASE}/explorer/upload-file`,
        formData,
        (percent) => setExplorerUploadProgress(percent)
      );
      if (!payload || typeof payload.remote_path !== "string") {
        setExplorerOpState("error");
        setExplorerOperationMessage({ code: "upload-contract-mismatch" });
        return;
      }

      setExplorerOpState("success");
      setExplorerOperationMessage({ code: payload.message ? "raw" : "upload-success", detail: payload.message || undefined });
      await refreshExplorer(true);
    } catch (error) {
      const detail = String(error);
      if (detail.includes("DEVICE_OFFLINE:") || detail.includes("DEVICE_NOT_FOUND:") || detail.includes("DEVICE_UNAUTHORIZED:")) {
        if (handleExplorerApiError(400, detail.replace(/^Error:\s*/, ""))) {
          return;
        }
      }
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "raw", detail: formatRequestErrorMessage(error) });
    } finally {
      setExplorerUploadProgress(null);
    }
  };

  const handleExplorerUploadInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await uploadExplorerFile(file);
  };

  const runExplorerOperation = async (operation: ExplorerOperation) => {
    if (!selectedDevice) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "select-device-first" });
      return;
    }

    if (explorerState === "loading" || explorerState === "error" || explorerState === "partial-success") {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "unsafe-state" });
      return;
    }

    const validSelectedPaths = explorerSelectedPaths.filter((path) => explorerItems.some((item) => item.path === path && item.item_type !== "other" && item.is_valid));
    if ((operation === "pull" || operation === "delete" || operation === "rename") && validSelectedPaths.length === 0) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "selection-required" });
      return;
    }

    if (operation === "rename" && validSelectedPaths.length !== 1) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "rename-selection-required" });
      return;
    }

    if (operation === "rename" && operationName.trim() === "") {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "rename-name-required" });
      return;
    }

    if (operation === "mkdir" && operationName.trim() === "") {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "mkdir-name-required" });
      return;
    }

    setExplorerOpState("loading");
    setExplorerOperationMessage({ code: "running-operation" });

    try {
      if (hasMultipleExplorerSelection && (operation === "mkdir" || operation === "rename")) {
        setExplorerOpState("error");
        setExplorerOperationMessage({ code: "single-selection-only" });
        return;
      }

      if ((operation === "pull" || operation === "delete") && validSelectedPaths.length > 0) {
        const makeBatchRequest = async () => apiFetch(`${API_BASE}/explorer/ops/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_serial: selectedDevice,
            operation,
            source_paths: validSelectedPaths,
            target_path: operationTargetPath,
            continue_on_error: true,
          }),
        });

        let batchResponse = await makeBatchRequest();
        if (batchResponse.status === 400) {
          await refreshExplorer(false);
          batchResponse = await makeBatchRequest();
        }

        if (!batchResponse.ok) {
          const errorMeta = await parseApiError(batchResponse);
          const detail = errorMeta.detail;
          if (handleExplorerApiError(batchResponse.status, detail)) {
            return;
          }
          setExplorerOpState("error");
          setExplorerOperationMessage({ code: "http-error", detail: formatApiHttpError(batchResponse.status, errorMeta) });
          return;
        }

        const payload = (await batchResponse.json()) as ExplorerBatchOperationResponse;
        if (!payload || !Array.isArray(payload.results)) {
          setExplorerOpState("error");
          setExplorerOperationMessage({ code: "batch-contract-mismatch" });
          return;
        }

        const failed = payload.results.filter((item) => !item.success);
        if (payload.failure_count === 0) {
          setExplorerOpState("success");
          setExplorerOperationMessage({ code: "batch-success" });
        } else if (payload.success_count > 0) {
          setExplorerOpState("partial-success");
          const failedPreview = failed.slice(0, 3).map((item) => item.source_path).join(", ");
          setExplorerOperationMessage({
            code: "batch-partial",
            detail: `${t("Batch operation partially succeeded.", "批次操作部分成功。")}${failedPreview ? ` ${t("Failed:", "失敗項目：")}${failedPreview}` : ""}`,
          });
        } else {
          setExplorerOpState("error");
          setExplorerOperationMessage({ code: payload.message ? "raw" : "batch-failed", detail: payload.message || undefined });
        }

        await refreshExplorer(true);
        return;
      }

      const operationTargetBase = operationTargetPath.trim() || explorerPath;
      const operationTarget = operation === "mkdir"
        ? `${operationTargetBase.replace(/\/+$/, "")}/${operationName.trim()}`
        : operationTargetBase;
      const operationSource = operation === "rename"
        ? validSelectedPaths[0] ?? ""
        : validSelectedPaths[0] ?? explorerPath;
      const response = await apiFetch(`${API_BASE}/explorer/ops/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_serial: selectedDevice,
          source_path: operationSource,
          target_path: operationTarget,
          name: operationName,
        }),
      });
      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        const detail = errorMeta.detail;
        if (handleExplorerApiError(response.status, detail)) {
          return;
        }
        setExplorerOpState("error");
        setExplorerOperationMessage({ code: "http-error", detail: formatApiHttpError(response.status, errorMeta) });
        return;
      }

      const payload = (await response.json()) as ExplorerOperationResponse;
      setExplorerOpState("success");
      setExplorerOperationMessage({ code: payload.message ? "raw" : "operation-success", detail: payload.message || undefined });
      await refreshExplorer(true);
    } catch (error) {
      setExplorerOpState("error");
      setExplorerOperationMessage({ code: "raw", detail: formatRequestErrorMessage(error) });
    }
  };

  const fetchServerLogs = async (resetCursor = false) => {
    const cursor = resetCursor ? 0 : serverLogCursor;
    if (serverLogEntries.length === 0 || resetCursor) {
      setServerLogState("loading");
      setServerLogMessage(t("Loading server logs...", "正在讀取伺服器日誌..."));
    }

    try {
      const query = new URLSearchParams({
        cursor: String(cursor),
        limit: "300",
        keyword: serverLogKeyword.trim(),
        max_buffer_lines: String(serverLogMaxEntries),
      });
      const response = await apiFetch(`${API_BASE}/logs/stream?${query.toString()}`);
      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setServerLogState("error");
        setServerLogMessage(formatApiHttpError(response.status, errorMeta));
        return;
      }

      const payload = (await response.json()) as ServerLogsStreamResponse;
      if (!payload || !Array.isArray(payload.items) || typeof payload.next_cursor !== "number") {
        setServerLogState("error");
        setServerLogMessage(t("Server log response contract mismatch.", "伺服器日誌回應契約不一致。"));
        return;
      }

      setServerLogCursor(payload.next_cursor);
      setServerLogEntries((prev) => {
        const incoming = payload.items;
        const merged = resetCursor ? incoming : [...prev, ...incoming];
        const trimmed = merged.slice(-serverLogMaxEntries);
        return trimmed;
      });

      const nextCount = (resetCursor ? 0 : serverLogEntries.length) + payload.items.length;
      if (nextCount === 0) {
        setServerLogState("empty");
        setServerLogMessage(t("No server logs yet.", "目前沒有伺服器日誌。"));
      } else if (payload.dropped_count > 0) {
        setServerLogState("partial-success");
        setServerLogMessage(
          t(
            `Showing latest logs only. Dropped ${payload.dropped_count} old entries.`,
            `目前僅顯示最新日誌，已淘汰 ${payload.dropped_count} 筆舊資料。`
          )
        );
      } else {
        setServerLogState("success");
        setServerLogMessage(
          t(`Loaded ${payload.items.length} new entries.`, `已更新 ${payload.items.length} 筆新日誌。`)
        );
      }
    } catch (error) {
      setServerLogState("error");
      setServerLogMessage(formatRequestErrorMessage(error));
    }
  };

  const applyWifiCandidate = (candidate: WifiDetectCandidate) => {
    setWifiHost(candidate.host);
    setWifiPort(candidate.port);
  };

  const navigateExplorerDirectory = (targetPath: string) => {
    const normalizedPath = normalizeExplorerPath(targetPath);
    setExplorerPath(normalizedPath);
    setExplorerSearchQuery("");
    setExplorerSelectedPaths([]);
    scheduleExplorerRefresh(false, normalizedPath);
  };

  const toggleExplorerPathSelection = (item: ExplorerItem, checked: boolean) => {
    if (!item.is_valid || item.item_type === "other" || explorerListBlocked) {
      return;
    }

    const targetPath = item.path;
    setExplorerSelectedPaths((prev) => {
      if (checked) {
        if (prev.includes(targetPath)) {
          return prev;
        }
        return [...prev, targetPath];
      }
      return prev.filter((path) => path !== targetPath);
    });
  };

  useEffect(() => {
    setExplorerMessage(resolveExplorerStatusMessage(explorerMessageMeta));
    setExplorerOpMessage(resolveExplorerOpMessage(explorerOpMessageMeta));
  }, [locale, explorerMessageMeta, explorerOpMessageMeta]);

  useEffect(() => () => {
    if (explorerRefreshDebounceRef.current !== null) {
      window.clearTimeout(explorerRefreshDebounceRef.current);
      explorerRefreshDebounceRef.current = null;
    }
  }, []);

  const runWifiAutoDetect = async () => {
    if (!selectedDevice || !devices.some((device) => device.serial === selectedDevice)) {
      if (devices.length === 0) {
        handleNoDevicesDetected();
      } else {
        setSelectedDevice(devices[0].serial);
      }
      return;
    }

    setWifiDetectState("loading");
    setWifiDetectMessage(text.wifiDetecting);
    setWifiDetectCandidates([]);

    try {
      const params = new URLSearchParams({
        device_serial: selectedDevice,
        port: String(wifiPort),
      });
      const response = await apiFetch(`${API_BASE}/wifi/detect?${params.toString()}`);

      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setWifiDetectState("error");
        setWifiDetectMessage(formatApiHttpError(response.status, errorMeta));
        return;
      }

      const json = await response.json();
      const parsed = parseWifiDetectResponse(json);
      if (!parsed) {
        setWifiDetectState("error");
        setWifiDetectMessage(text.wifiDetectContractMismatch);
        appLogger.error("wifi_detect_contract_mismatch", { payload: JSON.stringify(json).slice(0, 400) });
        return;
      }

      setWifiDetectCandidates(parsed.candidates);

      if (parsed.status === "detected" && parsed.selected_host) {
        setWifiHost(parsed.selected_host);
        setWifiPort(parsed.selected_port);
        setWifiDetectState("detected");
        setWifiDetectMessage(parsed.message || text.wifiDetectStatusDetected);
        return;
      }

      if (parsed.status === "ambiguous") {
        const top = parsed.candidates[0];
        if (top) {
          setWifiHost(top.host);
          setWifiPort(top.port);
        }
        setWifiDetectState("partial-success");
        setWifiDetectMessage(parsed.message || text.wifiDetectStatusAmbiguous);
        return;
      }

      if (parsed.candidates.length === 0) {
        setWifiDetectState("empty");
        setWifiDetectMessage(parsed.message || text.wifiDetectStatusEmpty);
        return;
      }

      setWifiDetectState("error");
      setWifiDetectMessage(parsed.message || text.wifiDetectStatusFailed);
    } catch (error) {
      setWifiDetectState("error");
      setWifiDetectMessage(formatRequestErrorMessage(error));
    }
  };

  const handleNoDevicesDetected = (silent = false) => {
    // Clear mode indicator state when device list is empty.
    setSelectedDevice("");
    setOriginalUsbSerial("");
    setCurrentWifiTarget("");

    if (!silent && !noDeviceAlertShownRef.current) {
      alert(text.connectDeviceFirst);
      noDeviceAlertShownRef.current = true;
    }
  };

  const refreshDevices = async (silent = false) => {
    appLogger.info("devices_refresh_started", { silent });
    const response = await apiFetch(`${API_BASE}/devices`);
    if (!response.ok) {
      appLogger.warn("devices_refresh_failed_http", { status: response.status });
      throw new Error("Failed to fetch devices.");
    }
    const payload = (await response.json()) as DeviceInfo[];
    setDevices(payload);
    appLogger.info("devices_refresh_succeeded", { count: payload.length });

    if (payload.length === 0) {
      handleNoDevicesDetected(silent);
      return;
    }
    noDeviceAlertShownRef.current = false;
    
    // ⭐ Device recovery logic after WiFi disconnection
    // Check if current device still exists in the list
    const currentDeviceExists = payload.some(d => d.serial === selectedDevice);
    
    if (selectedDevice && !currentDeviceExists) {
      // Current device is gone (likely WiFi device after disconnect)
      // Try to restore the original USB device
      if (originalUsbSerial) {
        const originalDeviceExists = payload.some(d => d.serial === originalUsbSerial);
        if (originalDeviceExists) {
          appLogger.info("device_restored_to_usb", { serial: originalUsbSerial });
          setSelectedDevice(originalUsbSerial);
          setOriginalUsbSerial(""); // Clear the cache
          setCurrentWifiTarget("");
          return;
        } else {
          appLogger.warn("original_usb_not_found_after_wifi_disconnect", { serial: originalUsbSerial });
          setOriginalUsbSerial("");
        }
      }
      
      // If original device not found or not cached, fall back to first available device
      if (payload.length > 0) {
        appLogger.info("selected_first_available_device", { serial: payload[0].serial });
        setSelectedDevice(payload[0].serial);
        setOriginalUsbSerial(""); // Clear the cache
        setCurrentWifiTarget("");
      } else {
        // No devices available
        appLogger.warn("no_devices_found_after_refresh");
        handleNoDevicesDetected(silent);
      }
    } else if (!selectedDevice && payload.length > 0) {
      // No device selected yet, auto-select the first one
      setSelectedDevice(payload[0].serial);
      // If it's a USB device (doesn't contain ':'), save as original
      if (!payload[0].serial.includes(":")) {
        setOriginalUsbSerial(payload[0].serial);
      }
    }
  };

  useEffect(() => {
    // Check backend auth mode on mount
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((data: { status: string; auth_enabled?: boolean }) => {
        const enabled = data.auth_enabled === true;
        setAuthEnabled(enabled);
        setAuthed(!enabled || isLoggedIn());
        setAuthReady(true);
      })
      .catch(() => {
        // If health check fails, still show the app (auth stays disabled)
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    if (!authReady || (authEnabled && !authed)) return;
    appLogger.info("app_loaded", { apiBase: API_BASE });
    refreshDevices(true).catch(() => {
      appLogger.warn("initial_devices_refresh_failed");
      setDevices([]);
      handleNoDevicesDetected(true);
    });
  }, [authReady, authed]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIFI_PROFILES_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as WifiProfile[];
      if (Array.isArray(parsed)) {
        setWifiProfiles(parsed);
      }
    } catch {
      setWifiProfiles([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (activeTab !== "logs") {
      return;
    }

    fetchServerLogs(true).catch(() => {
      setServerLogState("error");
      setServerLogMessage(t("Failed to initialize log stream.", "初始化日誌串流失敗。"));
    });
  }, [activeTab, serverLogKeyword, serverLogMaxEntries]);

  useEffect(() => {
    if (activeTab !== "logs" || !serverLogAutoRefresh) {
      return;
    }

    const ms = Math.max(2, serverLogIntervalSeconds) * 1000;
    const timer = window.setInterval(() => {
      fetchServerLogs(false).catch(() => {
        setServerLogState("error");
        setServerLogMessage(t("Auto refresh failed.", "自動刷新失敗。"));
      });
    }, ms);

    return () => window.clearInterval(timer);
  }, [activeTab, serverLogAutoRefresh, serverLogIntervalSeconds, serverLogCursor, serverLogKeyword, serverLogMaxEntries]);

  const persistWifiProfiles = (profiles: WifiProfile[]) => {
    setWifiProfiles(profiles);
    localStorage.setItem(WIFI_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  };

  const handleSelectDevice = (deviceSerial: string) => {
    setSelectedDevice(deviceSerial);
    
    // ⭐ Auto-save USB device as original backup when user selects it
    // USB devices don't contain ":" while WiFi devices are in format "IP:Port"
    if (deviceSerial && !deviceSerial.includes(":")) {
      setOriginalUsbSerial(deviceSerial);
      appLogger.info("usb_device_saved_as_backup", { serial: deviceSerial });
    }
  };

  const executeFlowSteps = async (stepsToRun: FlowStep[]) => {
    if (!selectedDevice || stepsToRun.length === 0) {
      alert(text.selectDeviceAndStep);
      return;
    }

    if (!devices.some((device) => device.serial === selectedDevice)) {
      if (devices.length === 0) {
        handleNoDevicesDetected();
      } else {
        setSelectedDevice(devices[0].serial);
      }
      return;
    }

    const emptyNameIndex = stepsToRun.findIndex((s) => !s.name.trim());
    if (emptyNameIndex !== -1) {
      alert(formatText(text.emptyStepName, { index: emptyNameIndex + 1 }));
      return;
    }

    const findFirstInvalidStep = (
      list: FlowStep[],
      prefix = ""
    ): { path: string; reason: string } | null => {
      for (let i = 0; i < list.length; i += 1) {
        const step = list[i];
        const stepPath = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        const errors = validateStep(step, locale);
        if (errors.length > 0) {
          return {
            path: stepPath,
            reason: errors[0] ?? "Unknown error",
          };
        }
      }
      return null;
    };

    const invalid = findFirstInvalidStep(stepsToRun);
    if (invalid) {
      alert(formatText(text.invalidStep, { index: invalid.path, reason: invalid.reason }));
      return;
    }

    // Check if this flow contains WiFi operations that change device connectivity
    const hasWifiConnect = stepsToRun.some((s) => s.type === "wifi_connect");
    const hasWifiDisconnect = stepsToRun.some((s) => s.type === "wifi_disconnect");

    setLoading(true);
    setExecutionPhase("running");
    setResults({
      success: true,
      message: t("Running flow...", "正在執行流程..."),
      results: [],
    });
    appLogger.info("flow_execute_started", {
      selectedDevice,
      stepCount: stepsToRun.length,
      hasWifiConnect,
      hasWifiDisconnect,
      experimentalShell,
      commandTimeoutSeconds,
      flowTimeoutSeconds,
    });

    try {
      const allStepResults: ExecuteFlowResponse["results"] = [];
      let activeDeviceTarget = selectedDevice;

      for (let index = 0; index < stepsToRun.length; index += 1) {
        const step = stepsToRun[index];
        const response = await apiFetch(`${API_BASE}/flows/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_serial: activeDeviceTarget,
            steps: [step],
            enable_experimental_shell: experimentalShell,
            command_timeout_seconds: commandTimeoutSeconds,
            flow_timeout_seconds: flowTimeoutSeconds,
          }),
        });

        if (!response.ok) {
          const errorMeta = await parseApiError(response);
          setResults({
            success: false,
            message: formatApiHttpError(response.status, errorMeta),
            results: allStepResults,
          });
          setExecutionPhase("failed");
          appLogger.warn("flow_execute_failed_http", { status: response.status, detail: errorMeta.detail, index });
          return;
        }

        const payload = (await response.json()) as ExecuteFlowResponse;
        const one = payload.results[0];
        if (!one) {
          setResults({
            success: false,
            message: t("Step result missing from backend.", "後端沒有回傳步驟結果。"),
            results: allStepResults,
          });
          setExecutionPhase("failed");
          return;
        }

        const normalized = {
          ...one,
          index,
          name: one.name || step.name,
          type: one.type || step.type,
        };
        allStepResults.push(normalized);

        setResults({
          success: payload.success,
          message: payload.success
            ? `${t("Completed", "已完成")} ${index + 1}/${stepsToRun.length}`
            : payload.message,
          results: [...allStepResults],
        });

        if (!payload.success) {
          setExecutionPhase("failed");
          appLogger.warn("flow_execute_stopped_on_failed_step", { index, stepType: step.type, stepName: step.name });
          return;
        }

        if (step.type === "wifi_connect") {
          const host = String(step.params.host ?? "").trim();
          const port = Number(step.params.port ?? 5555) || 5555;
          if (host) {
            activeDeviceTarget = `${host}:${port}`;
          }
        }
        if (step.type === "wifi_disconnect" && String(step.params.target ?? "").trim() === "") {
          activeDeviceTarget = selectedDevice;
        }
      }

      setResults({
        success: true,
        message: t("Flow executed successfully.", "流程執行成功。"),
        results: allStepResults,
      });
      setExecutionPhase("success");
      appLogger.info("flow_execute_completed", {
        success: true,
        message: "Flow executed successfully.",
        resultCount: allStepResults.length,
      });
      
      // ⭐ IMPORTANT: Auto-refresh device list after WiFi operations
      // This prevents using stale device info or wrong device targets in subsequent flows
      if (hasWifiConnect || hasWifiDisconnect) {
        // Small delay to let device list settle
        setTimeout(() => {
          refreshDevices().catch(() => {
            appLogger.error("refresh_devices_failed_after_wifi_operation");
          });
        }, 1000);
      }
    } catch (error) {
      appLogger.error("flow_execute_failed_exception", { error: String(error) });
      setResults({
        success: false,
        message: `Request failed: ${String(error)}`,
        results: [],
      });
      setExecutionPhase("failed");
    } finally {
      setLoading(false);
    }
  };

  const runFlow = async () => {
    await executeFlowSteps(steps);
  };

  const runWifiQuickSetup = async () => {
    if (!isPrivateNetworkIpv4(wifiHost)) {
      alert(text.wifiUnsafeHost);
      return;
    }
    if (!wifiInternalConfirmed) {
      alert(text.wifiNeedConfirm);
      return;
    }

    // ⭐ Save the current USB device as backup before switching to WiFi
    if (selectedDevice && !selectedDevice.includes(":")) {
      setOriginalUsbSerial(selectedDevice);
    }

    const quickSteps: FlowStep[] = [
      { type: "wait_for_device", name: "Wait For Device (USB)", params: {} },
      { type: "wifi_enable_tcpip", name: "Enable WiFi ADB", params: { port: wifiPort } },
    ];

    quickSteps.push({
      type: "wifi_connect",
      name: "WiFi Connect",
      params: { host: wifiHost, port: wifiPort },
    });

    quickSteps.push({
      type: "wait_for_property",
      name: "Check Boot Property",
      params: { property: "sys.boot_completed", expected: "*", interval_seconds: 1, max_wait_seconds: 20 },
    });

    // Track requested target but only commit it to UI after successful verification.
    const wifiTarget = `${wifiHost}:${wifiPort}`;
    
    setLoading(true);
    setResults(null);
    appLogger.info("wifi_quick_setup_started", { selectedDevice, wifiTarget });

    try {
      const response = await apiFetch(`${API_BASE}/flows/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_serial: selectedDevice,
          steps: quickSteps,
          enable_experimental_shell: experimentalShell,
          command_timeout_seconds: commandTimeoutSeconds,
          flow_timeout_seconds: flowTimeoutSeconds,
        }),
      });

      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setResults({
          success: false,
          message: formatApiHttpError(response.status, errorMeta),
          results: [],
        });
        appLogger.warn("wifi_quick_setup_failed_http", { status: response.status, detail: errorMeta.detail });
        return;
      }

      const payload = (await response.json()) as ExecuteFlowResponse;
      setResults(payload);
      
      // ⭐ CRITICAL: If WiFi setup succeeded, refresh devices and auto-select WiFi device
      if (payload.success) {
        setTimeout(async () => {
          try {
            const devicesResponse = await apiFetch(`${API_BASE}/devices`);
            if (devicesResponse.ok) {
              const devicesPayload = (await devicesResponse.json()) as DeviceInfo[];
              setDevices(devicesPayload);
              
              // Auto-select the WiFi device that was just connected
              const wifiDevice = devicesPayload.find((d) => d.serial === wifiTarget);
              if (wifiDevice) {
                setSelectedDevice(wifiDevice.serial);
                setCurrentWifiTarget(wifiTarget);
                appLogger.info("wifi_device_auto_selected", { target: wifiTarget });
              } else {
                setCurrentWifiTarget("");
                appLogger.warn("wifi_device_not_found_after_quick_setup", { target: wifiTarget });
              }
            }
          } catch (error) {
            setCurrentWifiTarget("");
            appLogger.error("refresh_devices_failed_after_wifi_setup", { error: String(error) });
          }
        }, 1500);
      }
    } catch (error) {
      appLogger.error("wifi_quick_setup_failed_exception", { error: String(error) });
      setResults({
        success: false,
        message: formatRequestErrorMessage(error),
        results: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const saveWifiProfile = () => {
    if (!isPrivateNetworkIpv4(wifiHost)) {
      alert(text.wifiUnsafeHost);
      return;
    }
    const profile: WifiProfile = {
      host: wifiHost,
      port: Math.max(1, Math.min(65535, Number(wifiPort) || 5555)),
    };
    const exists = wifiProfiles.some(
      (item) => item.host === profile.host && item.port === profile.port
    );
    if (exists) {
      alert(text.wifiProfileExists);
      return;
    }
    const next = [profile, ...wifiProfiles];
    persistWifiProfiles(next);
    alert(text.wifiProfileSaved);
  };

  const connectWifiProfile = async (profile: WifiProfile) => {
    if (!wifiInternalConfirmed) {
      alert(text.wifiNeedConfirm);
      return;
    }

    // ⭐ Save the current USB device as backup before switching to WiFi
    if (selectedDevice && !selectedDevice.includes(":")) {
      setOriginalUsbSerial(selectedDevice);
    }

    const stepsToRun: FlowStep[] = [
      { type: "wifi_enable_tcpip", name: "Enable WiFi ADB", params: { port: profile.port } },
      { type: "wifi_connect", name: "WiFi Connect", params: { host: profile.host, port: profile.port } },
    ];

    // Track requested target but only commit it to UI after successful verification.
    const wifiTarget = `${profile.host}:${profile.port}`;

    setLoading(true);
    setResults(null);
    appLogger.info("wifi_profile_connect_started", { selectedDevice, wifiTarget });

    try {
      const response = await apiFetch(`${API_BASE}/flows/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_serial: selectedDevice,
          steps: stepsToRun,
          enable_experimental_shell: experimentalShell,
          command_timeout_seconds: commandTimeoutSeconds,
          flow_timeout_seconds: flowTimeoutSeconds,
        }),
      });

      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setResults({
          success: false,
          message: formatApiHttpError(response.status, errorMeta),
          results: [],
        });
        appLogger.warn("wifi_profile_connect_failed_http", { status: response.status, detail: errorMeta.detail });
        return;
      }

      const payload = (await response.json()) as ExecuteFlowResponse;
      setResults(payload);
      
      // ⭐ IMPORTANT: After WiFi profile connection, refresh devices and auto-select
      if (payload.success) {
        setTimeout(async () => {
          try {
            const devicesResponse = await apiFetch(`${API_BASE}/devices`);
            if (devicesResponse.ok) {
              const devicesPayload = (await devicesResponse.json()) as DeviceInfo[];
              setDevices(devicesPayload);
              
              // Auto-select the WiFi device
              const wifiDevice = devicesPayload.find((d) => d.serial === wifiTarget);
              if (wifiDevice) {
                setSelectedDevice(wifiDevice.serial);
                setCurrentWifiTarget(wifiTarget);
                appLogger.info("wifi_profile_auto_selected", { target: wifiTarget });
              } else {
                setCurrentWifiTarget("");
                appLogger.warn("wifi_profile_target_not_found", { target: wifiTarget });
              }
            }
          } catch (error) {
            setCurrentWifiTarget("");
            appLogger.error("refresh_devices_failed_after_wifi_profile_connect", { error: String(error) });
          }
        }, 1500);
      }
    } catch (error) {
      appLogger.error("wifi_profile_connect_failed_exception", { error: String(error) });
      setResults({
        success: false,
        message: formatRequestErrorMessage(error),
        results: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const disconnectWifiProfile = async (profile: WifiProfile) => {
    setLoading(true);
    setResults(null);

    try {
      const stepsToRun: FlowStep[] = [
        {
          type: "wifi_disconnect",
          name: "WiFi Disconnect",
          params: { target: `${profile.host}:${profile.port}` },
        },
      ];

      const response = await apiFetch(`${API_BASE}/flows/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_serial: selectedDevice,
          steps: stepsToRun,
          enable_experimental_shell: experimentalShell,
          command_timeout_seconds: commandTimeoutSeconds,
          flow_timeout_seconds: flowTimeoutSeconds,
        }),
      });

      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setResults({
          success: false,
          message: formatApiHttpError(response.status, errorMeta),
          results: [],
        });
        return;
      }

      const payload = (await response.json()) as ExecuteFlowResponse;
      setResults(payload);
      
      // ⭐ After WiFi disconnect, restore to original USB device
      if (payload.success) {
        setTimeout(() => {
          refreshDevices().then(() => {
            appLogger.info("devices_refreshed_after_wifi_disconnect", { target: `${profile.host}:${profile.port}` });
          }).catch(() => {
            appLogger.error("refresh_devices_failed_after_wifi_disconnect", { target: `${profile.host}:${profile.port}` });
          });
        }, 1000);
      }
    } catch (error) {
      appLogger.error("wifi_profile_disconnect_failed_exception", { error: String(error) });
      setResults({
        success: false,
        message: formatRequestErrorMessage(error),
        results: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const disconnectAllWifi = async () => {
    setLoading(true);
    setResults(null);

    try {
      const stepsToRun: FlowStep[] = [
        {
          type: "wifi_disconnect",
          name: "WiFi Disconnect All",
          params: { target: "" },
        },
      ];

      const response = await apiFetch(`${API_BASE}/flows/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_serial: selectedDevice,
          steps: stepsToRun,
          enable_experimental_shell: experimentalShell,
          command_timeout_seconds: commandTimeoutSeconds,
          flow_timeout_seconds: flowTimeoutSeconds,
        }),
      });

      if (!response.ok) {
        const errorMeta = await parseApiError(response);
        setResults({
          success: false,
          message: formatApiHttpError(response.status, errorMeta),
          results: [],
        });
        return;
      }

      const payload = (await response.json()) as ExecuteFlowResponse;
      setResults(payload);
      
      // ⭐ After WiFi disconnect all, restore to original USB device
      if (payload.success) {
        setTimeout(() => {
          refreshDevices().then(() => {
            appLogger.info("devices_refreshed_after_wifi_disconnect_all");
          }).catch(() => {
            appLogger.error("refresh_devices_failed_after_wifi_disconnect_all");
          });
        }, 1000);
      }
    } catch (error) {
      appLogger.error("wifi_disconnect_all_failed_exception", { error: String(error) });
      setResults({
        success: false,
        message: formatRequestErrorMessage(error),
        results: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const removeWifiProfile = (profile: WifiProfile) => {
    const next = wifiProfiles.filter(
      (item) => !(item.host === profile.host && item.port === profile.port)
    );
    persistWifiProfiles(next);
  };

  const exportFlowJson = () => {
    const payload = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      device_serial: selectedDevice,
      steps,
      settings: {
        enable_experimental_shell: experimentalShell,
        command_timeout_seconds: commandTimeoutSeconds,
        flow_timeout_seconds: flowTimeoutSeconds,
      },
    };

    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flow_definition_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importFlowJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as {
        device_serial?: string;
        steps?: FlowStep[];
        settings?: {
          enable_experimental_shell?: boolean;
          command_timeout_seconds?: number;
          flow_timeout_seconds?: number;
        };
      };

      if (!Array.isArray(parsed.steps)) {
        throw new Error("Invalid flow file: 'steps' must be an array.");
      }

      setSteps(
        parsed.steps.map((s) => ({
          ...s,
          timeout_seconds: s.timeout_seconds ?? undefined,
        }))
      );

      if (typeof parsed.device_serial === "string" && parsed.device_serial.trim()) {
        setSelectedDevice(parsed.device_serial);
      }

      if (parsed.settings) {
        if (typeof parsed.settings.enable_experimental_shell === "boolean") {
          setExperimentalShell(parsed.settings.enable_experimental_shell);
        }
        if (typeof parsed.settings.command_timeout_seconds === "number") {
          setCommandTimeoutSeconds(Math.max(1, Math.min(600, parsed.settings.command_timeout_seconds)));
        }
        if (typeof parsed.settings.flow_timeout_seconds === "number") {
          setFlowTimeoutSeconds(Math.max(1, Math.min(3600, parsed.settings.flow_timeout_seconds)));
        }
      }

      setResults({
        success: true,
        message: formatText(text.importSuccess, { file: file.name }),
        results: [],
      });
    } catch (error) {
      alert(formatText(text.importFailed, { error: String(error) }));
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      {/* Blank while health check is in flight — prevents any flash */}
      {!authReady && null}
      {/* Auth guard: show login page while not authenticated */}
      {authReady && authEnabled && !authed && (
        <LoginPage
          apiBase={API_BASE}
          locale={locale}
          onLoginSuccess={() => setAuthed(true)}
        />
      )}
      {/* Main app — shown only once auth state is resolved */}
      {authReady && (!authEnabled || authed) && (
    <main className="layout">
      <header>
        <div className="header-row">
          <div>
            <h1>{text.appTitle}</h1>
            <p>{text.subtitle}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
            <label className="language-switch">
              <span>{text.language}</span>
              <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
              </select>
            </label>
            {authEnabled && authed && (
              <button
                style={{ fontSize: "12px", height: "28px", padding: "0 10px" }}
                onClick={() => { logout(API_BASE).then(() => setAuthed(false)); }}
              >
                {locale === "en" ? "Sign Out" : "登出"}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>{text.device}</h2>
        <div className="row">
          <select value={selectedDevice} onChange={(e) => handleSelectDevice(e.target.value)}>
            {devices.length === 0 && <option value="">{text.noDevices}</option>}
            {devices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {device.device_name} - {device.serial} ({device.state})
              </option>
            ))}
          </select>
          <button onClick={() => refreshDevices()}>{text.refresh}</button>
        </div>
        {hasValidSelectedDevice && (
          selectedDevice.includes(":") ? (
            <div className="device-mode-wifi">
              <span>📡 WiFi Mode</span>
              <strong>{selectedDevice}</strong>
              {originalUsbSerial && (
                <span className="device-mode-sub">(原始設備: {originalUsbSerial})</span>
              )}
            </div>
          ) : (
            <div className="device-mode-usb">
              <span>🔌 USB Mode</span>
              <strong>{selectedDevice}</strong>
              {currentWifiTarget && (
                <span className="device-mode-sub">(WiFi目標: {currentWifiTarget})</span>
              )}
            </div>
          )
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={experimentalShell}
            onChange={(e) => setExperimentalShell(e.target.checked)}
          />
          {text.experimentalShell}
        </label>
      </section>

      <section className="panel">
        <div className="tab-row">
          <button className={activeTab === "flow" ? "tab-active" : ""} onClick={() => setActiveTab("flow")}>{t("Flow", "流程")}</button>
          <button className={activeTab === "logs" ? "tab-active" : ""} onClick={() => setActiveTab("logs")}>{t("Logs", "日誌")}</button>
          <button className={activeTab === "explorer" ? "tab-active" : ""} onClick={() => setActiveTab("explorer")}>{t("Path Explorer", "路徑總覽")}</button>
        </div>
      </section>

      {activeTab === "flow" && (
        <>
          <section className="panel">
            <h2>{text.wifiQuickSetup}</h2>
            <p className="hint">{text.wifiPanelHint}</p>
            <div className="wifi-grid">
              <label>
                <span>{text.wifiHost}</span>
                <input disabled={wifiConnectControlsDisabled} value={wifiHost} onChange={(e) => setWifiHost(e.target.value)} placeholder="192.168.1.100" />
              </label>
              <label>
                <span>{text.wifiPort}</span>
                <input
                  disabled={wifiConnectControlsDisabled}
                  type="number"
                  min={1}
                  max={65535}
                  value={wifiPort}
                  onChange={(e) => setWifiPort(Math.max(1, Math.min(65535, Number(e.target.value) || 5555)))}
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={wifiInternalConfirmed}
                onChange={(e) => setWifiInternalConfirmed(e.target.checked)}
              />
              {text.wifiSafeConfirm}
            </label>
            <div className="flow-actions">
              <button onClick={runWifiAutoDetect} disabled={wifiConnectControlsDisabled || wifiDetectState === "loading"}>
                {wifiDetectState === "loading" ? text.wifiDetecting : text.wifiAutoDetect}
              </button>
              <button onClick={runWifiQuickSetup} disabled={wifiConnectControlsDisabled}>{text.wifiRunQuickSetup}</button>
              <button onClick={saveWifiProfile}>{text.wifiSaveProfile}</button>
              <button onClick={disconnectAllWifi} disabled={loading}>{text.wifiDisconnectAll}</button>
            </div>

            {wifiDetectState !== "idle" && (
              <div
                className={`wifi-detect-state wifi-detect-${wifiDetectState}`}
                role="status"
                aria-live="polite"
              >
                <strong>
                  {wifiDetectState === "loading" && text.wifiDetecting}
                  {wifiDetectState === "detected" && text.wifiDetectStatusDetected}
                  {wifiDetectState === "partial-success" && text.wifiDetectStatusAmbiguous}
                  {wifiDetectState === "empty" && text.wifiDetectStatusEmpty}
                  {wifiDetectState === "error" && text.wifiDetectStatusFailed}
                </strong>
                <span>{wifiDetectMessage}</span>
              </div>
            )}

            {(wifiDetectState === "partial-success" || wifiDetectState === "detected") && wifiDetectCandidates.length > 0 && (
              <div className="wifi-candidates">
                {wifiDetectCandidates.map((candidate, idx) => (
                  <div className="wifi-candidate-item" key={`${candidate.host}-${candidate.port}-${candidate.interface}-${idx}`}>
                    <div className="wifi-candidate-meta">
                      <strong>{candidate.host}:{candidate.port}</strong>
                      <span>
                        {candidate.interface || "-"} / {candidate.source}
                        {candidate.gateway ? ` / gw ${candidate.gateway}` : ""}
                      </span>
                    </div>
                    <button type="button" onClick={() => applyWifiCandidate(candidate)}>
                      {text.wifiDetectApplyCandidate}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3>{text.wifiProfiles}</h3>
            <div className="wifi-profiles">
              {wifiProfiles.length === 0 && <p className="hint">-</p>}
              {wifiProfiles.map((profile, idx) => (
                <div className="wifi-profile-item" key={`${profile.host}-${profile.port}-${idx}`}>
                  <span>
                    {profile.host}:{profile.port}
                  </span>
                  <div className="wifi-profile-actions">
                    <button onClick={() => connectWifiProfile(profile)} disabled={loading || !hasValidSelectedDevice}>{text.wifiConnect}</button>
                    <button onClick={() => disconnectWifiProfile(profile)} disabled={loading}>{text.wifiDisconnect}</button>
                    <button onClick={() => removeWifiProfile(profile)}>{text.wifiRemove}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <StepBuilder
              locale={locale}
              steps={steps}
              setSteps={setSteps}
              loadBlocks={loadBlocks}
              loadThirdPartyPackages={loadThirdPartyPackages}
              uploadApk={uploadApkToBackendWithProgress}
              selectedDevice={selectedDevice}
              defaultStepTimeout={commandTimeoutSeconds}
            />
            <div className="flow-actions">
              <button onClick={exportFlowJson} disabled={steps.length === 0}>{text.exportFlowJson}</button>
              <button onClick={() => flowFileInputRef.current?.click()}>{text.importFlowJson}</button>
              <input
                ref={flowFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={importFlowJson}
                style={{ display: "none" }}
              />
            </div>
            <div className="timeouts">
              <label>
                <span>{text.commandTimeout}</span>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={commandTimeoutSeconds}
                  onChange={(e) => setCommandTimeoutSeconds(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label>
                <span>{text.flowTimeout}</span>
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={flowTimeoutSeconds}
                  onChange={(e) => setFlowTimeoutSeconds(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>
            <button className="run" onClick={runFlow} disabled={loading || !hasValidSelectedDevice}>
              {loading && <span className="spinner" />}
              {loading ? text.running : text.runFlow}
            </button>
          </section>

          <section className="panel">
            <h2>{text.executionResult}</h2>
            {!results && <p>{text.noExecution}</p>}
            {results && (
              <>
                <div className={`result-status ${executionPhase === "running" ? "running" : results.success ? "ok" : "err"}`}>
                  {executionPhase === "running" ? "⋯" : results.success ? "✓" : "✗"} {text.status}: {executionPhase === "running" ? text.runningStatus : results.success ? text.success : text.failed}
                </div>
                <p className="result-message">{results.message}</p>
                <div className="logs">
                  {results.results.map((item) => {
                    const screenshotPreview = parseScreenshotFromOutput(item.output || "");
                    const logClass = item.skipped
                      ? "log-skipped"
                      : item.success
                        ? "log-ok"
                        : "log-err";
                    const badge = item.skipped
                      ? "SKIP"
                      : item.success
                        ? "OK"
                        : "ERR";
                    return (
                      <div key={`${item.index}-${item.name}`} className={`log-item ${logClass}`}>
                        <div className="log-item-header">
                          <span className="log-badge">{badge}</span>
                          <span>Step {item.index + 1} — {item.name}</span>
                          {item.type === "screenshot" && screenshotPreview.previewUrl && (
                            <button
                              type="button"
                              className="inline-ghost-btn"
                              onClick={() => setShowScreenshots((prev) => !prev)}
                            >
                              {showScreenshots ? t("Hide image", "隱藏圖片") : t("Show image", "顯示圖片")}
                            </button>
                          )}
                        </div>
                        <div className="log-item-cmd">$ {item.command || "N/A"}</div>
                        {item.type === "screenshot" && showScreenshots && screenshotPreview.previewUrl && (
                          <div className="screenshot-preview-wrap">
                            <a href={screenshotPreview.previewUrl} target="_blank" rel="noreferrer" className="screenshot-preview-meta">
                              {screenshotPreview.imageName}
                            </a>
                            {screenshotPreview.localPath && <div className="screenshot-preview-meta">{t("Pulled to", "已拉到")}: {screenshotPreview.localPath}</div>}
                            <img
                              className="screenshot-preview-image"
                              src={screenshotPreview.previewUrl}
                              alt={`${item.name} screenshot`}
                              loading="lazy"
                            />
                          </div>
                        )}
                        <pre>{item.output || "(empty)"}</pre>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {activeTab === "logs" && (
        <>
          <section className="panel">
            <h2>{t("Server Log Monitor", "伺服器日誌監看")}</h2>
            <div className="timeouts">
              <label>
                <span>{t("Auto Refresh (seconds)", "自動刷新秒數")}</span>
                <select
                  value={String(serverLogIntervalSeconds)}
                  onChange={(e) => setServerLogIntervalSeconds(Number(e.target.value) || 10)}
                >
                  <option value="2">2s</option>
                  <option value="5">5s</option>
                  <option value="10">10s</option>
                  <option value="30">30s</option>
                </select>
              </label>
              <label>
                <span>{t("Keyword", "關鍵字")}</span>
                <input value={serverLogKeyword} onChange={(e) => setServerLogKeyword(e.target.value)} placeholder={t("Filter server message", "篩選伺服器訊息")} />
              </label>
              <label>
                <span>{t("Keep Latest Entries", "保留最新筆數")}</span>
                <input
                  type="number"
                  min={100}
                  max={5000}
                  value={serverLogMaxEntries}
                  onChange={(e) => setServerLogMaxEntries(Math.max(100, Math.min(5000, Number(e.target.value) || 500)))}
                />
              </label>
            </div>
            <div className="flow-actions">
              <button onClick={() => fetchServerLogs(false)} disabled={serverLogState === "loading"}>
                {t("Refresh Now", "立即刷新")}
              </button>
              <button onClick={() => setServerLogAutoRefresh((prev) => !prev)}>
                {serverLogAutoRefresh ? t("Pause Auto Refresh", "暫停自動刷新") : t("Resume Auto Refresh", "恢復自動刷新")}
              </button>
              <button onClick={() => { setServerLogEntries([]); setServerLogCursor(0); setServerLogState("idle"); }}>{t("Clear View", "清空畫面")}</button>
            </div>

            {serverLogState !== "idle" && (
              <div className={`wifi-detect-state wifi-detect-${serverLogState}`}>
                <strong>{t("Monitor Status", "監看狀態")}</strong>
                <span>{serverLogMessage}</span>
                <span>
                  {t("Visible entries", "可見筆數")}: {serverLogEntries.length}
                  {serverLogAutoRefresh ? ` | ${t("Auto refresh active", "自動刷新啟用")}` : ` | ${t("Auto refresh paused", "自動刷新已暫停")}`}
                </span>
              </div>
            )}

            {serverLogState === "empty" && <p className="hint">{t("No server logs matched current filter.", "目前沒有符合條件的伺服器日誌。")}</p>}

            {serverLogEntries.length > 0 && (
              <div className="server-log-container" role="log" aria-live="polite">
                {serverLogEntries.map((entry, index) => (
                  <p className="server-log-line" key={`${entry.timestamp}-${entry.logger}-${index}`}>
                    {`${entry.timestamp || "-"} [${entry.level || "INFO"}] ${entry.logger || "-"}: ${entry.message || "(empty)"}`}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>{t("Server Log Export", "伺服器 Logs 匯出")}</h2>
            <div className="timeouts">
              <label>
                <span>{t("Last Hours", "最近時數")}</span>
                <input type="number" min={1} max={720} value={logFilterHours} onChange={(e) => setLogFilterHours(Number(e.target.value) || 24)} />
              </label>
              <label>
                <span>{t("Levels (comma separated)", "等級（逗號分隔）")}</span>
                <input value={logFilterLevels} onChange={(e) => setLogFilterLevels(e.target.value)} placeholder="INFO,WARN,ERROR" />
              </label>
              <label>
                <span>{t("Keyword", "關鍵字")}</span>
                <input value={logFilterKeyword} onChange={(e) => setLogFilterKeyword(e.target.value)} placeholder={t("Optional keyword filter", "可選關鍵字過濾")} />
              </label>
              <label>
                <span>{t("Chunk Size (MB)", "分段大小（MB）")}</span>
                <input type="number" min={1} max={200} value={logChunkMb} onChange={(e) => setLogChunkMb(Number(e.target.value) || 10)} />
              </label>
            </div>
            <div className="flow-actions">
              <button onClick={exportServerLogs} disabled={logExportState === "loading"}>
                {logExportState === "loading" ? t("Exporting...", "匯出中...") : t("Export Server Logs", "匯出伺服器 Logs")}
              </button>
            </div>
            {logExportState !== "idle" && (
              <div className={`wifi-detect-state wifi-detect-${logExportState}`}>
                <strong>{t("Export Status", "匯出狀態")}</strong>
                <span>{logExportMessage}</span>
                {logExportInfo && (
                  <span>
                    {t("Lines", "行數")} {logExportInfo.exported_lines}/{logExportInfo.total_lines} |
                    {t(" Chunks ", " 分段 ")} {logExportInfo.chunk_count}
                  </span>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "explorer" && (
        <section className="panel">
          <h2>{t("Path Explorer", "路徑總覽")}</h2>
          <p className="hint">{t("Click a folder to enter it immediately. Use Refresh to inspect latest files.", "點擊資料夾會立即進入。若要查看最新檔案狀態請手動重新整理。")}</p>
          <div className="explorer-breadcrumb">
            <strong>{t("Current Path", "目前路徑")}: </strong>
            <span>{explorerPath}</span>
          </div>
          <div className="row">
            <input value={explorerPath} onChange={(e) => setExplorerPath(e.target.value)} placeholder="/" />
            <button onClick={goExplorerParent}>{t("Up", "上一層")}</button>
            <button onClick={() => scheduleExplorerRefresh(false, explorerPath)} disabled={explorerState === "loading"}>{t("Refresh", "重新整理")}</button>
          </div>

          {explorerState !== "idle" && (
            <div className={`wifi-detect-state wifi-detect-${explorerState}`}>
              <strong>{t("Explorer Status", "Explorer 狀態")}</strong>
              <span>{explorerMessage}</span>
            </div>
          )}

          {explorerState === "empty" && <p className="hint">{t("This directory has no visible items.", "此目錄沒有可見項目。")}</p>}
          {explorerState !== "loading" && visibleExplorerItems.length > 0 && filteredExplorerItems.length === 0 && (
            <p className="hint">{t("No files matched the current search.", "目前搜尋條件找不到符合的檔案或資料夾。")}</p>
          )}
          {(explorerState === "success" || explorerState === "partial-success" || explorerState === "empty") && (
            <div className="explorer-list-shell">
              <div className="explorer-search-input-wrap">
                <span className="explorer-search-icon" aria-hidden="true">🔍</span>
                <input
                  value={explorerSearchQuery}
                  onChange={(e) => setExplorerSearchQuery(e.target.value)}
                  placeholder={t("Search files or folders", "搜尋檔案或資料夾")}
                />
              </div>
              <div className="explorer-list">
                <div className="explorer-list-head">
                  <span>{t("Select", "勾選")}</span>
                  <span>{t("Name", "名稱")}</span>
                  <span>{t("Type", "類型")}</span>
                  <span>{t("Size", "大小")}</span>
                  <span>{t("Modified", "修改時間")}</span>
                </div>
                <div className="explorer-list-body">
                  {filteredExplorerItems.map((item) => (
                    <div key={item.path} className="explorer-item-row">
                      <span className="explorer-item-check">
                        <input
                          type="checkbox"
                          aria-label={`${t("Select", "勾選")} ${item.name}`}
                          checked={explorerSelectedPaths.includes(item.path)}
                          disabled={!item.is_valid || item.item_type === "other" || explorerListBlocked}
                          onChange={(e) => toggleExplorerPathSelection(item, e.target.checked)}
                        />
                      </span>
                      <button
                        type="button"
                        className={`explorer-item ${explorerSelectedPaths.includes(item.path) ? "explorer-item-selected" : ""} ${!item.is_valid ? "explorer-item-invalid" : ""}`}
                        title={item.path}
                        disabled={!item.is_valid || item.item_type === "other" || explorerListBlocked}
                        onClick={() => {
                          if (item.item_type === "directory" && item.is_valid) {
                            void navigateExplorerDirectory(item.path);
                          }
                        }}
                      >
                        <span className="explorer-item-main">
                          <span className="explorer-item-icon">
                            {!item.is_valid ? "⚠️" : item.item_type === "directory" ? "📁" : "📄"}
                          </span>
                          <strong className="explorer-item-name">{item.name}</strong>
                          <span className="explorer-item-subpath">{item.path}</span>
                          {!item.is_valid && <span className="explorer-item-invalid-reason">{item.invalid_reason || t("Invalid path entry.", "無效路徑項目。")}</span>}
                        </span>
                        <span className="explorer-item-cell">{item.is_valid ? item.item_type : t("invalid", "無效")}</span>
                        <span className="explorer-item-cell">{item.size}</span>
                        <span className="explorer-item-cell">{item.mtime || "-"}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {explorerSelectedPaths.length > 0 && (
            <p className="hint">
              {t("Selected items", "已勾選項目")}：{explorerSelectedPaths.length}
            </p>
          )}

          <h3>{t("File Operations", "檔案操作")}</h3>
          <div className="timeouts">
            <label>
              <span>{t("Target Path / Upload Directory", "目標路徑 / 上傳目錄")}</span>
              <input value={operationTargetPath} onChange={(e) => setOperationTargetPath(e.target.value)} placeholder="/sdcard/Download" />
            </label>
            <label>
              <span>{text.mkdirAndRenameName}</span>
              <input value={operationName} onChange={(e) => setOperationName(e.target.value)} placeholder="new_name.txt" />
            </label>
          </div>

          <input
            ref={explorerUploadInputRef}
            type="file"
            onChange={(event) => { void handleExplorerUploadInput(event); }}
            style={{ display: "none" }}
          />

          <div className="flow-actions">
            <button onClick={() => explorerUploadInputRef.current?.click()} disabled={!explorerCanUpload}>{t("Push", "上傳")}</button>
            <button onClick={() => runExplorerOperation("pull")} disabled={!explorerCanPullDelete}>{t("Pull", "下載")}</button>
            <button onClick={() => runExplorerOperation("delete")} disabled={!explorerCanPullDelete}>{t("Delete", "刪除")}</button>
            <button onClick={() => runExplorerOperation("mkdir")} disabled={!explorerCanMkdir}>{t("Mkdir", "新增資料夾")}</button>
            <button onClick={() => runExplorerOperation("rename")} disabled={!explorerCanRename}>{t("Rename", "重新命名")}</button>
          </div>

          <p className="hint">
            {t("Push reads a file from your computer, then uploads it into the current or target Android directory.", "上傳會從你的電腦選取檔案，再推送到目前路徑或指定 Android 目錄。")}
            {explorerUploadFileName ? ` ${t("Last file", "最近檔案")}：${explorerUploadFileName}` : ""}
          </p>
          {typeof explorerUploadProgress === "number" && (
            <div className="upload-progress-wrap" role="status" aria-live="polite">
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${explorerUploadProgress}%` }} />
              </div>
              <span className="upload-progress-text">{Math.round(explorerUploadProgress)}%</span>
            </div>
          )}
          {explorerUploadTarget === "/" && (
            <p className="hint">
              {t("Root path is often read-only. Prefer a writable directory such as /sdcard or /sdcard/Download before uploading.", "根目錄通常是唯讀，建議先改成 /sdcard 或 /sdcard/Download 這類可寫目錄再上傳。")}
            </p>
          )}

          {hasMultipleExplorerSelection && (
            <p className="hint">{t("When selecting multiple items, only Pull and Delete are available.", "多選時僅開放下載與刪除。")}</p>
          )}
          {explorerState === "empty" && (
            <p className="hint">{t("Empty directory policy: only Upload and Mkdir are allowed.", "空目錄策略：僅允許上傳與新增資料夾。")}</p>
          )}
          {!explorerHasValidItems && explorerState === "success" && (
            <p className="hint">{t("No valid entries can be operated in current list.", "目前清單沒有可操作的有效項目。")}</p>
          )}

          {explorerOpState !== "idle" && (
            <div className={`wifi-detect-state wifi-detect-${explorerOpState}`}>
              <strong>{t("Operation Status", "操作狀態")}</strong>
              <span>{explorerOpMessage}</span>
            </div>
          )}
        </section>
      )}

    </main>
      )}
    </>
  );
}
