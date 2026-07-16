/**
 * Agent spawn spec — main-process half of the agent registry.
 *
 * The renderer-facing half (id list, guard, display metadata) is in
 * shared/agents.ts. This module holds what only the main process needs to spawn
 * and resume an agent CLI inside a PTY: the binary, resume args, mode flags, and
 * whether the agent reports state via a hook into the shared state file.
 *
 * `Record<AgentType, AgentSpawnSpec>` forces an entry for every agent — adding
 * an agent to AgentType stops this compiling until it is filled in. This is the
 * one place per-agent spawn behavior lives (no scattered `type === 'claude'`).
 */
import type { AgentType, ClaudeMode, TerminalType } from '../../../src/types'
import { isAgentType } from '../../../shared/agents'

export interface AgentSpawnSpec {
  /** CLI binary run inside the PTY (also the interactive-chat entrypoint). */
  binary: string
  /**
   * Args that resume a prior session by id, appended after the binary.
   * Empty array = this agent has no id-based resume.
   */
  buildResumeArgs(sessionId: string): string[]
  /** Permission/mode flags. Only claude maps ClaudeMode today; others no-op. */
  buildModeArgs(mode?: ClaudeMode): string[]
  /**
   * True when the agent reports lifecycle state via a hook that writes into the
   * shared state file (~/.claude/command-center-state.json). Drives whether a
   * terminal registers with the state watcher (see TerminalManager). Agents
   * without a hook fall back to output-based heuristics (see pi, U5).
   */
  hasHook: boolean
}

export const AGENT_SPAWN: Record<AgentType, AgentSpawnSpec> = {
  claude: {
    binary: 'claude',
    buildResumeArgs: (sessionId) => [`--resume "${sessionId}"`],
    buildModeArgs: (mode) => {
      if (mode === 'auto') return ['--enable-auto-mode']
      if (mode === 'full-auto') return ['--dangerously-skip-permissions']
      return []
    },
    hasHook: true,
  },
  codex: {
    // `codex` with no subcommand launches the interactive chat; `codex resume
    // <UUID>` continues a prior session (verified against codex CLI v-current).
    binary: 'codex',
    buildResumeArgs: (sessionId) => [`resume "${sessionId}"`],
    buildModeArgs: () => [],
    hasHook: true,
  },
  pi: {
    // `pi` launches the interactive chat. `pi --session <id>` resumes a specific
    // session; in practice Command has no hook to capture pi's session id, so pi
    // chats usually start fresh on restart (best-effort — see U6 notes).
    binary: 'pi',
    buildResumeArgs: (sessionId) => [`--session "${sessionId}"`],
    buildModeArgs: () => [],
    hasHook: false,
  },
}

/**
 * True when `type` is an agent whose lifecycle state arrives via a hook writing
 * to the shared state file. Drives watcher registration and hook installation.
 * Returns false for 'normal' shells and for hookless agents (pi).
 */
export function isHookCapableAgent(type: TerminalType): type is AgentType {
  return isAgentType(type) && AGENT_SPAWN[type].hasHook
}

/** Build the full launch command line for an agent chat (binary + resume + mode args). */
export function buildAgentCommand(
  agent: AgentType,
  options: { resumeSessionId?: string; claudeMode?: ClaudeMode }
): string {
  const spec = AGENT_SPAWN[agent]
  const args: string[] = []
  if (options.resumeSessionId) args.push(...spec.buildResumeArgs(options.resumeSessionId))
  args.push(...spec.buildModeArgs(options.claudeMode))
  return [spec.binary, ...args].join(' ')
}
