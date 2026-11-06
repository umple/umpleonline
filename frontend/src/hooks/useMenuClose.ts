/**
 * Closes a floating menu on an outside click or Escape.
 * The diagram context menus use this while they are open.
 */

import { useEffect, type RefObject } from 'react'

/**
 * Close a floating menu when the user clicks outside it or presses Escape.
 * Only registers listeners when `position` is non-null (menu is visible).
 */
export function useMenuClose(
  menuRef: RefObject<HTMLElement | null>,
  position: { x: number; y: number } | null,
  onClose: () => void,
) {
  useEffect(() => {
    if (!position) return

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [position, onClose, menuRef])
}
