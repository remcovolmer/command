import { useState, useEffect, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { Loader2 } from 'lucide-react'
import type { WorkingTreeDiffTab } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'

const MAX_DIFF_SIZE = 512 * 1024 // 512KB

interface WorkingTreeDiffViewProps {
  tab: WorkingTreeDiffTab
  isActive: boolean
}

export function WorkingTreeDiffView({ tab, isActive }: WorkingTreeDiffViewProps) {
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
        let origContent: string | null = ''
        let modContent: string | null = ''

        switch (tab.diffKind) {
          case 'unstaged': {
            // Left: index content, Right: working tree
            const [indexContent, workingContent] = await Promise.all([
              api.git.getIndexFileContent(gitPath, tab.filePath),
              api.fs.readFile(gitPath + '\\' + tab.filePath.replace(/\//g, '\\')),
            ])
            origContent = indexContent ?? ''
            modContent = workingContent ?? ''
            break
          }
          case 'staged': {
            // Left: HEAD content, Right: index content
            const [headContent, indexContent] = await Promise.all([
              api.git.getFileAtCommit(gitPath, 'HEAD', tab.filePath),
              api.git.getIndexFileContent(gitPath, tab.filePath),
            ])
            origContent = headContent ?? ''
            modContent = indexContent ?? ''
            break
          }
          case 'untracked': {
            // Left: empty, Right: working tree
            origContent = ''
            modContent = await api.fs.readFile(gitPath + '\\' + tab.filePath.replace(/\//g, '\\')) ?? ''
            break
          }
          case 'deleted': {
            // Left: HEAD content, Right: empty
            origContent = await api.git.getFileAtCommit(gitPath, 'HEAD', tab.filePath) ?? ''
            modContent = ''
            break
          }
        }

        if (cancelled) return

        // File size guard
        if ((origContent?.length ?? 0) > MAX_DIFF_SIZE || (modContent?.length ?? 0) > MAX_DIFF_SIZE) {
          setError('File too large for inline diff')
          setLoading(false)
          return
        }

        setOriginal(origContent)
        setModified(modContent)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load diff')
          setLoading(false)
        }
      }
    }

    fetchContent()
    return () => { cancelled = true }
  }, [api, gitPath, tab.filePath, tab.diffKind])

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
      <div className="flex items-center justify-center h-full bg-background text-sm text-muted-foreground">
        {error}
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
