---
title: 'feat: Add OpenCode as a fourth agent'
date: 2026-09-06
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# feat: Add OpenCode as a fourth agent

## Goal Capsule

- **Objective:** Make OpenCode (`opencode` CLI) a first-class chat agent alongside Claude, Codex and Pi — selectable as default agent, per-chat override, agent switch, worktree chat, with its own badge and state indicator.
- **Why it is cheap:** The agent seam was already generalised for Pi. `AgentType` + two `Record<AgentType, …>` maps make a missing entry a compile error, so the mandatory surface is small and type-driven.
- **Execution profile:** Three units. U1 (registry + badge) delivers a working OpenCode chat. U2 (resume) makes restarts resume instead of starting fresh. U3 (state plugin) is optional and lifts OpenCode from output-heuristic state to real busy/permission/done parity.
- **Stop conditions:** Stop U2 if `opencode` on the target machine has no id-based resume that works for the interactive TUI (see V2) — ship OpenCode as non-resumable rather than passing an unsupported flag. Stop U3 if the plugin API cannot supply the session id that OpenCode itself uses for resume (see V4).
- **Out of scope:** plan-usage monitoring for OpenCode (it is BYO-key/multi-provider, there is no single quota endpoint), Claude-style session summaries via `SessionIndexService`, and any writing into the user's `opencode.json`.

---

## Product Contract

### Summary

A project can be set to OpenCode as its default agent, or a single OpenCode chat can be started next to Claude/Codex/Pi chats. The chat runs the `opencode` CLI inside the existing PTY, shows the OpenCode mark in the sidebar, tab bar, worktree row and notch strip, and tints that mark with the chat's state exactly as the other agents do.

### Problem Frame

Command spawns agent chats through one shared seam (`AGENT_SPAWN` / `buildAgentCommand`) and renders them through one shared display map (`AGENT_DISPLAY` / `AgentBadge`). OpenCode is simply absent from both. Everything that iterates agents — the default-agent dropdown in Settings, the "New … chat" context menu, "Switch to …", the worktree create dialog — is already driven by `AGENT_IDS`, so it picks up a new agent for free once the registry knows about it.

Two things are genuinely new work rather than registry entries:

1. **Transcript verification for resume.** `verifyAgentSessionAsync` (electron/main/index.ts) hardcodes one branch per agent because each CLI stores transcripts differently. OpenCode stores them under its own data dir, not `~/.claude` or `~/.codex`.
2. **State detection.** Claude and Codex both fire process hooks that receive one JSON object on stdin and write into the shared state file `~/.claude/command-center-state.json`, which `ClaudeHookWatcher` polls. OpenCode has no equivalent stdin-JSON hook: its config-level `experimental.hook` covers only `file_edited` and `session_completed`, and its rich lifecycle events (`session.created`, `session.idle`, `permission.asked`, `session.error`) are only reachable from an in-process TypeScript **plugin**. That is a different install shape than `HookInstaller` supports today.

### Requirements

**Agent availability**

- R1. `opencode` is a valid `AgentType` everywhere an agent id is accepted: project `defaultAgent`, `terminal:create`, persisted sessions, agent switch.
- R2. A fresh OpenCode chat launches the bare `opencode` binary in the chat's cwd (project root or worktree), through the same shell/env path as the other agents.
- R3. Every agent-iterating surface offers OpenCode without per-surface code: Settings default-agent dropdown, project context menu, terminal-item "Switch to", worktree item switch, create-worktree dialog.
- R4. `AgentBadge` renders an OpenCode brand mark, monochrome via `currentColor`, inline SVG (no network at runtime), state-tinted like the others.

**Resume**

