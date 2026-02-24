---
status: pending
priority: p3
issue_id: "050"
tags: [code-review, architecture, agent-native, terminal-pool]
dependencies: []
---

# Add eviction observability via IPC events and store state

## Problem Statement

The eviction lifecycle is invisible to anything outside the renderer's `terminalPool` singleton. No IPC events are emitted when a terminal is evicted or restored. The Zustand store and `TerminalSession` type do not track eviction state. This prevents future agent integrations and diagnostic tooling from observing pool behavior.

## Findings

**Source:** Agent-native reviewer (warnings 1-2). Related to existing TODO 040 (eviction UI indicator).

## Proposed Solutions

### Option A: Add IPC events + store field

1. Emit `terminal:evicted` and `terminal:restored` events from `TerminalManager`
2. Add `isEvicted?: boolean` to `TerminalSession` type
3. Update store when eviction/restoration occurs

**Effort:** Medium | **Risk:** Low

### Option B: IPC events only (lighter)

Just add the two events, skip the store field. Consumers can listen if they care.

**Effort:** Small | **Risk:** None

## Acceptance Criteria

- [ ] Eviction and restoration are observable via IPC events
- [ ] Optional: eviction state visible in Zustand store

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | New lifecycle states should be observable from day 1 |
