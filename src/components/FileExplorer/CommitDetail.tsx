import { useState, useEffect, useMemo } from 'react'
import { Loader2, FilePlus, FileEdit, FileX, ArrowRight } from 'lucide-react'
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

    api.git
      .getCommitDetail(gitPath, commit.hash)
      .then((result) => {
        if (!cancelled && result) {
          detailCache.current[commit.hash] = result
          setDetail(result)
        }
        if (!cancelled) setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [api, gitPath, commit.hash, detail, detailCache])

  const handleFileClick = (file: GitCommitFile) => {
    if (!activeProjectId) return
    const parentHash = commit.parentHashes[0] ?? ''
    const fileName = file.path.split('/').pop() ?? file.path
    openDiffTab(file.path, fileName, commit.hash, parentHash, activeProjectId, file.oldPath)
  }

  if (loading) {
    return (
      <div className="px-3 py-2 flex items-center justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
      </div>
    )
  }

  if (!detail) {
    return <div className="px-3 py-2 text-[11px] text-fg-muted">Failed to load commit details</div>
  }

  return (
    <div className="px-3 py-2 bg-canvas border-t border-border">
      {/* Full commit message */}
      {detail.fullMessage !== commit.message && (
        <p className="text-[12px] text-fg-muted mb-2 whitespace-pre-wrap break-words">
          {detail.fullMessage}
        </p>
      )}

      {/* Author info */}
      <div className="font-mono text-[11px] text-fg-muted tnum mb-2">
        {detail.authorName} &middot; {new Date(detail.authorDate).toLocaleString()}
      </div>

      {/* Merge indicator */}
      {detail.isMerge && (
        <div className="text-[11px] text-fg-muted mb-2">
          Merge commit ({detail.parentHashes.length} parents)
        </div>
      )}

      {/* Changed files */}
      {detail.files.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[11px] text-fg-muted mb-1">
            {detail.files.length} file{detail.files.length !== 1 ? 's' : ''} changed
          </div>
          {detail.files.map((file) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file)}
              className="w-full flex items-center gap-1.5 py-0.5 px-1 rounded text-[12px] hover:bg-raised transition-colors text-left"
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <FileStatusIcon status={file.status} />
              <span className="truncate flex-1 text-fg">
                {file.oldPath ? (
                  <>
                    <span className="text-fg-muted">{file.oldPath.split('/').pop()}</span>
                    <ArrowRight className="inline w-3 h-3 mx-0.5 text-fg-muted" strokeWidth={1.5} />
                    {file.path.split('/').pop()}
                  </>
                ) : (
                  file.path.split('/').pop()
                )}
              </span>
              <span className="flex-shrink-0 font-mono tnum">
                {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                {file.deletions > 0 && <span className="text-danger ml-1">-{file.deletions}</span>}
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
      return (
        <FilePlus {...props} className={`${props.className} text-success`} />
      )
    case 'deleted':
      return <FileX {...props} className={`${props.className} text-danger`} />
    case 'renamed':
      return (
        <ArrowRight {...props} className={`${props.className} text-info`} />
      )
    default:
      return (
        <FileEdit
          {...props}
          className={`${props.className} text-warning`}
        />
      )
  }
}
