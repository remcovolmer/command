import { useEffect, useMemo, useRef, useState } from 'react'
import { getElectronAPI } from '../../utils/electron'
import { STATE_TEXT_COLORS } from '../../utils/terminalState'
import { AgentBadge } from '../AgentBadge'
import type { NotchSession, TerminalState } from '../../types'

const STATE_LABEL: Record<TerminalState, string> = {
  busy: 'bezig',
  done: 'klaar',
  permission: 'goedkeuring nodig',
  question: 'vraag',
  stopped: 'gestopt',
}

interface ProjectGroup {
  projectId: string
  projectName: string
  sessions: NotchSession[]
}

// Group by projectId (stable identity) so two projects/worktrees sharing a
// display name don't merge into one group.
function groupByProject(sessions: NotchSession[]): ProjectGroup[] {
  const order: string[] = []
  const byId = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const existing = byId.get(s.projectId)
    if (existing) {
      existing.sessions.push(s)
    } else {
      byId.set(s.projectId, { projectId: s.projectId, projectName: s.projectName, sessions: [s] })
      order.push(s.projectId)
    }
  }
  return order.map((id) => byId.get(id)).filter((g): g is ProjectGroup => g !== undefined)
}

/**
 * The notch strip renderer view, mounted in the dedicated strip window
 * (see src/main.tsx `#strip` branch). Collapsed it shows surfaced state dots
 * plus a summary; on hover it expands to the session list grouped by project.
 * Clicking a row returns to that session (U6); the hide button turns the notch
 * off (U8). Window visibility itself is driven by the main process, and the
 * window is sized to this component's reported content.
 */
export function NotchStrip() {
  const api = useMemo(() => getElectronAPI(), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const [sessions, setSessions] = useState<NotchSession[]>([])
  const [surfacedIds, setSurfacedIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    return api.notch.onState((payload) => {
      setSessions(payload.sessions)
      setSurfacedIds(payload.surfacedIds ?? [])
    })
  }, [api])

  // Report the rendered content size so the main process fits the window to it.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = () => api.notch.resize(el.offsetWidth, el.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [api])

  const surfaced = useMemo(() => new Set(surfacedIds), [surfacedIds])
  const groups = useMemo(() => groupByProject(sessions), [sessions])
  const surfacedSessions = sessions.filter((s) => surfaced.has(s.id))
  const isAttention = (state: TerminalState) =>
    state === 'permission' || state === 'question' || state === 'stopped'
  const attentionCount = surfacedSessions.filter((s) => isAttention(s.state)).length
  const doneCount = surfacedSessions.filter((s) => s.state === 'done').length
  const busyCount = surfacedSessions.filter((s) => s.state === 'busy').length

  const summary =
    attentionCount > 0
      ? `${attentionCount} ${attentionCount === 1 ? 'vraagt' : 'vragen'} om je aandacht`
      : doneCount > 0
        ? `${doneCount} klaar`
        : busyCount > 0
          ? `${busyCount} bezig`
          : `${sessions.length} ${sessions.length === 1 ? 'sessie' : 'sessies'}`

  return (
    <div
      ref={rootRef}
      data-testid="notch-strip"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className="notch-strip w-full overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-lg"
    >
      {expanded ? (
        <div className="max-h-[420px] overflow-y-auto p-2 text-xs">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="cursor-move select-none text-[10px] uppercase tracking-wide text-muted-foreground [-webkit-app-region:drag]">
              ⋮⋮ Notch
            </span>
            <button
              type="button"
              aria-label="Verberg notch"
              onClick={() => api.notch.setEnabled(false)}
              className="rounded px-1 leading-none text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
            >
              ✕
            </button>
          </div>
          {groups.map((group) => (
            <div key={group.projectId} className="mb-1.5">
              <div className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {group.projectName}
              </div>
              {group.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => api.notch.focusSession(s.id)}
                  data-surfaced={surfaced.has(s.id) ? 'true' : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent [-webkit-app-region:no-drag]"
                >
                  <AgentBadge type={s.agentType} state={s.state} />
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className={`shrink-0 text-[10px] ${STATE_TEXT_COLORS[s.state]}`}>
                    {STATE_LABEL[s.state]}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span
            aria-hidden="true"
            className="cursor-move select-none text-muted-foreground [-webkit-app-region:drag]"
          >
            ⋮⋮
          </span>
          <div className="flex items-center gap-1.5">
            {surfacedSessions.slice(0, 6).map((s) => (
              <AgentBadge key={s.id} type={s.agentType} state={s.state} />
            ))}
          </div>
          <span data-testid="notch-count" className="flex-1 text-muted-foreground">
            {summary}
          </span>
          <button
            type="button"
            aria-label="Verberg notch"
            onClick={() => api.notch.setEnabled(false)}
            className="rounded px-1 leading-none text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
