/**
 * Context menu for a class node.
 * Rename, add an attribute or method, or delete the class. Edits go through the sync API.
 */

import { useCallback, useRef } from 'react'
import { Type, ListPlus, Braces, Trash2 } from 'lucide-react'
import { useSessionStore } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { useDiagramSync } from '@/hooks/useDiagramSync'
import { useMenuClose } from '@/hooks/useMenuClose'
import { extractClassName, isAssociationClass } from '@/lib/diagramHelpers'
import { MenuItem } from './MenuItem'
import { ContextMenuShell } from './ContextMenuShell'

interface NodeContextMenuProps {
  position: { x: number; y: number } | null
  nodeId: string | null
  onClose: () => void
}

export function NodeContextMenu({ position, nodeId, onClose }: NodeContextMenuProps) {
  const { sync } = useDiagramSync()
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuClose(menuRef, position, onClose)

  const className = nodeId ? extractClassName(nodeId) : ''
  const code = useSessionStore((s) => s.code)
  const isAssociationClassNode = className ? isAssociationClass(code, className) : false

  const handleRename = useCallback(() => {
    if (!nodeId) return
    useEphemeralStore.getState().setEditing(nodeId, 'name')
    onClose()
  }, [nodeId, onClose])

  const handleAddAttribute = useCallback(() => {
    if (!nodeId) return
    useEphemeralStore.getState().setEditing(nodeId, 'newAttribute')
    onClose()
  }, [nodeId, onClose])

  const handleAddMethod = useCallback(() => {
    if (!nodeId) return
    if (isAssociationClassNode) {
      const message = 'Methods cannot be added to association classes from the diagram.'
      useEphemeralStore.getState().setExecutionOutput('', message)
      onClose()
      return
    }
    useEphemeralStore.getState().setEditing(nodeId, 'newMethod')
    onClose()
  }, [isAssociationClassNode, nodeId, onClose])

  const handleDelete = useCallback(async () => {
    if (!nodeId) return
    useSessionStore.getState().removeNode(nodeId)
    onClose()
    await sync('removeClass', { className })
  }, [nodeId, className, onClose, sync])

  if (!position || !nodeId) return null

  return (
    <ContextMenuShell menuRef={menuRef} position={position} ariaLabel={`Context menu for ${className}`}>
      <MenuItem onClick={handleRename} icon={<Type className="size-3.5" />}>
        Rename
      </MenuItem>
      <MenuItem onClick={handleAddAttribute} icon={<ListPlus className="size-3.5" />}>
        Add Attribute
      </MenuItem>
      <MenuItem onClick={handleAddMethod} icon={<Braces className="size-3.5" />}>
        Add Method
      </MenuItem>
      <div className="-mx-1 my-1 h-px bg-border" />
      <MenuItem onClick={handleDelete} icon={<Trash2 className="size-3.5" />} variant="destructive">
        Delete Class
      </MenuItem>
    </ContextMenuShell>
  )
}
