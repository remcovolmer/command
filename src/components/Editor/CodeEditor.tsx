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
    api.fs.readFile(filePath).then((text) => {
      if (cancelled) return
      setContent(text)
      savedContentRef.current = text
    }).catch((err) => {
      if (cancelled) return
      setError(err?.message ?? 'Failed to read file')
    })
    return () => { cancelled = true }
  }, [filePath, api])

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor

    // Ctrl+S to save
    editor.addCommand(
      // Monaco KeyMod.CtrlCmd | KeyCode.KeyS
      2048 | 49, // CtrlCmd = 2048, KeyS = 49
      async () => {
        const value = editor.getValue()
        try {
          await api.fs.writeFile(filePath, value)
          savedContentRef.current = value
          setEditorDirty(tabId, false)
          lastDirtyRef.current = false
        } catch (err) {
          console.error('Failed to save file:', err)
        }
      }
    )
  }, [api, filePath, tabId, setEditorDirty])

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
