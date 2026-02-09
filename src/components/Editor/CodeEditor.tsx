import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getMonacoLanguage } from '../../utils/editorLanguages'

interface CodeEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
}

export function CodeEditor({ tabId, filePath, isActive }: CodeEditorProps) {
  const api = getElectronAPI()
  const theme = useProjectStore((s) => s.theme)
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const lastDirtyRef = useRef<boolean>(false)

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

  // File watching for live updates when Claude Code modifies the file
  useEffect(() => {
    api.fs.watchFile(filePath)

    const unsubscribe = api.fs.onFileChanged((changedPath) => {
      if (changedPath === filePath) {
        api.fs.readFile(filePath).then((text) => {
          const editor = editorRef.current
          if (editor) {
            // Preserve cursor position
            const position = editor.getPosition()
            editor.setValue(text)
            if (position) {
              editor.setPosition(position)
            }
          }
          savedContentRef.current = text
          lastDirtyRef.current = false
          setEditorDirty(tabId, false)
        }).catch((err) => {
          console.error('Failed to reload file:', err)
        })
      }
    })

    return () => {
      api.fs.unwatchFile(filePath)
      unsubscribe()
    }
  }, [filePath, api, tabId, setEditorDirty])

  const saveFile = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const value = editor.getValue()
    try {
      await api.fs.writeFile(filePath, value)
      savedContentRef.current = value
      setEditorDirty(tabId, false)
      lastDirtyRef.current = false
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }, [api, filePath, tabId, setEditorDirty])

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

    // Monaco internal Ctrl+S (works when Monaco has focus)
    editor.addCommand(
      2048 | 49, // CtrlCmd = 2048, KeyS = 49
      () => saveFile()
    )
  }, [saveFile])

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
