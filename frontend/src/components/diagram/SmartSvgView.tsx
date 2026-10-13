/**
 * Renders diagram SVG from the compiler.
 * State diagrams go through an adapter so a click can edit the Umple text. Other SVG views are display-only.
 */

import { memo, useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { ControlButton } from './DiagramControls'
import { ContextMenuShell } from './menus/ContextMenuShell'
import { MenuItem } from './menus/MenuItem'
import { useMenuClose } from '@/hooks/useMenuClose'
import { getYDoc } from '@/hooks/useCollab'
import { replaceYText } from '@/hooks/useCollabTabs'
import { useSessionStore } from '@/stores/sessionStore'
import { useCollabStore } from '@/stores/collabStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import type { DiagramView } from '@/constants/diagram'
import { getSvgDiagramAdapter } from './svg-adapters'
import type {
  SvgAdapterContext,
  SvgInteractionTarget,
  SvgMenuAction,
  SvgTextInputRequest,
} from './svg-adapters/types'
import { SvgTextInputDialog } from './SvgTextInputDialog'

interface SmartSvgViewProps {
  svg: string
  viewMode?: DiagramView
}

interface SmartSvgMenuState {
  position: { x: number; y: number }
  actions: SvgMenuAction[]
  ariaLabel: string
}

export function formatDiagramIdentifierForDisplay(raw: string): string {
  const formatToken = (token: string) => {
    const trimmed = token.trim().replace(/^cluster_/, '')
    const match = trimmed.match(/^(.*)_(\d+)$/)
    if (!match) return trimmed
    const [, className, instanceId] = match
    return `${className} #${instanceId}`
  }

  if (raw.includes('->')) {
    return raw.split('->').map(formatToken).join(' -> ')
  }

  if (raw.includes('--')) {
    return raw.split('--').map(formatToken).join(' -- ')
  }

  return formatToken(raw)
}

function escapeSelectorValue(raw: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(raw)
  }

  return raw.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}

/**
 * CSS theme rules injected into every Graphviz SVG.
 * Uses the app's CSS custom properties so light/dark mode works automatically.
 * Graphviz produces a predictable structure: .graph, .node, .edge, .cluster <g> groups
 * containing polygons, paths, ellipses, and text elements.
 */
const SVG_THEME_CSS = `
  .graph > polygon { fill: var(--color-surface-0); stroke: none; }
  .cluster polygon, .cluster path { fill: var(--color-surface-1); stroke: var(--color-border); }
  .cluster text { fill: var(--color-ink); }
  .node polygon, .node ellipse, .node path, .node polyline { stroke: var(--color-border-strong); fill: var(--color-surface-1); }
  .node text { fill: var(--color-ink); }
  .edge path { stroke: var(--color-ink-muted); fill: none; }
  .edge polygon { fill: var(--color-ink-muted); stroke: var(--color-ink-muted); }
  .edge text { fill: var(--color-ink-muted); }

  /* Hover highlights */
  .node, .edge, .cluster { cursor: pointer; }
  .node:hover polygon, .node:hover ellipse, .node:hover path, .node:hover polyline {
    stroke: var(--color-brand);
    transition: stroke 0.15s ease;
  }
  .cluster:hover polygon, .cluster:hover path {
    stroke: var(--color-brand);
    transition: stroke 0.15s ease;
  }
  .edge:hover path {
    stroke: var(--color-brand);
    stroke-width: 2;
    transition: stroke 0.15s ease, stroke-width 0.15s ease;
  }
  .edge:hover polygon {
    fill: var(--color-brand);
    stroke: var(--color-brand);
    transition: fill 0.15s ease, stroke 0.15s ease;
  }

  /* Selection highlights */
  [data-selected="true"] polygon, [data-selected="true"] ellipse,
  [data-selected="true"] path, [data-selected="true"] polyline {
    stroke: var(--color-brand) !important;
    stroke-width: 2;
  }
  .edge[data-selected="true"] polygon {
    fill: var(--color-brand) !important;
  }
`

