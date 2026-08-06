---
name: "Implement Backend Task"
description: "執行已拆解的 backend 工作包，重點放在安全邊界、正確性與測試證據"
argument-hint: "貼上 backend 工作包內容"
agent: "adb-flow-backend"
---

請依據輸入的 backend 工作包執行，並輸出：

1. Objective
2. Files and Modules Impacted
3. Key Decisions
4. Security and Regression Risks
5. Verification and Test Evidence
6. Result Summary

執行規則：
- 若工作包資訊不足，先補齊假設再實作。
- 不可弱化 restricted command 安全邏輯。
- 若輸出包含中文，必須使用繁體中文。
