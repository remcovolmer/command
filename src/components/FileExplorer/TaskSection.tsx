import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { TaskSection as TaskSectionType, TaskItem as TaskItemType } from '../../types'
import { TaskItem } from './TaskItem'

interface TaskSectionProps {
  section: TaskSectionType
  defaultExpanded: boolean
  showSource: boolean
  onToggleTask: (task: TaskItemType) => void
  onEditTask: (task: TaskItemType, newText: string) => void
  onDeleteTask: (task: TaskItemType) => void
  onAddTask: (text: string) => void
  onDragStart?: (e: React.DragEvent, task: TaskItemType) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent, targetSection: string) => void
}

export function TaskSection({
  section,
  defaultExpanded,
  showSource,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onDragStart,
  onDragOver,
  onDrop,
}: TaskSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [adding])

  const handleAddSave = useCallback(() => {
    const trimmed = newText.trim()
    if (trimmed) {
      onAddTask(trimmed)
    }
    setNewText('')
    setAdding(false)
  }, [newText, onAddTask])

  const handleAddKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddSave()
    } else if (e.key === 'Escape') {
      setNewText('')
      setAdding(false)
    }
  }, [handleAddSave])

  const openCount = section.tasks.filter(t => !t.completed).length
  const isDone = section.name === 'Done'

  return (
    <div
      className={`border-t border-border/50 ${dragOver ? 'bg-primary/5' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
        onDragOver?.(e)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        onDrop?.(e, section.name)
      }}
    >
      {/* Section header */}
      <div className="group/header flex items-center gap-1 px-2 py-1.5 hover:bg-sidebar-accent transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 flex-1 min-w-0"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.name}
          </span>
          <span className="text-[10px] text-muted-foreground/70 ml-auto">
            {isDone ? section.tasks.length : openCount}
          </span>
        </button>
        {!isDone && (
          <button
            onClick={() => {
              setExpanded(true)
              setAdding(true)
            }}
            className="p-0.5 rounded hover:bg-muted/50 transition-colors opacity-0 group-hover/header:opacity-100"
            title="Add task"
          >
            <Plus className="w-3 h-3 text-muted-foreground hover:text-sidebar-foreground" />
          </button>
        )}
      </div>

      {/* Task list */}
      {expanded && (
        <div className="pb-1">
          {/* Add task input */}
          {adding && (
            <div className="px-2 py-1">
              <input
                ref={inputRef}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onBlur={handleAddSave}
                onKeyDown={handleAddKeyDown}
                placeholder="New task..."
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
              />
            </div>
          )}

          {section.tasks.length === 0 && !adding && (
            <div className="px-6 py-1 text-[10px] text-muted-foreground/50 italic">
              empty
            </div>
          )}

          {section.tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              showSource={showSource}
              onToggle={onToggleTask}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              draggable
              onDragStart={onDragStart}
            />
          ))}
        </div>
      )}
    </div>
  )
}
