---
status: pending
priority: p3
issue_id: "021"
tags: [code-review, cleanup]
dependencies: []
---

# Duplicate Fit Effects

## Problem Statement

Two useEffects both call fit() on isActive change - already addressed in recent changes.

## Findings

**File:** `src/components/Terminal/Terminal.tsx`

The file was recently refactored to consolidate fit logic into `safeFit` callback.

## Action

Verify the consolidation is complete - may already be resolved.