/**
 * Should this inline color be stripped so CSS rules take over?
 * Strips ALL hardcoded colors — CSS custom properties in SVG_THEME_CSS are
 * the single source of truth for theming. Only `none` (intentional
 * transparency) and `url(…)` (gradient/marker refs) are preserved.
 */
function shouldStripColor(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'none' || v === 'transparent' || v.startsWith('url(') || v.startsWith('var(')) {
    return false
  }
  return true
}

/**
 * Parse, sanitize, theme, and extract dimensions from an SVG string.
 * Replaces the old per-attribute dark-mode remapping with CSS injection.
 */
function processSvg(raw: string): { html: string; dims: { width: number; height: number } | null } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(raw, 'image/svg+xml')
  const svgEl = doc.documentElement

  // Sanitize: strip scripts, event handlers, foreignObject
  doc.querySelectorAll('script').forEach((s) => s.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.value.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    }
  })
  doc.querySelectorAll('foreignObject').forEach((fo) => fo.remove())

  doc.querySelectorAll('g.node, g.edge, g.cluster').forEach((g) => {
    const link = g.querySelector('a')
    const linkTitle = link?.getAttribute('xlink:title') ?? link?.getAttribute('title')
    if (linkTitle) {
      g.setAttribute('data-link-title', linkTitle)
    }
  })

  // Strip `<a>` wrappers (Graphviz wraps nodes in links) — unwrap children, remove the <a>
  doc.querySelectorAll('a').forEach((a) => {
    while (a.firstChild) a.parentNode?.insertBefore(a.firstChild, a)
    a.remove()
  })

  // Inject theme stylesheet
  const styleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'style')
  styleEl.textContent = SVG_THEME_CSS
  svgEl.insertBefore(styleEl, svgEl.firstChild)

  // Strip ALL hardcoded fill/stroke so CSS theme rules take effect.
  // Special handling for fill="none" / stroke="none": promote to inline style
  // so it beats CSS specificity (presentation attributes lose to CSS rules,
  // inline styles don't). This is critical for Graphviz class diagram
  // box-outline polygons which use fill="none" and are drawn AFTER text —
  // making them opaque would hide labels.
  doc.querySelectorAll('.node *, .edge *, .graph > polygon, .cluster polygon, .cluster path, .cluster text').forEach((el) => {
    for (const attr of ['fill', 'stroke']) {
      const val = el.getAttribute(attr)
      if (!val) continue
      const v = val.trim().toLowerCase()
      if (v === 'none') {
        // Promote to inline style so it overrides CSS rules
        el.removeAttribute(attr)
        const existing = el.getAttribute('style') ?? ''
        el.setAttribute('style', `${existing}${existing ? ';' : ''}${attr}:none`)
      } else if (shouldStripColor(v)) {
        el.removeAttribute(attr)
      }
    }
    // Also strip font color
    const fontColor = el.getAttribute('color')
    if (fontColor && shouldStripColor(fontColor)) {
      el.removeAttribute('color')
    }
  })

  // Add data attributes to node/edge groups for interaction targeting
  doc.querySelectorAll('g.node, g.cluster').forEach((g) => {
    const title = g.querySelector('title')
    if (title?.textContent) {
      const rawId = title.textContent.trim()
      g.setAttribute('data-node-id', rawId)
      title.textContent = formatDiagramIdentifierForDisplay(rawId)
    }
  })
  doc.querySelectorAll('g.edge').forEach((g) => {
    const title = g.querySelector('title')
    if (title?.textContent) {
      const rawId = title.textContent.trim()
      g.setAttribute('data-edge-id', rawId)
      title.textContent = formatDiagramIdentifierForDisplay(rawId)
    }
  })

  const html = new XMLSerializer().serializeToString(svgEl)

  // Extract dimensions
  const parseUnit = (val: string | null): number | null => {
    if (!val) return null
    const match = val.match(/^([\d.]+)(pt|px)?$/)
    if (!match) return null
    const num = parseFloat(match[1])
    return match[2] === 'pt' ? num * 1.333 : num
  }

  const w = parseUnit(svgEl.getAttribute('width'))
  const h = parseUnit(svgEl.getAttribute('height'))
  if (w && h) return { html, dims: { width: w, height: h } }

  const vb = svgEl.getAttribute('viewBox')
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { html, dims: { width: parts[2], height: parts[3] } }
    }
  }

  return { html, dims: null }
}

