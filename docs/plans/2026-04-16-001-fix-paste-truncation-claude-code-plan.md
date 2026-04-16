---
title: "fix: Paste truncation in Claude Code CLI (node-pty 1.1 bug + ConPTY defense)"
type: fix
status: active
date: 2026-04-16
---

# fix: Paste truncation in Claude Code CLI

## Overview

Pasting multi-line text into a Claude Code chat inside Command Center drops part of the content. Claude's `[Pasted text #N +X lines]` placeholder sometimes shows the right line count while the actual buffer contains only the first ~1 KB, matching a known, documented node-pty 1.1.x truncation bug. Fix the root cause (upgrade `node-pty`) and add a Windows/ConPTY defensive chunker so paste survives PTY backpressure on all platforms.

## Problem Frame

Observed behavior: user pastes a block of text (e.g. 100+ lines of code) into a Claude Code terminal via `Ctrl+V`; only the first chunk reaches Claude. Truncation is mid-line and non-deterministic above ~1 KB. The issue hits Claude Code because Claude enables bracketed paste and opens a large input buffer; regular shell prompts rarely exceed the threshold so the bug hides.

Root cause is in the PTY write path, not in xterm.js or Claude Code:

- Pre-1.2 `node-pty` wraps writes in Node's `tty.WriteStream`, which **silently drops data on EAGAIN** when the OS PTY buffer fills. VS Code historically masked this with a JS-side throttle; when that workaround was removed in Dec 2025, every downstream embedder pinned to `node-pty ^1.1.0` (Cursor, this app) inherited the bug.
- `node-pty` PR [#831](https://github.com/microsoft/node-pty/pull/831) rewrote the Unix write path with raw `fs.write(fd, …)` + an EAGAIN queue + 5 ms retry + partial-write tracking, shipped in **`1.2.0-beta.10`+**.
- On Windows (the primary affected platform here) `node-pty` uses ConPTY via a named pipe (`conpty.cc`). PR #831's fix targets the Unix path only. Windows still benefits from other 1.2 fixes but needs a defensive chunker on the embedder side.

Current write path in this repo (`electron/main/services/TerminalManager.ts:207-221`):

```
writeToTerminal(id, data) {
  // auto-naming hook (Claude only)
  pty.write(data)   // one synchronous call, no chunking, no flow control
}
```

The renderer reads the whole clipboard (`src/hooks/useXtermInstance.ts:237-245`), forwards it as one IPC message (`electron/preload/index.ts:262-263`), the main process accepts up to 1 MB (`electron/main/index.ts:506-510`) and hands the entire blob to `pty.write()`. No chunking anywhere.

Secondary issue: `electron/main/index.ts:508` silently drops any `terminal:write` payload over 1 MB with no telemetry, no error, no toast.

## Requirements Trace

- R1. Pasting up to ~64 KB of text into a Claude Code terminal delivers the full payload to Claude on both Windows and macOS.
- R2. Pasting at boundary sizes (2 KB, 10 KB, 64 KB, 256 KB) round-trips without truncation, re-ordering, or mid-word loss.
- R3. Bracketed paste markers (`\x1b[200~` / `\x1b[201~`) are never split across chunks, so Claude still recognises the paste as one unit.
- R4. Payloads above the 1 MB IPC cap fail loudly (user-visible error) instead of silently disappearing.
- R5. No regression on small/typical interactive input (single keystrokes, short commands, prompt dialogs).
- R6. No regression on normal (non-Claude) shell terminals.

## Scope Boundaries

- Not changing xterm.js paste handling. xterm 5.5.0 already wraps pastes in `\x1b[200~…\x1b[201~` when the child enables bracketed-paste mode (which Claude does). Adding our own wrapping would double-wrap.
- Not moving paste to an Electron-clipboard bypass (renderer already reads the clipboard correctly; the bug is downstream).
- Not fixing upstream Claude Code CLI paste bugs ([#5017](https://github.com/anthropics/claude-code/issues/5017), [#13125](https://github.com/anthropics/claude-code/issues/13125), [#24837](https://github.com/anthropics/claude-code/issues/24837)). Those are Anthropic-side TUI issues and will remain after this fix. Document them so we don't chase them here.
- Not refactoring `handleAutoNaming`. It processes pasted input but does not truncate — its character-stripping regex runs on the auto-naming *buffer*, not on the data forwarded to the PTY.
- Not touching the `writeToPty` helper at `TerminalManager.ts:510-515`. It is used by automation/ccli flows with small payloads; apply chunking only at the interactive `writeToTerminal` entry point unless the research in Unit 2 proves otherwise.

## Context & Research

### Relevant Code and Patterns

- `electron/main/services/TerminalManager.ts:207-221` — `writeToTerminal`, the one interactive entry point. Add chunking here.
- `electron/main/services/TerminalManager.ts:510-515` — `writeToPty`, a second entry point used by ccli/automation (not user paste).
- `electron/main/index.ts:506-510` — IPC handler with the silent 1 MB drop.
- `electron/preload/index.ts:262-263` — one-way `ipcRenderer.send` for `terminal:write`. Fine; no change needed.
- `src/hooks/useXtermInstance.ts:224-248` — Ctrl+V handler; `preventDefault()` is correct (added in commit `359fea2` to prevent double paste).
- `src/hooks/useXtermInstance.ts:128-139` — xterm init; bracketed paste on by default in 5.5.0. Leave untouched.
- `test/terminalManager.test.ts:1-40` — existing test pattern with mocked `node-pty`. Re-use the `mockWrite` fixture for chunking assertions.
- `package.json:55` — `"node-pty": "^1.1.0"` — the version that contains the bug.

### Institutional Learnings

- `docs/solutions/integration-issues/claude-status-indicator-hook-watcher-session-matching.md` — reinforces that `TerminalManager` is the single choke point for everything Claude-related; changes here should stay narrow to avoid breaking the hook/BiMap flow.
- No existing `docs/solutions/` entry on PTY writes, paste, or node-pty upgrades. Add a compound note once the fix is verified.

### External References

- [node-pty PR #831 — Handle non-blocking PTY writes](https://github.com/microsoft/node-pty/pull/831) — the upstream fix.
- [Cursor forum — 1018-byte paste truncation, node-pty v1.1 vs v1.2](https://forum.cursor.com/t/terminal-paste-truncation-at-1018-bytes-outdated-node-pty-v1-1-vs-v1-2/152576) — same bug in a sibling product; confirms `^1.1.0 → 1.2.x` as the remediation.
- [Cursor forum — Terminal freezes on >1 KB paste (PTY layer)](https://forum.cursor.com/t/terminal-freezes-when-pasting-1kb-text-while-claude-code-is-running-pty-layer-issue/154801) — same class, hang symptom.
- [xterm.js bracketed paste commit](https://github.com/xtermjs/xterm.js/commit/1dbcf70cee9ae88c69cf9724745cbdb7e5364dcc) — confirms xterm.js owns `\x1b[200~/\x1b[201~` wrapping.
- [invisible-island xterm bracketed paste spec](https://invisible-island.net/xterm/xterm-paste64.html) — marker format reference for the don't-split rule.
- [apiyi — Claude Code paste freeze: causes & fixes](https://help.apiyi.com/en/claude-code-paste-freeze-issue-fix-en.html) — independent confirmation of the ConPTY ring-buffer zone around 10 KB.
- [anthropics/claude-code#5017](https://github.com/anthropics/claude-code/issues/5017), [#13125](https://github.com/anthropics/claude-code/issues/13125), [#24837](https://github.com/anthropics/claude-code/issues/24837) — upstream Claude paste bugs, out of scope but worth referencing.

## Key Technical Decisions

- **Upgrade `node-pty` to `1.2.0-beta.10` or the latest stable 1.2.x, whichever is newer at implementation time.** This is the documented upstream fix and alone resolves the Unix (macOS) case.
- **Add a defensive main-process chunker around `pty.write`** even after the upgrade. PR #831's Unix fix does not cover ConPTY on Windows, and the primary user is on Windows 11 + Git Bash. Chunk size 512 bytes with a single-tick yield (`setImmediate`) between chunks.
- **Never split across bracketed-paste markers.** Before each chunk boundary, if the next 6 bytes would start `\x1b[200~` or `\x1b[201~` mid-way, back the boundary off to the marker edge. Simpler heuristic: scan the payload once, split only at safe byte positions (no marker straddle).
- **Gate the chunker on payload size.** For payloads ≤512 bytes, call `pty.write(data)` directly (preserves existing behavior and tests). Chunk only when `data.length > 512`.
- **Normalise line endings on Windows inside a bracketed-paste block.** ConPTY interprets CRLF inconsistently mid-paste; strip `\r` between `\x1b[200~` and `\x1b[201~`. Leave interactive `\r` (the user's Enter) untouched.
- **Replace the silent 1 MB drop with a user-visible error.** Emit a `terminal:error` event or a toast; document the cap. This is cheap and fixes a real "where did my paste go?" foot-gun independent of the main bug.
- **Do not touch the renderer paste flow.** `preventDefault()` + `clipboard.readText()` + `api.terminal.write(id, text)` is the right shape and was already debugged twice (commits `038662c`, `359fea2`).

## Open Questions

### Resolved During Planning

- *Is the Claude Code CLI bug or our PTY layer the cause?* — PTY layer. The `^1.1.0` version range is the documented broken one; truncation at ~1 KB aligns with EAGAIN drop, not with any Claude-side behavior.
- *Do we need to wrap pastes in `\x1b[200~/\x1b[201~` ourselves?* — No. xterm.js 5.5.0 does it when the child enables bracketed paste (Claude does). Wrapping again would leak literal `200~` into the chat.
- *Should paste bypass xterm via a direct Electron clipboard→IPC path?* — No. The clipboard read already works; the bug is in `pty.write`.

### Deferred to Implementation

- *Exact chunk size on Windows ConPTY.* Start at 512 B; if a 10 KB paste still truncates, drop to 256 B. Decide empirically during manual verification (Unit 5), not in the plan.
- *Inter-chunk delay.* `setImmediate` should be enough; only fall back to `setTimeout(r, 4)` if ConPTY still shows loss. Decide empirically.
- *Whether `writeToPty` (non-interactive entry point) needs the same chunker.* Profile in Unit 2 — if ccli/automation writes can exceed 512 B, route them through the same helper; if not, leave them alone to keep the blast radius small.
- *Whether the 1.2.x bump forces other `@xterm/*` changes.* Determine after `npm install` in Unit 1 — the xterm add-ons are on their own release train.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
writeToTerminal(id, data)
 ├─ handleAutoNaming(id, data)              // unchanged
 ├─ updateTerminalState(id, 'busy')         // unchanged trigger on \r/\n
 └─ writePtySafe(terminal.pty, data)        // NEW helper
       ├─ if data.length <= CHUNK_THRESHOLD
       │    → pty.write(data)               // fast path, existing behavior
       └─ else
            ├─ segments = splitRespectingBracketedPaste(data, CHUNK_SIZE)
            ├─ for each segment:
            │    ├─ if Windows + inside bracketed-paste block: strip '\r'
            │    ├─ await pty.write(segment)
            │    └─ await new Promise(r => setImmediate(r))
```

Split rule for `splitRespectingBracketedPaste`:

- Prefer boundaries at any byte position.
- Forbidden boundaries: the 6-byte windows starting at `\x1b[200~` and `\x1b[201~`. If a prospective cut lands inside, shift it forward to just after the marker.
- Payloads with no markers are free to cut anywhere.

## Implementation Units

- [x] **Unit 1: Upgrade node-pty to 1.2.x and verify native rebuild**

**Goal:** Get the upstream EAGAIN-drop fix into the app. On macOS this alone should resolve the paste bug; on Windows it removes unrelated 1.1.x bugs and is a prerequisite for Unit 2.

**Requirements:** R1, R2, R5, R6

**Dependencies:** None

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via `npm install`)

**Approach:**
- Bump `"node-pty"` from `^1.1.0` to `^1.2.0-beta.10` (or newer stable 1.2.x at implementation time — check `npm view node-pty versions` first).
- Run `npm install` and `npm run rebuild` to recompile the native module against the current Electron ABI.
- Verify `npm run build` still succeeds on Windows (the primary platform) before touching any other file.
- If Visual Studio Build Tools errors appear, follow the `CLAUDE.md` Windows instructions — this is expected and should not block the upgrade.

**Patterns to follow:**
- Follow the existing release cadence: do not bump other deps in the same commit; keep this a single-purpose dep change.

**Test scenarios:**
- Happy path: `npm test` passes; existing `test/terminalManager.test.ts` suite stays green (the mock replaces node-pty, so tests should be unaffected by the runtime upgrade).
- Happy path: `npm run build` completes on Windows without native-compile errors.
- Happy path: after rebuild, launching the app and opening a Claude terminal still works end-to-end (manual smoke).

**Verification:**
- `node-pty` version in `package-lock.json` resolves to `1.2.x`.
- `npm test` all green.
- App starts, opens a terminal, receives input. No regression on small input.

---

- [x] **Unit 2: Add a defensive chunked PTY write helper**

**Goal:** Protect the interactive write path against ConPTY backpressure on Windows (and against any residual 1.x/1.2.x edge) by chunking payloads >512 B with a single-tick yield between chunks, without splitting bracketed-paste markers.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** Unit 1 (upgrade must land first so we're not stacking fixes on a known-broken base).

**Files:**
- Modify: `electron/main/services/TerminalManager.ts`
- Test: `test/terminalManager.test.ts`

**Approach:**
- Introduce a private async helper `writePtySafe(pty, data)` in `TerminalManager` with two constants near the top of the class: `PTY_CHUNK_THRESHOLD = 512` and `PTY_CHUNK_SIZE = 512`.
- Fast path: `data.length <= PTY_CHUNK_THRESHOLD` → `pty.write(data)` and return. This keeps normal keystrokes on the existing single-call path and preserves existing tests.
- Slow path: walk the payload, slicing at `PTY_CHUNK_SIZE` boundaries. For each candidate boundary, check the surrounding 6-byte window for `\x1b[200~` and `\x1b[201~`; if the cut would split a marker, advance the boundary to just after the marker.
- Between chunks, `await new Promise(r => setImmediate(r))` to let node-pty's internal queue drain. Do not use `setTimeout` unless manual testing (Unit 5) shows setImmediate is insufficient.
- On `process.platform === 'win32'`, inside a bracketed-paste block (between `\x1b[200~` and `\x1b[201~`), strip `\r` bytes from each chunk before writing. Track block state across chunks (a single boolean `insideBracketedPaste`).
- Update `writeToTerminal` (line 220) to `await this.writePtySafe(terminal.pty, data)` and make the outer method `async`. Call sites (`ipcMain.on('terminal:write', …)` at `electron/main/index.ts:506`) currently ignore the return, so this is non-breaking.
- Leave `writeToPty` (line 510-515, non-interactive entry point) on the direct `pty.write` path unless profiling during implementation shows callers sending >512 B payloads. If so, route it through the same helper.

**Execution note:** Test-first. Write the chunking test cases before implementing the helper — the correctness of the marker-safe split is easy to get wrong and hard to debug from the UI.

**Technical design:** *(directional guidance, not implementation specification)*

```
writePtySafe(pty, data):
  if data.length <= PTY_CHUNK_THRESHOLD:
    pty.write(data); return

  segments = []
  i = 0
  insideBP = false
  while i < data.length:
    end = min(i + PTY_CHUNK_SIZE, data.length)
    end = adjustForMarkers(data, i, end)   // shift past \x1b[200~ / \x1b[201~
    chunk = data.slice(i, end)
    if insideBP: update based on chunk contents
    if WIN32 and insideBP: chunk = chunk.replace(/\r/g, '')
    segments.push(chunk)
    // recompute insideBP after chunk
    i = end

  for seg in segments:
    pty.write(seg)
    await setImmediate
```

**Patterns to follow:**
- Private-method style and naming convention from existing `TerminalManager` helpers (`handleAutoNaming`, `extractTaskTitle`).
- Keep the helper synchronous-looking from the caller's perspective (return `Promise<void>`); existing IPC handler is fire-and-forget so no caller needs to change.
- Constants live at the top of the class alongside other private state.

**Test scenarios:**
- Happy path — `writeToTerminal` with 100 B payload calls `pty.write` exactly once with the original string.
- Happy path — `writeToTerminal` with 513 B payload calls `pty.write` twice, and the concatenation of arguments equals the original payload.
- Happy path — `writeToTerminal` with 10 000 B payload calls `pty.write` ~20 times, and the concatenation of arguments equals the original payload byte-for-byte.
- Edge case — payload of exactly 512 B goes through the fast path (single `pty.write`).
- Edge case — payload of 513 B with a `\x1b[200~` marker straddling the 512-byte boundary: no chunk contains a partial marker; the marker appears intact in one of the two chunks.
- Edge case — payload with back-to-back `\x1b[200~…\x1b[201~` blocks longer than `PTY_CHUNK_SIZE`: all marker bytes land intact in their chunk; the full sequence reassembles to the original.
- Edge case — empty string is a no-op (no `pty.write` call).
- Edge case — payload with only `\r\n` line endings and no markers: chunks preserve bytes unchanged on non-Windows.
- Platform branch — on mocked `process.platform === 'win32'` with a payload wrapped in bracketed-paste markers and CRLFs inside, the concatenation of chunks equals the original payload with `\r` bytes removed from within the bracketed block only.
- Platform branch — on mocked non-Windows with the same payload, `\r` bytes are preserved.
- Integration — sending `\n` (Enter) still triggers `updateTerminalState(id, 'busy')` for Claude terminals (existing behavior in `writeToTerminal` must survive the refactor).
- Integration — auto-naming still works for Claude terminals on short pasted prompts (`handleAutoNaming` runs before the chunker).

**Verification:**
- All new chunker tests green.
- Existing `test/terminalManager.test.ts` suite still green.
- A manual 100-line paste into Claude Code on Windows arrives intact (covered in Unit 5).

---

- [x] **Unit 3: Replace silent 1 MB IPC drop with a visible error**

**Goal:** Stop hiding paste failures. When a user pastes more than 1 MB, surface a clear error instead of dropping the payload with no feedback.

**Requirements:** R4

**Dependencies:** None (can land independently of Units 1/2).

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts` (expose a one-shot error event if not already available)
- Modify: `src/hooks/useXtermInstance.ts` or the nearest toast-emitting layer
- Test: `test/ipcValidation.test.ts`

**Approach:**
- In the `terminal:write` IPC handler, replace the silent `return` on `data.length > 1_000_000` with an event back to the renderer (`terminal:error` with `{ id, reason: 'payload-too-large', limit: 1_000_000, actual: data.length }`).
- In the renderer, surface a toast/notification using whatever toast mechanism already exists in the app (find it by searching for existing error UI patterns; do not invent a new one).
- Keep the byte cap at 1 MB for now — raising it invites ConPTY latency regressions and the chunker in Unit 2 makes any reasonable paste work.
- Log the drop in main-process console for diagnostics.

**Patterns to follow:**
- Existing `terminal:*` event naming convention.
- Existing UUID validation style in the same IPC handler.

**Test scenarios:**
- Happy path — 500 KB payload is accepted and forwarded to `TerminalManager.writeToTerminal`.
- Edge case — exactly 1 000 000 characters is still accepted (inclusive boundary stays inclusive or becomes strictly less-than; pick one and assert).
- Error path — 1 000 001-character payload triggers the error event and does not call `writeToTerminal`.
- Error path — invalid UUID still silently drops (preserves existing behavior; different failure mode from payload size).

**Verification:**
- Paste of >1 MB shows a visible error to the user; nothing is silently lost.
- Paste of sane sizes is unaffected.

---

- [x] **Unit 4: Documentation and regression guard**

**Goal:** Make sure the fix doesn't regress and future contributors understand why the chunker exists.

**Requirements:** R1, R5

**Dependencies:** Units 1, 2, 3.

**Files:**
- Modify: `CLAUDE.md` (optional — add a short note to the Terminal Pool / PTY section if one exists, else skip)
- Create: `docs/solutions/integration-issues/node-pty-paste-truncation.md`

**Approach:**
- Write a short `docs/solutions/` entry capturing: symptom (~1 KB paste cut), root cause (EAGAIN drop in `node-pty` 1.1.x `tty.WriteStream` path), fix (upgrade + chunker + CRLF strip on Windows), and the deliberate-non-goals list (xterm unchanged, renderer unchanged, Claude upstream bugs left alone).
- Reference the external issues (PR #831, Cursor forum threads, Claude Code issues) so future debuggers don't redo the research.
- If `CLAUDE.md` has a "Key Patterns" or "PTY" subsection, add a one-liner pointing at the solutions doc — do **not** bloat `CLAUDE.md` with the full narrative.

**Patterns to follow:**
- Existing `docs/solutions/integration-issues/*.md` format (short problem statement, root cause, fix, references).

**Test scenarios:**
- Test expectation: none — documentation-only unit, no behavioral change.

**Verification:**
- The solutions file exists, renders correctly, and links back to this plan and the external references.

---

- [ ] **Unit 5: Manual verification on Windows + macOS**

**Goal:** Prove the fix works in the actual failure environment. Unit tests cover the chunker contract; this unit covers the PTY reality.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** Units 1, 2, 3.

**Files:**
- None (manual verification + add notes to the `docs/solutions/` file if something unexpected shows up).

**Approach:**
- Build the app (`npm run build` or `npm run dev`) on Windows 11 + Git Bash, which is the reported failure environment.
- Run the three canonical paste sizes from the research:
  1. ~2 KB paste (just above the 1018-byte PTY kernel boundary).
  2. ~10 KB paste (ConPTY ring-buffer zone where the Cursor/apiyi reports cluster).
  3. 100-line / ~20 KB code block paste (the original symptom).
- For each, verify:
  - Claude's `[Pasted text #N +X lines]` placeholder shows the full line count.
  - Asking Claude to echo the content back yields the full payload byte-for-byte.
  - No terminal freeze, no mid-word cut.
- Repeat on macOS if available to confirm the Unix path (1.2.x alone should be enough there).
- Sanity: normal typing, small commands, `Ctrl+C`, sidecar shell paste — none should regress.

**Execution note:** This is a UI verification unit. If the dev server cannot reproduce the fix in the browser-embedded xterm, say so explicitly in the PR rather than claiming success from unit tests alone.

**Test scenarios:**
- Test expectation: none — manual verification, covered by unit tests in Unit 2 and documented in Unit 4.

**Verification:**
- 2 KB / 10 KB / 20 KB pastes all arrive intact in a Claude Code session on Windows.
- No freeze, no truncation, no corrupted markers.
- Regular terminal usage unaffected.

## System-Wide Impact

- **Interaction graph:** All interactive terminal input flows through `TerminalManager.writeToTerminal`. Both Claude (`type: 'claude'`) and normal (`type: 'normal'`) terminals share this path. The chunker must preserve existing behavior for both — especially the `'busy'` state transition on Enter (lines 217-219) and the auto-naming hook (line 212).
- **Error propagation:** Today paste errors disappear. Unit 3 introduces a `terminal:error` channel; wire it through the existing toast/notification layer rather than inventing a new one. Document the 1 MB cap so users understand the boundary.
- **State lifecycle risks:** The chunker introduces an `await` in what used to be a synchronous method. If a terminal is closed mid-paste (e.g. user `Ctrl+W`), later `pty.write` calls must no-op. Check `this.terminals.get(terminalId)` before each chunk, or guard the helper by capturing a disposed flag up front.
- **API surface parity:** There is a second PTY entry point (`writeToPty` at line 510) used by ccli/automation. If those callers can emit >512 B in one write (e.g. writing a whole prompt), they deserve the same chunker. Profile during implementation and extend parity if warranted.
- **Integration coverage:** Unit tests mock `pty.write` and can assert *what* was written but not *whether the PTY dropped it*. The EAGAIN drop is a real-OS behavior. Unit 5's manual verification is non-optional for R1 confidence.
- **Unchanged invariants:** xterm.js config, renderer Ctrl+V handling, bracketed-paste wrapping, sidecar terminals, auto-naming logic, terminal pool eviction, and the Claude hook watcher all remain unchanged. The plan deliberately keeps the blast radius at a single helper in `TerminalManager`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `node-pty 1.2.x-beta` is a pre-release and could regress other terminal behavior. | Unit 1 requires `npm run build` + `npm test` green before Unit 2 starts. Unit 5 manual smoke tests non-paste flows. Roll back the version bump alone if a regression appears — the chunker in Unit 2 is upgrade-independent. |
| Windows Visual Studio Build Tools may fail to rebuild the native module. | Follow `CLAUDE.md` Windows rebuild steps. Document any extra setup in the solutions doc. |
| Chunker introduces ordering issues if a second `writeToTerminal` call fires while the first is still chunking. | Serialise per-terminal: either queue pending writes per terminal ID, or accept that interactive typing during a huge paste is not a realistic concurrent scenario. Prefer the simple per-terminal queue if the test in Unit 2 shows interleaving. |
| `setImmediate` yield is not enough on some ConPTY builds. | Unit 5 is the empirical check. If 10 KB still truncates, drop chunk size to 256 B and switch to `setTimeout(r, 4)` as the apiyi write-up suggests. Decision is explicitly deferred to implementation. |
| CRLF stripping inside bracketed paste on Windows corrupts legitimate `\r\n` content. | Only strip inside `\x1b[200~…\x1b[201~`; leave interactive Enter alone. Regression covered by the platform-branch test scenario in Unit 2. |
| The 1 MB error toast fires on legitimate huge pastes that *would* have worked with chunking. | The cap remains at 1 MB; above that we fail loudly on purpose. Users pasting more than 1 MB should use a file, not the clipboard. Documented in Unit 4. |

## Documentation / Operational Notes

- Bump the app version in a release-worthy PR (`npm run release:patch`) after merge — this is a user-visible bug fix.
- Mention the fix in the release notes; reference the upstream `node-pty` bug so users on affected versions understand why the regression existed.
- No feature flag, no migration — the change is a straight-through fix.

## Sources & References

- Related code: `electron/main/services/TerminalManager.ts:207-221`, `electron/main/services/TerminalManager.ts:510-515`, `electron/main/index.ts:506-510`, `electron/preload/index.ts:262-263`, `src/hooks/useXtermInstance.ts:224-248`, `package.json:55`.
- Existing tests to extend: `test/terminalManager.test.ts`, `test/ipcValidation.test.ts`.
- Related repo commits: `038662c` (initial Ctrl+V paste support), `359fea2` (double-paste fix via `preventDefault`), `32cacc6` (mouse-tracking escape stripping — shows the ANSI-handling pattern in this repo).
- Upstream fix: [node-pty PR #831](https://github.com/microsoft/node-pty/pull/831).
- Background: [Cursor forum — 1018-byte truncation](https://forum.cursor.com/t/terminal-paste-truncation-at-1018-bytes-outdated-node-pty-v1-1-vs-v1-2/152576), [Cursor forum — >1 KB freeze](https://forum.cursor.com/t/terminal-freezes-when-pasting-1kb-text-while-claude-code-is-running-pty-layer-issue/154801), [apiyi analysis](https://help.apiyi.com/en/claude-code-paste-freeze-issue-fix-en.html).
- Out-of-scope but relevant: [anthropics/claude-code#5017](https://github.com/anthropics/claude-code/issues/5017), [anthropics/claude-code#13125](https://github.com/anthropics/claude-code/issues/13125), [anthropics/claude-code#24837](https://github.com/anthropics/claude-code/issues/24837).
- Bracketed paste: [xterm.js commit](https://github.com/xtermjs/xterm.js/commit/1dbcf70cee9ae88c69cf9724745cbdb7e5364dcc), [invisible-island spec](https://invisible-island.net/xterm/xterm-paste64.html).
