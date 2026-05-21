---
title: HTML Preview in the Editor
type: feat
status: active
date: 2026-05-21
origin: docs/brainstorms/2026-05-21-html-preview-editor-requirements.md
---

# HTML Preview in the Editor

## Overview

Add a Preview ⇄ Raw toggle for `.html` and `.htm` files in the existing editor tab area, mirroring the Markdown WYSIWYG flow. Preview renders the buffer in a sandboxed iframe with `allow-scripts` and an injected `<base href>` so relative assets resolve against the file's directory. Updates from Raw → Preview are debounced ~300ms. No new panel architecture, no DevTools, no SVG.

---

## Problem Frame

`.html` files open in Monaco as raw source today — to see the rendered output a user has to alt-tab to a browser. The Markdown branch in `src/components/Editor/EditorContainer.tsx` already proves the pattern: a Code/Eye toggle swaps Monaco for a richer view. We extend the same toggle to HTML.

(See origin: `docs/brainstorms/2026-05-21-html-preview-editor-requirements.md`)

---

## Requirements Trace

- R1. `EditorContainer` routes `.html` and `.htm` to a Preview ⇄ Raw toggle matching the Markdown UI.
- R2. Files open in Preview by default; Raw uses Monaco via the existing code path.
- R3. Toggle state is per-tab, not persisted across reopen.
- R4. Preview renders in a sandboxed iframe with scripts enabled; CSS, fonts, images load.
- R5. Relative asset paths resolve relative to the file's directory.
- R6. Console/network errors and JS exceptions inside the preview stay inside the iframe — no host renderer crash or leak.
- R7. Raw → Preview updates debounced ~300ms after last keystroke.
- R8. Ctrl+S save does not trigger an extra re-render beyond debounce.
- R9. Toggling Raw → Preview shows the live buffer including unsaved edits, not the on-disk version.

---

## Scope Boundaries

- No new preview panel — lives inside the existing editor tab system.
- No `.svg`, `.xhtml`, or other markup formats in v1.
- No DevTools, element inspector, or responsive-viewport toggle.
- No live reload when external resources (e.g., a separate `style.css`) change in another tab.
- No script sandboxing beyond what the iframe `sandbox` attribute provides.
- No persistence of the user's last-used mode across reopen.

---

## Context & Research

### Relevant Code and Patterns

- `src/components/Editor/EditorContainer.tsx` — file-type router; the new `.html`/`.htm` branch hooks in here next to `isMarkdown`.
- `src/components/Editor/MarkdownEditor.tsx` — closest pattern for state ownership + file watcher + dirty tracking + Ctrl+S handler. The `EditorControls` sub-component shape is reusable.
- `src/components/Editor/CodeEditor.tsx` — the Monaco wrapper. Used as-is for the Raw mode if it can be embedded inside `HtmlEditor`, or pattern-copied if controlled mode is needed.
- `src/utils/editorLanguages.ts` — `EXT_TO_LANGUAGE` table that gates which files are editable. `.html` is registered, `.htm` is not.
- `src/utils/fileWatcherEvents.ts` — chokidar-backed subscription used by both existing editors; same subscription model applies.
- `electron/main/index.ts:321` — `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }`. `webSecurity` is not set, so defaults to `true`. This is the constraint that may affect file:// asset loading from the iframe — see Deferred questions.

### Institutional Learnings

- No `docs/solutions/` entries cover iframe rendering, sandboxing, or live HTML preview. This is greenfield for the codebase.

### External References

- Iframe `sandbox="allow-scripts"` keeps scripts enabled while preventing top-level navigation and form submission. Omitting `allow-same-origin` puts the iframe in a null origin — relative URLs resolve through `<base href>` but cross-origin restrictions still apply to fetch/XHR.
- Electron renderer defaults to `webSecurity: true`. `file://` resources are loadable by the iframe when the parent app loads via `file://` (production) but may behave differently under the Vite dev server (`http://localhost:...`). This is the primary risk to validate during implementation.

---

## Key Technical Decisions

