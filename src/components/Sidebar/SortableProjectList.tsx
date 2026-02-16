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
import { LayoutGroup, AnimatePresence } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import type { Project, TerminalSession, Worktree } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { SortableProjectItem } from './SortableProjectItem'
import { ProjectDragPreview } from './ProjectDragPreview'

interface SortableProjectListProps {
  projects: Project[]
  getProjectTerminals: (projectId: string) => TerminalSession[]
  getProjectDirectTerminals: (projectId: string) => TerminalSession[]
  getProjectWorktrees: (projectId: string) => Worktree[]
  getWorktreeTerminals: (worktreeId: string) => TerminalSession[]
  activeProjectId: string | null
  activeTerminalId: string | null
  onSelect: (projectId: string) => void
  onRemove: (e: React.MouseEvent, projectId: string) => void
  onCreateTerminal: (projectId: string, worktreeId?: string) => void
  onCreateWorktree: (projectId: string) => void
  onRemoveWorktree: (worktreeId: string) => void
  onSelectTerminal: (terminalId: string) => void
  onCloseTerminal: (e: React.MouseEvent, terminalId: string) => void
  onReorder: (projectIds: string[]) => void
}

export function SortableProjectList({
  projects,
  getProjectTerminals,
  getProjectDirectTerminals,
  getProjectWorktrees,
  getWorktreeTerminals,
  activeProjectId,
  activeTerminalId,
  onSelect,
  onRemove,
  onCreateTerminal,
  onCreateWorktree,
  onRemoveWorktree,
  onSelectTerminal,
  onCloseTerminal,
  onReorder,
}: SortableProjectListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const terminals = useProjectStore((s) => s.terminals)
  const inactiveSectionCollapsed = useProjectStore((s) => s.inactiveSectionCollapsed)
  const toggleInactiveSectionCollapsed = useProjectStore((s) => s.toggleInactiveSectionCollapsed)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)

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

  // Split projects into active (has terminals) and inactive (no terminals)
  const activeProjects = useMemo(
    () =>
      projects.filter((p) =>
        Object.values(terminals).some((t) => t.projectId === p.id)
      ),
    [projects, terminals]
  )

  const inactiveProjects = useMemo(
    () =>
      projects.filter(
        (p) => !Object.values(terminals).some((t) => t.projectId === p.id)
      ),
    [projects, terminals]
  )

  const activeProjectIds = useMemo(
    () => activeProjects.map((p) => p.id),
    [activeProjects]
  )

  const inactiveProjectIds = useMemo(
    () => inactiveProjects.map((p) => p.id),
    [inactiveProjects]
  )

  const draggedProject = useMemo(
    () => (draggedId ? projects.find((p) => p.id === draggedId) : null),
    [draggedId, projects]
  )

  // When collapsing, auto-switch away from inactive project if currently selected
  const handleToggleInactive = () => {
    if (!inactiveSectionCollapsed && activeProjectId) {
      // About to collapse: check if selected project is inactive
      const isSelectedInactive = inactiveProjects.some((p) => p.id === activeProjectId)
      if (isSelectedInactive) {
        // Switch to first active project or first workspace
        const firstVisible = activeProjects[0] ?? projects.find((p) => p.type === 'workspace')
        if (firstVisible) {
          setActiveProject(firstVisible.id)
        }
      }
    }
    toggleInactiveSectionCollapsed()
  }

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedId(event.active.id as string)
  }

  const createDragEndHandler =
    (sourceIds: string[], otherIds: string[], sourceFirst: boolean) =>
    (event: DragEndEvent) => {
      const { active, over } = event
      setDraggedId(null)

      if (over && active.id !== over.id) {
        const oldIndex = sourceIds.indexOf(active.id as string)
        const newIndex = sourceIds.indexOf(over.id as string)
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(sourceIds, oldIndex, newIndex)
          onReorder(
            sourceFirst ? [...newOrder, ...otherIds] : [...otherIds, ...newOrder]
          )
        }
      }
    }

  const handleDragEndActive = createDragEndHandler(
    activeProjectIds,
    inactiveProjectIds,
    true
  )
  const handleDragEndInactive = createDragEndHandler(
    inactiveProjectIds,
    activeProjectIds,
    false
  )

  const renderProjectItem = (project: Project, isDragging: boolean, isInactive = false) => (
    <SortableProjectItem
      key={project.id}
      project={project}
      layoutId={project.id}
      terminals={getProjectTerminals(project.id)}
      directTerminals={getProjectDirectTerminals(project.id)}
      worktrees={getProjectWorktrees(project.id)}
      getWorktreeTerminals={getWorktreeTerminals}
      isActive={project.id === activeProjectId}
      isInactive={isInactive}
      activeTerminalId={activeTerminalId}
      isDragging={isDragging}
      onSelect={onSelect}
      onRemove={onRemove}
      onCreateTerminal={onCreateTerminal}
      onCreateWorktree={onCreateWorktree}
      onRemoveWorktree={onRemoveWorktree}
      onSelectTerminal={onSelectTerminal}
      onCloseTerminal={onCloseTerminal}
    />
  )

  // Architecture Note: Two separate DndContext instances are used intentionally.
  // This prevents dragging projects between Active and Inactive sections.
  // Projects move between sections automatically based on terminal count,
  // not by manual drag-and-drop. Each section has its own sortable context.
  return (
    <LayoutGroup>
      {/* Active Projects Section */}
      {activeProjects.length > 0 && (
        <section className="mb-2">
          <h3 className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em]">
            Active
          </h3>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEndActive}
          >
            <SortableContext
              items={activeProjectIds}
              strategy={verticalListSortingStrategy}
            >
              <AnimatePresence mode="popLayout">
                <ul className="space-y-1">
                  {activeProjects.map((project) =>
                    renderProjectItem(project, project.id === draggedId)
                  )}
                </ul>
              </AnimatePresence>
            </SortableContext>

            <DragOverlay>
              {draggedProject && activeProjectIds.includes(draggedProject.id) ? (
                <ProjectDragPreview
                  project={draggedProject}
                  terminalCount={
                    Object.values(terminals).filter(
                      (t) => t.projectId === draggedProject.id
                    ).length
                  }
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </section>
      )}

      {/* Inactive Projects Section */}
      {inactiveProjects.length > 0 && (
        <section>
          <button
            onClick={handleToggleInactive}
            aria-expanded={!inactiveSectionCollapsed}
            className="flex items-center gap-1 px-3 py-1.5 w-full text-left text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em] hover:text-muted-foreground transition-colors"
          >
            <ChevronRight
              aria-hidden="true"
              className={`w-3 h-3 transition-transform duration-150 ${!inactiveSectionCollapsed ? 'rotate-90' : ''}`}
            />
            <span>Inactive</span>
            {inactiveSectionCollapsed && (
              <span className="normal-case tracking-normal font-normal">({inactiveProjects.length})</span>
            )}
          </button>
          {!inactiveSectionCollapsed && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEndInactive}
            >
              <SortableContext
                items={inactiveProjectIds}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence mode="popLayout">
                  <ul className="space-y-1">
                    {inactiveProjects.map((project) =>
                      renderProjectItem(project, project.id === draggedId, true)
                    )}
                  </ul>
                </AnimatePresence>
              </SortableContext>

              <DragOverlay>
                {draggedProject && inactiveProjectIds.includes(draggedProject.id) ? (
                  <ProjectDragPreview
                    project={draggedProject}
                    terminalCount={0}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </section>
      )}
    </LayoutGroup>
  )
}
