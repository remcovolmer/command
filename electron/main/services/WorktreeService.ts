import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import * as path from 'node:path'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isLocked: boolean
  isMain: boolean
}

export class WorktreeService {
  private static readonly WORKTREES_DIR = '.worktrees'

  private async execGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.trim()
  }

  /**
   * Get the .worktrees directory path for a project
   */
  getWorktreesDir(projectPath: string): string {
    return path.join(projectPath, WorktreeService.WORKTREES_DIR)
  }

  /**
   * Ensure the .worktrees directory exists and is in .gitignore
   */
  async ensureWorktreesDir(projectPath: string): Promise<void> {
    const worktreesDir = this.getWorktreesDir(projectPath)

    // Create .worktrees directory if it doesn't exist
    if (!existsSync(worktreesDir)) {
      mkdirSync(worktreesDir, { recursive: true })
    }

    // Add .worktrees to .gitignore if not already present
    const gitignorePath = path.join(projectPath, '.gitignore')
    const ignoreEntry = WorktreeService.WORKTREES_DIR

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      const lines = content.split('\n').map(l => l.trim())

      if (!lines.includes(ignoreEntry) && !lines.includes(`/${ignoreEntry}`)) {
        // Add to .gitignore with a newline before if file doesn't end with newline
        const newContent = content.endsWith('\n')
          ? `${ignoreEntry}\n`
          : `\n${ignoreEntry}\n`
        appendFileSync(gitignorePath, newContent)
      }
    } else {
      // Create .gitignore with the entry
      writeFileSync(gitignorePath, `${ignoreEntry}\n`)
    }
  }

  /**
   * List all local branches
   */
  async listBranches(projectPath: string): Promise<string[]> {
    try {
      const output = await this.execGit(projectPath, [
        'branch',
        '--format=%(refname:short)',
      ])

      if (!output) return []

      return output.split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * List all remote branches
   */
  async listRemoteBranches(projectPath: string): Promise<string[]> {
    try {
      // Fetch latest remote info first
      try {
        await this.execGit(projectPath, ['fetch', '--all', '--prune'])
      } catch {
        // Fetch failed, continue with what we have
      }

      const output = await this.execGit(projectPath, [
        'branch',
        '-r',
        '--format=%(refname:short)',
      ])

      if (!output) return []

      return output
        .split('\n')
        .filter(Boolean)
        .filter(b => !b.includes('HEAD'))
        .map(b => b.replace(/^origin\//, ''))
    } catch {
      return []
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(projectPath: string): Promise<string | null> {
    try {
      return await this.execGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch {
      return null
    }
  }

  /**
   * List all worktrees for a project
   */
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    try {
      const output = await this.execGit(projectPath, [
        'worktree',
        'list',
        '--porcelain',
      ])

      if (!output) return []

      const worktrees: WorktreeInfo[] = []
      let current: Partial<WorktreeInfo> = {}

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) {
            worktrees.push(current as WorktreeInfo)
          }
          current = {
            path: line.substring(9),
            isLocked: false,
            isMain: false,
          }
        } else if (line.startsWith('HEAD ')) {
          current.head = line.substring(5)
        } else if (line.startsWith('branch ')) {
          // Format: refs/heads/branch-name
          current.branch = line.substring(7).replace('refs/heads/', '')
        } else if (line === 'detached') {
          current.branch = 'detached'
        } else if (line === 'locked') {
          current.isLocked = true
        } else if (line === 'bare') {
          // Skip bare repos
          current = {}
        }
      }

      // Add last worktree
      if (current.path) {
        worktrees.push(current as WorktreeInfo)
      }

      // Mark main worktree (first one is always main)
      if (worktrees.length > 0) {
        worktrees[0].isMain = true
      }

      return worktrees
    } catch {
      return []
    }
  }

  /**
   * Check if a branch is already checked out in a worktree
   */
  async isBranchInUse(projectPath: string, branchName: string): Promise<boolean> {
    const worktrees = await this.listWorktrees(projectPath)
    return worktrees.some(wt => wt.branch === branchName)
  }

  /**
   * Create a new worktree
   */
  async createWorktree(
    projectPath: string,
    branchName: string,
    worktreeName?: string
  ): Promise<{ path: string; branch: string }> {
    // Ensure .worktrees directory exists
    await this.ensureWorktreesDir(projectPath)

    // Use branch name as worktree name if not provided
    // Replace / with - for branch names like feature/auth
    const name = worktreeName || branchName.replace(/\//g, '-')
    const worktreePath = path.join(this.getWorktreesDir(projectPath), name)

    // Check if branch is already in use
    if (await this.isBranchInUse(projectPath, branchName)) {
      throw new Error(`Branch "${branchName}" is already checked out in another worktree`)
    }

    // Check if worktree directory already exists
    if (existsSync(worktreePath)) {
      throw new Error(`Worktree directory already exists: ${worktreePath}`)
    }

    // Check if branch exists locally
    const localBranches = await this.listBranches(projectPath)
    const branchExists = localBranches.includes(branchName)

    if (branchExists) {
      // Checkout existing branch in new worktree
      await this.execGit(projectPath, [
        'worktree',
        'add',
        worktreePath,
        branchName,
      ])
    } else {
      // Check if it exists on remote
      const remoteBranches = await this.listRemoteBranches(projectPath)
      if (remoteBranches.includes(branchName)) {
        // Create local branch tracking remote
        await this.execGit(projectPath, [
          'worktree',
          'add',
          '--track',
          '-b',
          branchName,
          worktreePath,
          `origin/${branchName}`,
        ])
      } else {
        // Create new branch based on current HEAD
        await this.execGit(projectPath, [
          'worktree',
          'add',
          '-b',
          branchName,
          worktreePath,
        ])
      }
    }

    return {
      path: worktreePath,
      branch: branchName,
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(
    projectPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<void> {
    const args = ['worktree', 'remove']
    if (force) {
      args.push('--force')
    }
    args.push(worktreePath)

    await this.execGit(projectPath, args)
  }

  /**
   * Check if worktree has uncommitted changes
   */
  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    try {
      const output = await this.execGit(worktreePath, [
        'status',
        '--porcelain',
      ])
      return output.length > 0
    } catch {
      return false
    }
  }

  /**
   * Lock a worktree to prevent accidental removal
   */
  async lockWorktree(projectPath: string, worktreePath: string): Promise<void> {
    await this.execGit(projectPath, ['worktree', 'lock', worktreePath])
  }

  /**
   * Unlock a worktree
   */
  async unlockWorktree(projectPath: string, worktreePath: string): Promise<void> {
    await this.execGit(projectPath, ['worktree', 'unlock', worktreePath])
  }

  /**
   * Prune stale worktree entries
   */
  async pruneWorktrees(projectPath: string): Promise<void> {
    await this.execGit(projectPath, ['worktree', 'prune'])
  }

  /**
   * Check if path is within .worktrees directory
   */
  isWorktreePath(projectPath: string, checkPath: string): boolean {
    const worktreesDir = this.getWorktreesDir(projectPath)
    const normalizedCheck = path.normalize(checkPath)
    const normalizedWorktrees = path.normalize(worktreesDir)
    return normalizedCheck.startsWith(normalizedWorktrees)
  }
}
