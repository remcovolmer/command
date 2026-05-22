---
title: "feat: Plain-click open for Claude OSC 8 .md/.html file links in terminal"
date: 2026-05-22
status: active
type: feat
depth: standard
branch: feat/open-file-md-html
---

# feat: Plain-click open for Claude OSC 8 .md/.html file links in terminal

## Summary

When Claude Code prints a markdown link such as `[readme](README.md)` inside a chat terminal, xterm.js renders it blue/underlined but plain clicks do nothing today — the path opens neither in the editor nor externally. This plan wires xterm.js's `linkHandler` so that OSC 8 hyperlinks emitted by Claude open in the existing center-area editor tab (`store.openEditorTab`) when the target is a `.md`, `.html`, or `.htm` file inside the project/worktree. HTTP(S) OSC 8 links continue to open externally (preserving today's behavior for `https://claude.ai/code/session_…` and any user-emitted URL). All other OSC 8 URIs are no-ops.

---

## Problem Frame

**Origin**: brainstorm dialogue in this session (no `*-requirements.md` written — solo `/ce-plan` invocation with brainstorm context carried in-conversation).

**Today**:
- `src/utils/fileLinkProvider.ts` scans plain-text buffer lines for paths with extensions and opens them via `store.openEditorTab` — this works for paths Claude prints as bare text, but **only via Ctrl+Click** (xterm's default modifier).
- `WebLinksAddon` in `src/hooks/useXtermInstance.ts` (lines 143-145) handles plain-text `https?://…` URLs.
- Neither path handles OSC 8 hyperlink escape sequences (`ESC ] 8 ; <params> ; <URI> ESC \ <text> ESC ] 8 ; ; ESC \`).
- Claude Code wraps every markdown link it emits in OSC 8 (verified empirically — see "Verified Assumptions" below).

**Result**: blue/underlined link text in the terminal that does nothing on click.

**Goal**: plain-click on a Claude-emitted OSC 8 hyperlink whose URI ends in `.md`, `.html`, or `.htm` and resolves inside the project/worktree opens that file as an editor tab. HTTP(S) OSC 8 links keep opening externally. Any other URI is silently ignored (no-op + dev-console warn) — matches today's posture for non-detectable paths.

---

## Verified Assumptions

The brainstorm flagged one load-bearing assumption: *"Claude Code emits OSC 8 with absolute `file://` URIs."* This was **falsified** during planning research. Actual behavior, captured via three `node-pty` probes spawning the real `claude.exe` binary (v2.1.148) with `FORCE_HYPERLINK=1`:

| Claim from brainstorm | Verified behavior |
|---|---|
| URI is `file:///…` absolute path | URI is **bare relative path** (`docs/brainstorms/foo.md`, forward slashes, no `file://`, no URL encoding) |
| Path includes line/col when present | No line/col in URI |
| Only file paths are wrapped | HTTP(S) URLs are also OSC 8-wrapped (e.g., session URL `https://claude.ai/code/session_…`) |
| All file mentions wrapped | Only explicit markdown-link syntax is wrapped; bare prose path mentions are not |

OSC 8 example as emitted by Claude:

```
ESC ] 8 ; id=u-1hmch25%17402236245013402685 ; src/utils/fileLinkProvider.ts ESC \   <displayed text>   ESC ] 8 ; ; ESC \
```

Two consequences for the plan:

1. **URI resolution is relative-to-project-cwd**, not `file://` parsing. Mirror the resolution path that `src/utils/fileLinkProvider.ts` already uses (project root or worktree path as base).
2. **`ILinkHandler.allowNonHttpProtocols` MUST be set to `true`**. From `node_modules/@xterm/xterm/typings/xterm.d.ts` line 1345: by default xterm.js filters out non-HTTP URLs *before* invoking the handler — and Claude's bare relative paths are non-HTTP. Without this flag the handler silently never fires for the very URIs this plan targets. The flag's docstring warns "Enabling this option without proper protection in `activate` function may cause security issues such as XSS" — addressed via `validateFilePathInProject` containment + scheme rejection (see U2).

---

## Scope

### In scope
- New OSC 8 link routing logic registered via xterm.js `linkHandler` option, scoped to chat terminals (where the `FileLinkProvider` is also registered today).
- Routing: HTTP(S) → `api.shell.openExternal`; relative path with `.md/.html/.htm` extension that resolves inside the project/worktree → `store.openEditorTab`; everything else → no-op + `console.warn`.
- Containment check before opening any file (reuse existing `fs:stat` IPC which routes through `validateFilePathInProject`).
- Path-shape security: reject URIs containing `..`, absolute paths (drive letters, leading `/`), URL schemes other than `http(s)`, and overly long strings before any IPC call.

### Out of scope (deferred or non-goals)

#### Deferred to Follow-Up Work
- OSC 8 routing for other extensions (`.ts`, `.json`, `.png`, `.svg`, …). User explicitly chose to scope to `.md/.html/.htm` during brainstorm. The plain-text `FileLinkProvider` continues to handle bare-path mentions of any extension via Ctrl+Click.
- Hover tooltip (`ILinkHandler.hover`) — xterm renders the default underline; no custom tooltip needed for this iteration.
- OSC 8 line/col fragment parsing (e.g. `foo.md:42`) — Claude does not emit these and the editor (Monaco / MarkdownEditor / HtmlEditor) does not currently expose a "jump to line on open" API.

#### Non-goals (outside the feature)
- Changes to `FileLinkProvider`, `WebLinksAddon`, or `openEditorTab`.
- Changes to the HTML/Markdown editor preview defaults shipped in #121.
- Sidecar (normal shell) terminals — only Chat (`type: 'claude'`) terminals get this behavior. The existing `FileLinkProvider` is already registered conditionally on `projectId`; we mirror that condition.

---

## Key Technical Decisions

### KD1. Use xterm.js `linkHandler` option, not a second `ILinkProvider`
`linkHandler` is xterm's native OSC 8 hook. Registering a second `ILinkProvider` (alongside the existing `FileLinkProvider`) would scan buffer text again and re-discover the same paths via regex — pointless duplicate work, and it can't access OSC 8 metadata. `linkHandler` receives the URI directly from xterm's OSC parser. One injection point in `src/hooks/useXtermInstance.ts`.

### KD2. Set `allowNonHttpProtocols: true` and validate aggressively in `activate`
Forced by the verified URI shape (bare relative paths). The risk surface is XSS-via-URI and path traversal. Mitigation: parse-and-classify URI before any IPC call; reject anything that isn't a forward-slash relative path with one of the three target extensions; defer the existence/containment check to `api.fs.stat` (which already runs through `validateFilePathInProject` with the `path.sep` boundary fix from PR #30).

### KD3. Extract routing into a pure utility, not inline in the hook
A pure classifier function (`classifyOsc8Uri(uri, basePath): { kind: 'editor', resolved: string, fileName: string } | { kind: 'external', url: string } | { kind: 'ignore', reason: string }`) is easy to unit-test (no DOM, no IPC) and isolates security-sensitive decisions in one place. The hook just calls it and dispatches. Mirrors the project's existing pattern of separating detection logic (`fileLinkProvider.ts`) from the hook surface.

### KD4. Containment check happens via existing `fs:stat` IPC, not a new handler
`api.fs.stat` already round-trips through `validateFilePathInProject` and returns `{ exists, isFile, resolved }`. Reusing it avoids a second validation surface and keeps security policy in one place. Cost: one IPC per click. Click frequency is low (no hover-fire), so no cache is needed (unlike `FileLinkProvider` which IPCs on hover and was already burned once on this — see `docs/solutions/code-review/terminal-link-feature-review-fixes.md`).

### KD5. HTTP(S) routing in `linkHandler` is mandatory, not optional
Setting `linkHandler` takes precedence over xterm's default OSC 8 handling for *all* schemes. Claude's session-URL OSC 8 links (`https://claude.ai/code/session_…`) currently work via the default — once we install `linkHandler`, we own the http(s) path too. Forward to `api.shell.openExternal` to preserve behavior.

---

## Implementation Units

### U1. Pure OSC 8 URI classifier utility

**Goal**: Side-effect-free function that decides what to do with an OSC 8 URI given a base path. All security-relevant URI parsing lives here.

**Files**:
- Create `src/utils/osc8LinkRouter.ts`
- Create `test/osc8LinkRouter.test.ts`

**Dependencies**: none.

**Approach**:
- Export `classifyOsc8Uri(uri: string, basePath: string): Osc8Decision`.
- `Osc8Decision` is a discriminated union: `{ kind: 'editor', resolved: string, fileName: string } | { kind: 'external', url: string } | { kind: 'ignore', reason: string }`.
- Order of checks (first match wins):
  1. `uri` length bounds (reject > 2000 chars → ignore).
  2. `^https?://` (case-insensitive) → external.
  3. Starts with any other scheme (e.g. `file://`, `javascript:`, `data:`, `vscode:`) → ignore.
  4. Contains `..` segment after normalization (split on `/` or `\`) → ignore.
  5. Absolute path shape — leading `/`, leading `\`, or `^[A-Za-z]:[\\/]` Windows drive → ignore. (We only route relative paths emitted by Claude; absolute paths come from a different source we have not verified.)
  6. Lowercased path doesn't end in `.md`, `.html`, `.htm` → ignore.
  7. Otherwise: `resolved = basePath + '/' + uri` (forward-slash join, no `path.resolve` — we hand the raw resolved string to `fs:stat` which does its own normalize+containment via `validateFilePathInProject`).
- Derive `fileName` as the last `/`-segment of the URI.
- No file-system I/O in this module.

**Patterns to follow**:
- `src/utils/fileLinkProvider.ts` — same "extract → classify → defer existence to IPC" shape.
- The discriminated-union return mirrors the style used in `src/types/index.ts` for similar IPC results.

**Test scenarios** (in `test/osc8LinkRouter.test.ts`):
- *Happy path — editor*: `classifyOsc8Uri('docs/foo.md', '/projects/p')` → `{ kind: 'editor', resolved: '/projects/p/docs/foo.md', fileName: 'foo.md' }`.
- *Happy path — editor html/htm*: same for `index.html` and `index.htm`.
- *Mixed case extension*: `Foo.HTML` → `kind: 'editor'`.
- *External http*: `http://example.com/x` → `{ kind: 'external', url: 'http://example.com/x' }`.
- *External https*: `https://claude.ai/code/session_abc` → `kind: 'external'`.
- *Ignore — wrong extension*: `src/foo.ts` → `{ kind: 'ignore', reason: <non-empty> }`.
- *Ignore — no extension*: `README` → `kind: 'ignore'`.
- *Ignore — other scheme*: `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,<script>`, `vscode://foo` each → `kind: 'ignore'`.
- *Ignore — path traversal*: `../etc/passwd.md`, `docs/../../etc/passwd.md` → `kind: 'ignore'`.
- *Ignore — absolute Unix*: `/etc/foo.md` → `kind: 'ignore'`.
- *Ignore — absolute Windows*: `C:\\Users\\foo.md` and `C:/Users/foo.md` → `kind: 'ignore'`.
- *Ignore — empty URI*: `''` → `kind: 'ignore'`.
- *Ignore — oversized URI*: 2001-char string → `kind: 'ignore'`.
- *Whitespace tolerance*: `  docs/foo.md  ` (leading/trailing whitespace) → trimmed and routed as editor. (Confirms we trim before classifying.)
- *Filename derivation*: `a/b/c/x.md` → `fileName === 'x.md'`.

**Verification**: `npm test -- osc8LinkRouter` passes all scenarios; no test mocks IPC or DOM (pure unit).

---

### U2. Wire `linkHandler` into the chat terminal in `useXtermInstance`

**Goal**: Install the link handler on every chat terminal so plain clicks on OSC 8 hyperlinks route through U1 and dispatch.

**Files**:
- Modify `src/hooks/useXtermInstance.ts`

**Dependencies**: U1.

**Approach**:
- In the `new XTerm({...})` options block (currently lines ~128-139), add a `linkHandler` property.
- The handler shape:
  - `allowNonHttpProtocols: true` — required (see KD2 / Verified Assumptions).
  - `activate(event, text, _range)` — `text` is the URI per xterm typings.
- The activate body (only inside the existing `if (projectId)` block — sidecar/normal terminals get nothing):
  1. Resolve `contextPath` the same way the existing `registerLinkProvider` block does today (lines ~207-218: `worktree?.path || project?.path`).
  2. Call `classifyOsc8Uri(text, contextPath)`.
  3. Switch on `decision.kind`:
     - `'external'` → `api.shell.openExternal(decision.url).catch(console.error)` (mirrors the WebLinksAddon handler at line 144).
     - `'editor'` → `await api.fs.stat(decision.resolved)`; if `exists && isFile`, call `store.openEditorTab(stat.resolved, decision.fileName, projectId)`; otherwise `console.warn('[osc8] file not found or outside project:', decision.resolved)` and no-op.
     - `'ignore'` → `console.warn('[osc8] ignored:', decision.reason, text)` and no-op.
- Hoist the `contextPath` resolution if needed so both `registerLinkProvider` (existing) and `linkHandler` (new) read from the same closure-local value — no duplicate computation.
- Do NOT add a `hover` or `leave` handler. xterm renders the default underline; no extra tooltip needed for this iteration.
- The dependency-array exclusion comment already in place at lines 334-336 still applies; do not add `projectId` or `api` to the array (the effect runs once per terminal, guarded by `hasInitializedRef`).

**Patterns to follow**:
- `src/hooks/useXtermInstance.ts` lines 143-145 — `WebLinksAddon` handler with same shape `(_event, uri) => api.shell.openExternal(uri).catch(console.error)`.
- `src/utils/fileLinkProvider.ts` lines 67-93 — `activate` closure that delegates to a callback after `fs:stat`. Same flow, fewer steps (no per-hover cache needed because clicks are rare).

**Test scenarios**:
- Test expectation: none — this unit is the wiring/integration glue inside an effect that requires a DOM and a live `XTerm` instance. The existing test suite does not unit-test `useXtermInstance` for the same reason. Behavior is verified manually (see Verification) and indirectly through U1's pure-function coverage. Adding a Playwright Electron e2e to drive a real OSC 8 click is deferred — disproportionate carrying cost for one wire-up.

**Verification**:
- Manual: in dev mode (`npm run dev`), open a Chat terminal, ask Claude `"reply with this markdown link: [readme](README.md)"`, wait for the response, then plain-click the rendered blue text. Expect the README to open as a new editor tab in the center area within ~200ms.
- Manual edge cases:
  - Ask Claude to reply with `[ts](src/App.tsx)` — plain click does nothing (no-op + console warn). Ctrl+click still works via the existing `FileLinkProvider`.
  - Ask Claude to reply with `[evil](../../../etc/passwd.md)` — plain click does nothing; `[osc8] ignored:` appears in DevTools console.
  - Plain-click the session URL footer (`https://claude.ai/code/session_…`) — opens in the system browser (unchanged from today).
  - Open the same `.md` link twice — the second click activates the existing editor tab (existing `openEditorTab` dedupe behavior).
  - Open more than `MAX_EDITOR_TABS` (15) of unique md/html files — the new tab simply isn't created (existing limit), no crash.
- Lint and type: `npm run build` produces no new TS or ESLint errors.

---

## System-Wide Impact

| Surface | Impact |
|---|---|
| Sidecar (normal) terminals | None — `linkHandler` is registered inside the same `if (projectId)` block that gates `registerLinkProvider`. Sidecars have no `projectId` in the same sense. |
| Existing `FileLinkProvider` | None — `ILinkProvider` operates on plain buffer text; `ILinkHandler` operates on OSC 8 sequences. They don't overlap. |
| Existing `WebLinksAddon` | None for plain-text URLs (different code path). For OSC 8 https URLs (e.g., the Claude session footer), `linkHandler` now owns the click — behavior preserved via the `'external'` branch in U1. |
| `openEditorTab` / `MAX_EDITOR_TABS` | None — uses the existing entry point exactly as `FileLinkProvider` does today. Same dedupe, same limit, same `EditorContainer` routing into `HtmlEditor` (preview mode default per #121) or `MarkdownEditor` (WYSIWYG default). |
| IPC handlers (`fs:stat`, `shell:open-external`) | None — reused as-is, no new IPC channels. |
| LRU terminal pool / serialization | None — OSC 8 sequences are part of the buffer and serialize normally via `SerializeAddon`. |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Claude changes its OSC 8 URI format (e.g., adds line/col fragment, switches to absolute file://) | Low–Medium | U1 classifier is the single chokepoint. Add a future test case once the new shape is observed; widening the classifier is one PR. |
| Plain click conflicts with text selection in xterm | Low | xterm.js raises `activate` only on a clean click (no drag, no selection). The existing `WebLinksAddon` URL flow already proves this UX is fine in this app. |
| `allowNonHttpProtocols: true` widens the attack surface | Medium | All defenses are in U1's classifier: scheme allowlist (http/https or no-scheme-only-then-relative-path-only), traversal block, absolute-path block, extension allowlist, length cap. `fs:stat` adds containment via existing `validateFilePathInProject` (`path.sep` boundary, see `docs/solutions/code-review/terminal-link-feature-review-fixes.md` §4). |
| OSC 8 URI is URL-encoded by some future Claude version (e.g., spaces as `%20`) | Low | Today's empirical evidence: no encoding. If encoded later, the classifier rejects (`%` is not in our allowed character set indirectly — extension matching would still work but the resolved path would not exist on disk, falling through to the "file not found" warn). Acceptable for first cut; we can `decodeURIComponent` later if needed. |
| Race: terminal is disposed between click and `openEditorTab` resolving | Low | `openEditorTab` mutates Zustand store state — safe regardless of terminal lifecycle. Editor tab opens even if the originating terminal closes. |

---

## Deferred Implementation Notes

- Exact placement of the `linkHandler` property inside the `new XTerm({...})` block — decide at implementation time based on readability.
- Whether to also hoist the existing `contextPath`/`worktree`/`project` lookup currently at lines 207-218 to share with the new handler, or duplicate the lookup. Lean toward hoist for DRY but defer until the diff is in front of us.
- Whether to add a single shared `[osc8]` logger prefix or rely on inline `console.warn` calls — defer to implementation.

---

## References

- Existing code:
  - `src/hooks/useXtermInstance.ts` — xterm initialization, where `WebLinksAddon` (lines 143-145) and `registerLinkProvider` (lines 207-218) live today.
  - `src/utils/fileLinkProvider.ts` — pattern to mirror for security-aware link activation.
  - `src/stores/projectStore.ts` — `openEditorTab` (lines 422-449), `MAX_EDITOR_TABS = 15`.
  - `src/components/Editor/EditorContainer.tsx` — auto-routes `.md` → `MarkdownEditor`, `.html/.htm` → `HtmlEditor` once the tab opens.
  - `electron/main/index.ts` — `validateFilePathInProject` (line 781), `fs:stat` (line 831), `shell:open-external` (line 1360).
- Prior art / institutional learnings:
  - `docs/solutions/code-review/terminal-link-feature-review-fixes.md` — PR #30 review findings, particularly the `path.sep` containment fix and the IPC-flood lesson that informs why we skip a hover handler here.
  - PR #121 (`feat: HTML preview toggle for .html/.htm editor tabs`) — recently merged; this plan piggybacks on that editor routing without changing it.
- External:
  - `node_modules/@xterm/xterm/typings/xterm.d.ts:1311-1346` — `ILinkHandler` interface, in particular `allowNonHttpProtocols`.
  - OSC 8 spec: [Hyperlinks (a.k.a. HTML-like anchors) in terminal emulators](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda).
