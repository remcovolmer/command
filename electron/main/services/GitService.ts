import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitFileChange {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  staged: boolean
}

export interface GitBranchInfo {
  name: string
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitStatus {
  isGitRepo: boolean
  branch: GitBranchInfo | null
  staged: GitFileChange[]
  modified: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  isClean: boolean
  error?: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  authorName: string
  authorDate: string
  parentHashes: string[]
}

export interface GitCommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  oldPath?: string
}

export interface GitCommitDetail {
  hash: string
  fullMessage: string
  authorName: string
  authorEmail: string
  authorDate: string
  files: GitCommitFile[]
  isMerge: boolean
  parentHashes: string[]
}

export interface GitCommitLog {
  commits: GitCommit[]
  hasMore: boolean
}

export class GitService {
  private async execGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
      windowsHide: true,
      timeout: 30000, // 30 seconds timeout to prevent hung network operations
    })
    return stdout.trim()
  }

  async getStatus(projectPath: string): Promise<GitStatus> {
    // Check if directory is a git repo
    try {
      await this.execGit(projectPath, ['rev-parse', '--git-dir'])
    } catch {
      return {
        isGitRepo: false,
        branch: null,
        staged: [],
        modified: [],
        untracked: [],
        conflicted: [],
        isClean: true,
      }
    }

    try {
      // Get branch info
      const branch = await this.getBranchInfo(projectPath)

      // Get file changes using porcelain format
      const statusOutput = await this.execGit(projectPath, [
        'status',
        '--porcelain=v1',
        '-z',
      ])

      const { staged, modified, untracked, conflicted } =
        this.parseStatusOutput(statusOutput)

      return {
        isGitRepo: true,
        branch,
        staged,
        modified,
        untracked,
        conflicted,
        isClean:
          staged.length === 0 &&
          modified.length === 0 &&
          untracked.length === 0 &&
          conflicted.length === 0,
      }
    } catch (error) {
      return {
        isGitRepo: true,
        branch: null,
        staged: [],
        modified: [],
        untracked: [],
        conflicted: [],
        isClean: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async getBranchInfo(cwd: string): Promise<GitBranchInfo | null> {
    try {
      // Get current branch name
      const name = await this.execGit(cwd, [
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ])

      // Try to get upstream tracking info
      let upstream: string | null = null
      let ahead = 0
      let behind = 0

      try {
        upstream = await this.execGit(cwd, [
          'rev-parse',
          '--abbrev-ref',
          '@{upstream}',
        ])

        // Get ahead/behind counts
        const counts = await this.execGit(cwd, [
          'rev-list',
          '--left-right',
          '--count',
          `${name}...@{upstream}`,
        ])
        const [aheadStr, behindStr] = counts.split('\t')
        ahead = parseInt(aheadStr, 10) || 0
        behind = parseInt(behindStr, 10) || 0
      } catch {
        // No upstream set, that's fine
      }

      return { name, upstream, ahead, behind }
    } catch {
      return null
    }
  }

  private parseStatusOutput(output: string): {
    staged: GitFileChange[]
    modified: GitFileChange[]
    untracked: GitFileChange[]
    conflicted: GitFileChange[]
  } {
    const staged: GitFileChange[] = []
    const modified: GitFileChange[] = []
    const untracked: GitFileChange[] = []
    const conflicted: GitFileChange[] = []

    if (!output) {
      return { staged, modified, untracked, conflicted }
    }

    // Split by null character (porcelain v1 with -z)
    const entries = output.split('\0').filter(Boolean)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.length < 3) continue

      const indexStatus = entry[0]
      const workTreeStatus = entry[1]
      const filePath = entry.slice(3)

      // Handle renames (R100 old -> new)
      if (indexStatus === 'R' || workTreeStatus === 'R') {
        i++ // Skip the next entry (original filename)
      }

      // Check for merge conflicts using the exact unmerged status pairs
      // from git porcelain v1: DD, AU, UD, UA, DU, AA, UU
      const statusPair = indexStatus + workTreeStatus
      if (
        statusPair === 'DD' || statusPair === 'AU' || statusPair === 'UD' ||
        statusPair === 'UA' || statusPair === 'DU' || statusPair === 'AA' ||
        statusPair === 'UU'
      ) {
        conflicted.push({ path: filePath, status: 'conflicted', staged: false })
        continue
      }

      // Staged changes (index status)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        const status = this.mapStatus(indexStatus)
        staged.push({ path: filePath, status, staged: true })
      }

      // Unstaged changes (worktree status)
      if (workTreeStatus === '?') {
        untracked.push({ path: filePath, status: 'untracked', staged: false })
      } else if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
        const status = this.mapStatus(workTreeStatus)
        modified.push({ path: filePath, status, staged: false })
      }
    }

    return { staged, modified, untracked, conflicted }
  }

  async fetch(projectPath: string): Promise<string> {
    return this.execGit(projectPath, ['fetch'])
  }

  async pull(projectPath: string): Promise<string> {
    return this.execGit(projectPath, ['pull'])
  }

  async push(projectPath: string): Promise<string> {
    return this.execGit(projectPath, ['push'])
  }

  async getCommitLog(projectPath: string, skip = 0, limit = 100): Promise<GitCommitLog> {
    try {
      // Use NUL bytes as field separators — git strips NUL from commit messages
      // so they can never appear in %s (subject). Records separated by newlines
      // (safe because %s is single-line only).
      const format = ['%H', '%h', '%s', '%an', '%aI', '%P'].join('%x00')

      const output = await this.execGit(projectPath, [
        'log',
        `--skip=${skip}`,
        `--max-count=${limit + 1}`, // fetch one extra to detect if there are more
        `--format=${format}`,
      ])

      if (!output) {
        return { commits: [], hasMore: false }
      }

      const records = output.split('\n').filter((r) => r.trim())
      const hasMore = records.length > limit
      const commits: GitCommit[] = records.slice(0, limit).map((record) => {
        const fields = record.split('\0')
        return {
          hash: fields[0] || '',
          shortHash: fields[1] || '',
          message: fields[2] || '',
          authorName: fields[3] || '',
          authorDate: fields[4] || '',
          parentHashes: fields[5] ? fields[5].split(' ').filter(Boolean) : [],
        }
      })

      return { commits, hasMore }
    } catch {
      return { commits: [], hasMore: false }
    }
  }

  async getCommitDetail(projectPath: string, commitHash: string): Promise<GitCommitDetail | null> {
    try {
      // Get commit metadata using NUL bytes as field separators.
      // Git strips NUL from commit messages so they never appear in %B.
      // %B is placed LAST because it can span multiple lines.
      const format = ['%H', '%an', '%ae', '%aI', '%P', '%B'].join('%x00')

      const metaOutput = await this.execGit(projectPath, [
        'show',
        '--no-patch',
        `--format=${format}`,
        commitHash,
      ])

      const fields = metaOutput.split('\0')
      const parentHashes = fields[4] ? fields[4].trim().split(' ').filter(Boolean) : []
      const isMerge = parentHashes.length > 1

      // Get file stats using diff-tree (diff against first parent)
      // -M enables rename detection so renames show as R instead of A+D
      let filesOutput: string
      try {
        if (parentHashes.length === 0) {
          // Initial commit: diff against empty tree
          filesOutput = await this.execGit(projectPath, [
            'diff-tree',
            '--no-commit-id',
            '-r',
            '-M',
            '--numstat',
            '--diff-filter=ADMR',
            commitHash,
          ])
        } else {
          filesOutput = await this.execGit(projectPath, [
            'diff-tree',
            '--no-commit-id',
            '-r',
            '-M',
            '--numstat',
            '--diff-filter=ADMR',
            `${parentHashes[0]}`,
            commitHash,
          ])
        }
      } catch {
        filesOutput = ''
      }

      // Get status letters for each file
      let statusOutput: string
      try {
        if (parentHashes.length === 0) {
          statusOutput = await this.execGit(projectPath, [
            'diff-tree',
            '--no-commit-id',
            '-r',
            '-M',
            '--name-status',
            '--diff-filter=ADMR',
            commitHash,
          ])
        } else {
          statusOutput = await this.execGit(projectPath, [
            'diff-tree',
            '--no-commit-id',
            '-r',
            '-M',
            '--name-status',
            '--diff-filter=ADMR',
            `${parentHashes[0]}`,
            commitHash,
          ])
        }
      } catch {
        statusOutput = ''
      }

      // Parse status output into a map
      const statusMap = new Map<string, { status: GitCommitFile['status']; oldPath?: string }>()
      for (const line of statusOutput.split('\n').filter(Boolean)) {
        const parts = line.split('\t')
        const statusCode = parts[0]?.[0]
        if (statusCode === 'R') {
          // Rename: R100\told\tnew
          const oldPath = parts[1]
          const newPath = parts[2]
          if (newPath) {
            statusMap.set(newPath, { status: 'renamed', oldPath })
          }
        } else {
          const filePath = parts[1]
          if (filePath) {
            statusMap.set(filePath, {
              status: statusCode === 'A' ? 'added' : statusCode === 'D' ? 'deleted' : 'modified',
            })
          }
        }
      }

      // Parse numstat output
      const files: GitCommitFile[] = []
      for (const line of filesOutput.split('\n').filter(Boolean)) {
        const parts = line.split('\t')
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
        let filePath = parts[2] || ''
        if (!filePath) continue

        // With -M, numstat shows renames as "{prefix/}{old => new}" or "old => new"
        if (filePath.includes(' => ')) {
          const braceMatch = filePath.match(/^(.*?)\{.*? => (.*?)\}(.*)$/)
          if (braceMatch) {
            filePath = braceMatch[1] + braceMatch[2] + braceMatch[3]
          } else {
            filePath = filePath.split(' => ')[1].trim()
          }
        }

        const statusInfo = statusMap.get(filePath) ?? { status: 'modified' as const }
        files.push({
          path: filePath,
          status: statusInfo.status,
          additions,
          deletions,
          ...(statusInfo.oldPath ? { oldPath: statusInfo.oldPath } : {}),
        })
      }

      return {
        hash: fields[0] || '',
        fullMessage: fields.slice(5).join('\0').trim() || '',
        authorName: fields[1] || '',
        authorEmail: fields[2] || '',
        authorDate: fields[3] || '',
        files,
        isMerge,
        parentHashes,
      }
    } catch {
      return null
    }
  }

  async getFileAtCommit(projectPath: string, commitHash: string, filePath: string): Promise<string | null> {
    try {
      return await this.execGit(projectPath, ['show', `${commitHash}:${filePath}`])
    } catch {
      return null
    }
  }

  async getHeadHash(projectPath: string): Promise<string | null> {
    try {
      return await this.execGit(projectPath, ['rev-parse', 'HEAD'])
    } catch {
      return null
    }
  }

  async getRemoteUrl(projectPath: string): Promise<string | null> {
    try {
      const url = await this.execGit(projectPath, ['config', '--get', 'remote.origin.url'])
      if (!url) return null
      return this.normalizeGitUrl(url)
    } catch {
      return null
    }
  }

  private normalizeGitUrl(url: string): string {
    // SCP-like SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
    if (sshMatch) {
      return `https://${sshMatch[1]}/${sshMatch[2]}`
    }
    // URL-style SSH: ssh://git@github.com/owner/repo.git
    const sshUrlMatch = url.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+?)(?:\.git)?$/)
    if (sshUrlMatch) {
      return `https://${sshUrlMatch[1]}/${sshUrlMatch[2]}`
    }
    // HTTPS format: https://github.com/owner/repo.git
    return url.replace(/\.git$/, '')
  }

  private mapStatus(code: string): GitFileChange['status'] {
    switch (code) {
      case 'M':
        return 'modified'
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case 'R':
        return 'renamed'
      case '?':
        return 'untracked'
      case 'U':
        return 'conflicted'
      default:
        return 'modified'
    }
  }
}
