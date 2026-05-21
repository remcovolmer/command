---
date: 2026-05-21
topic: html-preview-editor
---

# HTML Preview in the Editor

## Problem Frame

`.html` files currently open in Monaco as raw source — no way to see what they look like rendered without alt-tabbing to a browser. The app already proves the pattern with Markdown: `EditorContainer` (`src/components/Editor/EditorContainer.tsx`) routes `.md` files to a Code/Eye toggle between Monaco (raw) and Milkdown (WYSIWYG). For day-to-day work on prototypes, demo pages, and Claude-generated HTML, the same toggle on `.html`/`.htm` removes a friction point that the rest of the editor experience has already eliminated for Markdown.

---

## Requirements

**Editor routing**
- R1. `EditorContainer` routes `.html` and `.htm` files to a Preview ⇄ Raw toggle, matching the Markdown UI: same Code/Eye buttons, same position, same component shape.
- R2. Files open in Preview mode by default. The Raw view uses Monaco (same code path as today).
- R3. The toggle is per-tab and persists for the lifetime of the tab; reopening the file starts in Preview again.

**Preview fidelity**
- R4. Preview renders in a sandboxed iframe. Inline and external `<script>` execute. CSS, fonts, and images load.
- R5. Relative asset references (`./style.css`, `img/foo.png`, etc.) resolve relative to the file's directory, so a typical static site under the project resolves the same way a browser would when opening the file directly.
- R6. Console output, network errors, and JS exceptions inside the preview do not crash or leak into the host renderer process.

**Update behavior**
- R7. Edits in Raw view propagate to the Preview, debounced ~300ms after the last keystroke.
- R8. Saving the file (Ctrl+S) does not produce an extra re-render beyond what the debounce already triggered.
- R9. Toggling Raw → Preview shows the current buffer (including unsaved edits), not the on-disk version.

---

## Success Criteria

- A user can open `index.html` from the file explorer, see it rendered immediately, switch to Raw, edit a heading, and see the preview update within ~300ms without saving.
- A static site with relative CSS and image references renders the same in the preview as in a real browser opening the file directly.
- The implementation reuses the existing toggle pattern from `EditorContainer` — a planner does not need to invent UI affordances or a new editor abstraction.

---

## Scope Boundaries

- No new "preview" panel architecture — this lives inside the existing editor tab system, same as Markdown.
- No `.svg`, `.xhtml`, or other markup formats — only `.html` and `.htm` in v1.
- No DevTools, no element inspector, no responsive-viewport toggle.
- No live reload of external files referenced by the HTML (changing `style.css` in another tab does not reload the preview automatically).
- No isolation between previews of different files — each tab has its own iframe, no shared cache concerns to manage in v1.
- No script sandboxing beyond what the iframe `sandbox` attribute gives us. The HTML is trusted as "code the user has open in their editor" — same trust level as anything else in the workspace.

---

## Key Decisions

- **Sandboxed iframe with `allow-scripts` + base href**: closest to real browser behavior. Trade-off accepted: previewed HTML executes JS, so genuinely hostile HTML in the workspace could try to phone home — but the user already runs `npm install` and arbitrary terminal commands on this code, so the threat model doesn't change.
- **Live debounced updates (~300ms)**: matches how Markdown's WYSIWYG already feels. Scripts re-run on every preview rebuild — accepted, because R7 is about fast feedback during editing, not preserving in-page JS state.
- **Preview-first default**: consistent with Markdown opening in WYSIWYG. Users who want source-first can flip the toggle once; we don't persist that preference yet.
- **`.html` + `.htm` only**: SVG looks tempting but adds an axis (different content model, different sizing) without obvious payoff. Defer.

---

## Dependencies / Assumptions

- Assumes the iframe `srcdoc` + `<base href="file://…">` approach loads relative assets in Electron's renderer. This is standard but worth a quick smoke test during planning since Electron's webSecurity / fileAccess flags can interact with it.
- Assumes the existing `EditorContainer` toggle pattern generalizes cleanly to a third editor type without refactoring the file-type routing. Planning should verify whether the `isMarkdown` branch should become a `kind: 'monaco' | 'markdown' | 'html'` switch or just a parallel branch.

---

## Next Steps

→ `/ce-plan` for structured implementation planning.
