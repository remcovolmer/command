import { useEffect, useMemo, useState, useCallback } from 'react'
import { Zap, Plus, Play, Square, ToggleLeft, ToggleRight, Trash2, ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, Pencil, ExternalLink } from 'lucide-react'
import type { Automation, AutomationRun } from '../../types'
import { getElectronAPI } from '../../utils/electron'

interface AutomationsPanelProps {
  onCreateClick: () => void
  onEditClick: (automation: Automation) => void
}

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
    case 'schedule': return `Cron: ${trigger.cron}`
    case 'claude-done': return 'On Claude done'
    case 'git-event': return `Git: ${trigger.event}`
    case 'file-change': return `Files: ${trigger.patterns.join(', ')}`
  }
}

function statusIcon(status: AutomationRun['status']) {
  switch (status) {
    case 'running': return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />
    case 'timeout': return <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
    case 'cancelled': return <Square className="w-3.5 h-3.5 text-muted-foreground" />
  }
}

export function AutomationsPanel({ onCreateClick, onEditClick }: AutomationsPanelProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const [automations, setAutomations] = useState<Automation[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const loadData = useCallback(async () => {
    try {
      const [automationsList, runsList] = await Promise.all([
        api.automation.list(),
        api.automation.listRuns(undefined, 50),
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

  // Subscribe to run events
  useEffect(() => {
    const unsubStarted = api.automation.onRunStarted((run) => {
      setRuns(prev => [run as AutomationRun, ...prev])
    })
    const unsubCompleted = api.automation.onRunCompleted((run) => {
      setRuns(prev => prev.map(r => r.id === (run as AutomationRun).id ? run as AutomationRun : r))
    })
    const unsubFailed = api.automation.onRunFailed((run) => {
      setRuns(prev => prev.map(r => r.id === (run as AutomationRun).id ? run as AutomationRun : r))
    })
    return () => {
      unsubStarted()
      unsubCompleted()
      unsubFailed()
    }
  }, [api])

  const handleToggle = async (id: string) => {
    const result = await api.automation.toggle(id) as Automation | null
    if (result) {
      setAutomations(prev => prev.map(a => a.id === id ? result : a))
    }
  }

  const handleDelete = async (id: string) => {
    await api.automation.delete(id)
    setAutomations(prev => prev.filter(a => a.id !== id))
    setRuns(prev => prev.filter(r => r.automationId !== id))
  }

  const handleTrigger = async (id: string) => {
    await api.automation.trigger(id)
  }

  const handleStopRun = async (runId: string) => {
    await api.automation.stopRun(runId)
  }

  const handleMarkRead = async (runId: string) => {
    await api.automation.markRead(runId)
    setRuns(prev => prev.map(r => r.id === runId ? { ...r, read: true } : r))
  }

  const handleDeleteRun = async (runId: string) => {
    await api.automation.deleteRun(runId)
    setRuns(prev => prev.filter(r => r.id !== runId))
    if (expandedRunId === runId) setExpandedRunId(null)
  }

  const filteredRuns = filter === 'unread'
    ? runs.filter(r => !r.read && r.status !== 'running')
    : runs

  const automationName = (automationId: string) =>
    automations.find(a => a.id === automationId)?.name ?? 'Unknown'

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Automations list */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Automations</span>
          <button
            onClick={onCreateClick}
            className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            title="New automation"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {automations.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-muted-foreground">
            No automations yet.{' '}
            <button onClick={onCreateClick} className="text-primary hover:underline">
              Create one
            </button>
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            {automations.map(automation => (
              <div
                key={automation.id}
                className="px-3 py-1.5 hover:bg-muted/30 flex items-center gap-2 group"
              >
                <button
                  onClick={() => handleToggle(automation.id)}
                  className="shrink-0"
                  title={automation.enabled ? 'Disable' : 'Enable'}
                >
                  {automation.enabled
                    ? <ToggleRight className="w-4 h-4 text-primary" />
                    : <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{automation.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{triggerLabel(automation.trigger)}</div>
                </div>
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleTrigger(automation.id)}
                    className="p-0.5 rounded hover:bg-muted/50"
                    title="Run now"
                  >
                    <Play className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => onEditClick(automation)}
                    className="p-0.5 rounded hover:bg-muted/50"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => handleDelete(automation.id)}
                    className="p-0.5 rounded hover:bg-muted/50"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Triage inbox */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Run History</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-1.5 py-0.5 rounded text-xs ${filter === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-1.5 py-0.5 rounded text-xs ${filter === 'unread' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Unread
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {filteredRuns.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {filter === 'unread' ? 'No unread runs' : 'No runs yet'}
            </div>
          ) : (
            filteredRuns.map(run => (
              <div key={run.id}>
                <button
                  onClick={() => {
                    const newId = expandedRunId === run.id ? null : run.id
                    setExpandedRunId(newId)
                    if (newId && !run.read) handleMarkRead(run.id)
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-muted/30 flex items-center gap-2 ${!run.read && run.status !== 'running' ? 'bg-primary/5' : ''}`}
                >
                  {expandedRunId === run.id
                    ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                  }
                  {statusIcon(run.status)}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs truncate block">{automationName(run.automationId)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                </button>

                {/* Expanded run detail */}
                {expandedRunId === run.id && (
                  <div className="px-3 py-2 bg-muted/20 border-y border-border/50">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{run.durationMs ? formatDuration(run.durationMs) : 'Running...'}</span>
                        {run.exitCode !== undefined && <span>Exit: {run.exitCode}</span>}
                      </div>

                      {run.error && (
                        <div className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1">
                          {run.error}
                        </div>
                      )}

                      {run.result && (
                        <pre className="text-xs bg-background/50 rounded px-2 py-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                          {run.result.substring(0, 2000)}
                          {run.result.length > 2000 && '...'}
                        </pre>
                      )}

                      {run.worktreeBranch && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          Branch: <span className="font-mono text-foreground">{run.worktreeBranch}</span>
                          {run.prUrl && (
                            <button
                              onClick={(e) => { e.stopPropagation(); window.electronAPI.shell.openExternal(run.prUrl!) }}
                              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                              title={`Open PR #${run.prNumber}`}
                            >
                              #{run.prNumber} <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        {run.status === 'running' && (
                          <button
                            onClick={() => handleStopRun(run.id)}
                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                          >
                            <Square className="w-3 h-3" /> Stop
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteRun(run.id)}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
