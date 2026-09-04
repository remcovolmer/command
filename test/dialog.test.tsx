// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { Settings } from 'lucide-react'
import { Dialog } from '../src/components/ui/Dialog'

afterEach(() => cleanup())

describe('Dialog', () => {
  test('renders nothing when open is false', () => {
    const { container } = render(
      <Dialog open={false} onClose={vi.fn()} title="Hidden">
        <p>content</p>
      </Dialog>
    )
    expect(container.firstChild).toBeNull()
  })

  test('renders the title and body content when open', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Settings" icon={Settings}>
        <p>Body content</p>
      </Dialog>
    )
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Body content')).toBeTruthy()
  })

  test('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Settings">
        <p>Body content</p>
      </Dialog>
    )
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog open onClose={onClose} title="Settings">
        <p>Body content</p>
      </Dialog>
    )
    const backdrop = container.querySelector('.backdrop-blur-\\[2px\\]')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('renders footer content when provided', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Settings" footer={<button>Save</button>}>
        <p>Body content</p>
      </Dialog>
    )
    expect(screen.getByText('Save')).toBeTruthy()
  })
})
