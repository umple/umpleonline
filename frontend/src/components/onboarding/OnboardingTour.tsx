/**
 * First-run spotlight tour.
 * Walks the toolbar and the two panes after WelcomeDialog closes. Motion is dropped when the user prefers reduced motion.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { Button } from '@/components/ui/button'
import { usePrefersReducedMotion } from '@/hooks/useReducedMotion'
import {
  ArrowRight,
  X,
  MousePointerClick,
  Sparkles,
  Bot,
  Columns2,
  LayoutDashboard,
  Command,
} from 'lucide-react'

// ── Tour step definitions ──

interface TourStep {
  target: string
  title: string
  description: string
  placement: 'top' | 'bottom' | 'left' | 'right'
  icon: React.ComponentType<{ className?: string }>
  interactive?: boolean
  detectComplete?: () => boolean
  autoAdvanceMs?: number
  onActivate?: () => void
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="diagram-view"]',
    title: 'Switch to State Machine',
    description: 'Open this view picker and select "State" to switch the diagram view.',
    placement: 'bottom',
    icon: MousePointerClick,
    interactive: true,
    detectComplete: () => useSessionStore.getState().viewMode === 'state',
  },
  {
    target: '[data-tour="examples"]',
    title: 'Pick a state machine example',
    description: 'Choose any example from the picker to load a state machine model.',
    placement: 'right',
    icon: MousePointerClick,
    interactive: true,
    detectComplete: () => {
      const { selectedExample, viewMode } = useSessionStore.getState()
      return viewMode === 'state' && selectedExample !== null
    },
  },
  {
    target: '[data-testid="diagram-panel"]',
    title: 'Your diagram is rendering',
    description: 'The state machine diagram updates automatically as the model compiles. You can pan, zoom, and interact with it.',
    placement: 'left',
    icon: Sparkles,
    autoAdvanceMs: 4000,
  },
  {
    target: '[data-tour="generate"]',
    title: 'Generate Python code',
    description: 'Select "Python" from the target picker, then click Generate to produce working code from your model.',
    placement: 'right',
    icon: MousePointerClick,
    interactive: true,
    detectComplete: () => {
      const { generatedCode } = useEphemeralStore.getState()
      return generatedCode.length > 0
    },
  },
]

// ── Feature hints for the final step ──

const FEATURE_HINTS = [
  { icon: Bot, label: 'Umple AI', hint: 'Use the AI button in the top toolbar to configure a provider and get modeling assistance' },
  { icon: LayoutDashboard, label: 'Layout Algorithm', hint: 'Change how diagram nodes are arranged (dot, sfdp, circo, etc.)' },
  { icon: Columns2, label: 'Preferences Sidebar', hint: 'Open the sidebar from the top toolbar when you need theme or release preferences' },
  { icon: Command, label: 'Command Palette', hint: 'Press Ctrl+K to quickly search examples, diagrams, and generators' },
]

// ── Positioning helpers ──

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const SPOTLIGHT_PADDING = 8
const CARD_GAP = 12

function getCardStyle(
  target: Rect,
  placement: TourStep['placement'],
  cardWidth: number,
  cardHeight: number,
): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0

  switch (placement) {
    case 'bottom':
      top = target.top + target.height + CARD_GAP
      left = target.left + target.width / 2 - cardWidth / 2
      break
    case 'top':
      top = target.top - cardHeight - CARD_GAP
      left = target.left + target.width / 2 - cardWidth / 2
      break
    case 'right':
      top = target.top + target.height / 2 - cardHeight / 2
      left = target.left + target.width + CARD_GAP
      break
    case 'left':
      top = target.top + target.height / 2 - cardHeight / 2
      left = target.left - cardWidth - CARD_GAP
      break
  }

  top = Math.max(8, Math.min(top, vh - cardHeight - 8))
  left = Math.max(8, Math.min(left, vw - cardWidth - 8))

  return { position: 'fixed', top, left, width: cardWidth }
}

// ── Main component ──

export function OnboardingTour() {
  const tourStep = useEphemeralStore((s) => s.tourStep)
  const setTourStep = useEphemeralStore((s) => s.setTourStep)
  const finishTour = useEphemeralStore((s) => s.finishTour)

  const reducedMotion = usePrefersReducedMotion()
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const featureHintsRef = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 320, h: 200 })

  const step = tourStep !== null && tourStep < TOUR_STEPS.length ? TOUR_STEPS[tourStep] : null
  const showFeatureHints = tourStep !== null && tourStep >= TOUR_STEPS.length

  // Run onActivate when step changes
  useEffect(() => {
    if (step?.onActivate) step.onActivate()
  }, [step])

  // Focus tour card when step changes
  useEffect(() => {
    if (step) cardRef.current?.focus()
  }, [tourStep, step])

  // Focus feature hints dialog on mount
  useEffect(() => {
    if (showFeatureHints) featureHintsRef.current?.focus()
  }, [showFeatureHints])

  // Measure target element position — only update state when rect actually changes
  useLayoutEffect(() => {
    if (!step) {
      setTargetRect(null)
      return
    }

    const el = document.querySelector(step.target)

    const measure = () => {
      if (!el) { setTargetRect(null); return }
      const r = el.getBoundingClientRect()
      setTargetRect((prev) => {
        if (prev && r.top === prev.top && r.left === prev.left &&
            r.width === prev.width && r.height === prev.height) return prev
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      })
    }

    const initial = setTimeout(measure, 50)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      clearTimeout(initial)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])

  // Measure card size for positioning
  useLayoutEffect(() => {
    if (!cardRef.current) return
    const r = cardRef.current.getBoundingClientRect()
    setCardSize((prev) => {
      if (r.width === prev.w && r.height === prev.h) return prev
      return { w: r.width, h: r.height }
    })
  }, [tourStep])

  // Auto-advance for non-interactive steps
  useEffect(() => {
    if (!step?.autoAdvanceMs || step.interactive) return

    const timer = setTimeout(() => {
      setTourStep((useEphemeralStore.getState().tourStep ?? 0) + 1)
    }, step.autoAdvanceMs)

    return () => clearTimeout(timer)
  }, [step, setTourStep])

  // Detect interactive step completion via zustand subscribe
  useEffect(() => {
    if (!step?.interactive || !step.detectComplete) return

    // Check immediately
    if (step.detectComplete()) {
      const timer = setTimeout(() => {
        const curr = useEphemeralStore.getState().tourStep
        if (curr !== null) setTourStep(curr + 1)
      }, 600)
      return () => clearTimeout(timer)
    }

    let advanced = false
    const advance = () => {
      if (advanced || !step.detectComplete!()) return
      advanced = true
      setTimeout(() => {
        const curr = useEphemeralStore.getState().tourStep
        if (curr !== null) setTourStep(curr + 1)
      }, 600)
    }

    const unsubs = [
      useSessionStore.subscribe(advance),
      useEphemeralStore.subscribe(advance),
    ]
    return () => unsubs.forEach((u) => u())
  }, [step, setTourStep])

  const handleNext = useCallback(() => {
    if (tourStep === null) return
    setTourStep(tourStep < TOUR_STEPS.length - 1 ? tourStep + 1 : TOUR_STEPS.length)
  }, [tourStep, setTourStep])

  const handleDismiss = useCallback(() => {
    finishTour()
  }, [finishTour])

  // ── Feature hints dialog (final step) ──
  if (showFeatureHints) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div ref={featureHintsRef} tabIndex={-1} className="bg-surface-0 rounded-xl shadow-2xl w-full max-w-md animate-fade-in overflow-hidden">
            <div className="bg-brand px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-5 text-ink-inverse" />
                <div>
                  <h3 className="text-base font-semibold text-ink-inverse">You're all set</h3>
                  <p className="text-xs text-ink-inverse/75 mt-0.5">A few more features worth knowing</p>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-1">
              {FEATURE_HINTS.map((feat) => (
                <div key={feat.label} className="flex items-start gap-3 rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-center size-8 rounded-md bg-surface-1 text-ink-muted shrink-0 mt-0.5">
                    <feat.icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{feat.label}</div>
                    <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">{feat.hint}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 pb-5 pt-2 flex justify-end">
              <Button onClick={handleDismiss} size="sm">
                Got it
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── Tour not active ──
  if (!step) return null

  const p = SPOTLIGHT_PADDING
  const clipPath = targetRect
    ? `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        ${targetRect.left - p}px ${targetRect.top - p}px,
        ${targetRect.left - p}px ${targetRect.top + targetRect.height + p}px,
        ${targetRect.left + targetRect.width + p}px ${targetRect.top + targetRect.height + p}px,
        ${targetRect.left + targetRect.width + p}px ${targetRect.top - p}px,
        ${targetRect.left - p}px ${targetRect.top - p}px
      )`
    : undefined

  const cardStyle = targetRect
    ? getCardStyle(targetRect, step.placement, cardSize.w, cardSize.h)
    : { position: 'fixed' as const, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 320 }

  const StepIcon = step.icon

  return (
    <>
      {/* Dark overlay with spotlight cutout — pointer-events: none so
          clicks pass through to the actual UI elements underneath */}
      <div
        className={`fixed inset-0 z-[45] pointer-events-none ${reducedMotion ? '' : 'transition-[clip-path] duration-300 ease-out'}`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)', clipPath }}
      />

      {/* Spotlight ring around target */}
      {targetRect && (
        <div
          className={`fixed z-[45] rounded-lg pointer-events-none ring-2 ring-brand/60 ${reducedMotion ? '' : 'transition-all duration-300 ease-out'}`}
          style={{
            top: targetRect.top - p,
            left: targetRect.left - p,
            width: targetRect.width + p * 2,
            height: targetRect.height + p * 2,
          }}
        />
      )}

      {/* Tour card */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className="fixed z-[46] bg-surface-0 rounded-xl shadow-2xl border border-border animate-fade-in"
        style={cardStyle}
      >
        <div className="p-4">
          {/* Step progress dots */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === tourStep
                      ? 'w-5 bg-brand'
                      : i < (tourStep ?? 0)
                        ? 'w-1.5 bg-brand/40'
                        : 'w-1.5 bg-border'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 text-ink-faint hover:text-ink transition-colors cursor-pointer rounded"
              aria-label="Skip tour"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-8 rounded-lg bg-brand/8 text-brand shrink-0 mt-0.5">
              <StepIcon className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-ink">{step.title}</h4>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                {step.description}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xxs text-ink-faint">
              {tourStep! + 1} of {TOUR_STEPS.length}
            </span>
            {!step.interactive ? (
              <Button onClick={handleNext} size="xs" variant="secondary">
                {tourStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
                <ArrowRight className="size-3" />
              </Button>
            ) : (
              <button
                onClick={handleNext}
                className="text-xxs text-ink-faint hover:text-ink-muted transition-colors cursor-pointer"
              >
                Skip step
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
