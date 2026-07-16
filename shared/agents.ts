/**
 * Agent registry — the single per-agent seam Command reads from.
 *
 * This module holds the runtime pieces shared by renderer and main: the agent
 * id list, a type guard, and renderer-facing display metadata (label + badge).
 * The main-only spawn spec (binary, resume args, mode flags, hook capability)
 * lives in electron/main/services/agents.ts.
 *
 * Keep this module free of Node/Electron imports — the renderer imports it too.
 * Adding a new agent = extend AgentType (shared/ipc-types.ts), then add an entry
 * here and in electron/main/services/agents.ts. Both maps are keyed by AgentType,
 * so a missing entry is a compile error.
 *
 * NOTE: not imported by the preload bundle (which stays type-only, see
 * shared/ipc-types.ts). Renderer imports via '@shared/agents'; main via a
 * relative path.
 */
import type { AgentType } from './ipc-types'

/** All agent kinds Command can spawn as chats, for iteration and validation. */
export const AGENT_IDS: readonly AgentType[] = ['claude', 'codex', 'pi']

/** Runtime guard: is `value` a known agent id? */
export function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value)
}

/** Renderer-facing display metadata for an agent. */
export interface AgentDisplay {
  /** Full name shown in menus, settings, and badge tooltips (e.g. "Codex"). */
  label: string
}

/**
 * Display metadata per agent. `Record<AgentType, ...>` forces an entry for every
 * agent — add an agent to AgentType and this stops compiling until filled in.
 * The per-agent brand icon lives in the renderer (src/components/AgentBadge.tsx).
 */
export const AGENT_DISPLAY: Record<AgentType, AgentDisplay> = {
  claude: { label: 'Claude' },
  codex: { label: 'Codex' },
  pi: { label: 'Pi' },
}
