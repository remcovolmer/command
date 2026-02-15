import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

// Types duplicated here due to Electron process isolation
export interface TaskItem {
  id: string
  text: string
  completed: boolean
  section: string
  filePath: string
  lineNumber: number
  dueDate?: string
  personTags?: string[]
  isOverdue?: boolean
  isDueToday?: boolean
}

export interface TaskSection {
  name: string
  priority: number
  tasks: TaskItem[]
}

export interface TasksData {
  sections: TaskSection[]
  files: string[]
  totalOpen: number
  nowCount: number
}

export interface TaskUpdate {
  filePath: string
  lineNumber: number
  action: 'toggle' | 'edit' | 'delete'
  newText?: string
}

export interface TaskMove {
  filePath: string
  lineNumber: number
  targetSection: string
}

export interface TaskAdd {
  filePath: string
  section: string
  text: string
}

// Section priorities for the 5 canonical sections
const SECTION_PRIORITIES: Record<string, number> = {
  now: 0, next: 1, waiting: 2, later: 3, done: 4,
}

const TASKS_FILENAME = 'TASKS.md'
const CHECKBOX_OPEN = '- [ ] '
const CHECKBOX_DONE = '- [x] '
const CHECKBOX_REGEX = /^- \[([ x])\] /
const DUE_DATE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/
const PERSON_TAG_REGEX = /\[\[([^\]]+)\]\]/g
const H2_REGEX = /^## (.+)$/

function mapSectionName(heading: string): { name: string; priority: number } {
  const lower = heading.toLowerCase().trim()
  const priority = SECTION_PRIORITIES[lower]
  if (priority !== undefined) {
    return { name: heading.trim(), priority }
  }
  return { name: heading.trim(), priority: -1 }
}

function computeDateFlags(dueDate: string | undefined): { isOverdue: boolean; isDueToday: boolean } {
  if (!dueDate) return { isOverdue: false, isDueToday: false }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  if (isNaN(due.getTime())) return { isOverdue: false, isDueToday: false }
  const todayStr = today.toISOString().slice(0, 10)
  return {
    isOverdue: due < today,
    isDueToday: dueDate === todayStr,
  }
}

function parseLine(line: string, filePath: string, lineNumber: number, section: string): TaskItem | null {
  const match = line.match(CHECKBOX_REGEX)
  if (!match) return null

  const completed = match[1] === 'x'
  // Strip bold markers - they're a file format detail, not part of the task text
  const rawText = line.slice(match[0].length)
  const text = rawText.replace(/\*\*/g, '')

  // Extract due date
  const dueDateMatch = text.match(DUE_DATE_REGEX)
  const dueDate = dueDateMatch ? dueDateMatch[1] : undefined

  // Extract person tags
  const personTags: string[] = []
  let personMatch: RegExpExecArray | null
  const personRegex = new RegExp(PERSON_TAG_REGEX.source, 'g')
  while ((personMatch = personRegex.exec(text)) !== null) {
    personTags.push(personMatch[1])
  }

  const { isOverdue, isDueToday } = computeDateFlags(dueDate)

  return {
    id: `${filePath}:${lineNumber}`,
    text,
    completed,
    section,
    filePath,
    lineNumber,
    ...(dueDate ? { dueDate } : {}),
    ...(personTags.length > 0 ? { personTags } : {}),
    ...(isOverdue ? { isOverdue } : {}),
    ...(isDueToday ? { isDueToday } : {}),
  }
}

export class TaskService {
  /**
   * Recursively scan for TASKS.md files (case-insensitive)
   */
  async scanForTaskFiles(projectPath: string): Promise<string[]> {
    const files: string[] = []
    await this.scanDirectory(projectPath, files, 0)
    return files
  }

