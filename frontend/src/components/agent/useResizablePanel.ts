/**
 * Drag handle that resizes the AI panel.
 * AgentPanel uses this so the transcript can grow without covering the whole editor.
 */

import { useRef, useCallback, useState } from 'react'

interface UseResizablePanelOptions {
  defaultHeight: number
  minHeight: number
  maxHeightVh: number
  foldThreshold: number
  onFold: () => void
  onResize?: () => void
}

export function useResizablePanel({
  defaultHeight,
  minHeight,
  maxHeightVh,
  foldThreshold,
  onFold,
  onResize,
}: UseResizablePanelOptions) {
  const [height, setHeight] = useState(defaultHeight)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)
  const foldedByDrag = useRef(false)

  /** True after a drag-to-fold gesture; consumed by shouldSuppressClick. */
  const suppressClick = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true
      foldedByDrag.current = false
      dragStartY.current = e.clientY
      dragStartH.current = panelRef.current?.offsetHeight ?? height
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      panelRef.current?.setAttribute('data-dragging', 'true')
    },
    [height],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !panelRef.current) return
      const delta = dragStartY.current - e.clientY
      const rawH = dragStartH.current + delta
      const maxH = window.innerHeight * maxHeightVh

      if (rawH < minHeight - foldThreshold) {
        dragging.current = false
        foldedByDrag.current = true
        suppressClick.current = true
        panelRef.current.removeAttribute('data-dragging')
        onFold()
        return
      }

      const newH = Math.min(maxH, Math.max(minHeight, rawH))
      panelRef.current.style.height = `${newH}px`
    },
    [maxHeightVh, minHeight, foldThreshold, onFold],
  )

  const onPointerUp = useCallback(() => {
    panelRef.current?.removeAttribute('data-dragging')
    if (foldedByDrag.current) return
    if (!dragging.current) return
    dragging.current = false
    if (panelRef.current) {
      const finalH = panelRef.current.offsetHeight
      panelRef.current.style.height = `${finalH}px`
      setHeight(finalH)
      onResize?.()
    }
  }, [onResize])

  /** Call on pointerdown-capture in collapsed state to reset the suppress flag. */
  const resetSuppressClick = useCallback(() => {
    suppressClick.current = false
  }, [])

  /** Returns true (and resets) if the click should be swallowed after a fold gesture. */
  const shouldSuppressClick = useCallback(() => {
    if (suppressClick.current) {
      suppressClick.current = false
      return true
    }
    return false
  }, [])

  return {
    height,
    setHeight,
    panelRef,
    resizeHandlers: { onPointerDown, onPointerMove, onPointerUp },
    resetSuppressClick,
    shouldSuppressClick,
  }
}
