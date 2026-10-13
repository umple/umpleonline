/**
 * Light and dark syntax colors for the Umple editor.
 * These are the exception to the semantic color tokens: CodeMirror highlights use their own palette.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const lightHighlight = HighlightStyle.define([
  { tag: tags.typeName, color: '#5a8a2a' },
  { tag: tags.string, color: '#c53030' },
  { tag: tags.lineComment, color: '#8F94A0' },
  { tag: tags.blockComment, color: '#B8922F' },
  { tag: tags.definitionKeyword, color: '#7c3aed' },
  { tag: tags.literal, color: '#7c3aed' },
  { tag: tags.keyword, color: '#306FBA' },
  { tag: tags.heading, color: '#4FADEA' },
  { tag: tags.heading1, color: '#EA32D4' },
  { tag: tags.integer, color: '#009909' },
  { tag: tags.bool, color: '#306FBA' },
  { tag: tags.modifier, color: '#7c3aed' },
])

const darkHighlight = HighlightStyle.define([
  { tag: tags.typeName, color: '#9FCF63' },
  { tag: tags.string, color: '#EB5F66' },
  { tag: tags.lineComment, color: '#6e7681' },
  { tag: tags.blockComment, color: '#d4a959' },
  { tag: tags.definitionKeyword, color: '#BA90E1' },
  { tag: tags.literal, color: '#BA90E1' },
  { tag: tags.keyword, color: '#6cb6ff' },
  { tag: tags.heading, color: '#4FADEA' },
  { tag: tags.heading1, color: '#EA32D4' },
  { tag: tags.integer, color: '#56d364' },
  { tag: tags.bool, color: '#6cb6ff' },
  { tag: tags.modifier, color: '#BA90E1' },
])

const lightEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#2d2d2c' },
  '.cm-gutters': { backgroundColor: '#ffffff', color: '#80746c', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1.5px #e0ddd9' },
  '.cm-cursor': { borderLeftColor: '#2d2d2c' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#f0b0bb40' },
}, { dark: false })

const darkEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#1a1a1a', color: '#e4e2df' },
  '.cm-gutters': { backgroundColor: '#1a1a1a', color: '#6e6964', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1.5px #333330' },
  '.cm-cursor': { borderLeftColor: '#e4e2df' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#d44a6030' },
}, { dark: true })

export function getEditorTheme(dark: boolean): Extension[] {
  return dark
    ? [darkEditorTheme, syntaxHighlighting(darkHighlight)]
    : [lightEditorTheme, syntaxHighlighting(lightHighlight)]
}

// Default export for backward compat
export const umpleTheme: Extension = syntaxHighlighting(lightHighlight)
