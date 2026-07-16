import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Plus,
  FolderOpen,
  GitBranch,
  Code,
  Coins,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import type { AgentType, Project, TerminalSession, Worktree } from '../../types'
import { AGENT_DISPLAY, AGENT_IDS, isAgentType } from '@shared/agents'
import { useProjectStore } from '../../stores/projectStore'
import { getProjectRollupState } from '../../utils/projectRollup'
import { WorktreeItem } from '../Worktree/WorktreeItem'
import { TerminalListItem } from './TerminalListItem'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { getElectronAPI } from '../../utils/electron'

interface SortableProjectItemProps {
  project: Project
  layoutId: string
  terminals: TerminalSession[]
  directTerminals: TerminalSession[]
  worktrees: Worktree[]
  getWorktreeTerminals: (worktreeId: string) => TerminalSession[]
  isActive: boolean
  isInactive?: boolean
  activeTerminalId: string | null
  isDragging: boolean
  onSelect: (projectId: string) => void
  onRemove: (projectId: string) => void
  onCreateTerminal: (projectId: string, worktreeId?: string, agent?: AgentType) => void
  onCreateWorktree: (projectId: string) => void
  onRemoveWorktree: (worktreeId: string) => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
  onSwitchAgent: (terminal: TerminalSession, agent: AgentType) => void
}

