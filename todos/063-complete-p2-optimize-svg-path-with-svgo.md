---
status: pending
priority: p2
issue_id: "063"
tags: [code-review, performance, optimization]
dependencies: ["062"]
---

# Optimize SVG Path Data with SVGO

## Problem Statement

The logo SVG path data is raw Inkscape output (~30KB). SVG optimization tools like SVGO can typically reduce path data by 30-60% by removing unnecessary precision, merging redundant commands, and cleaning coordinates. This affects both the component file size and the favicon/icon assets.

## Findings

- **Performance oracle**: SVG path is unoptimized Inkscape output with excessive decimal precision
- **TypeScript reviewer**: 31KB of unoptimized SVG path data; optimize with SVGO first

## Proposed Solutions

### Option A: Run SVGO on build/icon.svg before generating assets (Recommended)

Add SVGO as a devDependency and run it as part of the icon generation pipeline, or as a one-time optimization of the source SVG.

```bash
npx svgo build/icon.svg -o build/icon.svg --precision 2
```

- Pros: Reduces all downstream assets (PNGs, ICO, favicon, inline component)
- Cons: One-time step or minor script change
- Effort: Small
- Risk: Low — visual diff to verify no quality loss

## Technical Details

- **Affected files**: `build/icon.svg`, `public/favicon.svg`, `src/components/LogoIcon.tsx` (after extraction)
- **Estimated reduction**: 30-60% of path data size

## Acceptance Criteria

- [ ] SVG path data is optimized (reduced precision, merged commands)
- [ ] Visual output is identical at all rendered sizes
- [ ] All generated icons (PNG, ICO) still look correct

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-02 | Created from code review | Performance and TypeScript reviewers flagged |

## Resources

- SVGO: https://github.com/svg/svgo
