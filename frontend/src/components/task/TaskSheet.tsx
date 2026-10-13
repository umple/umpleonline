/**
 * Sheet for teaching tasks.
 * Creates a task definition and, on a /tasks link, shows the loaded response so it can be submitted.
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Copy, Check, RefreshCw, Clock, ExternalLink, Send, ArrowLeft,
  ClipboardList, Search, Loader2, Users,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTaskStore } from '@/stores/taskStore'
import { useSessionStore } from '@/stores/sessionStore'
import { taskApi } from '@/api/taskApi'
import type { TaskView, ResponseSummary } from '@/api/types'

const NAME_PATTERN = /^[a-zA-Z0-9_.]{1,100}$/

export function TaskSheet() {
  const sheetMode = useTaskStore((s) => s.sheetMode)
  const closeSheet = useTaskStore((s) => s.closeSheet)

  return (
    <Sheet open={sheetMode !== 'closed'} onOpenChange={(open) => { if (!open) closeSheet() }}>
      <SheetContent side="right" className="sm:max-w-md w-full overflow-y-auto">
        {sheetMode === 'create' && <CreateView />}
        {sheetMode === 'manage' && <ManageView />}
      </SheetContent>
    </Sheet>
  )
}

// ── Create View ──

function CreateView() {
  const [taskName, setTaskName] = useState('')
  const [requestorName, setRequestorName] = useState('')
  const [completionURL, setCompletionURL] = useState('')
  const [isExperiment, setIsExperiment] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<TaskView | null>(null)

  const nameValid = taskName.length === 0 || NAME_PATTERN.test(taskName)
  const tabCount = useSessionStore((s) => s.tabs.length)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!NAME_PATTERN.test(taskName)) return

    const { code, tabs } = useSessionStore.getState()
    const hasTabs = tabs.length > 1

    setSubmitting(true)
    setError(null)
    try {
      const result = await taskApi.createTask({
        taskName,
        requestorName,
        completionURL: completionURL || undefined,
        isExperiment,
        instructions,
        modelCode: hasTabs ? '' : code,
        tabs: hasTabs ? tabs.map((t) => ({ name: t.name, code: t.code })) : undefined,
      })
      setCreated(result)
      toast.success('Task created')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  if (created) {
    return <PostCreateView task={created} />
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-brand" />
          Create Task
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-6">
          {error && (
            <div className="mb-4 rounded-lg border border-status-error/20 bg-status-error/5 px-3 py-2.5 text-sm text-status-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Task identity */}
            <fieldset className="space-y-3">
              <legend className="text-xxs font-semibold text-ink-faint uppercase tracking-wider mb-2">
                Identity
              </legend>
              <Field label="Task Name" required>
                <Input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="hw1_uml_basics"
                  aria-invalid={taskName.length > 0 && !nameValid}
                  data-testid="task-name-input"
                />
                {taskName.length > 0 && !nameValid && (
                  <p className="text-xs text-status-error mt-1">
                    Only letters, digits, underscores, and dots (1-100 chars)
                  </p>
                )}
              </Field>
              <Field label="Your Name">
                <Input
                  value={requestorName}
                  onChange={(e) => setRequestorName(e.target.value)}
                  placeholder="Prof. Smith"
                  data-testid="requestor-name-input"
                />
              </Field>
            </fieldset>

            {/* Instructions */}
            <fieldset className="space-y-3">
              <legend className="text-xxs font-semibold text-ink-faint uppercase tracking-wider mb-2">
                Instructions
              </legend>
              <Field label="Task Instructions" hint="Markdown supported — participants see this when they start">
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={5}
                  className="w-full rounded-md border border-border bg-surface-0 px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors hover:bg-surface-1 focus:border-brand focus:ring-1 focus:ring-brand resize-y"
                  placeholder="Describe what participants should do..."
                  data-testid="instructions-input"
                />
              </Field>
            </fieldset>

            {/* Options */}
            <fieldset className="space-y-3">
              <legend className="text-xxs font-semibold text-ink-faint uppercase tracking-wider mb-2">
                Options
              </legend>

              <Field label="Completion URL" hint="Redirect after submission (e.g. a survey)">
                <Input
                  value={completionURL}
                  onChange={(e) => setCompletionURL(e.target.value)}
                  placeholder="https://..."
                  type="url"
                />
              </Field>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink">Experiment Mode</p>
                  <p className="text-xs text-ink-muted">Log participant commands for research</p>
                </div>
                <Switch checked={isExperiment} onCheckedChange={setIsExperiment} />
              </div>
            </fieldset>

            {/* Starter model indicator */}
            <div className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2.5 text-xs text-ink-muted">
              <Code className="size-3.5 shrink-0" />
              <span>
                Starter model: current editor content
                {tabCount > 1 && <span className="text-ink-faint"> ({tabCount} tabs)</span>}
              </span>
            </div>

            <Button
              type="submit"
              disabled={!NAME_PATTERN.test(taskName) || submitting}
              className="w-full"
              data-testid="create-task-btn"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ClipboardList className="size-3.5" />
              )}
              {submitting ? 'Creating...' : 'Create Task'}
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}

