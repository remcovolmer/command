---
status: pending
priority: p3
issue_id: "065"
tags: [code-review, simplification]
dependencies: []
---

# Use copyFileSync for icon.png Instead of Re-rendering

## Problem Statement

In `scripts/generate-icons.mjs`, `icon.png` (256x256) is rendered from SVG via sharp, but `icon-256.png` is already generated in the loop. This is a redundant render.

## Proposed Solutions

Replace lines 36-40 in `generate-icons.mjs`:
```js
// From:
await sharp(svgBuffer).resize(256, 256).png().toFile(join(buildDir, 'icon.png'));

// To:
copyFileSync(join(buildDir, 'icon-256.png'), join(buildDir, 'icon.png'));
```

- Effort: Small
- Risk: None

## Acceptance Criteria

- [ ] `icon.png` is identical to `icon-256.png`
- [ ] No re-render from SVG

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-02 | Created from code review | |
