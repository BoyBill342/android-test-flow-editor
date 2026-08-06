import { expect, test } from "@playwright/test";

type StreamPayload = {
  success: boolean;
  items: Array<{ timestamp: string; level: string; logger: string; message: string }>;
  next_cursor: number;
  has_more: boolean;
  dropped_count: number;
  total_available: number;
};

const devicesPayload = [
  { serial: "USB123456", state: "device", device_name: "Pixel-USB" },
];

let lastBatchRequestBody: Record<string, unknown> | null = null;
let lastUploadRequestBody: Record<string, unknown> | null = null;

test.beforeEach(async ({ page }) => {
  let streamCallCount = 0;
  lastBatchRequestBody = null;
  lastUploadRequestBody = null;
  let uploadAttemptCount = 0;

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", auth_enabled: false }),
    });
  });

  await page.route("**/api/devices", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(devicesPayload),
    });
  });

  await page.route("**/api/blocks**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          type: "tap",
          category: "UI Actions",
          label: "Tap",
          description: "Tap at screen coordinates.",
          when_to_use: "Coordinate-based UI interaction tests.",
          adb_command: "adb shell input tap <x> <y>",
          template: { type: "tap", name: "Tap", params: { x: 10, y: 20 } },
          template_params: { x: 10, y: 20 },
        },
      ]),
    });
  });

  await page.route("**/api/flows/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Flow executed successfully.",
        results: [
          {
            index: 0,
            name: "Tap",
            type: "tap",
            success: true,
            skipped: false,
            command: "adb -s USB123456 shell input tap 10 20",
            output: "ok",
          },
        ],
      }),
    });
  });

  await page.route("**/api/explorer/list**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get("path") ?? "/";
    if (path === "/offline") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "DEVICE_OFFLINE: Device 'USB123456' is offline. Reconnect the device and refresh before file operations.",
        }),
      });
      return;
    }
    const isDownloadPath = path === "/sdcard/Download";
    const isEmptyPath = path === "/empty";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        path,
        permission_state: "readable",
        message: "OK",
        items: isDownloadPath
          ? [
            {
              name: "nested.txt",
              path: "/sdcard/Download/nested.txt",
              item_type: "file",
              size: 123,
              mtime: "Aug 04 10:02",
              permission_state: "readable",
              is_valid: true,
              invalid_reason: "",
            },
          ]
          : isEmptyPath
            ? []
          : [
            {
              name: "Download",
              path: "/sdcard/Download",
              item_type: "directory",
              size: 0,
              mtime: "Aug 04 10:00",
              permission_state: "readable",
              is_valid: true,
              invalid_reason: "",
            },
            {
              name: "demo.txt",
              path: "/sdcard/demo.txt",
              item_type: "file",
              size: 99,
              mtime: "Aug 04 10:01",
              permission_state: "readable",
              is_valid: true,
              invalid_reason: "",
            },
            {
              name: "?",
              path: "/?",
              item_type: "other",
              size: 0,
              mtime: "",
              permission_state: "readable",
              is_valid: false,
              invalid_reason: "Path contains unsupported characters.",
            },
            {
              name: "sdcard",
              path: "/sdcard//sdcard",
              item_type: "directory",
              size: 0,
              mtime: "",
              permission_state: "readable",
              is_valid: true,
              invalid_reason: "",
            },
          ],
      }),
    });
  });

  await page.route("**/api/explorer/ops/batch", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    lastBatchRequestBody = body;
    const sourcePaths = Array.isArray(body.source_paths) ? body.source_paths as string[] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        operation: body.operation ?? "delete",
        results: sourcePaths.map((sourcePath) => ({
          source_path: sourcePath,
          success: true,
          message: "Delete completed.",
          command: "adb ...",
        })),
        total_count: sourcePaths.length,
        success_count: sourcePaths.length,
        failure_count: 0,
        message: `Batch delete completed: ${sourcePaths.length} succeeded, 0 failed.`,
      }),
    });
  });

  await page.route("**/api/explorer/upload", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    lastUploadRequestBody = body;
    uploadAttemptCount += 1;
    if (uploadAttemptCount === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Target directory '/' is read-only. Choose a writable directory such as /sdcard or /sdcard/Download.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Upload and push completed.",
        remote_path: "/sdcard/Download/demo-upload.txt",
        command: "adb -s USB123456 push C:/temp/demo-upload.txt /sdcard/Download/demo-upload.txt",
      }),
    });
  });

  await page.route("**/api/explorer/ops/**", async (route) => {
    if (route.request().url().endsWith("/batch")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, operation: "mkdir", message: "Directory created.", command: "adb ..." }),
    });
  });

  await page.route("**/api/logs/stream**", async (route) => {
    streamCallCount += 1;
    const payload: StreamPayload = {
      success: true,
      items: [
        {
          timestamp: "2026-08-04 10:00:00",
          level: streamCallCount > 1 ? "ERROR" : "INFO",
          logger: "adb_editor.api",
          message: streamCallCount > 1 ? "wifi failed" : "wifi started",
        },
      ],
      next_cursor: streamCallCount,
      has_more: false,
      dropped_count: streamCallCount > 1 ? 2 : 0,
      total_available: streamCallCount,
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.route("**/api/logs/export**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        file_name: "adb_editor_logs.zip",
        total_lines: 120,
        exported_lines: 30,
        chunk_count: 1,
        max_chunk_size_mb: 10,
        from_timestamp: "2026-08-04 09:00:00",
        to_timestamp: "2026-08-04 10:00:00",
        levels: ["INFO"],
        keyword: "wifi",
      }),
    });
  });

  await page.route("**/api/logs/download**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: "fakezip",
    });
  });

});

