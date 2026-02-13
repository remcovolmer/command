import { X, Keyboard } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, formatBinding, getHotkeysByCategory } from '../../utils/hotkeys'
import { HOTKEY_CATEGORY_NAMES, HOTKEY_CATEGORY_ORDER } from '../../types/hotkeys'
import { useDialogHotkeys } from '../../hooks/useHotkeys'

interface ShortcutsOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG

  // Close on Escape
  useDialogHotkeys(onClose, undefined, { enabled: isOpen })

  if (!isOpen) return null

  const groupedHotkeys = getHotkeysByCategory(hotkeyConfig)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-sidebar rounded-xl shadow-2xl border border-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 bg-sidebar-accent/30">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content - Grid Layout */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-8">
            {HOTKEY_CATEGORY_ORDER.map(category => {
              const items = groupedHotkeys.get(category)
              if (!items || items.length === 0) return null

              return (
                <div key={category} className="space-y-2">
                  <h3 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
                    {HOTKEY_CATEGORY_NAMES[category]}
                  </h3>
                  <div className="space-y-1">
                    {items.filter(({ binding }) => binding.enabled).map(({ action, binding }) => (
                      <div
                        key={action}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-sm text-foreground">
                          {binding.description}
                        </span>
                        <kbd className="px-2 py-1 text-xs font-mono bg-muted border border-border rounded text-muted-foreground">
                          {formatBinding(binding)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/30 text-center">
          <p className="text-xs text-muted-foreground">
            Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded">Ctrl + ,</kbd> to customize shortcuts
          </p>
        </div>
      </div>
    </div>
  )
}
