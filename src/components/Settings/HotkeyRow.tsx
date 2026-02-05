import { useState } from 'react'
import { RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { formatBinding, DEFAULT_HOTKEY_CONFIG, findConflicts } from '../../utils/hotkeys'
import type { HotkeyAction, HotkeyBinding } from '../../types/hotkeys'
import { HotkeyRecorder } from './HotkeyRecorder'

interface HotkeyRowProps {
  action: HotkeyAction
  binding: HotkeyBinding
}

export function HotkeyRow({ action, binding }: HotkeyRowProps) {
  const [isRecording, setIsRecording] = useState(false)
  const updateHotkey = useProjectStore((s) => s.updateHotkey)
  const resetHotkey = useProjectStore((s) => s.resetHotkey)
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG

  const isDefault =
    binding.key === DEFAULT_HOTKEY_CONFIG[action].key &&
    binding.modifiers.length === DEFAULT_HOTKEY_CONFIG[action].modifiers.length &&
    binding.modifiers.every(m => DEFAULT_HOTKEY_CONFIG[action].modifiers.includes(m))

  const handleToggleEnabled = () => {
    updateHotkey(action, { enabled: !binding.enabled })
  }

  const handleReset = () => {
    resetHotkey(action)
  }

  const handleRecordingComplete = (newBinding: Pick<HotkeyBinding, 'key' | 'modifiers'> | null) => {
    setIsRecording(false)
    if (newBinding) {
      // Check for conflicts
      const conflicts = findConflicts(
        { ...binding, ...newBinding },
        hotkeyConfig,
        action
      )

      if (conflicts.length > 0) {
        const conflictNames = conflicts.map(a => hotkeyConfig[a].description).join(', ')
        if (!window.confirm(`This shortcut conflicts with: ${conflictNames}\n\nDo you want to use it anyway? The conflicting shortcuts will be disabled.`)) {
          return
        }
        // Disable conflicting shortcuts
        conflicts.forEach(conflictAction => {
          updateHotkey(conflictAction, { enabled: false })
        })
      }

      updateHotkey(action, newBinding)
    }
  }

  return (
    <>
      <div className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
        {/* Description */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${binding.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
            {binding.description}
          </span>
        </div>

        {/* Shortcut Display / Edit Button */}
        <button
          onClick={() => setIsRecording(true)}
          className={`px-3 py-1.5 text-sm font-mono rounded border transition-colors ${
            binding.enabled
              ? 'bg-muted border-border text-foreground hover:border-primary'
              : 'bg-muted/50 border-border/50 text-muted-foreground'
          }`}
          title="Click to change shortcut"
        >
          {formatBinding(binding)}
        </button>

        {/* Reset Button */}
        <button
          onClick={handleReset}
          disabled={isDefault}
          className={`p-1.5 rounded-lg transition-colors ${
            isDefault
              ? 'text-muted-foreground/30 cursor-not-allowed'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title="Reset to default"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Enable/Disable Toggle */}
        <button
          onClick={handleToggleEnabled}
          className={`p-1 rounded-lg transition-colors ${
            binding.enabled
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          title={binding.enabled ? 'Disable shortcut' : 'Enable shortcut'}
        >
          {binding.enabled ? (
            <ToggleRight className="w-6 h-6" />
          ) : (
            <ToggleLeft className="w-6 h-6" />
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
}
