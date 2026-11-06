/**
 * Extensions shared by every Umple editor.
 * Basic editing, tab-to-indent, the Umple language, and the syntax theme. UmpleEditor and the diff editor both call this.
 */

import { basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { umple } from './lang-umple'
import { umpleTheme } from './theme'

export function createEditorExtensions(options?: {
  readOnly?: boolean
}): Extension[] {
  const extensions: Extension[] = [
    basicSetup,
    keymap.of([indentWithTab]),
    umpleTheme,
    umple(),
  ]

  if (options?.readOnly) {
    extensions.push(EditorState.readOnly.of(true))
  }

  return extensions
}