const PADDING = 24
const DRAG_THRESHOLD = 3

function getInteractionTarget(target: Element): SvgInteractionTarget | null {
  const nodeGroup = target.closest('g.node, g.cluster')
  if (nodeGroup) {
    const rawId = nodeGroup.getAttribute('data-node-id')
    if (!rawId) return null
    return {
      kind: 'node',
      rawId,
      anchorTitle: nodeGroup.getAttribute('data-link-title'),
    }
  }

  const edgeGroup = target.closest('g.edge')
  if (edgeGroup) {
    const rawId = edgeGroup.getAttribute('data-edge-id')
    if (!rawId) return null
    return {
      kind: 'edge',
      rawId,
      anchorTitle: edgeGroup.getAttribute('data-link-title'),
    }
  }

  return null
}

function SmartSvgContextMenu({
  menuState,
  onClose,
}: {
  menuState: SmartSvgMenuState | null
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuClose(menuRef, menuState?.position ?? null, onClose)

  if (!menuState) return null

  return (
    <ContextMenuShell menuRef={menuRef} position={menuState.position} ariaLabel={menuState.ariaLabel}>
      {menuState.actions.map((action) => (
        <MenuItem
          key={action.id}
          onClick={() => {
            onClose()
            void action.run()
          }}
          icon={null}
          variant={action.variant}
        >
          {action.label}
        </MenuItem>
      ))}
    </ContextMenuShell>
  )
}

const SmartSvgViewInner = ({ svg, viewMode }: SmartSvgViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [transform, _setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const transformRef = useRef({ x: 0, y: 0, scale: 1 })
  const setTransform: typeof _setTransform = useCallback((action) => {
    _setTransform((prev) => {
      const next = typeof action === 'function' ? action(prev) : action
      transformRef.current = next
      return next
    })
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<SmartSvgMenuState | null>(null)
  const adapter = useMemo(() => getSvgDiagramAdapter(viewMode), [viewMode])
  const [textInputRequest, setTextInputRequest] = useState<SvgTextInputRequest | null>(null)
  const textInputResolverRef = useRef<((value: string | null) => void) | null>(null)

  // Drag state kept in refs to avoid re-renders during mouse interactions.
  // Re-renders during mousedown break React's event delegation for SVG
  // elements inside dangerouslySetInnerHTML, suppressing the click event.
  const dragRef = useRef({ pressed: false, active: false, startX: 0, startY: 0, originX: 0, originY: 0 })
  const { html: sanitizedSvg, dims: svgDims } = useMemo(() => processSvg(svg), [svg])

  const closeMenu = useCallback(() => {
    setMenuState(null)
  }, [])

  const closeTextInput = useCallback((value: string | null) => {
    textInputResolverRef.current?.(value)
    textInputResolverRef.current = null
    setTextInputRequest(null)
  }, [])

  const replaceDiagramCode = useCallback((next: string) => {
    const session = useSessionStore.getState()
    session.setCodeFromSync(next)

    if (!useCollabStore.getState().isCollaborating) return

    const doc = getYDoc()
    if (!doc) return

    replaceYText(doc.getText(`tab:${session.activeTabId}`), next)
  }, [])

  // Clear selection when SVG changes
  useEffect(() => {
    setSelectedId(null)
    setMenuState(null)
    closeTextInput(null)
  }, [closeTextInput, svg, viewMode])

  const adapterContext = useMemo<SvgAdapterContext>(() => ({
    getCode: () => useSessionStore.getState().code,
    replaceCode: replaceDiagramCode,
    requestTextInput: async (request) => {
      setTextInputRequest(request)
      return await new Promise<string | null>((resolve) => {
        textInputResolverRef.current = resolve
      })
    },
    report: (message) => {
      useEphemeralStore.getState().setExecutionOutput('', message)
    },
  }), [replaceDiagramCode])

  // Reapply data-selected when selection or SVG content changes.
  // Direct DOM mutation gets wiped when React re-renders dangerouslySetInnerHTML.
  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl) return
    contentEl.querySelectorAll('[data-selected]').forEach((el) => {
      el.removeAttribute('data-selected')
    })
    if (selectedId) {
      const escapedId = escapeSelectorValue(selectedId)
      const el = contentEl.querySelector(`[data-node-id="${escapedId}"], [data-edge-id="${escapedId}"]`)
      el?.setAttribute('data-selected', 'true')
    }
  }, [selectedId, sanitizedSvg])

  const fitToView = useCallback(() => {
    const RESET = { x: 0, y: 0, scale: 1 }
    const container = containerRef.current
    if (!container) { setTransform(RESET); return }

    const bbox = contentRef.current?.querySelector('svg')?.getBBox()
    const contentW = bbox?.width ?? svgDims?.width
    const contentH = bbox?.height ?? svgDims?.height
    if (!contentW || !contentH) { setTransform(RESET); return }

    const { width: cw, height: ch } = container.getBoundingClientRect()
    const availW = cw - PADDING * 2
    const availH = ch - PADDING * 2
    if (availW <= 0 || availH <= 0) { setTransform(RESET); return }

    const scale = Math.min(availW / contentW, availH / contentH, 1)
    setTransform({ x: (cw - contentW * scale) / 2, y: (ch - contentH * scale) / 2, scale })
  }, [svgDims])

  useLayoutEffect(() => {
    fitToView()
  }, [sanitizedSvg, fitToView])

  // Attach wheel listener as non-passive so preventDefault() works
  // (React registers onWheel as passive, which ignores preventDefault).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      setTransform((prev) => {
        const factor = 1 - e.deltaY * 0.005
        const newScale = Math.min(Math.max(prev.scale * factor, 0.1), 5)
        const ratio = newScale / prev.scale
        return { x: cursorX - ratio * (cursorX - prev.x), y: cursorY - ratio * (cursorY - prev.y), scale: newScale }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return

    const d = dragRef.current
    const t = transformRef.current
    d.pressed = true
    d.active = false
    d.originX = e.clientX
    d.originY = e.clientY
    d.startX = e.clientX - t.x
    d.startY = e.clientY - t.y
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d.pressed) return
    if (!d.active) {
      if (Math.abs(e.clientX - d.originX) < DRAG_THRESHOLD && Math.abs(e.clientY - d.originY) < DRAG_THRESHOLD) return
      d.active = true
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    }
    const x = e.clientX - d.startX
    const y = e.clientY - d.startY
    setTransform((prev) => ({ ...prev, x, y }))
  }, [])

  const handleMouseUp = useCallback(() => {
    dragRef.current.pressed = false
    dragRef.current.active = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }, [])

  const handleZoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(prev.scale * 1.2, 5) }))
  }, [])

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(prev.scale * 0.8, 0.1) }))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 30
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        setTransform((prev) => ({ ...prev, y: prev.y + step }))
        break
      case 'ArrowDown':
        e.preventDefault()
        setTransform((prev) => ({ ...prev, y: prev.y - step }))
        break
      case 'ArrowLeft':
        e.preventDefault()
        setTransform((prev) => ({ ...prev, x: prev.x + step }))
        break
      case 'ArrowRight':
        e.preventDefault()
        setTransform((prev) => ({ ...prev, x: prev.x - step }))
        break
      case '+':
      case '=':
        e.preventDefault()
        handleZoomIn()
        break
      case '-':
        e.preventDefault()
        handleZoomOut()
        break
      case '0':
        e.preventDefault()
        fitToView()
        break
      case 'Escape':
        setSelectedId(null)
        closeMenu()
        break
    }
  }, [closeMenu, handleZoomIn, handleZoomOut, fitToView])

  // Native click listener — React's onClick doesn't reliably receive events
  // from SVG elements inside dangerouslySetInnerHTML when re-renders occur.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const clickHandler = (e: MouseEvent) => {
      const interactionTarget = getInteractionTarget(e.target as Element)

      if (interactionTarget) {
        setSelectedId(interactionTarget.rawId)
        window.dispatchEvent(new CustomEvent('umple:diagram-select', {
          detail: {
            name: interactionTarget.rawId,
            kind: interactionTarget.kind,
            anchorTitle: interactionTarget.anchorTitle,
          },
        }))
      } else {
        setSelectedId(null)
      }
    }
    const menuHandler = (e: MouseEvent) => {
      if (!adapter) return
      const interactionTarget = getInteractionTarget(e.target as Element)
      if (!interactionTarget) return

      const actions = adapter.getContextMenuActions(interactionTarget, adapterContext)
      if (actions.length === 0) return

      e.preventDefault()
      setSelectedId(interactionTarget.rawId)
      setMenuState({
        position: { x: e.clientX, y: e.clientY },
        actions,
        ariaLabel: interactionTarget.kind === 'edge' ? 'State transition menu' : 'State menu',
      })
    }

    el.addEventListener('click', clickHandler)
    el.addEventListener('contextmenu', menuHandler)
    el.addEventListener('dblclick', menuHandler)
    return () => {
      el.removeEventListener('click', clickHandler)
      el.removeEventListener('contextmenu', menuHandler)
      el.removeEventListener('dblclick', menuHandler)
    }
  }, [adapter, adapterContext])

  if (!svg) {
    return (
      <div className="p-6 text-ink-faint text-sm font-mono">
        No diagram available. Compile a model to generate one.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative bg-surface-0 select-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-[-2px]"
      style={{ cursor: 'grab' }}
      tabIndex={0}
      role="application"
      aria-label="SVG diagram canvas — use arrow keys to pan, +/- to zoom, scroll to zoom"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onKeyDown={handleKeyDown}
    >
      {/* Controls */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-0.5 bg-surface-0 border border-border rounded-lg shadow-sm p-0.5">
        <ControlButton onClick={handleZoomIn} label="Zoom in">
          <ZoomIn className="size-3.5" />
        </ControlButton>
        <ControlButton onClick={handleZoomOut} label="Zoom out">
          <ZoomOut className="size-3.5" />
        </ControlButton>
        <div className="h-px bg-border mx-0.5" />
        <ControlButton onClick={fitToView} label="Fit to view" data-diagram-fit-view>
          <Maximize className="size-3.5" />
        </ControlButton>
      </div>

      {/* Selected element indicator */}
      {selectedId && (
        <div
          data-testid="smart-svg-selected-id"
          className="absolute top-3 left-3 z-10 px-2.5 py-1 bg-surface-1 border border-border rounded-md text-xs text-ink-muted font-mono truncate max-w-64"
        >
          {formatDiagramIdentifierForDisplay(selectedId)}
        </div>
      )}

      <div
        ref={contentRef}
        className="inline-block origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />

      <SmartSvgContextMenu menuState={menuState} onClose={closeMenu} />
      <SvgTextInputDialog
        request={textInputRequest}
        onCancel={() => closeTextInput(null)}
        onSubmit={(value) => closeTextInput(value)}
      />
    </div>
  )
}

export const SmartSvgView = memo(SmartSvgViewInner)
SmartSvgView.displayName = 'SmartSvgView'
