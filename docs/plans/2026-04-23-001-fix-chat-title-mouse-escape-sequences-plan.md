---
title: Fix chat titles polluted by mouse-tracking escape sequences
type: fix
status: active
date: 2026-04-23
---

# Fix chat titles polluted by mouse-tracking escape sequences

## Overview

Chat titles sometimes render as garbage like `[<35;103;14M[<35;100;15M[<35;96;16...` instead of the user's first prompt. These strings are SGR mouse-tracking reports (`ESC [ < Pb ; Px ; Py M/m`) that leak into the auto-naming input buffer in `TerminalManager`. The current ANSI-stripping regex does not recognize the `<` private-marker byte, so the ESC byte is stripped by the control-char filter but the rest of the sequence survives as "printable text" and becomes the title.

---

## Problem Frame

When a Claude terminal has mouse tracking enabled (xterm.js + Claude's SGR mouse mode `ESC [ ? 1006 h`), mouse movements/clicks over the terminal before the user types produce bytes like `\x1b[<35;103;14M` on PTY stdin. `TerminalManager.handleAutoNaming` buffers these bytes:

- `electron/main/services/TerminalManager.ts:354` strips ANSI with `/\x1b\[[0-9;]*[a-zA-Z]/g`, which only matches CSI sequences whose parameter bytes are digits or `;`.
- SGR mouse reports start with `\x1b[<` — the `<` is a *private parameter marker* (0x3C), not in the character class, so the regex fails to consume the sequence.
- The follow-up `[\x00-\x1f\x7f]` filter removes the ESC byte (0x1B) but leaves `[<35;103;14M…` as visible text.
- When the user finally hits Enter (or mouse input already contains an `M` terminator that reads as a normal letter), `extractTaskTitle` takes the first 40 chars of the contaminated buffer as the title.

The same class of bug can be triggered by any CSI sequence using private markers (`<`, `?`, `>`, `=`) or intermediate bytes (space, `-`, `/`), and by non-CSI escapes such as OSC (`\x1b]…\x07`) or SS3 (`\x1bO…`).

---

## Requirements Trace

- R1. Mouse-tracking reports received on PTY stdin must never appear in a chat title.
- R2. All standard ANSI escape sequences (CSI with any private/parameter/intermediate bytes, OSC, SS2/SS3, simple `ESC X` forms) must be stripped from the auto-naming buffer.
- R3. Normal prompts that currently auto-name correctly must continue to do so (no regression in title extraction for plain text input).
- R4. Existing Claude terminals that are already titled remain unaffected (fix only runs while a terminal is still untitled).

---

## Scope Boundaries

- Do not disable mouse tracking — xterm.js/Claude Code legitimately use it.
- Do not change the UX of auto-naming (timing, trigger on Enter, 40-char cap, capitalization).
- Do not touch `terminal:title` IPC surface or renderer-side display.
- Do not retitle terminals that were already mis-titled before this fix (a stale-title cleanup is out of scope; users can rename manually).

---

## Context & Research

### Relevant Code and Patterns

- `electron/main/services/TerminalManager.ts:217` — `writeToTerminal` gates auto-naming on `terminal.type === 'claude'` and `!terminalTitled`.
- `electron/main/services/TerminalManager.ts:328` — `handleAutoNaming` buffers stripped input per-terminal in `terminalInputBuffers`.
- `electron/main/services/TerminalManager.ts:354` — **the bug**: ANSI strip regex does not cover private markers.
- `electron/main/services/TerminalManager.ts:362` — `extractTaskTitle` trims to printable range and skips slash commands / greetings.

### Institutional Learnings

- None specific to auto-naming. The `docs/solutions/` directory has no entries for ANSI parsing; this is the first encounter with private-marker CSI sequences in stdin handling.

### External References

- ECMA-48 CSI grammar: `CSI = ESC '[' (private-marker)? (param-bytes 0x30-0x3F)* (intermediate-bytes 0x20-0x2F)* final-byte (0x40-0x7E)`.
- SGR mouse (xterm): `ESC [ < Pb ; Px ; Py M|m`.
- `ansi-regex` reference pattern covers CSI + OSC + simple escapes and is a good specification target without adding a dependency.

---

## Key Technical Decisions

- **Broaden the CSI regex in place** rather than adding the `ansi-regex` npm dependency. The stripping only needs to cover what a PTY could send upstream on stdin; a self-contained regex is small, auditable, and avoids shipping another package.
- **Also strip OSC and simple `ESC X` escapes** while we're here. Mouse tracking is the reported symptom but any private-marker or OSC sequence would produce the same class of garbage title, and the fix is one regex each.
- **Keep the final control-char pass.** After escapes are removed, the existing `[\x00-\x1f\x7f]` filter still protects against stray C0/C1 bytes (e.g., a bare `\x7f` that isn't backspace-handled, legacy mouse mode bytes).
- **Do not attempt a stateful parser.** An ESC sequence can in theory be split across two PTY chunks. In practice on Windows ConPTY and macOS PTYs, a single mouse event arrives in one `data` callback, and the buffer is reset on Enter anyway. A streaming parser is more code than the risk warrants; if a split sequence ever slips through, it contributes at most a handful of stray chars that the printable-char filter in `extractTaskTitle` already trims, and the user can rename.

---

## Open Questions

### Resolved During Planning

- *Should we just disable mouse tracking while untitled?* No — it would break Claude Code's UI (scroll, selection) during the first prompt.
- *Should we clear already-contaminated titles on next app start?* No — out of scope; rename is trivial and a migration risks clobbering legitimate titles.

### Deferred to Implementation

- Whether to extract the ANSI-strip regex into a named constant vs. inline comment. Either is fine; decide while editing.

---

## Implementation Units

- [x] U1. **Broaden ANSI stripping in `handleAutoNaming`**

**Goal:** Strip all realistic ANSI escape sequences from the auto-naming input buffer so mouse-tracking reports (and similar private-marker CSI, OSC, SS3 sequences) never reach `extractTaskTitle`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `electron/main/services/TerminalManager.ts`
- Test: `test/terminalManager.test.ts`

**Approach:**
- Replace the single narrow regex at line 354 with a small set that covers:
  - CSI with optional private marker, any parameter/intermediate bytes, final byte: `\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]`
  - OSC terminated by BEL or ST: `\x1b\][\s\S]*?(?:\x07|\x1b\\)`
  - Simple escapes `\x1b[ ()#%]?.` (covers SS2/SS3 `\x1bO?`, charset selects, etc.)
- Keep the trailing `[\x00-\x1f\x7f]` filter as a safety net.
- No behavior change to buffering, Enter handling, backspace handling, or title extraction.

**Patterns to follow:**
- Inline regex constants with a short comment, matching the style already used for bracketed-paste markers elsewhere in the same file.

**Test scenarios:**
- Happy path: plain text input `"refactor terminal pool"` → buffer accumulates the text; Enter produces title `"Refactor terminal pool"`. (Guards R3.)
- Edge case: input begins with a stream of SGR mouse reports (`\x1b[<35;103;14M\x1b[<35;100;15M\x1b[<0;96;16Mhello world`) followed by Enter → buffer contains only `"hello world"`; title is `"Hello world"`. (Guards R1, R2.)
- Edge case: input contains an OSC title-set sequence (`\x1b]0;ignored\x07task name`) → buffer contains `"task name"`. (Guards R2.)
- Edge case: input contains SS3 cursor key (`\x1bOA`) then `"up"` → buffer is `"up"`; title extraction returns `null` (too short), no title set. (Guards R2, R3.)
- Edge case: already-titled terminal (`terminalTitled=true`) receives mouse reports → `handleAutoNaming` is not invoked; no change to stored title. (Guards R4 — can be asserted via `writeToTerminal` behavior or by verifying the guard at line 218.)

**Verification:**
- Running the app, moving the mouse across a freshly created Claude terminal before typing, then typing a real prompt and pressing Enter produces a clean title.
- Unit tests above pass.
- No regression in existing `test/terminalManager.test.ts` suite.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Regex over-strips legitimate printable content that happens to follow an ESC byte the user actually typed. | Very unlikely via PTY stdin (Ctrl+[ produces a bare ESC, not a full CSI). The simple-escape regex consumes exactly `ESC` + one following char, so a user typing `^[` followed by text loses at most one character — acceptable and far better than today. |
| Split ESC sequence across two `data` callbacks leaves a fragment in the buffer. | The buffer is cleared on Enter; any fragment is at worst a few stray chars and will be trimmed or filtered by `extractTaskTitle`'s printable-range filter. Documented in decisions, not mitigated further. |
| Future addition of new terminal types that also need stripping. | The function is already gated on `type === 'claude'`; adding another type is a conscious change and can reuse the same regex set. |

---

## Sources & References

- Related code: `electron/main/services/TerminalManager.ts` (`handleAutoNaming`, `extractTaskTitle`)
- ECMA-48 / xterm control sequences documentation (external)
