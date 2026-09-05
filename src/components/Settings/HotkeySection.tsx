import { useState, useMemo } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '../../stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, getHotkeysByCategory } from '../../utils/hotkeys'
import { HOTKEY_CATEGORY_NAMES, HOTKEY_CATEGORY_ORDER } from '../../types/hotkeys'
import type { HotkeyAction } from '../../types/hotkeys'
import { HotkeyRow } from './HotkeyRow'
import { btnGhost, input } from '../ui/controls'

export function HotkeySection() {
  const [searchQuery, setSearchQuery] = useState('')
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG
  const resetAllHotkeys = useProjectStore((s) => s.resetAllHotkeys)

  // Filter and group hotkeys
  const groupedHotkeys = useMemo(() => {
    const byCategory = getHotkeysByCategory(hotkeyConfig)
    const filtered = new Map<
      string,
      Array<{ action: HotkeyAction; binding: (typeof hotkeyConfig)[HotkeyAction] }>
    >()

    const query = searchQuery.toLowerCase().trim()

    for (const category of HOTKEY_CATEGORY_ORDER) {
      const items = byCategory.get(category) ?? []
      const filteredItems = items.filter(
        ({ binding }) => query === '' || binding.description.toLowerCase().includes(query)
      )
      if (filteredItems.length > 0) {
        filtered.set(category, filteredItems)
      }
    }

    return filtered
  }, [hotkeyConfig, searchQuery])

  const handleResetAll = () => {
    if (window.confirm('Reset all keyboard shortcuts to defaults?')) {
      resetAllHotkeys()
    }
  }

  return (
    <div className="space-y-6">
      {/* Search and Reset */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
            className={clsx(input, 'w-full pl-10 h-9')}
          />
        </div>
        <button onClick={handleResetAll} className={btnGhost}>
          <RotateCcw className="w-3.5 h-3.5" />
          Reset All
        </button>
      </div>

      {/* Hotkey Categories */}
      {groupedHotkeys.size === 0 ? (
        <div className="text-center py-8 text-fg-muted text-[13px]">
          No shortcuts found matching "{searchQuery}"
        </div>
      ) : (
        Array.from(groupedHotkeys.entries()).map(([category, items]) => (
          <div key={category} className="space-y-2">
            <h3 className="eyebrow">
              {HOTKEY_CATEGORY_NAMES[category as keyof typeof HOTKEY_CATEGORY_NAMES]}
            </h3>
            <div className="space-y-1">
              {items.map(({ action, binding }) => (
                <HotkeyRow key={action} action={action} binding={binding} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
