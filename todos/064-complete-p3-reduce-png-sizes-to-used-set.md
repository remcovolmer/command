---
status: pending
priority: p3
issue_id: "064"
tags: [code-review, yagni, simplification]
dependencies: []
---

# Reduce PNG Sizes to Actually Used Set

## Problem Statement

The icon generation script produces 8 PNG sizes (16, 32, 48, 64, 128, 256, 512, 1024) but only 4 are actually consumed: 16, 32, 48, 256 (by ICO and electron-builder). This is a Windows-only app with no macOS target configured. Sizes 64, 128, 512, and 1024 are generated but never referenced.

## Findings

- **Code simplicity reviewer**: YAGNI violation — 4 unused PNG files generated and stored in repo

## Proposed Solutions

### Option A: Reduce sizes array (Recommended)

Change `scripts/generate-icons.mjs` line 21:
```js
// From:
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
// To:
const sizes = [16, 32, 48, 256];
```

- Pros: Fewer unused files, faster generation
- Cons: Need to add sizes back if macOS support is added
- Effort: Small
- Risk: None

## Acceptance Criteria

- [ ] Only 4 PNG sizes generated
- [ ] ICO still contains correct sizes
- [ ] electron-builder icon.png (256x256) still generated

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-02 | Created from code review | |
