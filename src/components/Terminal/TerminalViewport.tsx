import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Terminal } from './Terminal'
import { EditorSkeleton } from '../Editor/EditorSkeleton'
import type { TerminalSession, CenterTab, DiffTab } from '../../types'

const EditorContainer = lazy(() =>
  import('../Editor/EditorContainer').then(m => ({ default: m.EditorContainer }))
)
const DiffEditorView = lazy(() =>
  import('../Editor/DiffEditorView').then(m => ({ default: m.DiffEditorView }))
)

interface TerminalViewportProps {
  terminals: TerminalSession[]
  editorTabs: CenterTab[]
  activeTerminalId: string | null
  activeCenterTabId: string | null
  splitTerminalIds: string[]
  projectId: string
  onSplitSizesChange: (sizes: number[]) => void
  onDropToSplit: (terminalId: string, position: 'left' | 'right') => void
  onSelect: (terminalId: string) => void
}

export function TerminalViewport({
  terminals,
  editorTabs,
  activeTerminalId,
  activeCenterTabId,
  splitTerminalIds,
  projectId,
  onSplitSizesChange,
  onDropToSplit,
  onSelect,
}: TerminalViewportProps) {
  const [dragOver, setDragOver] = useState<'left' | 'right' | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Listen for drag events on the document to show drop zones
  useEffect(() => {
    const handleDragStart = () => {
      setIsDragging(true)
    }

    const handleDragEnd = () => {
      setIsDragging(false)
      setDragOver(null)
    }

    document.addEventListener('dragstart', handleDragStart)
    document.addEventListener('dragend', handleDragEnd)
    document.addEventListener('drop', handleDragEnd)

    return () => {
      document.removeEventListener('dragstart', handleDragStart)
      document.removeEventListener('dragend', handleDragEnd)
      document.removeEventListener('drop', handleDragEnd)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, position: 'left' | 'right') => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(position)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, position: 'left' | 'right') => {
      e.preventDefault()
      const terminalId = e.dataTransfer.getData('terminalId')
      if (terminalId) {
        onDropToSplit(terminalId, position)
      }
      setDragOver(null)
      setIsDragging(false)
    },
    [onDropToSplit]
  )

  // Get terminals that are in the split
  const splitTerminals = splitTerminalIds
    .map((id) => terminals.find((t) => t.id === id))
    .filter((t): t is TerminalSession => t !== undefined)

  // If we have a split view with 2+ terminals
  if (splitTerminals.length >= 2) {
    return (
      <div
        className="h-full w-full relative"
        onDragOver={(e) => e.preventDefault()}
      >
        <PanelGroup
          direction="horizontal"
          autoSaveId={`split-${projectId}`}
          onLayout={(sizes) => onSplitSizesChange(sizes)}
        >
          {splitTerminals.map((terminal, index) => (
            <SplitPanel
              key={terminal.id}
              terminal={terminal}
              isActive={terminal.id === activeTerminalId}
              isLast={index === splitTerminals.length - 1}
              onSelect={() => onSelect(terminal.id)}
            />
          ))}
        </PanelGroup>

        {/* Drop zones for adding more to split */}
        {isDragging && splitTerminals.length < 3 && (
          <>
            <DropZone
              position="left"
              isActive={dragOver === 'left'}
              onDragOver={(e) => handleDragOver(e, 'left')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'left')}
            />
            <DropZone
              position="right"
              isActive={dragOver === 'right'}
              onDragOver={(e) => handleDragOver(e, 'right')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'right')}
            />
          </>
        )}
      </div>
    )
  }

  // Derive active type from the ID
  const isEditorActive = activeCenterTabId != null && editorTabs.some((t) => t.id === activeCenterTabId)
  const effectiveTerminalId = isEditorActive ? null : (activeCenterTabId ?? activeTerminalId)

  // Single terminal view (active terminal from tabs)
  const hasContent = terminals.length > 0 || editorTabs.length > 0

  if (!hasContent) {
    return null
  }

  return (
    <div
      className="h-full w-full relative"
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="h-full w-full">
        {/* Render all terminals (hidden if not active) */}
        {terminals.map((terminal) => (
          <Terminal
            key={terminal.id}
            id={terminal.id}
            isActive={!isEditorActive && terminal.id === effectiveTerminalId}
          />
        ))}

        {/* Render all editor/diff tabs (hidden if not active, lazy-loaded) */}
        {editorTabs.length > 0 && (
          <Suspense fallback={<EditorSkeleton />}>
            {editorTabs.map((tab) => (
              tab.type === 'diff' ? (
                <DiffEditorView
                  key={tab.id}
                  tab={tab as DiffTab}
                  isActive={isEditorActive && tab.id === activeCenterTabId}
                />
              ) : (
                <EditorContainer
                  key={tab.id}
                  tabId={tab.id}
                  filePath={tab.filePath}
                  isActive={isEditorActive && tab.id === activeCenterTabId}
                />
              )
            ))}
          </Suspense>
        )}
      </div>

      {/* Drop zones for creating split - only show if there are 2+ terminals */}
      {isDragging && terminals.length >= 2 && (
        <>
          <DropZone
            position="left"
            isActive={dragOver === 'left'}
            onDragOver={(e) => handleDragOver(e, 'left')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'left')}
          />
          <DropZone
            position="right"
            isActive={dragOver === 'right'}
            onDragOver={(e) => handleDragOver(e, 'right')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'right')}
          />
        </>
      )}
    </div>
  )
}

interface SplitPanelProps {
  terminal: TerminalSession
  isActive: boolean
  isLast: boolean
  onSelect: () => void
}

function SplitPanel({ terminal, isActive, isLast, onSelect }: SplitPanelProps) {
  return (
    <>
      <Panel id={`split-${terminal.id}`} defaultSize={50} minSize={20}>
        <div
          className={`h-full ${isActive ? 'ring-2 ring-primary ring-inset' : ''}`}
          onClick={onSelect}
        >
          <Terminal id={terminal.id} isActive={isActive} />
        </div>
      </Panel>
      {!isLast && (
        <PanelResizeHandle className="w-1 transition-colors" />
      )}
    </>
  )
}

interface DropZoneProps {
  position: 'left' | 'right'
  isActive: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}

function DropZone({ position, isActive, onDragOver, onDragLeave, onDrop }: DropZoneProps) {
  return (
    <div
      className={`
        absolute top-0 ${position === 'left' ? 'left-0' : 'right-0'}
        w-24 h-full z-50
        flex items-center ${position === 'left' ? 'justify-start pl-2' : 'justify-end pr-2'}
        pointer-events-auto
        transition-all duration-200
        ${isActive ? 'bg-primary/30' : 'bg-transparent'}
      `}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`
          w-1 h-[80%] rounded-full
          transition-all duration-200
          ${isActive ? 'bg-primary' : 'bg-border/50'}
        `}
      />
    </div>
  )
}
