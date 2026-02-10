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

      // Check for conflicts (both modified, or unmerged)
      if (
        ['U', 'A', 'D'].includes(indexStatus) &&
        ['U', 'A', 'D'].includes(workTreeStatus)
      ) {
        conflicted.push({ path: filePath, status: 'conflicted', staged: false })
        continue
      }

      // More specific conflict detection
      if (indexStatus === 'U' || workTreeStatus === 'U') {
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
