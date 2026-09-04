import { memo, useState } from 'react'
import { RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '../../stores/projectStore'
import { formatBinding, DEFAULT_HOTKEY_CONFIG, findConflicts } from '../../utils/hotkeys'
import type { HotkeyAction, HotkeyBinding } from '../../types/hotkeys'
import { HotkeyRecorder } from './HotkeyRecorder'
import { btnIcon, kbd } from '../ui/controls'

interface HotkeyRowProps {
  action: HotkeyAction
  binding: HotkeyBinding
}

export const HotkeyRow = memo(function HotkeyRow({ action, binding }: HotkeyRowProps) {
  const [isRecording, setIsRecording] = useState(false)
  const updateHotkey = useProjectStore((s) => s.updateHotkey)
  const resetHotkey = useProjectStore((s) => s.resetHotkey)

  // Defensive: a persisted config may carry an action that no longer exists in
  // the defaults (reconciliation backstop). Never dereference an undefined
  // default — that would throw during render and white-screen the dialog.
  const defaultBinding = DEFAULT_HOTKEY_CONFIG[action]
  const isDefault =
    defaultBinding !== undefined &&
    binding.key === defaultBinding.key &&
    binding.modifiers.length === defaultBinding.modifiers.length &&
    binding.modifiers.every((m) => defaultBinding.modifiers.includes(m))

  const handleToggleEnabled = () => {
    updateHotkey(action, { enabled: !binding.enabled })
  }

  const handleReset = () => {
    resetHotkey(action)
  }

  const handleRecordingComplete = (newBinding: Pick<HotkeyBinding, 'key' | 'modifiers'> | null) => {
    setIsRecording(false)
    if (newBinding) {
      // Get current config at time of recording (avoids subscribing to all config changes)
      const currentConfig = useProjectStore.getState().hotkeyConfig ?? DEFAULT_HOTKEY_CONFIG

      // Check for conflicts
      const conflicts = findConflicts({ ...binding, ...newBinding }, currentConfig, action)

      if (conflicts.length > 0) {
        const conflictNames = conflicts.map((a) => currentConfig[a].description).join(', ')
        if (
          !window.confirm(
            `This shortcut conflicts with: ${conflictNames}\n\nDo you want to use it anyway? The conflicting shortcuts will be disabled.`
          )
        ) {
          return
        }
        // Disable conflicting shortcuts
        conflicts.forEach((conflictAction) => {
          updateHotkey(conflictAction, { enabled: false })
        })
      }

      updateHotkey(action, newBinding)
    }
  }

  return (
    <>
      <div className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-raised transition-colors">
        {/* Description */}
        <div className="flex-1 min-w-0">
          <span className={clsx('text-[13px]', binding.enabled ? 'text-fg' : 'text-fg-muted')}>
            {binding.description}
          </span>
        </div>

        {/* Shortcut Display / Edit Button */}
        <button
          onClick={() => setIsRecording(true)}
          className={clsx(
            kbd,
            'transition-colors',
            binding.enabled ? 'hover:border-primary' : 'opacity-50'
          )}
          title="Click to change shortcut"
        >
          {formatBinding(binding)}
        </button>

        {/* Reset Button */}
        <button
          onClick={handleReset}
          disabled={isDefault}
          className={clsx(btnIcon, isDefault && 'opacity-30 cursor-not-allowed')}
          title="Reset to default"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Enable/Disable Toggle */}
        <button
          onClick={handleToggleEnabled}
          className={clsx(
            btnIcon,
            binding.enabled ? 'text-primary hover:text-primary' : undefined
          )}
          title={binding.enabled ? 'Disable shortcut' : 'Enable shortcut'}
        >
          {binding.enabled ? (
            <ToggleRight className="w-5 h-5" />
          ) : (
            <ToggleLeft className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Recording Overlay */}
      {isRecording && (
        <HotkeyRecorder
          currentBinding={binding}
          onComplete={handleRecordingComplete}
          onCancel={() => setIsRecording(false)}
        />
      )}
    </>
  )
})
