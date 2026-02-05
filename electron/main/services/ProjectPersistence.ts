import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

type ProjectType = 'code' | 'workspace'

interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: number
  sortOrder: number
}

interface Worktree {
  id: string
  projectId: string
  name: string
  branch: string
  path: string
  createdAt: number
  isLocked: boolean
}

interface PersistedState {
  version: number
  projects: Project[]
  worktrees: Record<string, Worktree[]>  // projectId -> worktrees
}

const STATE_VERSION = 3

export class ProjectPersistence {
  private stateFilePath: string
  private state: PersistedState

  constructor() {
    const userDataPath = app.getPath('userData')
    this.stateFilePath = path.join(userDataPath, 'projects.json')
    this.state = this.loadState()
  }

  private loadState(): PersistedState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8')
        const parsed = JSON.parse(data)

        // Validate structure before using
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.projects)) {
          // Handle version migrations if needed
          if (parsed.version !== STATE_VERSION) {
            return this.migrateState(parsed)
          }

          return parsed as PersistedState
        } else {
          console.warn('Invalid state file structure, using default state')
        }
      }
    } catch (error) {
      console.error('Failed to load state:', error)
    }

    return {
      version: STATE_VERSION,
      projects: [],
      worktrees: {},
    }
  }

  private migrateState(oldState: { version: number; projects: Project[]; worktrees?: Record<string, Worktree[]> }): PersistedState {
    // Migrate from version 1 to 2: add worktrees
    if (oldState.version === 1) {
      // First migrate to v2, then to v3
      const v2State = {
        version: 2,
        projects: oldState.projects,
        worktrees: {},
      }
      return this.migrateState(v2State)
    }

    // Migrate from version 2 to 3: add project type
    if (oldState.version === 2) {
      const migratedProjects = oldState.projects.map(p => ({
        ...p,
        type: 'code' as const,
      }))
      return {
        version: STATE_VERSION,
        projects: migratedProjects,
        worktrees: oldState.worktrees ?? {},
      }
    }

    // Default migration: ensure worktrees exist
    return {
      version: STATE_VERSION,
      projects: oldState.projects,
      worktrees: oldState.worktrees ?? {},
    }
  }

  private saveState(): void {
    try {
      const dirPath = path.dirname(this.stateFilePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.stateFilePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf-8')
      fs.renameSync(tempPath, this.stateFilePath)
    } catch (error) {
      console.error('Failed to save state:', error)
    }
  }

  getProjects(): Project[] {
    return [...this.state.projects].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  addProject(projectPath: string, name?: string, type: ProjectType = 'code'): Project {
    // Check if project already exists
    const existing = this.state.projects.find(p => p.path === projectPath)
    if (existing) {
      return existing
    }

    // Extract name from path if not provided
    const projectName = name || path.basename(projectPath)

    const project: Project = {
      id: randomUUID(),
      name: projectName,
      path: projectPath,
      type,
      createdAt: Date.now(),
      sortOrder: this.state.projects.length,
    }

    this.state.projects.push(project)
    this.saveState()

    return project
  }

  removeProject(id: string): void {
    const index = this.state.projects.findIndex(p => p.id === id)
    if (index !== -1) {
      this.state.projects.splice(index, 1)

      // Update sort orders
      this.state.projects.forEach((p, i) => {
        p.sortOrder = i
      })

      this.saveState()
    }
  }

  updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): Project | null {
    const project = this.state.projects.find(p => p.id === id)
    if (project) {
      Object.assign(project, updates)
      this.saveState()
      return project
    }
    return null
  }

  reorderProjects(projectIds: string[]): void {
    // Create a map for quick lookup
    const projectMap = new Map(this.state.projects.map(p => [p.id, p]))

    // Update sort orders based on new order
    projectIds.forEach((id, index) => {
      const project = projectMap.get(id)
      if (project) {
        project.sortOrder = index
      }
    })

    this.saveState()
  }

  // Worktree methods
  getWorktrees(projectId: string): Worktree[] {
    return this.state.worktrees[projectId] ?? []
  }

  getAllWorktrees(): Record<string, Worktree[]> {
    return { ...this.state.worktrees }
  }

  getWorktreeById(worktreeId: string): Worktree | null {
    for (const projectWorktrees of Object.values(this.state.worktrees)) {
      const worktree = projectWorktrees.find(w => w.id === worktreeId)
      if (worktree) return worktree
    }
    return null
  }

  addWorktree(worktree: Worktree): Worktree {
    if (!this.state.worktrees[worktree.projectId]) {
      this.state.worktrees[worktree.projectId] = []
    }

    // Check for duplicate path
    const existing = this.state.worktrees[worktree.projectId].find(
      w => w.path === worktree.path
    )
    if (existing) {
      return existing
    }

    this.state.worktrees[worktree.projectId].push(worktree)
    this.saveState()

    return worktree
  }

  removeWorktree(worktreeId: string): void {
    for (const projectId of Object.keys(this.state.worktrees)) {
      const index = this.state.worktrees[projectId].findIndex(w => w.id === worktreeId)
      if (index !== -1) {
        this.state.worktrees[projectId].splice(index, 1)
        this.saveState()
        return
      }
    }
  }

  updateWorktree(worktreeId: string, updates: Partial<Omit<Worktree, 'id' | 'projectId' | 'createdAt'>>): Worktree | null {
    for (const projectWorktrees of Object.values(this.state.worktrees)) {
      const worktree = projectWorktrees.find(w => w.id === worktreeId)
      if (worktree) {
        Object.assign(worktree, updates)
        this.saveState()
        return worktree
      }
    }
    return null
  }

  // Remove all worktrees for a project (called when project is removed)
  removeProjectWorktrees(projectId: string): void {
    if (this.state.worktrees[projectId]) {
      delete this.state.worktrees[projectId]
      this.saveState()
    }
  }
}
