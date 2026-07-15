import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { GitEvent } from './GitHubService'
import { createLogger } from './Logger'

const log = createLogger('AutomationPersistence')

// Types duplicated here due to Electron process isolation. Keep in sync with src/types/index.ts
type AutomationRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

type AutomationTarget = 'chat' | 'worktree'
type AutomationRunMode = 'foreground' | 'headless'

type AutomationTrigger =
  | { type: 'schedule'; cron: string }
  | { type: 'claude-done'; projectId?: string }
  | { type: 'git-event'; event: GitEvent }
  | { type: 'file-change'; patterns: string[]; cooldownSeconds: number }

interface Automation {
  id: string
  name: string
  prompt: string
  projectId: string
  defaultTarget: AutomationTarget
  trigger: AutomationTrigger
  enabled: boolean
  baseBranch?: string
  timeoutMinutes: number
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

interface AutomationRun {
  id: string
  automationId: string
  projectId: string
  mode: AutomationRunMode
  status: AutomationRunStatus
  startedAt: string
  completedAt?: string
  result?: string
  sessionId?: string
  exitCode?: number
  durationMs?: number
  error?: string
  read: boolean
  terminalId?: string
  worktreeBranch?: string
  prUrl?: string
  prNumber?: number
}

// v1 shapes retained for migration only (many-to-many projects, no mode/target)
interface AutomationV1 {
  projectIds?: string[]
  projectId?: string
  defaultTarget?: AutomationTarget
  enabled?: boolean
  [key: string]: unknown
}

interface AutomationState {
  version: number
  automations: Automation[]
}

interface AutomationRunState {
  version: number
  runs: AutomationRun[]
}

const STATE_VERSION = 2
const MAX_RUNS_PER_AUTOMATION = 50

export class AutomationPersistence {
  private automationsPath: string
  private runsPath: string
  private automationState: AutomationState
  private runState: AutomationRunState

  constructor() {
    const userDataPath = app.getPath('userData')
    this.automationsPath = path.join(userDataPath, 'automations.json')
    this.runsPath = path.join(userDataPath, 'automation-runs.json')
    this.automationState = this.loadAutomations()
    this.runState = this.loadRuns()
  }

  // --- Automation CRUD ---

  getAutomations(): Automation[] {
    return [...this.automationState.automations]
  }

  getAutomation(id: string): Automation | null {
    return this.automationState.automations.find((a) => a.id === id) ?? null
  }

  addAutomation(data: Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>): Automation {
    const now = new Date().toISOString()
    const automation: Automation = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.automationState.automations.push(automation)
    this.saveAutomations()
    return automation
  }

  updateAutomation(
    id: string,
    updates: Partial<Omit<Automation, 'id' | 'createdAt'>>
  ): Automation | null {
    const automation = this.automationState.automations.find((a) => a.id === id)
    if (!automation) return null

    Object.assign(automation, updates, { updatedAt: new Date().toISOString() })
    this.saveAutomations()
    return automation
  }

  removeAutomation(id: string): void {
    const index = this.automationState.automations.findIndex((a) => a.id === id)
    if (index !== -1) {
      this.automationState.automations.splice(index, 1)
      this.saveAutomations()
      // Also remove associated runs
      this.runState.runs = this.runState.runs.filter((r) => r.automationId !== id)
      this.saveRuns()
    }
  }

  removeProjectFromAutomations(projectId: string): void {
    // Single-project model: an automation whose only project is deleted is
    // disabled (its projectId is kept so the overview can flag it for reassignment).
    let changed = false
    for (const automation of this.automationState.automations) {
      if (automation.projectId === projectId && automation.enabled) {
        automation.enabled = false
        automation.updatedAt = new Date().toISOString()
        changed = true
      }
    }
    if (changed) this.saveAutomations()
  }

  // --- Run CRUD ---

  getRuns(automationId?: string, limit?: number): AutomationRun[] {
    let runs = [...this.runState.runs]
    if (automationId) {
      runs = runs.filter((r) => r.automationId === automationId)
    }
    // Newest first
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    if (limit && limit > 0) {
      runs = runs.slice(0, limit)
    }
    return runs
  }

  getRun(id: string): AutomationRun | null {
    return this.runState.runs.find((r) => r.id === id) ?? null
  }

  getUnreadCount(): number {
    return this.runState.runs.filter((r) => !r.read && r.status !== 'running').length
  }

  addRun(data: Omit<AutomationRun, 'id'>): AutomationRun {
    const run: AutomationRun = {
      ...data,
      id: randomUUID(),
    }
    this.runState.runs.push(run)
    this.pruneRuns()
    this.saveRuns()
    return run
  }

  updateRun(
    id: string,
    updates: Partial<Omit<AutomationRun, 'id' | 'automationId'>>
  ): AutomationRun | null {
    const run = this.runState.runs.find((r) => r.id === id)
    if (!run) {
      // A missing id here means the record was lost between addRun() and the
      // owning updateRun() — most likely a pruning bug. Surface it so the
      // silent-failure mode this guard was added against is debuggable.
      log.warn(`updateRun: no run with id ${id}; update dropped`)
      return null
    }

    Object.assign(run, updates)
    this.saveRuns()
    return run
  }