export const SortableProjectItem = memo(function SortableProjectItem({
  project,
  layoutId,
  terminals,
  directTerminals,
  worktrees,
  getWorktreeTerminals,
  isActive,
  isInactive = false,
  activeTerminalId,
  isDragging,
  onSelect,
  onRemove,
  onCreateTerminal,
  onCreateWorktree,
  onRemoveWorktree,
  onSelectTerminal,
  onCloseTerminal,
  onSwitchAgent,
}: SortableProjectItemProps) {
  const shouldReduceMotion = useReducedMotion()
  const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({
    id: project.id,
  })

  const hasVertexConfig = useProjectStore((s) => s.projectVertexConfigs[project.id] ?? false)
  const isCollapsed = useProjectStore((s) => s.collapsedProjects[project.id] ?? false)
  // Inactive-section projects expand by selection: they render no children until
  // selected, so an unselected one is effectively collapsed regardless of the
  // manual flag. Active/pinned projects keep the manual collapse state.
  const effectiveCollapsed = isInactive ? !isActive || isCollapsed : isCollapsed
  const toggleProjectCollapsed = useProjectStore((s) => s.toggleProjectCollapsed)
  const togglePinProject = useProjectStore((s) => s.togglePinProject)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setProjectOverviewVisible = useProjectStore((s) => s.setProjectOverviewVisible)
  const showInactiveWorktrees = useProjectStore(
    (s) => s.inactiveWorktreesExpanded[project.id] ?? false
  )
  const toggleInactiveWorktrees = useProjectStore((s) => s.toggleInactiveWorktrees)
  const renamingProjectId = useProjectStore((s) => s.renamingProjectId)
  const startProjectRename = useProjectStore((s) => s.startProjectRename)
  const cancelProjectRename = useProjectStore((s) => s.cancelProjectRename)
  const commitProjectRename = useProjectStore((s) => s.commitProjectRename)
  const updateProject = useProjectStore((s) => s.updateProject)
  const hasMismatch = useProjectStore((s) => {
    const authMode = project.settings?.authMode ?? 'subscription'
    const profileId = project.settings?.profileId
    if (authMode !== 'profile') return false
    if (!profileId) return true
    const profile = s.profiles.find((p) => p.id === profileId)
    return !profile || profile.envVarCount === 0
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Inline rename state. renamingProjectId lives in the store so the F2 hotkey
  // and the context menu can both drive the same edit; only one row edits at a time.
  const isRenaming = renamingProjectId === project.id
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameSubmittedRef = useRef(false)

  useEffect(() => {
    if (isRenaming) {
      renameSubmittedRef.current = false
      setRenameValue(project.name)
      // Focus + select on the next frame, after the input mounts.
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [isRenaming, project.name])

  const handleRenameSubmit = () => {
    if (renameSubmittedRef.current) return
    renameSubmittedRef.current = true
    commitProjectRename(renameValue)
  }

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Override the project's default agent for a single new chat. The + button
  // always uses the default; these items cover the other agents.
  const defaultAgent = project.settings?.defaultAgent ?? 'claude'
  const agentOverrideItems: ContextMenuEntry[] = AGENT_IDS.filter((a) => a !== defaultAgent).map(
    (a) => ({
      label: `New ${AGENT_DISPLAY[a].label} chat`,
      onClick: () => onCreateTerminal(project.id, undefined, a),
    })
  )

  const contextMenuItems: ContextMenuEntry[] = [
    ...agentOverrideItems,
    ...(agentOverrideItems.length ? [{ type: 'separator' as const }] : []),
    {
      label: 'Show overview',
      shortcut: 'Ctrl+Shift+O',
      onClick: () => {
        // Overview renders for the active project, so activate it first if needed.
        if (!isActive) setActiveProject(project.id)
        setProjectOverviewVisible(true)
      },
    },
    {
      label: 'Rename',
      shortcut: 'F2',
      onClick: () => startProjectRename(project.id),
    },
    {
      label: project.type === 'code' ? 'Switch to Project' : 'Switch to Code',
      shortcut: 'Ctrl+Shift+Y',
      onClick: () =>
        updateProject(project.id, { type: project.type === 'code' ? 'project' : 'code' }),
    },
    {
      label: project.pinned ? 'Unpin' : 'Pin to top',
      shortcut: 'Ctrl+Alt+P',
      onClick: () => togglePinProject(project.id),
    },
    { type: 'separator' },
    {
      label: 'Open in File Explorer',
      onClick: () => getElectronAPI().shell.openPath(project.path),
    },
    {
      label: 'Open in Antigravity',
      onClick: () => getElectronAPI().shell.openInEditor(project.path),
    },
    ...(project.type === 'code'
      ? [
          {
            label: 'Open on GitHub',
            onClick: async () => {
              try {
                const url = await getElectronAPI().git.getRemoteUrl(project.path)
                if (url) {
                  await getElectronAPI().shell.openExternal(url)
                }
              } catch {
                // Remote URL unavailable or invalid
              }
            },
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: 'Remove project',
      variant: 'destructive',
      onClick: () => onRemove(project.id),
    },
  ]

  // Show empty state for active project when there are no terminals
  // Code projects also require no worktrees to show the empty state
  const showEmptyState =
    isActive && terminals.length === 0 && (project.type !== 'code' || worktrees.length === 0)

  // Highest-priority child status, shown as a dot on the collapsed header. Keyed
  // on effectiveCollapsed (like the chevron and children) so all collapse-driven
  // renders agree; for inactive projects `terminals` is empty -> rollup is null.
  const rollupState = effectiveCollapsed ? getProjectRollupState(terminals) : null

  // Counter chip counts Claude chats only — sidecar 'normal' shells are not chats.
  const chatCount = terminals.filter((t) => isAgentType(t.type)).length

  // Collapsed-summary count. Inactive projects (0 chats by definition) show no chip:
  // the "0" is noise, and a worktree count would render inconsistently since
  // worktrees load lazily (only previously-selected projects would have one).
  // Active/pinned projects show "chats · worktrees" (or just chats).
  const collapsedCount = isInactive
    ? null
    : worktrees.length > 0
      ? `${chatCount} · ${worktrees.length}`
      : `${chatCount}`

  // A worktree is "active" when it has a running Claude session; branches sitting
  // on disk with no chat (sidecar 'normal' shells don't count, matching chatCount)
  // collapse under a toggle to keep an active project's tree readable.
  const hasClaudeSession = (worktreeId: string) =>
    getWorktreeTerminals(worktreeId).some((t) => isAgentType(t.type))
  const activeWorktrees = worktrees.filter((w) => hasClaudeSession(w.id))
  const inactiveWorktrees = worktrees.filter((w) => !hasClaudeSession(w.id))

  const renderWorktree = (worktree: Worktree) => (
    <WorktreeItem
      key={worktree.id}
      worktree={worktree}
      projectPath={project.path}
      terminals={getWorktreeTerminals(worktree.id)}
      activeTerminalId={activeTerminalId}
      onCreateTerminal={() => onCreateTerminal(project.id, worktree.id)}
      onSelectTerminal={onSelectTerminal}
      onSwitchAgent={onSwitchAgent}
      onRemove={() => onRemoveWorktree(worktree.id)}
    />
  )

  return (
    <motion.li
      ref={setNodeRef}
      data-project-id={project.id}
      layoutId={layoutId}
      layout={shouldReduceMotion ? false : !isDragging}
      initial={false}
      style={style}
      className="relative"
    >
      {/* Drop indicator line */}
      {isOver && <div className="absolute inset-x-0 -top-0.5 h-0.5 bg-primary rounded-full" />}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Project Header */}
      <div
        onClick={() => onSelect(project.id)}
        onContextMenu={handleContextMenu}
        {...attributes}
        {...listeners}
        className={`
          group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing
          transition-colors duration-150
          ${
            isActive
              ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground'
          }
        `}
      >
        {project.type === 'code' ? (
          <Code className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
        ) : (
          <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
        )}
        {/* Name grows to fill the row so it truncates as late as possible; the
            chevron and right-side cluster are pushed to the right edge. While
            renaming, an inline input replaces the label. */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handleRenameSubmit()
              if (e.key === 'Escape') {
                // Guard the impending blur so it doesn't commit the edit.
                renameSubmittedRef.current = true
                cancelProjectRename()
              }
            }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-input border border-border rounded px-1 py-0 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span
            className="flex-1 text-sm truncate min-w-0"
            title={project.path}
            onDoubleClick={(e) => {
              e.stopPropagation()
              startProjectRename(project.id)
            }}
          >
            {project.name}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            // Inactive projects expand via selection; an unselected one has no
            // manual collapse state worth toggling, so the chevron selects it.
            if (isInactive && !isActive) {
              onSelect(project.id)
            } else {
              toggleProjectCollapsed(project.id)
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-expanded={!effectiveCollapsed}
          className="p-0.5 rounded hover:bg-border flex-shrink-0"
          title={effectiveCollapsed ? 'Expand project' : 'Collapse project'}
        >
          <ChevronRight
            aria-hidden="true"
            className={`w-3 h-3 transition-transform duration-150 ${!effectiveCollapsed ? 'rotate-90' : ''}`}
          />
        </button>

        {/* Collapsed summary: counter chip + highest-priority child status dot.
            Worktrees load lazily, so the worktree segment only shows once known (> 0)
            — a 0 would lie for never-visited projects. */}
        {effectiveCollapsed && (collapsedCount || rollupState) && (
          <span
            className="flex items-center gap-1.5 flex-shrink-0"
            title={`${chatCount} chat${chatCount === 1 ? '' : 's'}${
              worktrees.length > 0
                ? ` · ${worktrees.length} worktree${worktrees.length === 1 ? '' : 's'}`
                : ''
            }`}
          >
            {collapsedCount && (
              <span className="text-[11px] tabular-nums text-muted-foreground bg-muted rounded-full px-1.5 py-px">
                {collapsedCount}
              </span>
            )}
            {rollupState && (
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${rollupState === 'attention' ? 'attention-pulse' : ''}`}
                style={{ backgroundColor: `var(--status-${rollupState})` }}
              />
            )}
          </span>
        )}

        {/* Indicators */}
        {hasVertexConfig && (
          <span title="Vertex AI configured via .claude/settings.local.json">
            <Coins className="w-3 h-3 shrink-0 text-blue-400" />
          </span>
        )}
        {hasMismatch && (
          <span
            title={
              !project.settings?.profileId
                ? 'Auth mode is Profile but no profile selected'
                : 'Selected profile is missing or has no environment variables'
            }
          >
            <AlertTriangle className="w-3 h-3 shrink-0 text-yellow-500" />
          </span>
        )}

        {/* Actions — pin and remove live in the right-click menu to keep this row
            clean. Hidden (not just transparent) until hover so they reserve no
            width, letting the name run full-width. Kept compact (p-0.5) so they are
            no taller than the text line — appearing on hover then doesn't grow the
            row height, which would otherwise nudge the row's content down. */}
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal(project.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded hover:bg-border"
            title="New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {project.type === 'code' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCreateWorktree(project.id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-border"
              title="New Worktree"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded children: chats, worktrees and empty state */}
      {!effectiveCollapsed && (
        <>
          {/* Direct Chats (not in worktree) */}
          {directTerminals.length > 0 && (
            <ul className="ml-6 mt-1 space-y-0.5 border-l border-border/30">
              {directTerminals.map((terminal) => (
                <TerminalListItem
                  key={terminal.id}
                  terminal={terminal}
                  isActive={terminal.id === activeTerminalId}
                  onSelect={() => onSelectTerminal(terminal.id)}
                  onClose={(e) => onCloseTerminal(e, terminal.id)}
                  onSwitchAgent={(agent) => onSwitchAgent(terminal, agent)}
                />
              ))}
            </ul>
          )}

          {/* Worktrees. An inactive-section project has no running sessions, so the
              active/inactive split is meaningless — show all its worktrees inline.
              (This block only renders when expanded, which for an inactive project
              already implies it is selected.) Active/pinned projects show
              session-bearing worktrees inline and collapse session-less ones under a
              "Show inactive worktrees" toggle to keep the tree readable. */}
          {isInactive ? (
            worktrees.map(renderWorktree)
          ) : (
            <>
              {activeWorktrees.map(renderWorktree)}
              {inactiveWorktrees.length > 0 && (
                <>
                  <button
                    onClick={() => toggleInactiveWorktrees(project.id)}
                    aria-expanded={showInactiveWorktrees}
                    className="ml-6 flex items-center gap-1 pl-3 pr-3 py-1 w-full text-left text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={`w-3 h-3 transition-transform duration-150 ${showInactiveWorktrees ? 'rotate-90' : ''}`}
                    />
                    <span>
                      {showInactiveWorktrees
                        ? 'Hide inactive worktrees'
                        : `Show inactive worktrees (${inactiveWorktrees.length})`}
                    </span>
                  </button>
                  {showInactiveWorktrees && inactiveWorktrees.map(renderWorktree)}
                </>
              )}
            </>
          )}

          {/* Empty state for active project (code projects show when no terminals/worktrees, workspace/project when no terminals) */}
          {showEmptyState && (
            <div className="ml-6 pl-3 py-2 border-l border-border/30">
              <button
                onClick={() => onCreateTerminal(project.id)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" />
                New Chat
              </button>
            </div>
          )}
        </>
      )}
    </motion.li>
  )
})
