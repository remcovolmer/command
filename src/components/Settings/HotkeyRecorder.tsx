import { useState, useEffect, useCallback } from 'react'
import { X, Check, Delete } from 'lucide-react'
import type { HotkeyBinding, ModifierKey } from '../../types/hotkeys'
import { formatBinding, parseKeyEvent } from '../../utils/hotkeys'
import { setHotkeyRecordingActive } from '../../hooks/useHotkeys'
import { btnGhost, btnPrimary } from '../ui/controls'

interface HotkeyRecorderProps {
  currentBinding: HotkeyBinding
  onComplete: (binding: Pick<HotkeyBinding, 'key' | 'modifiers'> | null) => void
  onCancel: () => void
}

export function HotkeyRecorder({ currentBinding, onComplete, onCancel }: HotkeyRecorderProps) {
  const [recordedBinding, setRecordedBinding] = useState<Pick<
    HotkeyBinding,
    'key' | 'modifiers'
  > | null>(null)
  const [activeModifiers, setActiveModifiers] = useState<ModifierKey[]>([])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Escape without modifiers cancels the recorder (consistent with all other dialogs)
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onCancel()
        return
      }

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
    },
    [onCancel]
  )

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    // Update active modifiers
    const modifiers: ModifierKey[] = []
    if (e.ctrlKey) modifiers.push('ctrl')
    if (e.altKey) modifiers.push('alt')
    if (e.shiftKey) modifiers.push('shift')
    if (e.metaKey) modifiers.push('meta')
    setActiveModifiers(modifiers)
  }, [])

  // Suppress global hotkey actions while recording
  useEffect(() => {
    setHotkeyRecordingActive(true)
    return () => setHotkeyRecordingActive(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    window.addEventListener('keydown', handleKeyDown, { capture: true, signal: controller.signal })
    window.addEventListener('keyup', handleKeyUp, { capture: true, signal: controller.signal })

    return () => controller.abort()
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
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-popover rounded-xl shadow-[0_1px_2px_oklch(0_0_0/.06),0_12px_40px_-12px_oklch(0_0_0/.35)] border border-border p-6 min-w-[400px] dialog-in">
        <h3 className="text-[15px] font-semibold text-fg-strong mb-4">
          Record Keyboard Shortcut
        </h3>

        <p className="text-[13px] text-fg-muted mb-6">
          Press the key combination you want to use for this action.
        </p>

        {/* Key Display */}
        <div className="flex items-center justify-center py-8 px-4 rounded-lg bg-raised border-2 border-dashed border-border mb-6">
          {displayBinding ? (
            <span className="text-2xl font-mono text-fg-strong">
              {formatBinding(displayBinding)}
            </span>
          ) : (
            <span className="text-lg text-fg-muted">Press a key combination...</span>
          )}
        </div>

        {/* Current Binding Info */}
        <p className="text-[12px] text-fg-muted mb-4">
          Current: <span className="font-mono">{formatBinding(currentBinding)}</span>
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button onClick={handleClear} disabled={!recordedBinding} className={btnGhost}>
            <Delete className="w-3.5 h-3.5" />
            Clear
          </button>

          <div className="flex items-center gap-2">
            <button onClick={onCancel} className={btnGhost}>
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button onClick={handleSave} disabled={!recordedBinding} className={btnPrimary}>
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
