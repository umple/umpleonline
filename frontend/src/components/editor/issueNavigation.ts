/**
 * Jumps the editor to the line named in a compiler message, switching tabs when the message names a file.
 * The message pane calls this when a line number or error link is clicked.
 */

import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { ensureUmpExt } from '@/lib/umpFile'
import type { Tab } from '@/stores/sessionStore'

export interface EditorIssueJump {
  tabId: string
  line: number
}

function issueFilenameCandidates(filename: string): string[] {
  const trimmed = filename.trim()
  if (!trimmed) return []

  const normalized = trimmed.replace(/\\/g, '/')
  const basename = normalized.split('/').filter(Boolean).pop() ?? normalized
  const candidates = new Set<string>([trimmed, normalized, basename])

  if (basename && !basename.includes('.')) {
    candidates.add(ensureUmpExt(basename))
  }

  if (normalized && !normalized.includes('.')) {
    candidates.add(ensureUmpExt(normalized))
  }

  return [...candidates]
}

export function resolveIssueTab(tabs: Tab[], activeTabId: string, filename?: string | null): Tab | null {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null
  if (!filename) return activeTab

  const candidates = new Set(issueFilenameCandidates(filename))
  return tabs.find((tab) => candidates.has(tab.name)) ?? activeTab
}

export function jumpEditorViewToLine(view: EditorView, lineNumber: number) {
  const targetLine = Math.min(Math.max(Math.trunc(lineNumber) || 1, 1), view.state.doc.lines)
  const line = view.state.doc.line(targetLine)

  view.focus()
  view.dispatch({
    selection: EditorSelection.cursor(line.from),
    effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
  })
}
