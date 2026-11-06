/**
 * One message in the Umple AI transcript.
 * Renders markdown for the assistant and the diff for a tool call that edits Umple.
 */

import { memo, useCallback, useMemo } from 'react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import {
  Eye,
  PenLine,
  FileCode2,
  Play,
  Sparkles,
  Wrench,
  Check,
  XIcon,
  AlertTriangle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ToolPreviewInfo } from '@/ai/editPreview'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { useSessionStore } from '@/stores/sessionStore'
import { resolveIssueTab } from '@/components/editor/issueNavigation'
import { ActionRow } from './ActionRow'

/* ── Memoized Markdown ── */

const REMARK_PLUGINS = [remarkGfm]

/**
 * Wraps ReactMarkdown in memo so it only re-parses when the text string
 * actually changes — avoids redundant AST parsing during streaming when
 * the throttled render fires but the text part hasn't grown.
 */
const MemoizedMarkdown = memo(function MemoizedMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>
})

/* ── Tool Config ── */

const TOOL_CONFIG: Record<
  string,
  { icon: React.JSX.Element; labels: { running: string; approval: string; done: string } }
> = {
  readEditorCode: {
    icon: <Eye className="size-3" />,
    labels: { running: 'Reading code', approval: 'Reading code', done: 'Read code' },
  },
  editCode: {
    icon: <PenLine className="size-3" />,
    labels: { running: 'Preparing edit', approval: 'Edit proposed', done: 'Edit applied' },
  },
  replaceCode: {
    icon: <FileCode2 className="size-3" />,
    labels: { running: 'Preparing replacement', approval: 'Replace proposed', done: 'Code replaced' },
  },
  compile: {
    icon: <Play className="size-3" />,
    labels: { running: 'Generating', approval: 'Generating', done: 'Generated' },
  },
  verifyCode: {
    icon: <Check className="size-3" />,
    labels: { running: 'Verifying code', approval: 'Verifying code', done: 'Verified code' },
  },
}

/* ── Helpers ── */

function actionLabel(name: string, state: string): string {
  const cfg = TOOL_CONFIG[name]
  if (state === 'input-streaming' || state === 'input-available')
    return cfg?.labels.running ?? `Running ${name}`
  if (state === 'approval-requested')
    return cfg?.labels.approval ?? `${name} needs approval`
  if (state === 'approval-responded') return 'Applying changes'
  if (state === 'output-available')
    return cfg?.labels.done ?? name
  if (state === 'output-error') return `${name} failed`
  if (state === 'output-denied') return `${name} rejected`
  return name
}

function actionStatus(state: string): 'running' | 'done' | 'error' | 'approval' | undefined {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
    case 'approval-responded':
      return 'running'
    case 'approval-requested':
      return 'approval'
    case 'output-available':
    case 'output-denied':
      return 'done'
    case 'output-error':
      return 'error'
    default:
      return undefined
  }
}

/* ── DiffBlock ── */

function DiffBlock({
  text,
  variant,
}: {
  text: string
  variant: 'add' | 'remove' | 'neutral'
}) {
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap break-all px-2 py-1.5',
        variant === 'add' && 'bg-status-success/8 text-status-success',
        variant === 'remove' && 'bg-status-error/8 text-status-error line-through',
        variant === 'neutral' && 'text-ink',
      )}
    >
      {text || '\u00A0'}
    </pre>
  )
}

function formatToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  if (typeof output === 'number' || typeof output === 'boolean') return String(output)

  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function ToolOutputBlock({ output }: { output: unknown }) {
  const formatted = formatToolOutput(output)

  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-0 p-2 font-mono text-xxs leading-relaxed text-ink">
      {formatted || 'No output returned.'}
    </pre>
  )
}

interface VerifyCodeOutput {
  success?: boolean
  errors?: string | null
  modelId?: string | null
}

interface ParsedVerifyIssue {
  severity: number
  errorCode: string
  message: string
  line: number
  filename: string
  url: string
}

function parseVerifyIssues(raw: string | null | undefined): {
  issues: ParsedVerifyIssue[]
  rawText: string
  errorCount: number
  warningCount: number
} {
  if (!raw) return { issues: [], rawText: '', errorCount: 0, warningCount: 0 }

  const allResults: ParsedVerifyIssue[] = []
  const rawLines: string[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed)
      const results = parsed?.results

      if (Array.isArray(results)) {
        for (const result of results) {
          allResults.push({
            severity: Number(result.severity ?? 1),
            errorCode: String(result.errorCode ?? ''),
            message: String(result.message ?? ''),
            line: Number(result.line ?? 0),
            filename: String(result.filename ?? ''),
            url: String(result.url ?? ''),
          })
        }
      } else {
        rawLines.push(trimmed)
      }
    } catch {
      rawLines.push(trimmed)
    }
  }

  const seen = new Set<string>()
  const issues: ParsedVerifyIssue[] = []

  for (const issue of allResults) {
    const key = `${issue.errorCode}:${issue.line}:${issue.message}`
    if (!seen.has(key)) {
      seen.add(key)
      issues.push(issue)
    }
  }

  issues.sort((a, b) => {
    const aBucket = a.severity <= 2 ? 0 : 1
    const bBucket = b.severity <= 2 ? 0 : 1
    if (aBucket !== bBucket) return aBucket - bBucket
    return a.line - b.line
  })

  const rawText = rawLines.join('\n')
  const errorCount = issues.filter((issue) => issue.severity <= 2).length + (rawText && !issues.length ? 1 : 0)
  const warningCount = issues.filter((issue) => issue.severity > 2).length

  return { issues, rawText, errorCount, warningCount }
}

