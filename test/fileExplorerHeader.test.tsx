// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FileExplorerHeader } from '../src/components/FileExplorer/FileExplorerHeader'

afterEach(() => cleanup())

describe('FileExplorerHeader', () => {
  test('shows the active panel label', () => {
    render(<FileExplorerHeader activeTab="git" isGitLoading={false} onRefresh={vi.fn()} />)
    expect(screen.getByText('Git')).toBeTruthy()
  })

  test('appends the worktree branch for the files panel', () => {
    render(
      <FileExplorerHeader
        activeTab="files"
        isGitLoading={false}
        onRefresh={vi.fn()}
        worktreeBranch="fix/scroll-chat"
      />
    )
    expect(screen.getByText('Files · fix/scroll-chat')).toBeTruthy()
  })

  test('does not append a branch for non-files panels', () => {
    render(
      <FileExplorerHeader
        activeTab="tasks"
        isGitLoading={false}
        onRefresh={vi.fn()}
        worktreeBranch="fix/scroll-chat"
      />
    )
    expect(screen.getByText('Tasks')).toBeTruthy()
    expect(screen.queryByText(/fix\/scroll-chat/)).toBeNull()
  })

  test('renders no tab-switching buttons — only the refresh button', () => {
    render(<FileExplorerHeader activeTab="files" isGitLoading={false} onRefresh={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(1)
    expect(buttons[0].getAttribute('title')).toBe('Refresh')
  })

  test('refresh button invokes onRefresh', () => {
    const onRefresh = vi.fn()
    render(<FileExplorerHeader activeTab="files" isGitLoading={false} onRefresh={onRefresh} />)
    screen.getByRole('button', { name: /refresh/i }).click()
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  test('git refresh spins and disables while git is loading', () => {
    render(<FileExplorerHeader activeTab="git" isGitLoading={true} onRefresh={vi.fn()} />)
    const button = screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('animate-spin')
  })
})
