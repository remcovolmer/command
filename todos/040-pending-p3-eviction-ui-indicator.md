---
status: pending
priority: p3
issue_id: "040"
tags: [code-review, ux, terminal-pool]
dependencies: []
---

# Add Visual Indicator for Evicted Terminal Tabs

## Problem Statement

When a terminal is evicted, there is no visual feedback to the user. Switching back to an evicted terminal triggers a brief re-initialization (50-200ms). Users may not understand why there is a momentary reload.

## Findings

The eviction is transparent — no UI state reflects it. A small badge or dimmed appearance on evicted terminal tabs would improve observability.

## Proposed Solutions

### Option A: Subtle badge/dim on tab

Add a small indicator (e.g., dimmed text, small dot) on terminal tabs for evicted terminals.

**Pros:** Users understand the behavior
**Cons:** Adds visual noise for a largely invisible optimization
**Effort:** Small
**Risk:** Low

### Option B: Leave as-is

The optimization is meant to be transparent. Users don't need to know.

**Pros:** Simpler, no UI clutter
**Cons:** Occasional confusion when switching to evicted terminal shows brief reload

## Acceptance Criteria

- [ ] Evicted terminal tabs have visual distinction (if implemented)
- [ ] Indicator disappears on restoration

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Transparent optimizations benefit from subtle observability |
