import { useEffect, useRef } from 'react'
import { StatusFooter } from './StatusFooter'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { AppToolbar } from './AppToolbar'
import { AppSidebar } from './Sidebar'
import { EditorPanel } from '../editor/EditorPanel'
import { OutputPanel, CompileStatusStrip } from '../editor/ExecutionPanel'
import { DiagramPanel } from '../diagram/DiagramPanel'
import { CommandPalette } from '../command/CommandPalette'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import { usePreferencesStore } from '../../stores/preferencesStore'
import { useCompiler } from '../../hooks/useCompiler'
import { useModelFromURL } from '../../hooks/useModelFromURL'
import { useCollab } from '../../hooks/useCollab'
import { useTaskRoute } from '../../hooks/useTaskRoute'
import { WelcomeDialog } from '@/components/onboarding/WelcomeDialog'
import { OnboardingTour } from '@/components/onboarding/OnboardingTour'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { TaskSheet } from '@/components/task/TaskSheet'
import { api } from '@/api/client'

const SIDEBAR_TOGGLE_GUARD_MS = 350
const SESSION_COUNTER_KEY = 'umpleonline-session-counted-v1'

export function AppShell() {
  const showEditor = useEphemeralStore((s) => s.showEditor)
  const diagramOnly = useEphemeralStore((s) => s.diagramOnly)
  const outputView = useEphemeralStore((s) => s.outputView)
  useCompiler()
  useModelFromURL()
  useCollab()
  useTaskRoute()
  const visitRecorded = useRef(false)

  useEffect(() => {
    if (visitRecorded.current) return
    visitRecorded.current = true
    void api.recordVisit().catch(() => {})
  }, [])

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_COUNTER_KEY)) return
    sessionStorage.setItem(SESSION_COUNTER_KEY, '1')
    void api.recordSessionStarted().catch(() => {
      sessionStorage.removeItem(SESSION_COUNTER_KEY)
    })
  }, [])

  useEffect(() => {
    let lastSidebarToggleAt = 0

    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') {
        return
      }

      const now = Date.now()
      if (now - lastSidebarToggleAt < SIDEBAR_TOGGLE_GUARD_MS) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      lastSidebarToggleAt = now
      e.preventDefault()
      e.stopPropagation()
      usePreferencesStore.getState().toggleSidebar()
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  const editorVisible = showEditor && !diagramOnly

  return (
    <div className="flex h-screen w-full bg-surface-1">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-ink-inverse focus:text-sm focus:font-medium">
        Skip to editor
      </a>

      <AppSidebar />

      <main id="main-content" className="flex-1 min-w-0 flex flex-col" data-testid="app-shell">
        <AppToolbar />
        <div className="relative flex-1 min-h-0 px-2.5 pb-2.5">
          <ErrorBoundary>
          <PanelGroup direction="horizontal" className="h-full" id="main-horizontal">
            {editorVisible && (
              <>
                <Panel id="editor-col" order={1} defaultSize={50} minSize={20}>
                  <PanelGroup direction="vertical" className="h-full" id="editor-vertical">
                    <Panel id="editor" order={1} defaultSize={outputView === 'panel' ? 65 : 100} minSize={20}>
                      <div className="h-full rounded-xl overflow-hidden bg-surface-0 flex flex-col">
                        <div className="flex-1 min-h-0">
                          <EditorPanel />
                        </div>
                        <CompileStatusStrip />
                      </div>
                    </Panel>
                    {outputView === 'panel' && (
                      <>
                        <PanelResizeHandle className="h-2.5 cursor-row-resize" />
                        <Panel id="output" order={2} defaultSize={35} minSize={10}>
                          <div className="h-full rounded-xl overflow-hidden bg-surface-0">
                            <OutputPanel />
                          </div>
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </Panel>
                <PanelResizeHandle className="w-2.5 cursor-col-resize" />
              </>
            )}
            <Panel id="diagram" order={2} defaultSize={editorVisible ? 50 : 100} minSize={30}>
              <div className="h-full rounded-xl overflow-hidden bg-surface-0">
                <DiagramPanel />
              </div>
            </Panel>
          </PanelGroup>
          </ErrorBoundary>
        </div>

        <StatusFooter />
        <CommandPalette />
        <WelcomeDialog />
        <OnboardingTour />
      </main>
      <TaskSheet />
    </div>
  )
}
