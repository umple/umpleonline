/**
 * Compact waiting indicator for the AI panel: a cycling glyph plus a random verb.
 * It honors prefers-reduced-motion. The streaming row in AgentPanel uses UmpleSpinner instead.
 */

import { useState, useEffect, useRef } from 'react'
import { SPINNER_VERBS } from '../../constants/spinnerVerbs'
import { usePrefersReducedMotion } from '@/hooks/useReducedMotion'

// ── Glyph frames (forward + reverse for pulsing effect) ──
const GLYPH_CHARS = ['·', '✢', '*', '✶', '✻', '✽']
const GLYPH_FRAMES = [...GLYPH_CHARS, ...[...GLYPH_CHARS].reverse()]
const GLYPH_INTERVAL = 120 // ms per glyph frame

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/**
 * Claude-Code-style AI spinner: pulsing glyph + verb with a CSS shimmer.
 *
 * The glyph cycles through unicode chars (·✢*✶✻✽) at 120ms.
 * The shimmer is a pure CSS gradient animation — no per-character spans,
 * so the text never reflows or flickers.
 */
export function AiSpinner({ className }: { className?: string }) {
  const [verb] = useState(() => sample(SPINNER_VERBS))
  const message = verb + '…'
  const reducedMotion = usePrefersReducedMotion()

  // Only JS-drive the glyph; shimmer is pure CSS
  const frameRef = useRef(0)
  const [glyph, setGlyph] = useState(GLYPH_FRAMES[0])

  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => {
      frameRef.current++
      const time = frameRef.current * GLYPH_INTERVAL
      const idx = Math.floor(time / GLYPH_INTERVAL) % GLYPH_FRAMES.length
      setGlyph(GLYPH_FRAMES[idx])
    }, GLYPH_INTERVAL)
    return () => clearInterval(id)
  }, [reducedMotion])

  return (
    <span className={className} aria-label="Loading">
      {/* Pulsing glyph — fixed width so different chars don't shift text */}
      <span className="inline-block w-[1ch] text-center text-brand">{glyph}</span>
      {' '}
      {/* Message with CSS gradient shimmer */}
      <span className="ai-spinner-text">{message}</span>
    </span>
  )
}
