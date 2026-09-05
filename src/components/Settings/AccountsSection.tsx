import { useState, useCallback } from 'react'
import { Plus, Trash2, Key, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '../../stores/projectStore'
import { Dialog } from '../ui/Dialog'
import {
  btnGhost,
  btnIcon,
  btnPrimary,
  btnSecondary,
  card,
  input,
  sectionHint,
  sectionTitle,
} from '../ui/controls'

const VERTEX_TEMPLATE: Record<string, string> = {
  CLAUDE_CODE_USE_VERTEX: '1',
  CLOUD_ML_REGION: '',
  ANTHROPIC_VERTEX_PROJECT_ID: '',
}

export function AccountsSection() {
  const profiles = useProjectStore((s) => s.profiles)
  const activeProfileId = useProjectStore((s) => s.activeProfileId)
  const addProfile = useProjectStore((s) => s.addProfile)
  const updateProfile = useProjectStore((s) => s.updateProfile)
  const removeProfile = useProjectStore((s) => s.removeProfile)
  const setActiveProfile = useProjectStore((s) => s.setActiveProfile)
  const setProfileEnvVars = useProjectStore((s) => s.setProfileEnvVars)
  const clearProfileEnvVars = useProjectStore((s) => s.clearProfileEnvVars)
  const getProfileEnvKeys = useProjectStore((s) => s.getProfileEnvKeys)

  const [newProfileName, setNewProfileName] = useState('')
  const [addingProfile, setAddingProfile] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [envEditorProfileId, setEnvEditorProfileId] = useState<string | null>(null)
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([])
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null)

  const handleAddProfile = useCallback(async () => {
    if (!newProfileName.trim()) return
    await addProfile(newProfileName.trim())
    setNewProfileName('')
    setAddingProfile(false)
  }, [newProfileName, addProfile])

  const handleStartEdit = useCallback((id: string, currentName: string) => {
    setEditingProfileId(id)
    setEditingName(currentName)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (editingProfileId && editingName.trim()) {
      await updateProfile(editingProfileId, { name: editingName.trim() })
      setEditingProfileId(null)
    }
  }, [editingProfileId, editingName, updateProfile])

  const handleOpenEnvEditor = useCallback(
    async (profileId: string) => {
      const keys = await getProfileEnvKeys(profileId)
      // We only know the keys, not values (security). Start with empty values.
      setEnvPairs(keys.map((key) => ({ key, value: '' })))
      setEnvEditorProfileId(profileId)
    },
    [getProfileEnvKeys]
  )

  const handleApplyVertexTemplate = useCallback(() => {
    setEnvPairs(Object.entries(VERTEX_TEMPLATE).map(([key, value]) => ({ key, value })))
  }, [])

  const handleSaveEnvVars = useCallback(async () => {
    if (!envEditorProfileId) return
    const emptyKeys = envPairs.filter((p) => p.key.trim() && !p.value).map((p) => p.key.trim())
    if (emptyKeys.length > 0) {
      const proceed = window.confirm(
        `The following keys have empty values and will be removed:\n\n${emptyKeys.join('\n')}\n\nContinue?`
      )
      if (!proceed) return
    }
    const vars: Record<string, string> = {}
    for (const pair of envPairs) {
      const key = pair.key.trim()
      if (key && pair.value) {
        vars[key] = pair.value
      }
    }
    if (Object.keys(vars).length > 0) {
      await setProfileEnvVars(envEditorProfileId, vars)
    } else {
      await clearProfileEnvVars(envEditorProfileId)
    }
    setEnvEditorProfileId(null)
    setEnvPairs([])
  }, [envEditorProfileId, envPairs, setProfileEnvVars, clearProfileEnvVars])

  const handleAddEnvPair = useCallback(() => {
    setEnvPairs((prev) => [...prev, { key: '', value: '' }])
  }, [])

  const handleRemoveEnvPair = useCallback((index: number) => {
    setEnvPairs((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleEnvPairChange = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setEnvPairs((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: val } : p)))
  }, [])

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h3 className={clsx(sectionTitle, 'mb-1')}>Account Profiles</h3>
        <p className={sectionHint}>
          Manage profiles with environment variables for Vertex AI, Bedrock, or custom API
          configurations. Assign profiles to projects in General settings.
        </p>
      </div>

      {/* Active profile selector */}
      {profiles.length > 0 && (
        <div className={clsx(card, 'p-4')}>
          <label className="text-[13px] font-medium text-fg-strong">Active Profile (Global)</label>
          <p className={clsx(sectionHint, 'mt-1 mb-3')}>
            Shown in the sidebar footer as the currently active account.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveProfile(null)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                activeProfileId === null
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border hover:bg-raised text-fg-muted'
              )}
            >
              None
            </button>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setActiveProfile(profile.id)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                  activeProfileId === profile.id
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border hover:bg-raised text-fg-muted'
                )}
              >
                {profile.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Profile list */}
      <div className="space-y-2">
        {profiles.map((profile) => (
          <div key={profile.id} className={card}>
            {/* Profile header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer"
              onClick={() =>
                setExpandedProfileId(expandedProfileId === profile.id ? null : profile.id)
              }
            >
              {expandedProfileId === profile.id ? (
                <ChevronDown className="w-4 h-4 text-fg-muted shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-fg-muted shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                {editingProfileId === profile.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleSaveEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit()
                      if (e.key === 'Escape') setEditingProfileId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className={clsx(input, 'w-full h-7')}
                  />
                ) : (
                  <span
                    className="text-[13px] font-medium text-fg-strong cursor-text"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleStartEdit(profile.id, profile.name)
                    }}
                  >
                    {profile.name}
                  </span>
                )}
              </div>

              {/* Env var count badge */}
              {profile.envVarCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-primary-soft text-primary">
                  <Key className="w-3 h-3" />
                  {profile.envVarCount} var{profile.envVarCount !== 1 ? 's' : ''}
                </span>
              )}

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (
                    window.confirm(
                      `Delete profile "${profile.name}"? This will remove all encrypted environment variables and reset projects using this profile.`
                    )
                  ) {
                    removeProfile(profile.id)
                  }
                }}
                className={clsx(btnIcon, 'hover:text-danger')}
                title="Delete profile"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Expanded content */}
            {expandedProfileId === profile.id && (
              <div className="px-4 pb-4 pt-0 border-t border-border">
                <div className="mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenEnvEditor(profile.id)
                    }}
                    className={btnSecondary}
                  >
                    <Key className="w-3.5 h-3.5" />
                    Configure Environment Variables
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add profile */}
      {addingProfile ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddProfile()
              if (e.key === 'Escape') setAddingProfile(false)
            }}
            placeholder="Profile name (e.g. Vertex EU)"
            autoFocus
            className={clsx(input, 'flex-1')}
          />
          <button
            onClick={handleAddProfile}
            disabled={!newProfileName.trim()}
            className={btnPrimary}
          >
            Add
          </button>
          <button onClick={() => setAddingProfile(false)} className={btnSecondary}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingProfile(true)}
          className={clsx(btnGhost, 'border border-dashed border-border')}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Profile
        </button>
      )}

      {/* Env var editor dialog */}
      <Dialog
        open={!!envEditorProfileId}
        onClose={() => setEnvEditorProfileId(null)}
        title="Environment Variables"
        icon={Key}
        size="md"
        footer={
          <>
            <button onClick={() => setEnvEditorProfileId(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={handleSaveEnvVars} className={btnPrimary}>
              Save & Encrypt
            </button>
          </>
        }
      >
        <p className={clsx(sectionHint, 'mb-4')}>
          Values are encrypted at rest. Enter all values — existing values cannot be displayed.
        </p>

        {/* Vertex AI template button */}
        <button onClick={handleApplyVertexTemplate} className={clsx(btnSecondary, 'mb-4')}>
          <Zap className="w-3.5 h-3.5" />
          Vertex AI Template
        </button>

        {/* Key-value pairs */}
        <div className="space-y-2">
          {envPairs.map((pair, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={pair.key}
                onChange={(e) => handleEnvPairChange(index, 'key', e.target.value)}
                placeholder="KEY"
                className={clsx(input, 'flex-1 font-mono')}
              />
              <input
                type="password"
                value={pair.value}
                onChange={(e) => handleEnvPairChange(index, 'value', e.target.value)}
                placeholder="value"
                className={clsx(input, 'flex-1 font-mono')}
              />
              <button onClick={() => handleRemoveEnvPair(index)} className={btnIcon}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button onClick={handleAddEnvPair} className={clsx(btnGhost, 'mt-2')}>
          <Plus className="w-3 h-3" />
          Add variable
        </button>
      </Dialog>
    </div>
  )
}
