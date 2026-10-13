/**
 * Sidebar block for the teaching task loaded from a /tasks link.
 * Opens TaskSheet. Hidden when no task is loaded.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Check, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTaskStore } from '@/stores/taskStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { taskApi } from '@/api/taskApi'

/**
 * Sidebar section shown when the user is working on a task response.
 * Displays task metadata, instructions (collapsible), and submit controls.
 */
export function TaskSidebarSection() {
  const taskName = useTaskStore((s) => s.taskName)
  const requestorName = useTaskStore((s) => s.requestorName)
  const instructions = useTaskStore((s) => s.instructions)
  const responseId = useTaskStore((s) => s.responseId)
  const submittedAt = useTaskStore((s) => s.submittedAt)
  const completionURL = useTaskStore((s) => s.completionURL)

  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  if (!responseId) return null

  async function handleSubmit() {
    if (!responseId || submitting) return
    setSubmitting(true)
    try {
      const result = await taskApi.submitResponse(responseId)
      useTaskStore.getState().setSubmitted(result.submittedAt!)
      useEphemeralStore.getState().setReadOnly(true)
      toast.success('Response submitted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-b border-border/60">
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="text-xxs font-semibold text-ink-faint uppercase tracking-wider mb-1">Task</div>
        <p className="text-sm font-medium text-ink truncate">{taskName}</p>
        {requestorName && (
          <p className="text-xs text-ink-muted truncate">by {requestorName}</p>
        )}
      </div>

      {/* Instructions (collapsible) */}
      {instructions && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setInstructionsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink transition-colors cursor-pointer w-full"
          >
            {instructionsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Instructions
          </button>
          {instructionsOpen && (
            <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-surface-0 p-2.5">
              <div className="prose prose-sm max-w-none text-ink prose-headings:text-ink prose-a:text-brand text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {instructions}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submit controls */}
      <div className="px-4 pb-3">
        {submittedAt ? (
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1 rounded-full bg-status-success/10 px-2 py-0.5 text-xs font-medium text-status-success">
              <Check className="size-3" />
              Submitted {new Date(submittedAt).toLocaleDateString()}
            </div>
            {completionURL && (
              <a
                href={completionURL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
              >
                Continue <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ) : (
          <Button size="xs" onClick={handleSubmit} disabled={submitting} className="w-full" data-testid="submit-response-btn">
            <Send className="size-3" />
            {submitting ? 'Submitting...' : 'Submit Response'}
          </Button>
        )}
      </div>
    </div>
  )
}
