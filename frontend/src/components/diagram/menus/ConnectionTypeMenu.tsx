/**
 * Chooses association or generalization when the user draws a line between two classes.
 * UmpleDiagram opens it at the pointer, then sends the choice through useDiagramSync.
 */

import { useRef } from 'react'
import { ArrowRight, Triangle } from 'lucide-react'
import { useMenuClose } from '@/hooks/useMenuClose'
import { MenuItem } from './MenuItem'
import { ContextMenuShell } from './ContextMenuShell'

export type ConnectionChoice = 'association' | 'generalization'

interface ConnectionTypeMenuProps {
  position: { x: number; y: number } | null
  onSelect: (type: ConnectionChoice) => void
  onClose: () => void
}

export function ConnectionTypeMenu({ position, onSelect, onClose }: ConnectionTypeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuClose(menuRef, position, onClose)

  if (!position) return null

  return (
    <ContextMenuShell menuRef={menuRef} position={position} ariaLabel="Choose relationship type">
      <MenuItem onClick={() => onSelect('association')} icon={<ArrowRight className="size-3.5" />}>
        Association
      </MenuItem>
      <MenuItem onClick={() => onSelect('generalization')} icon={<Triangle className="size-3.5" />}>
        Generalization
      </MenuItem>
    </ContextMenuShell>
  )
}
