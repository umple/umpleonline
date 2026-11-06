/**
 * Read-only highlighted view of one generated source file.
 * GeneratedOutputView renders a CodeOutput per file tab.
 */

import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { java } from '@codemirror/lang-java'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { getEditorTheme } from '../../codemirror/theme'
import { useIsDark } from '../../hooks/useIsDark'

interface CodeOutputProps {
  code: string
  language: string
  testId?: string
}

export function getLanguageExtension(language: string) {
  switch (language.toLowerCase()) {
    case 'java':
      return java()
    case 'python':
      return python()
    case 'sql':
      return sql()
    case 'php':
    case 'ruby':
    case 'cpp':
    case 'rtcpp':
    case 'simplecpp':
      // Use Java as a reasonable fallback for C-like / curly-brace languages
      return java()
    default:
      // No language extension for JSON, Alloy, NuSMV, USE, Ecore, etc.
      return null
  }
}

export function CodeOutput({ code, language, testId = 'code-output' }: CodeOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isDark = useIsDark()

  useEffect(() => {
    if (!containerRef.current) return

    const langExt = getLanguageExtension(language)
    const extensions = [
      basicSetup,
      EditorState.readOnly.of(true),
      ...getEditorTheme(isDark),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ]
    if (langExt) extensions.push(langExt)

    const state = EditorState.create({
      doc: code,
      extensions,
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
  }, [code, language, isDark])

  return (
    <div className="h-full relative" data-testid={testId}>
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
      />
    </div>
  )
}