- R5. On app close, an OpenCode chat's session id is persisted when one is known, and validated by the existing `SESSION_ID_REGEX` (`ses_…` ids pass unchanged — verified against `/^[a-zA-Z0-9_-]+$/`).
- R6. On restore, `verifyAgentSessionAsync` returns true only when an OpenCode transcript for that session id exists on disk; otherwise the chat starts fresh instead of resuming into an error.
- R7. Resume passes the session id through `buildResumeArgs` only in the shape the installed CLI accepts; an unverified shape is not shipped (see V2).

**State**

- R8. Until U3 lands, OpenCode is a hookless agent: `hasHook: false`, so `TerminalManager` drives busy/done from PTY output quiet-time, exactly as Pi does today. No orange permission state.
- R9. With U3, OpenCode reports `busy`, `permission`, `done` and `stopped` into the shared state file keyed by session id, and `ClaudeHookWatcher` maps it to the terminal with no watcher change (the watcher is already agent-agnostic).
- R10. The OpenCode state plugin is installed idempotently, never mutates unrelated keys in the user's OpenCode config, and is removable.

**Agent Mode**

- R11. OpenCode adds no permission or sandbox flags for Chat and Auto.
- R12. Full Auto adds a flag for OpenCode only if the installed CLI actually has an auto-approve flag (see V3). If it does not, OpenCode ignores Agent Mode entirely — Command does not write `permission: {"*": "allow"}` into the user's `opencode.json` to fake it.
- R13. The Settings Agent Mode copy states which agents each mode actually affects, so OpenCode is not silently implied.

### Key Decisions

- **D1 — Ship hookless first.** Pi already proved the hookless path. Registry + badge + resume is a small, reviewable diff that makes OpenCode usable; the plugin is a separate unit that can fail verification without blocking the feature.
- **D2 — Plugin, not `experimental.hook`, for state.** `experimental.hook` only fires on `file_edited` and `session_completed`. That yields `done` at best and no `permission`, i.e. the orange attention dot — the core value of Command — would never light up. The plugin event bus is the only source that carries `permission.asked`.
- **D3 — Never write permissions into the user's `opencode.json`.** OpenCode's permission model is config-driven and user-owned. Command mutating it to emulate Full Auto is invasive and hard to undo; refusing is the honest behavior.
- **D4 — No usage indicator for OpenCode.** `UsageProvider` stays `'claude' | 'codex'`. OpenCode runs against user-chosen providers; there is no single plan-quota source to poll.

---

## Verification Gates (do these first, on a machine with `opencode` installed)

These four facts decide the shape of U1–U3. Web sources disagree on all four, so they are verified locally, not assumed.

- **V1 — Binary and TUI start.** `opencode --version`, then `opencode` in a project dir. Confirms the interactive entrypoint takes no subcommand (like `codex`).
- **V2 — Resume shape.** `opencode --help`. Confirm whether `-s, --session <id>` and `-c, --continue` apply to the interactive TUI or only to `opencode run`. Record the exact accepted form. If only `run` accepts it, U2 ships as `buildResumeArgs: () => []` (non-resumable, like Pi) and R6/R7 are satisfied by starting fresh.
- **V3 — Auto-approve flag.** Same `--help`: is there an `--auto` (or equivalent) that auto-approves permission requests? If yes, `full-auto` maps to it. If no, `buildModeArgs: () => []`.
- **V4 — Session storage and plugin dir.** Locate the session transcript for a live session (`~/.local/share/opencode/storage/session/<projectHash>/<sessionID>.json` is the documented layout; `OPENCODE_DATA_DIR` overrides it) and confirm the plugin auto-load directory name (`plugin/` vs `plugins/` under `~/.config/opencode/`, plus the Windows equivalent of both paths). Confirm a `session.idle` event payload carries the same session id that appears in the storage filename.

Windows note: the whole app is developed on Windows and all file operations use absolute paths. Both OpenCode paths must be resolved for Windows before U2/U3 are written — do not port the POSIX defaults blind.

---

## Implementation Units

### U1 — Registry, spawn spec and badge

Files:

