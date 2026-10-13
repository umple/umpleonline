/**
 * Context menu for empty canvas on the class diagram.
 * Adds a class at the clicked point, or fits every class into view.
 */

import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Plus, Maximize } from 'lucide-react'
import { useSessionStore } from '@/stores/sessionStore'
import { useDiagramSync } from '@/hooks/useDiagramSync'
import { useMenuClose } from '@/hooks/useMenuClose'
import { generateClassName } from '@/lib/diagramHelpers'
import { MenuItem } from './MenuItem'
import { ContextMenuShell } from './ContextMenuShell'
import type { ClassNodeData } from '../nodes/ClassNode'

interface DiagramContextMenuProps {
  position: { x: number; y: number } | null
  flowPosition: { x: number; y: number } | null
  onClose: () => void
}

export function DiagramContextMenu({ position, flowPosition, onClose }: DiagramContextMenuProps) {
  const { fitView } = useReactFlow()
  const { sync } = useDiagramSync()
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuClose(menuRef, position, onClose)

  const handleAddClass = useCallback(async () => {
    const { getDiagramData, addNode } = useSessionStore.getState()
    const nodes = getDiagramData('class').nodes
    const className = generateClassName(nodes)
    const pos = flowPosition ?? { x: 100, y: 100 }

    addNode({
      id: `class-${className}`,
      type: 'classNode',
      position: pos,
      data: {
        name: className,
        attributes: [],
        methods: [],
        isAbstract: false,
        isInterface: false,
      } satisfies ClassNodeData,
    })

    onClose()

    await sync('addClass', {
      className,
      x: String(Math.round(pos.x)),
      y: String(Math.round(pos.y)),
    })
  }, [flowPosition, onClose, sync])

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.15, duration: 200, maxZoom: 1 })
    onClose()
  }, [fitView, onClose])

  if (!position) return null

  return (
    <ContextMenuShell menuRef={menuRef} position={position} ariaLabel="Diagram context menu">
      <MenuItem onClick={handleAddClass} icon={<Plus className="size-3.5" />}>
        Add Class Here
      </MenuItem>
      <div className="-mx-1 my-1 h-px bg-border" />
      <MenuItem onClick={handleFitView} icon={<Maximize className="size-3.5" />}>
        Fit View
      </MenuItem>
    </ContextMenuShell>
  )
}
