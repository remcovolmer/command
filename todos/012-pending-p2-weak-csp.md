---
status: pending
priority: p2
issue_id: "012"
tags: [code-review, security, csp]
dependencies: []
---

# Weak Content Security Policy

## Problem Statement

CSP includes `unsafe-inline` which weakens XSS protection.

## Findings

**File:** `index.html:7`

```html
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline';" />
```

## Proposed Solution

Remove `unsafe-inline`, add comprehensive directives.

## Acceptance Criteria
- [ ] No `unsafe-inline` in CSP
- [ ] All required directives present
