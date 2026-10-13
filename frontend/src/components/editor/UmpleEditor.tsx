/**
 * CodeMirror editor for the active Umple tab.
 * Keeps a view per tab and reports edits to sessionStore. Collaboration rebinds the same editor to the shared Yjs text.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { EditorView, ViewUpdate, scrollPastEnd } from '@codemirror/view'
import { EditorState, Compartment, Transaction } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { umple } from '../../codemirror/lang-umple'
import { getEditorTheme } from '../../codemirror/theme'
import { useIsDark } from '../../hooks/useIsDark'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import { useSessionStore } from '../../stores/sessionStore'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { CollabConfig } from '../../hooks/useCollabEditor'

export interface UmpleEditorHandle {
  view: EditorView | null
}

interface UmpleEditorProps {
  code: string
  activeTabId: string
  onChange: (code: string) => void
  readOnly?: boolean
  collabConfig?: CollabConfig | null
  onViewReady?: (view: EditorView) => void
}

/** Per-tab cached editor state with its compartment instances */
interface TabStateCache {
  state: EditorState
  theme: Compartment
  readOnly: Compartment
  collab: Compartment
}

export const UmpleEditor = forwardRef<UmpleEditorHandle, UmpleEditorProps>(function UmpleEditor({ code, activeTabId, onChange, readOnly = false, collabConfig, onViewReady }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onViewReadyRef = useRef(onViewReady)
  onViewReadyRef.current = onViewReady
  const themeCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  const collabCompartment = useRef(new Compartment())
  const isDark = useIsDark()

  // Per-tab EditorState cache (preserves undo history across tab switches)
  const stateCacheRef = useRef(new Map<string, TabStateCache>())
  const prevTabIdRef = useRef(activeTabId)
  const isTabSwitchRef = useRef(false)
  // Keep current values accessible to stable callbacks via refs
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  useImperativeHandle(ref, () => ({
    get view() { return viewRef.current },
  }), [])

  // Track whether the last change was external (from props) to avoid echo
  const isExternalUpdate = useRef(false)

  // Stable update listener — uses refs so it can be shared across EditorState instances
  const updateListenerRef = useRef(
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged && !isExternalUpdate.current) {
        onChangeRef.current(update.state.doc.toString())
      }
      isExternalUpdate.current = false

      if (update.selectionSet) {
        const { from, to } = update.state.selection.main
        if (from === to) {
          useEphemeralStore.getState().setSelection(null)
        } else {
          const fromLine = update.state.doc.lineAt(from).number
          const toLine = update.state.doc.lineAt(to).number
          const text = update.state.sliceDoc(from, to)
          const fromCoords = update.view.coordsAtPos(from)
          const toCoords = update.view.coordsAtPos(to)
          const coords = fromCoords && toCoords
            ? { x: toCoords.left, yTop: fromCoords.top, yBottom: toCoords.bottom }
            : undefined
          useEphemeralStore.getState().setSelection({ fromLine, toLine, text, coords })
        }
      }
    })
  )

  /** Create a fresh EditorState with current settings (for new tabs) */
  const createEditorState = useRef((doc: string): TabStateCache => {
    const theme = new Compartment()
    const ro = new Compartment()
    const col = new Compartment()
    const state = EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        theme.of(getEditorTheme(isDarkRef.current)),
        col.of([]),
        umple(),
        updateListenerRef.current,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
        scrollPastEnd(),
        ro.of(EditorState.readOnly.of(readOnlyRef.current)),
      ],
    })
    return { state, theme, readOnly: ro, collab: col }
  })

  useEffect(() => {
    if (!containerRef.current) return

    const cached = createEditorState.current(code)
    themeCompartment.current = cached.theme
    readOnlyCompartment.current = cached.readOnly
    collabCompartment.current = cached.collab
    stateCacheRef.current.set(activeTabId, cached)

    const view = new EditorView({
      state: cached.state,
      parent: containerRef.current,
    })

    viewRef.current = view
    onViewReadyRef.current?.(view)

    return () => {
      // Save final state before unmount
      if (viewRef.current) {
        stateCacheRef.current.set(prevTabIdRef.current, {
          state: viewRef.current.state,
          theme: themeCompartment.current,
          readOnly: readOnlyCompartment.current,
          collab: collabCompartment.current,
        })
      }
      view.destroy()
      viewRef.current = null
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle tab switches — save/restore EditorState to preserve undo history
  useEffect(() => {
    const view = viewRef.current
    if (!view || prevTabIdRef.current === activeTabId) return
    const shouldSyncFromStoreCode = !collabConfig

    // Save current state for the outgoing tab
    stateCacheRef.current.set(prevTabIdRef.current, {
      state: view.state,
      theme: themeCompartment.current,
      readOnly: readOnlyCompartment.current,
      collab: collabCompartment.current,
    })

    prevTabIdRef.current = activeTabId
    // Flag consumed by the code-sync effect (declared later in this file)
    // to skip redundant content replacement. Relies on React firing effects
    // in declaration order within the same render cycle.
    isTabSwitchRef.current = shouldSyncFromStoreCode

    // Restore cached state or create fresh for the incoming tab
    const cached = stateCacheRef.current.get(activeTabId)
    if (cached) {
      themeCompartment.current = cached.theme
      readOnlyCompartment.current = cached.readOnly
      collabCompartment.current = cached.collab
      view.setState(cached.state)
      // Sync theme/readOnly in case they changed while on another tab
      view.dispatch({
        effects: [
          themeCompartment.current.reconfigure(getEditorTheme(isDark)),
          readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
        ],
      })
    } else {
      const fresh = createEditorState.current(code)
      themeCompartment.current = fresh.theme
      readOnlyCompartment.current = fresh.readOnly
      collabCompartment.current = fresh.collab
      view.setState(fresh.state)
      stateCacheRef.current.set(activeTabId, { ...fresh, state: view.state })
    }

    // In non-collab mode, the store is authoritative. In collab mode, Y.Text is.
    const restoredDoc = view.state.doc.toString()
    if (shouldSyncFromStoreCode && restoredDoc !== code) {
      isExternalUpdate.current = true
      view.dispatch({
        changes: { from: 0, to: restoredDoc.length, insert: code },
        annotations: [Transaction.addToHistory.of(false)],
      })
    }

    // Prune cache entries for deleted tabs to prevent memory leaks
    const liveIds = new Set(useSessionStore.getState().tabs.map((t) => t.id))
    for (const key of stateCacheRef.current.keys()) {
      if (!liveIds.has(key)) stateCacheRef.current.delete(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  // Reconfigure theme when dark mode changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.current.reconfigure(getEditorTheme(isDark)),
    })
  }, [isDark])

  // Reconfigure readOnly when prop changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly])

  // Reconfigure collab extensions when collabConfig changes
  const undoManagerRef = useRef<Y.UndoManager | null>(null)

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Clean up previous UndoManager
    if (undoManagerRef.current) {
      undoManagerRef.current.destroy()
      undoManagerRef.current = null
    }

    if (collabConfig) {
      // Detach the OLD yCollab binding BEFORE replacing editor content.
      // Otherwise the old plugin observes the content swap and propagates
      // the new tab's text into the previous tab's Y.Text.
      view.dispatch({
        effects: collabCompartment.current.reconfigure([]),
      })

      // yCollab's YSyncPlugin does NOT do an initial content sync — it only
      // observes future changes. We must replace the editor content with
      // Y.Text content BEFORE installing yCollab so they start in sync.
      const ytextContent = collabConfig.ytext.toString()
      const currentDoc = view.state.doc.toString()
      if (currentDoc !== ytextContent) {
        isExternalUpdate.current = true
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: ytextContent },
          annotations: [Transaction.addToHistory.of(false)],
        })
        // Also update sessionStore.code so useCompiler sees Y.Text content.
        onChangeRef.current(ytextContent)
      }

      undoManagerRef.current = new Y.UndoManager(collabConfig.ytext)
      view.dispatch({
        effects: collabCompartment.current.reconfigure(
          yCollab(collabConfig.ytext, collabConfig.awareness, { undoManager: undoManagerRef.current })
        ),
      })
    } else {
      view.dispatch({
        effects: collabCompartment.current.reconfigure([]),
      })
    }
  }, [collabConfig])

  // Sync external code changes into the editor (non-collab only).
  // In collab mode, Y.Text is the source of truth — external code changes
  // (example loads, diagram sync) write to Y.Text at their call site, and
  // yCollab propagates them to the editor. So this effect is a no-op.
  useEffect(() => {
    if (collabConfig) return

    // Skip if the tab switch effect already handled the content swap
    if (isTabSwitchRef.current) {
      isTabSwitchRef.current = false
      return
    }

    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== code) {
      isExternalUpdate.current = true
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: code },
        annotations: [Transaction.addToHistory.of(false)],
      })
    }
  }, [code, collabConfig])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      data-testid="umple-editor"
    />
  )
})
