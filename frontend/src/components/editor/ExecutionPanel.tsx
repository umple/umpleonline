/**
 * Message pane under the editor.
 * Shows compiler issues, Execute output, and the AI fix action on an error.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import type { ParsedIssue } from '../../stores/ephemeralStore'
import { useSessionStore } from '../../stores/sessionStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { ChevronDown, Check, AlertTriangle, X, XCircle, Sparkles, Loader2, Copy, Terminal } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { resolveIssueTab } from './issueNavigation'

/** Animated checkmark that draws itself on mount */
function AnimatedCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3.5 8.5 6.5 11.5 12.5 5" className="animate-check-draw" />
    </svg>
  )
}

function useIsAiConfigured() {
  return usePreferencesStore((s) => {
    const cfg = s.configs[s.activeProvider]
    return !!(cfg.apiKey.trim() && cfg.model.trim())
  })
}

function triggerAIFix() {
  const { executionOutput, executionErrors } = useEphemeralStore.getState()
  const errorInfo = [executionOutput, executionErrors].filter(Boolean).join('\n')
  if (!errorInfo) return
  useEphemeralStore.getState().queueAgentMessage(
    `Fix the following compilation issues:\n\n\`\`\`\n${errorInfo}\n\`\`\``,
  )
  useSessionStore.getState().openAgentPanel()
}

interface ExecutionSection {
  heading: string | null
  body: string
}

const MAIN_METHOD_HEADING_RE = /^<strong>(For main method in class .*?:)<\/strong>\n?/gm

function parseExecutionSections(output: string): ExecutionSection[] | null {
  const matches = Array.from(output.matchAll(MAIN_METHOD_HEADING_RE))
  if (!matches.length) return null

  const sections: ExecutionSection[] = []
  let cursor = 0

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const start = match.index ?? 0
    const bodyStart = start + match[0].length
    const bodyEnd = matches[i + 1]?.index ?? output.length

    if (start > cursor) {
      sections.push({ heading: null, body: output.slice(cursor, start) })
    }

    sections.push({
      heading: match[1] ?? null,
      // The backend always inserts one newline after the heading marker.
      body: output.slice(bodyStart, bodyEnd).replace(/^\n/, ''),
    })

    cursor = bodyEnd
  }

  if (cursor < output.length) {
    sections.push({ heading: null, body: output.slice(cursor) })
  }

  return sections.filter((section) => section.heading || section.body)
}

// ── Shared badge pills ──────────────────────────────────────────────

function BadgePills({ errorCount, warningCount }: { errorCount: number; warningCount: number }) {
  return (
    <>
      {errorCount > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-status-error/15 px-1.5 py-0.5 text-xs font-semibold leading-none text-status-error">
          {errorCount} {errorCount === 1 ? 'error' : 'errors'}
        </span>
      )}
      {warningCount > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-xs font-semibold leading-none text-status-warning">
          {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
        </span>
      )}
    </>
  )
}

function Badges() {
  const errorCount = useEphemeralStore((s) => s.outputErrorCount)
  const warningCount = useEphemeralStore((s) => s.outputWarningCount)

  if (!errorCount && !warningCount) return null

  return (
    <div className="flex items-center gap-1.5">
      <BadgePills errorCount={errorCount} warningCount={warningCount} />
    </div>
  )
}

// ── Single issue row ────────────────────────────────────────────────

