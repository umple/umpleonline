/**
 * Text box at the bottom of the AI panel.
 * Submits a prompt and can stop a response that is still streaming.
 */

import { useRef, useEffect, type KeyboardEvent } from 'react'
import { ArrowUp, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InputBarProps {
  className?: string
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  canSend: boolean
  textareaMaxHeight: number
  autoFocus?: boolean
  onAutoFocus?: () => void
  children?: React.ReactNode
  selectionBadge?: string | null
  onClearSelection?: () => void
}

export function InputBar({
  className,
  input,
  onInputChange,
  onSend,
  onStop,
  isStreaming,
  canSend,
  textareaMaxHeight,
  autoFocus = false,
  onAutoFocus,
  children,
  selectionBadge,
  onClearSelection,
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`
  }, [input, textareaMaxHeight])

  useEffect(() => {
    if (!autoFocus) return
    textareaRef.current?.focus()
    onAutoFocus?.()
  }, [autoFocus, onAutoFocus])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
    if (
      e.key === 'Backspace' &&
      selectionBadge &&
      onClearSelection &&
      textareaRef.current?.selectionStart === 0 &&
      textareaRef.current?.selectionEnd === 0
    ) {
      onClearSelection()
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[2rem] border border-border bg-surface-0 py-1.5 pl-4 pr-1.5 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand',
        className,
      )}
    >
      {selectionBadge && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2 pr-1 text-xs text-ink-muted">
          {selectionBadge}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClearSelection?.()
            }}
            className="cursor-pointer rounded-full p-0.5 transition-colors hover:text-ink"
            aria-label="Clear selection"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
      <textarea
        ref={textareaRef}
        data-slot="agent-input"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        rows={1}
        style={{ maxHeight: textareaMaxHeight }}
        className="min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none focus-visible:ring-0 placeholder:text-ink-faint"
      />
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-ink-inverse transition-all duration-100 hover:bg-ink-muted active:scale-90"
            aria-label="Stop generation"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSend}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full transition-all duration-100',
              canSend
                ? 'cursor-pointer bg-ink text-ink-inverse hover:bg-ink-muted active:scale-90'
                : 'cursor-default bg-surface-2 text-ink-faint',
            )}
            aria-label="Send message"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
