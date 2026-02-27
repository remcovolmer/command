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

  private normalizePath(p: string): string {
    const normalized = path.resolve(path.normalize(p))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private async execGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      timeout: 30_000,
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

      const alreadyIgnored = lines.some(l =>
        l === ignoreEntry || l === `/${ignoreEntry}` ||
        l === `${ignoreEntry}/` || l === `/${ignoreEntry}/`
      )

      if (!alreadyIgnored) {
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
          if (current.path && current.head && current.branch) {
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

      // Add last worktree (only if fully populated)
      if (current.path && current.head && current.branch) {
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
   * Fetch latest remote info and fast-forward the current branch.
   * Ensures worktrees are created from up-to-date refs (e.g. after a PR merge on GitHub).
   * Both operations fail silently — network errors don't block worktree creation.
   */
  private async fetchAndUpdateMain(projectPath: string): Promise<void> {
    try {
      await this.execGit(projectPath, ['fetch', 'origin'])
    } catch {
      // Network error — continue with what we have
      return
    }

    try {
      await this.execGit(projectPath, ['pull', '--ff-only'])
    } catch {
      // Diverged or uncommitted changes — fetch alone still helps
    }
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

    // Fetch + fast-forward to ensure local is up to date
    await this.fetchAndUpdateMain(projectPath)

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
   * Remove a worktree with robust error handling
   */
  async removeWorktree(
    projectPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<void> {
    // Step 1: Prune stale worktrees first (cleans up if directory was manually deleted)
    try {
      await this.execGit(projectPath, ['worktree', 'prune'])
    } catch {
      // Prune failed, continue anyway
    }

    // Step 2: Check if worktree still exists in git's list
    const worktrees = await this.listWorktrees(projectPath)
    const normalizedTarget = this.normalizePath(worktreePath)
    const worktree = worktrees.find(
      wt => this.normalizePath(wt.path) === normalizedTarget
    )

    if (!worktree) {
      // Worktree was already pruned or doesn't exist in git
      return
    }

    // Use the git-registered path for all git commands (avoids casing/separator mismatches)
    const gitPath = worktree.path

    // Step 3: Check if locked and unlock if needed
    if (worktree.isLocked) {
      try {
        await this.execGit(projectPath, ['worktree', 'unlock', gitPath])
      } catch {
        // Unlock failed, continue anyway (might already be unlocked)
      }
    }

    // Step 4: Attempt removal
    try {
      const args = ['worktree', 'remove']
      if (force) {
        args.push('--force')
      }
      args.push(gitPath)
      await this.execGit(projectPath, args)
    } catch (error) {
      // Step 5: If removal failed without force, retry with force
      let lastError: unknown = error
      if (!force) {
        try {
          await this.execGit(projectPath, ['worktree', 'remove', '--force', gitPath])
          return
        } catch (forceError) {
          // Prefer the force-retry error since it's more relevant
          lastError = forceError
        }
      }

      // Step 6: Final fallback - prune again and check if it's gone
      try {
        await this.execGit(projectPath, ['worktree', 'prune'])
        const remaining = await this.listWorktrees(projectPath)
        const stillExists = remaining.some(
          wt => this.normalizePath(wt.path) === normalizedTarget
        )
        if (!stillExists) {
          return // Successfully removed via prune
        }
      } catch {
        // Prune failed
      }

      // Re-throw with detailed error message (use the most recent error)
      const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)

      // Parse git error and provide actionable message
      let userMessage = `Failed to remove worktree at ${worktreePath}`
      if (errorMessage.includes('contains modified or untracked files')) {
        userMessage += ': Has uncommitted changes (use force to override)'
      } else if (errorMessage.includes('is locked')) {
        userMessage += ': Worktree is locked'
      } else if (errorMessage.includes('not a valid directory') || errorMessage.includes('does not exist')) {
        userMessage += ': Directory not found (may have been manually deleted)'
      } else if (errorMessage.includes('Permission denied') || errorMessage.includes('EBUSY')) {
        userMessage += ': Directory is in use by another process'
      } else {
        userMessage += `: ${errorMessage}`
      }

      throw new Error(userMessage)
    }
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
      // Assume dirty on error to avoid bypassing safety checks
      return true
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
    const normalizedCheck = this.normalizePath(checkPath)
    const normalizedWorktrees = this.normalizePath(worktreesDir)
    return normalizedCheck === normalizedWorktrees ||
      normalizedCheck.startsWith(normalizedWorktrees + path.sep)
  }
}
