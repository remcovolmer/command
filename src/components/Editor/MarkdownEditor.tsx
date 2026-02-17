import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
import type { FileWatchEvent } from '../../types'

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
  isActive: boolean
  savedContentRef: React.MutableRefObject<string>
  currentContentRef: React.MutableRefObject<string>
}

function EditorControls({ tabId, filePath, isActive, savedContentRef, currentContentRef }: EditorControlsProps) {
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

  // Listen for global editor-save-request event (from hotkey system)
  useEffect(() => {
    if (!isActive) return
    const handler = () => handleSave()
    window.addEventListener('editor-save-request', handler)
    return () => window.removeEventListener('editor-save-request', handler)
  }, [isActive, handleSave])

  // Handle keyboard shortcut
  useEffect(() => {
    if (!isActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isActive, handleSave])

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
  const setEditorTabDeletedExternally = useProjectStore((s) => s.setEditorTabDeletedExternally)
  const isDeletedExternally = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? tab.isDeletedExternally ?? false : false
  })
  const projectId = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? tab.projectId : null
  })

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const currentContentRef = useRef<string>('')
  const lastDirtyRef = useRef<boolean>(false)
  const isDeletedRef = useRef(isDeletedExternally)
  isDeletedRef.current = isDeletedExternally
  const readSeqRef = useRef(0)
  const normalizedPath = useMemo(() => normalizeFilePath(filePath), [filePath])

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

  // Centralized file watcher for live updates
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const reloadFile = () => {
      const seq = ++readSeqRef.current
      api.fs.readFile(filePath).then((text) => {
        if (cancelled || seq !== readSeqRef.current) return
        const replace = (window as unknown as { __milkdownReplace?: (content: string) => void }).__milkdownReplace
        if (replace) {
          replace(text)
        } else {
          setContent(text)
          savedContentRef.current = text
          currentContentRef.current = text
        }
        lastDirtyRef.current = false
        setEditorDirty(tabId, false)
        setEditorTabDeletedExternally(tabId, false)
      }).catch((err) => {
        if (!cancelled) console.error('Failed to reload file:', err)
      })
    }

    const subscriberKey = `markdown-editor-${tabId}`

    const handleWatchEvents = (events: FileWatchEvent[]) => {
      // Deduplicate: find the last relevant event for this file
      let lastEvent: FileWatchEvent | null = null
      for (const event of events) {
        if (event.path === normalizedPath) {
          lastEvent = event
        }
      }
      if (!lastEvent) return

      if (lastEvent.type === 'file-changed') {
        reloadFile()
      } else if (lastEvent.type === 'file-removed') {
        setEditorTabDeletedExternally(tabId, true)
      } else if (lastEvent.type === 'file-added') {
        if (isDeletedRef.current) {
          setEditorTabDeletedExternally(tabId, false)
          reloadFile()
        }
      }
    }

    fileWatcherEvents.subscribe(projectId, subscriberKey, handleWatchEvents)
    return () => {
      cancelled = true
      fileWatcherEvents.unsubscribe(projectId, subscriberKey)
    }
  }, [projectId, tabId, filePath, normalizedPath, api, setEditorDirty, setEditorTabDeletedExternally])

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
      {isDeletedExternally && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>This file has been deleted. Save to recreate it.</span>
        </div>
      )}
      <MilkdownProvider>
        <EditorControls
          tabId={tabId}
          filePath={filePath}
          isActive={isActive}
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
