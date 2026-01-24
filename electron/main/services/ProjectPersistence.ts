import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  sortOrder: number
}

interface PersistedState {
  version: number
  projects: Project[]
}

const STATE_VERSION = 1

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
            return this.migrateState(parsed as PersistedState)
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
    }
  }

  private migrateState(oldState: PersistedState): PersistedState {
    // For now, just return the state with updated version
    // Add migration logic here when schema changes
    return {
      ...oldState,
      version: STATE_VERSION,
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

  addProject(projectPath: string, name?: string): Project {
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
}