function Code(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

// ── Post-Create View ──

function PostCreateView({ task }: { task: TaskView }) {
  const [copied, setCopied] = useState(false)
  const participantURL = `${window.location.origin}/tasks/${task.taskName}`

  function copyURL() {
    navigator.clipboard.writeText(participantURL)
    setCopied(true)
    toast.success('URL copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Check className="size-4 text-status-success" />
          Task Created
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 pb-6 space-y-5">
          {/* Success banner */}
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 px-4 py-3">
            <p className="text-sm font-medium text-status-success">
              {task.taskName}
            </p>
            <p className="text-xs text-status-success/80 mt-0.5">
              Ready for participants
            </p>
          </div>

          {/* Share URL */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-ink">
              Share this URL with participants
            </label>
            <div className="flex gap-1.5">
              <Input
                value={participantURL}
                readOnly
                className="flex-1 font-mono text-xs select-all"
                onFocus={(e) => e.target.select()}
              />
              <Button variant="outline" size="sm" onClick={copyURL} className="shrink-0">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                useTaskStore.getState().closeSheet()
                setTimeout(() => useTaskStore.getState().openSheet('manage'), 300)
              }}
            >
              <Search className="size-3.5" />
              Manage this task
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Manage View ──

function ManageView() {
  const [taskName, setTaskName] = useState('')
  const [task, setTask] = useState<TaskView | null>(null)
  const [responses, setResponses] = useState<ResponseSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Edit form state
  const [requestorName, setRequestorName] = useState('')
  const [completionURL, setCompletionURL] = useState('')
  const [isExperiment, setIsExperiment] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadData = useCallback(async (name: string) => {
    setLoading(true)
    setError(null)
    try {
      const [t, r] = await Promise.all([
        taskApi.getTask(name),
        taskApi.listResponses(name),
      ])
      setTask(t)
      setResponses(r)
      setRequestorName(t.requestorName)
      setCompletionURL(t.completionURL ?? '')
      setIsExperiment(t.isExperiment)
      setInstructions(t.instructions)

      // Load the task's model into the editor
      if (t.tabs && t.tabs.length > 0) {
        const apiTabs = t.tabs.map((tab, i) => ({ id: `tab-${i}`, name: tab.name, code: tab.code }))
        useSessionStore.getState().restoreTabs(apiTabs, apiTabs[0].id)
      } else {
        useSessionStore.getState().setCode(t.modelCode)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task not found')
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault()
    if (!taskName.trim()) return
    loadData(taskName)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!task) return
    setSaving(true)

    const { code, tabs } = useSessionStore.getState()
    const hasTabs = tabs.length > 1

    try {
      const result = await taskApi.updateTask(task.taskName, {
        requestorName,
        completionURL,
        isExperiment,
        instructions,
        modelCode: hasTabs ? '' : code,
        tabs: hasTabs ? tabs.map((t) => ({ name: t.name, code: t.code })) : undefined,
      })
      setTask(result)
      toast.success('Task updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  function copyParticipantURL() {
    if (!task) return
    const url = `${window.location.origin}/tasks/${task.taskName}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('URL copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Lookup prompt ──
  if (!task) {
    return (
      <>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Search className="size-4 text-brand" />
            Manage Task
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-5 pb-6">
            <SheetDescription className="mb-5">
              Look up an existing task to edit it, view responses, or share the participant URL.
            </SheetDescription>

            {error && (
              <div className="mb-4 rounded-lg border border-status-error/20 bg-status-error/5 px-3 py-2.5 text-sm text-status-error">
                {error}
              </div>
            )}

            <form onSubmit={handleLoad} className="space-y-4">
              <Field label="Task Name">
                <Input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="hw1_uml_basics"
                  autoFocus
                />
              </Field>
              <Button type="submit" disabled={loading || !taskName.trim()} className="w-full">
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                {loading ? 'Loading...' : 'Load Task'}
              </Button>
            </form>
          </div>
        </div>
      </>
    )
  }

  // ── Task management ──
  const participantURL = `${window.location.origin}/tasks/${task.taskName}`

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => { setTask(null); setError(null) }}
            className="p-0.5 -ml-0.5 rounded hover:bg-surface-2 transition-colors text-ink-muted hover:text-ink cursor-pointer"
            aria-label="Back to task lookup"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <span className="truncate">{task.taskName}</span>
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-8 space-y-6">
          {/* Share section */}
          <div className="space-y-2">
            <label className="block text-xxs font-semibold text-ink-faint uppercase tracking-wider">
              Participant URL
            </label>
            <div className="flex gap-1.5">
              <Input
                value={participantURL}
                readOnly
                className="flex-1 font-mono text-xs select-all"
                onFocus={(e) => e.target.select()}
              />
              <Button variant="outline" size="sm" onClick={copyParticipantURL} className="shrink-0">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>

          {/* Responses */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xxs font-semibold text-ink-faint uppercase tracking-wider">
                <Users className="size-3" />
                Responses ({responses.length})
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => loadData(task.taskName)} aria-label="Refresh responses">
                <RefreshCw className="size-3" />
              </Button>
            </div>
            {responses.length === 0 ? (
              <div className="rounded-lg border border-border border-dashed py-6 text-center">
                <p className="text-xs text-ink-faint">No responses yet</p>
                <p className="text-xxs text-ink-faint mt-0.5">Share the participant URL to get started</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                {responses.map((r) => (
                  <div key={r.responseId} className="flex items-center justify-between px-3 py-2 hover:bg-surface-1 transition-colors">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-ink truncate">{r.responseId}</p>
                      {r.submittedAt ? (
                        <p className="flex items-center gap-1 text-xxs text-status-success mt-0.5">
                          <Check className="size-2.5" /> Submitted {new Date(r.submittedAt).toLocaleDateString()}
                        </p>
                      ) : (
                        <p className="flex items-center gap-1 text-xxs text-ink-faint mt-0.5">
                          <Clock className="size-2.5" /> In progress
                        </p>
                      )}
                    </div>
                    <a
                      href={`/tasks/responses/${r.responseId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-surface-2 text-ink-muted hover:text-brand transition-colors"
                      aria-label="Open response"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Edit form */}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="text-xxs font-semibold text-ink-faint uppercase tracking-wider">Edit Task</div>

            <Field label="Your Name">
              <Input value={requestorName} onChange={(e) => setRequestorName(e.target.value)} />
            </Field>

            <Field label="Completion URL">
              <Input value={completionURL} onChange={(e) => setCompletionURL(e.target.value)} type="url" placeholder="https://..." />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink">Experiment Mode</p>
                <p className="text-xs text-ink-muted">Log commands for research</p>
              </div>
              <Switch checked={isExperiment} onCheckedChange={setIsExperiment} />
            </div>

            <Field label="Instructions">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-border bg-surface-0 px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors hover:bg-surface-1 focus:border-brand focus:ring-1 focus:ring-brand resize-y"
              />
            </Field>

            <div className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2.5 text-xs text-ink-muted">
              <Send className="size-3.5 shrink-0" />
              <span>Saving will update the starter model with the current editor content</span>
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}

// ── Shared ──

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink mb-1">
        {label}{required && <span className="text-status-error ml-0.5">*</span>}
      </label>
      {hint && <p className="text-xxs text-ink-muted mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}
