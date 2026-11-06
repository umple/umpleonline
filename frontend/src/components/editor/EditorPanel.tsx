/**
 * The left pane: tab bar, Umple editor, and the AI panel when it is open.
 * AppShell lays this next to DiagramPanel.
 */

import { useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { TabBar } from './TabBar'
import { UmpleEditor, type UmpleEditorHandle } from './UmpleEditor'
import { UmpleDiffEditor } from './UmpleDiffEditor'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'
import { useSessionStore, getActiveTabName } from '../../stores/sessionStore'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useCollabEditor } from '../../hooks/useCollabEditor'
import { useCollabTabs } from '../../hooks/useCollabTabs'
import { useLsp } from '../../hooks/useLsp'
import { attachLspToView } from '../../codemirror/lsp'
import { findDiagramRange, type DiagramSelectDetail } from './diagramSelection'
import { jumpEditorViewToLine } from './issueNavigation'

const AgentPanel = lazy(() => import('../agent/AgentPanel'))

export function EditorPanel() {
  const code = useSessionStore((s) => s.code)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const setCode = useSessionStore((s) => s.setCode)
  const collabConfig = useCollabEditor()
  useCollabTabs()
  const diffPreview = useEphemeralStore((s) => s.diffPreview)
  const pendingEditorJump = useEphemeralStore((s) => s.pendingEditorJump)
  const clearPendingEditorJump = useEphemeralStore((s) => s.clearPendingEditorJump)
  const readOnly = useEphemeralStore((s) => s.readOnly)
  const isAiConfigured = usePreferencesStore(
    (s) => {
      const activeConfig = s.configs[s.activeProvider]
      return !!(activeConfig.apiKey.trim() && activeConfig.model.trim())
    },
  )

  const editorRef = useRef<UmpleEditorHandle>(null)
  // Stable ref wrapper that useLsp can poll for the current EditorView
  const editorViewRef = useRef<EditorView | null>(null)
  // Keep editorViewRef in sync via a layout effect after each render
  useEffect(() => {
    editorViewRef.current = editorRef.current?.view ?? null
  })
  useLsp(editorViewRef)

  // When UmpleEditor mounts, attach LSP to the view.
  const handleViewReady = useCallback((view: EditorView) => {
    editorViewRef.current = view
    attachLspToView(view, getActiveTabName())
  }, [])

  // When a diagram node/edge is clicked, select the corresponding source text.
  // Uses a native DOM CustomEvent so delivery is synchronous and framework-independent.
  useEffect(() => {
    const handler = (e: Event) => {
      const { name, kind, anchorTitle } = (e as CustomEvent<DiagramSelectDetail>).detail
      const view = editorViewRef.current ?? editorRef.current?.view
      if (!view) return

      const doc = view.state.doc.toString()
      const range = findDiagramRange(doc, { name, kind, anchorTitle })
      if (!range) return

      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(range.to, range.from),
        ]),
        effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
      })
    }

    window.addEventListener('umple:diagram-select', handler)
    return () => window.removeEventListener('umple:diagram-select', handler)
  }, [])

  useEffect(() => {
    if (!pendingEditorJump || pendingEditorJump.tabId !== activeTabId) return

    const frame = window.requestAnimationFrame(() => {
      const view = editorViewRef.current ?? editorRef.current?.view
      if (!view) return

      jumpEditorViewToLine(view, pendingEditorJump.line)
      clearPendingEditorJump()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeTabId, clearPendingEditorJump, diffPreview, pendingEditorJump])

  const handleChange = useCallback((newCode: string) => {
    setCode(newCode)
  }, [setCode])

  return (
    <div className="relative flex h-full flex-col" data-testid="editor-panel">
      <TabBar />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-0">
        {diffPreview ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border bg-surface-1 px-4 py-2">
              <p className="text-xs font-medium text-ink">{diffPreview.title}</p>
              <p className="text-xxs text-ink-muted">{diffPreview.description}</p>
            </div>
            <div className="min-h-0 flex-1">
              <UmpleDiffEditor
                key={diffPreview.toolCallId}
                originalCode={diffPreview.originalCode}
                proposedCode={diffPreview.proposedCode}
              />
            </div>
          </div>
        ) : (
          <EditorContextMenu editorRef={editorRef}>
            <div className="h-full w-full">
              <UmpleEditor
                ref={editorRef}
                code={code}
                activeTabId={activeTabId}
                onChange={handleChange}
                readOnly={readOnly}
                collabConfig={collabConfig}
                onViewReady={handleViewReady}
              />
            </div>
          </EditorContextMenu>
        )}
        {isAiConfigured && (
          <>
            <SelectionToolbar />
            <Suspense>
              <AgentPanel />
            </Suspense>
          </>
        )}
      </div>
    </div>
  )
}
