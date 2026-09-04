import { useEffect, useState, useMemo } from 'react'
import {
  Plus,
  GitBranch,
  MessageSquare,
  TerminalSquare,
  FileEdit,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import { cleanSessionTitle } from '../utils/sessionTitle'
import { DEFAULT_HOTKEY_CONFIG, formatBinding } from '../utils/hotkeys'
import type { SessionIndexEntry } from '../types'
import { btnPrimary, card, kbd } from './ui/controls'

interface ProjectOverviewProps {
  projectId: string
  projectName: string
  projectPath: string
  onCreateTerminal: () => void
  onResumeSession: (sessionId: string, initialTitle?: string) => void
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString()
}

function formatDuration(ms: number): string {
  if (ms < 60000) return '<1m'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function ProjectOverview({
  projectId,
  projectName,
  projectPath,
  onCreateTerminal,
  onResumeSession,
}: ProjectOverviewProps) {
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const api = useMemo(() => getElectronAPI(), [])

  const worktreeCount = useProjectStore(
    (s) => Object.values(s.worktrees).filter((w) => w.projectId === projectId).length
  )
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api.sessionIndex
      .getForProject(projectPath)
      .then((entries) => {
        if (!cancelled) {
          setSessions(entries)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([])
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [api, projectPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-screen">
        <div className="text-fg-muted text-[13px]">Loading sessions...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-screen">
      {/* Header */}
      <div className="px-8 pt-8 pb-5">
        <h1 className="text-[22px] font-semibold text-fg-strong tracking-[-0.01em]">
          {projectName}
        </h1>
        <p className="font-mono text-[11.5px] text-fg-muted truncate mt-1" title={projectPath}>
          {projectPath}
        </p>
        <p className="font-mono text-[11.5px] text-fg-muted tnum mt-1">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {worktreeCount > 0 && ` · ${worktreeCount} worktree${worktreeCount !== 1 ? 's' : ''}`}
        </p>

        <div className="flex items-center gap-2 mt-4">
          <button onClick={onCreateTerminal} className={btnPrimary}>
            <Plus className="w-4 h-4" />
            New chat
          </button>
          <kbd className={kbd}>{formatBinding(hotkeyConfig['terminal.new'])}</kbd>
        </div>
      </div>

      {/* Sessions list */}
      {sessions.length > 0 && (
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <h2 className="eyebrow mb-3">Recent sessions · {sessions.length}</h2>
          <div className="space-y-2">
            {sessions.map((session) => {
              const sessionTitle =
                cleanSessionTitle(session.generatedTitle) ||
                cleanSessionTitle(session.summary) ||
                cleanSessionTitle(session.firstPrompt)
              const rawSubtitle = session.generatedSummary || session.firstPrompt
              const subtitle = cleanSessionTitle(rawSubtitle)
              return (
                <button
                  key={session.sessionId}
                  onClick={() => onResumeSession(session.sessionId, sessionTitle)}
                  className={`${card} w-full text-left px-4 py-3 hover:bg-raised transition-colors group`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-[13px] font-medium text-fg-strong truncate flex-1">
                      {sessionTitle || 'Untitled session'}
                    </span>
                    <span className="font-mono text-[11px] text-fg-muted tnum shrink-0 mt-0.5">
                      {formatRelativeTime(session.modified)}
                    </span>
                  </div>
                  {subtitle && subtitle !== sessionTitle ? (
                    <p className="text-[12.5px] text-fg-muted line-clamp-2 mb-2">{subtitle}</p>
                  ) : null}
                  <div className="flex items-center gap-3 font-mono text-[11px] text-fg-muted tnum">
                    {session.gitBranch && (
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3" strokeWidth={1.5} />
                        {session.gitBranch}
                      </span>
                    )}
                    {session.worktreeName &&
                      session.worktreeName !== session.gitBranch?.replace(/\//g, '-') && (
                        <span
                          className="px-1 rounded bg-raised text-fg-muted"
                          title={`Worktree: ${session.worktreeName}`}
                        >
                          {session.worktreeName}
                        </span>
                      )}
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" strokeWidth={1.5} />
                      {session.messageCount}
                    </span>
                    {session.filesModified?.length > 0 && (
                      <span className="flex items-center gap-1">
                        <FileEdit className="w-3 h-3" strokeWidth={1.5} />
                        {session.filesModified.length}
                      </span>
                    )}
                    {session.durationMs > 0 && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" strokeWidth={1.5} />
                        {formatDuration(session.durationMs)}
                      </span>
                    )}
                    {session.errorCount > 0 && (
                      <span className="flex items-center gap-1 text-danger">
                        <AlertTriangle className="w-3 h-3" strokeWidth={1.5} />
                        {session.errorCount}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sessions.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8">
            <TerminalSquare className="w-8 h-8 text-fg-faint mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-fg-muted text-[13px]">
              No recent sessions found. Start a new chat to get going.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
