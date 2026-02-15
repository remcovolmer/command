import { useState, useRef, useEffect, useCallback } from 'react'
import { Square, CheckSquare, Calendar, X, GripVertical } from 'lucide-react'
import type { TaskItem as TaskItemType } from '../../types'

interface TaskItemProps {
  task: TaskItemType
  showSource: boolean
  onToggle: (task: TaskItemType) => void
  onEdit: (task: TaskItemType, newText: string) => void
  onDelete: (task: TaskItemType) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent, task: TaskItemType) => void
}

export function TaskItem({
  task,
  showSource,
  onToggle,
  onEdit,
  onDelete,
  draggable = false,
  onDragStart,
}: TaskItemProps) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleStartEdit = useCallback(() => {
    // Strip bold markers for editing
    const cleanText = task.text.replace(/\*\*/g, '')
    setEditText(cleanText)
    setEditing(true)
  }, [task.text])

  const handleSave = useCallback(() => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== task.text.replace(/\*\*/g, '')) {
      onEdit(task, trimmed)
    }
    setEditing(false)
  }, [editText, task, onEdit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }, [handleSave])

  // Clean display text (remove bold markers)
  const displayText = task.text.replace(/\*\*/g, '')
  // Extract filename from source path
  const sourceLabel = task.filePath.split(/[/\\]/).slice(-2).join('/')

  return (
    <div
      className={`group flex items-start gap-1 px-2 py-1 text-sm hover:bg-sidebar-accent rounded transition-colors ${
        task.completed ? 'opacity-60' : ''
      }`}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
    >
      {/* Drag handle */}
      {draggable && (
        <GripVertical className="w-3 h-3 mt-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0" />
      )}

      {/* Checkbox */}
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 flex-shrink-0"
        title={task.completed ? 'Mark as open' : 'Mark as complete'}
      >
        {task.completed ? (
          <CheckSquare className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <Square className="w-3.5 h-3.5 text-muted-foreground hover:text-sidebar-foreground" />
        )}
      </button>

      {/* Task text */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-background border border-border rounded px-1 py-0 text-sm text-foreground outline-none focus:border-primary"
          />
        ) : (
          <span
            onClick={handleStartEdit}
            className={`cursor-text block truncate ${
              task.completed
                ? 'line-through text-muted-foreground'
                : 'text-sidebar-foreground'
            }`}
            title={displayText}
          >
            {displayText}
          </span>
        )}

        {/* Metadata row */}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {/* Due date */}
          {task.dueDate && (
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded ${
                task.isOverdue
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                  : task.isDueToday
                  ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              <Calendar className="w-2.5 h-2.5" />
              {task.dueDate.slice(5)} {/* Show MM-DD */}
            </span>
          )}

          {/* Person tags */}
          {task.personTags?.map((name) => (
            <span
              key={name}
              className="text-[10px] px-1 py-0 rounded bg-primary/10 text-primary"
            >
              {name}
            </span>
          ))}

          {/* Source file */}
          {showSource && (
            <span className="text-[10px] text-muted-foreground/60">
              {sourceLabel}
            </span>
          )}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(task)}
        className="mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete task"
      >
        <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
      </button>
    </div>
  )
}
