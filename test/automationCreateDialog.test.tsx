// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import type { Automation, Project } from '../src/types'

// Bypass persist middleware (no localStorage) — same pattern as projectStore.test.ts.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
}))

vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    automation: {
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
  }),
}))

import { useProjectStore } from '../src/stores/projectStore'
import { AutomationCreateDialog } from '../src/components/FileExplorer/AutomationCreateDialog'

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/${name}`, type: 'code', createdAt: 0, sortOrder: 0, pinned: false }
}

function makeAutomation(): Automation {
  return {
    id: 'a1',
    name: 'Daily review',
    prompt: 'Review the code',
    projectIds: ['p1'],
    trigger: { type: 'schedule', cron: '0 9 * * *' },
    enabled: true,
    timeoutMinutes: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function seedProjects(projects: Project[]) {
  useProjectStore.setState({ projects })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AutomationCreateDialog form persistence', () => {
  test('keeps the user project selection when the projects array is replaced (create mode)', () => {
    const p1 = makeProject('p1', 'alpha')
    const p2 = makeProject('p2', 'beta')
    seedProjects([p1, p2])

    render(<AutomationCreateDialog isOpen={true} onClose={() => {}} />)

    // Default: first project selected. Switch selection to the second project.
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // deselect p1
    fireEvent.click(checkboxes[1]) // select p2
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true)

    // Store replaces the projects array (e.g. rename/pin/reorder elsewhere).
    act(() => {
      seedProjects([{ ...p1, name: 'alpha-renamed' }, p2])
    })

    const after = screen.getAllByRole('checkbox')
    expect((after[0] as HTMLInputElement).checked).toBe(false)
    expect((after[1] as HTMLInputElement).checked).toBe(true)
  })

  test('keeps in-progress edits when the projects array is replaced (edit mode)', () => {
    const p1 = makeProject('p1', 'alpha')
    seedProjects([p1])

    render(
      <AutomationCreateDialog isOpen={true} onClose={() => {}} editAutomation={makeAutomation()} />
    )

    const nameInput = screen.getByPlaceholderText('e.g. Daily code review') as HTMLInputElement
    expect(nameInput.value).toBe('Daily review')
    fireEvent.change(nameInput, { target: { value: 'Weekly review' } })

    act(() => {
      seedProjects([{ ...p1, pinned: true }])
    })

    expect(nameInput.value).toBe('Weekly review')
  })

  test('repopulates the form on reopen', () => {
    seedProjects([makeProject('p1', 'alpha')])

    const { rerender } = render(
      <AutomationCreateDialog isOpen={true} onClose={() => {}} editAutomation={makeAutomation()} />
    )

    const nameInput = screen.getByPlaceholderText('e.g. Daily code review') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Scratch edits' } })

    rerender(<AutomationCreateDialog isOpen={false} onClose={() => {}} editAutomation={null} />)
    rerender(
      <AutomationCreateDialog isOpen={true} onClose={() => {}} editAutomation={makeAutomation()} />
    )

    const reopened = screen.getByPlaceholderText('e.g. Daily code review') as HTMLInputElement
    expect(reopened.value).toBe('Daily review')
  })
})
