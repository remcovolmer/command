import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Project, TerminalSession } from '../../types'
import { SortableProjectItem } from './SortableProjectItem'
import { ProjectDragPreview } from './ProjectDragPreview'

interface SortableProjectListProps {
  projects: Project[]
  getProjectTerminals: (projectId: string) => TerminalSession[]
  activeProjectId: string | null
  activeTerminalId: string | null
  hasNeedsInput: (projectId: string) => boolean
  onSelect: (projectId: string) => void
  onRemove: (e: React.MouseEvent, projectId: string) => void
  onCreateTerminal: (projectId: string) => void
  onSelectTerminal: (terminalId: string) => void
  onCloseTerminal: (e: React.MouseEvent, terminalId: string) => void
  onReorder: (projectIds: string[]) => void
}

export function SortableProjectList({
  projects,
  getProjectTerminals,
  activeProjectId,
  activeTerminalId,
  hasNeedsInput,
  onSelect,
  onRemove,
  onCreateTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onReorder,
}: SortableProjectListProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Prevents accidental drags on click
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects])

  const activeProject = useMemo(
    () => (activeId ? projects.find((p) => p.id === activeId) : null),
    [activeId, projects]
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (over && active.id !== over.id) {
      const oldIndex = projectIds.indexOf(active.id as string)
      const newIndex = projectIds.indexOf(over.id as string)
      const newOrder = arrayMove(projectIds, oldIndex, newIndex)
      onReorder(newOrder)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {projects.map((project) => (
            <SortableProjectItem
              key={project.id}
              project={project}
              terminals={getProjectTerminals(project.id)}
              isActive={project.id === activeProjectId}
              activeTerminalId={activeTerminalId}
              hasNeedsInput={hasNeedsInput(project.id)}
              isDragging={project.id === activeId}
              onSelect={() => onSelect(project.id)}
              onRemove={(e) => onRemove(e, project.id)}
              onCreateTerminal={() => onCreateTerminal(project.id)}
              onSelectTerminal={onSelectTerminal}
              onCloseTerminal={onCloseTerminal}
            />
          ))}
        </ul>
      </SortableContext>

      <DragOverlay>
        {activeProject ? (
          <ProjectDragPreview
            project={activeProject}
            terminalCount={getProjectTerminals(activeProject.id).length}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
