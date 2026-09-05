import { Keyboard } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, formatBinding, getHotkeysByCategory } from '../../utils/hotkeys'
import { HOTKEY_CATEGORY_NAMES, HOTKEY_CATEGORY_ORDER } from '../../types/hotkeys'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import { Dialog } from '../ui/Dialog'
import { kbd } from '../ui/controls'

interface ShortcutsOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG

  // Close on Escape
  useDialogHotkeys(onClose, undefined, { enabled: isOpen })

  const groupedHotkeys = getHotkeysByCategory(hotkeyConfig)

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      icon={Keyboard}
      size="xl"
      footer={
        <p className={'text-[12.5px] text-fg-muted'}>
          Press <kbd className={kbd}>Ctrl</kbd> <kbd className={kbd}>,</kbd> to customize
          shortcuts
        </p>
      }
    >
      <div className="grid grid-cols-2 gap-8">
        {HOTKEY_CATEGORY_ORDER.map((category) => {
          const items = groupedHotkeys.get(category)
          if (!items || items.length === 0) return null

          return (
            <div key={category} className="space-y-2">
              <h3 className="eyebrow mb-3">{HOTKEY_CATEGORY_NAMES[category]}</h3>
              <div className="space-y-1">
                {items
                  .filter(({ binding }) => binding.enabled)
                  .map(({ action, binding }) => (
                    <div key={action} className="flex items-center justify-between py-1.5">
                      <span className="text-[13px] text-fg">{binding.description}</span>
                      <kbd className={kbd}>{formatBinding(binding)}</kbd>
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}
