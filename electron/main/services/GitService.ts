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

export interface GitBranchListItem {
  name: string
  current: boolean
  upstream: string | null
}

export class GitService {
  // Per-repo operation serialization to prevent index.lock conflicts
  private operationQueue = new Map<string, Promise<void>>()

  private async serialized<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.operationQueue.get(projectPath) ?? Promise.resolve()
    let result!: T
    const next = prev.then(
      async () => { result = await fn() },
      async () => { result = await fn() },
    )
    const settled = next.then(() => {}, () => {})
    this.operationQueue.set(projectPath, settled)
    await next
    // Clean up if no further operations were queued
    if (this.operationQueue.get(projectPath) === settled) {
      this.operationQueue.delete(projectPath)
    }
    return result
  }

  private async execGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
      windowsHide: true,
      timeout: 30000, // 30 seconds timeout to prevent hung network operations
    })
    return stdout.trim()
  }

  private async execGitWithStdin(cwd: string, args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = execFile('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        timeout: 30000,
      }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
      proc.stdin?.write(stdin)
      proc.stdin?.end()
    })
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
      // Single command for branch info + file changes
      const output = await this.execGit(projectPath, [
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
      ])

      const { branch, staged, modified, untracked, conflicted } =
        this.parseStatusV2Output(output)

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

  private parseStatusV2Output(output: string): {
    branch: GitBranchInfo | null
    staged: GitFileChange[]
    modified: GitFileChange[]
    untracked: GitFileChange[]
    conflicted: GitFileChange[]
  } {
    const staged: GitFileChange[] = []
    const modified: GitFileChange[] = []
    const untracked: GitFileChange[] = []
    const conflicted: GitFileChange[] = []
    let branchName: string | null = null
    let upstream: string | null = null
    let ahead = 0
    let behind = 0

    if (!output) {
      return { branch: null, staged, modified, untracked, conflicted }
    }

    const parts = output.split('\0')

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue

      // Branch header lines
      if (part.startsWith('# branch.head ')) {
        const name = part.slice('# branch.head '.length)
        branchName = name === '(detached)' ? 'HEAD (detached)' : name
        continue
      }
      if (part.startsWith('# branch.upstream ')) {
        upstream = part.slice('# branch.upstream '.length)
        continue
      }
      if (part.startsWith('# branch.ab ')) {
        const match = part.match(/\+(\d+) -(\d+)/)
        if (match) {
          ahead = parseInt(match[1], 10)
          behind = parseInt(match[2], 10)
        }
        continue
      }
      if (part.startsWith('# ')) continue // skip other headers like branch.oid

      // Untracked file
      if (part.startsWith('? ')) {
        const filePath = part.slice(2)
        untracked.push({ path: filePath, status: 'added', staged: false })
        continue
      }

      // Ordinary changed entry: "1 XY sub mH mI mW hH hI <path>"
      // With -z, the entire entry is one NUL-terminated part; path is field 8+
      if (part.startsWith('1 ')) {
        const fields = part.split(' ')
        const xy = fields[1]
        const filePath = fields.slice(8).join(' ')
        if (!filePath) continue

        const indexStatus = xy[0]
        const workTreeStatus = xy[1]

        // Index changes (staged)
        if (indexStatus !== '.') {
          staged.push({ path: filePath, status: this.mapStatus(indexStatus), staged: true })
        }
        // Work tree changes (unstaged)
        if (workTreeStatus !== '.') {
          modified.push({ path: filePath, status: this.mapStatus(workTreeStatus), staged: false })
        }
        continue
      }

      // Renamed/copied entry: "2 XY sub mH mI mW hH hI Xscore <path>"
      // With -z, the new path is field 9+ of this part; origPath is the next NUL part
      if (part.startsWith('2 ')) {
        const fields = part.split(' ')
        const xy = fields[1]
        const filePath = fields.slice(9).join(' ')
        ++i // skip origPath (next NUL-separated part)
        if (!filePath) continue

        const indexStatus = xy[0]
        const workTreeStatus = xy[1]

        if (indexStatus !== '.') {
          staged.push({ path: filePath, status: indexStatus === 'R' ? 'renamed' : this.mapStatus(indexStatus), staged: true })
        }
        if (workTreeStatus !== '.') {
          modified.push({ path: filePath, status: this.mapStatus(workTreeStatus), staged: false })
        }
        continue
      }

      // Unmerged entry: "u XY sub m1 m2 m3 mW h1 h2 h3 <path>"
      // With -z, the entire entry is one NUL-terminated part; path is field 10+
      if (part.startsWith('u ')) {
        const fields = part.split(' ')
        const filePath = fields.slice(10).join(' ')
        if (!filePath) continue
        conflicted.push({ path: filePath, status: 'modified', staged: false })
        continue
      }
    }

    const branch: GitBranchInfo | null = branchName
      ? { name: branchName, upstream, ahead, behind }
      : null

    return { branch, staged, modified, untracked, conflicted }
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

  // --- Staging operations ---

  async stageFiles(projectPath: string, files: string[]): Promise<void> {
    return this.serialized(projectPath, async () => {
      await this.execGitWithStdin(projectPath, ['add', '--pathspec-from-file=-'], files.join('\n'))
    })
  }

  async unstageFiles(projectPath: string, files: string[]): Promise<void> {
    return this.serialized(projectPath, async () => {
      await this.execGitWithStdin(projectPath, ['reset', 'HEAD', '--pathspec-from-file=-'], files.join('\n'))
    })
  }

  // --- Commit ---

  async commit(projectPath: string, message: string): Promise<string> {
    return this.serialized(projectPath, async () => {
      const cleanMessage = message.replace(/\0/g, '')
      const output = await this.execGit(projectPath, ['commit', '-m', cleanMessage])
      return output
    })
  }

  // --- Discard operations ---

  async discardFiles(projectPath: string, files: string[]): Promise<void> {
    return this.serialized(projectPath, async () => {
      const CHUNK_SIZE = 100
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE)
        await this.execGit(projectPath, ['checkout', '--', ...chunk])
      }
    })
  }

  async deleteUntrackedFiles(projectPath: string, files: string[]): Promise<void> {
    return this.serialized(projectPath, async () => {
      const CHUNK_SIZE = 100
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE)
        await this.execGit(projectPath, ['clean', '-f', '--', ...chunk])
      }
    })
  }

  // --- Working directory content (for diff viewer) ---

  async getIndexFileContent(projectPath: string, filePath: string): Promise<string | null> {
    try {
      return await this.execGit(projectPath, ['show', `:${filePath}`])
    } catch {
      return null
    }
  }

  // --- Branch management ---

  async listBranches(projectPath: string): Promise<GitBranchListItem[]> {
    try {
      const output = await this.execGit(projectPath, [
        'branch',
        '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)',
      ])

      if (!output) return []

      return output.split('\n').filter(Boolean).map((line) => {
        const [name, head, upstream] = line.split('\0')
        return {
          name: name || '',
          current: head === '*',
          upstream: upstream || null,
        }
      })
    } catch {
      return []
    }
  }

  async createBranch(projectPath: string, name: string): Promise<void> {
    return this.serialized(projectPath, async () => {
      await this.execGit(projectPath, ['switch', '-c', '--', name])
    })
  }

  async switchBranch(projectPath: string, name: string): Promise<void> {
    return this.serialized(projectPath, async () => {
      await this.execGit(projectPath, ['switch', '--', name])
    })
  }

  async deleteBranch(projectPath: string, name: string, force: boolean): Promise<void> {
    return this.serialized(projectPath, async () => {
      const flag = force ? '-D' : '-d'
      await this.execGit(projectPath, ['branch', flag, '--', name])
    })
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
