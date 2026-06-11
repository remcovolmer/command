// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TerminalSession } from '../src/types'
import { TerminalListItem } from '../src/components/Sidebar/TerminalListItem'

function makeTerminal(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-1',
    projectId: 'proj-1',
    worktreeId: null,
    state: 'done',
    lastActivity: Date.now(),
    title: 'Chat',
    type: 'claude',
    ...overrides,
  }
}

function renderItem(terminal: TerminalSession, isActive: boolean) {
  return render(
    <ul>
      <TerminalListItem
        terminal={terminal}
        isActive={isActive}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    </ul>,
  )
}

describe('TerminalListItem summary rendering', () => {
  afterEach(() => {
    cleanup()
  })

  test('inactive Claude chat with summary: summary text not in DOM, li carries it as title', () => {
    renderItem(makeTerminal({ summary: 'Refactoring the sidebar' }), false)
    expect(screen.queryByText('Refactoring the sidebar')).toBeNull()
    const li = screen.getByRole('listitem')
    expect(li.getAttribute('title')).toBe('Refactoring the sidebar')
  })

  test('active Claude chat with summary: summary line is visible', () => {
    renderItem(makeTerminal({ summary: 'Refactoring the sidebar' }), true)
    expect(screen.getByText('Refactoring the sidebar')).toBeTruthy()
  })

  test('active Claude chat without summary: no empty second line (no nbsp placeholder)', () => {
    renderItem(makeTerminal(), true)
    const li = screen.getByRole('listitem')
    // Only the title span inside the text container — no placeholder sibling
    const textSpans = li.querySelectorAll('div > span')
    expect(textSpans.length).toBe(1)
    expect(li.textContent).not.toContain(' ')
  })

  test('normal terminal: never renders a summary line, even active with summary', () => {
    renderItem(makeTerminal({ type: 'normal', summary: 'Should not appear' }), true)
    expect(screen.queryByText('Should not appear')).toBeNull()
    const li = screen.getByRole('listitem')
    expect(li.querySelectorAll('div > span').length).toBe(1)
  })
})

describe('TerminalListItem stopped state (red icon is the sole indicator)', () => {
  afterEach(() => {
    cleanup()
  })

  const getTerminalIcon = (li: HTMLElement) => li.querySelector('svg')!

  test('stopped state: terminal icon carries the --status-stopped color', () => {
    renderItem(makeTerminal({ state: 'stopped' }), false)
    const icon = getTerminalIcon(screen.getByRole('listitem'))
    expect(icon.getAttribute('class')).toContain('text-[var(--status-stopped)]')
    expect(icon.getAttribute('class')).not.toContain('text-muted-foreground')
  })

  test('non-stopped states: icon stays muted', () => {
    for (const state of ['busy', 'done', 'permission', 'question'] as const) {
      const { unmount } = renderItem(makeTerminal({ state }), false)
      const icon = getTerminalIcon(screen.getByRole('listitem'))
      expect(icon.getAttribute('class')).toContain('text-muted-foreground')
      expect(icon.getAttribute('class')).not.toContain('text-[var(--status-stopped)]')
      unmount()
    }
  })
})

describe('TerminalListItem attention rail (permission/question)', () => {
  afterEach(() => {
    cleanup()
  })

  const queryStateDot = (li: HTMLElement) =>
    li.querySelector('.w-1\\.5.h-1\\.5.rounded-full')

  test('permission state: rail + "wacht op jou" chip, no status dot', () => {
    renderItem(makeTerminal({ state: 'permission' }), false)
    expect(screen.getByTestId('attention-rail')).toBeTruthy()
    expect(screen.getByText('wacht op jou')).toBeTruthy()
    expect(queryStateDot(screen.getByRole('listitem'))).toBeNull()
  })

  test('question state: exact same treatment as permission', () => {
    renderItem(makeTerminal({ state: 'question' }), false)
    expect(screen.getByTestId('attention-rail')).toBeTruthy()
    expect(screen.getByText('wacht op jou')).toBeTruthy()
    expect(queryStateDot(screen.getByRole('listitem'))).toBeNull()
  })

  test('done state: no rail, status dot present', () => {
    renderItem(makeTerminal({ state: 'done' }), false)
    expect(screen.queryByTestId('attention-rail')).toBeNull()
    expect(screen.queryByText('wacht op jou')).toBeNull()
    expect(queryStateDot(screen.getByRole('listitem'))).toBeTruthy()
  })

  test('busy state: no rail, status dot present', () => {
    renderItem(makeTerminal({ state: 'busy' }), false)
    expect(screen.queryByTestId('attention-rail')).toBeNull()
    expect(screen.queryByText('wacht op jou')).toBeNull()
    expect(queryStateDot(screen.getByRole('listitem'))).toBeTruthy()
  })
})
