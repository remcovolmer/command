---
title: "Copy-on-select and Ctrl+C copy fail in Claude Code chats — xterm.js silently drops OSC 52"
date: 2026-07-08
status: resolved
severity: high
category: integration-issues
platform: windows, macos, linux
tags:
  - clipboard
  - osc52
  - copy-on-select
  - xterm.js
  - claude-code
  - mouse-tracking
  - terminal
component:
  - osc52Clipboard
  - useXtermInstance
  - xterm.js
  - claude-code
symptoms:
  - Highlighting text in a Claude Code chat never copies it to the clipboard
  - Ctrl+C copies only occasionally (~1 in 10); the rest of the time it interrupts Claude instead
  - No error, no toast, no log — the copy just does not happen
problem_type: integration_issue
root_cause: wrong_api
resolution_type: code_fix
---

# Copy-on-select and Ctrl+C copy fail in Claude Code chats — xterm.js silently drops OSC 52

## Problem

In Command's embedded Claude Code terminals, "highlight to copy" never worked and the Ctrl+C copy shortcut only succeeded about 1 in 10 times — the other times it sent SIGINT and interrupted Claude. The clipboard was never populated and there was no error.

## Root cause

Copy-on-select and `/copy` are implemented **by Claude Code, not by the terminal emulator**. A CLI cannot touch the OS clipboard directly, so it does two things:

1. Enables terminal **mouse tracking** (DECSET 1000/1002/1003/1006) to detect the selection drag.
2. Emits an **OSC 52** clipboard-write escape sequence (`ESC ] 52 ; <Pc> ; <base64> BEL/ST`) to ask the terminal to put the text on the clipboard.

Both halves broke inside Command:

- **xterm.js ships no OSC 52 handler and silently drops the sequence.** So every copy Claude Code emitted went nowhere. (xterm *does* handle OSC 8 hyperlinks — the presence of one OSC handler masked the absence of the other.)
- Because mouse tracking is on, xterm **forwards the drag to the PTY (Claude Code)** instead of building a *local* xterm selection. So Command's own Ctrl+C handler (`useXtermInstance.ts`), which copies only when `terminal.getSelection()` is non-empty, usually saw an empty selection and fell through to SIGINT. It worked only in the states where Claude Code happened to have mouse tracking off and a local selection existed — the "1 in 10".

Confirmed against Claude Code issues #42712 / #20974 (uses OSC 52), #59720 (sets mouse modes 1000/1002/1003/1006), #41954 (re-emits OSC 52 on every render during streaming), #42417 (OSC 52 UTF-8 → mojibake on Windows).

## What didn't work

- Hardening the Ctrl+C handler's selection detection — a dead end. The Ctrl+C path relies on a *local* xterm selection that mostly does not exist under mouse tracking, so no amount of selection-timing robustness fixes copy-on-select, which never routes through Ctrl+C at all.

## Fix

Register an OSC 52 write handler on the xterm parser and route it to the same Electron-native clipboard IPC the Ctrl+C path already uses (`navigator.clipboard` is unavailable in the packaged `file://` renderer — see the electron-file-origin clipboard note):

```ts
// useXtermInstance.ts — after terminal.open()
const osc52 = createOsc52ClipboardHandler({
  writeText: (text) => api.clipboard.writeText(text),
})
const osc52Disposable = terminal.parser.registerOscHandler(52, (data) => {
  osc52.handle(data)
  return true
})
// ...disposed in cleanup, before terminal.dispose()
```

The parse/decode/dedupe logic lives in a small unit-tested module (`src/utils/osc52Clipboard.ts`), mirroring the `spaceKeyWatchdog` / `osc8LinkRouter` seam. Four deliberate constraints, each learned from the upstream issues above:

- **Refuse reads (`Pd === '?'`).** An OSC 52 read asks the terminal to send the current clipboard *back* to the program — a clipboard-exfiltration vector. Classify it, never respond. (Writes from terminal programs are allowed, matching standard emulator behavior.)
- **Decode base64 as UTF-8**, not latin1, so diacritics and emoji round-trip instead of becoming mojibake (#42417, worst on Windows).
- **Dedupe identical consecutive writes** — Claude Code re-emits the same OSC 52 on every render while a selection is held during streaming (#41954), which would otherwise hammer the clipboard IPC.
- **Cap payload before the synchronous decode** — a tighter defensive bound mirroring `osc8LinkRouter`'s `MAX_URI_LENGTH` (xterm already caps the whole OSC payload at `PAYLOAD_LIMIT = 10 MB`, so this is defense-in-depth, not the binding guard).

The existing Ctrl+C handler is left in place as a fallback; with OSC 52 honored, copy-on-select populates the clipboard at selection time and Ctrl+C-to-copy is no longer needed.

## Prevention

- **When embedding a terminal emulator, treat OSC-sequence support as a feature checklist, not a default.** xterm.js only handles what you register (`terminal.parser.registerOscHandler`). Copy-on-select, clipboard, and `/copy` in any TUI (Claude Code, vim, tmux) depend on OSC 52 being honored by the host — verify it end-to-end, because a dropped OSC sequence fails *silently*.
- **A CLI's "copy" is the terminal's responsibility to fulfil.** When a user reports a CLI clipboard feature "not working," check the host terminal's OSC 52 handling before touching the CLI.
- **For any OSC 52 handler: refuse reads.** Allowing OSC 52 reads lets a program exfiltrate the user's clipboard. Test asserts no bytes are written back to the PTY on a read request.
- Regression coverage: `test/osc52Clipboard.test.ts` — UTF-8 round-trip, read-refusal, empty/malformed/oversized payloads, streaming-spam dedup.

## References

- PR #156 (fix)
- Sibling: `docs/solutions/integration-issues/node-pty-paste-truncation.md` (the paste-side counterpart of the same clipboard/PTY boundary)
- Claude Code issues: #42712, #20974 (OSC 52), #59720 (mouse tracking), #41954 (streaming re-emit), #42417 (UTF-8 mojibake)