- `shared/ipc-types.ts` — `AgentType = 'claude' | 'codex' | 'pi' | 'opencode'`; update the two explanatory comments that spell out the union (lines ~74, ~87).
- `shared/agents.ts` — add `'opencode'` to `AGENT_IDS`; add `opencode: { label: 'OpenCode' }` to `AGENT_DISPLAY`.
- `electron/main/services/agents.ts` — add the `opencode` entry to `AGENT_SPAWN`: `binary: 'opencode'`, `buildResumeArgs` per V2, `buildModeArgs` per V3, `hasHook: false` (D1).
- `src/components/AgentBadge.tsx` — add `opencode` to `AGENT_ICONS`.

Badge asset is the one external dependency: take the OpenCode mark from the installed package's own assets or its favicon, reduce to path data on a `0 0 24 24` viewBox, drop any background tile so it reads in dark mode (same treatment the Pi mark already got). If no usable mark is available, draw a neutral terminal-glyph mark rather than shipping a blank badge.

Tests to extend (each already enumerates the agents, so they fail loudly until updated — that is the intended tripwire):

- `test/agents.test.ts` — key-parity assertion covers the new id automatically; add explicit `buildAgentCommand('opencode', …)` cases for fresh / resume / each mode, and `AGENT_SPAWN.opencode.hasHook === false`.
- `test/agentBadge.test.tsx`, `test/ipcValidation.test.ts`, `test/terminalCreateHandler.test.ts`, `test/generalSection.test.tsx`, `test/terminalListItem.test.tsx` — widen the hardcoded `'claude' | 'codex' | 'pi'` unions and `test.each` lists.

Done when: a project set to OpenCode opens a working `opencode` chat, the badge appears in sidebar/tab bar/worktree/notch, and "Switch to OpenCode" works on an existing chat.

### U2 — Resume and transcript verification

Files:

- `electron/main/index.ts` — add an `opencode` branch to `verifyAgentSessionAsync` and update its doc comment. Resolve the data dir as `OPENCODE_DATA_DIR` when set, else the V4-confirmed default, then look for `storage/session/**/<sessionId>.json` (recursive `readdir`, same tactic as the codex branch).
- `test/restoreSessions.test.ts` — a case where the OpenCode transcript exists (resumes) and one where it does not (starts fresh).

If V2 says the TUI has no id-based resume: keep `buildResumeArgs: () => []`, make `verifyAgentSessionAsync` return `false` for `opencode`, and document it in the same comment block that already documents Pi. That is a deliberate, stated limitation, not a gap.

Done when: closing Command with an active OpenCode chat and reopening either resumes that session or starts a clean one — never launches a command that the CLI rejects.

### U3 — Optional: real state detection via an OpenCode plugin

Only after V4 confirms the plugin dir and the session id in the event payload.

New pieces:

- `electron/main/plugins/opencode-state-plugin.js` (new dir next to `electron/main/hooks/`) — an OpenCode plugin module exporting an async factory that receives `{ directory, worktree, … }` and returns an `event` handler. Mapping: `session.created` / `message.updated` / `tool.execute.before` → `busy`; `permission.asked` → `permission`; `session.idle` → `done`; `session.error` → `stopped`. It writes `{ session_id, state, cwd, timestamp }` into `~/.claude/command-center-state.json` atomically, reusing the exact schema `ClaudeHookWatcher` validates, and carries over the two guards the codex hook needed: skip redundant `busy`, and protect a fresh `permission` from a racing `busy` for ~2.5s. Self-contained, no cross-require of the `.cjs` hooks.
- `electron/main/services/HookInstaller.ts` — a second install shape alongside `AgentHookTarget`: copy-the-plugin-file (plus, if auto-load by directory turns out not to work, register its path in the `plugin` array of `~/.config/opencode/opencode.json`, preserving all other keys). Idempotent install/uninstall with a match token, mirroring `installTarget`.
- `electron-builder.json` — ship `electron/main/plugins/*` as extra resources, the way `hooks/*.cjs` already are, and mirror the dev/prod path split of `getHookScriptPath`.
- `electron/main/services/agents.ts` — flip `opencode` to `hasHook: true`; `TerminalManager` then registers it with the watcher and stops applying the output heuristic, with no change in either file.
- Tests: a `test/opencodeStatePlugin.test.ts` mirroring `test/codexStateHook.test.ts` (pure `mapEventToState` / `shouldSkipWrite` exports), and a `HookInstaller` case for the new shape.

