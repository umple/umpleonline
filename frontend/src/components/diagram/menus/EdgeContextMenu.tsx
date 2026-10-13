/**
 * Context menu for an association on the class diagram.
 * Deletes that link through the sync API.
 */

import { useCallback, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useSessionStore } from '@/stores/sessionStore'
import { useDiagramSync } from '@/hooks/useDiagramSync'
import { useMenuClose } from '@/hooks/useMenuClose'
import { edgeDeletionParams } from '@/lib/diagramHelpers'
import { MenuItem } from './MenuItem'
import { ContextMenuShell } from './ContextMenuShell'

interface EdgeContextMenuProps {
  position: { x: number; y: number } | null
  edgeId: string | null
  onClose: () => void
}

export function EdgeContextMenu({ position, edgeId, onClose }: EdgeContextMenuProps) {
  const { sync } = useDiagramSync()
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuClose(menuRef, position, onClose)

  const handleDelete = useCallback(async () => {
    if (!edgeId) return
    const { getDiagramData, removeEdge } = useSessionStore.getState()
    const edges = getDiagramData('class').edges
    const edge = edges.find((e) => e.id === edgeId)
    if (!edge) { onClose(); return }

    const { action, params } = edgeDeletionParams(edge)
    removeEdge(edgeId)
    onClose()
    await sync(action, params)
  }, [edgeId, onClose, sync])

  if (!position || !edgeId) return null

  return (
    <ContextMenuShell menuRef={menuRef} position={position} ariaLabel="Edge context menu" minWidth="8rem">
      <MenuItem onClick={handleDelete} icon={<Trash2 className="size-3.5" />} variant="destructive">
        Delete
      </MenuItem>
    </ContextMenuShell>
  )
}
