from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DeviceInfo(BaseModel):
    serial: str
    state: str
    device_name: str


class WifiDetectCandidate(BaseModel):
    host: str
    port: int = Field(ge=1, le=65535)
    interface: str = ""
    gateway: str = ""
    source: Literal["ip_route", "ifconfig"]


class WifiDetectResponse(BaseModel):
    success: bool
    status: Literal["detected", "ambiguous", "failed"]
    selected_host: str | None = None
    selected_port: int = Field(default=5555, ge=1, le=65535)
    candidates: list[WifiDetectCandidate] = Field(default_factory=list)
    reason_code: str
    message: str


class LogExportInfo(BaseModel):
    file_name: str
    total_lines: int = Field(ge=0)
    exported_lines: int = Field(ge=0)
    chunk_count: int = Field(ge=1)
    max_chunk_size_mb: int = Field(ge=1, le=200)
    from_timestamp: str | None = None
    to_timestamp: str | None = None
    levels: list[str] = Field(default_factory=list)
    keyword: str = ""


class ExplorerItem(BaseModel):
    name: str
    path: str
    item_type: Literal["file", "directory", "other"]
    size: int = Field(default=0, ge=0)
    mtime: str = ""
    permission_state: Literal["readable", "denied"] = "readable"
    is_valid: bool = True
    invalid_reason: str = ""


class ExplorerListResponse(BaseModel):
    success: bool
    path: str
    items: list[ExplorerItem] = Field(default_factory=list)
    permission_state: Literal["readable", "denied"]
    message: str


class ExplorerListenRequest(BaseModel):
    device_serial: str = Field(min_length=1, max_length=128)
    path: str = Field(min_length=1, max_length=512)


class ExplorerListenResponse(BaseModel):
    success: bool
    session_id: str
    listening: bool
    path: str
    message: str
    refresh_policy: Literal["manual"] = "manual"


class ExplorerListenStopRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)


class ExplorerOperationRequest(BaseModel):
    device_serial: str = Field(min_length=1, max_length=128)
    source_path: str = Field(default="", max_length=512)
    target_path: str = Field(default="", max_length=512)
    name: str = Field(default="", max_length=255)


class ExplorerOperationResponse(BaseModel):
    success: bool
    operation: Literal["push", "pull", "delete", "mkdir", "rename"]
    message: str
    command: str = ""


class ExplorerBatchOperationRequest(BaseModel):
    device_serial: str = Field(min_length=1, max_length=128)
    operation: Literal["pull", "delete"]
    source_paths: list[str] = Field(min_length=1, max_length=200)
    target_path: str = Field(default="", max_length=512)
    continue_on_error: bool = True


class ExplorerBatchOperationItemResult(BaseModel):
    source_path: str
    success: bool
    message: str
    command: str = ""


class ExplorerBatchOperationResponse(BaseModel):
    success: bool
    operation: Literal["pull", "delete"]
    results: list[ExplorerBatchOperationItemResult] = Field(default_factory=list)
    total_count: int = Field(ge=0)
    success_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    message: str


class ExplorerUploadRequest(BaseModel):
    device_serial: str = Field(min_length=1, max_length=128)
    target_directory: str = Field(min_length=1, max_length=512)
    file_name: str = Field(min_length=1, max_length=128)
    content_base64: str = Field(min_length=1, max_length=30_000_000)


class ExplorerUploadResponse(BaseModel):
    success: bool
    message: str
    remote_path: str
    command: str


class ServerLogEntry(BaseModel):
    timestamp: str
    level: str
    logger: str
    message: str


class ServerLogsStreamResponse(BaseModel):
    success: bool
    items: list[ServerLogEntry] = Field(default_factory=list)
    next_cursor: int = Field(ge=0)
    has_more: bool = False
    dropped_count: int = Field(default=0, ge=0)
    total_available: int = Field(default=0, ge=0)


class AppPackageItem(BaseModel):
    package: str


class AppPackagesResponse(BaseModel):
    success: bool
    packages: list[AppPackageItem] = Field(default_factory=list)
    message: str = ""


class ApkUploadRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=60_000_000)


class ApkUploadResponse(BaseModel):
    success: bool
    host_path: str
    message: str


class FlowStep(BaseModel):
    type: Literal[
        "wait",
        "tap",
        "input_text",
        "swipe",
        "screenshot",
        "wait_for_device",
        "adb_root",
        "wifi_enable_tcpip",
        "wifi_connect",
        "wifi_disconnect",
        "usb_disconnect",
        "wait_for_property",
        "reboot",
        "get_props",
        "keyevent",
        "app_start",
        "app_force_stop",
        "app_clear_data",
        "install_apk",
        "uninstall_package",
        "wait_boot_completed",
        "custom_command",
    ]
    name: str = Field(default="", max_length=80)
    params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    timeout_seconds: int | None = Field(default=None, ge=1, le=600)


class ExecuteFlowRequest(BaseModel):
    device_serial: str = Field(min_length=1, max_length=128)
    steps: list[FlowStep] = Field(min_length=1, max_length=100)
    enable_experimental_shell: bool = False
    command_timeout_seconds: int = Field(default=30, ge=1, le=600)
    flow_timeout_seconds: int = Field(default=300, ge=1, le=3600)


class StepResult(BaseModel):
    index: int
    name: str
    type: str
    success: bool
    skipped: bool = False
    command: str
    output: str


class ExecuteFlowResponse(BaseModel):
    success: bool
    results: list[StepResult]
    message: str


class BlockDefinition(BaseModel):
    type: str
    category: str
    label: str
    description: str
    when_to_use: str
    adb_command: str
    is_condition: bool = False
    template_params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    template: FlowStep
