import { useState, useEffect, useRef, useCallback } from 'react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { indent } from '@milkdown/plugin-indent'
import { cursor } from '@milkdown/plugin-cursor'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { getMarkdown, replaceAll } from '@milkdown/utils'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface MarkdownEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
}

interface MilkdownEditorInnerProps {
  defaultValue: string
  onContentChange: (markdown: string) => void
}

function MilkdownEditorInner({ defaultValue, onContentChange }: MilkdownEditorInnerProps) {
  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, defaultValue)
      })
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onContentChange(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(indent)
      .use(cursor)
      .use(listener)
  }, [defaultValue])

  return (
    <div className="milkdown-wrapper h-full w-full overflow-auto bg-background">
      <Milkdown />
    </div>
  )
}

interface EditorControlsProps {
  tabId: string
  filePath: string
  savedContentRef: React.MutableRefObject<string>
  currentContentRef: React.MutableRefObject<string>
}

function EditorControls({ tabId, filePath, savedContentRef, currentContentRef }: EditorControlsProps) {
  const api = getElectronAPI()
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)
  const [loading, getEditor] = useInstance()

  const handleSave = useCallback(async () => {
    const editor = getEditor()
    if (editor && !loading) {
      const markdown = editor.action(getMarkdown())
      try {
        await api.fs.writeFile(filePath, markdown)
        savedContentRef.current = markdown
        setEditorDirty(tabId, false)
      } catch (err) {
        console.error('Failed to save file:', err)
      }
    }
  }, [getEditor, loading, api, filePath, tabId, setEditorDirty, savedContentRef])

  // Handle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  // Expose replaceAll for file watching updates
  useEffect(() => {
    const editor = getEditor()
    if (editor && !loading) {
      // Store reference to allow external content updates
      ;(window as unknown as { __milkdownReplace?: (content: string) => void }).__milkdownReplace = (content: string) => {
        editor.action(replaceAll(content))
        savedContentRef.current = content
        currentContentRef.current = content
      }
    }
    return () => {
      delete (window as unknown as { __milkdownReplace?: (content: string) => void }).__milkdownReplace
    }
  }, [getEditor, loading, savedContentRef, currentContentRef])

  return null
}

export function MarkdownEditor({ tabId, filePath, isActive }: MarkdownEditorProps) {
  const api = getElectronAPI()
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const currentContentRef = useRef<string>('')
  const lastDirtyRef = useRef<boolean>(false)

  // Load file
  useEffect(() => {
    let cancelled = false
    setError(null)

    const timeoutId = setTimeout(() => {
      if (!cancelled && content === null) {
        setError('Loading timed out')
      }
    }, 10000)

    api.fs.readFile(filePath)
      .then((text) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setContent(text)
        savedContentRef.current = text
        currentContentRef.current = text
      })
      .catch((err) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setError(err?.message ?? 'Failed to read file')
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [filePath, api])

  // File watching for live updates
  useEffect(() => {
    api.fs.watchFile(filePath)

    const unsubscribe = api.fs.onFileChanged((changedPath) => {
      if (changedPath === filePath && !lastDirtyRef.current) {
        // Reload content if no unsaved changes
        api.fs.readFile(filePath).then((text) => {
          // Use the Milkdown replaceAll if available
          const replace = (window as unknown as { __milkdownReplace?: (content: string) => void }).__milkdownReplace
          if (replace) {
            replace(text)
          } else {
            // Fallback: reset the component
            setContent(text)
            savedContentRef.current = text
            currentContentRef.current = text
          }
        }).catch((err) => {
          console.error('Failed to reload file:', err)
        })
      }
    })

    return () => {
      api.fs.unwatchFile(filePath)
      unsubscribe()
    }
  }, [filePath, api])

  const handleContentChange = useCallback((markdown: string) => {
    currentContentRef.current = markdown
    const dirty = markdown !== savedContentRef.current
    if (dirty !== lastDirtyRef.current) {
      lastDirtyRef.current = dirty
      setEditorDirty(tabId, dirty)
    }
  }, [tabId, setEditorDirty])

  if (error) {
    return (
      <div
        className="h-full w-full flex items-center justify-center text-destructive"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <p>Error: {error}</p>
      </div>
    )
  }

  if (content === null) {
    return (
      <div
        className="h-full w-full flex items-center justify-center text-muted-foreground"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div style={{ display: isActive ? 'block' : 'none', height: '100%', width: '100%' }}>
      <MilkdownProvider>
        <EditorControls
          tabId={tabId}
          filePath={filePath}
          savedContentRef={savedContentRef}
          currentContentRef={currentContentRef}
        />
        <MilkdownEditorInner
          defaultValue={content}
          onContentChange={handleContentChange}
        />
      </MilkdownProvider>
    </div>
  )
}
