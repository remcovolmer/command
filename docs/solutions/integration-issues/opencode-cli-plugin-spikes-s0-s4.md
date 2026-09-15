---
title: "OpenCode spikes S0–S4 (live, v1.18.29): CLI flags, session IDs, plugin events, headless JSON"
date: 2026-09-08
status: resolved
severity: medium
category: integration-issues
platform: windows
module: agents
tags:
  - opencode
  - agent-registry
  - cli-flags
  - plugin-events
  - headless-json
  - session-resume
problem_type: spike
component:
  - electron/main/services/agents.ts
  - electron/main/services/TerminalManager.ts
  - test/agents.test.ts
---

# OpenCode Spikes S0–S4 — Live Findings (v1.18.29, Windows, npm-install)

All five plan spikes answered against the real binary. Method: `opencode --help` /
`opencode run --help`, `opencode session list --format json`, three live
`opencode run` calls (trivial prompts, `--format json`), and a temp-dir probe
plugin (`.opencode/plugins/spike-probe.js`) logging every bus event. Temp
sessions deleted afterwards; no user config touched.

## S1 — Resume / mode / prompt flags: CONFIRMED, with one correction

- TUI: `-s/--session <id>`, `-c/--continue`, `--fork`, `--prompt`, `--model`,
  `--agent`, `--auto` ("auto-approve permissions that are not explicitly
  denied"). Matches `AGENT_SPAWN.opencode` (`--session`, full-auto → `--auto`).
- **Correction:** the TUI positional is `[project]` — a PATH. TerminalManager's
  generic `' -- ' + quotedPrompt` positional would land as a bogus project path
  for opencode. Fix implemented: `AgentSpawnSpec.buildPromptArgs(quotedPrompt)`
  (empty array = legacy `--` positional, used by claude/codex/pi) plus exported
  `buildPromptArg()` helper wired into `TerminalManager.createTerminal`.
  opencode maps to `--prompt <quoted>`. Covered in `test/agents.test.ts`.
- `--prompt` submitting on TUI start is documented ("Prompt to use") but NOT
  verified headlessly (TUI needs a TTY) — verify on first manual opencode chat.

## S2 — Plugin event payload: ANSWERED, no watcher change needed

- Bus event shape: `{id: "evt_…", type, properties}`. Relevant events live:
  - `session.created` / `session.updated`: `properties.sessionID` **and**
    `properties.info.{id,directory,title,…}` — sessionID + cwd both present.
  - `session.status`: `properties.{sessionID, status: {type: "busy"|"idle"}}`.
    `busy` fires at work start; `idle` immediately precedes `session.idle`.
  - `session.idle`: `properties: {sessionID}` — the done signal.
  - `message.part.delta`, `message.updated`, `session.diff`, `plugin.added`,
    `catalog.updated`, `integration.updated`, `reference.updated` also observed.
- `isHookStateData` requires only string `session_id/state/hook_event` +
  numeric `timestamp` — **no format check**, so `ses_…` ids pass unchanged.
- Fase-2 mapping: created/updated + status{busy} → `busy`; `session.idle` /
  status{idle} → `done`. `question` has no observed equivalent (Codex also
  lacks it) — omit until proven.
- `permission.asked` was NOT observed (trivial runs needed no approval) but is
  officially documented; the installed `@opencode-ai/plugin` types also expose
  a `permission.ask` hook whose input (`Permission`) carries
  `sessionID: string` directly. Fase 2 should subscribe to **both** the `event`
  catch-all (`permission.asked` filter) and the `permission.ask` slot —
  version-tolerant across SDK generations (installed SDK types are v2 while the
  binary is 1.18.29; live events are authoritative).
- `tool.execute.before/after` are hook slots (`{tool, sessionID, callID}`),
  not bus events — subscribe directly for per-tool busy writes.
- Plugin mechanics proven: plain `.js` ESM with `node:fs` import works on Bun,
  project dir `.opencode/plugins/` auto-loads, `event` catch-all receives
  everything, silent-fail pattern holds. Running `opencode run` auto-installs
  `@opencode-ai/sdk` + `@opencode-ai/plugin` into `.opencode/node_modules`.

## S3 — Session verification for restore: ANSWERED

- `opencode session list --format json` works, fast, local. Entries:
  `{id, title, updated, created, projectId, directory}`.
- Session IDs: `ses_` + 24 alnum chars (e.g. `ses_f6f9fd360ffeJxc1kb7U5WvI9P`).
  Pass all three gates unchanged: `terminalCreate` handler, `TerminalManager`
  `SESSION_ID_REGEX`, `ProjectPersistence` `SESSION_ID_REGEX`
  (`/^[a-zA-Z0-9_-]+$/`).
- `verifyAgentSessionAsync` opencode branch: shell out to
  `session list --format json`, match id. Entries also carry `directory` for
  cwd cross-checks.

## S4 — Headless contract: ANSWERED at flag + schema level

- `opencode run [message..] --format json --auto --session --model --agent
  --dir --title` all confirmed.
- `--format json` emits newline-delimited events: `step_start`,
  `text` (`part.text` = assistant text), `tool_use` (includes tool result),
  `step_finish` (`reason: "stop"|"tool-calls"`, `tokens`, `cost`).
  **No `{result, session_id}` envelope** — AutomationRunner needs an
  accumulator (concat `text` parts, sessionID from any event) instead of
  Claude's single-JSON parse.

## S5 — Windows path: NO ISSUE

- Binary resolves via npm shim (`…\npm\opencode` + `.cmd`); Git Bash picks up
  the extensionless shim. `OPENCODE_GIT_BASH_PATH` exists as an escape hatch.
  No code change.

## Open items for Fase 2/3

1. Manual: first real opencode chat via Command (spawn, `--session` resume,
   `--prompt` submit, `--auto` in full-auto mode).
2. `permission.asked` payload shape still live-unverified (dual subscription
   covers it; confirm on first real approval).
3. Fase-3 pieces unchanged from plan: `verifyAgentSessionAsync` branch,
   per-agent headless spec + NDJSON accumulator, `agent-done` trigger decision.

## Fase 2 — built 2026-09-11 (plugin + installer + verify, live E2E green)

- Shipped: `electron/main/hooks/opencode-command-center.js` (bus `event`
  catch-all + `tool.execute.before` + `permission.ask` slots → shared state
  file), `HookInstaller.installOpencodePlugin` (file-drop to
  `~/.config/opencode/plugins/command-center.js`, never touches
  `opencode.json`; skips foreign same-name files, uninstall only removes ours),
  `AGENT_SPAWN.opencode.hasHook: true`, `verifyAgentSessionAsync` opencode
  branch (`session list --format json`, fail-closed), builder ships the file
  via `extraResources/hooks`.
- **Gotcha 1 — every plugin export must be a function.** opencode refuses the
  whole file with "Plugin export is not a function" when a non-function
  (e.g. a guard-ms const, or test-only helpers) is module-exported. Pure
  helpers ride on the plugin function as properties instead
  (`CommandCenterState.mapEventToState`, …); unit tests import the function.
- **Gotcha 2 — sync file I/O only.** `opencode run` can exit before pending
  promises flush: the async-`fs.promises` draft wrote NOTHING live, the sync
  (`writeFileSync`/`renameSync`) version works. Documented in the file header
  so nobody "modernizes" it back.
- **E2E proof:** shipped file copied to a temp project, live `opencode run`
  with tool use → state file contained
  `{session_id: ses_…, cwd: <tempdir>, state: done, hook_event: session.idle}`.
  Temp sessions + state entries removed afterwards.
- **Stale global draft (2026-09-11, NOT ours):**
  `~/.config/opencode/plugins/command-center.js` already existed — near-twin
  of this plugin (async draft, same multi-export bug, fails to load) from
  another session ("Opencode toevoegen aan command plan"). Left untouched;
  the installer overwrites it on next Command start (contains our marker).
  Watch for parallel-session divergence on this task.