- **One new component (`HtmlEditor`) owns content state, not a refactor of `CodeEditor`.** Rationale: keeps the existing CodeEditor untouched (already used by many other file types), and matches the pattern set by `MarkdownEditor` which also owns its own load/watch/dirty/save. Cost is a small amount of duplicated lifecycle code; benefit is zero blast radius on other extensions.
- **Iframe via `srcdoc` + injected `<base href>`, not `iframe src="file://…"`.** Rationale: srcdoc lets us render the live buffer (R9), which `src=` cannot. Base href injection preserves relative asset resolution (R5). Risk: Electron security flags may block file:// asset loads from a null-origin srcdoc — see Deferred questions.
- **Sandbox attribute: `allow-scripts` only.** Rationale: minimum needed to execute inline/external scripts (R4). `allow-same-origin` is intentionally omitted — without it the iframe gets a null origin, which still permits asset loads via base href but blocks the iframe from reading the host's cookies/storage. `allow-top-navigation` omitted — prevents the preview from yanking the user away from the editor.
- **Debounce in `HtmlEditor`, not in a shared util.** Rationale: 300ms timer driven by Monaco's `onChange` is small enough to inline. No reuse across the codebase justifies a shared hook.
- **Preview-first default, not user-persisted.** Rationale: matches Markdown opening in WYSIWYG. Persisting the last-used mode is a follow-up if users ask for it.
- **`.htm` joins `.html` via `EXT_TO_LANGUAGE`.** Rationale: both are real-world HTML, single-table change, no risk.

---

## Open Questions

### Resolved During Planning

- **Should Markdown's `EditorContainer` switch become a `kind: 'monaco' | 'markdown' | 'html'` enum?** No — keep the parallel-branch pattern. The component is small (~95 lines) and adding a third branch costs ~15 lines. A switch refactor adds churn without simplifying.
- **Should `CodeEditor` be made controllable to share its instance with the preview?** No — `HtmlEditor` embeds its own Monaco directly via `@monaco-editor/react`, the same way `CodeEditor` does. The duplication is contained and predictable.

### Deferred to Implementation

- **Does `<iframe srcdoc>` + `<base href="file:///abs/path/">` actually load relative assets under Electron's default `webSecurity: true`?** Will be discovered during U2 wire-up. If file:// assets are blocked, fallback options in order: (a) prepend an Electron protocol handler that serves the file directory, or (b) inline-resolve and embed assets as data URLs at debounce time. Both are heavier — only invoke them if the simple approach fails.
- **Does dev-mode (Vite at `http://localhost`) behave differently from production (`file://`)?** Validate both during U2; if dev mode breaks but production works, document the dev-mode limitation rather than building extra infrastructure for it.
- **Should the iframe receive a `key={debouncedContent}` to force remount, or update `srcdoc` in place?** Try `srcdoc` mutation first; if scripts misbehave on update, switch to remount. Either way it's a one-line change.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
EditorContainer (file router)
   │
   ├─ .md  ──► MarkdownEditor (existing, unchanged)
   ├─ .html|.htm ──► HtmlEditor (NEW)
   │                    │
   │                    ├─ owns content (string)
   │                    ├─ Raw  ──► Monaco (mounted always; hidden when not in Raw)
   │                    └─ Preview ──► HtmlPreview component (NEW)
   │                                       │
   │                                       └─ <iframe sandbox="allow-scripts"
   │                                                  srcdoc={withBaseHref(content, fileDir)} />
   │
   └─ *   ──► CodeEditor (existing, unchanged)

   Monaco.onChange ──► setContent ──► debounce(300ms) ──► debouncedContent ──► iframe.srcdoc
```

---

## Implementation Units

- [ ] U1. **Register `.htm` as an editable file type**

**Goal:** Extend the editable-file table so `.htm` files open in the editor at all. Without this, the EditorContainer routing in U4 only catches `.html`.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/utils/editorLanguages.ts`
- Test: `test/editorLanguages.test.ts` *(create if no existing test for this module)*

**Approach:**
- Add `htm: 'html'` to `EXT_TO_LANGUAGE`.

**Patterns to follow:**
- Existing entries in the same table; no other site touches editability.

**Test scenarios:**
- Happy path: `isEditableFile('index.htm', 'htm')` returns `true`.
- Happy path: `getMonacoLanguage('foo/bar.htm')` returns `'html'`.

**Verification:**
- Opening a `.htm` file from the file explorer opens an editor tab (instead of being treated as a binary/unknown file).

---

- [ ] U2. **`HtmlPreview` component (sandboxed iframe wrapper)**

**Goal:** A pure presentational component that takes HTML content + a base directory and renders it in a sandboxed iframe with relative-asset resolution. No file IO, no debounce — those live in the parent.

**Requirements:** R4, R5, R6

**Dependencies:** None

**Files:**
- Create: `src/components/Editor/HtmlPreview.tsx`
- Test: `test/HtmlPreview.test.tsx`

**Approach:**
- Props: `{ content: string; fileDir: string }`.
- Inject `<base href="file:///{fileDir}/">` near the start of `<head>` (or prepend if no `<head>` present).
- Render `<iframe sandbox="allow-scripts" srcdoc={injectedContent} style="border:0; width:100%; height:100%">`.
- During implementation, smoke-test that `<img src="./foo.png">` and `<link rel="stylesheet" href="./style.css">` actually resolve. If they don't, see fallback options in Deferred questions before expanding scope.

