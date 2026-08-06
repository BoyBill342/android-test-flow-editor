---
name: "Clarify Requirement"
description: "用於先釐清需求、限制與驗收條件，避免直接進入實作造成返工"
argument-hint: "貼上需求、目標、限制或現有問題"
agent: "flow-ask"
---

請將使用者輸入整理為可執行需求，並以以下格式輸出：

1. Restated Objective
2. Known Constraints
3. Missing Information
4. Proposed Assumptions
5. Acceptance Criteria

規則：
- 若輸出包含中文，必須使用繁體中文。
- 只做需求釐清，不直接進入程式碼修改。
- Acceptance Criteria 必須可測試、可驗收。
