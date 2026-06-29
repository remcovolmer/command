import { lazy, Suspense } from 'react'
import { Terminal } from './Terminal'
import { EditorSkeleton } from '../Editor/EditorSkeleton'
import { useTerminalPool } from '../../hooks/useTerminalPool'
import type { TerminalSession, CenterTab, DiffTab, WorkingTreeDiffTab } from '../../types'

const EditorContainer = lazy(() =>
  import('../Editor/EditorContainer').then((m) => ({ default: m.EditorContainer }))
)
const DiffEditorView = lazy(() =>
  import('../Editor/DiffEditorView').then((m) => ({ default: m.DiffEditorView }))
)
const WorkingTreeDiffView = lazy(() =>
  import('../Editor/WorkingTreeDiffView').then((m) => ({ default: m.WorkingTreeDiffView }))
)

interface TerminalViewportProps {
  terminals: TerminalSession[]
  editorTabs: CenterTab[]
  activeTerminalId: string | null
  activeCenterTabId: string | null
}

export function TerminalViewport({
  terminals,
  editorTabs,
  activeTerminalId,
  activeCenterTabId,
}: TerminalViewportProps) {
  // Terminal LRU pool — manage eviction based on active terminal
  useTerminalPool(activeTerminalId)

  // Derive active type from the ID
  const isEditorActive =
    activeCenterTabId != null && editorTabs.some((t) => t.id === activeCenterTabId)
  const effectiveTerminalId = isEditorActive ? null : (activeCenterTabId ?? activeTerminalId)

  const hasContent = terminals.length > 0 || editorTabs.length > 0

  if (!hasContent) {
    return null
  }

  return (
    <div className="h-full w-full relative">
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
          {editorTabs.map((tab) =>
            tab.type === 'diff' ? (
              <DiffEditorView
                key={tab.id}
                tab={tab as DiffTab}
                isActive={isEditorActive && tab.id === activeCenterTabId}
              />
            ) : tab.type === 'working-tree-diff' ? (
              <WorkingTreeDiffView
                key={tab.id}
                tab={tab as WorkingTreeDiffTab}
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
          )}
        </Suspense>
      )}
    </div>
  )
}
