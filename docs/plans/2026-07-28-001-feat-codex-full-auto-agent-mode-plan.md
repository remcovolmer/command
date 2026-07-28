---
title: "feat: Apply Agent Mode Full Auto to Codex"
date: 2026-07-28
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Apply Agent Mode Full Auto to Codex

## Goal Capsule

- **Objective:** Make the existing per-project mode control apply accurately to Claude and Codex, with Codex entering YOLO mode only when the project is set to Full Auto.
- **Product authority:** The session-settled decisions in the Product Contract govern provider behavior, naming, and shortcut confirmation scope.
- **Execution profile:** Standard security-sensitive change with two implementation units; keep the diff limited to agent command construction, presentation, compatibility hydration, tests, and shortcut documentation.
- **Stop conditions:** Stop if the supported Codex CLI no longer accepts `--dangerously-bypass-approvals-and-sandbox` for both fresh interactive sessions and `codex resume`; do not substitute a weaker permission combination.
- **Tail ownership:** The implementing workflow owns focused verification, the full repository quality gates, review fixes, and delivery.

---

## Product Contract

### Summary

The per-project permission control becomes Agent Mode.
Claude retains its existing behavior, while Codex receives its dangerous approvals-and-sandbox bypass only in Full Auto for both fresh and resumed chats.

### Problem Frame

Command already forwards the stored project mode into its shared agent launch path, but the Codex spawn specification ignores it.
As a result, a project configured for Full Auto starts Claude without permission prompts while Codex still starts with its default restrictions.
The Settings and hotkey copy also describes the control as Claude-only even though it will govern two agents.

### Requirements

**Agent startup**

- R1. Every fresh or restored agent chat continues to receive the parent project's stored mode through the existing launch path.
- R2. Claude command construction remains unchanged for Chat, Auto, Full Auto, and resumed sessions.
- R3. Codex Chat and Auto add no permission or sandbox flags, while Codex Full Auto adds exactly `--dangerously-bypass-approvals-and-sandbox`.
- R4. The Codex Full Auto mapping applies to both a fresh interactive command and the existing `codex resume "<session-id>"` command shape.
- R5. Pi chats and normal shell terminals remain unaffected by Agent Mode.

**Presentation and compatibility**

- R6. Settings presents the control as Agent Mode and explains the provider-specific semantics: Auto changes Claude only, while Full Auto changes both Claude and Codex.
- R7. The Full Auto warning names both provider-specific flags, states that Codex runs without approvals or its internal sandbox, and recommends only an externally sandboxed environment.
- R8. The shortcut description and shortcut documentation use “Agent mode”, including for users with an already-persisted hotkey configuration.
- R9. Existing customized hotkey keys, modifiers, enabled states, stored project modes, and internal action identifiers remain intact.
- R10. Changing Agent Mode affects newly started and restored chats; already-running chats are not restarted or mutated.

**Transition policy**

- R11. `Ctrl+Shift+M` retains its existing direct-cycle behavior and does not gain a confirmation step in this change.
- R12. Existing Full Auto projects and previously persisted confirmation acknowledgements remain valid after the upgrade.

### Key Decisions

- KD1. **Map only Codex Full Auto.** (session-settled: user-directed — chosen over semantically mapping all three modes: Codex has no exact Claude Auto equivalent and only Full Auto should change Codex.) Governs R1-R5.
- KD2. **Rename the shared control to Agent Mode.** (session-settled: user-directed — chosen over retaining Claude-only labels: the control now affects both Claude and Codex.) Governs R6-R10.
- KD3. **Preserve direct shortcut cycling.** (session-settled: user-directed — chosen over adding confirmation to the shortcut: this change should retain the existing transition behavior.) Governs R11-R12.

### Acceptance Examples

- AE1. **Covers R3-R4.** Given a Full Auto project, creating a Codex chat writes a command containing exactly one Codex bypass flag.
- AE2. **Covers R1 and R3-R4.** Given a persisted Codex session in a Full Auto project, restoring it produces `codex resume "<session-id>" --dangerously-bypass-approvals-and-sandbox`.
- AE3. **Covers R2-R5.** Given Chat or Auto, Codex receives no new flags; the existing Claude mappings and Pi commands remain unchanged.
- AE4. **Covers R6-R8.** Given Settings is opened, the control and shortcut surfaces say Agent Mode and the Full Auto dialog explains both Claude and Codex behavior.
- AE5. **Covers R8-R9.** Given a persisted custom `Ctrl+Alt+M` binding with the old “Cycle Claude mode” description, hydration preserves the custom binding and updates only its static description to “Cycle Agent mode”.
- AE6. **Covers R11-R12.** Given an existing Full Auto project or a user cycling modes with `Ctrl+Shift+M`, the current direct transition remains available without a new acknowledgement flow.

### Scope Boundaries

#### In Scope

