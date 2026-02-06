import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

export function GeneralSection() {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)
  const [confirmingProjectId, setConfirmingProjectId] = useState<string | null>(null)

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No projects added yet.</p>
      </div>
    )
  }

  const handleToggle = (projectId: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      // Disabling is always safe — no confirmation needed
      updateProject(projectId, { settings: { dangerouslySkipPermissions: false } })
    } else {
      // Enabling requires confirmation
      setConfirmingProjectId(projectId)
    }
  }

  const confirmEnable = () => {
    if (confirmingProjectId) {
      updateProject(confirmingProjectId, { settings: { dangerouslySkipPermissions: true } })
      setConfirmingProjectId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Project Settings</h3>
        <p className="text-xs text-muted-foreground">Configure settings per project. Changes apply to new chats only.</p>
      </div>

      <div className="space-y-3">
        {projects.map((project) => {
          const skipPermissions = project.settings?.dangerouslySkipPermissions ?? false

          return (
            <div
              key={project.id}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-foreground truncate">{project.name}</h4>
                <p className="text-xs text-muted-foreground truncate">{project.path}</p>
              </div>

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
