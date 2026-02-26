import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { GitEvent } from './GitHubService'

// Types duplicated here due to Electron process isolation. Keep in sync with src/types/index.ts
type AutomationRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

type AutomationTrigger =
  | { type: 'schedule'; cron: string }
  | { type: 'claude-done'; projectId?: string }
  | { type: 'git-event'; event: GitEvent }
  | { type: 'file-change'; patterns: string[]; cooldownSeconds: number }

interface Automation {
  id: string
  name: string
  prompt: string
  projectIds: string[]
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
  status: AutomationRunStatus
  startedAt: string
  completedAt?: string
  result?: string
  sessionId?: string
  exitCode?: number
  durationMs?: number
  error?: string
  read: boolean
  worktreeBranch?: string
  prUrl?: string
  prNumber?: number
}

interface AutomationState {
  version: number
  automations: Automation[]
}

interface AutomationRunState {
  version: number
  runs: AutomationRun[]
}

const STATE_VERSION = 1
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
    return this.automationState.automations.find(a => a.id === id) ?? null
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

  updateAutomation(id: string, updates: Partial<Omit<Automation, 'id' | 'createdAt'>>): Automation | null {
    const automation = this.automationState.automations.find(a => a.id === id)
    if (!automation) return null

    Object.assign(automation, updates, { updatedAt: new Date().toISOString() })
    this.saveAutomations()
    return automation
  }

  removeAutomation(id: string): void {
    const index = this.automationState.automations.findIndex(a => a.id === id)
    if (index !== -1) {
      this.automationState.automations.splice(index, 1)
      this.saveAutomations()
      // Also remove associated runs
      this.runState.runs = this.runState.runs.filter(r => r.automationId !== id)
      this.saveRuns()
    }
  }

  removeProjectFromAutomations(projectId: string): void {
    let changed = false
    for (const automation of this.automationState.automations) {
      const idx = automation.projectIds.indexOf(projectId)
      if (idx !== -1) {
        automation.projectIds.splice(idx, 1)
        if (automation.projectIds.length === 0) {
          automation.enabled = false
        }
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
      runs = runs.filter(r => r.automationId === automationId)
    }
    // Newest first
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    if (limit && limit > 0) {
      runs = runs.slice(0, limit)
    }
    return runs
  }

  getRun(id: string): AutomationRun | null {
    return this.runState.runs.find(r => r.id === id) ?? null
  }

  getUnreadCount(): number {
    return this.runState.runs.filter(r => !r.read && r.status !== 'running').length
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

  updateRun(id: string, updates: Partial<Omit<AutomationRun, 'id' | 'automationId'>>): AutomationRun | null {
    const run = this.runState.runs.find(r => r.id === id)
    if (!run) return null

    Object.assign(run, updates)
    this.saveRuns()
    return run
  }

  removeRun(id: string): void {
    const index = this.runState.runs.findIndex(r => r.id === id)
    if (index !== -1) {
      this.runState.runs.splice(index, 1)
      this.saveRuns()
    }
  }

  markRunningAsFailed(): number {
    let count = 0
    for (const run of this.runState.runs) {
      if (run.status === 'running') {
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
    // Group by automationId, keep max MAX_RUNS_PER_AUTOMATION per automation
    const byAutomation = new Map<string, AutomationRun[]>()
    for (const run of this.runState.runs) {
      const list = byAutomation.get(run.automationId) ?? []
      list.push(run)
      byAutomation.set(run.automationId, list)
    }

    const kept: AutomationRun[] = []
    for (const [, runs] of byAutomation) {
      runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      kept.push(...runs.slice(0, MAX_RUNS_PER_AUTOMATION))
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
      console.error('Failed to load automations:', error)
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
      console.error('Failed to load automation runs:', error)
    }
    return { version: STATE_VERSION, runs: [] }
  }

  private migrateAutomationState(_oldState: { version: number; automations: Automation[] }): AutomationState {
    // v1 is the first version, no migrations needed yet
    return { version: STATE_VERSION, automations: _oldState.automations ?? [] }
  }

  private migrateRunState(_oldState: { version: number; runs: AutomationRun[] }): AutomationRunState {
    return { version: STATE_VERSION, runs: _oldState.runs ?? [] }
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
      console.error(`Failed to save ${filePath}:`, error)
    }
  }
}

export type { Automation, AutomationTrigger, AutomationRun, AutomationRunStatus }
