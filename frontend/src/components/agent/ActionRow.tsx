/**
 * One tool-call row in the AI transcript: running, done, failed, or waiting for approval.
 * MessageBubble renders an ActionRow for each tool the agent invokes.
 */

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ChevronRight, Loader2, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ActionStatus = 'running' | 'done' | 'error' | 'approval'

interface ActionRowProps {
  icon: ReactNode
  label: string
  status?: ActionStatus
  children?: ReactNode
  autoOpen?: boolean
}

/**
 * Collapsible action disclosure — the building block for tool calls,
 * reasoning steps, and other agent actions.
 *
 * Collapsed: icon + label + status indicator (one-line summary).
 * Expanded:  detail panel below (diffs, output, approval buttons, etc.).
 *
 * Auto-expands when status is 'approval' or 'error'.
 */
export function ActionRow({
  icon,
  label,
  status,
  children,
  autoOpen = false,
}: ActionRowProps) {
  const hasContent = !!children
  const [open, setOpen] = useState(
    status === 'approval' || status === 'error' || autoOpen,
  )
  const prevStatus = useRef(status)
  const [flash, setFlash] = useState(false)

  /* Auto-expand when approval is requested or an error occurs */
  useEffect(() => {
    if (status === 'approval' || status === 'error') setOpen(true)
  }, [status])

  /* Auto-expand when content becomes available and the caller wants it visible */
  useEffect(() => {
    if (autoOpen && hasContent) setOpen(true)
  }, [autoOpen, hasContent])

  /* Flash green when transitioning to done */
  useEffect(() => {
    if (status === 'done' && prevStatus.current === 'running') {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      return () => clearTimeout(t)
    }
    prevStatus.current = status
  }, [status])

  return (
    <div className={cn(flash && 'animate-action-done rounded-md')}>
      <button
        type="button"
        onClick={() => hasContent && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
          hasContent
            ? 'cursor-pointer hover:bg-surface-1'
            : 'cursor-default',
        )}
        aria-expanded={hasContent ? open : undefined}
      >
        {/* Toggle chevron (only when expandable) */}
        {hasContent ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-ink-faint transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {/* Action icon */}
        <span className="shrink-0 text-ink-muted">{icon}</span>

        {/* Label */}
        <span className="flex-1 truncate text-ink-muted">{label}</span>

        {/* Status indicator */}
        {status === 'running' && (
          <Loader2 className="size-3 shrink-0 animate-spin text-ink-faint" />
        )}
        {status === 'done' && (
          <Check className="size-3 shrink-0 text-status-success" />
        )}
        {status === 'error' && (
          <AlertCircle className="size-3 shrink-0 text-status-error" />
        )}
        {status === 'approval' && (
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-status-warning" />
        )}
      </button>

      {/* Expandable detail panel */}
      {open && children && (
        <div className="ml-[18px] mt-1 border-l border-border pb-1 pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
