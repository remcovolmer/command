import { useState, lazy, Suspense } from 'react'
import { Code, Eye } from 'lucide-react'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { CodeEditor } from './CodeEditor'
import { EditorSkeleton } from './EditorSkeleton'

// Configure Monaco to use local package instead of CDN
// This runs when this chunk loads, before any <Editor> mounts
loader.config({ monaco })

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor }))
)

interface EditorContainerProps {
  tabId: string
  filePath: string
  isActive: boolean
}

/**
 * Router component that chooses the appropriate editor based on file type.
 * - Markdown files (.md) can toggle between Milkdown (WYSIWYG) and Monaco (raw)
 * - All other files use Monaco code editor
 */
export function EditorContainer({ tabId, filePath, isActive }: EditorContainerProps) {
  const isMarkdown = filePath.toLowerCase().endsWith('.md')
  const [useWysiwyg, setUseWysiwyg] = useState(true)

  // Non-markdown files always use Monaco
  if (!isMarkdown) {
    return (
      <CodeEditor
        tabId={tabId}
        filePath={filePath}
        isActive={isActive}
      />
    )
  }

  // Markdown files can toggle between editors
  return (
    <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Toggle button */}
      <div className="flex items-center justify-end px-2 py-1 border-b border-border bg-background">
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setUseWysiwyg(false)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
              !useWysiwyg
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Raw Markdown (Monaco)"
          >
            <Code size={14} />
            <span>Raw</span>
          </button>
          <button
            onClick={() => setUseWysiwyg(true)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
              useWysiwyg
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Preview (WYSIWYG)"
          >
            <Eye size={14} />
            <span>Preview</span>
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0">
        {useWysiwyg ? (
          <Suspense fallback={<EditorSkeleton />}>
            <MarkdownEditor
              tabId={tabId}
              filePath={filePath}
              isActive={isActive}
            />
          </Suspense>
        ) : (
          <CodeEditor
            tabId={tabId}
            filePath={filePath}
            isActive={isActive}
          />
        )}
      </div>
    </div>
  )
}
