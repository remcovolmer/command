import { useMemo } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import { Terminal } from '../Terminal/Terminal'
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
    addTerminal,
    setActiveTerminal,
  } = useProjectStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectTerminals = Object.values(terminals).filter(
    (t) => t.projectId === activeProjectId
  )

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
      state: 'starting',
      lastActivity: Date.now(),
      title: `Terminal ${projectTerminals.length + 1}`,
    }
    addTerminal(terminal)
  }

  // No project selected - show Claude-style welcome
  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-claude-main-bg">
        <div className="text-center max-w-md mx-auto px-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Sparkles className="w-10 h-10 text-claude-accent-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-claude-main-text mb-3">
            Welcome to Command
          </h2>
          <p className="text-claude-main-muted mb-8">
            Select a project from the sidebar to start managing your Claude Code terminals.
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-main-surface border border-claude-main-border text-claude-main-muted text-sm">
              <TerminalIcon className="w-4 h-4" />
              Multi-terminal support
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-main-surface border border-claude-main-border text-claude-main-muted text-sm">
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
      <div className="flex flex-col items-center justify-center h-full bg-terminal-bg">
        <div className="text-center max-w-md mx-auto px-8">
          <div className="w-16 h-16 rounded-2xl bg-terminal-surface flex items-center justify-center mx-auto mb-6">
            <TerminalIcon className="w-8 h-8 text-claude-accent-primary" />
          </div>
          <h2 className="text-xl font-semibold text-terminal-text mb-2">
            {activeProject.name}
          </h2>
          <p className="text-terminal-muted mb-6">
            No terminals running. Start a new terminal to begin.
          </p>
          <button
            onClick={handleCreateTerminal}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-claude-accent-primary text-white rounded-xl font-medium hover:bg-claude-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Terminal
          </button>
        </div>
      </div>
    )
  }

  // Single terminal
  if (projectTerminals.length === 1) {
    return (
      <div className="h-full w-full relative">
        <TerminalPane
          terminal={projectTerminals[0]}
          isActive={projectTerminals[0].id === activeTerminalId}
          onSelect={() => setActiveTerminal(projectTerminals[0].id)}
          canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
          onAdd={handleCreateTerminal}
        />
      </div>
    )
  }

  // Multiple terminals with split view
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={`terminals-${activeProjectId}`}
    >
      {projectTerminals.map((terminal, index) => (
        <TerminalPanelWithHandle
          key={terminal.id}
          terminal={terminal}
          isActive={terminal.id === activeTerminalId}
          onSelect={() => setActiveTerminal(terminal.id)}
          isLast={index === projectTerminals.length - 1}
          canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
          onAdd={handleCreateTerminal}
        />
      ))}
    </PanelGroup>
  )
}

interface TerminalPanelWithHandleProps {
  terminal: TerminalSession
  isActive: boolean
  onSelect: () => void
  isLast: boolean
  canAdd: boolean
  onAdd: () => void
}

function TerminalPanelWithHandle({
  terminal,
  isActive,
  onSelect,
  isLast,
  canAdd,
  onAdd,
}: TerminalPanelWithHandleProps) {
  return (
    <>
      <Panel
        id={`terminal-${terminal.id}`}
        defaultSize={50}
        minSize={20}
      >
        <TerminalPane
          terminal={terminal}
          isActive={isActive}
          onSelect={onSelect}
          canAdd={canAdd && isLast}
          onAdd={onAdd}
        />
      </Panel>
      {!isLast && (
        <PanelResizeHandle className="w-1 bg-terminal-border hover:bg-claude-accent-primary transition-colors" />
      )}
    </>
  )
}

interface TerminalPaneProps {
  terminal: TerminalSession
  isActive: boolean
  onSelect: () => void
  canAdd: boolean
  onAdd: () => void
}

function TerminalPane({
  terminal,
  isActive,
  onSelect,
  canAdd,
  onAdd,
}: TerminalPaneProps) {
  const stateLabels = {
    starting: 'Starting...',
    running: 'Running',
    needs_input: 'Waiting for input',
    stopped: 'Stopped',
    error: 'Error',
  }

  const stateColors = {
    starting: 'text-terminal-warning',
    running: 'text-claude-info',
    needs_input: 'text-claude-accent-primary',
    stopped: 'text-terminal-muted',
    error: 'text-claude-error',
  }

  const stateDots = {
    starting: 'bg-terminal-warning',
    running: 'bg-claude-info',
    needs_input: 'bg-claude-accent-primary',
    stopped: 'bg-terminal-muted',
    error: 'bg-claude-error',
  }

  return (
    <div
      className={`h-full flex flex-col bg-terminal-bg ${
        isActive ? 'ring-2 ring-claude-accent-primary ring-inset' : ''
      }`}
      onClick={onSelect}
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-terminal-surface border-b border-terminal-border">
        <div className="flex items-center gap-3">
          <TerminalIcon className="w-4 h-4 text-terminal-muted" />
          <span className="text-sm font-medium text-terminal-text">{terminal.title}</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${stateDots[terminal.state]} ${terminal.state === 'needs_input' ? 'needs-input-indicator' : ''}`} />
            <span className={`text-xs ${stateColors[terminal.state]}`}>
              {stateLabels[terminal.state]}
            </span>
          </div>
        </div>

        {canAdd && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className="p-1.5 rounded-lg hover:bg-terminal-border transition-colors"
            title="Add Terminal"
          >
            <Plus className="w-4 h-4 text-terminal-muted" />
          </button>
        )}
      </div>

      {/* Terminal Content */}
      <div className="flex-1 overflow-hidden">
        <Terminal id={terminal.id} isActive={isActive} />
      </div>
    </div>
  )
}