- Provider-specific mode arguments in the existing agent spawn registry.
- Accurate Settings, warning, shortcut, and repository shortcut-table copy.
- Compatibility normalization for the persisted shortcut description.
- Focused unit and integration coverage for fresh and restored command construction.

#### Deferred to Follow-Up Work

- Renaming the persisted `claudeMode` field, `ClaudeMode` type, or `ui.cycleClaudeMode` action identifier; these compatibility names have no user-visible impact and would require migration work.
- Codex CLI version detection or fallback behavior for installations that predate the dangerous bypass flag.
- A shared confirmation flow for Settings and keyboard mode changes.

#### Outside This Change

- A Codex equivalent for Claude Auto mode.
- Agent Mode behavior for Pi or normal terminals.
- Restarting or reconfiguring chats that are already running.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extend the agent registry, not the handlers.** Add the Codex Full Auto mapping to `electron/main/services/agents.ts`; `buildAgentCommand` already combines resume arguments with provider mode arguments, and both creation handlers already forward the project mode.
- KTD2. **Keep persisted identifiers stable.** Preserve `claudeMode`, `ClaudeMode`, and `ui.cycleClaudeMode`; only their user-visible labels become provider-neutral.
- KTD3. **Refresh static hotkey metadata during hydration.** Extend the existing hotkey reconciliation so a known action adopts the current default description while retaining its persisted key, modifiers, enabled state, and action identifier.
- KTD4. **Treat dangerous flags as fixed provider metadata.** The Codex bypass flag is a literal registry value, never derived from user input or interpolated from persisted configuration.
- KTD5. **Verify the complete route without duplicating launch logic.** Registry tests own the mode matrix, while TerminalManager and handler tests prove the fixed command reaches fresh and restored PTY paths.

### Sequencing

1. Implement and prove the Codex registry mapping before changing UI language.
2. Update Agent Mode copy and compatibility hydration against the proven provider matrix.
3. Run focused tests, then the full repository quality gates.

### Risks and Dependencies

- **Dangerous execution:** Codex Full Auto removes both approvals and sandboxing. Exact gating to `full-auto` and provider-accurate warning copy are release requirements.
- **Persisted hotkey drift:** Updating only `DEFAULT_HOTKEY_CONFIG` would leave existing users on the old description because the complete binding is persisted. Hydration must refresh the static description without overwriting user customization.
- **External CLI contract:** The local planning baseline is `codex-cli 0.144.6`, whose help exposes the bypass flag for both interactive start and `resume`. Older installations are outside this change and may reject the flag.
- **Existing acknowledgements:** Full Auto expands from Claude-only behavior to Claude plus Codex. The user explicitly chose to preserve existing project modes, acknowledgements, and direct shortcut cycling.

### Research Anchors

- `electron/main/services/agents.ts` is the centralized per-agent binary, resume, mode-argument, and hook registry.
- `electron/main/handlers/terminalCreate.ts` and `electron/main/handlers/restoreSessions.ts` already pass the stored project mode into `TerminalManager`.
- `docs/solutions/runtime-errors/settings-white-screen-stale-hotkey-action.md` requires persisted hotkey identifiers to be reconciled rather than renamed blindly.
- `docs/solutions/logic-errors/hotkey-handler-missing-auto-switch-behavior.md` reinforces keeping UI and shortcut paths on one stored mode source of truth.
- `docs/plans/2026-02-06-feat-per-project-skip-permissions-setting-plan.md` documents the original new/resumed/worktree inheritance behavior for per-project Full Auto.

---

## Implementation Units

### U1. Apply Codex Full Auto at launch

- **Goal:** Add the settled Codex Full Auto mapping at the existing per-agent command boundary and prove it reaches fresh and restored sessions.
- **Requirements:** R1-R5; AE1-AE3.
- **Dependencies:** None.
- **Files:**
  - `electron/main/services/agents.ts`
  - `test/agents.test.ts`
  - `test/terminalManager.test.ts`
  - `test/terminalCreateHandler.test.ts`
  - `test/restoreSessions.test.ts`
- **Approach:**
  1. Change only the Codex spawn specification so `buildModeArgs` returns the fixed bypass flag for `full-auto` and an empty list for every other mode.
  2. Keep resume arguments before mode arguments so fresh and resumed commands retain their established shapes.
  3. Strengthen handler tests around the existing project-mode forwarding rather than adding provider checks to the handlers.
