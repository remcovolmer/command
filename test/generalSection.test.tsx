// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const storeState = vi.hoisted(() => ({
  projects: [] as Array<{
    id: string
    name: string
    path: string
    type: 'project'
    createdAt: number
    sortOrder: number
    settings?: {
      claudeMode?: 'chat' | 'auto' | 'full-auto'
      defaultAgent?: 'claude' | 'codex' | 'pi'
    }
  }>,
  updateProject: vi.fn(),
  terminalPoolSize: 5,
  setTerminalPoolSize: vi.fn(),
  profiles: [],
  projectVertexConfigs: {} as Record<string, boolean>,
  theme: 'system' as const,
  setTheme: vi.fn(),
  showUsageIndicator: true,
  toggleUsageIndicator: vi.fn(),
  confirmedModeKeys: [] as string[],
  addConfirmedModeKey: vi.fn(),
}))

vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

vi.mock('../src/hooks/useHotkeys', () => ({
  useDialogHotkeys: vi.fn(),
}))

import { GeneralSection } from '../src/components/Settings/GeneralSection'

function projectWithMode(mode: 'chat' | 'auto' | 'full-auto') {
  return {
    id: 'project-1',
    name: 'Project One',
    path: 'C:\\project-one',
    type: 'project' as const,
    createdAt: 0,
    sortOrder: 0,
    settings: { claudeMode: mode, defaultAgent: 'claude' as const },
  }
}

describe('GeneralSection Agent Mode', () => {
  beforeEach(() => {
    storeState.projects = [projectWithMode('chat')]
    storeState.confirmedModeKeys = []
    storeState.updateProject.mockReset()
    storeState.addConfirmedModeKey.mockReset()
  })

  afterEach(() => cleanup())

  test('uses provider-neutral Agent Mode copy and explains Auto semantics', () => {
    storeState.projects = [projectWithMode('auto')]

    render(<GeneralSection />)

    expect(screen.getByText('Agent Mode')).toBeTruthy()
    expect(screen.queryByText('Claude Mode')).toBeNull()
    expect(
      screen.getByText(
        'Auto mode — Claude auto-accepts safe actions; Codex keeps its default behavior.'
      )
    ).toBeTruthy()
  })

  test('Full Auto confirmation names both flags and Codex sandbox risk', () => {
    render(<GeneralSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Full Auto' }))

    expect(screen.getByText('--dangerously-skip-permissions')).toBeTruthy()
    expect(screen.getByText('--dangerously-bypass-approvals-and-sandbox')).toBeTruthy()
    expect(screen.getByText(/Codex bypasses approvals and its internal sandbox/)).toBeTruthy()
    expect(
      screen.getByText('Only enable this in an externally sandboxed environment.')
    ).toBeTruthy()
  })

  test('Full Auto keeps the existing confirmation and acknowledgement flow', () => {
    render(<GeneralSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Full Auto' }))
    expect(storeState.updateProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    expect(storeState.addConfirmedModeKey).toHaveBeenCalledWith('project-1:full-auto')
    expect(storeState.updateProject).toHaveBeenCalledWith('project-1', {
      settings: {
        claudeMode: 'full-auto',
        defaultAgent: 'claude',
      },
    })
  })
})
