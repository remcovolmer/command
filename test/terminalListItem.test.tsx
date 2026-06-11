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
