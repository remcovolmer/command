import { useState, useEffect } from 'react'
import { AlertTriangle, Coins, Info } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import type { AuthMode, ClaudeMode } from '../../types'

type ConfirmDialog = { projectId: string; mode: 'auto' | 'full-auto' } | null

interface GeneralSectionProps {
  onNestedDialogChange?: (open: boolean) => void
}

export function GeneralSection({ onNestedDialogChange }: GeneralSectionProps) {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const terminalPoolSize = useProjectStore((s) => s.terminalPoolSize)
  const setTerminalPoolSize = useProjectStore((s) => s.setTerminalPoolSize)
  const profiles = useProjectStore((s) => s.profiles)
  const projectVertexConfigs = useProjectStore((s) => s.projectVertexConfigs)
  const theme = useProjectStore((s) => s.theme)
  const setTheme = useProjectStore((s) => s.setTheme)
  const confirmedModeKeys = useProjectStore((s) => s.confirmedModeKeys)
  const addConfirmedModeKey = useProjectStore((s) => s.addConfirmedModeKey)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(null)
  const hasConfirmDialog = confirmDialog !== null

  // Notify parent when nested dialog opens/closes so it can disable its own Escape handler
  useEffect(() => {
    onNestedDialogChange?.(hasConfirmDialog)
  }, [hasConfirmDialog, onNestedDialogChange])

  const confirmMode = () => {
    if (confirmDialog) {
      const project = projects.find((p) => p.id === confirmDialog.projectId)
      addConfirmedModeKey(`${confirmDialog.projectId}:${confirmDialog.mode}`)
      updateProject(confirmDialog.projectId, { settings: { ...project?.settings, claudeMode: confirmDialog.mode } })
      setConfirmDialog(null)
    }
  }

  // Keyboard support for the confirmation dialog (Escape to close, Enter to confirm)
  useDialogHotkeys(
    () => setConfirmDialog(null),
    () => confirmMode(),
    { enabled: hasConfirmDialog }
  )

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No projects added yet.</p>
      </div>
    )
  }

  const handleModeChange = (projectId: string, newMode: ClaudeMode) => {
    const project = projects.find((p) => p.id === projectId)
    if (newMode === 'chat') {
      updateProject(projectId, { settings: { ...project?.settings, claudeMode: 'chat' } })
    } else {
      const key = `${projectId}:${newMode}`
      if (confirmedModeKeys.includes(key)) {
        updateProject(projectId, { settings: { ...project?.settings, claudeMode: newMode } })
      } else {
        setConfirmDialog({ projectId, mode: newMode })
      }
    }
  }

  const handleAuthModeChange = (projectId: string, project: typeof projects[0], authMode: AuthMode) => {
    updateProject(projectId, {
      settings: {
        ...project.settings,
        authMode,
        // Clear profileId when switching to subscription
        profileId: authMode === 'subscription' ? undefined : project.settings?.profileId,
      },
    })
  }

  const handleProfileSelect = (projectId: string, project: typeof projects[0], profileId: string) => {
    updateProject(projectId, {
      settings: {
        ...project.settings,
        authMode: 'profile',
        profileId,
      },
    })
  }

  const modeOptions: { value: ClaudeMode; label: string }[] = [
    { value: 'chat', label: 'Chat' },
    { value: 'auto', label: 'Auto' },
    { value: 'full-auto', label: 'Full Auto' },
  ]

  const getModeColor = (mode: ClaudeMode, isActive: boolean) => {
    if (!isActive) return 'bg-muted text-muted-foreground hover:bg-accent'
    switch (mode) {
      case 'chat': return 'bg-primary text-primary-foreground'
      case 'auto': return 'bg-blue-500 text-white'
      case 'full-auto': return 'bg-yellow-500 text-black'
    }
  }

  return (
    <div className="space-y-6">
      {/* Appearance section */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Appearance</h3>
        <p className="text-xs text-muted-foreground mb-3">Choose your preferred theme.</p>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            {(['light', 'dark', 'system'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setTheme(option)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                  theme === option
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Performance section */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Performance</h3>
        <p className="text-xs text-muted-foreground mb-3">Tune memory usage and performance.</p>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground" htmlFor="terminal-pool-size">
                Active Terminal Limit
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Maximum xterm instances kept in memory. Inactive terminals beyond this limit are serialized and restored on demand.
              </p>
            </div>
            <input
              id="terminal-pool-size"
              type="number"
              min={2}
              max={20}
              value={terminalPoolSize}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val)) setTerminalPoolSize(val)
              }}
              className="w-16 px-2 py-1 text-sm text-center rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Project settings section */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Project Settings</h3>
        <p className="text-xs text-muted-foreground">Configure settings per project. Changes apply to new chats only.</p>
      </div>

      <div className="space-y-3">
        {projects.map((project) => {
          const currentMode: ClaudeMode = project.settings?.claudeMode ?? 'chat'
          const authMode = project.settings?.authMode ?? 'subscription'
          const profileId = project.settings?.profileId
          const hasVertexConfig = projectVertexConfigs[project.id] ?? false

          return (
            <div
              key={project.id}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-foreground truncate">{project.name}</h4>
                  <p className="text-xs text-muted-foreground truncate">{project.path}</p>
                </div>
                {/* Vertex AI indicator */}
                {hasVertexConfig && (
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-500 shrink-0"
                    title="Vertex AI configured via .claude/settings.local.json"
                  >
                    <Coins className="w-3 h-3" />
                    Vertex AI
                  </span>
                )}
              </div>

              {/* Claude Mode selector */}
              <div className="mt-3">
                <label className="text-sm font-medium text-foreground">Claude Mode</label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  {currentMode === 'chat' && 'Normal mode — Claude asks for permission before every action.'}
                  {currentMode === 'auto' && 'Auto mode — Claude auto-accepts safe actions, asks for risky ones.'}
                  {currentMode === 'full-auto' && 'Full auto — Claude executes all actions without permission prompts.'}
                </p>
                <div className="flex items-center gap-1">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleModeChange(project.id, option.value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        getModeColor(option.value, currentMode === option.value)
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auth Mode */}
              <div className="mt-3 pt-3 border-t border-border/30">
                <label className="text-sm font-medium text-foreground">Auth Mode</label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Choose how Claude Code authenticates for this project.
                </p>
                <div className="flex items-center gap-3">
                  <select
                    value={authMode}
                    onChange={(e) => handleAuthModeChange(project.id, project, e.target.value as AuthMode)}
                    className="px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="subscription">Subscription (default)</option>
                    <option value="profile">Profile (env injection)</option>
                  </select>

                  {authMode === 'profile' && (
                    <select
                      value={profileId ?? ''}
                      onChange={(e) => handleProfileSelect(project.id, project, e.target.value)}
                      className="px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select profile...</option>
                      {profiles.filter(p => p.envVarCount > 0).map(profile => (
                        <option key={profile.id} value={profile.id}>{profile.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirmation dialog for Auto and Full Auto modes */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDialog(null)} />
          <div className="relative bg-background rounded-lg border border-border p-6 max-w-md shadow-xl">
            <div className="flex items-start gap-3">
              {confirmDialog.mode === 'full-auto' ? (
                <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
              )}
              <div>
                {confirmDialog.mode === 'full-auto' ? (
                  <>
                    <h3 className="text-sm font-semibold text-foreground">Enable Full Auto Mode?</h3>
                    <p className="text-xs text-muted-foreground mt-2">
                      This will run Claude Code with <code className="text-[11px] px-1 py-0.5 bg-muted rounded">--dangerously-skip-permissions</code>,
                      allowing it to execute any command without approval prompts.
                    </p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                      Only enable this in isolated or sandboxed environments.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-foreground">Enable Auto Mode?</h3>
                    <p className="text-xs text-muted-foreground mt-2">
                      This will run Claude Code with <code className="text-[11px] px-1 py-0.5 bg-muted rounded">--enable-auto-mode</code>.
                      Claude will auto-accept safe actions (file edits, reads) but still ask permission for risky operations.
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmMode}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  confirmDialog.mode === 'full-auto'
                    ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                    : 'bg-blue-500 text-white hover:bg-blue-400'
                }`}
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
