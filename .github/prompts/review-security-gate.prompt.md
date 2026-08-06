---
name: "Review Security Gate"
description: "在合併前進行資安與回歸風險審查，輸出 PASS/FAIL"
argument-hint: "貼上 PR 摘要、diff 或變更清單"
agent: "project-reviewer"
---

請進行 release gate 審查，並使用以下格式輸出：

1. Verdict: PASS or FAIL
2. Findings by severity (Critical -> High -> Medium -> Low)
3. Security Gate Checklist (pass/fail per item)
4. Required Fixes Before Merge
5. Residual Risks and Test Gaps
6. Brief Summary

規則：
- 若有未解的 Critical/High 問題，Verdict 必須為 FAIL。
- 若變更涉及高風險區且無驗證證據，Verdict 必須為 FAIL。
- 若輸出包含中文，必須使用繁體中文。
