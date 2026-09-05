import { useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { LogoIcon } from '../LogoIcon'
import { isMac } from '../../utils/platform'

/**
 * The app's own titlebar (36px), replacing the OS chrome on win32/darwin
 * (see createWindow's titleBarStyle: 'hidden' / 'hiddenInset'). Carries the
 * logo, app name, and a breadcrumb of the active project › worktree › chat.
 * The whole bar is a drag region; only the logo+name cluster is marked
 * no-drag (reserved for a future click target — nothing is interactive yet).
 */
export function TitleBar() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const worktrees = useProjectStore((s) => s.worktrees)

  const project = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined
  const activeTerminal = activeTerminalId ? terminals[activeTerminalId] : undefined
  const worktree = activeTerminal?.worktreeId ? worktrees[activeTerminal.worktreeId] : undefined
  const chatTitle = activeTerminal
    ? activeTerminal.generatedTitle || activeTerminal.title
    : undefined

  // A chat is usually titled after its worktree until the agent names it, so
  // drop a segment that merely repeats the one before it.
  const segments = [project?.name, worktree?.name, chatTitle]
    .filter((s): s is string => Boolean(s))
    .filter((s, i, arr) => i === 0 || s !== arr[i - 1])

  const mac = useMemo(() => isMac(), [])

  return (
    <div
      className="h-9 shrink-0 flex items-center bg-canvas border-b border-border [-webkit-app-region:drag] select-none"
      style={{
        paddingLeft: mac ? 78 : 12,
        // Keeps the breadcrumb clear of the native window buttons on the right
        // (the overlay area on win32, traffic lights don't apply here since
        // they sit on the left on darwin). Falls back to 0 when unsupported.
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))',
      }}
    >
      <div className="flex items-center gap-2 min-w-0 shrink-0 [-webkit-app-region:no-drag]">
        <LogoIcon className="w-4 h-4 text-primary shrink-0" />
        <h1 className="text-[13px] font-semibold text-fg-strong whitespace-nowrap">Command</h1>
      </div>

      {segments.length > 0 && (
        <div className="flex items-center gap-1.5 min-w-0 ml-2 font-mono text-[11.5px] text-fg-muted truncate">
          {segments.map((segment, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && (
                <span aria-hidden="true" className="text-fg-faint">
                  ›
                </span>
              )}
              <span className={`truncate ${i === segments.length - 1 ? 'text-fg' : ''}`}>
                {segment}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
