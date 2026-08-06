export type StepType =
  | "if_condition"
  | "elif_condition"
  | "else_condition"
  | "wait"
  | "tap"
  | "input_text"
  | "swipe"
  | "screenshot"
  | "wait_for_device"
  | "adb_root"
  | "wifi_enable_tcpip"
  | "wifi_connect"
  | "wifi_disconnect"
  | "usb_disconnect"
  | "reboot"
  | "wait_for_property"
  | "get_props"
  | "keyevent"
  | "app_start"
  | "app_force_stop"
  | "app_clear_data"
  | "install_apk"
  | "uninstall_package"
  | "wait_boot_completed"
  | "custom_command";

export interface FlowCondition {
  left: string;
  operator: string;
  right: string;
}

export interface FlowBranch {
  condition?: FlowCondition;
  steps: FlowStep[];
}

export interface FlowStep {
  type: StepType;
  name: string;
  params: Record<string, string | number | boolean>;
  timeout_seconds?: number;
  condition?: FlowCondition;
  branches?: FlowBranch[];
}

export interface DeviceInfo {
  serial: string;
  state: string;
  device_name: string;
}

export interface StepResult {
  index: number;
  name: string;
  type: string;
  success: boolean;
  skipped?: boolean;
  command: string;
  output: string;
}

export interface ExecuteFlowResponse {
  success: boolean;
  results: StepResult[];
  message: string;
}

export type WifiDetectStatus = "detected" | "ambiguous" | "failed";
export type WifiDetectSource = "ip_route" | "ifconfig";

export interface WifiDetectCandidate {
  host: string;
  port: number;
  interface: string;
  gateway: string;
  source: WifiDetectSource;
}

export interface WifiDetectResponse {
  success: boolean;
  status: WifiDetectStatus;
  selected_host: string | null;
  selected_port: number;
  candidates: WifiDetectCandidate[];
  reason_code: string;
  message: string;
}

export interface LogExportInfo {
  file_name: string;
  total_lines: number;
  exported_lines: number;
  chunk_count: number;
  max_chunk_size_mb: number;
  from_timestamp: string | null;
  to_timestamp: string | null;
  levels: string[];
  keyword: string;
}

export type ExplorerPermissionState = "readable" | "denied";
export type ExplorerItemType = "file" | "directory" | "other";

export interface ExplorerItem {
  name: string;
  path: string;
  item_type: ExplorerItemType;
  size: number;
  mtime: string;
  permission_state: ExplorerPermissionState;
  is_valid: boolean;
  invalid_reason: string;
}

export interface ExplorerListResponse {
  success: boolean;
  path: string;
  items: ExplorerItem[];
  permission_state: ExplorerPermissionState;
  message: string;
}

export type ExplorerOperation = "push" | "pull" | "delete" | "mkdir" | "rename";

export interface ExplorerOperationResponse {
  success: boolean;
  operation: ExplorerOperation;
  message: string;
  command: string;
}

export type ExplorerBatchOperation = "pull" | "delete";

export interface ExplorerBatchOperationResultItem {
  source_path: string;
  success: boolean;
  message: string;
  command: string;
}

export interface ExplorerBatchOperationResponse {
  success: boolean;
  operation: ExplorerBatchOperation;
  results: ExplorerBatchOperationResultItem[];
  total_count: number;
  success_count: number;
  failure_count: number;
  message: string;
}

export interface ExplorerUploadResponse {
  success: boolean;
  message: string;
  remote_path: string;
  command: string;
}

export interface ServerLogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
}

export interface ServerLogsStreamResponse {
  success: boolean;
  items: ServerLogEntry[];
  next_cursor: number;
  has_more: boolean;
  dropped_count: number;
  total_available: number;
}

export interface AppPackageItem {
  package: string;
}

export interface AppPackagesResponse {
  success: boolean;
  packages: AppPackageItem[];
  message: string;
}

export interface ApkUploadResponse {
  success: boolean;
  host_path: string;
  message: string;
}
