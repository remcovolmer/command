import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface CodeEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  toml: 'ini',
  env: 'ini',
  gitignore: 'ini',
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
}

export function CodeEditor({ tabId, filePath, isActive }: CodeEditorProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const theme = useProjectStore((s) => s.theme)
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

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
        } catch (err) {
          console.error('Failed to save file:', err)
        }
      }
    )
  }, [api, filePath, tabId, setEditorDirty])

  const handleChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    const dirty = value !== savedContentRef.current
    setEditorDirty(tabId, dirty)
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
        language={getLanguage(filePath)}
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
