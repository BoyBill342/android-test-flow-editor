# Quick Reference - WiFi ADB 設置修復

## 📋 症狀

執行 WiFi Quick Setup 時，最後一步失敗：
```
[ERR] Step 4 - Check Boot Property
Output: adb.exe: device 'FA45X3N00002' not found
```

## ✅ 現在已修復！

### Quick Setup 自動流程（已更新）

| 步驟 | 操作 | 說明 |
|------|------|------|
| 1 | Wait For Device (USB) | 通過 USB 連接 |
| 2 | Enable WiFi ADB | 啟用 tcpip 5555 |
| 3 | WiFi Connect | 連接到 10.x.x.x:5555 |
| **4** | **USB Disconnect** ⭐ | **新增！斷開 USB** |
| **5** | **Wait For Device (WiFi)** ⭐ | **新增！通過 WiFi 重連** |
| 6 | Check Boot Property | 驗證設備（已通過 WiFi） |

## 🔧 前端改動

**文件：** `frontend/src/App.tsx`
**函數：** `runWifiQuickSetup()`

**改動：** 在 WiFi Connect 後自動添加：
```typescript
// ⭐ USB Disconnect (新增)
{
  type: "usb_disconnect",
  name: "USB Disconnect",
  params: {},
  timeout_seconds: 10,
}

// ⭐ Wait For Device over WiFi (新增)
{
  type: "wait_for_device",
  name: "Wait For Device (WiFi)",
  params: {},
  timeout_seconds: 30,
}
```

## 📱 使用方法

### 步驟 1: 打開 WiFi Quick Setup 面板

在前端 UI 中找到「WiFi Quick Setup」部分

### 步驟 2: 設定 WiFi 參數

- **WiFi IP Address:** 輸入設備 IP (例：10.116.209.60)
- **Port:** 通常 5555（可選）
- Root persist 功能已移除，請使用一般 `tcpip + connect` 流程。

### 步驟 3: 確認並執行

- ☑️ 勾選「確認 WiFi 是私有網絡」
- 點擊「Run WiFi Quick Setup」按鈕

### 步驟 4: 等待完成

系統會自動執行所有步驟，包括新增的 USB Disconnect 和 WiFi 重連步驟。

## 🎯 改進要點

### 為什麼要斷開 USB？
- ✅ 避免 adb 在 USB 和 WiFi 之間混淆
- ✅ 確保後續操作只使用穩定的 WiFi 連接
- ✅ 防止設備重複出現在設備列表中

### 為什麼要重新等待設備？
- ✅ 確保 WiFi 連接已完全建立
- ✅ 讓 adb 識別新的 WiFi 地址
- ✅ 增加整個流程的可靠性

## 🔄 設備列表管理

執行完 Quick Setup 後：

1. **通常會自動刷新設備列表**；若列表未更新，再點擊「Refresh Devices」
2. **結果應該顯示：**
   - 舊的 USB 連接已移除或變為離線
   - 只有 WiFi 連接 (10.x.x.x:5555) 在線

3. **後續選擇 WiFi 地址** 進行其他操作

## ❓ 常見問題

### Q: Quick Setup 現在總共幾步？
A: 固定 6 步。相較舊流程，實際只新增 2 個步驟：USB Disconnect 和 Wait For Device (WiFi)。

### Q: Quick Setup 現在會不會很慢？
A: 只多了約 10-30 秒（USB Disconnect 和 Wait for Device），整體仍很快。

### Q: 還需要手動刷新設備嗎？
A: 建議執行後手動刷新以清理列表，但不是必須的。

### Q: 可以只用 Quick Setup 嗎？
A: 是的！Quick Setup 現在已足夠完整。只有在需要自訂流程時才需要使用 Flow Blocks。

## 📚 更多資訊

- [完整 WiFi 設置指南](WIFI_SETUP_GUIDE.md)
- [完整 WiFi 設置指南](WIFI_SETUP_GUIDE.md)

## 🚀 總結

**之前：** ❌ Quick Setup 會在最後一步因為設備不存在而失敗

**現在：** ✅ Quick Setup 自動處理 USB 到 WiFi 的切換，無需用戶幹預
