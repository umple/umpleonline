/**
 * Read-only diff of the AI agent's proposed Umple against the current buffer.
 * Shown while a tool call's preview is active.
 */

import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { ChangeSet, Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { umple } from '../../codemirror/lang-umple'
import { getEditorTheme } from '../../codemirror/theme'
import { useIsDark } from '../../hooks/useIsDark'
import { getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge'

interface UmpleDiffEditorProps {
  originalCode: string
  proposedCode: string
}

export function UmpleDiffEditor({ originalCode, proposedCode }: UmpleDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const isDark = useIsDark()

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: proposedCode,
      extensions: [
        basicSetup,
        themeCompartment.current.of(getEditorTheme(isDark)),
        umple(),
        unifiedMergeView({
          original: originalCode,
          mergeControls: false,
          allowInlineDiffs: true,
          collapseUnchanged: { margin: 2, minSize: 4 },
        }),
        EditorState.readOnly.of(true),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: themeCompartment.current.reconfigure(getEditorTheme(isDark)),
    })
  }, [isDark])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentOriginal = getOriginalDoc(view.state).toString()
    const currentDoc = view.state.doc.toString()

    if (currentOriginal === originalCode && currentDoc === proposedCode) {
      return
    }

    const effects = []

    if (currentOriginal !== originalCode) {
      effects.push(
        originalDocChangeEffect(
          view.state,
          ChangeSet.of({ from: 0, to: currentOriginal.length, insert: originalCode }, currentOriginal.length),
        ),
      )
    }

    view.dispatch({
      changes:
        currentDoc === proposedCode
          ? undefined
          : { from: 0, to: currentDoc.length, insert: proposedCode },
      effects,
    })
  }, [originalCode, proposedCode])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      data-testid="umple-diff-editor"
    />
  )
}
