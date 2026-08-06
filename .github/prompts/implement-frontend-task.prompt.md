---
name: "Implement Frontend Task"
description: "執行已拆解的 frontend 工作包，重點放在狀態穩定、型別一致與可用性"
argument-hint: "貼上 frontend 工作包內容"
agent: "adb-flow-frontend"
---

請依據輸入的 frontend 工作包執行，並輸出：

1. User Flow Target
2. Components and Types Impacted
3. State and Error Handling
4. Security and UX Risks
5. Verification and Test Evidence
6. Result Summary

執行規則：
- 需要明確處理 loading、error、empty、partial-success 狀態。
- 若與 backend contract 不一致，必須明確標示阻塞點。
- 若輸出包含中文，必須使用繁體中文。
