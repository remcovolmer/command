import { spawn, ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorktreeService } from './WorktreeService'

const execFileAsync = promisify(execFile)

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10MB

export interface RunResult {
  success: boolean
  output: string
  sessionId?: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  error?: string
  worktreeBranch: string
  worktreePath: string
}

export interface ActiveRun {
  runId: string
  automationId: string
  process: ChildProcess
  controller: AbortController
  worktreePath: string
  worktreeBranch: string
  projectPath: string
}

export class AutomationRunner {
  private worktreeService: WorktreeService
  private activeRuns: Map<string, ActiveRun> = new Map()
  // Serialization lock to prevent concurrent worktree operations on same repo
  private worktreeLock: Promise<void> = Promise.resolve()

  constructor(worktreeService: WorktreeService) {
    this.worktreeService = worktreeService
  }

  getActiveRuns(): Map<string, ActiveRun> {
    return this.activeRuns
  }

  isRunning(automationId: string): boolean {
    for (const run of this.activeRuns.values()) {
      if (run.automationId === automationId) return true
    }
    return false
  }

  async run(
    runId: string,
    automationId: string,
    prompt: string,
    projectPath: string,
    options: {
      timeoutMinutes?: number
      baseBranch?: string
      sourceBranch?: string
    } = {}
  ): Promise<RunResult> {
    const { timeoutMinutes = 30, sourceBranch } = options
    const timeoutMs = timeoutMinutes * 60 * 1000
    const startTime = Date.now()

    // Create worktree (serialized to prevent concurrent git operations)
    const worktreeDirName = this.makeBranchName(automationId)
    let branchName = worktreeDirName
    let worktreePath: string

    try {
      if (sourceBranch) {
        try {
          worktreePath = await this.serializedWorktreeCreate(projectPath, sourceBranch, worktreeDirName)
          branchName = sourceBranch
        } catch (error) {
          console.warn(`[AutomationRunner] Failed to checkout source branch "${sourceBranch}", falling back to HEAD: ${error instanceof Error ? error.message : String(error)}`)
          worktreePath = await this.serializedWorktreeCreate(projectPath, worktreeDirName)
        }
      } else {
        worktreePath = await this.serializedWorktreeCreate(projectPath, worktreeDirName)
      }
    } catch (error) {
      return {
        success: false,
        output: '',
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startTime,
        error: `Worktree creation failed: ${error instanceof Error ? error.message : String(error)}`,
        worktreeBranch: worktreeDirName,
        worktreePath: '',
      }
    }

    const controller = new AbortController()

    return new Promise<RunResult>((resolve) => {
      const args = [
        '-p', prompt,
        '--output-format', 'json',
        '--dangerously-skip-permissions',
      ]

      const child = spawn('claude', args, {
        cwd: worktreePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env },
      })

      const activeRun: ActiveRun = {
        runId,
        automationId,
        process: child,
        controller,
        worktreePath,
        worktreeBranch: branchName,
        projectPath,
      }
      this.activeRuns.set(runId, activeRun)

      const chunks: Buffer[] = []
      let totalBytes = 0
      let stderrBytes = 0
      let timedOut = false
      let killed = false
      let settled = false

      // Timeout
      const timer = setTimeout(() => {
        timedOut = true
        this.killProcess(child)
      }, timeoutMs)

      // Abort signal
      const onAbort = () => {
        killed = true
        this.killProcess(child)
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })

      const cleanup = () => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
        this.activeRuns.delete(runId)
      }

