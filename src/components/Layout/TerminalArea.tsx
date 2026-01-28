import { useMemo, useCallback } from 'react'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import { TerminalTabBar } from '../Terminal/TerminalTabBar'
import { TerminalViewport } from '../Terminal/TerminalViewport'
import { TerminalIcon, Plus, Sparkles } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import type { TerminalSession } from '../../types'

export function TerminalArea() {
  const api = useMemo(() => getElectronAPI(), [])
  const {
    activeProjectId,
    activeTerminalId,
    terminals,
    projects,
    layouts,
    addTerminal,
    setActiveTerminal,
    removeTerminal,
    addToSplit,
    removeFromSplit,
    setSplitSizes,
  } = useProjectStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectTerminals = Object.values(terminals).filter(
    (t) => t.projectId === activeProjectId
  )

  // Get current layout for the project
  const currentLayout = activeProjectId ? layouts[activeProjectId] : null
  const splitTerminalIds = currentLayout?.splitTerminalIds ?? []

  const handleCreateTerminal = async () => {
    if (!activeProjectId) return

    // Check terminal limit
    if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
      api.notification.show(
        'Terminal Limit',
        `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project`
      )
      return
    }

    const terminalId = await api.terminal.create(activeProjectId)
    const terminal: TerminalSession = {
      id: terminalId,
      projectId: activeProjectId,
      worktreeId: null,
      state: 'busy',
      lastActivity: Date.now(),
      title: `Terminal ${projectTerminals.length + 1}`,
      type: 'claude',
    }
    addTerminal(terminal)
  }

  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      api.terminal.close(terminalId)
      removeTerminal(terminalId)
    },
    [api, removeTerminal]
  )

  const handleUnsplit = useCallback(
    (terminalId: string) => {
      if (!activeProjectId) return
      removeFromSplit(activeProjectId, terminalId)
    },
    [activeProjectId, removeFromSplit]
  )

  const handleDropToSplit = useCallback(
    (terminalId: string, position: 'left' | 'right') => {
      if (!activeProjectId) return

      // If there's already a split, just add to it
      if (splitTerminalIds.length >= 2) {
        addToSplit(activeProjectId, terminalId)
        return
      }

      // Find a terminal to pair with (either the active one, or another one)
      let pairTerminalId: string | null = null

      if (activeTerminalId && activeTerminalId !== terminalId) {
        // Use the active terminal as pair
        pairTerminalId = activeTerminalId
      } else {
        // Active terminal is being dragged, find another terminal to pair with
        const otherTerminal = projectTerminals.find(t => t.id !== terminalId)
        pairTerminalId = otherTerminal?.id ?? null
      }

      // Create new split with the dragged terminal and the pair
      if (pairTerminalId) {
        if (position === 'left') {
          addToSplit(activeProjectId, terminalId)
          addToSplit(activeProjectId, pairTerminalId)
        } else {
          addToSplit(activeProjectId, pairTerminalId)
          addToSplit(activeProjectId, terminalId)
        }
      }
    },
    [activeProjectId, activeTerminalId, projectTerminals, splitTerminalIds.length, addToSplit]
  )

  const handleSplitSizesChange = useCallback(
    (sizes: number[]) => {
      if (activeProjectId) {
        setSplitSizes(activeProjectId, sizes)
      }
    },
    [activeProjectId, setSplitSizes]
  )

  // No project selected - show welcome
  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background">
        <div className="text-center max-w-md mx-auto px-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Sparkles className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            Welcome to Command
          </h2>
          <p className="text-muted-foreground mb-8">
            Select a project from the sidebar to start managing your Claude Code terminals.
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-muted-foreground text-sm">
              <TerminalIcon className="w-4 h-4" />
              Multi-terminal support
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-muted-foreground text-sm">
              <Plus className="w-4 h-4" />
              Up to {MAX_TERMINALS_PER_PROJECT} per project
            </div>
          </div>
        </div>
      </div>
    )
  }

  // No terminals in project
  if (projectTerminals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-sidebar">
        <div className="text-center max-w-md mx-auto px-8">
          <div className="w-16 h-16 rounded-2xl bg-sidebar-accent flex items-center justify-center mx-auto mb-6">
            <TerminalIcon className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-sidebar-foreground mb-2">
            {activeProject.name}
          </h2>
          <p className="text-muted-foreground mb-6">
            No terminals running. Start a new terminal to begin.
          </p>
          <button
            onClick={handleCreateTerminal}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Terminal
          </button>
        </div>
      </div>
    )
  }

  // Terminals with tab bar
  return (
    <div className="h-full w-full flex flex-col bg-sidebar">
      <TerminalTabBar
        terminals={projectTerminals}
        activeTerminalId={activeTerminalId}
        splitTerminalIds={splitTerminalIds}
        onSelect={setActiveTerminal}
        onClose={handleCloseTerminal}
        onUnsplit={handleUnsplit}
        onAdd={handleCreateTerminal}
        canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
      />
      <div className="flex-1 overflow-hidden">
        <TerminalViewport
          terminals={projectTerminals}
          activeTerminalId={activeTerminalId}
          splitTerminalIds={splitTerminalIds}
          projectId={activeProjectId!}
          onSplitSizesChange={handleSplitSizesChange}
          onDropToSplit={handleDropToSplit}
          onSelect={setActiveTerminal}
        />
      </div>
    </div>
  )
}
