import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

export interface PRCheckStatus {
  name: string
  state: string
  bucket: string
}

export interface PRStatus {
  noPR: boolean
  number?: number
  title?: string
  url?: string
  state?: 'OPEN' | 'CLOSED' | 'MERGED'
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus?: 'CLEAN' | 'DIRTY' | 'BLOCKED' | 'UNSTABLE' | 'UNKNOWN'
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  statusCheckRollup?: PRCheckStatus[]
  additions?: number
  deletions?: number
  changedFiles?: number
  loading?: boolean
  error?: string
  lastUpdated?: number
}

interface PollingEntry {
  interval: ReturnType<typeof setInterval>
  initialTimer?: ReturnType<typeof setTimeout>
  path: string
}

const GH_TIMEOUT = 10_000
const POLL_INTERVAL = 60_000
const MAX_CONCURRENT = 5

export class GitHubService {
  private pollingMap = new Map<string, PollingEntry>()
  private activeRequests = 0
  private ghAvailable: boolean | null = null
  private window: BrowserWindow | null = null

  setWindow(window: BrowserWindow) {
    this.window = window
  }

  async isGhInstalled(): Promise<boolean> {
    if (this.ghAvailable !== null) return this.ghAvailable
    try {
      await execFileAsync('gh', ['--version'], { timeout: 5000, windowsHide: true })
      this.ghAvailable = true
    } catch {
      this.ghAvailable = false
    }
    return this.ghAvailable
  }

  async isGhAuthenticated(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 5000, windowsHide: true })
      return true
    } catch {
      return false
    }
  }

  async getPRStatus(projectPath: string): Promise<PRStatus> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr', 'view',
          '--json', 'number,title,state,url,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,additions,deletions,changedFiles',
        ],
        {
          cwd: projectPath,
          timeout: GH_TIMEOUT,
          windowsHide: true,
          env: { ...process.env, GH_PAGER: '' },
        }
      )

      const data = JSON.parse(stdout)
      return {
        noPR: false,
        number: data.number,
        title: data.title,
        url: data.url,
        state: data.state,
        mergeable: data.mergeable,
        mergeStateStatus: data.mergeStateStatus,
        reviewDecision: data.reviewDecision,
        statusCheckRollup: data.statusCheckRollup ?? [],
        additions: data.additions,
        deletions: data.deletions,
        changedFiles: data.changedFiles,
        lastUpdated: Date.now(),
      }
    } catch (error: unknown) {
      const err = error as { stderr?: string; code?: number }
      if (err.stderr?.includes('no pull requests found') || err.stderr?.includes('Could not resolve')) {
        return { noPR: true, lastUpdated: Date.now() }
      }
      return {
        noPR: true,
        error: err.stderr || 'Failed to fetch PR status',
        lastUpdated: Date.now(),
      }
    }
  }

  async mergePR(projectPath: string, prNumber: number): Promise<void> {
    // Get branch name before merging so we can clean up after
    let branchName: string | null = null
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', prNumber.toString(), '--json', 'headRefName', '--jq', '.headRefName'],
        {
          cwd: projectPath,
          timeout: GH_TIMEOUT,
          windowsHide: true,
          env: { ...process.env, GH_PAGER: '' },
        }
      )
      branchName = stdout.trim() || null
    } catch {
      // Continue without branch name
    }

    // Merge without --delete-branch to avoid failure when a worktree uses the branch
    await execFileAsync(
      'gh',
      ['pr', 'merge', prNumber.toString(), '--squash'],
      {
        cwd: projectPath,
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, GH_PAGER: '' },
      }
    )

    // Best-effort: delete remote branch (GitHub may have already done this)
    if (branchName) {
      try {
        await execFileAsync(
          'git',
          ['push', 'origin', '--delete', branchName],
          { cwd: projectPath, timeout: 15_000, windowsHide: true }
        )
      } catch {
        // Already deleted or no permission — fine
      }

      // Best-effort: delete local branch (will fail if worktree uses it — that's OK)
      try {
        await execFileAsync(
          'git',
          ['branch', '-D', branchName],
          { cwd: projectPath, timeout: 10_000, windowsHide: true }
        )
      } catch {
        // Branch in use by worktree — will be cleaned up when worktree is removed
      }
    }
  }

  startPolling(key: string, projectPath: string) {
    if (this.pollingMap.has(key)) return

    // Jittered first fetch to avoid thundering herd when multiple worktrees mount
    const jitter = Math.floor(Math.random() * 4000) + 1000
    const initialTimer = setTimeout(() => {
      this.pollOnce(key, projectPath)
    }, jitter)

    const interval = setInterval(() => {
      this.pollOnce(key, projectPath)
    }, POLL_INTERVAL)

    this.pollingMap.set(key, { interval, path: projectPath, initialTimer })
  }

  stopPolling(key: string) {
    const entry = this.pollingMap.get(key)
    if (entry) {
      clearTimeout(entry.initialTimer)
      clearInterval(entry.interval)
      this.pollingMap.delete(key)
    }
  }

  stopAllPolling() {
    for (const [key] of this.pollingMap) {
      this.stopPolling(key)
    }
  }

  pauseAllPolling() {
    for (const [, entry] of this.pollingMap) {
      clearInterval(entry.interval)
    }
  }

  resumeAllPolling() {
    for (const [key, entry] of this.pollingMap) {
      // Immediate fetch on resume
      this.pollOnce(key, entry.path)
      // Re-start interval
      clearInterval(entry.interval)
      entry.interval = setInterval(() => {
        this.pollOnce(key, entry.path)
      }, POLL_INTERVAL)
    }
  }

  private async pollOnce(key: string, projectPath: string) {
    if (this.activeRequests >= MAX_CONCURRENT) return
    this.activeRequests++
    try {
      const status = await this.getPRStatus(projectPath)
      this.sendToRenderer('github:pr-status-update', key, status)
    } catch {
      // Silently ignore poll errors
    } finally {
      this.activeRequests--
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  destroy() {
    this.stopAllPolling()
  }
}
