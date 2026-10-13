/**
 * Small prompt that appears when Umple text is selected, and sends that selection to the AI agent.
 * It reads the selection from ephemeralStore.
 */

import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Lightbulb } from 'lucide-react'
import { useSessionStore, getActiveTabName } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { cn } from '@/lib/utils'

const TOOLBAR_WIDTH = 260
const GAP = 8
const SHOW_DELAY = 350

export function SelectionToolbar() {
  const selection = useEphemeralStore((s) => s.selection)
  const [input, setInput] = useState('')
  const [stable, setStable] = useState(selection)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Delay showing toolbar so accidental selections can be cancelled
  useEffect(() => {
    if (!selection) {
      setStable(null)
      return
    }
    const id = setTimeout(() => setStable(selection), SHOW_DELAY)
    return () => clearTimeout(id)
  }, [selection])

  // Reset input when toolbar hides
  useEffect(() => {
    if (!stable) setInput('')
  }, [stable])


  if (!stable?.coords) return null

  function buildMessage(prompt: string) {
    const sel = useEphemeralStore.getState().selection
    if (!sel) return null
    const tabName = getActiveTabName()
    const label =
      sel.fromLine === sel.toLine
        ? `${tabName} (${sel.fromLine})`
        : `${tabName} (${sel.fromLine}:${sel.toLine})`
    return `[${label}]\n\`\`\`\n${sel.text}\n\`\`\`\n\n${prompt}`
  }

  function handleSend(prompt: string) {
    const message = buildMessage(prompt)
    if (!message) return
    useEphemeralStore.getState().queueAgentMessage(message)
    useSessionStore.getState().openAgentPanel()
    useEphemeralStore.getState().setSelection(null)
    setInput('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) handleSend(input.trim())
    }
    if (e.key === 'Escape') {
      useEphemeralStore.getState().setSelection(null)
    }
  }

  // Position below selection, fall back to above if near viewport bottom
  let top = stable.coords.yBottom + GAP
  let left = stable.coords.x

  left = Math.max(8, Math.min(left, window.innerWidth - TOOLBAR_WIDTH - 8))

  const ESTIMATED_HEIGHT = 100
  if (top + ESTIMATED_HEIGHT > window.innerHeight - 8) {
    top = stable.coords.yTop - ESTIMATED_HEIGHT - GAP
  }

  return createPortal(
    <div
      className="fixed z-50 w-[260px] rounded-2xl border border-border bg-surface-0 p-1 pb-0.5 shadow-[var(--shadow-elevated)] animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top, left }}
    >
      {/* Input row */}
      <div className="mb-0.5 flex items-center gap-1 rounded-xl bg-surface-1 py-1 pl-3 pr-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about selection..."
          rows={1}
          className="min-h-[20px] flex-1 resize-none bg-transparent text-sm leading-5 text-ink outline-none placeholder:text-ink-faint"
          style={{ height: 20, overflowY: 'hidden' }}
        />
        <button
          onClick={() => input.trim() && handleSend(input.trim())}
          disabled={!input.trim()}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
            input.trim()
              ? 'cursor-pointer bg-ink text-ink-inverse hover:bg-ink-muted'
              : 'cursor-default text-ink-faint',
          )}
          aria-label="Send"
        >
          <ArrowUp className="size-3.5" />
        </button>
      </div>

      {/* Quick actions */}
      <button
        onClick={() => handleSend('Read the code in the editor and explain the snippet above')}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-1 hover:text-ink"
      >
        <Lightbulb className="size-4 shrink-0" />
        <span>Explain</span>
      </button>
    </div>,
    document.body,
  )
}