  removeRun(id: string): void {
    const index = this.runState.runs.findIndex((r) => r.id === id)
    if (index !== -1) {
      this.runState.runs.splice(index, 1)
      this.saveRuns()
    }
  }

  clearAllRuns(): void {
    this.runState.runs = this.runState.runs.filter((r) => r.status === 'running')
    this.saveRuns()
  }

  markRunningAsFailed(): number {
    // Only headless runs represent a tracked process that dies with the app.
    // Foreground launches are interactive chats that may restore across restarts,
    // so leave them alone.
    let count = 0
    for (const run of this.runState.runs) {
      if (run.status === 'running' && run.mode !== 'foreground') {
        run.status = 'failed'
        run.error = 'App closed during execution'
        run.completedAt = new Date().toISOString()
        count++
      }
    }
    if (count > 0) this.saveRuns()
    return count
  }

  // --- Private helpers ---

  private pruneRuns(): void {
    // Running runs are never pruned: their later updateRun() call would no-op
    // and the result (sessionId, exitCode, worktreeBranch, PR info) would be
    // silently dropped. Apply the cap to terminal-state runs only.
    const byAutomation = new Map<string, AutomationRun[]>()
    for (const run of this.runState.runs) {
      const list = byAutomation.get(run.automationId) ?? []
      list.push(run)
      byAutomation.set(run.automationId, list)
    }

    const kept: AutomationRun[] = []
    for (const [, runs] of byAutomation) {
      const running: AutomationRun[] = []
      const terminal: AutomationRun[] = []
      for (const run of runs) {
        ;(run.status === 'running' ? running : terminal).push(run)
      }
      terminal.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      kept.push(...running, ...terminal.slice(0, MAX_RUNS_PER_AUTOMATION))
    }
    this.runState.runs = kept
  }

  private loadAutomations(): AutomationState {
    try {
      if (fs.existsSync(this.automationsPath)) {
        const data = fs.readFileSync(this.automationsPath, 'utf-8')
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.automations)) {
          if (parsed.version !== STATE_VERSION) {
            return this.migrateAutomationState(parsed)
          }
          return parsed as AutomationState
        }
      }
    } catch (error) {
      log.error('Failed to load automations:', error)
    }
    return { version: STATE_VERSION, automations: [] }
  }

  private loadRuns(): AutomationRunState {
    try {
      if (fs.existsSync(this.runsPath)) {
        const data = fs.readFileSync(this.runsPath, 'utf-8')
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.runs)) {
          if (parsed.version !== STATE_VERSION) {
            return this.migrateRunState(parsed)
          }
          return parsed as AutomationRunState
        }
      }
    } catch (error) {
      log.error('Failed to load automation runs:', error)
    }
    return { version: STATE_VERSION, runs: [] }
  }

  private migrateAutomationState(oldState: {
    version: number
    automations: unknown[]
  }): AutomationState {
    // v1 → v2: collapse projectIds[] to a single projectId (first entry),
    // default the new defaultTarget to 'worktree' (matches prior headless behavior),
    // and disable any automation left without a project.
    const automations = (oldState.automations ?? []).map((raw) => {
      const a = raw as AutomationV1
      const projectId =
        typeof a.projectId === 'string'
          ? a.projectId
          : Array.isArray(a.projectIds)
            ? (a.projectIds[0] ?? '')
            : ''
      const defaultTarget: AutomationTarget = a.defaultTarget ?? 'worktree'
      const enabled = projectId ? (a.enabled ?? true) : false
      const { projectIds: _drop, ...rest } = a
      void _drop
      return { ...rest, projectId, defaultTarget, enabled } as unknown as Automation
    })
    return { version: STATE_VERSION, automations }
  }

  private migrateRunState(oldState: {
    version: number
    runs: unknown[]
  }): AutomationRunState {
    // v1 → v2: pre-foreground runs were all headless.
    const runs = (oldState.runs ?? []).map((raw) => {
      const r = raw as Partial<AutomationRun>
      return { ...r, mode: r.mode ?? 'headless' } as AutomationRun
    })
    return { version: STATE_VERSION, runs }
  }

  private saveAutomations(): void {
    this.atomicWrite(this.automationsPath, this.automationState)
  }

  private saveRuns(): void {
    this.atomicWrite(this.runsPath, this.runState)
  }

  private atomicWrite(filePath: string, data: unknown): void {
    try {
      const dirPath = path.dirname(filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      const tempPath = `${filePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tempPath, filePath)
    } catch (error) {
      log.error(`Failed to save ${filePath}:`, error)
    }
  }
}

export type {
  Automation,
  AutomationTrigger,
  AutomationRun,
  AutomationRunStatus,
  AutomationTarget,
  AutomationRunMode,
}