Done when: an OpenCode chat shows gray while working, orange on an approval prompt, green when idle, red on exit — verified by eye against a Claude chat side by side.

### U4 — Copy and docs

- `src/components/Settings/GeneralSection.tsx` — extend the three Agent Mode description strings so they name the agents each mode actually changes (currently Claude/Codex only), covering OpenCode per R11–R13.
- `CLAUDE.md` — the Terminology table's "Chat" row and the hook-system section mention the agent set; add OpenCode and, if U3 lands, its plugin path. Leave `AGENTS.md` alone (it is a mechanically substituted copy).
- No new hotkey: OpenCode is a value inside existing surfaces, not a new feature with its own primary workflow (Agent Mode cycling and chat creation already have bindings).

---

## Verification

Automated: `npm run typecheck`, `npm run lint`, `npm run test`. The `Record<AgentType, …>` maps plus the key-parity test in `test/agents.test.ts` mean an incomplete registry cannot compile or pass.

Manual, on Windows with `opencode` on PATH:

1. Settings → Default Agent → OpenCode; new chat launches OpenCode.
2. Project context menu → "New OpenCode chat" while default is Claude.
3. Terminal item → "Switch to OpenCode" on a running chat.
4. Create worktree with agent OpenCode; badge shows on the worktree row and in the notch strip.
5. Close and reopen Command with a live OpenCode chat → resumes, or starts fresh (per V2), never errors.
6. Agent Mode Chat / Auto / Full Auto → the launch command matches R11–R12.
7. With U3: gray / orange / green / red transitions match a Claude chat's behavior.
8. `opencode` not on PATH → the chat shows the shell's "command not found" and stays a live terminal (same as Pi today; no crash, no spawn-failed toast).

---

## Risks and Open Questions

| # | Item | Confidence | Handling |
|---|------|-----------|----------|
| 1 | Interactive TUI accepts an id-based resume flag | guessing — sources describe `-s/--session` mainly for `opencode run`, and there is an open upstream issue about `--continue`/`--session` syntax | V2 decides; fallback is non-resumable (R7) |
| 2 | OpenCode has an auto-approve CLI flag | guessing — one source claims `--auto`, another states there is no bypass flag and permissions are config-only | V3 decides; fallback is "Agent Mode does not apply to OpenCode" (R12, D3) |
| 3 | Session storage layout `storage/session/<projectHash>/<sessionID>.json` | likely — consistently reported, and `OPENCODE_DATA_DIR` overrides it | V4 confirms on Windows before U2 is written |
| 4 | Plugin auto-load directory (`plugin/` vs `plugins/`) | guessing — sources disagree | V4 confirms; config-array registration is the fallback |
| 5 | `session.idle` payload carries the resume-usable session id | likely | V4 confirms; without it U3 cannot map state to a terminal and is dropped |
| 6 | Session ids (`ses_…`) survive validation | certain — `SESSION_ID_REGEX` is `/^[a-zA-Z0-9_-]+$/`, and `ClaudeHookWatcher` does no id-format check | no work |
| 7 | Adding an agent needs no changes to watcher, pool, notch, rollup or persistence | certain — all of these go through `isAgentType` / `AGENT_IDS`, verified by grep across `src`, `electron`, `shared` | no work |
| 8 | OpenCode brand mark availability | likely | U1 falls back to a neutral terminal glyph |
