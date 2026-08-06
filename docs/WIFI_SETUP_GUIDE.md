# WiFi ADB 設置指南

## 快速答案

### 使用 Quick Setup (推薦)
**前端已自動修復！** 只需填入 WiFi 地址並點擊「WiFi Quick Setup」，系統會自動：
1. 等待 USB 設備就緒
2. 通過 USB 啟用 tcpip
3. 通過 WiFi 連接
4. **自動斷開 USB（新增!）**
5. **自動等待 WiFi 重新連接（新增!）**
6. 驗證設備狀態

✅ 無需手動調整，直接可用。

### 使用 Flow Blocks (自訂)
如果要自己組建流程，參考下面的「方案 A」，記得在 WiFi Connect 後添加 USB Disconnect 步驟。

---

## 問題描述

在 WiFi 設置過程中，當設備從 USB 連接切換到 WiFi 時，可能會遇到以下錯誤：

```
[ERR] Step 4 - Check Boot Property
Command: adb -s <SERIAL> shell getprop ...
Output: adb.exe: device '<SERIAL>' not found
```

### 原因

當執行以下步驟時：
1. ✅ Step 1: `adb -s <SERIAL> wait-for-device` (USB 連接)
2. ✅ Step 2: `adb -s <SERIAL> tcpip 5555` (啟用 TCP 模式)
3. ✅ Step 3: `adb connect 10.x.x.x:5555` (WiFi 連接)
4. ❌ Step 4: `adb -s <SERIAL> shell getprop ...` (尋找不到設備)

問題出現在 Step 3 之後：
- 設備已經通過 WiFi (10.x.x.x:5555) 連接
- 但 Step 4 仍然嘗試使用原來的 USB 序列號 (`<SERIAL>`)
- USB 連接已斷開或變成冗餘，導致 adb 找不到設備

## 解決方案

### 方案 A: 使用新的「USB 斷線」步驟（推薦）

在 WiFi 連接後立即添加「USB 斷線」步驟，確保後續命令都使用 WiFi 連接：

```
Step 1: Wait For Device
        Command: adb -s <SERIAL> wait-for-device
        Purpose: 確保設備通過 USB 連接

Step 2: Enable WiFi ADB (tcpip)
        Command: adb -s <SERIAL> tcpip 5555
        Purpose: 啟用 TCP 模式

Step 3: WiFi Connect
        Command: adb connect 10.116.209.60:5555
        Purpose: 通過 WiFi 連接設備

Step 4: USB Disconnect ⭐ 新步驟
        Command: adb disconnect <SERIAL>
        Purpose: 斷開 USB 連接，強制後續使用 WiFi

Step 5: Wait For Device (WiFi)
        Command: adb wait-for-device
        Purpose: 等待通過 WiFi 重新連接

Step 6: Check Boot Property
        Command: adb shell getprop sys.boot_completed
        Purpose: 驗證設備狀態（現在使用 WiFi）
```

**關鍵改變：**
- 在 Step 4 添加 **USB Disconnect** 步驟
- 在 Step 5 改為使用 `adb wait-for-device` (不帶 `-s <SERIAL>`)
- 在 Step 6 改為使用 `adb shell getprop ...` (不帶 `-s <SERIAL>`)
- adb 會自動選擇已連接的設備（此時只有 WiFi）

### 方案 B: 在相同步驟中指定 WiFi 地址

如果要保持步驟數量不變，在 Step 4+ 中使用 WiFi 地址而非 USB 序列號：

```
Step 1: Wait For Device
Step 2: Enable WiFi ADB
Step 3: WiFi Connect
        Result: Device now at 10.116.209.60:5555

Step 4: Custom Command
        Command: adb -s 10.116.209.60:5555 shell getprop sys.boot_completed
        Purpose: 直接使用 WiFi 地址查詢屬性
```

### 方案 C: 完整的 WiFi 設置工作流程（最佳實踐）

```
Step 1: Wait For Device (USB)
        adb -s <SERIAL> wait-for-device

Step 2: Enable WiFi ADB
        adb -s <SERIAL> tcpip 5555

Step 3: WiFi Connect
        adb connect 10.116.209.60:5555

Step 4: USB Disconnect ⭐
        adb disconnect <SERIAL>

Step 5: Wait For Device (WiFi)
        adb -d wait-for-device
        // 或簡單使用: adb wait-for-device

Step 6: Verify Boot Completed
        adb shell getprop sys.boot_completed
```

以上 6 步即為 Quick Setup 完整流程。其後若要執行自動化命令，屬於 Quick Setup 之後的流程，不另計入 Quick Setup 步驟數。

## 實際例子

### ❌ 有問題的設置

```json
[
  { "type": "wait_for_device", "params": {} },
  { "type": "wifi_enable_tcpip", "params": { "port": 5555 } },
  { "type": "wifi_connect", "params": { "host": "10.116.209.60", "port": 5555 } },
  { "type": "wait_for_property", "params": { "property": "sys.boot_completed", "expected": "1" } }
]
```

**問題：** Step 3 後設備轉換到 WiFi，但 Step 4 仍然使用 USB 序列號

### ✅ 修復後的設置

```json
[
  { "type": "wait_for_device", "params": {} },
  { "type": "wifi_enable_tcpip", "params": { "port": 5555 } },
  { "type": "wifi_connect", "params": { "host": "10.116.209.60", "port": 5555 } },
  { "type": "usb_disconnect", "params": {} },
  { "type": "wait_for_device", "params": {} },
  { "type": "wait_for_property", "params": { "property": "sys.boot_completed", "expected": "1" } }
]
```

**改進：**
- Step 4: 斷開 USB 連接 (使用新的 `usb_disconnect` 步驟)
- Step 5: 重新等待設備 (此時將通過 WiFi)
- Step 6: 查詢屬性 (自動使用 WiFi 連接)

## 故障排除

### 如果 USB Disconnect 後設備離線

**症狀：** `adb: device offline` 或 `adb: no devices/emulators found`

**解決：**
1. 確認設備 WiFi 地址正確
2. 檢查防火牆設置
3. 確保設備和主機在同一網絡
4. 嘗試手動重新連接：`adb connect 10.116.209.60:5555`

### 如果同時有 USB 和 WiFi 連接

**症狀：** `adb devices` 顯示兩個相同序列號的連接

**解決：**
```bash
# 查看所有連接
adb devices

# 明確斷開 USB
adb disconnect <SERIAL>

# 只保留 WiFi
adb devices  # 應該只看到 10.x.x.x:5555
```

### 如果 WiFi 連接不穩定

建議改用一般重連流程：

```bash
adb disconnect
adb -s <USB_SERIAL> tcpip 5555
adb connect <IP>:5555
```

目前已移除 root persist 模式，不再提供重啟後自動保持 WiFi ADB 的高風險做法。

## 總結

**核心概念：**
1. 通過 USB 啟用 tcpip 模式
2. 通過 WiFi 連接到設備
3. **斷開 USB 連接**（新步驟）
4. 後續所有命令都使用 WiFi

**記住：** 當有多個連接方式時，始終明確指定要使用的連接，或斷開不需要的連接。