  private async scanDirectory(dirPath: string, results: string[], depth: number): Promise<void> {
    // Limit recursion depth to prevent scanning into deeply nested dirs
    if (depth > 5) return

    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        // Skip hidden dirs and common large dirs
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
          continue
        }
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === TASKS_FILENAME.toLowerCase()) {
          results.push(fullPath)
        } else if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, results, depth + 1)
        }
      }
    } catch {
      // Ignore directories we can't read
    }
  }

  /**
   * Parse a single TASKS.md file into sections
   */
  parseTaskFile(content: string, filePath: string): TaskSection[] {
    const lines = content.split(/\r?\n/)
    const sections: TaskSection[] = []
    let currentSection: string | null = null
    let customPriority = 5

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const h2Match = line.match(H2_REGEX)

      if (h2Match) {
        const heading = h2Match[1]
        const mapped = mapSectionName(heading)

        const priority = mapped.priority >= 0 ? mapped.priority : customPriority++
        currentSection = mapped.name

        // Check if section already exists
        const existing = sections.find(s => s.name === currentSection)
        if (!existing) {
          sections.push({
            name: currentSection,
            priority,
            tasks: [],
          })
        }
        continue
      }

      if (currentSection) {
        const task = parseLine(line, filePath, i + 1, currentSection) // 1-indexed line numbers
        if (task) {
          const section = sections.find(s => s.name === currentSection)
          section?.tasks.push(task)
        }
      }
    }

    return sections
  }

  /**
   * Parse all TASKS.md files in a project and aggregate
   */
  async parseAllTasks(projectPath: string): Promise<TasksData> {
    const files = await this.scanForTaskFiles(projectPath)
    const allSections: Map<string, TaskSection> = new Map()

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await readFile(file, 'utf-8')
          return this.parseTaskFile(content, file)
        } catch {
          return [] // Skip files we can't read
        }
      })
    )

    for (const sections of results) {
      for (const section of sections) {
        const existing = allSections.get(section.name)
        if (existing) {
          existing.tasks.push(...section.tasks)
        } else {
          allSections.set(section.name, { ...section })
        }
      }
    }

    const sections = Array.from(allSections.values()).sort((a, b) => a.priority - b.priority)
    const totalOpen = sections.reduce((sum, s) => sum + s.tasks.filter(t => !t.completed).length, 0)
    const nowSection = sections.find(s => s.name === 'Now')
    const nowCount = nowSection ? nowSection.tasks.filter(t => !t.completed).length : 0

    return { sections, files, totalOpen, nowCount }
  }

  /**
   * Update a task (toggle, edit, or delete)
   */
  async updateTask(projectPath: string, update: TaskUpdate): Promise<TasksData> {
    const content = await readFile(update.filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const lineIndex = update.lineNumber - 1 // Convert to 0-indexed

    // Verify line matches a task
    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error('Line number out of range')
    }

    const line = lines[lineIndex]
    if (!CHECKBOX_REGEX.test(line)) {
      throw new Error('Task not found at expected line - file may have changed')
    }

    return this.applyUpdate(projectPath, update, lines, lineIndex)
  }

  private async applyUpdate(projectPath: string, update: TaskUpdate, lines: string[], lineIndex: number): Promise<TasksData> {
    const line = lines[lineIndex]

    switch (update.action) {
      case 'toggle': {
        const wasCompleted = line.startsWith(CHECKBOX_DONE)
        if (wasCompleted) {
          // Uncomplete: change [x] to [ ]
          lines[lineIndex] = CHECKBOX_OPEN + line.slice(CHECKBOX_DONE.length)
        } else {
          // Complete: change [ ] to [x]
          lines[lineIndex] = CHECKBOX_DONE + line.slice(CHECKBOX_OPEN.length)

          // Move to Done section
          const completedLine = lines.splice(lineIndex, 1)[0]
          const doneIndex = this.findSectionInsertIndex(lines, 'Done')
          if (doneIndex !== -1) {
            lines.splice(doneIndex, 0, completedLine)
          } else {
            // No Done section - add one
            lines.push('', '## Done', completedLine)
          }
        }
        break
      }
      case 'edit': {
        if (!update.newText) throw new Error('newText required for edit action')
        const match = line.match(CHECKBOX_REGEX)
        if (match) {
          lines[lineIndex] = match[0] + '**' + update.newText + '**'
        }
        break
      }
      case 'delete': {
        lines.splice(lineIndex, 1)
        break
      }
    }

    await writeFile(update.filePath, lines.join('\n'), 'utf-8')
    return this.parseAllTasks(projectPath)
  }

  /**
   * Add a new task to a section
   */
  async addTask(projectPath: string, task: TaskAdd): Promise<TasksData> {
    const content = await readFile(task.filePath, 'utf-8')
    const lines = content.split(/\r?\n/)

    const insertIndex = this.findSectionInsertIndex(lines, task.section)
    const newLine = CHECKBOX_OPEN + '**' + task.text + '**'

    if (insertIndex !== -1) {
      lines.splice(insertIndex, 0, newLine)
    } else {
      // Section doesn't exist - create it
      lines.push('', '## ' + task.section, newLine)
    }

    await writeFile(task.filePath, lines.join('\n'), 'utf-8')
    return this.parseAllTasks(projectPath)
  }

  /**
   * Delete a task by file path and line number
   */
  async deleteTask(projectPath: string, filePath: string, lineNumber: number): Promise<TasksData> {
    return this.updateTask(projectPath, { filePath, lineNumber, action: 'delete' })
  }

  /**
   * Move a task to a different section
   */
  async moveTask(projectPath: string, move: TaskMove): Promise<TasksData> {
    const content = await readFile(move.filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const lineIndex = move.lineNumber - 1

    if (lineIndex < 0 || lineIndex >= lines.length || !CHECKBOX_REGEX.test(lines[lineIndex])) {
      throw new Error('Task not found at expected line')
    }

    let taskLine = lines.splice(lineIndex, 1)[0]

    // If moving to/from Done, toggle checkbox state
    const isDone = move.targetSection.toLowerCase() === 'done'
    const wasCompleted = taskLine.startsWith(CHECKBOX_DONE)
    if (isDone && !wasCompleted) {
      taskLine = CHECKBOX_DONE + taskLine.slice(CHECKBOX_OPEN.length)
    } else if (!isDone && wasCompleted) {
      taskLine = CHECKBOX_OPEN + taskLine.slice(CHECKBOX_DONE.length)
    }

    const insertIndex = this.findSectionInsertIndex(lines, move.targetSection)
    if (insertIndex !== -1) {
      lines.splice(insertIndex, 0, taskLine)
    } else {
      lines.push('', '## ' + move.targetSection, taskLine)
    }
    await writeFile(move.filePath, lines.join('\n'), 'utf-8')

    return this.parseAllTasks(projectPath)
  }

  /**
   * Create a template TASKS.md file
   */
  async createTemplateFile(projectPath: string): Promise<string> {
    const filePath = path.join(projectPath, TASKS_FILENAME)
    const template = `# Tasks

## Now

## Next

## Waiting

## Later

## Done
`
    await writeFile(filePath, template, 'utf-8')
    return filePath
  }

  /**
   * Find the insert position for a task in a section (after the section header)
   * Returns the line index where a new task should be inserted
   */
  private findSectionInsertIndex(lines: string[], sectionName: string): number {
    for (let i = 0; i < lines.length; i++) {
      const h2Match = lines[i].match(H2_REGEX)
      if (h2Match) {
        const mapped = mapSectionName(h2Match[1])
        if (mapped.name === sectionName || h2Match[1].trim().toLowerCase() === sectionName.toLowerCase()) {
          // Found the section. Insert after header (skip blank lines after header)
          let insertAt = i + 1
          while (insertAt < lines.length && lines[insertAt].trim() === '') {
            insertAt++
          }
          return insertAt
        }
      }
    }
    return -1
  }

}
