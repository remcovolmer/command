import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import {
  Plus,
  Play,
  Square,
  Zap,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Pencil,
  ExternalLink,
  MessageSquare,
  GitBranch,
} from 'lucide-react'
import type { Automation, AutomationRun } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'
import { useLaunchAutomation } from '../../hooks/useLaunchAutomation'
import { AutomationCreateDialog } from '../FileExplorer/AutomationCreateDialog'
import clsx from 'clsx'
import {
  btnPrimary,
  btnIcon,
  segmentGroup,
  segment,
  segmentActive,
  segmentInactive,
} from '../ui/controls'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return `${Math.round(diff / 86400000)}d ago`
}

function triggerLabel(trigger: Automation['trigger']): string {
  switch (trigger.type) {
    case 'schedule':
      return `Cron: ${trigger.cron}`
    case 'agent-done':
      return 'On agent done'
    case 'git-event':
      return `Git: ${trigger.event}`
    case 'file-change':
      return `Files: ${trigger.patterns.join(', ')}`
  }
}

/** Render inline markdown: **bold**, `code`, and URLs */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(https?:\/\/[^\s)]+)|(\*\*(.+?)\*\*)|(`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1]) {
      parts.push(
        <button
          key={match.index}
          onClick={(e) => {
            e.stopPropagation()
            window.electronAPI.shell.openExternal(match![1])
          }}
          className="text-primary hover:underline break-all"
        >
          {match[1]}
        </button>
      )
    } else if (match[2]) {
      parts.push(
        <strong key={match.index} className="text-fg font-semibold">
          {match[3]}
        </strong>
      )
    } else if (match[4]) {
      parts.push(
        <code
          key={match.index}
          className="bg-raised px-1 py-0.5 rounded text-[10px] font-mono text-fg"
        >
          {match[5]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function RunResultContent({ text }: { text: string }) {
  const trimmed = text.substring(0, 2000)
  const lines = trimmed.split('\n')
  const elements: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const stripped = line.trim()
    if (stripped.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      elements.push(
        <pre
          key={`code-${i}`}
          className="bg-raised rounded px-2 py-1.5 overflow-x-auto font-mono text-[10px] text-fg whitespace-pre"
        >
          {codeLines.join('\n')}
        </pre>
      )
      continue
    }
    if (!stripped) {
      i++
      continue
    }
    if (/^[-•]\s/.test(stripped)) {
      elements.push(
        <div key={i} className="flex gap-1.5 pl-1">
          <span className="text-fg-faint shrink-0">{'•'}</span>
          <span>{renderInline(stripped.replace(/^[-•]\s+/, ''))}</span>
        </div>
      )
      i++
      continue
    }
    elements.push(<div key={i}>{renderInline(stripped)}</div>)
    i++
  }
  return (
    <div className="text-xs text-fg-muted space-y-1">
      {elements}
      {text.length > 2000 && <div className="text-fg-faint">...truncated</div>}
    </div>
  )
}

function statusIcon(status: AutomationRun['status']) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-info animate-spin" />
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-success" />
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-danger" />
    case 'timeout':
      return <AlertTriangle className="w-3.5 h-3.5 text-warning" />
    case 'cancelled':
      return <Square className="w-3.5 h-3.5 text-fg-muted" />
  }
}

type Tab = 'automations' | 'runs'

export function AutomationsOverview() {
  const api = useMemo(() => getElectronAPI(), [])
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const setActiveTerminal = useProjectStore((s) => s.setActiveTerminal)
  const { launch } = useLaunchAutomation()

  const [automations, setAutomations] = useState<Automation[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('automations')
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [launchMenuId, setLaunchMenuId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editAutomation, setEditAutomation] = useState<Automation | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [automationsList, runsList] = await Promise.all([
        api.automation.list(),
        api.automation.listRuns(undefined, 100),
      ])
      setAutomations(automationsList as Automation[])
      setRuns(runsList as AutomationRun[])
    } catch (error) {
      console.error('Failed to load automations:', error)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const upsert = (run: AutomationRun) =>
      setRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id)
        if (idx === -1) return [run, ...prev]
        const next = [...prev]
        next[idx] = run
        return next
      })
    const unsubStarted = api.automation.onRunStarted((r) => upsert(r as AutomationRun))
    const unsubCompleted = api.automation.onRunCompleted((r) => upsert(r as AutomationRun))
    const unsubFailed = api.automation.onRunFailed((r) => upsert(r as AutomationRun))
    return () => {
      unsubStarted()
      unsubCompleted()
      unsubFailed()
    }
  }, [api])

  const projectName = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.name ?? 'Unknown project'
  const automationName = (automationId: string) =>
    automations.find((a) => a.id === automationId)?.name ?? 'Unknown'

  const handleToggle = async (id: string) => {
    const result = (await api.automation.toggle(id)) as Automation | null
    if (result) setAutomations((prev) => prev.map((a) => (a.id === id ? result : a)))
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this automation and its run history?')) return
    await api.automation.delete(id)
    setAutomations((prev) => prev.filter((a) => a.id !== id))
    setRuns((prev) => prev.filter((r) => r.automationId !== id))
  }

  const handleLaunch = async (automation: Automation, target?: Automation['defaultTarget']) => {
    setLaunchMenuId(null)
    await launch(automation, target)
    // Newly created run arrives via onRunStarted; nothing else to do here.
  }

  const handleHeadless = async (id: string) => {
    try {
      await api.automation.trigger(id)
    } catch (err) {
      // e.g. the automation's project was deleted (trigger throws "project not found")
      api.notification.show(
        'Automation',
        err instanceof Error ? err.message : 'Failed to run automation'
      )
    }
  }

  const handleToggleRun = (run: AutomationRun) => {
    setExpandedRunId((cur) => (cur === run.id ? null : run.id))
    // Clear the unread flag on expand so the sidebar badge can drain
    // (headless runs are created unread and nothing else flips it).
    if (!run.read && run.status !== 'running') {
      api.automation.markRead(run.id).catch(() => {})
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, read: true } : r)))
    }
  }

  const openChat = (run: AutomationRun) => {
    if (run.terminalId && terminals[run.terminalId]) setActiveTerminal(run.terminalId)
  }

  const openCreate = () => {
    setEditAutomation(null)
    setDialogOpen(true)
  }
  const openEdit = (automation: Automation) => {
    setEditAutomation(automation)
    setDialogOpen(true)
  }
  const closeDialog = () => {
    setDialogOpen(false)
    setEditAutomation(null)
    loadData()
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-screen text-fg-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-screen text-[13px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 h-12 px-5 border-b border-border bg-canvas shrink-0">
        <Zap className="w-4 h-4 text-primary" strokeWidth={1.5} />
        <h1 className="text-[15px] font-semibold text-fg-strong">Automations</h1>
        <span className="font-mono text-[11.5px] text-fg-muted tnum">
          {automations.length} template{automations.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className={segmentGroup} role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'automations'}
              onClick={() => setTab('automations')}
              className={clsx(segment, tab === 'automations' ? segmentActive : segmentInactive)}
            >
              Templates
            </button>
            <button
              role="tab"
              aria-selected={tab === 'runs'}
              onClick={() => setTab('runs')}
              className={clsx(segment, tab === 'runs' ? segmentActive : segmentInactive)}
            >
              Run history
            </button>
          </div>
          <button onClick={openCreate} className={`${btnPrimary} h-7 px-2.5 text-[12.5px]`}>
            <Plus className="w-3.5 h-3.5" strokeWidth={1.5} /> New
          </button>
        </div>
      </div>

      {tab === 'automations' ? (
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {automations.length === 0 ? (
            <div className="text-center py-16 text-fg-muted">
              <Zap className="w-8 h-8 mx-auto mb-3 text-fg-faint" strokeWidth={1.5} />
              <p className="mb-2">No automations yet.</p>
              <button onClick={openCreate} className="text-primary hover:underline">
                Create your first automation
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="eyebrow text-left px-2 py-2 w-10"></th>
                  <th className="eyebrow text-left px-2 py-2">Name</th>
                  <th className="eyebrow text-left px-2 py-2">Project</th>
                  <th className="eyebrow text-left px-2 py-2">Trigger</th>
                  <th className="eyebrow text-left px-2 py-2">Target</th>
                  <th className="eyebrow text-left px-2 py-2">Last run</th>
                  <th className="eyebrow text-right px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => {
                  const lastRun = runs.find((r) => r.automationId === a.id)
                  return (
                    <tr key={a.id} className="border-t border-border hover:bg-raised/60 group">
                      <td className="px-2 py-2">
                        <button
                          onClick={() => handleToggle(a.id)}
                          title={a.enabled ? 'Enabled' : 'Disabled'}
                          className={`w-8 h-[18px] rounded-full relative transition-colors ${a.enabled ? 'bg-primary' : 'bg-border-strong'}`}
                        >
                          <span
                            className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-all ${a.enabled ? 'right-[2px]' : 'left-[2px]'}`}
                          />
                        </button>
                      </td>
                      <td className="px-2 py-2 font-medium text-fg-strong">{a.name}</td>
                      <td className="px-2 py-2 text-fg-muted">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-raised text-[12px] text-fg">
                          {projectName(a.projectId)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-fg-muted text-xs">{triggerLabel(a.trigger)}</td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/10 text-success font-mono text-[10.5px]">
                          {a.defaultTarget === 'worktree' ? (
                            <GitBranch className="w-3 h-3" />
                          ) : (
                            <MessageSquare className="w-3 h-3" />
                          )}
                          {a.defaultTarget}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] text-fg-muted tnum">
                        {lastRun ? (
                          <span className="inline-flex items-center gap-1.5">
                            {statusIcon(lastRun.status)}
                            {formatRelativeTime(lastRun.startedAt)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {/* Launch (default target) + override caret */}
                          <div className="relative inline-flex items-stretch">
                            <button
                              onClick={() => handleLaunch(a)}
                              className="inline-flex items-center gap-1 h-6 pl-2.5 pr-2 rounded-l-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary-hover"
                              title={`Launch in ${a.defaultTarget}`}
                            >
                              <Play className="w-3 h-3" /> Launch
                            </button>
                            <button
                              onClick={() => setLaunchMenuId((cur) => (cur === a.id ? null : a.id))}
                              className="inline-flex items-center justify-center h-6 w-6 rounded-r-md bg-primary text-primary-foreground hover:bg-primary-hover border-l border-primary-foreground/25"
                              title="Choose launch target"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            {launchMenuId === a.id && (
                              <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-popover border border-border rounded-lg shadow-[0_8px_30px_-10px_oklch(0_0_0/.35)] py-1">
                                <button
                                  onClick={() => handleLaunch(a, 'chat')}
                                  className="w-full text-left h-7 px-3 text-[12.5px] hover:bg-raised flex items-center gap-2"
                                >
                                  <MessageSquare className="w-3 h-3" /> Launch in chat
                                </button>
                                <button
                                  onClick={() => handleLaunch(a, 'worktree')}
                                  className="w-full text-left h-7 px-3 text-[12.5px] hover:bg-raised flex items-center gap-2"
                                >
                                  <GitBranch className="w-3 h-3" /> Launch in worktree
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleHeadless(a.id)}
                            className={btnIcon}
                            title="Run headless now"
                          >
                            <Zap className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEdit(a)}
                            className={`${btnIcon} opacity-0 group-hover:opacity-100`}
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            className={`${btnIcon} opacity-0 group-hover:opacity-100`}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-6 py-3">
          {runs.length === 0 ? (
            <div className="text-center py-16 text-fg-muted">No runs yet</div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {runs.map((run) => (
                <div key={run.id} className="border-b border-border">
                  <div
                    onClick={() => handleToggleRun(run)}
                    className="w-full text-left px-2 h-9 hover:bg-raised/60 flex items-center gap-2 cursor-pointer"
                  >
                    {expandedRunId === run.id ? (
                      <ChevronDown className="w-3 h-3 shrink-0 text-fg-muted" />
                    ) : (
                      <ChevronRight className="w-3 h-3 shrink-0 text-fg-muted" />
                    )}
                    {statusIcon(run.status)}
                    <span className="text-[12.5px] font-medium text-fg-strong">
                      {automationName(run.automationId)}
                    </span>
                    <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-raised text-fg-muted">
                      {run.mode}
                    </span>
                    <span className="text-[11.5px] text-fg-muted">
                      {projectName(run.projectId)}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-fg-muted tnum">
                      {formatRelativeTime(run.startedAt)}
                    </span>
                  </div>
                  {expandedRunId === run.id && (
                    <div className="px-6 py-3 bg-canvas space-y-1.5">
                      <div className="flex items-center gap-2 font-mono text-[11px] text-fg-muted tnum">
                        <Clock className="w-3 h-3" />
                        <span>{run.durationMs ? formatDuration(run.durationMs) : '—'}</span>
                        {run.exitCode !== undefined && <span>Exit: {run.exitCode}</span>}
                      </div>
                      {run.mode === 'foreground' && (
                        <div className="text-xs">
                          {run.terminalId && terminals[run.terminalId] ? (
                            <button
                              onClick={() => openChat(run)}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <MessageSquare className="w-3 h-3" /> Open chat
                            </button>
                          ) : (
                            <span className="text-fg-muted">
                              Session ended (launched interactively)
                            </span>
                          )}
                        </div>
                      )}
                      {run.error && (
                        <div className="text-xs text-danger bg-danger/10 rounded px-2 py-1">
                          {run.error}
                        </div>
                      )}
                      {run.result && (
                        <div className="bg-panel border border-border rounded-md px-3 py-2 max-h-60 overflow-auto">
                          <RunResultContent text={run.result} />
                        </div>
                      )}
                      {run.worktreeBranch && (
                        <div className="text-xs text-fg-muted flex items-center gap-1.5">
                          Branch: <span className="font-mono text-fg">{run.worktreeBranch}</span>
                          {run.prUrl && (
                            <button
                              onClick={() => window.electronAPI.shell.openExternal(run.prUrl!)}
                              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                            >
                              #{run.prNumber} <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AutomationCreateDialog
        isOpen={dialogOpen}
        onClose={closeDialog}
        editAutomation={editAutomation}
      />
    </div>
  )
}
