import { useState, useEffect } from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import type { AuthMode } from '../../types'

export function GeneralSection() {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const terminalPoolSize = useProjectStore((s) => s.terminalPoolSize)
  const setTerminalPoolSize = useProjectStore((s) => s.setTerminalPoolSize)
  const profiles = useProjectStore((s) => s.profiles)
  const projectLocalConfigs = useProjectStore((s) => s.projectLocalConfigs)
  const checkLocalConfig = useProjectStore((s) => s.checkLocalConfig)
  const [confirmingProjectId, setConfirmingProjectId] = useState<string | null>(null)

  // Check local config for all projects on mount
  useEffect(() => {
    for (const project of projects) {
      checkLocalConfig(project.id)
    }
  }, [projects, checkLocalConfig])

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No projects added yet.</p>
      </div>
    )
  }

  const handleToggle = (projectId: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      updateProject(projectId, { settings: { dangerouslySkipPermissions: false } })
    } else {
      setConfirmingProjectId(projectId)
    }
  }

  const confirmEnable = () => {
    if (confirmingProjectId) {
      updateProject(confirmingProjectId, { settings: { dangerouslySkipPermissions: true } })
      setConfirmingProjectId(null)
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

  return (
    <div className="space-y-6">
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
          const skipPermissions = project.settings?.dangerouslySkipPermissions ?? false
          const authMode = project.settings?.authMode ?? 'subscription'
          const profileId = project.settings?.profileId
          const hasLocalConfig = projectLocalConfigs[project.id] ?? false

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
                {/* Local config indicator */}
                {hasLocalConfig && (
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-500 shrink-0"
                    title="This project has a local Claude config file (.claude/settings.local.json)"
                  >
                    <FileText className="w-3 h-3" />
                    Local Config
                  </span>
                )}
              </div>

              {/* Skip Permissions toggle */}
              <div className="mt-3 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium text-foreground cursor-pointer" htmlFor={`skip-permissions-${project.id}`}>
                    Skip Permissions
                  </label>
                  <div className="flex items-start gap-1.5 mt-1">
                    <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${skipPermissions ? 'text-yellow-500' : 'text-muted-foreground/40'}`} />
                    <p className={`text-xs ${skipPermissions ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}>
                      Runs <code className="text-[11px] px-1 py-0.5 bg-muted rounded">claude --dangerously-skip-permissions</code>. Only use in isolated environments.
                    </p>
                  </div>
                </div>
                <button
                  id={`skip-permissions-${project.id}`}
                  role="switch"
                  aria-checked={skipPermissions}
                  onClick={() => handleToggle(project.id, skipPermissions)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                    skipPermissions ? 'bg-yellow-500' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                      skipPermissions ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
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

      {/* Confirmation dialog */}
      {confirmingProjectId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmingProjectId(null)} />
          <div className="relative bg-background rounded-lg border border-border p-6 max-w-md shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Enable Skip Permissions?</h3>
                <p className="text-xs text-muted-foreground mt-2">
                  This will run Claude Code with <code className="text-[11px] px-1 py-0.5 bg-muted rounded">--dangerously-skip-permissions</code>,
                  allowing it to execute any command without approval prompts.
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                  Only enable this in isolated or sandboxed environments.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmingProjectId(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmEnable}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-yellow-500 text-black hover:bg-yellow-400 transition-colors"
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
