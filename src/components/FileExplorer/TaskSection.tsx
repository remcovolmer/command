import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import clsx from 'clsx'
import type { TaskSection as TaskSectionType, TaskItem as TaskItemType } from '../../types'
import { TaskItem } from './TaskItem'
import { input as inputCls } from '../ui/controls'

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

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAddSave()
      } else if (e.key === 'Escape') {
        setNewText('')
        setAdding(false)
      }
    },
    [handleAddSave]
  )

  const openCount = section.tasks.filter((t) => !t.completed).length
  const isDone = section.name === 'Done'

  return (
    <div
      className={clsx('border-t border-border', dragOver && 'bg-primary-soft')}
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
      {/* Section header — eyebrow with the open count, matching the git panel */}
      <div className="group/header flex items-center gap-1 px-2 h-8 hover:bg-raised transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            className={clsx(
              'w-3 h-3 text-fg-faint flex-shrink-0 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
            strokeWidth={1.5}
          />
          <span className="eyebrow">
            {section.name} · {isDone ? section.tasks.length : openCount}
          </span>
        </button>
        {!isDone && (
          <button
            onClick={() => {
              setExpanded(true)
              setAdding(true)
            }}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:bg-raised hover:text-fg transition-colors opacity-0 group-hover/header:opacity-100"
            title="Add task"
          >
            <Plus className="w-3 h-3" strokeWidth={1.5} />
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
                placeholder="New task…"
                className={clsx(inputCls, 'w-full h-6 text-[12px] px-2')}
              />
            </div>
          )}

          {section.tasks.length === 0 && !adding && (
            <div className="px-6 py-1 font-mono text-[10.5px] text-fg-faint">empty</div>
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