      // Collect stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > MAX_OUTPUT_BYTES) {
          killed = true
          this.killProcess(child)
          return
        }
        chunks.push(chunk)
      })

      // Collect stderr (with size limit matching stdout)
      const stderrChunks: Buffer[] = []
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        if (stderrBytes <= MAX_OUTPUT_BYTES) {
          stderrChunks.push(chunk)
        }
      })

      child.on('close', async (exitCode) => {
        if (settled) return
        settled = true
        cleanup()

        const rawOutput = Buffer.concat(chunks).toString('utf-8')
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')
        const durationMs = Date.now() - startTime

        // Parse JSON output
        let output = rawOutput
        let sessionId: string | undefined
        try {
          const parsed = JSON.parse(rawOutput)
          output = parsed.result || rawOutput
          sessionId = parsed.session_id
        } catch {
          // Not valid JSON, use raw output
        }

        // Check if worktree has uncommitted changes
        const hasUncommitted = await this.worktreeHasChanges(worktreePath)

        // Cleanup worktree if no uncommitted changes (commits already live on branch/remote)
        if (!hasUncommitted) {
          await this.cleanupWorktree(projectPath, worktreePath, branchName)
        }

        resolve({
          success: exitCode === 0 && !timedOut && !killed,
          output,
          sessionId,
          exitCode,
          timedOut,
          durationMs,
          error: timedOut
            ? `Timed out after ${timeoutMinutes} minutes`
            : killed && totalBytes > MAX_OUTPUT_BYTES
              ? `Output exceeded ${MAX_OUTPUT_BYTES} bytes`
              : exitCode !== 0
                ? stderr || `Process exited with code ${exitCode}`
                : undefined,
          worktreeBranch: branchName,
          worktreePath: hasUncommitted ? worktreePath : '',
        })
      })

      child.on('error', async (err) => {
        if (settled) return
        settled = true
        cleanup()

        await this.cleanupWorktree(projectPath, worktreePath, branchName)

        resolve({
          success: false,
          output: '',
          exitCode: null,
          timedOut: false,
          durationMs: Date.now() - startTime,
          error: err.message,
          worktreeBranch: '',
          worktreePath: '',
        })
      })
    })
  }

  stopRun(runId: string): void {
    const run = this.activeRuns.get(runId)
    if (run) {
      run.controller.abort()
    }
  }

  async destroy(): Promise<void> {
    // Snapshot runs before killing — close handlers delete from activeRuns during the wait
    const runsToClean = Array.from(this.activeRuns.values())

    // Kill all running processes
    for (const run of runsToClean) {
      this.killProcess(run.process)
    }

    // Wait for Windows handle release
    if (runsToClean.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Force-cleanup all worktrees (close handlers may have skipped those with uncommitted changes)
    for (const run of runsToClean) {
      try {
        await this.cleanupWorktree(run.projectPath, run.worktreePath, run.worktreeBranch)
      } catch {
        // Best-effort cleanup
      }
    }

    this.activeRuns.clear()
  }

  async garbageCollectWorktrees(projectPath: string): Promise<number> {
    let cleaned = 0
    try {
      const worktrees = await this.worktreeService.listWorktrees(projectPath)
      const maxAgeMs = 24 * 60 * 60 * 1000 // 24 hours

      for (const wt of worktrees) {
        if (wt.isMain || !wt.branch.startsWith('auto-')) continue

        // Parse timestamp from branch name (auto-{name}-{timestamp})
        const timestampMatch = wt.branch.match(/-(\d{13,})$/)
        if (!timestampMatch) continue

        const createdAt = parseInt(timestampMatch[1], 10)
        const age = Date.now() - createdAt

        if (age > maxAgeMs) {
          console.log(`[AutomationRunner] GC: removing orphaned worktree ${wt.branch} (age: ${Math.round(age / 3600000)}h)`)
          await this.cleanupWorktree(projectPath, wt.path, wt.branch)
          cleaned++
        }
      }
    } catch (error) {
      console.error('[AutomationRunner] GC failed:', error)
    }
    return cleaned
  }

  // --- Private helpers ---

  private makeBranchName(automationId: string): string {
    // auto-{first8charsOfId}-{timestamp}
    const shortId = automationId.substring(0, 8)
    return `auto-${shortId}-${Date.now()}`
  }

  private async serializedWorktreeCreate(projectPath: string, branchName: string, worktreeName?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.worktreeLock = this.worktreeLock.then(async () => {
        try {
          const result = await this.worktreeService.createWorktree(projectPath, branchName, worktreeName)
          resolve(result.path)
        } catch (error) {
          reject(error)
        }
      }).catch(reject)
    })
  }

  private async worktreeHasChanges(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
        windowsHide: true,
      })
      return stdout.trim().length > 0
    } catch {
      return false
    }
  }

  private async cleanupWorktree(projectPath: string, worktreePath: string, branchName: string): Promise<void> {
    try {
      await this.worktreeService.removeWorktree(projectPath, worktreePath, true)
    } catch (error) {
      console.error(`[AutomationRunner] Failed to remove worktree: ${error}`)
    }

    try {
      await execFileAsync('git', ['branch', '-D', branchName], {
        cwd: projectPath,
        windowsHide: true,
        timeout: 10_000,
      })
    } catch {
      // Branch may already be deleted
    }
  }

  private killProcess(child: ChildProcess): void {
    if (!child.pid) return

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill('SIGTERM')
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already dead */ }
        }, 5000)
      }
    } catch {
      // Process already exited
    }
  }
}
