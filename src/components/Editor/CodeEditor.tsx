import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getMonacoLanguage } from '../../utils/editorLanguages'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
import type { FileWatchEvent } from '../../types'

interface CodeEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
}

export function CodeEditor({ tabId, filePath, isActive }: CodeEditorProps) {
  const api = getElectronAPI()
  const theme = useProjectStore((s) => s.theme)
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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
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
        setError('Loading timed out - check console for details')
      }
    }, 10000)

    api.fs.readFile(filePath)
      .then((text) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setContent(text)
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

  // Centralized file watcher for live updates when Claude Code modifies the file
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const reloadFile = () => {
      const seq = ++readSeqRef.current
      api.fs.readFile(filePath).then((text) => {
        if (cancelled || seq !== readSeqRef.current) return  // stale or unmounted
        const ed = editorRef.current
        if (ed) {
          const position = ed.getPosition()
          ed.setValue(text)
          if (position) ed.setPosition(position)
        }
        savedContentRef.current = text
        lastDirtyRef.current = false
        setEditorDirty(tabId, false)
        setEditorTabDeletedExternally(tabId, false)
      }).catch((err) => {
        if (!cancelled) console.error('Failed to reload file:', err)
      })
    }

    const subscriberKey = `editor-${tabId}`

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

  const saveFile = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const value = editor.getValue()
    try {
      await api.fs.writeFile(filePath, value)
      savedContentRef.current = value
      setEditorDirty(tabId, false)
      lastDirtyRef.current = false
      // Saving recreates the file if it was deleted
      setEditorTabDeletedExternally(tabId, false)
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }, [api, filePath, tabId, setEditorDirty, setEditorTabDeletedExternally])

  // Listen for global editor-save-request event (from hotkey system)
  useEffect(() => {
    if (!isActive) return
    const handler = () => saveFile()
    window.addEventListener('editor-save-request', handler)
    return () => window.removeEventListener('editor-save-request', handler)
  }, [isActive, saveFile])

  // Backup Ctrl+S handler for when Monaco's addCommand doesn't fire
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

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
  }, [])

  const handleChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    const dirty = value !== savedContentRef.current
    // Only update store when dirty state actually changes
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
      {/* File deleted externally banner */}
      {isDeletedExternally && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>This file has been deleted. Save to recreate it.</span>
        </div>
      )}
      <Editor
        defaultValue={content}
        language={getMonacoLanguage(filePath)}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
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
  )
}
