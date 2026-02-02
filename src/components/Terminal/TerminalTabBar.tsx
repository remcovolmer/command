import { TerminalIcon, Plus, X, LayoutGrid, FileText, Circle } from 'lucide-react'
import type { TerminalSession, TerminalState, EditorTab } from '../../types'

interface TerminalTabBarProps {
  terminals: TerminalSession[]
  editorTabs: EditorTab[]
  activeTerminalId: string | null
  activeCenterTabId: string | null
  activeCenterTabType: 'terminal' | 'editor' | null
  splitTerminalIds: string[]
  onSelectTerminal: (terminalId: string) => void
  onSelectEditor: (tabId: string) => void
  onClose: (terminalId: string) => void
  onCloseEditor: (tabId: string) => void
  onUnsplit: (terminalId: string) => void
  onAdd: () => void
  canAdd: boolean
}

// Claude Code state dot colors (5 states)
const stateDots: Record<TerminalState, string> = {
  busy: 'bg-blue-500',       // Blue - working
  permission: 'bg-orange-500', // Orange - needs permission
  question: 'bg-orange-500', // Orange - waiting for question answer
  done: 'bg-green-500',      // Green - finished, waiting for new prompt
  stopped: 'bg-red-500',     // Red - stopped/error
}

// States that require user input (show blinking indicator)
const inputStates = ['done', 'permission', 'question'] as const
const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

export function TerminalTabBar({
  terminals,
  editorTabs,
  activeTerminalId,
  activeCenterTabId,
  activeCenterTabType,
  splitTerminalIds,
  onSelectTerminal,
  onSelectEditor,
  onClose,
  onCloseEditor,
  onUnsplit,
  onAdd,
  canAdd,
}: TerminalTabBarProps) {
  const handleDragStart = (e: React.DragEvent, terminalId: string) => {
    e.dataTransfer.setData('terminalId', terminalId)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="flex items-center gap-1 px-3 py-1 bg-sidebar-accent border-b border-border overflow-x-auto">
      {/* Terminal tabs */}
      {terminals.map((terminal) => {
        const isActive = activeCenterTabType === 'terminal' && terminal.id === (activeCenterTabId ?? activeTerminalId)
        const isInSplit = splitTerminalIds.includes(terminal.id)

        return (
          <div
            key={terminal.id}
            draggable
            onDragStart={(e) => handleDragStart(e, terminal.id)}
            onClick={() => onSelectTerminal(terminal.id)}
            className={`
              group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer
              transition-colors select-none
              ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
              }
            `}
          >
            <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm font-medium whitespace-nowrap">
              {terminal.title}
            </span>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${stateDots[terminal.state]} ${
                isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
              }`}
            />
            {isInSplit && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUnsplit(terminal.id)
                }}
                className="p-0.5 rounded hover:bg-border transition-all"
                title="Remove from split"
              >
                <LayoutGrid className="w-3 h-3 text-primary" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(terminal.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}

      {/* Separator between terminal and editor tabs */}
      {terminals.length > 0 && editorTabs.length > 0 && (
        <div className="w-px h-5 bg-border mx-1" />
      )}

      {/* Editor tabs */}
      {editorTabs.map((tab) => {
        const isActive = activeCenterTabType === 'editor' && tab.id === activeCenterTabId

        return (
          <div
            key={tab.id}
            onClick={() => onSelectEditor(tab.id)}
            className={`
              group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer
              transition-colors select-none
              ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
              }
            `}
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm font-medium whitespace-nowrap">
              {tab.fileName}
            </span>
            {tab.isDirty && (
              <Circle className="w-2 h-2 flex-shrink-0 fill-current text-orange-400" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCloseEditor(tab.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}

      {canAdd && (
        <button
          onClick={onAdd}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 transition-colors"
          title="New Terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
