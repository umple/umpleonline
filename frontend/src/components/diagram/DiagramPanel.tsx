/**
 * The right-hand pane.
 * Switches among the editable class diagram, SVG, compiler HTML, generated code, and the object explorer.
 */

import { type ReactNode, useCallback, useEffect } from 'react'
import { AlertTriangle, BookOpen, Download } from 'lucide-react'
import { toSvg, toPng } from 'html-to-image'
import JSZip from 'jszip'
import { UmpleDiagram } from './UmpleDiagram'
import { SmartSvgView } from './SmartSvgView'
import { HtmlDiagramView } from './HtmlDiagramView'
import { CanvasToolbar } from './CanvasToolbar'
import { GeneratedOutputView } from '../generation/GeneratedOutputView'
import { ObjectExplorer } from '../crud/ObjectExplorer'
import { CanvasBanner } from '../layout/CanvasBanner'
import { useSessionStore, VIEW_OUTPUT_KIND } from '../../stores/sessionStore'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
import { cn } from '@/lib/utils'
import { api } from '@/api/client'
import { getCompileSourceSnapshot } from '@/lib/compileSource'
import { useEffectiveDynamicGeneration } from '@/lib/effectiveDynamicGeneration'

function triggerDownload(href: string, filename: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
}

export function DiagramPanel() {
  const viewMode = useSessionStore((s) => s.viewMode)
  const svgCache = useSessionStore((s) => s.svgCache)
  const htmlCache = useSessionStore((s) => s.htmlCache)
  const umpleModel = useSessionStore((s) => s.umpleModel)
  const classLayout = useSessionStore((s) => s.classLayout)
  const storedLayout = useSessionStore((s) => s.storedLayout)
  const modelId = useSessionStore((s) => s.modelId)
  const generateTargetId = useSessionStore((s) => s.generateTargetId)
  const tabsVersion = useSessionStore((s) => s.tabsVersion)
  const dynamicGeneration = useEffectiveDynamicGeneration()
  const renderMode = useEphemeralStore((s) => s.renderMode)
  const generatingOutput = useEphemeralStore((s) => s.generatingOutput)
  const setRenderMode = useEphemeralStore((s) => s.setRenderMode)
  const rightPanelView = useEphemeralStore((s) => s.rightPanelView)
  const generatedCode = useEphemeralStore((s) => s.generatedCode)
  const generatedHtml = useEphemeralStore((s) => s.generatedHtml)
  const generatedKind = useEphemeralStore((s) => s.generatedKind)
  const generatedIframeUrl = useEphemeralStore((s) => s.generatedIframeUrl)
  const generatedDownloads = useEphemeralStore((s) => s.generatedDownloads)
  const generatedFiles = useEphemeralStore((s) => s.generatedFiles)
  const generatedTargetId = useEphemeralStore((s) => s.generatedTargetId)
  const generatedLanguage = useEphemeralStore((s) => s.generatedLanguage)
  const generatedSourceSignature = useEphemeralStore((s) => s.generatedSourceSignature)
  const diagramSourceSignature = useEphemeralStore((s) => s.diagramSourceSignature)
  const diagramTargetId = useEphemeralStore((s) => s.diagramTargetId)
  const generatingCode = useEphemeralStore((s) => s.generatingCode)
  const generatedError = useEphemeralStore((s) => s.generatedError)
  const generationRequested = useEphemeralStore((s) => s.generationRequested)
  const generationSuspendedByError = useEphemeralStore((s) => s.generationSuspendedByError)
  const generationErrorSourceSignature = useEphemeralStore((s) => s.generationErrorSourceSignature)
  const openExamplesPalette = useEphemeralStore((s) => s.openExamplesPalette)
  const currentSource = getCompileSourceSnapshot()
  void tabsVersion


  const currentSvg = svgCache[viewMode] ?? ''
  const currentHtml = htmlCache[viewMode] ?? ''
  const outputKind = VIEW_OUTPUT_KIND[viewMode]
  const hasEditableModel = !!umpleModel?.umpleClasses?.length
  const canToggleRenderer = viewMode === 'class' && hasEditableModel
  const showEditable = canToggleRenderer && renderMode === 'editable'
  const editableLoading = viewMode === 'class' && generatingOutput && !hasEditableModel && !currentSvg
  // Default: all views start in graphviz mode
  useEffect(() => {
    setRenderMode('graphviz')
  }, [viewMode, setRenderMode])
  const showHtml = !showEditable && !editableLoading && outputKind === 'html' && !!currentHtml
  const showGv = !showEditable && !editableLoading && !showHtml && !!currentSvg
  const hasDiagram = showEditable || showHtml || showGv
  const showDiagramToolbar = rightPanelView === 'diagram' && hasDiagram
  const mountEditable = canToggleRenderer
  const mountHtml = outputKind === 'html' && !!currentHtml
  const mountGv = outputKind === 'gv' && !!currentSvg
  const hasVisibleDiagramOutput = Boolean(hasDiagram || viewMode === 'crud')
  const showEmptyCanvasState = viewMode === 'class' && !generatingOutput && !hasEditableModel && !currentSvg
  const generationErrorMatchesCurrentInput = Boolean(
    generationSuspendedByError &&
    generationErrorSourceSignature === currentSource.signature,
  )
  const staleOutputDescription = generationErrorMatchesCurrentInput
    ? 'Fix the error in the code.'
    : 'Use Regenerate above to refresh it.'
  const diagramOutputStale = Boolean(
    rightPanelView === 'diagram' &&
    hasVisibleDiagramOutput &&
    !generatingOutput &&
    (!dynamicGeneration || generationErrorMatchesCurrentInput) &&
    diagramSourceSignature &&
    (
      diagramSourceSignature !== currentSource.signature ||
      diagramTargetId !== generateTargetId
    ),
  )
  const hasGeneratedOutput = Boolean(generatedCode || generatedHtml || generatedIframeUrl)
  const generatedOutputStale = Boolean(
    generationRequested &&
    hasGeneratedOutput &&
    !generatingCode &&
    (!dynamicGeneration || generationErrorMatchesCurrentInput) &&
    generatedSourceSignature &&
    (
      generatedSourceSignature !== currentSource.signature ||
      generatedTargetId !== generateTargetId
    ),
  )

  const handleExport = useCallback(async (format: string) => {
    const latestSource = getCompileSourceSnapshot()

    // Umple source code — zip all tabs client-side
    if (format === 'ump') {
      const zip = new JSZip()
      for (const tab of latestSource.tabs) {
        zip.file(tab.name, tab.code)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      triggerDownload(url, 'umple-model.zip')
      URL.revokeObjectURL(url)
      return
    }

    // Diagram image exports (SVG, PNG)
    const filename = `umple-${viewMode}-diagram.${format}`

    // When showing ReactFlow, capture the canvas client-side
    if (!showGv) {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
      if (viewport) {
        const convert = format === 'png' ? toPng : toSvg
        const dataUrl = await convert(viewport, {
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-surface-0').trim() || '#ffffff',
        })
        triggerDownload(dataUrl, filename)
        return
      }
    }

    // GV mode or fallback: use backend export
    const activeTabId = useSessionStore.getState().activeTabId
    const blob = await api.export({
      code: latestSource.activeCode,
      format,
      modelId: modelId ?? undefined,
      activeTabId,
    })
    const url = URL.createObjectURL(blob)
    triggerDownload(url, filename)
    URL.revokeObjectURL(url)
  }, [modelId, viewMode, showGv])

  return (
    <div className="h-full flex flex-col" data-testid="diagram-panel">
      <CanvasBanner
        operationsContent={
          showDiagramToolbar ? (
            <CanvasToolbar
              hasDiagram={hasDiagram}
              onExport={handleExport}
              canToggleRenderer={canToggleRenderer}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
              showDisplayOptions={!showHtml}
              variant="banner"
            />
          ) : null
        }
      />
      <div className="flex-1 relative" data-testid="diagram-canvas">
        <div className={cn('absolute inset-0', rightPanelView !== 'diagram' && 'invisible')}>
          <div
            className={cn(
              'relative h-full transition-[filter,opacity] duration-200',
              diagramOutputStale && 'pointer-events-none opacity-60 grayscale',
            )}
          >
            {mountEditable && (
              <DiagramLayer active={showEditable}>
                <UmpleDiagram model={umpleModel!} layout={classLayout ?? undefined} storedLayout={storedLayout ?? undefined} editable={showEditable} />
              </DiagramLayer>
            )}
            {mountHtml && (
              <DiagramLayer active={showHtml}>
                <HtmlDiagramView html={currentHtml} viewMode={viewMode} />
              </DiagramLayer>
            )}
            {mountGv && (
              <DiagramLayer active={showGv}>
                <SmartSvgView svg={currentSvg} viewMode={viewMode} />
              </DiagramLayer>
            )}
            {editableLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-ink-faint text-sm">
                <div className="flex flex-col gap-2.5 w-3/4 max-w-sm">
                  <div className="h-3 rounded animate-shimmer" style={{ width: '90%' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '70%', animationDelay: '0.15s' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '80%', animationDelay: '0.3s' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '55%', animationDelay: '0.45s' }} />
                </div>
                <span>Loading diagram...</span>
              </div>
            )}
            {showEmptyCanvasState && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={openExamplesPalette}
                  className="bg-surface-0/88 border-border text-ink shadow-sm backdrop-blur-sm hover:bg-surface-1 hover:border-border-strong"
                  data-testid="empty-canvas-open-examples"
                >
                  <BookOpen className="size-4" />
                  Open examples
                </Button>
              </div>
            )}
            {viewMode === 'crud' && (
              <div className="absolute inset-0 bg-surface-0 z-20">
                <ObjectExplorer />
              </div>
            )}
          </div>
          {diagramOutputStale && (
            <div
              className="absolute inset-0 z-30 bg-surface-1/20"
              data-testid="diagram-output-stale-overlay"
            >
              <Alert
                variant="warning"
                className="absolute right-3 top-3 max-w-sm bg-surface-0/92 shadow-sm backdrop-blur-sm"
              >
                <AlertTriangle />
                <AlertTitle>Diagram is out of date.</AlertTitle>
                <AlertDescription>{staleOutputDescription}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        {generationRequested && (
          <div className={cn('absolute inset-0 bg-surface-0 flex flex-col z-20', rightPanelView !== 'generated' && 'invisible')}>
            {generatedError && (
              <ErrorBanner className="py-1.5 rounded-none border-0 border-b border-border shrink-0">
                {generatedError}
              </ErrorBanner>
            )}
            {generatingCode ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-ink-faint text-sm">
                <div className="flex flex-col gap-2.5 w-3/4 max-w-sm">
                  <div className="h-3 rounded animate-shimmer" style={{ width: '90%' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '70%', animationDelay: '0.15s' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '80%', animationDelay: '0.3s' }} />
                  <div className="h-3 rounded animate-shimmer" style={{ width: '55%', animationDelay: '0.45s' }} />
                </div>
                <span>Generating {generatedLanguage}...</span>
              </div>
            ) : hasGeneratedOutput ? (
              <div className="relative flex-1 min-h-0 animate-fade-in">
                <div
                  className={cn(
                    'h-full min-h-0 transition-[filter,opacity] duration-200',
                    generatedOutputStale && 'pointer-events-none opacity-60 grayscale',
                  )}
                >
                  <GeneratedOutputView
                    kind={generatedKind}
                    code={generatedCode}
                    html={generatedHtml}
                    iframeUrl={generatedIframeUrl}
                    language={generatedLanguage}
                    downloads={generatedDownloads}
                    files={generatedFiles}
                  />
                </div>
                {generatedOutputStale && (
                  <div
                    className="absolute inset-0 z-10 bg-surface-1/20"
                    data-testid="generated-output-stale-overlay"
                  >
                    <div className="absolute right-3 top-3 rounded-md border border-border bg-surface-0/92 px-3 py-1.5 text-xs text-ink-muted shadow-sm backdrop-blur-sm">
                      Output is out of date. {staleOutputDescription}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-faint text-sm">
                No output returned — try a different model or language
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DiagramLayer({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!active}
      className={cn('absolute inset-0', active ? 'visible' : 'invisible pointer-events-none')}
    >
      {children}
    </div>
  )
}
