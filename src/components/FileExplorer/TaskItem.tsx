import { useState, useRef, useEffect, useCallback } from 'react'
import { Square, CheckSquare, Calendar, X, GripVertical, Pencil } from 'lucide-react'
import clsx from 'clsx'
import type { TaskItem as TaskItemType } from '../../types'
import { input as inputCls } from '../ui/controls'

interface TaskItemProps {
  task: TaskItemType
  showSource: boolean
  onToggle: (task: TaskItemType) => void
  onEdit: (task: TaskItemType, newText: string) => void
  onDelete: (task: TaskItemType) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent, task: TaskItemType) => void
}

const hoverIconBtn =
  'mt-0.5 flex-shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity hover:bg-raised'

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
  const [expanded, setExpanded] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleStartEdit = useCallback(() => {
    setEditText(task.text)
    setEditing(true)
    setExpanded(false)
  }, [task.text])

  const handleSave = useCallback(() => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== task.text) {
      onEdit(task, trimmed)
    }
    setEditing(false)
  }, [editText, task, onEdit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        setEditing(false)
      }
    },
    [handleSave]
  )

  const displayText = task.text
  const sourceLabel = task.filePath.split(/[/\\]/).slice(-2).join('/')

  return (
    <div
      className={clsx(
        'group flex items-start gap-1 px-2 py-1 text-[12.5px] hover:bg-raised rounded-md transition-colors',
        task.completed && 'opacity-60'
      )}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
    >
      {/* Drag handle */}
      {draggable && (
        <GripVertical
          className="w-3 h-3 mt-1 text-fg-faint opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0"
          strokeWidth={1.5}
        />
      )}

      {/* Checkbox */}
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 flex-shrink-0 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-raised"
        title={task.completed ? 'Mark as open' : 'Mark as complete'}
      >
        {task.completed ? (
          <CheckSquare className="w-3.5 h-3.5 text-success" strokeWidth={1.5} />
        ) : (
          <Square className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.5} />
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
            className={clsx(inputCls, 'w-full h-6 text-[12px] px-1.5')}
          />
        ) : (
          <span
            onClick={() => setExpanded(!expanded)}
            className={clsx(
              'cursor-pointer block leading-5',
              expanded ? 'whitespace-pre-wrap break-words' : 'truncate',
              task.completed ? 'line-through text-fg-muted' : 'text-fg'
            )}
            title={expanded ? undefined : displayText}
          >
            {displayText}
          </span>
        )}

        {/* Metadata row */}
        {(task.dueDate || task.personTags?.length || showSource) && (
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap font-mono text-[10.5px] tnum">
            {task.dueDate && (
              <span
                className={clsx(
                  'inline-flex items-center gap-0.5 px-1 rounded',
                  task.isOverdue
                    ? 'bg-danger/15 text-danger'
                    : task.isDueToday
                      ? 'bg-warning/15 text-warning'
                      : 'bg-raised text-fg-muted'
                )}
              >
                <Calendar className="w-2.5 h-2.5" strokeWidth={1.5} />
                {task.dueDate.slice(5)} {/* Show MM-DD */}
              </span>
            )}

            {task.personTags?.map((name) => (
              <span key={name} className="px-1 rounded bg-primary-soft text-primary">
                {name}
              </span>
            ))}

            {showSource && <span className="text-fg-faint">{sourceLabel}</span>}
          </div>
        )}
      </div>

      <button onClick={handleStartEdit} className={hoverIconBtn} title="Edit task">
        <Pencil className="w-3 h-3" strokeWidth={1.5} />
      </button>
      <button
        onClick={() => onDelete(task)}
        className={clsx(hoverIconBtn, 'hover:text-danger')}
        title="Delete task"
      >
        <X className="w-3 h-3" strokeWidth={1.5} />
      </button>
    </div>
  )
}
