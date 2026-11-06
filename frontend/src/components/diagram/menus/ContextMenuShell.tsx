/**
 * Shared shell for the diagram context menus.
 * Positions the menu at the click and closes it. The class, edge, and canvas menus render their items inside it.
 */

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

interface ContextMenuShellProps {
  menuRef: RefObject<HTMLDivElement | null>
  position: { x: number; y: number }
  ariaLabel: string
  minWidth?: string
  children: ReactNode
}

/**
 * Shared wrapper for diagram context menus.
 * Applies consistent styling and clamps position to the viewport.
 */
export function ContextMenuShell({
  menuRef,
  position,
  ariaLabel,
  minWidth = '10rem',
  children,
}: ContextMenuShellProps) {
  const posRef = useRef(position)
  posRef.current = position

  // Clamp to viewport after first paint so the menu never renders offscreen
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8

    let { x, y } = posRef.current
    if (x + rect.width > vw - margin) x = vw - rect.width - margin
    if (y + rect.height > vh - margin) y = vh - rect.height - margin
    if (x < margin) x = margin
    if (y < margin) y = margin

    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-md border border-surface-2 bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y, minWidth }}
      role="menu"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}
