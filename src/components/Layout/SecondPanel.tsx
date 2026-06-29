import { lazy, Suspense } from 'react'
import { ContentTabBar } from './ContentTabBar'
import { EditorSkeleton } from '../Editor/EditorSkeleton'
import type { CenterTab, DiffTab, WorkingTreeDiffTab } from '../../types'

const EditorContainer = lazy(() =>
  import('../Editor/EditorContainer').then((m) => ({ default: m.EditorContainer }))
)
const DiffEditorView = lazy(() =>
  import('../Editor/DiffEditorView').then((m) => ({ default: m.DiffEditorView }))
)
const WorkingTreeDiffView = lazy(() =>
  import('../Editor/WorkingTreeDiffView').then((m) => ({ default: m.WorkingTreeDiffView }))
)

interface SecondPanelProps {
  tabs: CenterTab[]
  activeContentId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
}

/**
 * The per-chat second panel: hosts the active chat's opened files (editors/diffs)
 * as content tabs. All tabs stay mounted; the active one is shown via each editor's
 * isActive prop (visibility-based, never display:none — keeps xterm/Monaco geometry valid).
 */
export function SecondPanel({ tabs, activeContentId, onSelect, onClose }: SecondPanelProps) {
  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="h-full w-full flex flex-col bg-sidebar">
      <ContentTabBar
        tabs={tabs}
        activeContentId={activeContentId}
        onSelect={onSelect}
        onClose={onClose}
      />
      <div className="flex-1 min-h-0 relative">
        <Suspense fallback={<EditorSkeleton />}>
          {tabs.map((tab) =>
            tab.type === 'diff' ? (
              <DiffEditorView
                key={tab.id}
                tab={tab as DiffTab}
                isActive={tab.id === activeContentId}
              />
            ) : tab.type === 'working-tree-diff' ? (
              <WorkingTreeDiffView
                key={tab.id}
                tab={tab as WorkingTreeDiffTab}
                isActive={tab.id === activeContentId}
              />
            ) : (
              <EditorContainer
                key={tab.id}
                tabId={tab.id}
                filePath={tab.filePath}
                isActive={tab.id === activeContentId}
              />
            )
          )}
        </Suspense>
      </div>
    </div>
  )
}
