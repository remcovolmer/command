import { useState, useEffect, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { Loader2 } from 'lucide-react'
import type { DiffTab } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'

interface DiffEditorViewProps {
  tab: DiffTab
  isActive: boolean
}

export function DiffEditorView({ tab, isActive }: DiffEditorViewProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const theme = useProjectStore((s) => s.theme)
  const [original, setOriginal] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Determine git path from active project/worktree
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const gitPath = activeWorktree?.path ?? activeProject?.path

  useEffect(() => {
    if (!gitPath) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchContent = async () => {
      try {
        // Fetch modified (the file at this commit)
        const modifiedContent = await api.git.getFileAtCommit(gitPath, tab.commitHash, tab.filePath)

        // Fetch original (the file at parent commit)
        let originalContent: string | null = ''
        if (tab.parentHash) {
          originalContent = await api.git.getFileAtCommit(gitPath, tab.parentHash, tab.filePath)
        }

        if (!cancelled) {
          setOriginal(originalContent ?? '')
          setModified(modifiedContent ?? '')
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load diff')
          setLoading(false)
        }
      }
    }

    fetchContent()
    return () => { cancelled = true }
  }, [api, gitPath, tab.commitHash, tab.parentHash, tab.filePath])

  if (!isActive) {
    return <div style={{ display: 'none' }} />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-sm text-red-500">
        {error}
      </div>
    )
  }

  // Binary file detection (null content from git show)
  if (modified === null && original === null) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-sm text-muted-foreground">
        Binary file — cannot display diff
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <DiffEditor
        original={original ?? ''}
        modified={modified ?? ''}
        language={getLanguageFromPath(tab.filePath)}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
        }}
      />
    </div>
  )
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
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
    java: 'java',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
  }
  return langMap[ext ?? ''] ?? 'plaintext'
}