**Patterns to follow:**
- Pure functional component shape; no Zustand, no IPC. Sibling components in `src/components/Editor/` for styling/structure conventions.

**Test scenarios:**
- Happy path: rendering content with `<h1>Hello</h1>` mounts an iframe whose `srcdoc` contains `<h1>Hello</h1>` (assert on the prop, not on the rendered DOM — iframe contents are not reachable from the test).
- Edge case: empty `content` renders an iframe with empty srcdoc, no crash.
- Edge case: content without `<head>` still gets a `<base href>` injected (prepended).
- Edge case: content with an existing `<base>` tag — the injection respects (does not duplicate) it. *Decision: prepend ours; the document's own `<base>` will win because of declaration order. Document this in a code comment.*
- Error path: invalid HTML (unterminated tags) is passed through; the iframe renders what it can, no host-side throw.

**Verification:**
- Component renders an iframe with the documented sandbox and srcdoc attributes.
- Mounting in isolation (e.g., a Storybook-style harness or ad-hoc test page) confirms relative assets resolve when `fileDir` points to a real directory.

---

- [ ] U3. **`HtmlEditor` component (state owner, Raw + Preview)**

**Goal:** Owns the content buffer for an HTML tab. Loads the file, subscribes to the file watcher, tracks dirty state, handles Ctrl+S, debounces Raw → Preview updates, and renders both panes (Raw via Monaco, Preview via U2).

**Requirements:** R2, R3, R6, R7, R8, R9

**Dependencies:** U2

**Files:**
- Create: `src/components/Editor/HtmlEditor.tsx`
- Test: `test/HtmlEditor.test.tsx`

**Approach:**
- Pattern-mirror `MarkdownEditor.tsx`: load file via `api.fs.readFile`, subscribe via `fileWatcherEvents`, track `savedContentRef`/`currentContentRef`, expose Ctrl+S + `editor-save-request` listener, set dirty flag in projectStore.
- Internal state: `mode: 'preview' | 'raw'` (default `'preview'`), `content: string` (current buffer), `debouncedContent: string` (300ms behind).
- Mount Monaco directly (via `@monaco-editor/react`) — do not embed `CodeEditor.tsx`. Monaco's `onChange` writes to `content`; a `setTimeout` debounce updates `debouncedContent`.
- Pass `debouncedContent` + `fileDir` to `<HtmlPreview>`. Compute `fileDir` from `filePath` (strip filename).
- Both Raw and Preview mount once and use CSS `display` to hide the inactive one (matches existing `isActive` pattern in `CodeEditor`/`MarkdownEditor`). Monaco staying mounted preserves undo history when toggling.
- Save (Ctrl+S) writes `content` (the live buffer) to disk via `api.fs.writeFile`. The debounce timer is unaffected — R8 holds because save does not trigger a Preview update; the most recent debounce already covered it.
- File watcher: when the file changes on disk (e.g., Claude edits it), refresh `content` + `debouncedContent` together, mirroring `MarkdownEditor`'s reload behavior.

**Execution note:** Implement Raw + load/save/watch first, then layer in the debounce and Preview wiring once Monaco's `onChange` is verified to fire correctly inside this component.

**Patterns to follow:**
- `MarkdownEditor.tsx` for lifecycle and dirty tracking.
- `CodeEditor.tsx` for Monaco mount options (`automaticLayout`, `minimap.enabled: false`, `wordWrap: 'on'`).

**Test scenarios:**
- Happy path: typing in Raw updates `debouncedContent` after 300ms, not before.
- Happy path: switching from Raw to Preview shows the current buffer including unsaved edits (covers R9).
- Edge case: Ctrl+S saves the live buffer to disk; preview content is unchanged (does not re-render beyond the existing debounce — covers R8). Test by asserting the preview `srcdoc` does not change between the last debounce flush and the save event.
- Edge case: file changed externally (file watcher event) updates both `content` and `debouncedContent` simultaneously, with `dirty=false`.
- Edge case: very rapid typing (e.g., 20 keystrokes in 200ms) only triggers one debounced preview update.
- Error path: file read fails → component shows the same error UI shape as `MarkdownEditor` / `CodeEditor`.
- Integration: dirty flag in `projectStore` flips to `true` on first keystroke and back to `false` after save (mirrors existing editor behavior).

**Verification:**
- A `.html` file opens, shows the rendered preview, switches to Raw, edits propagate to the preview ~300ms later, Ctrl+S writes to disk, dirty indicator clears.

