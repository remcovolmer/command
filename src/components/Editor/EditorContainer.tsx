import { CodeEditor } from './CodeEditor'
import { MarkdownEditor } from './MarkdownEditor'

interface EditorContainerProps {
  tabId: string
  filePath: string
  isActive: boolean
}

/**
 * Router component that chooses the appropriate editor based on file type.
 * - Markdown files (.md) use Milkdown WYSIWYG editor
 * - All other files use Monaco code editor
 */
export function EditorContainer({ tabId, filePath, isActive }: EditorContainerProps) {
  const isMarkdown = filePath.toLowerCase().endsWith('.md')

  if (isMarkdown) {
    return (
      <MarkdownEditor
        tabId={tabId}
        filePath={filePath}
        isActive={isActive}
      />
    )
  }

  return (
    <CodeEditor
      tabId={tabId}
      filePath={filePath}
      isActive={isActive}
    />
  )
}
