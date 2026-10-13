/**
 * Right-click menu for the Umple editor.
 * Cut, copy, paste, and the other editing commands. UmpleEditor wraps its view with this.
 */

import { type ReactNode, useCallback } from 'react'
import { type EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { jumpToDefinition, findReferences, renameSymbol } from '@codemirror/lsp-client'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import type { UmpleEditorHandle } from './UmpleEditor'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl+'
const hasClipboardWrite = typeof navigator !== 'undefined'
  && globalThis.isSecureContext
  && typeof navigator.clipboard?.writeText === 'function'
const hasClipboardRead = typeof navigator !== 'undefined'
  && globalThis.isSecureContext
  && typeof navigator.clipboard?.readText === 'function'

function supportsDocumentCommand(command: 'copy' | 'cut' | 'paste') {
  if (typeof document === 'undefined') return false
  if (typeof document.queryCommandSupported !== 'function') return true

  try {
    return document.queryCommandSupported(command)
  } catch {
    return false
  }
}

function execDocumentCommand(command: 'copy' | 'cut' | 'paste') {
  if (!supportsDocumentCommand(command)) return false

  try {
    return document.execCommand(command)
  } catch {
    return false
  }
}

interface EditorContextMenuProps {
  editorRef: React.RefObject<UmpleEditorHandle | null>
  children: ReactNode
}

export function EditorContextMenu({ editorRef, children }: EditorContextMenuProps) {
  const openCommandPalette = useEphemeralStore((s) => s.openCommandPalette)
  const canCutOrCopy = hasClipboardWrite || supportsDocumentCommand('copy')
  const canPaste = hasClipboardRead || supportsDocumentCommand('paste')

  // Move cursor to the right-clicked position so actions (Go to Definition,
  // etc.) act on the correct location.  Fires in capture phase so it runs
  // before Radix opens the menu.
  const moveCursorToPointer = useCallback((e: React.MouseEvent) => {
    const view = editorRef.current?.view
    if (!view) return
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) return
    // Preserve existing selection if right-clicking inside it
    const { from, to } = view.state.selection.main
    if (from !== to && pos >= from && pos <= to) return
    view.dispatch({ selection: { anchor: pos } })
  }, [editorRef])

  const exec = useCallback((fn: (view: EditorView) => void | Promise<void>) => {
    const view = editorRef.current?.view
    if (!view) return
    view.focus()
    void fn(view)
  }, [editorRef])

  const handleUndo = useCallback(() => exec((v) => {
    undo(v)
  }), [exec])
  const handleRedo = useCallback(() => exec((v) => {
    redo(v)
  }), [exec])

  const handleCut = useCallback(() => exec(async (view) => {
    const { from, to } = view.state.selection.main
    if (from === to) return
    if (hasClipboardWrite) {
      const text = view.state.sliceDoc(from, to)

      try {
        await navigator.clipboard.writeText(text)
        view.dispatch({ changes: { from, to, insert: '' } })
        return
      } catch {
        // Fall back to the browser's editing command on non-secure hosts.
      }
    }

    execDocumentCommand('cut')
  }), [exec])

  const handleCopy = useCallback(() => exec((view) => {
    const { from, to } = view.state.selection.main
    if (from === to) return

    if (hasClipboardWrite) {
      void navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {
        execDocumentCommand('copy')
      })
      return
    }

    execDocumentCommand('copy')
  }), [exec])

  const handlePaste = useCallback(() => exec(async (view) => {
    if (hasClipboardRead) {
      try {
        const text = await navigator.clipboard.readText()
        const { from, to } = view.state.selection.main
        view.dispatch({ changes: { from, to, insert: text } })
        return
      } catch {
        // Fall through to document.execCommand when browser policy blocks reads.
      }
    }

    execDocumentCommand('paste')
  }), [exec])

  const handleSearch = useCallback(() => exec((v) => {
    openSearchPanel(v)
  }), [exec])

  const handleGoToDefinition = useCallback(() => exec((v) => {
    jumpToDefinition(v)
  }), [exec])

  const handleFindReferences = useCallback(() => exec((v) => {
    findReferences(v)
  }), [exec])

  const handleRename = useCallback(() => exec((v) => {
    renameSymbol(v)
  }), [exec])

  const lspConnected = useEphemeralStore((s) => s.lspConnected)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div onContextMenuCapture={moveCursorToPointer} className="contents">
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={handleUndo}>
          Undo
          <ContextMenuShortcut>{mod}Z</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleRedo}>
          Redo
          <ContextMenuShortcut>{isMac ? '⇧⌘Z' : 'Ctrl+Y'}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canCutOrCopy} onSelect={handleCut}>
          Cut
          <ContextMenuShortcut>{mod}X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!canCutOrCopy} onSelect={handleCopy}>
          Copy
          <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={handlePaste}>
          Paste
          <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleSearch}>
          Search
          <ContextMenuShortcut>{mod}F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!lspConnected} onSelect={handleGoToDefinition}>
          Go to Definition
          <ContextMenuShortcut>F12</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!lspConnected} onSelect={handleFindReferences}>
          Find References
          <ContextMenuShortcut>⇧F12</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!lspConnected} onSelect={handleRename}>
          Rename Symbol
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={openCommandPalette}>
          Command Palette
          <ContextMenuShortcut>{mod}K</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
