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
  /** Provider-specific permission/mode flags derived from the shared project mode. */
  buildModeArgs(mode?: ClaudeMode): string[]
  /**
   * Args that submit an initial prompt to the interactive chat, given the
   * shell-quoted prompt (see quotePromptForShell — never interpolate raw
   * user text). Empty array = this agent takes the prompt as a positional
   * after the `--` end-of-options separator (claude/codex/pi). opencode's
   * positional is a project PATH, so it needs its `--prompt` flag instead.
   */
  buildPromptArgs(quotedPrompt: string): string[]
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
    buildPromptArgs: () => [],
    hasHook: true,
  },
  codex: {
    // `codex` with no subcommand launches the interactive chat; `codex resume
    // <UUID>` continues a prior session (verified against codex CLI v-current).
    binary: 'codex',
    buildResumeArgs: (sessionId) => [`resume "${sessionId}"`],
    buildModeArgs: (mode) =>
      mode === 'full-auto' ? ['--dangerously-bypass-approvals-and-sandbox'] : [],
    buildPromptArgs: () => [],
    hasHook: true,
  },
  pi: {
    // `pi` launches the interactive chat. `pi --session <id>` resumes a specific
    // session; in practice Command has no hook to capture pi's session id, so pi
    // chats usually start fresh on restart (best-effort — see U6 notes).
    binary: 'pi',
    buildResumeArgs: (sessionId) => [`--session "${sessionId}"`],
    buildModeArgs: () => [],
    buildPromptArgs: () => [],
    hasHook: false,
  },
  opencode: {
    // `opencode` with no flags launches the interactive TUI chat; `--session/-s
    // <id>` resumes a prior session, `--continue/-c` the last one (verified
    // live against opencode 1.18.29, see docs/solutions opencode-spikes).
    // `--auto` approves permissions that are not explicitly denied.
    binary: 'opencode',
    buildResumeArgs: (sessionId) => [`--session "${sessionId}"`],
    buildModeArgs: (mode) => (mode === 'full-auto' ? ['--auto'] : []),
    // TUI positional is a project PATH, so the prompt goes via --prompt.
    buildPromptArgs: (quotedPrompt) => [`--prompt ${quotedPrompt}`],
    // State arrives via the command-center plugin in ~/.config/opencode/plugins
    // (see HookInstaller + electron/main/hooks/opencode-command-center.js).
    hasHook: true,
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

/**
 * Build the shell fragment that submits an initial prompt to an interactive
 * chat (leading space included, '' when no prompt). Agents whose positional
 * takes the prompt (claude/codex/pi) use the `--` end-of-options separator:
 * without it a prompt starting with a dash would parse as a FLAG, bypassing
 * the project's permission mode. Agents with a dedicated prompt flag
 * (opencode `--prompt`) use their spec instead.
 */
export function buildPromptArg(agent: AgentType, quotedPrompt: string): string {
  const flagArgs = AGENT_SPAWN[agent].buildPromptArgs(quotedPrompt)
  if (flagArgs.length > 0) return ' ' + flagArgs.join(' ')
  return ' -- ' + quotedPrompt
}

/**
 * Check `opencode session list --format json` output for a session id.
 * Fail-closed: unparseable output (or a non-array) means "not resumable", so
 * restore starts fresh instead of resuming a stale id. Pure function —
 * exported for unit testing; the exec itself lives in main/index.ts.
 */
export function opencodeSessionListContains(stdout: string, sessionId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return false
    return parsed.some(
      (entry) =>
        typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === sessionId
    )
  } catch {
    return false
  }
}

export interface HeadlessRunResult {
  output: string
  sessionId?: string
}

/**
 * Headless (non-interactive) run spec for automation worktree runs — the
 * scripting counterpart to the interactive TUI/PTY chat above. Only agents
 * with a verified machine-readable mode are listed; anything else falls back
 * to claude (today's behavior — headless always ran claude regardless of the
 * chat agent). argv-style args: the prompt travels as an element, never
 * through a shell, so no quoting is needed.
 */
export interface AgentHeadlessSpec {
  /** CLI binary for the headless run. */
  binary: string
  /** Full argv (prompt included, raw — no shell quoting). */
  buildArgs(prompt: string): string[]
  /** Extract assistant text + session id. Fail-soft: unparseable output
   *  yields the raw stdout so the run record still shows what happened. */
  parseOutput(stdout: string): HeadlessRunResult
}

/** Today's claude headless contract (single JSON envelope), strictly typed. */
function parseClaudeJson(stdout: string): HeadlessRunResult {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { result?: unknown; session_id?: unknown }
      return {
        output: typeof record.result === 'string' ? record.result : stdout,
        sessionId: typeof record.session_id === 'string' ? record.session_id : undefined,
      }
    }
  } catch {
    // Not valid JSON, use raw output below.
  }
  return { output: stdout }
}

/**
 * opencode streams newline-delimited JSON events (`text` parts carry assistant
 * text, `step_finish` ends the turn). Accumulate text; take the session id
 * from any event. Shape verified live (see docs/solutions opencode-spikes).
 */
function parseOpencodeNdjson(stdout: string): HeadlessRunResult {
  const texts: string[] = []
  let sessionId: string | undefined
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event: { type?: unknown; sessionID?: unknown; part?: { type?: unknown; text?: unknown } }
    try {
      event = JSON.parse(trimmed) as {
        type?: unknown
        sessionID?: unknown
        part?: { type?: unknown; text?: unknown }
      }
    } catch {
      continue
    }
    if (sessionId === undefined && typeof event.sessionID === 'string') {
      sessionId = event.sessionID
    }
    if (event.type === 'text' && typeof event.part?.text === 'string') {
      texts.push(event.part.text)
    }
  }
  const output = texts.join('')
  return output ? { output, sessionId } : { output: stdout, sessionId }
}

const CLAUDE_HEADLESS: AgentHeadlessSpec = {
  binary: 'claude',
  buildArgs: (prompt) => ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'],
  parseOutput: parseClaudeJson,
}

export const AGENT_HEADLESS: Partial<Record<AgentType, AgentHeadlessSpec>> = {
  claude: CLAUDE_HEADLESS,
  opencode: {
    // `run` is the non-interactive entrypoint; --auto keeps the run from
    // hanging on approvals (explicit denies still hold).
    binary: 'opencode',
    buildArgs: (prompt) => ['run', '--format', 'json', '--auto', prompt],
    parseOutput: parseOpencodeNdjson,
  },
}

/** Headless spec for an agent, falling back to claude (pre-opencode behavior). */
export function resolveHeadlessSpec(agent: AgentType): AgentHeadlessSpec {
  return AGENT_HEADLESS[agent] ?? CLAUDE_HEADLESS
}

/** Parse headless stdout with the agent's parser (claude fallback). */
export function parseHeadlessOutput(agent: AgentType, stdout: string): HeadlessRunResult {
  return resolveHeadlessSpec(agent).parseOutput(stdout)
}
