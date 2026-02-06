import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

export function GeneralSection() {
  const projects = useProjectStore((s) => s.projects)
  const updateProject = useProjectStore((s) => s.updateProject)

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No projects added yet.</p>
      </div>
    )
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
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-foreground truncate">{project.name}</h4>
                  <p className="text-xs text-muted-foreground truncate">{project.path}</p>
                </div>
              </div>

              <div className="mt-3 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium text-foreground cursor-pointer" htmlFor={`skip-permissions-${project.id}`}>
                    Skip Permissions
                  </label>
                  {skipPermissions && (
                    <div className="flex items-start gap-1.5 mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        Runs <code className="text-[11px] px-1 py-0.5 bg-muted rounded">claude --dangerously-skip-permissions</code>. Only use in isolated environments.
                      </p>
                    </div>
                  )}
                </div>
                <button
                  id={`skip-permissions-${project.id}`}
                  role="switch"
                  aria-checked={skipPermissions}
                  onClick={() => updateProject(project.id, {
                    settings: { dangerouslySkipPermissions: !skipPermissions },
                  })}
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
    </div>
  )
}
