import { type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { AutomationPersistence } from './AutomationPersistence'
import { AutomationRunner } from './AutomationRunner'
import type { Automation, AutomationRun } from './AutomationPersistence'
import type { WorktreeService } from './WorktreeService'
import type { ProjectPersistence } from './ProjectPersistence'
import type { ClaudeHookWatcher } from './ClaudeHookWatcher'
import type { GitHubService, GitEvent, PREventContext } from './GitHubService'
import type { FileWatcherService } from './FileWatcherService'
import { createLogger } from './Logger'

const log = createLogger('AutomationService')

const MAX_CONCURRENT_RUNS = 3
const MISSED_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export class AutomationService {
  private window: BrowserWindow | null = null
  private persistence: AutomationPersistence
  private runner: AutomationRunner
  private worktreeService: WorktreeService
  private projectPersistence: ProjectPersistence | null = null
  private githubService: GitHubService | null = null

  // Track running automations to enforce concurrency
  private runningCount = 0

  // Cron schedulers keyed by automation ID
  private schedulerMap: Map<string, Cron> = new Map()

  // Event trigger unsubscribers
  private eventUnsubscribers: Array<() => void> = []

  // Cooldown tracking for file-change triggers (automationId → lastTriggeredAt)
  private fileChangeCooldowns: Map<string, number> = new Map()

  constructor(worktreeService: WorktreeService) {
    this.persistence = new AutomationPersistence()
    this.runner = new AutomationRunner(worktreeService)
    this.worktreeService = worktreeService

    // Mark any runs that were 'running' from a previous crash as failed
    const marked = this.persistence.markRunningAsFailed()
    if (marked > 0) {
      log.info(`Marked ${marked} interrupted run(s) as failed`)
    }
  }

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  setProjectPersistence(pp: ProjectPersistence): void {
    this.projectPersistence = pp
  }

  // --- Scheduler lifecycle ---

  startAllSchedulers(): void {
    const automations = this.persistence.getAutomations()
    for (const automation of automations) {
      if (automation.enabled && automation.trigger.type === 'schedule') {
        this.startScheduler(automation)
      }
    }
    log.info(`Started ${this.schedulerMap.size} scheduler(s)`)
  }

  checkMissedRuns(): void {
    const automations = this.persistence.getAutomations()
    const now = Date.now()

    for (const automation of automations) {
      if (!automation.enabled || automation.trigger.type !== 'schedule') continue

      try {
        // Use croner to find when the previous run should have been
        const cron = new Cron(automation.trigger.cron)
        const nextRun = cron.nextRun()
        if (!nextRun) continue

        // Check if a run was missed: lastRunAt is older than one full cron interval ago
        const lastRunTime = automation.lastRunAt ? new Date(automation.lastRunAt).getTime() : 0
        const prevRun = cron.previousRun()
        if (!prevRun) continue

        const prevRunTime = prevRun.getTime()
        if (prevRunTime > lastRunTime && now - prevRunTime < MISSED_RUN_MAX_AGE_MS) {
          log.info(`Missed run detected for "${automation.name}", triggering`)
          this.triggerForProject(automation)
        }
      } catch (error) {
        log.error(`Error checking missed runs for ${automation.id}:`, error)
      }
    }
  }

  getNextRunTime(automationId: string): string | null {
    const cron = this.schedulerMap.get(automationId)
    if (!cron) return null
    const next = cron.nextRun()
    return next ? next.toISOString() : null
  }

  private startScheduler(automation: Automation): void {
    // Stop existing scheduler if any
    this.stopScheduler(automation.id)

    if (automation.trigger.type !== 'schedule') return

    try {
      const cron = new Cron(automation.trigger.cron, () => {
        log.info(`Cron fired for "${automation.name}"`)
        this.triggerForProject(automation)
      })
      this.schedulerMap.set(automation.id, cron)
    } catch (error) {
      log.error(`Invalid cron for ${automation.id}:`, error)
    }
  }

  private stopScheduler(automationId: string): void {
    const existing = this.schedulerMap.get(automationId)
    if (existing) {
      existing.stop()
      this.schedulerMap.delete(automationId)
    }
  }

  private stopAllSchedulers(): void {
    for (const cron of this.schedulerMap.values()) {
      cron.stop()
    }
    this.schedulerMap.clear()
  }

  private triggerForProject(automation: Automation): void {
    if (!this.projectPersistence) return

    const project = this.projectPersistence
      .getProjects()
      .find((p) => p.id === automation.projectId)
    if (project) {
      this.triggerRun(automation.id, project.path, project.id).catch((err) => {
        log.error(`Trigger failed for project ${automation.projectId}:`, err)
      })
    }
  }

  // --- Event trigger registration ---

  registerEventTriggers(
    hookWatcher: ClaudeHookWatcher,
    githubService: GitHubService,
    fileWatcherService: FileWatcherService
  ): void {
    this.githubService = githubService

    // 1. Claude "done" trigger
    const unsubHook = hookWatcher.addStateChangeListener((_terminalId, state) => {
      if (state !== 'done') return
      this.handleClaudeDoneTrigger()
    })
    this.eventUnsubscribers.push(unsubHook)

    // 2. Git PR event trigger
    const unsubPR = githubService.onPREvent((projectPath, event, prContext) => {
      this.handleGitEventTrigger(projectPath, event, prContext)
    })
    this.eventUnsubscribers.push(unsubPR)

    // 3. File change trigger
    const unsubFile = fileWatcherService.onFileChanges((events) => {
      this.handleFileChangeTrigger(events)
    })
    this.eventUnsubscribers.push(unsubFile)

    log.info('Event triggers registered')
  }

  private handleClaudeDoneTrigger(): void {
    const automations = this.persistence.getAutomations()
    for (const automation of automations) {
      if (!automation.enabled || automation.trigger.type !== 'claude-done') continue
      this.triggerForProject(automation)
    }
  }

  private handleGitEventTrigger(
    projectPath: string,
    event: GitEvent,
    prContext: PREventContext
  ): void {
    if (!this.projectPersistence) return

    const projects = this.projectPersistence.getProjects()
    const project = projects.find((p) => p.path === projectPath)
    if (!project) return

    const automations = this.persistence.getAutomations()
    for (const automation of automations) {
      if (!automation.enabled || automation.trigger.type !== 'git-event') continue
      if (automation.trigger.event !== event) continue
      if (automation.projectId !== project.id) continue

      this.triggerRun(automation.id, project.path, project.id, prContext).catch((err) => {
        log.error(`Git event trigger failed:`, err)
      })
    }
  }

  private handleFileChangeTrigger(
    events: Array<{ type: string; projectId: string; path: string }>
  ): void {
    if (!this.projectPersistence || events.length === 0) return

    const projects = this.projectPersistence.getProjects()
    const automations = this.persistence.getAutomations()
    const now = Date.now()

    // Group events by projectId
    const projectIds = new Set(events.map((e) => e.projectId))

    for (const automation of automations) {
      if (!automation.enabled || automation.trigger.type !== 'file-change') continue

      const cooldownMs = (automation.trigger.cooldownSeconds ?? 60) * 1000
      const lastTriggered = this.fileChangeCooldowns.get(automation.id) ?? 0
      if (now - lastTriggered < cooldownMs) continue

      // Check if any events match this automation's project and patterns
      for (const projectId of projectIds) {
        if (automation.projectId !== projectId) continue

        const projectEvents = events.filter((e) => e.projectId === projectId)
        const matches = projectEvents.some(
          (e) =>
            automation.trigger.type === 'file-change' &&
            automation.trigger.patterns.some((pattern) => this.matchGlob(e.path, pattern))
        )

        if (matches) {
          const project = projects.find((p) => p.id === projectId)
          if (project) {
            this.fileChangeCooldowns.set(automation.id, now)
            this.triggerRun(automation.id, project.path, project.id).catch((err) => {
              log.error(`File change trigger failed:`, err)
            })
            break // Only trigger once per automation per batch
          }
        }
      }
    }
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching: convert glob pattern to regex
    // Supports * (any chars except /) and ** (any path segments)
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
    try {
      return new RegExp(`^${escaped}$`, 'i').test(filePath)
    } catch {
      return false
    }
  }

  // --- CRUD (delegates to persistence) ---

  getAutomations(): Automation[] {
    return this.persistence.getAutomations()
  }

  getAutomation(id: string): Automation | null {
    return this.persistence.getAutomation(id)
  }

  createAutomation(data: Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>): Automation {
    const automation = this.persistence.addAutomation(data)
    if (automation.enabled && automation.trigger.type === 'schedule') {
      this.startScheduler(automation)
    }
    return automation
  }

  updateAutomation(
    id: string,
    updates: Partial<Omit<Automation, 'id' | 'createdAt'>>
  ): Automation | null {
    const result = this.persistence.updateAutomation(id, updates)
    if (result) {
      // Re-evaluate scheduler: stop old, start new if needed
      this.stopScheduler(id)
      if (result.enabled && result.trigger.type === 'schedule') {
        this.startScheduler(result)
      }
    }
    return result
  }

  deleteAutomation(id: string): void {
    // Stop scheduler
    this.stopScheduler(id)
    // Stop any running runs for this automation
    for (const [runId, run] of this.runner.getActiveRuns()) {
      if (run.automationId === id) {
        this.runner.stopRun(runId)
      }
    }
    this.persistence.removeAutomation(id)
  }

  toggleAutomation(id: string): Automation | null {
    const automation = this.persistence.getAutomation(id)
    if (!automation) return null
    const toggled = this.persistence.updateAutomation(id, { enabled: !automation.enabled })
    if (toggled) {
      if (toggled.enabled && toggled.trigger.type === 'schedule') {
        this.startScheduler(toggled)
      } else {
        this.stopScheduler(id)
      }
    }
    return toggled
  }

  // --- Runs ---

  getRuns(automationId?: string, limit?: number): AutomationRun[] {
    return this.persistence.getRuns(automationId, limit)
  }

  getUnreadCount(): number {
    return this.persistence.getUnreadCount()
  }

  markRunRead(runId: string): void {
    this.persistence.updateRun(runId, { read: true })
  }

  deleteRun(runId: string): void {
    this.persistence.removeRun(runId)
  }

  clearAllRuns(): void {
    this.persistence.clearAllRuns()
  }

  async checkPRForRun(runId: string): Promise<AutomationRun | null> {
    const run = this.persistence.getRun(runId)
    if (!run || !run.worktreeBranch || !this.githubService || !this.projectPersistence) return null

    const project = this.projectPersistence.getProjects().find((p) => p.id === run.projectId)
    if (!project) return null

    const pr = await this.githubService.getPRForBranch(project.path, run.worktreeBranch)
    if (!pr) return run

    const updated = this.persistence.updateRun(runId, { prUrl: pr.url, prNumber: pr.number })
    return updated
  }

  stopRun(runId: string): void {
    this.runner.stopRun(runId)
  }

  /**
   * Record a foreground launch as a run in the shared history timeline.
   * Foreground launches are interactive chats the user owns — there is no
   * headless process to track. The record is a "launched" marker linked to the
   * spawned terminal (link-back for the overview), so it is written as a
   * terminal-state run (completed) immediately: the live state lives in the
   * chat itself in the sidebar. Modeling it as a long-lived 'running' run would
   * never transition (no process to watch), so it would spin forever, never be
   * pruned, and grow automation-runs.json without bound. Not subject to the
   * headless concurrency cap.
   */
  recordForegroundLaunch(
    automationId: string,
    opts: { terminalId: string; worktreeBranch?: string }
  ): AutomationRun | null {
    const automation = this.persistence.getAutomation(automationId)
    if (!automation) {
      log.warn(`recordForegroundLaunch: automation ${automationId} not found`)
      return null
    }

    const now = new Date().toISOString()
    const run = this.persistence.addRun({
      automationId,
      projectId: automation.projectId,
      mode: 'foreground',
      status: 'completed',
      startedAt: now,
      completedAt: now,
      result: 'Launched in the foreground — opened an interactive session.',
      read: true, // user initiated it and is looking at it — nothing to triage
      terminalId: opts.terminalId,
      worktreeBranch: opts.worktreeBranch,
    })

    this.persistence.updateAutomation(automationId, { lastRunAt: now })
    this.sendToRenderer('automation:run-started', run)
    return run
  }

  // --- Trigger a run ---

  async triggerRun(
    automationId: string,
    projectPath: string,
    projectId: string,
    prContext?: PREventContext
  ): Promise<void> {
    const automation = this.persistence.getAutomation(automationId)
    if (!automation) {
      log.warn(`Automation ${automationId} not found`)
      return
    }

    // Concurrency checks
    if (this.runningCount >= MAX_CONCURRENT_RUNS) {
      log.warn(`Max concurrent runs (${MAX_CONCURRENT_RUNS}) reached, skipping`)
      return
    }
    if (this.runner.isRunning(automationId)) {
      log.warn(`Automation ${automationId} already running, skipping`)
      return
    }

    const runId = randomUUID()

    // Template replacement for PR context variables
    const sanitize = (s: string, maxLen = 200): string =>
      s
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[^\x20-\x7E]/g, '')
        .slice(0, maxLen)

    const templateVars: Record<string, string> = prContext
      ? {
          number: String(prContext.number),
          title: sanitize(prContext.title),
          branch: sanitize(prContext.branch),
          url: sanitize(prContext.url, 500),
          mergeable: prContext.mergeable,
          state: prContext.state,
        }
      : {}

    const resolvedPrompt = automation.prompt.replace(/\{\{pr\.(\w+)\}\}/g, (match, key: string) => {
      if (key in templateVars) return templateVars[key]
      if (prContext) {
        log.warn(`Unresolved template variable: ${match}`)
      }
      return ''
    })

    // Create run record
    const run = this.persistence.addRun({
      automationId,
      projectId,
      mode: 'headless',
      status: 'running',
      startedAt: new Date().toISOString(),
      read: false,
    })

    this.runningCount++
    this.sendToRenderer('automation:run-started', run)

    try {
      // Log when PR branch is empty (headRefName missing from API response)
      if (prContext && !prContext.branch && prContext.state !== 'MERGED') {
        log.warn(`PR #${prContext.number} has no branch name, worktree will use HEAD`)
      }

      const result = await this.runner.run(runId, automationId, resolvedPrompt, projectPath, {
        timeoutMinutes: automation.timeoutMinutes,
        baseBranch: automation.baseBranch,
        sourceBranch:
          prContext?.branch && prContext.state !== 'MERGED' ? prContext.branch : undefined,
      })

      // Update run with result
      const status: AutomationRun['status'] = result.timedOut
        ? 'timeout'
        : result.success
          ? 'completed'
          : 'failed'

      const runUpdate: Partial<AutomationRun> = {
        status,
        completedAt: new Date().toISOString(),
        result: result.output,
        sessionId: result.sessionId,
        exitCode: result.exitCode ?? undefined,
        durationMs: result.durationMs,
        error: result.error,
        worktreeBranch: result.worktreeBranch || undefined,
      }

      // Check if Claude created a PR from the worktree branch
      if (result.worktreeBranch && this.githubService && this.projectPersistence) {
        const project = this.projectPersistence.getProjects().find((p) => p.id === projectId)
        if (project) {
          const pr = await this.githubService.getPRForBranch(project.path, result.worktreeBranch)
          if (pr) {
            runUpdate.prUrl = pr.url
            runUpdate.prNumber = pr.number
          }
        }
      }

      const updatedRun = this.persistence.updateRun(run.id, runUpdate)

      // Update lastRunAt on the automation
      this.persistence.updateAutomation(automationId, {
        lastRunAt: new Date().toISOString(),
      })

      if (updatedRun) {
        const channel =
          status === 'completed' ? 'automation:run-completed' : 'automation:run-failed'
        this.sendToRenderer(channel, updatedRun)
      }
    } catch (error) {
      const updatedRun = this.persistence.updateRun(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      if (updatedRun) {
        this.sendToRenderer('automation:run-failed', updatedRun)
      }
    } finally {
      this.runningCount--
    }
  }

  // --- Project lifecycle ---

  onProjectDeleted(projectId: string): void {
    this.persistence.removeProjectFromAutomations(projectId)
  }

  // --- Cleanup ---

  async garbageCollectWorktrees(projectPaths: string[]): Promise<void> {
    for (const projectPath of projectPaths) {
      await this.runner.garbageCollectWorktrees(projectPath)
    }
  }

  async destroy(): Promise<void> {
    this.stopAllSchedulers()
    // Unsubscribe event triggers
    for (const unsub of this.eventUnsubscribers) {
      unsub()
    }
    this.eventUnsubscribers.length = 0
    await this.runner.destroy()
    // Mark any still-running runs as failed
    this.persistence.markRunningAsFailed()
  }

  // --- Private ---

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }
}