function IssueRow({ issue }: { issue: ParsedIssue }) {
  const isError = issue.severity <= 2
  const severityLabel = isError ? 'error' : 'warning'
  const colorClass = isError ? 'text-status-error' : 'text-status-warning'
  const bgClass = isError ? 'bg-status-error/5' : 'bg-status-warning/5'
  const Icon = isError ? XCircle : AlertTriangle
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
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
    <div className={`flex cursor-default items-start gap-2 rounded-lg px-2.5 py-2 ${bgClass}`}>
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className={`min-w-0 break-words font-mono text-xs leading-relaxed ${colorClass}`}>
          <span className="font-semibold">{severityLabel}</span>
          {issue.line > 0 && targetTab ? (
            <>
              <span>{' on '}</span>
              <button
                type="button"
                onClick={handleJump}
                className={cn(
                  'inline cursor-pointer rounded px-0.5 font-semibold underline decoration-current/70 underline-offset-2 transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1',
                  isError
                    ? 'hover:text-status-error'
                    : 'hover:text-status-warning',
                )}
              >
                {`line ${issue.line}`}
              </button>
            </>
          ) : issue.line > 0 ? (
            <span>{` on line ${issue.line}`}</span>
          ) : null}
          <span>{`: ${issue.message}`}</span>
        </div>
        {(showTabLabel || issue.url) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {issue.url && (
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xxs leading-relaxed text-ink-muted underline decoration-border-strong/70 underline-offset-2 transition-colors hover:text-brand"
              >
                {issue.errorCode ? `More information (${issue.errorCode})` : 'More information'}
              </a>
            )}
            {showTabLabel && (
              <span className="rounded-full bg-surface-0/80 px-1.5 py-0.5 font-mono text-xxs text-ink-muted">
                {targetTab.name}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── OutputBadges (for TabBar — clickable toggle) ────────────────────

export function OutputBadges() {
  const errorCount = useEphemeralStore((s) => s.outputErrorCount)
  const warningCount = useEphemeralStore((s) => s.outputWarningCount)
  const toggleOutputPanel = useEphemeralStore((s) => s.toggleOutputPanel)

  if (!errorCount && !warningCount) return null

  return (
    <button
      onClick={toggleOutputPanel}
      className="flex items-center gap-1.5 px-2 h-full cursor-pointer hover:bg-surface-2/50 transition-colors"
      aria-label="Toggle output panel"
    >
      <BadgePills errorCount={errorCount} warningCount={warningCount} />
    </button>
  )
}

// ── CompileStatusStrip (28px inline strip — success/warning) ────────

export function CompileStatusStrip() {
  const outputView = useEphemeralStore((s) => s.outputView)
  const errorCount = useEphemeralStore((s) => s.outputErrorCount)
  const warningCount = useEphemeralStore((s) => s.outputWarningCount)
  const executionOutput = useEphemeralStore((s) => s.executionOutput)
  const setOutputView = useEphemeralStore((s) => s.setOutputView)
  const isAiConfigured = useIsAiConfigured()

  const isSuccess = errorCount === 0 && warningCount === 0

  // Auto-dismiss success strip after 5 seconds
  useEffect(() => {
    if (outputView !== 'strip' || !isSuccess) return
    const timer = setTimeout(() => setOutputView('hidden'), 5000)
    return () => clearTimeout(timer)
  }, [outputView, isSuccess, executionOutput, setOutputView])

  if (outputView !== 'strip') return null

  return (
    <div role="status" aria-live="polite" className={cn('flex h-7 shrink-0 items-center justify-between border-t border-border px-3 text-xs animate-strip-in', isSuccess && 'animate-success-glow')}>
      <div className="flex items-center gap-1.5">
        {isSuccess ? (
          <>
            <AnimatedCheck className="size-3.5 text-status-success" />
            <span className="text-ink-muted">Output regenerated</span>
          </>
        ) : (
          <>
            <AlertTriangle className="size-3.5 text-status-warning" />
            <span className="text-ink">
              Compiled with {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!isSuccess && isAiConfigured && (
          <button
            onClick={triggerAIFix}
            className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 text-xxs text-brand transition-colors hover:text-brand-hover"
          >
            <Sparkles className="size-3" />
            Fix
          </button>
        )}
        {!isSuccess && (
          <button
            onClick={() => setOutputView('panel')}
            className="text-xxs text-ink-muted hover:text-ink transition-colors cursor-pointer px-1"
          >
            Show details
          </button>
        )}
        <Tip content="Dismiss" side="top">
          <button
            onClick={() => setOutputView('hidden')}
            className="flex items-center justify-center size-5 rounded text-ink-faint hover:text-ink-muted transition-colors cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="size-3" />
          </button>
        </Tip>
      </div>
    </div>
  )
}

// ── OutputPanel (full expanded panel with scrollable output) ────────

export function OutputPanel() {
  const setOutputView = useEphemeralStore((s) => s.setOutputView)
  const executing = useEphemeralStore((s) => s.executing)
  const outputRef = useRef<HTMLDivElement>(null)
  const executionOutput = useEphemeralStore((s) => s.executionOutput)
  const executionErrors = useEphemeralStore((s) => s.executionErrors)
  const parsedIssues = useEphemeralStore((s) => s.parsedIssues)
  const rawErrorText = useEphemeralStore((s) => s.rawErrorText)
  const errorCount = useEphemeralStore((s) => s.outputErrorCount)
  const warningCount = useEphemeralStore((s) => s.outputWarningCount)
  const isAiConfigured = useIsAiConfigured()
  const hasIssues = errorCount > 0 || warningCount > 0
  const [copied, setCopied] = useState(false)
  const executionSections = useMemo(() => parseExecutionSections(executionOutput), [executionOutput])

  const hasContent = !!(executionOutput || executionErrors)

  const handleCopy = useCallback(() => {
    const text = [executionOutput, executionErrors].filter(Boolean).join('\n')
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [executionOutput, executionErrors])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [executionOutput, executionErrors])

  return (
    <div className="flex h-full flex-col" data-testid="output-panel">
      {/* Header */}
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted flex items-center gap-1.5">
            Output
            {executing && <Loader2 className="size-3 animate-spin text-brand" />}
          </span>
          <Badges />
          {isAiConfigured && hasIssues && (
            <button
              onClick={triggerAIFix}
              className="flex cursor-pointer items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xxs font-medium text-brand transition-colors hover:bg-brand/20"
            >
              <Sparkles className="size-3" />
              Fix
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Tip content={copied ? 'Copied!' : 'Copy'} side="bottom">
            <button
              onClick={handleCopy}
              disabled={!hasContent}
              className="flex items-center justify-center size-6 rounded-md transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1 disabled:opacity-30 disabled:cursor-default"
              aria-label="Copy output"
            >
              {copied
                ? <Check className="size-3.5 text-status-success" />
                : <Copy className="size-3.5 text-ink-faint hover:text-ink-muted" />}
            </button>
          </Tip>
          <Tip content="Collapse" side="bottom">
            <button
              onClick={() => setOutputView('hidden')}
              className="flex items-center justify-center size-6 rounded-md text-ink-faint hover:text-ink-muted hover:bg-surface-1 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
              aria-label="Collapse output"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        role="log"
        aria-live="polite"
        className="flex-1 overflow-auto bg-surface-0"
      >
        {executionOutput && (
          executionSections ? (
            <div className="flex flex-col gap-3 px-2.5 py-2.5">
              {executionSections.map((section, index) => (
                <section
                  key={`${section.heading ?? 'body'}-${index}`}
                  className={cn(section.heading && index > 0 && 'border-t border-border/70 pt-3')}
                >
                  {section.heading && (
                    <h3 className="mb-1.5 text-xs font-semibold text-ink">
                      {section.heading}
                    </h3>
                  )}
                  {section.body && (
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink">
                      {section.body}
                    </pre>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words px-2.5 pt-2.5 font-mono text-xs leading-relaxed text-ink">
              {executionOutput}
            </pre>
          )
        )}
        {parsedIssues.length > 0 && (
          <div className="flex flex-col gap-px px-1.5 py-1.5">
            {parsedIssues.map((issue, i) => (
              <IssueRow key={`${issue.errorCode}-${issue.line}-${i}`} issue={issue} />
            ))}
          </div>
        )}
        {rawErrorText && (
          <pre className="m-0 whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-xs leading-relaxed text-status-error">
            {rawErrorText}
          </pre>
        )}
        {!executionOutput && !parsedIssues.length && !rawErrorText && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4 animate-fade-in">
            <Terminal className="size-5 text-ink-faint/50" strokeWidth={1.5} />
            <p className="text-xs text-ink-faint max-w-48 leading-relaxed">
              Message output will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
