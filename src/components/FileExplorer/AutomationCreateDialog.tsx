import { useState, useEffect, useMemo, useCallback } from 'react'
import { X, Loader2 } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import { useProjectStore } from '../../stores/projectStore'
import type { Automation, AutomationTrigger } from '../../types'

interface AutomationCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  editAutomation?: Automation | null
}

type TriggerType = 'schedule' | 'claude-done' | 'git-event' | 'file-change'

export function AutomationCreateDialog({
  isOpen,
  onClose,
  editAutomation,
}: AutomationCreateDialogProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const projects = useProjectStore((s) => s.projects)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule')
  const [cron, setCron] = useState('0 9 * * *')
  const [gitEvent, setGitEvent] = useState<'pr-merged' | 'pr-opened' | 'checks-passed'>('pr-merged')
  const [filePatterns, setFilePatterns] = useState('')
  const [cooldownSeconds, setCooldownSeconds] = useState(60)
  const [timeoutMinutes, setTimeoutMinutes] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!editAutomation

  // Populate form when editing
  useEffect(() => {
    if (!isOpen) return
    if (editAutomation) {
      setName(editAutomation.name)
      setPrompt(editAutomation.prompt)
      setSelectedProjectIds(editAutomation.projectIds)
      setTriggerType(editAutomation.trigger.type)
      setTimeoutMinutes(editAutomation.timeoutMinutes)
      if (editAutomation.trigger.type === 'schedule') {
        setCron(editAutomation.trigger.cron)
      } else if (editAutomation.trigger.type === 'git-event') {
        setGitEvent(editAutomation.trigger.event)
      } else if (editAutomation.trigger.type === 'file-change') {
        setFilePatterns(editAutomation.trigger.patterns.join('\n'))
        setCooldownSeconds(editAutomation.trigger.cooldownSeconds)
      }
    } else {
      // Default to first project selected
      if (projects.length > 0) {
        setSelectedProjectIds([projects[0].id])
      }
    }
  }, [isOpen, editAutomation, projects])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setPrompt('')
      setSelectedProjectIds([])
      setTriggerType('schedule')
      setCron('0 9 * * *')
      setGitEvent('pr-merged')
      setFilePatterns('')
      setCooldownSeconds(60)
      setTimeoutMinutes(30)
      setError(null)
      setSaving(false)
    }
  }, [isOpen])

  const canSubmit = !saving &&
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    selectedProjectIds.length > 0 &&
    (triggerType !== 'schedule' || cron.trim().length > 0) &&
    (triggerType !== 'file-change' || filePatterns.trim().length > 0)

  const buildTrigger = (): AutomationTrigger => {
    switch (triggerType) {
      case 'schedule': return { type: 'schedule', cron: cron.trim() }
      case 'claude-done': return { type: 'claude-done' }
      case 'git-event': return { type: 'git-event', event: gitEvent }
      case 'file-change': return {
        type: 'file-change',
        patterns: filePatterns.split('\n').map(p => p.trim()).filter(Boolean),
        cooldownSeconds,
      }
    }
  }

  const handleSave = useCallback(async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    try {
      const data = {
        name: name.trim(),
        prompt: prompt.trim(),
        projectIds: selectedProjectIds,
        trigger: buildTrigger(),
        enabled: editAutomation?.enabled ?? true,
        timeoutMinutes,
      }

      if (editAutomation) {
        await api.automation.update(editAutomation.id, data)
      } else {
        await api.automation.create(data as Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save automation')
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, name, prompt, selectedProjectIds, triggerType, cron, gitEvent, filePatterns, cooldownSeconds, timeoutMinutes, editAutomation, api, onClose])

  useDialogHotkeys(onClose, handleSave, { enabled: isOpen, canConfirm: canSubmit })

  if (!isOpen) return null

  const toggleProject = (id: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-popover border border-border rounded-lg shadow-lg w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">
            {isEditing ? 'Edit Automation' : 'New Automation'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/50">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Daily code review"
              className="w-full px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              maxLength={50000}
              rows={4}
              placeholder="What should Claude do?"
              className="w-full px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
            />
          </div>

          {/* Projects */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Projects</label>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {projects.map(project => (
                <label key={project.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(project.id)}
                    onChange={() => toggleProject(project.id)}
                    className="rounded border-border"
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Trigger type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Trigger</label>
            <div className="grid grid-cols-2 gap-1">
              {([
                { value: 'schedule', label: 'Schedule' },
                { value: 'claude-done', label: 'Claude Done' },
                { value: 'git-event', label: 'Git Event' },
                { value: 'file-change', label: 'File Change' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTriggerType(opt.value)}
                  className={`px-2 py-1.5 text-xs rounded border ${
                    triggerType === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger-specific config */}
          {triggerType === 'schedule' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Cron Expression</label>
              <input
                type="text"
                value={cron}
                onChange={e => setCron(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                e.g. "0 9 * * *" = every day at 9am, "*/30 * * * *" = every 30 minutes
              </p>
            </div>
          )}

          {triggerType === 'git-event' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Event Type</label>
              <select
                value={gitEvent}
                onChange={e => setGitEvent(e.target.value as typeof gitEvent)}
                className="w-full px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="pr-merged">PR Merged</option>
                <option value="pr-opened">PR Opened</option>
                <option value="checks-passed">Checks Passed</option>
              </select>
            </div>
          )}

          {triggerType === 'file-change' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  File Patterns (one per line)
                </label>
                <textarea
                  value={filePatterns}
                  onChange={e => setFilePatterns(e.target.value)}
                  rows={3}
                  placeholder={"**/*.ts\nsrc/**/*.tsx"}
                  className="w-full px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Cooldown (seconds)
                </label>
                <input
                  type="number"
                  value={cooldownSeconds}
                  onChange={e => setCooldownSeconds(Math.max(10, parseInt(e.target.value) || 60))}
                  min={10}
                  className="w-20 px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* Timeout */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Timeout (minutes)
            </label>
            <input
              type="number"
              value={timeoutMinutes}
              onChange={e => setTimeoutMinutes(Math.max(1, Math.min(120, parseInt(e.target.value) || 30)))}
              min={1}
              max={120}
              className="w-20 px-2 py-1.5 text-sm bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
