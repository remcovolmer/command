import { useState, useEffect } from 'react'
import { Keyboard, Settings, User } from 'lucide-react'
import clsx from 'clsx'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import { HotkeySection } from './HotkeySection'
import { GeneralSection } from './GeneralSection'
import { AccountsSection } from './AccountsSection'
import { useProjectStore } from '../../stores/projectStore'
import { Dialog } from '../ui/Dialog'
import { segmentGroup, segment, segmentActive, segmentInactive } from '../ui/controls'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = 'shortcuts' | 'general' | 'accounts'

const TABS: { id: SettingsTab; label: string; icon: typeof Keyboard }[] = [
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'general', label: 'General', icon: Settings },
  { id: 'accounts', label: 'Accounts', icon: User },
]

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const settingsInitialTab = useProjectStore((s) => s.settingsInitialTab)
  const [activeTab, setActiveTab] = useState<SettingsTab>('shortcuts')
  const [hasNestedDialog, setHasNestedDialog] = useState(false)

  // Apply initial tab from store when dialog opens
  useEffect(() => {
    if (isOpen && settingsInitialTab) {
      setActiveTab(settingsInitialTab as SettingsTab)
    }
  }, [isOpen, settingsInitialTab])

  // Close on Escape — disabled when a nested dialog (e.g. confirmation) is open
  useDialogHotkeys(onClose, undefined, { enabled: isOpen && !hasNestedDialog })

  return (
    <Dialog open={isOpen} onClose={onClose} title="Settings" icon={Settings} size="lg">
      <div className={clsx(segmentGroup, 'mb-4')}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              segment,
              'inline-flex items-center gap-1.5',
              activeTab === id ? segmentActive : segmentInactive
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'shortcuts' && <HotkeySection />}
      {activeTab === 'general' && <GeneralSection onNestedDialogChange={setHasNestedDialog} />}
      {activeTab === 'accounts' && <AccountsSection />}
    </Dialog>
  )
}
