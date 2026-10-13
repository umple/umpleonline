/**
 * Animated Umple U shown while the AI agent is streaming a reply.
 * AgentPanel renders it beside the spinner verb. It draws a particle trail around the logo curve.
 */

import { useRef, useEffect } from 'react'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Animation config (particle trail algorithm from math-curve-loaders)
const PARTICLE_COUNT = 64
const TRAIL_SPAN = 0.38
const DURATION_MS = 4600
const PULSE_MS = 4200
const STROKE_WIDTH = 5.5
const PATH_STEPS = 480

// Color zones — the curve goes top → right → bottom → left → top.
// Right pillar is gray (matching logo), everything else garnet.
const GRAY_FROM = 0.05
const GRAY_TO = 0.40

/**
 * Umple "U" curve — smooth parametric loop.
 *
 * x uses sin(t) + 3rd harmonic to square up the sides into pillar-like verticals.
 * y uses (1 − cos t)/2 for a smooth parabolic U dip.
 * detailScale pulses over time, breathing the width and depth.
 */
function curvePoint(progress: number, detailScale: number) {
  const t = progress * Math.PI * 2
  const s = detailScale

  const w = 24 + s * 4
  const h = 54 + s * 6

  const x = 50 + w * (Math.sin(t) + 0.15 * Math.sin(3 * t))
  const y = 15 + ((1 - Math.cos(t)) / 2) * h

  return { x, y }
}

function wrap(p: number) {
  return ((p % 1) + 1) % 1
}

interface UmpleSpinnerProps {
  /** Pixel size (width & height). Default 48. */
  size?: number
  className?: string
}

export function UmpleSpinner({ size = 48, className }: UmpleSpinnerProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const svg = svgRef.current
    if (!svg) return

    const garnetGhost = svg.querySelector('[data-ghost="garnet"]') as SVGPathElement
    const grayGhost = svg.querySelector('[data-ghost="gray"]') as SVGPathElement
    const group = svg.querySelector('[data-particles]') as SVGGElement

    const particles: SVGCircleElement[] = Array.from(
      { length: PARTICLE_COUNT },
      () => {
        const c = document.createElementNS(SVG_NS, 'circle')
        group.appendChild(c)
        return c
      },
    )

    const t0 = performance.now()
    const phase = Math.random()

    function detailScale(time: number) {
      const p = ((time + phase * PULSE_MS) % PULSE_MS) / PULSE_MS
      return 0.52 + ((Math.sin(p * Math.PI * 2 + 0.55) + 1) / 2) * 0.48
    }

    function buildSegment(ds: number, from: number, to: number) {
      const iFrom = Math.round(PATH_STEPS * from)
      const iTo = Math.round(PATH_STEPS * to)
      const parts: string[] = []
      for (let i = iFrom; i <= iTo; i++) {
        const { x, y } = curvePoint(i / PATH_STEPS, ds)
        parts.push(`${i === iFrom ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
      }
      return parts.join(' ')
    }

    let frameId: number

    function tick(now: number) {
      const elapsed = now - t0
      const progress =
        ((elapsed + phase * DURATION_MS) % DURATION_MS) / DURATION_MS
      const ds = detailScale(elapsed)

      // Two-tone ghost path: gray for right pillar, garnet for the rest
      grayGhost.setAttribute('d', buildSegment(ds, GRAY_FROM, GRAY_TO))
      garnetGhost.setAttribute('d', buildSegment(ds, GRAY_TO, 0.95))

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const tail = i / (PARTICLE_COUNT - 1)
        const pp = wrap(progress - tail * TRAIL_SPAN)
        const { x, y } = curvePoint(pp, ds)
        const fade = (1 - tail) ** 0.56

        const el = particles[i]
        el.setAttribute('cx', x.toFixed(2))
        el.setAttribute('cy', y.toFixed(2))
        el.setAttribute('r', (0.9 + fade * 2.7).toFixed(2))
        el.setAttribute('opacity', (0.04 + fade * 0.96).toFixed(3))

        // Color each particle based on its position on the curve
        el.style.fill =
          pp > GRAY_FROM && pp < GRAY_TO
            ? 'var(--color-logo-gray)'
            : 'var(--color-brand)'
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frameId)
      particles.forEach((p) => p.remove())
    }
  }, [])

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      role="img"
      aria-label="Loading"
    >
      {/* Ghost path: gray right pillar */}
      <path
        data-ghost="gray"
        style={{ stroke: 'var(--color-logo-gray)' }}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.1}
        fill="none"
      />
      {/* Ghost path: garnet left pillar + bottom */}
      <path
        data-ghost="garnet"
        style={{ stroke: 'var(--color-brand)' }}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.1}
        fill="none"
      />
      {/* Particles */}
      <g data-particles />
    </svg>
  )
}
