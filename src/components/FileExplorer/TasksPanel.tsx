import { useEffect, useMemo, useCallback, useRef } from 'react'
import { ListTodo, Plus, Loader2 } from 'lucide-react'
import type { Project, TaskItem as TaskItemType, TasksData } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { TaskSection } from './TaskSection'

interface TasksPanelProps {
  project: Project
  onRefresh: () => void
}

export function TasksPanel({ project, onRefresh }: TasksPanelProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const tasksData = useProjectStore((s) => s.tasksData[project.id])
  const isLoading = useProjectStore((s) => s.tasksLoading[project.id])
  const setTasksData = useProjectStore((s) => s.setTasksData)
  const setTasksLoading = useProjectStore((s) => s.setTasksLoading)

  // Track watched files for cleanup
  const watchedFilesRef = useRef<string[]>([])

  // Initial load
  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.path])

  const loadTasks = useCallback(async () => {
    setTasksLoading(project.id, true)
    try {
      const data = await api.tasks.scan(project.path)
      setTasksData(project.id, data)
      // Set up file watching for discovered TASKS.md files
      setupWatchers(data.files)
    } catch (error) {
      console.error('Failed to scan tasks:', error)
    } finally {
      setTasksLoading(project.id, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.path, api])

  const setupWatchers = useCallback(async (files: string[]) => {
    // Unwatch old files
    for (const file of watchedFilesRef.current) {
      try {
        await api.fs.unwatchFile(file)
      } catch {
        // Ignore
      }
    }
    // Watch new files
    watchedFilesRef.current = files
    for (const file of files) {
      try {
        await api.fs.watchFile(file)
      } catch {
        // Ignore
      }
    }
  }, [api])

  // Listen for file changes and debounce reload
  useEffect(() => {
    const debounceTimer = { current: null as ReturnType<typeof setTimeout> | null }

    const unsubscribe = api.fs.onFileChanged((filePath: string) => {
      // Check if the changed file is one of our TASKS.md files
      if (watchedFilesRef.current.some(f =>
        f.toLowerCase() === filePath.toLowerCase() ||
        filePath.toLowerCase().endsWith('tasks.md')
      )) {
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
          loadTasks()
        }, 300)
      }
    })

    return () => {
      unsubscribe()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      // Cleanup watchers
      for (const file of watchedFilesRef.current) {
        api.fs.unwatchFile(file).catch(() => {})
      }
      watchedFilesRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const handleToggle = useCallback(async (task: TaskItemType) => {
    try {
      const data = await api.tasks.update(project.path, {
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        action: 'toggle',
      })
      setTasksData(project.id, data)
    } catch (error) {
      console.error('Failed to toggle task:', error)
    }
  }, [api, project, setTasksData])

  const handleEdit = useCallback(async (task: TaskItemType, newText: string) => {
    try {
      const data = await api.tasks.update(project.path, {
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        action: 'edit',
        newText,
      })
      setTasksData(project.id, data)
    } catch (error) {
      console.error('Failed to edit task:', error)
    }
  }, [api, project, setTasksData])

  const handleDelete = useCallback(async (task: TaskItemType) => {
    try {
      const data = await api.tasks.delete(project.path, task.filePath, task.lineNumber)
      setTasksData(project.id, data)
    } catch (error) {
      console.error('Failed to delete task:', error)
    }
  }, [api, project, setTasksData])

  const handleAdd = useCallback(async (section: string, text: string) => {
    if (!tasksData?.files.length) return
    try {
      const data = await api.tasks.add(project.path, {
        filePath: tasksData.files[0], // Add to first (root) file
        section,
        text,
      })
      setTasksData(project.id, data)
    } catch (error) {
      console.error('Failed to add task:', error)
    }
  }, [api, project, tasksData, setTasksData])

  const handleDragStart = useCallback((e: React.DragEvent, task: TaskItemType) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      filePath: task.filePath,
      lineNumber: task.lineNumber,
      section: task.section,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetSection: string) => {
    try {
      const raw = e.dataTransfer.getData('application/json')
      if (!raw) return
      const { filePath, lineNumber, section: sourceSection } = JSON.parse(raw)
      if (sourceSection === targetSection) return // Same section, no-op

      const data = await api.tasks.move(project.path, {
        filePath,
        lineNumber,
        targetSection,
      })
      setTasksData(project.id, data)
    } catch (error) {
      console.error('Failed to move task:', error)
    }
  }, [api, project, setTasksData])

  const handleCreateFile = useCallback(async () => {
    try {
      await api.tasks.createFile(project.path)
      await loadTasks()
    } catch (error) {
      console.error('Failed to create TASKS.md:', error)
    }
  }, [api, project, loadTasks])

  const showSource = (tasksData?.files.length ?? 0) > 1

  // Loading state
  if (isLoading && !tasksData) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Empty state - no TASKS.md found
  if (!tasksData || tasksData.files.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
        <ListTodo className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground text-center">
          No TASKS.md found
        </p>
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Create TASKS.md
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {tasksData.sections
        .filter(s => s.name !== 'Done' || s.tasks.length > 0)
        .map((section) => (
          <TaskSection
            key={section.name}
            section={section}
            defaultExpanded={section.name !== 'Done' && section.tasks.length > 0}
            showSource={showSource}
            onToggleTask={handleToggle}
            onEditTask={handleEdit}
            onDeleteTask={handleDelete}
            onAddTask={(text) => handleAdd(section.name, text)}
            onDragStart={handleDragStart}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          />
        ))}
    </div>
  )
}
