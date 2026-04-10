import { useEffect, useState, useMemo } from 'react'
import { Plus, GitBranch, MessageSquare, TerminalSquare } from 'lucide-react'
import { getElectronAPI } from '../utils/electron'
import type { SessionIndexEntry } from '../types'

interface ProjectOverviewProps {
  projectId: string
  projectName: string
  projectPath: string
  onCreateTerminal: () => void
  onResumeSession: (sessionId: string) => void
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api.sessionIndex.getForProject(projectPath).then((entries) => {
      if (!cancelled) {
        setSessions(entries as SessionIndexEntry[])
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setSessions([])
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [api, projectPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-sidebar">
        <div className="text-muted-foreground text-sm">Loading sessions...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="px-6 pt-8 pb-4">
        <h2 className="text-xl font-semibold text-sidebar-foreground mb-1">
          {projectName}
        </h2>
        <p className="text-muted-foreground text-sm">
          {sessions.length > 0
            ? `${sessions.length} recent session${sessions.length !== 1 ? 's' : ''}`
            : 'No recent sessions'}
        </p>
      </div>

      {/* New Chat button */}
      <div className="px-6 pb-4">
        <button
          onClick={onCreateTerminal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity text-sm shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* Sessions list */}
      {sessions.length > 0 && (
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Recent Sessions
          </h3>
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => onResumeSession(session.sessionId)}
                className="w-full text-left p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-sidebar-foreground truncate flex-1">
                    {session.summary || session.firstPrompt || 'Untitled session'}
                  </span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
                    {formatRelativeTime(session.modified)}
                  </span>
                </div>
                {session.summary && session.firstPrompt && session.summary !== session.firstPrompt && (
                  <p className="text-xs text-muted-foreground truncate mb-2">
                    {session.firstPrompt}
                  </p>
                )}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  {session.gitBranch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {session.gitBranch}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {session.messageCount}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sessions.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8">
            <TerminalSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              No recent sessions found. Start a new chat to get going.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
