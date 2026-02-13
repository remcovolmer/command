import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  shortcut?: string
  variant?: 'destructive'
}

export interface ContextMenuSeparator {
  type: 'separator'
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  // Get only clickable items for keyboard navigation
  const clickableIndices = items
    .map((item, i) => (isSeparator(item) ? -1 : i))
    .filter((i) => i !== -1)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const currentPos = clickableIndices.indexOf(prev)
          const nextPos = currentPos < clickableIndices.length - 1 ? currentPos + 1 : 0
          return clickableIndices[nextPos]
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const currentPos = clickableIndices.indexOf(prev)
          const nextPos = currentPos > 0 ? currentPos - 1 : clickableIndices.length - 1
          return clickableIndices[nextPos]
        })
        return
      }
      if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault()
        const item = items[focusedIndex]
        if (item && !isSeparator(item)) {
          item.onClick()
          onClose()
        }
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, focusedIndex, items, clickableIndices])

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const el = menuRef.current
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] py-1 bg-popover border border-border rounded-md shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => {
        if (isSeparator(item)) {
          return <div key={`sep-${index}`} className="h-px my-1 bg-border" />
        }

        const isFocused = focusedIndex === index

        return (
          <button
            key={item.label}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`
              w-full text-left px-3 py-1.5 text-sm flex items-center justify-between
              ${item.variant === 'destructive'
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground'
              }
              ${isFocused ? (item.variant === 'destructive' ? 'bg-destructive/10' : 'bg-accent text-accent-foreground') : ''}
              transition-colors
            `}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="ml-4 text-xs text-muted-foreground">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
