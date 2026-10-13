/**
 * Select and add-class tools for the editable class diagram.
 * UmpleDiagram shows these while the canvas can create classes.
 */

import { useState, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Plus } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { useSessionStore } from '@/stores/sessionStore'
import { useDiagramSync } from '@/hooks/useDiagramSync'
import { generateClassName } from '@/lib/diagramHelpers'
import type { ClassNodeData } from './nodes/ClassNode'

type DiagramMode = 'select' | 'addClass'

export function DiagramControls({ allowClassEditing = false }: { allowClassEditing?: boolean }) {
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow()
  const [mode, setMode] = useState<DiagramMode>('select')
  const { sync } = useDiagramSync()

  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'addClass') return
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const { getDiagramData, addNode } = useSessionStore.getState()
      const nodes = getDiagramData('class').nodes

      const className = generateClassName(nodes)

      addNode({
        id: `class-${className}`,
        type: 'classNode',
        position: flowPos,
        data: {
          name: className,
          attributes: [],
          methods: [],
          isAbstract: false,
          isInterface: false,
        } satisfies ClassNodeData,
      })

      sync('addClass', {
        className,
        x: String(Math.round(flowPos.x)),
        y: String(Math.round(flowPos.y)),
      })

      setMode('select')
    },
    [mode, screenToFlowPosition, sync]
  )

  return (
    <>
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-0.5 bg-surface-0 border border-border rounded-lg shadow-sm p-0.5">
        {allowClassEditing && (
          <>
            <ControlButton
              onClick={() => setMode('select')}
              label="Select mode"
              active={mode === 'select'}
            >
              <MousePointer2 className="size-3.5" />
            </ControlButton>
            <ControlButton
              onClick={() => setMode(mode === 'addClass' ? 'select' : 'addClass')}
              label="Add class (click canvas)"
              active={mode === 'addClass'}
            >
              <Plus className="size-3.5" />
            </ControlButton>
            <div className="h-px bg-border mx-0.5" />
          </>
        )}
        <ControlButton onClick={() => zoomIn()} label="Zoom in">
          <ZoomIn className="size-3.5" />
        </ControlButton>
        <ControlButton onClick={() => zoomOut()} label="Zoom out">
          <ZoomOut className="size-3.5" />
        </ControlButton>
        <div className="h-px bg-border mx-0.5" />
        <ControlButton onClick={() => fitView({ padding: 0.1 })} label="Fit to view" data-diagram-fit-view>
          <Maximize className="size-3.5" />
        </ControlButton>
      </div>

      {/* Invisible overlay to capture clicks in addClass mode */}
      {allowClassEditing && mode === 'addClass' && (
        <div
          className="absolute inset-0 z-[5] cursor-crosshair"
          onClick={handlePaneClick}
          role="button"
          aria-label="Click to place a new class"
        />
      )}
    </>
  )
}

export function ControlButton({
  onClick,
  label,
  children,
  active,
  ...rest
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
  active?: boolean
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <Tip content={label} side="right">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        {...rest}
        className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1 ${
          active
            ? 'bg-brand/10 text-brand'
            : 'text-ink-muted hover:text-ink hover:bg-surface-1'
        }`}
      >
        {children}
      </button>
    </Tip>
  )
}
