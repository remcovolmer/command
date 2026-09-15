import { useState, useEffect, useMemo, useCallback } from 'react'
import { Zap, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { getElectronAPI } from '../../utils/electron'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import { useProjectStore } from '../../stores/projectStore'
import type { Automation, AutomationTrigger, AutomationTarget, GitEvent } from '../../types'
import { Dialog } from '../ui/Dialog'
import { btnPrimary, btnSecondary, input, select, textarea } from '../ui/controls'

interface AutomationCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  editAutomation?: Automation | null
}

type TriggerType = 'schedule' | 'agent-done' | 'git-event' | 'file-change'

function segButton(active: boolean, disabled = false) {
  return clsx(
    'px-2 py-1.5 text-xs rounded border',
    disabled
      ? 'border-border text-fg-faint cursor-not-allowed'
      : active
        ? 'border-primary bg-primary-soft text-primary'
        : 'border-border text-fg-muted hover:text-fg'
  )
}

export function AutomationCreateDialog({
  isOpen,
  onClose,
  editAutomation,
}: AutomationCreateDialogProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const projects = useProjectStore((s) => s.projects)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [defaultTarget, setDefaultTarget] = useState<AutomationTarget>('worktree')
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule')
  const [cron, setCron] = useState('0 9 * * *')
  const [gitEvent, setGitEvent] = useState<GitEvent>('pr-merged')
  const [filePatterns, setFilePatterns] = useState('')
  const [cooldownSeconds, setCooldownSeconds] = useState(60)
  const [timeoutMinutes, setTimeoutMinutes] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!editAutomation

  // Worktree launches need a Git repo, which only Code-type projects have.
  const selectedProject = projects.find((p) => p.id === projectId)
  const canUseWorktree = selectedProject?.type === 'code'

  // Populate form when editing
  useEffect(() => {
    if (!isOpen) return
    if (editAutomation) {
      setName(editAutomation.name)
      setPrompt(editAutomation.prompt)
      setProjectId(editAutomation.projectId)
      setDefaultTarget(editAutomation.defaultTarget)
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
      // Default to the first project and a worktree launch target
      setProjectId(projects.length > 0 ? projects[0].id : '')
      setDefaultTarget('worktree')
    }
  }, [isOpen, editAutomation, projects])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setPrompt('')
      setProjectId('')
      setDefaultTarget('worktree')
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

  const canSubmit =
    !saving &&
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    projectId.length > 0 &&
    (triggerType !== 'schedule' || cron.trim().length > 0) &&
    (triggerType !== 'file-change' || filePatterns.trim().length > 0)

  const buildTrigger = (): AutomationTrigger => {
    switch (triggerType) {
      case 'schedule':
        return { type: 'schedule', cron: cron.trim() }
      case 'agent-done':
        return { type: 'agent-done' }
      case 'git-event':
        return { type: 'git-event', event: gitEvent }
      case 'file-change':
        return {
          type: 'file-change',
          patterns: filePatterns
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
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
        projectId,
        defaultTarget,
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
  }, [
    canSubmit,
    name,
    prompt,
    projectId,
    defaultTarget,
    triggerType,
    cron,
    gitEvent,
    filePatterns,
    cooldownSeconds,
    timeoutMinutes,
    editAutomation,
    api,
    onClose,
  ])

  useDialogHotkeys(onClose, handleSave, { enabled: isOpen, canConfirm: canSubmit })

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Automation' : 'New Automation'}
      icon={Zap}
      size="md"
      footer={
        <>
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!canSubmit} className={btnPrimary}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEditing ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Daily code review"
            className={clsx(input, 'w-full')}
            autoFocus
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={50000}
            rows={4}
            placeholder="What should Claude do?"
            className={clsx(textarea, 'w-full resize-y font-mono')}
          />
        </div>

        {/* Project (single) */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Project</label>
          <select
            value={projectId}
            onChange={(e) => {
              const id = e.target.value
              setProjectId(id)
              // Snap to chat when the chosen project has no Git repo.
              if (projects.find((p) => p.id === id)?.type !== 'code') {
                setDefaultTarget('chat')
              }
            }}
            className={clsx(select, 'w-full')}
          >
            <option value="">Select a project...</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {/* Default launch target */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">
            Default launch target
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { value: 'worktree', label: 'New worktree' },
                { value: 'chat', label: 'Chat in project' },
              ] as const
            ).map((opt) => {
              const disabled = opt.value === 'worktree' && !canUseWorktree
              return (
                <button
                  key={opt.value}
                  onClick={() => !disabled && setDefaultTarget(opt.value)}
                  disabled={disabled}
                  title={disabled ? 'Worktree launches need a Git (Code-type) project' : undefined}
                  className={segButton(defaultTarget === opt.value, disabled)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-fg-muted mt-1">
            {canUseWorktree
              ? 'Used when you launch this automation in the foreground; override per launch.'
              : 'This project has no Git repo, so foreground launches run as a chat in the project.'}
          </p>
        </div>

        {/* Trigger type */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Trigger</label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { value: 'schedule', label: 'Schedule' },
                { value: 'agent-done', label: 'Agent done' },
                { value: 'git-event', label: 'Git Event' },
                { value: 'file-change', label: 'File Change' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTriggerType(opt.value)}
                className={segButton(triggerType === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Trigger-specific config */}
        {triggerType === 'schedule' && (
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">
              Cron Expression
            </label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * *"
              className={clsx(input, 'w-full font-mono')}
            />
            <p className="text-xs text-fg-muted mt-1">
              e.g. "0 9 * * *" = every day at 9am, "*/30 * * * *" = every 30 minutes
            </p>
          </div>
        )}

        {triggerType === 'git-event' && (
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Event Type</label>
            <select
              value={gitEvent}
              onChange={(e) => setGitEvent(e.target.value as typeof gitEvent)}
              className={clsx(select, 'w-full')}
            >
              <option value="pr-merged">PR Merged</option>
              <option value="pr-opened">PR Opened</option>
              <option value="checks-passed">Checks Passed</option>
              <option value="merge-conflict">Merge Conflict</option>
            </select>
            <p className="text-xs text-fg-muted mt-1">
              {
                'Variables: {{pr.number}}, {{pr.title}}, {{pr.branch}}, {{pr.url}}, {{pr.mergeable}}, {{pr.state}}'
              }
            </p>
            <p className="text-xs text-warning mt-1">
              {
                'Note: PR metadata (title, branch) is user-controlled. Use caution on public repos.'
              }
            </p>
          </div>
        )}

        {triggerType === 'file-change' && (
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">
                File Patterns (one per line)
              </label>
              <textarea
                value={filePatterns}
                onChange={(e) => setFilePatterns(e.target.value)}
                rows={3}
                placeholder={'**/*.ts\nsrc/**/*.tsx'}
                className={clsx(textarea, 'w-full resize-y font-mono')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">
                Cooldown (seconds)
              </label>
              <input
                type="number"
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Math.max(10, parseInt(e.target.value) || 60))}
                min={10}
                className={clsx(input, 'w-20')}
              />
            </div>
          </div>
        )}

        {/* Timeout */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">
            Timeout (minutes)
          </label>
          <input
            type="number"
            value={timeoutMinutes}
            onChange={(e) =>
              setTimeoutMinutes(Math.max(1, Math.min(120, parseInt(e.target.value) || 30)))
            }
            min={1}
            max={120}
            className={clsx(input, 'w-20')}
          />
        </div>

        {error && (
          <div className="text-xs text-danger bg-danger/10 rounded px-2 py-1.5">{error}</div>
        )}
      </div>
    </Dialog>
  )
}
