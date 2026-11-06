/**
 * The Umple AI chat panel over the editor.
 * Hosts the transcript and the input bar. useAgent runs the model; this component is the UI.
 */

import {
  memo,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  type MouseEvent,
} from 'react'
import {
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useSessionStore } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { prefersReducedMotion } from '@/hooks/useReducedMotion'
import { useAgent } from '@/ai/useAgent'
import { useDiffPreviewSync } from '@/ai/useDiffPreviewSync'
import { useResizablePanel } from './useResizablePanel'
import { InputBar } from './InputBar'
import { MessageBubble } from './MessageBubble'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { UmpleSpinner } from '@/components/UmpleSpinner'
import { SPINNER_VERBS } from '@/constants/spinnerVerbs'

/* ── Constants ── */

const MIN_HEIGHT = 200
const DEFAULT_HEIGHT = 400
const MAX_HEIGHT_VH = 0.8
const FOLD_THRESHOLD = 80

/* ── Main Component ── */

function AgentPanel() {
  const { messages, status, error, send, stop, reset, approveToolCall, rejectToolCall } =
    useAgent()
  const {
    showAgentPanel,
    showAgentBar,
    openAgentPanel,
    closeAgentPanel,
    revealAgentBar,
    hideAgentBar,
  } = useSessionStore()
  const code = useSessionStore((s) => s.code)
  const selection = useEphemeralStore((s) => s.selection)
  const clearSelection = useEphemeralStore((s) => s.setSelection)
  const activeTabName = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.name) ?? 'Model.ump'
  const expanded = showAgentPanel
  const collapsedBarVisible = showAgentBar && !expanded
  const launcherVisible = !showAgentBar && !expanded
  const [focusCollapsedInput, setFocusCollapsedInput] = useState(false)
  const [focusExpandedInput, setFocusExpandedInput] = useState(false)

  /* ── Resize ── */
  const {
    height,
    setHeight,
    panelRef,
    resizeHandlers,
    resetSuppressClick,
    shouldSuppressClick,
  } = useResizablePanel({
    defaultHeight: DEFAULT_HEIGHT,
    minHeight: MIN_HEIGHT,
    maxHeightVh: MAX_HEIGHT_VH,
    foldThreshold: FOLD_THRESHOLD,
    onFold: closeAgentPanel,
    onResize: () => setMaximized(false),
  })

  /* ── Maximize ── */
  const [maximized, setMaximized] = useState(false)
  const prevHeight = useRef(DEFAULT_HEIGHT)

  const toggleMaximize = useCallback(() => {
    if (maximized) {
      setHeight(prevHeight.current)
      setMaximized(false)
    } else {
      prevHeight.current = panelRef.current?.offsetHeight ?? height
      // Match the editor container height (parent of the absolutely-positioned panel)
      const containerH = panelRef.current?.parentElement?.offsetHeight
      setHeight(containerH ? containerH - 16 : window.innerHeight * MAX_HEIGHT_VH)
      setMaximized(true)
    }
  }, [maximized, height, setHeight, panelRef])

  /* ── Input state ── */
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isStreaming = status === 'submitted' || status === 'streaming'
  const canSend = input.trim().length > 0 && !isStreaming

  // Pick a fresh verb each time streaming begins
  const [spinnerVerb, setSpinnerVerb] = useState('')
  useEffect(() => {
    if (isStreaming) {
      setSpinnerVerb(SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)])
    }
  }, [isStreaming])

  const selectionBadge = selection
    ? selection.fromLine === selection.toLine
      ? `${activeTabName} (${selection.fromLine})`
      : `${activeTabName} (${selection.fromLine}:${selection.toLine})`
    : null
  const userScrolledUp = useRef(false)

  /* Track whether the user has scrolled up */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      const gap = el!.scrollHeight - el!.scrollTop - el!.clientHeight
      userScrolledUp.current = gap > 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  /* ── Consume pending messages from SelectionToolbar ── */
  const pendingAgentMessage = useEphemeralStore((s) => s.pendingAgentMessage)
  const consumeAgentMessage = useEphemeralStore((s) => s.consumeAgentMessage)

  useEffect(() => {
    if (!pendingAgentMessage) return
    const msg = consumeAgentMessage()
    if (msg) {
      send(msg)
      userScrolledUp.current = false
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
      })
    }
  }, [pendingAgentMessage, consumeAgentMessage, send])

  /* Auto-scroll on new messages — skip if the user has scrolled up */
  useEffect(() => {
    if (!userScrolledUp.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      })
    }
  }, [messages])

  /* Scroll to bottom when the panel re-expands (scroll container remounts) —
     useLayoutEffect + direct scrollTop fires before paint so the user never
     sees the scroll container at the wrong position. */
  useLayoutEffect(() => {
    if (expanded && messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Preview sync ── */
  const pendingPreview = useDiffPreviewSync(messages, code)

  /* ── Handlers ── */

  function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return
    if (!expanded) handleExpandPanel(true)

    let message = text
    if (selection) {
      message = `[${selectionBadge}]\n\`\`\`\n${selection.text}\n\`\`\`\n\n${text}`
      clearSelection(null)
    }

    send(message)
    setInput('')
    userScrolledUp.current = false
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
    })
  }

  const handleExpandPanel = useCallback((shouldFocusInput = false) => {
    if (shouldFocusInput) setFocusExpandedInput(true)
    openAgentPanel()
  }, [openAgentPanel])

  const handleLauncherClick = useCallback(() => {
    if (messages.length > 0) {
      handleExpandPanel(true)
      return
    }

    setFocusCollapsedInput(true)
    revealAgentBar()
  }, [handleExpandPanel, messages.length, revealAgentBar])

  const handleHideAgentBar = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setFocusCollapsedInput(false)
    hideAgentBar()
  }, [hideAgentBar])

  const handleCollapsedClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (shouldSuppressClick()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (messages.length > 0) {
        handleExpandPanel(true)
        return
      }

      ;(e.currentTarget.querySelector('textarea') as HTMLTextAreaElement | null)?.focus()
    },
    [handleExpandPanel, messages.length, shouldSuppressClick],
  )

  const handleReset = useCallback(() => {
    reset()
    setInput('')
  }, [reset])

  if (launcherVisible) {
    return (
      <Tip content="Show AI assistant" side="left">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="absolute bottom-3 right-3 z-20 rounded-full shadow-[var(--shadow-elevated)]"
          data-testid="agent-panel-launcher"
          aria-label="Show AI assistant"
          onClick={handleLauncherClick}
        >
          {isStreaming ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
        </Button>
      </Tip>
    )
  }

  /* ── Collapsed: just the input bar ── */
  if (collapsedBarVisible) {
    return (
      <div
        className="absolute bottom-0 left-1/2 z-20 w-full max-w-3xl -translate-x-1/2 px-2 pb-2"
        data-testid="agent-panel-collapsed"
        role="region"
        aria-label="AI assistant"
        onPointerDownCapture={resetSuppressClick}
        onClick={handleCollapsedClick}
      >
        <InputBar
          className="cursor-text shadow-[var(--shadow-elevated)]"
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={stop}
          isStreaming={isStreaming}
          canSend={canSend}
          textareaMaxHeight={60}
          autoFocus={focusCollapsedInput}
          onAutoFocus={() => setFocusCollapsedInput(false)}
          selectionBadge={selectionBadge}
          onClearSelection={() => clearSelection(null)}
        >
          <Tip content="Collapse this bar into the AI button" side="top">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleHideAgentBar}
              className="shrink-0 rounded-full px-3 text-ink-muted"
              aria-label="Hide AI assistant"
            >
              <PanelBottomClose data-icon="inline-start" />
              Hide
            </Button>
          </Tip>
          {messages.length > 0 && (
            <Tip content="Open chat history" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleExpandPanel(true)}
                className="shrink-0 rounded-full text-ink-muted"
                aria-label="Expand chat"
              >
                <ChevronUp />
              </Button>
            </Tip>
          )}
        </InputBar>
      </div>
    )
  }

  /* ── Expanded: full chat panel ── */
  return (
    <div
      ref={panelRef}
      className="absolute bottom-2 left-1/2 z-20 flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 flex-col rounded-t-3xl rounded-b-4xl border border-border bg-surface-0 shadow-[var(--shadow-elevated)] data-[dragging]:!transition-none"
      style={{ height }}
      data-testid="agent-panel"
    >
      {/* Resize handle */}
      <div
        className="flex shrink-0 cursor-row-resize items-center justify-center py-1.5"
        {...resizeHandlers}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chat panel"
      >
        <div className="h-1 w-10 rounded-full bg-ink-faint" />
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 pb-2">
        <Tip content="Collapse to the input bar" side="bottom">
          <button
            onClick={closeAgentPanel}
            className="cursor-pointer rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Collapse chat panel"
          >
            <ChevronDown className="size-4" />
          </button>
        </Tip>

        <div className="flex items-center gap-1">
          <Tip content="Hide assistant until reopened from the AI button" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleHideAgentBar}
              className="shrink-0 rounded-full px-3 text-ink-muted"
              aria-label="Hide AI assistant"
            >
              <PanelBottomClose data-icon="inline-start" />
              Hide
            </Button>
          </Tip>
          <button
            onClick={toggleMaximize}
            className="cursor-pointer rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
          >
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            onClick={handleReset}
            className="cursor-pointer rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Reset conversation"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} role="log" aria-live="polite" className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-full bg-surface-1">
              <span className="text-base text-ink-faint">U</span>
            </div>
            <p className="text-sm text-ink-faint">
              Ask anything about your Umple model.
            </p>
            <p className="text-xs text-ink-faint/60">
              Edit code, explain patterns, generate diagrams
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              pendingPreview={pendingPreview}
              onApprove={approveToolCall}
              onReject={rejectToolCall}
            />
          ))}

          {isStreaming && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <UmpleSpinner size={32} />
              <span className="ai-spinner-text whitespace-nowrap text-sm">{spinnerVerb}…</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-brand-light px-3 py-2 text-sm text-status-error">
              {error.message || 'Something went wrong.'}
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 p-2">
        <InputBar
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={stop}
          isStreaming={isStreaming}
          canSend={canSend}
          textareaMaxHeight={100}
          autoFocus={focusExpandedInput}
          onAutoFocus={() => setFocusExpandedInput(false)}
          selectionBadge={selectionBadge}
          onClearSelection={() => clearSelection(null)}
        />
      </div>
    </div>
  )
}

export default memo(AgentPanel)
