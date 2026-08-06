# 🚀 WiFi ADB 設置 - 立即開始

## 問題已解決 ✅

你遇到的 WiFi 設置問題已經修復。系統現在會自動處理 USB 到 WiFi 的轉換。

---

## 立即使用

### 1️⃣ 打開應用

在瀏覽器中打開：`http://127.0.0.1:5173` (或你的開發伺服器地址)

### 2️⃣ 找到 WiFi Quick Setup 面板

在主頁面找到「WiFi Quick Setup」部分。

### 3️⃣ 填入設備信息

```
WiFi IP Address:  [10.116.209.60]  ← 輸入你的設備 IP
Port:             [5555]            ← 通常默認 5555
Use Root Persist: [已移除]
```

### 4️⃣ 確認並執行

```
☑️ 確認 WiFi 是私有網絡
🔘 Run WiFi Quick Setup  ← 點擊執行
```

### 5️⃣ 等待完成

系統會自動執行以下步驟：
- ✅ 連接 USB 設備
- ✅ 啟用 WiFi tcpip 模式
- ✅ 連接到 WiFi
- ✅ **斷開 USB (新)**
- ✅ **等待 WiFi 重連 (新)**
- ✅ 驗證設備狀態

---

## 預期結果

### ✅ 成功案例

```
[OK] Step 1 - Wait For Device (USB)
     Output: (empty)

[OK] Step 2 - Enable WiFi ADB
     Output: restarting in TCP mode port: 5555

[OK] Step 3 - WiFi Connect
     Output: connected to 10.116.209.60:5555

[OK] Step 4 - USB Disconnect
     Output: (empty)

[OK] Step 5 - Wait For Device (WiFi)
     Output: (empty)

[OK] Step 6 - Check Boot Property
     Output: 1
     (表示開機完成!)
```

### ❌ 舊版本（已修復）

原來的問題在第 4 步會出現：
```
[ERR] Step 4 - Check Boot Property
Output: adb.exe: device 'FA45X3N00002' not found
```

---

## 修復內容

### 新增功能

#### 1. USB Disconnect 步驟
- **何時使用：** WiFi 連接後
- **作用：** 移除 USB 連接，防止混淆
- **命令：** `adb disconnect <serial>`

#### 2. Wait For Device (WiFi)
- **何時使用：** USB Disconnect 後
- **作用：** 確保設備通過 WiFi 重新連接
- **命令：** `adb wait-for-device`

### 為什麼需要這些步驟？

```
發生的事情：
1. 設備通過 USB 連接 → adb 知道 "FA45X3N00002"
2. 通過 WiFi 連接 → adb 現在知道 "10.116.209.60:5555"
3. 問題：adb 同時知道兩個位置，指令會用錯！

解決方案：
1. 明確斷開 USB → adb 只知道 WiFi
2. 等待 WiFi 連接 → 確保 WiFi 穩定
3. 執行操作 → 現在只能用 WiFi（正確的！）
```

---

## 檢查清單

執行前：
- [ ] 設備已通過 USB 連接
- [ ] 設備和主機在同一 WiFi 網絡
- [ ] 已記下設備的 WiFi IP 地址
- [ ] 防火牆允許 5555 埠通信

執行後：
- [ ] Quick Setup 完成所有 6 步（都是 OK）
- [ ] 看到「Boot Property = 1」表示成功
- [ ] 點擊「Refresh Devices」更新設備列表

---

## 常見情況

### 情況 1: 已連接 USB，要轉換到 WiFi

**操作：**
1. 選擇 USB 設備
2. 執行 WiFi Quick Setup
3. 設置完成後會自動斷開 USB，只保留 WiFi

**結果：** ✅ 設備現在通過 WiFi 連接

### 情況 2: 已有 WiFi，要保持連接

**操作：**
1. 在設備列表選擇 WiFi 地址 (例：10.116.209.60:5555)
2. 執行其他操作（如安裝應用）

**結果：** ✅ 直接使用 WiFi，無需重新設置

### 情況 3: 要同時保持 USB 和 WiFi

**操作：** 
不執行 USB Disconnect 步驟，改用 Flow Blocks 自訂流程

**結果：** 兩個連接並存（需手動管理）

---

## 如果還是失敗

### 步驟 1: 刷新頁面

按 `Ctrl+F5` 確保已加載最新代碼

### 步驟 2: 檢查連接

```bash
# 終端執行
adb devices

# 應該看到：
# FA45X3N00002          device
# 10.116.209.60:5555    device
```

### 步驟 3: 手動清理

```bash
# 終端執行
adb disconnect  # 斷開所有連接
adb connect 10.116.209.60:5555  # 重新連接 WiFi
```

### 步驟 4: 查看詳細日誌

查看瀏覽器控制檯 (F12) 或後端伺服器日誌，查找錯誤信息

---

## 文檔參考

| 文檔 | 內容 |
|------|------|
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | 快速參考表 |
| [WIFI_SETUP_GUIDE.md](WIFI_SETUP_GUIDE.md) | 完整設置指南 |
| [WIFI_SETUP_GUIDE.md](WIFI_SETUP_GUIDE.md) | WiFi 設定完整說明 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系統架構 |

---

## 📞 支持

如果遇到問題，檢查以下幾點：

1. **版本是否最新？** 確保已刷新代碼
2. **IP 地址正確嗎？** 確認設備 IP
3. **網絡連通嗎？** ping 一下設備 IP
4. **防火牆設置？** 允許 5555 埠
5. **ADB 版本？** 確保 adb 已安裝並可用

---

**🎉 恭喜！WiFi 設置現在應該能正常工作了！**
