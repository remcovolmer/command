import { useState, useEffect, useMemo } from 'react'
import { Loader2, FilePlus, FileEdit, FileX, FileText, ArrowRight } from 'lucide-react'
import type { GitCommit, GitCommitDetail as GitCommitDetailType, GitCommitFile } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'

interface CommitDetailProps {
  commit: GitCommit
  gitPath: string
  detailCache: React.MutableRefObject<Record<string, GitCommitDetailType>>
}

export function CommitDetail({ commit, gitPath, detailCache }: CommitDetailProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const openDiffTab = useProjectStore((s) => s.openDiffTab)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  const [detail, setDetail] = useState<GitCommitDetailType | null>(
    detailCache.current[commit.hash] ?? null
  )
  const [loading, setLoading] = useState(!detail)

  useEffect(() => {
    if (detail) return

    let cancelled = false
    setLoading(true)

    api.git.getCommitDetail(gitPath, commit.hash).then((result) => {
      if (!cancelled && result) {
        detailCache.current[commit.hash] = result
        setDetail(result)
      }
      if (!cancelled) setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [api, gitPath, commit.hash, detail, detailCache])

  const handleFileClick = (file: GitCommitFile) => {
    if (!activeProjectId) return
    const parentHash = commit.parentHashes[0] ?? ''
    const fileName = file.path.split('/').pop() ?? file.path
    openDiffTab(file.oldPath ?? file.path, fileName, commit.hash, parentHash, activeProjectId)
  }

  if (loading) {
    return (
      <div className="px-3 py-2 flex items-center justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        Failed to load commit details
      </div>
    )
  }

  return (
    <div className="px-3 py-2 bg-sidebar-accent/50 border-t border-border/30">
      {/* Full commit message */}
      {detail.fullMessage !== commit.message && (
        <p className="text-xs text-muted-foreground mb-2 whitespace-pre-wrap break-words">
          {detail.fullMessage}
        </p>
      )}

      {/* Author info */}
      <div className="text-xs text-muted-foreground mb-2">
        {detail.authorName} &middot; {new Date(detail.authorDate).toLocaleString()}
      </div>

      {/* Merge indicator */}
      {detail.isMerge && (
        <div className="text-xs text-purple-500 mb-2">
          Merge commit ({detail.parentHashes.length} parents)
        </div>
      )}

      {/* Changed files */}
      {detail.files.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-xs text-muted-foreground mb-1">
            {detail.files.length} file{detail.files.length !== 1 ? 's' : ''} changed
          </div>
          {detail.files.map((file) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file)}
              className="w-full flex items-center gap-1.5 py-0.5 px-1 rounded text-xs hover:bg-muted/50 transition-colors text-left"
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <FileStatusIcon status={file.status} />
              <span className="truncate flex-1 text-sidebar-foreground">
                {file.oldPath ? (
                  <>
                    <span className="text-muted-foreground">{file.oldPath.split('/').pop()}</span>
                    <ArrowRight className="inline w-3 h-3 mx-0.5 text-muted-foreground" />
                    {file.path.split('/').pop()}
                  </>
                ) : (
                  file.path.split('/').pop()
                )}
              </span>
              <span className="flex-shrink-0 font-mono">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400 ml-1">-{file.deletions}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FileStatusIcon({ status }: { status: GitCommitFile['status'] }) {
  const props = { className: 'w-3 h-3 flex-shrink-0' }
  switch (status) {
    case 'added':
      return <FilePlus {...props} className={`${props.className} text-green-600 dark:text-green-400`} />
    case 'deleted':
      return <FileX {...props} className={`${props.className} text-red-600 dark:text-red-400`} />
    case 'renamed':
      return <ArrowRight {...props} className={`${props.className} text-blue-600 dark:text-blue-400`} />
    default:
      return <FileEdit {...props} className={`${props.className} text-yellow-600 dark:text-yellow-400`} />
  }
}
