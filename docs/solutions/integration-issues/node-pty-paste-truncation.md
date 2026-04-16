---
title: "Paste into Claude Code CLI truncates at ~1 KB — node-pty 1.1.x EAGAIN drop + ConPTY backpressure"
date: 2026-04-16
status: resolved
severity: high
category: integration-issues
platform: windows, macos, linux
tags:
  - paste
  - clipboard
  - node-pty
  - conpty
  - bracketed-paste
  - pty-backpressure
  - claude-code
component:
  - TerminalManager
  - terminalWriteLimits
  - xterm.js
  - node-pty
symptoms:
  - Pasting multi-line text into Claude Code CLI delivers only the first ~1 KB
  - Claude's "[Pasted text #N +X lines]" placeholder shows full line count but buffer holds partial content
  - Truncation mid-word, mid-line, non-deterministic above ~1018 bytes
  - Silent — no error, no toast, no log
root_causes:
  - node-pty <1.2 wraps writes in Node's tty.WriteStream, which silently drops data on EAGAIN when the OS PTY buffer fills
  - Windows ConPTY uses a separate named-pipe write path with its own ring-buffer backpressure that the upstream Unix fix does not cover
  - TerminalManager.writeToTerminal passed the full paste to pty.write in a single synchronous call with no chunking or flow control
  - IPC handler silently dropped any payload over 1 MB with no user feedback
---

# Paste into Claude Code CLI truncates at ~1 KB

## Problem

Users pasting multi-line text (code blocks, logs, diffs) into a Claude Code session inside Command Center saw only the first chunk reach Claude. Claude's `[Pasted text #N +X lines]` placeholder would sometimes report the correct line count while the actual buffer contained only the head of the payload. Truncation was mid-word, non-deterministic above ~1 KB, and completely silent — no error surfaced to the user or the logs.

Regular shell prompts rarely exceed the threshold, so normal terminal usage masked the bug. It only became visible when pasting into Claude's large input buffer.

## Root cause

Three problems stacked:

1. **`node-pty ^1.1.0` silently drops EAGAIN writes.** Pre-1.2 node-pty wraps PTY writes in Node's `tty.WriteStream`, which returns without error when the OS PTY buffer is full. VS Code historically masked this with a JS-side throttle; when they removed the workaround in December 2025, every downstream embedder pinned to `^1.1.0` (Cursor, Command Center) inherited the bug. Upstream fix: [node-pty PR #831](https://github.com/microsoft/node-pty/pull/831), shipped in `1.2.0-beta.10+`, which rewrote the Unix write path with raw `fs.write(fd, …)` + an EAGAIN queue + 5 ms retry + partial-write tracking.

2. **Windows ConPTY is a separate path.** PR #831's fix targets the Unix file-descriptor path. On Windows, `node-pty` talks to ConPTY via a named pipe (`conpty.cc`) with its own ring-buffer backpressure. Upgrading alone does not fully fix Windows — defensive chunking on the embedder side is required.

3. **`TerminalManager.writeToTerminal` had no chunking or flow control.** The IPC handler passed the entire clipboard payload (up to 1 MB) to `pty.write(data)` in one synchronous call. Any payload over the PTY buffer threshold would partially land and partially drop. The IPC handler also silently dropped payloads over 1 MB with no user feedback.

## Fix

Landed in three layers:

- **Upgrade `node-pty` to `1.2.0-beta.12`** (`package.json:55`) and rebuild the native module. Fixes the Unix (macOS/Linux) case entirely.
- **Defensive chunker in `TerminalManager.writePtySafe`** (`electron/main/services/TerminalManager.ts`):
  - Fast path: payloads ≤ 512 B go straight to `pty.write` — no behavioral change for typical keystrokes or small commands.
  - Slow path: split into 512 B chunks with `setImmediate` yield between writes so node-pty's queue can drain.
  - Bracketed-paste markers (`\x1b[200~` / `\x1b[201~`) are never split across chunks. The chunker rewinds the boundary back to before the marker if a naive cut would straddle it, so Claude Code still recognises the full bracketed paste.
  - On Windows only: `\r` bytes inside a bracketed-paste block are stripped before writing, because ConPTY interprets CRLF inconsistently mid-paste and causes swallowed or doubled lines.
- **Visible error on oversize payloads** (`electron/main/index.ts`, `electron/main/utils/terminalWriteLimits.ts`): replaced the silent 1 MB drop with an OS notification ("Paste too large — … KB exceeds the … KB terminal input limit. Use a file for larger content.") plus a console warning.

Unit tests in `test/terminalManager.test.ts` cover: fast path, 513 B / 10 KB round trips, empty payload, marker-straddle boundaries, Windows CRLF stripping inside/outside bracketed-paste blocks, non-Windows \r preservation, and Claude-terminal integration with large pastes. Validation helpers are tested in `test/ipcValidation.test.ts`.

## Deliberate non-goals

- **xterm.js config untouched.** xterm 5.5.0 already wraps pastes in `\x1b[200~…\x1b[201~` when the child enables bracketed-paste mode. Adding our own wrapping would double-wrap and leak literal `200~` into Claude's input.
- **Renderer paste flow untouched.** `preventDefault()` + `navigator.clipboard.readText()` + `api.terminal.write(id, text)` in `src/hooks/useXtermInstance.ts` is the correct shape and was already debugged twice (commits `038662c`, `359fea2`).
- **Upstream Claude Code CLI paste bugs not in scope.** Separate issues tracked at [anthropics/claude-code#5017](https://github.com/anthropics/claude-code/issues/5017), [#13125](https://github.com/anthropics/claude-code/issues/13125), [#24837](https://github.com/anthropics/claude-code/issues/24837). Those are Anthropic-side TUI issues and remain even after this fix.
- **1 MB cap retained.** Raising the cap invites ConPTY latency regressions. Users pasting more than 1 MB should use a file.
- **`writeToPty` (ccli/automation entry point) left on the direct `pty.write` path.** Those callers ship small, predictable payloads; adding chunking there would expand blast radius without benefit.

## References

- [node-pty PR #831 — Handle non-blocking PTY writes](https://github.com/microsoft/node-pty/pull/831)
- [Cursor forum — 1018-byte paste truncation, node-pty v1.1 vs v1.2](https://forum.cursor.com/t/terminal-paste-truncation-at-1018-bytes-outdated-node-pty-v1-1-vs-v1-2/152576)
- [Cursor forum — Terminal freezes on >1 KB paste (PTY layer)](https://forum.cursor.com/t/terminal-freezes-when-pasting-1kb-text-while-claude-code-is-running-pty-layer-issue/154801)
- [apiyi — Claude Code paste freeze: causes & fixes](https://help.apiyi.com/en/claude-code-paste-freeze-issue-fix-en.html)
- [xterm.js bracketed-paste support commit](https://github.com/xtermjs/xterm.js/commit/1dbcf70cee9ae88c69cf9724745cbdb7e5364dcc)
- [invisible-island xterm bracketed-paste spec](https://invisible-island.net/xterm/xterm-paste64.html)
- Plan: `docs/plans/2026-04-16-001-fix-paste-truncation-claude-code-plan.md`