---

- [ ] U4. **`EditorContainer` routing for `.html`/`.htm`**

**Goal:** Add the third branch to `EditorContainer.tsx` that renders the Code/Eye toggle bar + `HtmlEditor` for HTML files.

**Requirements:** R1, R2, R3

**Dependencies:** U3

**Files:**
- Modify: `src/components/Editor/EditorContainer.tsx`
- Test: `test/EditorContainer.test.tsx` *(create if missing)*

**Approach:**
- Add `const isHtml = filePath.toLowerCase().endsWith('.html') || filePath.toLowerCase().endsWith('.htm')` next to `isMarkdown`.
- Branch before the existing `isMarkdown` branch — order doesn't matter because the predicates are disjoint, but keep markdown as the first specialized branch since it's older.
- Copy the toggle-bar JSX from the Markdown branch, change `useWysiwyg` to `usePreview`, swap the lazy import to `HtmlEditor`. `HtmlEditor` does NOT need to be lazy-loaded in the same way Milkdown is — Milkdown is heavy; Monaco + an iframe is not. But matching the lazy import keeps the bundle-split shape consistent.
- Default state: `usePreview = true`.

**Patterns to follow:**
- The existing Markdown branch in `EditorContainer.tsx` — same toggle position, same `bg-muted`/`shadow-sm` button styling, same Code/Eye icons from `lucide-react`.

**Test scenarios:**
- Happy path: rendering `EditorContainer` with `filePath="index.html"` renders the toggle bar + `HtmlEditor` in Preview mode.
- Happy path: same for `index.htm`.
- Happy path: clicking the Code button switches to Raw; clicking Eye switches back.
- Edge case: `filePath="index.HTML"` (uppercase) also routes to the HTML branch (toLowerCase already covers this; assert it).
- Edge case: `filePath="readme.md"` continues to route to MarkdownEditor (no regression).
- Edge case: `filePath="config.json"` continues to route to CodeEditor (no regression).

**Verification:**
- Opening an `.html` file shows the toggle bar with Preview active by default; opening a `.md` and a `.json` file still works exactly as before.

---

## System-Wide Impact

- **Interaction graph:** New iframe in the renderer. No new IPC channels; reuses `fs:readFile` / `fs:writeFile`. No change to the hook watcher, terminal pool, or session index.
- **Error propagation:** JS exceptions inside the iframe stay there by design (sandbox isolation). Host-side errors (file read failure, render failure) follow the same shape as the existing editors.
- **State lifecycle risks:** Monaco staying mounted while in Preview mode keeps undo history but also keeps memory in use. Acceptable: a single HTML tab's Monaco footprint is small compared to the terminal pool. The toggle is per-tab so closing the tab releases it.
- **API surface parity:** `EXT_TO_LANGUAGE` (`src/utils/editorLanguages.ts`) is consumed by the file explorer to decide editability — adding `.htm` flows through automatically.
- **Integration coverage:** `HtmlEditor` ↔ `fileWatcherEvents` ↔ projectStore dirty tracking — covered in U3 integration scenarios.
- **Unchanged invariants:** `CodeEditor.tsx` and `MarkdownEditor.tsx` are not modified. The non-HTML/non-Markdown file path through `EditorContainer` is byte-identical.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `<iframe srcdoc>` + `<base href="file://…">` blocked by Electron `webSecurity` default | U2 wire-up tests this first; fallback options (Electron protocol handler, data-URL inlining) documented in Deferred questions. Do not invest in fallbacks until the simple approach is confirmed broken. |
| Vite dev server behaves differently from production `file://` | Test both environments during U2/U3; document the dev-mode behavior rather than building dev-only infrastructure. |
| Hostile HTML in workspace runs JS in the preview | Accepted. Same threat model as `npm install` and terminal commands the app already runs against workspace files. No mitigation in v1. |
| Heavy/looping JS inside a previewed file freezes the preview iframe | Iframe stays responsive (renderer process is not the iframe process), and the toggle to Raw still works. No timeout-kill in v1. |
| Bundle size grows from a new editor module | Negligible — `HtmlEditor` reuses already-loaded Monaco + React; only the new component code is additive (~200 lines). |

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-21-html-preview-editor-requirements.md`
- Related code: `src/components/Editor/EditorContainer.tsx`, `src/components/Editor/MarkdownEditor.tsx`, `src/components/Editor/CodeEditor.tsx`, `src/utils/editorLanguages.ts`, `electron/main/index.ts`
- External docs: MDN `<iframe sandbox>` and `<base>` element references; Electron `webPreferences` documentation.
