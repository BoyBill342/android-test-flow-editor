---
name: "Fullstack Breakdown"
description: "將同時涵蓋 backend 與 frontend 的需求拆成可平行執行的工作包"
argument-hint: "貼上需求與範圍，輸出 backend/frontend 拆解"
agent: "flow-plan"
---

請把輸入需求拆解成 backend、frontend、shared 三區塊，並輸出：

1. Goal and Scope
2. Impacted Files and Interfaces
3. Backend Work Packages
4. Frontend Work Packages
5. Shared Contract Changes (API/schema/error model)
6. Integration Order and Checkpoints
7. Risks and Mitigations
8. Validation and Pass Criteria

拆解規則：
- 優先切分為可獨立交付的最小單位。
- 每個工作包需包含：輸入、輸出、完成定義、驗證方式。
- 若涉及資安，必須列入 Security Gate 檢查項目。
- 若輸出包含中文，必須使用繁體中文。