function VerifyIssueRow({ issue }: { issue: ParsedVerifyIssue }) {
  const isError = issue.severity <= 2
  const toneClass = isError ? 'text-status-error' : 'text-status-warning'
  const bgClass = isError ? 'bg-status-error/6' : 'bg-status-warning/8'
  const tabs = useSessionStore((state) => state.tabs)
  const activeTabId = useSessionStore((state) => state.activeTabId)
  const targetTab = useMemo(
    () => resolveIssueTab(tabs, activeTabId, issue.filename),
    [tabs, activeTabId, issue.filename],
  )
  const showTabLabel = !!issue.filename && !!targetTab

  const handleJump = useCallback(() => {
    if (!issue.line || !targetTab) return

    const { setActiveTab } = useSessionStore.getState()
    if (targetTab.id !== useSessionStore.getState().activeTabId) {
      setActiveTab(targetTab.id)
    }

    useEphemeralStore.getState().requestEditorJump({
      tabId: targetTab.id,
      line: issue.line,
    })
  }, [issue.line, targetTab])

  return (
    <div className={`rounded-md px-2.5 py-2 ${bgClass}`}>
      <p className={`break-words font-mono text-xxs leading-relaxed ${toneClass}`}>
        <span className="font-semibold">{isError ? 'Error' : 'Warning'}</span>
        {issue.line > 0 && targetTab ? (
          <>
            <span>{' on '}</span>
            <button
              type="button"
              onClick={handleJump}
              className={cn(
                'inline cursor-pointer rounded px-0.5 font-semibold underline decoration-current/70 underline-offset-2 transition-colors',
                'focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1',
                isError ? 'hover:text-status-error' : 'hover:text-status-warning',
              )}
            >
              {`line ${issue.line}`}
            </button>
          </>
        ) : issue.line > 0 ? (
          <span>{` on line ${issue.line}`}</span>
        ) : null}
        {issue.filename ? ` in ${issue.filename}` : ''}
        {`: ${issue.message}`}
      </p>
      {(showTabLabel || issue.errorCode || issue.url) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {issue.errorCode ? (
            <span className="rounded-full bg-surface-0 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {issue.errorCode}
            </span>
          ) : null}
          {issue.url ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-brand underline underline-offset-2"
            >
              More information
            </a>
          ) : null}
          {showTabLabel ? (
            <span className="rounded-full bg-surface-0 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {targetTab.name}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function VerifyCodeResultCard({ output }: { output: VerifyCodeOutput }) {
  const { issues, rawText, errorCount, warningCount } = parseVerifyIssues(output.errors)
  const isSuccess = Boolean(output.success) && errorCount === 0

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-0 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div
          className={cn(
            'flex size-5 items-center justify-center rounded-full',
            isSuccess ? 'bg-status-success/12 text-status-success' : 'bg-status-error/10 text-status-error',
          )}
        >
          {isSuccess ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            {isSuccess ? 'Verification passed' : 'Verification found issues'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {isSuccess
              ? 'No validation issues were reported.'
              : `${errorCount} ${errorCount === 1 ? 'error' : 'errors'} and ${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}.`}
          </p>
        </div>
        {output.modelId ? (
          <span className="rounded-full bg-surface-1 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
            {output.modelId}
          </span>
        ) : null}
      </div>

      {issues.length > 0 ? (
        <div className="space-y-1.5">
          {issues.map((issue, index) => (
            <VerifyIssueRow
              key={`${issue.errorCode}-${issue.line}-${issue.message}-${index}`}
              issue={issue}
            />
          ))}
        </div>
      ) : null}

      {rawText ? <ToolOutputBlock output={rawText} /> : null}
    </div>
  )
}

/* ── ToolActionRow ── */

function ToolActionRow({
  part,
  previewInfo,
  onApprove,
  onReject,
}: {
  part: any
  previewInfo: ToolPreviewInfo | null
  onApprove: (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    input: any,
  ) => void
  onReject: (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    reason?: string,
  ) => void
}) {
  const toolName = getToolName(part)
  const { toolCallId, state, input, output, errorText } = part
  const icon = TOOL_CONFIG[toolName]?.icon ?? <Wrench className="size-3" />
  let children: React.ReactNode = null

  if (state === 'approval-requested') {
    children = (
      <div className="space-y-2">
        {input?.explanation ? (
          <p className="text-xs text-ink">{input.explanation}</p>
        ) : null}
        {previewInfo?.preview ? (
          <p className="text-xs text-ink-muted">Preview shown in the editor above.</p>
        ) : null}
        {previewInfo?.error ? (
          <p className="text-xs text-status-error">Preview unavailable: {previewInfo.error}</p>
        ) : null}
        {input?.edits && (
          <div className="space-y-1">
            {input.edits.map((edit: any, j: number) => (
              <div
                key={j}
                className="max-h-48 overflow-auto rounded border border-border bg-surface-0 font-mono text-xxs"
              >
                <DiffBlock text={edit.oldText} variant="remove" />
                <DiffBlock text={edit.newText} variant="add" />
              </div>
            ))}
          </div>
        )}
        {input?.code && (
          <div className="max-h-48 overflow-auto rounded border border-border bg-surface-0 font-mono text-xxs">
            <DiffBlock text={input.code} variant="neutral" />
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(part.approval.id, toolCallId, toolName, input)}
            className="flex cursor-pointer items-center gap-1 rounded-md bg-status-success/10 px-2.5 py-1 text-xs font-medium text-status-success transition-colors hover:bg-status-success/20"
          >
            <Check className="size-3" />
            Approve
          </button>
          <button
            onClick={() => onReject(part.approval.id, toolCallId, toolName)}
            className="flex cursor-pointer items-center gap-1 rounded-md bg-status-error/10 px-2.5 py-1 text-xs font-medium text-status-error transition-colors hover:bg-status-error/20"
          >
            <XIcon className="size-3" />
            Reject
          </button>
        </div>
      </div>
    )
  } else if (state === 'output-available' && output != null) {
    children =
      toolName === 'verifyCode' ? (
        <VerifyCodeResultCard output={output as VerifyCodeOutput} />
      ) : (
        <ToolOutputBlock output={output} />
      )
  } else if (state === 'output-error') {
    children = <p className="text-xs text-status-error">{errorText}</p>
  } else if (state === 'output-denied') {
    children = (
      <p className="text-xs text-ink-muted">
        Rejected{part.approval?.reason ? `: ${part.approval.reason}` : ''}
      </p>
    )
  }

  return (
    <ActionRow
      icon={icon}
      label={actionLabel(toolName, state)}
      status={actionStatus(state)}
      autoOpen={state === 'output-available'}
    >
      {children}
    </ActionRow>
  )
}

/* ── Selection context parsing ── */

const SELECTION_RE = /^\[(.+?)\]\n```\n([\s\S]*?)\n```\n\n([\s\S]*)$/

function parseSelectionContext(text: string) {
  const m = text.match(SELECTION_RE)
  if (!m) return null
  return { label: m[1], code: m[2], question: m[3] }
}

/* ── MessageBubble ── */

export function MessageBubble({
  message,
  pendingPreview,
  onApprove,
  onReject,
}: {
  message: UIMessage
  pendingPreview: ToolPreviewInfo | null
  onApprove: (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    input: any,
  ) => void
  onReject: (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    reason?: string,
  ) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex flex-col gap-1 animate-message-in', isUser && 'items-end')}>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          if (!part.text) return null
          if (isUser) {
            const sel = parseSelectionContext(part.text)
            if (sel) {
              return (
                <div
                  key={i}
                  className="max-w-[calc(100%-2rem)] space-y-1.5 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-ink"
                >
                  <span className="inline-block rounded-full bg-surface-0 px-2 py-0.5 text-xs text-ink-muted">
                    {sel.label}
                  </span>
                  <pre className="overflow-x-auto rounded-lg bg-surface-0 px-2.5 py-1.5 font-mono text-xs text-ink-muted">
                    {sel.code}
                  </pre>
                  <p>{sel.question}</p>
                </div>
              )
            }
            return (
              <div
                key={i}
                className="max-w-[calc(100%-2rem)] rounded-2xl bg-surface-2 px-3 py-2 text-sm text-ink"
              >
                {part.text}
              </div>
            )
          }
          return (
            <div
              key={i}
              className="prose prose-sm dark:prose-invert max-w-[calc(100%-2rem)] px-1 text-ink prose-p:my-1.5 prose-pre:bg-surface-1 prose-pre:text-ink prose-code:text-ink prose-headings:text-ink prose-strong:text-ink prose-a:text-brand prose-pre:border prose-pre:border-border"
            >
              <MemoizedMarkdown text={part.text} />
            </div>
          )
        }

        if (part.type === 'reasoning') {
          const rp = part as any
          return (
            <ActionRow
              key={i}
              icon={<Sparkles className="size-3" />}
              label={rp.state === 'streaming' ? 'Thinking...' : 'Thought'}
              status={rp.state === 'streaming' ? 'running' : 'done'}
            >
              {rp.text ? (
                <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-ink-muted">
                  {rp.text}
                </p>
              ) : null}
            </ActionRow>
          )
        }

        if (part.type === 'step-start') {
          return i > 0 ? (
            <div key={i} className="my-1 border-t border-border/50" />
          ) : null
        }

        if (isToolUIPart(part)) {
          const preview =
            pendingPreview?.toolCallId === part.toolCallId ? pendingPreview : null
          return (
            <ToolActionRow
              key={i}
              part={part}
              previewInfo={preview}
              onApprove={onApprove}
              onReject={onReject}
            />
          )
        }

        return null
      })}
    </div>
  )
}
