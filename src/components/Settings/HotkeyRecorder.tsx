import { useState, useEffect, useCallback } from 'react'
import { X, Check, Delete } from 'lucide-react'
import type { HotkeyBinding, ModifierKey } from '../../types/hotkeys'
import { formatBinding, parseKeyEvent } from '../../utils/hotkeys'

interface HotkeyRecorderProps {
  currentBinding: HotkeyBinding
  onComplete: (binding: Pick<HotkeyBinding, 'key' | 'modifiers'> | null) => void
  onCancel: () => void
}

export function HotkeyRecorder({ currentBinding, onComplete, onCancel }: HotkeyRecorderProps) {
  const [recordedBinding, setRecordedBinding] = useState<Pick<HotkeyBinding, 'key' | 'modifiers'> | null>(null)
  const [activeModifiers, setActiveModifiers] = useState<ModifierKey[]>([])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Update active modifiers for visual feedback
    const modifiers: ModifierKey[] = []
    if (e.ctrlKey) modifiers.push('ctrl')
    if (e.altKey) modifiers.push('alt')
    if (e.shiftKey) modifiers.push('shift')
    if (e.metaKey) modifiers.push('meta')
    setActiveModifiers(modifiers)

    // Try to parse the key event
    const parsed = parseKeyEvent(e)
    if (parsed) {
      setRecordedBinding(parsed)
    }
  }, [])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    // Update active modifiers
    const modifiers: ModifierKey[] = []
    if (e.ctrlKey) modifiers.push('ctrl')
    if (e.altKey) modifiers.push('alt')
    if (e.shiftKey) modifiers.push('shift')
    if (e.metaKey) modifiers.push('meta')
    setActiveModifiers(modifiers)
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, [handleKeyDown, handleKeyUp])

  const handleSave = () => {
    onComplete(recordedBinding)
  }

  const handleClear = () => {
    setRecordedBinding(null)
  }

  const displayBinding = recordedBinding
    ? { ...currentBinding, ...recordedBinding }
    : activeModifiers.length > 0
      ? { ...currentBinding, key: '...', modifiers: activeModifiers }
      : null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-xl border border-border p-6 min-w-[400px]">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Record Keyboard Shortcut
        </h3>

        <p className="text-sm text-muted-foreground mb-6">
          Press the key combination you want to use for this action.
        </p>

        {/* Key Display */}
        <div className="flex items-center justify-center py-8 px-4 rounded-lg bg-muted border-2 border-dashed border-border mb-6">
          {displayBinding ? (
            <span className="text-2xl font-mono text-foreground">
              {formatBinding(displayBinding)}
            </span>
          ) : (
            <span className="text-lg text-muted-foreground">
              Press a key combination...
            </span>
          )}
        </div>

        {/* Current Binding Info */}
        <p className="text-xs text-muted-foreground mb-4">
          Current: <span className="font-mono">{formatBinding(currentBinding)}</span>
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleClear}
            disabled={!recordedBinding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Delete className="w-4 h-4" />
            Clear
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!recordedBinding}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
