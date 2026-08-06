# AI Workflow Guide

本文件定義專案的 AI 協作流程，目標是讓需求可以穩定地被拆解、實作與審查。

## 1. 標準流程（Ask -> Plan -> Build -> Review）

1. Ask（釐清需求）
- 使用 /Clarify Requirement
- 產出可驗收的 Acceptance Criteria

2. Plan（拆解工作）
- 使用 /Fullstack Breakdown
- 將需求切成 backend、frontend、shared 三類工作包

3. Build（分工實作）
- backend 工作包使用 /Implement Backend Task
- frontend 工作包使用 /Implement Frontend Task

4. Review（資安關卡）
- 使用 /Review Security Gate
- 高風險或缺乏驗證證據時必須 FAIL

## 2. Fullstack 任務如何拆給 AI

當需求同時涉及 backend 與 frontend，先不要直接實作，先切分成工作包。

每個工作包都必須有 4 個欄位：
- Input：此工作包依賴的前置資料或契約
- Output：此工作包交付結果
- DoD：完成定義（可驗收）
- Validation：驗證方式（測試、build、檢查）

### 拆解模板

- Backend Work Package
  - Input: API 請求欄位、既有 validator 規則
  - Output: endpoint/logic 更新與錯誤模型
  - DoD: 行為正確且不弱化安全限制
  - Validation: backend 測試或等價驗證證據

- Frontend Work Package
  - Input: API contract、UI 互動需求
  - Output: component/state/type 更新
  - DoD: loading/error/empty/partial-success 完整可用
  - Validation: build/type check 與手動流程驗證

- Shared Contract Package
  - Input: backend response schema 與 frontend type
  - Output: 一致的欄位、錯誤碼、訊息語意
  - DoD: 雙方契約一致，無隱性破壞
  - Validation: 以樣本 payload 或測試比對

## 3. 建議執行順序

1. 先處理 Shared Contract Package
2. 再處理 Backend Work Package
3. 最後處理 Frontend Work Package
4. 進入 Review Security Gate

## 4. 必過規則

- 中文內容一律使用繁體中文。
- 資安是 release gate，不是建議項。
- 任何未解的 Critical/High 風險不得合併。

## 5. 快速使用方式

1. 在 Chat 輸入 /Clarify Requirement，貼需求。
2. 接著輸入 /Fullstack Breakdown，拿到工作包。
3. 分別把 backend 工作包丟給 /Implement Backend Task。
4. 把 frontend 工作包丟給 /Implement Frontend Task。
5. 最後用 /Review Security Gate 做 PASS/FAIL。