- **Execution note:** Start by changing the currently contrary assertions in `test/agents.test.ts`, then add route-level coverage before changing the registry.
- **Patterns to follow:** Claude's `buildModeArgs` mapping in `electron/main/services/agents.ts`; existing command-write tests in `test/terminalManager.test.ts`; agent restore coverage in `test/restoreSessions.test.ts`.
- **Test scenarios:**
  - Codex with no mode or Chat produces `codex`.
  - Codex Auto produces `codex` with no approval or sandbox override.
  - Codex Full Auto produces `codex --dangerously-bypass-approvals-and-sandbox`.
  - Codex Full Auto with a valid session ID produces `codex resume "<session-id>" --dangerously-bypass-approvals-and-sandbox`.
  - TerminalManager writes the exact fresh and resumed Full Auto commands, including the trailing carriage return and exactly one bypass flag.
  - A fresh Codex terminal receives the parent project's `full-auto` value through `terminal:create`.
  - A restored Codex session receives the parent project's `full-auto` value through `restoreSessions`.
  - Existing Claude Chat, Auto, Full Auto, and resume assertions stay green.
  - Pi ignores every mode value and retains its existing fresh and resume commands.
- **Verification:** The registry matrix and both PTY entry routes produce the expected exact commands with no handler-specific mode logic added.

### U2. Present and persist Agent Mode accurately

- **Goal:** Make every user-visible mode label provider-neutral while preserving stored configuration and provider-specific safety meaning.
- **Requirements:** R6-R12; AE4-AE6.
- **Dependencies:** U1.
- **Files:**
  - `src/components/Settings/GeneralSection.tsx`
  - `src/utils/hotkeys.ts`
  - `test/generalSection.test.tsx`
  - `test/hotkeys.test.ts`
  - `AGENTS.md`
- **Approach:**
  1. Rename the Settings heading and explanatory copy to Agent Mode without renaming the persisted field or TypeScript type.
  2. Keep Auto explicitly Claude-only and make Full Auto list the Claude and Codex flags plus their different risk semantics, including the need for external sandboxing.
  3. Change the default shortcut description to “Cycle Agent mode” while retaining the internal action identifier.
  4. Extend hotkey reconciliation to refresh outdated static descriptions for known actions while preserving user-editable binding fields.
  5. Correct the `Ctrl+Shift+M` row in `AGENTS.md`; do not change the shortcut or its direct-cycle handler.
- **Patterns to follow:** Existing confirmation-dialog structure in `src/components/Settings/GeneralSection.tsx`; two-way hotkey reconciliation and compatibility tests in `src/utils/hotkeys.ts` and `test/hotkeys.test.ts`; jsdom component-test setup used by existing `test/*.test.tsx` files.
- **Test scenarios:**
  - Settings renders “Agent Mode” and no longer presents the selector as Claude-only.
  - Auto copy states that Claude changes while Codex keeps its default behavior.
  - Opening the Full Auto confirmation displays both fixed provider flags, states that Codex loses approvals and its internal sandbox, and recommends external sandboxing.
  - The default `ui.cycleClaudeMode` binding keeps `Ctrl+Shift+M` but reports “Cycle Agent mode”.
  - Hydrating a binding with the old description updates the description and preserves custom key, modifiers, enabled state, and action ID.
  - An already-current hotkey configuration returns unchanged when no reconciliation is needed.
  - Clicking Settings mode buttons retains the existing confirmation behavior, while the keyboard handler remains unchanged by this unit.
- **Verification:** Fresh and persisted configurations show accurate Agent Mode language, customized bindings survive, and no persistence or action-ID migration is introduced.

---

## Verification Contract

| Gate | Command or action | Done signal |
|---|---|---|
| Focused behavior | `npm run test -- test/agents.test.ts test/terminalManager.test.ts test/terminalCreateHandler.test.ts test/restoreSessions.test.ts test/hotkeys.test.ts test/generalSection.test.tsx` | All provider-mode, fresh/resume, hydration, and UI-copy scenarios pass. |
| Full test suite | `npm test` | Vitest completes with zero failures after its automatic pretest build. |
| Lint | `npm run lint` | ESLint reports no errors and no unused code. |
| Type safety | `npm run typecheck` | Strict TypeScript passes with no `any` introduced. |
| Production build | `npm run build` | TypeScript, Vite, and Electron packaging complete successfully. |
| CLI compatibility | Inspect `codex --help` and `codex resume --help` on the implementation machine. | Both commands expose `--dangerously-bypass-approvals-and-sandbox`; otherwise stop rather than changing the settled mapping. |
| UI smoke | Open Project Settings and the shortcuts overlay for a project with each mode. | Agent Mode labels are accurate, the Full Auto warning names both providers, and `Ctrl+Shift+M` remains documented correctly. |

---

## Definition of Done

- R1-R12 and AE1-AE6 are satisfied.
- Codex Full Auto uses the exact dangerous bypass flag for fresh and resumed chats; Codex Chat and Auto remain unchanged.
- Claude and Pi command matrices have explicit regression coverage.
- Existing persisted mode and hotkey identifiers remain compatible, and customized hotkeys retain their binding fields.
- Settings, warning, shortcut overlay, and `AGENTS.md` use accurate Agent Mode language.
- Focused tests, `npm test`, lint, typecheck, and production build all pass.
- No dead code, forgotten TODOs, unused imports, `any` types, or abandoned implementation attempts remain.
