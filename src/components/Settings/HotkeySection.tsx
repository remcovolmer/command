import { useState, useMemo } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, getHotkeysByCategory } from '../../utils/hotkeys'
import { HOTKEY_CATEGORY_NAMES, HOTKEY_CATEGORY_ORDER } from '../../types/hotkeys'
import type { HotkeyAction } from '../../types/hotkeys'
import { HotkeyRow } from './HotkeyRow'

export function HotkeySection() {
  const [searchQuery, setSearchQuery] = useState('')
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG
  const resetAllHotkeys = useProjectStore((s) => s.resetAllHotkeys)

  // Filter and group hotkeys
  const groupedHotkeys = useMemo(() => {
    const byCategory = getHotkeysByCategory(hotkeyConfig)
    const filtered = new Map<string, Array<{ action: HotkeyAction; binding: typeof hotkeyConfig[HotkeyAction] }>>()

    const query = searchQuery.toLowerCase().trim()

    for (const category of HOTKEY_CATEGORY_ORDER) {
      const items = byCategory.get(category) ?? []
      const filteredItems = items.filter(({ binding }) =>
        query === '' || binding.description.toLowerCase().includes(query)
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
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleResetAll}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Reset All
        </button>
      </div>

      {/* Hotkey Categories */}
      {groupedHotkeys.size === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No shortcuts found matching "{searchQuery}"
        </div>
      ) : (
        Array.from(groupedHotkeys.entries()).map(([category, items]) => (
          <div key={category} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              {HOTKEY_CATEGORY_NAMES[category as keyof typeof HOTKEY_CATEGORY_NAMES]}
            </h3>
            <div className="space-y-1">
              {items.map(({ action, binding }) => (
                <HotkeyRow
                  key={action}
                  action={action}
                  binding={binding}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
