import { useState, useCallback } from 'react'
import { Plus, Trash2, Key, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

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

  const handleOpenEnvEditor = useCallback(async (profileId: string) => {
    const keys = await getProfileEnvKeys(profileId)
    // We only know the keys, not values (security). Start with empty values.
    setEnvPairs(keys.map(key => ({ key, value: '' })))
    setEnvEditorProfileId(profileId)
  }, [getProfileEnvKeys])

  const handleApplyVertexTemplate = useCallback(() => {
    setEnvPairs(Object.entries(VERTEX_TEMPLATE).map(([key, value]) => ({ key, value })))
  }, [])

  const handleSaveEnvVars = useCallback(async () => {
    if (!envEditorProfileId) return
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
    setEnvPairs(prev => [...prev, { key: '', value: '' }])
  }, [])

  const handleRemoveEnvPair = useCallback((index: number) => {
    setEnvPairs(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleEnvPairChange = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setEnvPairs(prev => prev.map((p, i) => i === index ? { ...p, [field]: val } : p))
  }, [])

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Account Profiles</h3>
        <p className="text-xs text-muted-foreground">
          Manage profiles with environment variables for Vertex AI, Bedrock, or custom API configurations.
          Assign profiles to projects in General settings.
        </p>
      </div>

      {/* Active profile selector */}
      {profiles.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <label className="text-sm font-medium text-foreground">Active Profile (Global)</label>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Shown in the sidebar footer as the currently active account.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveProfile(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                activeProfileId === null
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted text-muted-foreground'
              }`}
            >
              None
            </button>
            {profiles.map(profile => (
              <button
                key={profile.id}
                onClick={() => setActiveProfile(profile.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  activeProfileId === profile.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted text-muted-foreground'
                }`}
              >
                {profile.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Profile list */}
      <div className="space-y-2">
        {profiles.map(profile => (
          <div key={profile.id} className="rounded-lg border border-border">
            {/* Profile header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer"
              onClick={() => setExpandedProfileId(expandedProfileId === profile.id ? null : profile.id)}
            >
              {expandedProfileId === profile.id ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
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
                    className="w-full px-2 py-0.5 text-sm rounded border border-primary bg-background text-foreground focus:outline-none"
                  />
                ) : (
                  <span
                    className="text-sm font-medium text-foreground cursor-text"
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
                <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary">
                  <Key className="w-3 h-3" />
                  {profile.envVarCount} var{profile.envVarCount !== 1 ? 's' : ''}
                </span>
              )}

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeProfile(profile.id)
                }}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete profile"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Expanded content */}
            {expandedProfileId === profile.id && (
              <div className="px-4 pb-4 pt-0 border-t border-border/30">
                <div className="mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenEnvEditor(profile.id)
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
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
            className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleAddProfile}
            disabled={!newProfileName.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => setAddingProfile(false)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingProfile(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Profile
        </button>
      )}

      {/* Env var editor dialog */}
      {envEditorProfileId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEnvEditorProfileId(null)} />
          <div className="relative bg-background rounded-lg border border-border p-6 max-w-lg w-full shadow-xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-foreground mb-1">Environment Variables</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Values are encrypted at rest. Enter all values — existing values cannot be displayed.
            </p>

            {/* Vertex AI template button */}
            <button
              onClick={handleApplyVertexTemplate}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors mb-4"
            >
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
                    className="flex-1 px-2 py-1 text-xs font-mono rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    type="text"
                    value={pair.value}
                    onChange={(e) => handleEnvPairChange(index, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 px-2 py-1 text-xs font-mono rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => handleRemoveEnvPair(index)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddEnvPair}
              className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add variable
            </button>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEnvEditorProfileId(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEnvVars}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Save & Encrypt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
