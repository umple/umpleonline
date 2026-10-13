/**
 * Header of the right-hand pane.
 * Shows which output is open, hosts that output's controls, and toggles a layout that hides the editor.
 */

import { type ReactNode, useEffect } from 'react'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import { useSessionStore } from '../../stores/sessionStore'
import { getGenerateTarget, getGenerateTargetIdForView } from '../../generation/targets'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface CanvasBannerProps {
  operationsContent?: ReactNode
}

export function CanvasBanner({ operationsContent }: CanvasBannerProps) {
  const diagramOnly = useEphemeralStore((s) => s.diagramOnly)
  const setDiagramOnly = useEphemeralStore((s) => s.setDiagramOnly)
  const rightPanelView = useEphemeralStore((s) => s.rightPanelView)
  const generateTargetId = useSessionStore((s) => s.generateTargetId)
  const viewMode = useSessionStore((s) => s.viewMode)
  const generatedTargetId = useEphemeralStore((s) => s.generatedTargetId)
  const diagramTargetId = useEphemeralStore((s) => s.diagramTargetId)
  const currentOutputTargetId = rightPanelView === 'generated'
    ? generatedTargetId
    : diagramTargetId ?? getGenerateTargetIdForView(viewMode) ?? generateTargetId
  const currentOutputLabel = getGenerateTarget(currentOutputTargetId)?.label ?? 'Output'
  const fullscreenLabel = rightPanelView === 'generated' ? 'Output only' : 'Diagram only'
  const fullscreenAriaLabel = diagramOnly ? 'Show editor' : fullscreenLabel

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "'") {
        e.preventDefault()
        e.stopPropagation()
        useEphemeralStore.getState().toggleOutputPanel()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 min-h-[var(--toolbar-h)] px-3 py-1.5 shrink-0 border-b border-border"
      data-testid="canvas-banner"
    >
      <div
        className="flex min-w-0 items-center justify-start overflow-hidden"
        data-testid="canvas-banner-leading"
      >
        <Label className="min-w-0 truncate text-sm font-medium text-ink-muted">
          {currentOutputLabel}
        </Label>
      </div>

      <div className="flex min-w-0 items-center justify-center" data-testid="canvas-banner-operations">
        {operationsContent ? (
          <div className="flex min-w-0 items-center justify-center gap-2" data-testid="canvas-banner-operations-content">
            <Separator orientation="vertical" className="hidden h-5 md:block" />
            <div className="flex min-w-0 items-center justify-center">
              {operationsContent}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
        <Tip content={diagramOnly ? 'Show editor' : fullscreenLabel} side="bottom">
          <button
            onClick={() => setDiagramOnly(!diagramOnly)}
            className={cn(
              'p-1.5 transition-colors cursor-pointer rounded-md',
              diagramOnly ? 'text-brand bg-brand-light' : 'text-ink-muted hover:text-ink hover:bg-surface-1'
            )}
            aria-label={fullscreenAriaLabel}
          >
            {diagramOnly ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </Tip>
      </div>
    </div>
  )
}
