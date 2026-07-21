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

// Distinct from terminalState.isAttentionState (permission|question): the notch
// deliberately treats a stopped/crashed agent as needing attention too.
const needsAttention = (state: TerminalState): boolean =>
  state === 'permission' || state === 'question' || state === 'stopped'

// Delay before collapsing on mouse-leave. Gives hover hysteresis so the strip
// doesn't flicker when the pointer skims the drag handle or the window resizes.
const COLLAPSE_DELAY_MS = 220

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
 * (see src/main.tsx `#strip` branch). An always-visible header (drag handle,
 * surfaced state, dismiss) sits above a session list that expands on hover.
 * Clicking a row returns to that session; the ✕ turns the notch off. Window
 * visibility and size are driven by the main process.
 */
export function NotchStrip() {
  const api = useMemo(() => getElectronAPI(), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSize = useRef({ w: 0, h: 0 })
  const [sessions, setSessions] = useState<NotchSession[]>([])
  const [surfacedIds, setSurfacedIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    return api.notch.onState((payload) => {
      setSessions(payload.sessions)
      setSurfacedIds(payload.surfacedIds ?? [])
    })
  }, [api])

  // Report the rendered content size so the main process fits the window to it
  // (and follows the expand/collapse animation).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === lastSize.current.w && h === lastSize.current.h) return // skip redundant IPC/resize
      lastSize.current = { w, h }
      api.notch.resize(w, h)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [api])

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    },
    [],
  )

  const surfaced = useMemo(() => new Set(surfacedIds), [surfacedIds])
  const surfacedSessions = useMemo(
    () => sessions.filter((s) => surfaced.has(s.id)),
    [sessions, surfaced],
  )
  const groups = useMemo(() => groupByProject(surfacedSessions), [surfacedSessions])
  const attentionCount = surfacedSessions.filter((s) => needsAttention(s.state)).length
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

  const openNow = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    setExpanded(true)
  }
  const closeSoon = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      setExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }

  return (
    <div
      ref={rootRef}
      data-testid="notch-strip"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={closeSoon}
      className="notch-strip w-full overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-lg"
    >
      {/* Header — always visible, stable hover target. */}
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
          {surfacedSessions.length > 6 && (
            <span className="text-[10px] text-muted-foreground">
              +{surfacedSessions.length - 6}
            </span>
          )}
        </div>
        <span data-testid="notch-count" className="flex-1 truncate text-muted-foreground">
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

      {/* Session list — animates open/closed via grid-template-rows. Hidden from
          the a11y tree and tab order when collapsed (rows below are tabIndex -1). */}
      <div
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto px-2 pb-2 text-xs">
            {groups.map((group) => (
              <div key={group.projectId} className="mb-1.5">
                <div className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {group.projectName}
                </div>
                {group.sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    tabIndex={expanded ? 0 : -1}
                    onClick={() => api.notch.focusSession(s.id)}
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
        </div>
      </div>
    </div>
  )
}
