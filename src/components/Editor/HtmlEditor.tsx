import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath, getParentPath } from '../../utils/paths'
import type { FileWatchEvent } from '../../types'
import { HtmlPreview } from './HtmlPreview'

const PREVIEW_DEBOUNCE_MS = 300

interface HtmlEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
  mode: 'preview' | 'raw'
}

/**
 * State owner for HTML editor tabs. Mounts Monaco for Raw mode and HtmlPreview
 * for Preview mode at the same time (both stay in the DOM, visibility is
 * toggled via CSS) so Monaco's undo history survives mode switches.
 *
 * Lifecycle mirrors MarkdownEditor: load via api.fs.readFile, subscribe to
 * the file watcher for external edits, track dirty state in projectStore,
 * and handle Ctrl+S both via the global editor-save-request event and a
 * backup keydown listener.
 */
export function HtmlEditor({ tabId, filePath, isActive, mode }: HtmlEditorProps) {
  const api = getElectronAPI()
  const resolvedTheme = useProjectStore((s) => s.resolvedTheme)
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)
  const setEditorTabDeletedExternally = useProjectStore((s) => s.setEditorTabDeletedExternally)
  const isDeletedExternally = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? (tab.isDeletedExternally ?? false) : false
  })
  const projectId = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? tab.projectId : null
  })

  const [content, setContent] = useState<string | null>(null)
  const [debouncedContent, setDebouncedContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const lastDirtyRef = useRef<boolean>(false)
  const isDeletedRef = useRef(isDeletedExternally)
  isDeletedRef.current = isDeletedExternally
  const readSeqRef = useRef(0)
  // Timestamp of the last local writeFile. Used to suppress the chokidar echo
  // (file-changed fires shortly after our own save) so a watcher reload reading
  // pre-save content cannot stomp the editor with stale text.
  const pendingSelfWriteAtRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const normalizedPath = useMemo(() => normalizeFilePath(filePath), [filePath])
  const fileDir = useMemo(() => getParentPath(filePath), [filePath])

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  // Cancel any pending debounce on unmount or when filePath changes — without
  // the filePath dep, a stale setDebouncedContent from the previous file could
  // flash into the preview just after the new file loads.
  useEffect(() => () => cancelDebounce(), [filePath, cancelDebounce])

  // Load file
  useEffect(() => {
    let cancelled = false
    setError(null)

    const timeoutId = setTimeout(() => {
      if (!cancelled && content === null) {
        setError('Loading timed out')
      }
    }, 10000)

    api.fs
      .readFile(filePath)
      .then((text) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setContent(text)
        setDebouncedContent(text)
        savedContentRef.current = text
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

  // File watcher: external edits refresh both buffer and preview together so
  // the user never sees the preview lag behind the on-disk state when Claude
  // (or anything else) modifies the file.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const reloadFile = () => {
      const seq = ++readSeqRef.current
      api.fs
        .readFile(filePath)
        .then((text) => {
          if (cancelled || seq !== readSeqRef.current) return

          // Suppress the chokidar echo of our own save: disk matches what we
          // just wrote and the event arrived within the watcher batch window.
          if (
            text === savedContentRef.current &&
            Date.now() - pendingSelfWriteAtRef.current < 1000
          ) {
            return
          }

          // Don't clobber unsaved user edits. If the buffer is dirty AND disk
          // content actually differs from the last save, keep the user's work
          // and surface a console warning so the divergence is diagnosable.
          // (When disk matches savedContentRef, the watcher echo is harmless
          // and falls through to a no-op-ish refresh.)
          if (lastDirtyRef.current && text !== savedContentRef.current) {
            console.warn('External change to', filePath, 'ignored — buffer has unsaved edits')
            return
          }

          cancelDebounce()
          const ed = editorRef.current
          if (ed) {
            const position = ed.getPosition()
            ed.setValue(text)
            if (position) ed.setPosition(position)
          }
          setContent(text)
          setDebouncedContent(text)
          savedContentRef.current = text
          lastDirtyRef.current = false
          setEditorDirty(tabId, false)
          setEditorTabDeletedExternally(tabId, false)
        })
        .catch((err) => {
          if (!cancelled) console.error('Failed to reload HTML file:', err)
        })
    }

    const subscriberKey = `html-editor-${tabId}`

    const handleWatchEvents = (events: FileWatchEvent[]) => {
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
  }, [
    projectId,
    tabId,
    filePath,
    normalizedPath,
    api,
    setEditorDirty,
    setEditorTabDeletedExternally,
    cancelDebounce,
  ])

  const saveFile = useCallback(async () => {
    const ed = editorRef.current
    if (!ed) return
    const value = ed.getValue()
    try {
      await api.fs.writeFile(filePath, value)
      savedContentRef.current = value
      pendingSelfWriteAtRef.current = Date.now()
      setEditorDirty(tabId, false)
      lastDirtyRef.current = false
      setEditorTabDeletedExternally(tabId, false)
    } catch (err) {
      console.error('Failed to save HTML file:', err)
    }
  }, [api, filePath, tabId, setEditorDirty, setEditorTabDeletedExternally])

  // Save via global event (hotkey system) and direct Ctrl+S backup.
  // Saving deliberately does NOT touch debouncedContent -- the in-flight
  // debounce (if any) already covers any unflushed edits, so the preview
  // would re-render at most once across the typing burst that ended with
  // Ctrl+S.
  useEffect(() => {
    if (!isActive) return
    const handler = () => saveFile()
    window.addEventListener('editor-save-request', handler)
    return () => window.removeEventListener('editor-save-request', handler)
  }, [isActive, saveFile])

  useEffect(() => {
    if (!isActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isActive, saveFile])

  const handleMount: OnMount = useCallback((monacoEditor) => {
    editorRef.current = monacoEditor
  }, [])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return
      const dirty = value !== savedContentRef.current
      if (dirty !== lastDirtyRef.current) {
        lastDirtyRef.current = dirty
        setEditorDirty(tabId, dirty)
      }
      cancelDebounce()
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        setDebouncedContent(value)
      }, PREVIEW_DEBOUNCE_MS)
    },
    [tabId, setEditorDirty, cancelDebounce]
  )

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
    <div
      style={{
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
      {isDeletedExternally && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>This file has been deleted. Save to recreate it.</span>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <div style={{ display: mode === 'raw' ? 'block' : 'none', height: '100%', width: '100%' }}>
          <Editor
            defaultValue={content}
            language="html"
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
            onMount={handleMount}
            onChange={handleChange}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
        <HtmlPreview content={debouncedContent} fileDir={fileDir} isActive={mode === 'preview'} />
      </div>
    </div>
  )
}
