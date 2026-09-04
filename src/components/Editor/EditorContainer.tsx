import { useState, lazy, Suspense } from 'react'
import { Code, Eye } from 'lucide-react'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { getCssVar } from '../../utils/terminalTheme'
import { CodeEditor } from './CodeEditor'
import { EditorSkeleton } from './EditorSkeleton'

// Configure Monaco to use local package instead of CDN
// This runs when this chunk loads, before any <Editor> mounts
loader.config({ monaco })

/**
 * Register (or re-register) the Command Monaco theme matching the given app
 * theme. Reads current token values via getCssVar — since these resolve
 * live CSS variables, this must be called again whenever the app theme
 * changes (the .dark class flips before resolvedTheme propagates, see
 * useThemeResolver) so the newly active surface colors get picked up.
 * monaco.editor.defineTheme is safe to call repeatedly with the same name.
 */
export function defineCommandMonacoTheme(resolvedTheme: 'light' | 'dark') {
  const name = resolvedTheme === 'dark' ? 'command-dark' : 'command-light'
  const base = resolvedTheme === 'dark' ? 'vs-dark' : 'vs'
  const borderStrong = getCssVar('--border-strong')

  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [],
    colors: {
      'editor.background': getCssVar('--screen'),
      'editor.foreground': getCssVar('--fg'),
      'editorLineNumber.foreground': getCssVar('--fg-faint'),
      'editorLineNumber.activeForeground': getCssVar('--fg-muted'),
      'editor.lineHighlightBackground': getCssVar('--raised'),
      'editor.selectionBackground': getCssVar('--terminal-selection'),
      'editorGutter.background': getCssVar('--screen'),
      'editorWidget.background': getCssVar('--popover'),
      'editorWidget.border': getCssVar('--border'),
      'scrollbarSlider.background': `${borderStrong}66`,
      'scrollbarSlider.hoverBackground': `${borderStrong}99`,
      'scrollbarSlider.activeBackground': `${borderStrong}bf`,
      'editorIndentGuide.background1': getCssVar('--border'),
      focusBorder: getCssVar('--primary'),
    },
  })
}

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))
)

interface EditorContainerProps {
  tabId: string
  filePath: string
  isActive: boolean
}

/**
 * Router component that chooses the appropriate editor based on file type.
 * - Markdown files (.md) can toggle between Milkdown (WYSIWYG) and Monaco (raw)
 * - All other files use the Monaco code editor
 *
 * HTML files open in the built-in browser (<webview>), not here. They only
 * reach this editor via the file explorer's "Open als code" action, which
 * shows the raw Monaco source like any other code file.
 */
export function EditorContainer({ tabId, filePath, isActive }: EditorContainerProps) {
  const lowerPath = filePath.toLowerCase()
  const isMarkdown = lowerPath.endsWith('.md')
  const [useWysiwyg, setUseWysiwyg] = useState(true)

  // Non-markdown files always use Monaco (this includes HTML opened as code).
  if (!isMarkdown) {
    return <CodeEditor tabId={tabId} filePath={filePath} isActive={isActive} />
  }

  // Markdown files can toggle between editors
  return (
    <div
      style={{
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
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

      {/* Editor area — both panes stay mounted inside MarkdownEditor; mode
          toggles which is visible so scroll position and unsaved edits survive
          a raw/preview switch. */}
      <div className="flex-1 min-h-0">
        <Suspense fallback={<EditorSkeleton />}>
          <MarkdownEditor
            tabId={tabId}
            filePath={filePath}
            isActive={isActive}
            mode={useWysiwyg ? 'preview' : 'raw'}
          />
        </Suspense>
      </div>
    </div>
  )
}
