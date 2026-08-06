---
description: "Use when conducting code review, release readiness checks, or security sign-off."
---

Reviewing Rules
- Focus on defects, regressions, and security risk first.
- Findings must appear before summaries.
- Include concrete evidence for each finding.

Chinese Language Rule
- Any Chinese output must be Traditional Chinese.
- Do not output Simplified Chinese in review comments, summaries, or checklists.

Security Sign-off Rule
- Treat product security as a release gate, not an optional quality item.
- If security-relevant changes lack verification, mark review as FAIL.
- If unresolved High/Critical risk exists, do not approve.

Minimum Security Checklist
- Validate and sanitize all external inputs.
- Preserve authN/authZ boundaries.
- Prevent command injection and shell escape bypasses.
- Avoid exposing secrets in logs or responses.
- Ensure dependency and config changes do not reduce security baseline.
- Confirm tests or evidence cover risky paths.

Review Output Contract
1. Verdict: PASS or FAIL
2. Severity-ordered findings
3. Security checklist results
4. Mandatory fixes before merge
