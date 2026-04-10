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
  ownsBranch: boolean
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
    return new Map(this.activeRuns)
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
    const { timeoutMinutes = 30, baseBranch, sourceBranch } = options
    const timeoutMs = timeoutMinutes * 60 * 1000
    const startTime = Date.now()

    // Create worktree (serialized to prevent concurrent git operations)
    // Always create a NEW branch named after the automation run. Use sourceBranch
    // (from PR context) or baseBranch (from automation config) as the starting point.
    const worktreeDirName = this.makeBranchName(automationId)
    const branchName = worktreeDirName
    const startPoint = sourceBranch || baseBranch
    let worktreePath: string

    try {
      if (startPoint) {
        try {
          worktreePath = await this.serializedWorktreeCreate(projectPath, worktreeDirName, undefined, startPoint)
        } catch (error) {
          console.warn(`[AutomationRunner] Failed to branch from "${startPoint}", falling back to HEAD: ${error instanceof Error ? error.message : String(error)}`)
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

    // Capture starting commit so we can detect new commits after the run
    const startCommit = await this.getHeadCommit(worktreePath)

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
        ownsBranch: true,
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
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)

        // If destroy() already cleared the map, it owns worktree cleanup
        const ownsCleanup = this.activeRuns.delete(runId)

        try {
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

          // Only do worktree cleanup if destroy() hasn't taken ownership
          let hasChanges = false
          if (ownsCleanup) {
            hasChanges = await this.worktreeHasChanges(worktreePath, startCommit)
            if (!hasChanges) {
              await this.cleanupWorktree(projectPath, worktreePath, branchName)
            }
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
            worktreePath: ownsCleanup && hasChanges ? worktreePath : '',
          })
        } catch (err) {
          resolve({
            success: false,
            output: '',
            exitCode,
            timedOut: false,
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
            worktreeBranch: branchName,
            worktreePath: '',
          })
        }
      })

      child.on('error', async (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)

        const ownsCleanup = this.activeRuns.delete(runId)

        if (ownsCleanup) {
          await this.cleanupWorktree(projectPath, worktreePath, branchName)
        }

        resolve({
          success: false,
          output: '',
          exitCode: null,
          timedOut: false,
          durationMs: Date.now() - startTime,
          error: err.message,
          worktreeBranch: branchName,
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
    // Snapshot and clear before killing — close/error handlers check the map
    // to decide whether destroy() owns cleanup, so clearing first prevents
    // concurrent cleanup races
    const runs = [...this.activeRuns.values()]
    this.activeRuns.clear()

    for (const run of runs) {
      this.killProcess(run.process)
    }

    // Wait for Windows handle release
    if (runs.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Force cleanup all worktrees (close handlers skipped cleanup since map was cleared)
    for (const run of runs) {
      try {
        await this.cleanupWorktree(run.projectPath, run.worktreePath, run.ownsBranch ? run.worktreeBranch : null)
      } catch {
        // Best-effort cleanup
      }
    }
  }

  async garbageCollectWorktrees(projectPath: string): Promise<number> {
    let cleaned = 0
    try {
      const worktrees = await this.worktreeService.listWorktrees(projectPath)
      const maxAgeMs = 24 * 60 * 60 * 1000 // 24 hours

      // Collect paths of active runs to avoid deleting in-use worktrees
      const activeWorktreePaths = new Set(
        [...this.activeRuns.values()].map(r => r.worktreePath)
      )

      for (const wt of worktrees) {
        if (wt.isMain || !wt.branch.startsWith('auto-')) continue
        if (activeWorktreePaths.has(wt.path)) continue

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

  private async serializedWorktreeCreate(projectPath: string, branchName: string, worktreeName?: string, sourceBranch?: string): Promise<string> {
    const op = this.worktreeLock.then(async () => {
      const result = await this.worktreeService.createWorktree(projectPath, branchName, worktreeName, sourceBranch)
      return result.path
    })
    // Keep the lock chain alive regardless of success/failure so subsequent
    // operations aren't blocked or poisoned by a prior rejection
    this.worktreeLock = op.then(() => {}, () => {})
    return op
  }

  private async worktreeHasChanges(worktreePath: string, startCommit: string | null): Promise<boolean> {
    try {
      // Check for uncommitted changes
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
        windowsHide: true,
      })
      if (status.trim().length > 0) return true

      // Check for new commits since the run started.
      // Claude typically commits its work, so git status alone would miss it
      // and the worktree + branch would be deleted, destroying the automation's output.
      if (startCommit) {
        const currentCommit = await this.getHeadCommit(worktreePath)
        if (currentCommit && currentCommit !== startCommit) return true
      }

      return false
    } catch {
      // Assume changes exist on error to avoid destroying work
      return true
    }
  }

  private async getHeadCommit(worktreePath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: worktreePath,
        windowsHide: true,
      })
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  private async cleanupWorktree(projectPath: string, worktreePath: string, branchName: string | null): Promise<void> {
    try {
      await this.worktreeService.removeWorktree(projectPath, worktreePath, true)
    } catch (error) {
      console.error(`[AutomationRunner] Failed to remove worktree: ${error}`)
    }

    if (branchName) {
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