test("Flow tab shows execution result without export logs button", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /\+ 新增|\+ Add/ }).click();
  await page.getByPlaceholder("搜尋方塊（名稱 / 用途）").fill("Tap");
  await page.getByRole("button", { name: /Tap/ }).first().click();

  await page.getByRole("button", { name: /Run Flow|執行流程/ }).click();
  await expect(page.getByText(/Execution Result|執行結果/)).toBeVisible();
  await expect(page.getByText(/Flow executed successfully\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Logs" })).toHaveCount(0);
});

test("Path Explorer supports clickable list and zh-TW translated operation buttons", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "路徑總覽" }).click();
  const explorerPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "路徑總覽" }) });

  await expect(explorerPanel.locator(".explorer-breadcrumb span")).toHaveText("/");

  await explorerPanel.getByRole("button", { name: "重新整理" }).click();
  await expect(explorerPanel.locator(".explorer-list-body")).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: /Download/ }).first()).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "上傳" })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "刪除" })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "新增資料夾" })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "刪除" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "監聽" })).toHaveCount(0);
  await expect(explorerPanel.getByText("/sdcard//sdcard")).toHaveCount(0);
  await expect(explorerPanel.getByRole("button", { name: /⚠️ \?/ })).toBeVisible();
  await expect(explorerPanel.getByText("Path contains unsupported characters.")).toBeVisible();
  await expect(explorerPanel.getByLabel("勾選 ?")).toBeDisabled();

  await explorerPanel.getByRole("button", { name: "上傳" }).click();
  await page.locator("input[type='file']").last().setInputFiles({
    name: "demo-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("demo content", "utf-8"),
  });
  await expect.poll(() => lastUploadRequestBody).not.toBeNull();
  expect(lastUploadRequestBody).toMatchObject({
    device_serial: "USB123456",
    file_name: "demo-upload.txt",
  });
  await expect(explorerPanel.getByText("Target directory '/' is read-only.")).toBeVisible();

  await explorerPanel.getByPlaceholder("/sdcard/Download").fill("/sdcard/Download");
  await explorerPanel.getByRole("button", { name: "上傳" }).click();
  await page.locator("input[type='file']").last().setInputFiles({
    name: "demo-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("demo content", "utf-8"),
  });
  await expect(explorerPanel.getByText("Upload and push completed.")).toBeVisible();

  await explorerPanel.getByPlaceholder("搜尋檔案或資料夾").fill("demo");
  await expect(explorerPanel.getByRole("button", { name: /demo\.txt/ })).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await explorerPanel.getByPlaceholder("搜尋檔案或資料夾").fill("nothing-here");
  await expect(explorerPanel.getByText("目前搜尋條件找不到符合的檔案或資料夾。")) .toBeVisible();
  await explorerPanel.getByPlaceholder("搜尋檔案或資料夾").fill("");

  await explorerPanel.getByLabel("勾選 Download").check();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "刪除" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeEnabled();
  await explorerPanel.getByLabel("勾選 demo.txt").check();
  await expect(explorerPanel.getByRole("button", { name: "新增資料夾" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeDisabled();

  await explorerPanel.getByRole("button", { name: "刪除" }).click();
  expect(lastBatchRequestBody).toMatchObject({
    operation: "delete",
    source_paths: ["/sdcard/Download", "/sdcard/demo.txt"],
  });

  await explorerPanel.getByRole("button", { name: /Download/ }).first().click();
  await expect(explorerPanel.locator(".explorer-breadcrumb span")).toHaveText("/sdcard/Download");
  await expect(explorerPanel.getByRole("button", { name: /nested\.txt/ })).toBeVisible();
});

test("Path Explorer locks risky operations in error and empty states", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "路徑總覽" }).click();
  const explorerPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "路徑總覽" }) });

  await explorerPanel.getByRole("button", { name: "重新整理" }).click();
  await expect(explorerPanel.getByRole("button", { name: "上傳" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeDisabled();

  await explorerPanel.locator(".row input[placeholder='/']").fill("/offline");
  await explorerPanel.getByRole("button", { name: "重新整理" }).click();
  await expect(explorerPanel.getByText("目標裝置目前離線，請先重新連線並刷新清單。").first()).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "上傳" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "刪除" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "新增資料夾" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeDisabled();

  await explorerPanel.locator(".row input[placeholder='/']").fill("/empty");
  await explorerPanel.getByRole("button", { name: "重新整理" }).click();
  await expect(explorerPanel.getByText("目錄目前為空。")).toBeVisible();
  await expect(explorerPanel.getByRole("button", { name: "上傳" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "新增資料夾" })).toBeEnabled();
  await expect(explorerPanel.getByRole("button", { name: "下載" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "刪除" })).toBeDisabled();
  await expect(explorerPanel.getByRole("button", { name: "重新命名" })).toBeDisabled();
});

test("Logs tab shows monitor states and keyword filtering controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "日誌" }).click();
  const monitorPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "伺服器日誌監看" }) });

  await expect(monitorPanel.getByText("伺服器日誌監看")).toBeVisible();
  await expect(monitorPanel.locator(".server-log-container")).toBeVisible();
  await expect(monitorPanel.getByPlaceholder("篩選伺服器訊息")).toBeVisible();
  await expect(monitorPanel.getByText("監看狀態")).toBeVisible();
  await expect(monitorPanel.getByText("wifi started")).toBeVisible();

  await monitorPanel.getByPlaceholder("篩選伺服器訊息").fill("wifi");
  await monitorPanel.getByRole("button", { name: "立即刷新" }).click();
  await expect(monitorPanel.locator(".server-log-line", { hasText: "wifi failed" }).first()).toBeVisible();
  await expect(monitorPanel.getByText("目前僅顯示最新日誌")).toBeVisible();
});
