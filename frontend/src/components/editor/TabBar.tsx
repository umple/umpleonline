/**
 * Tabs for the Umple files in the open model.
 * Add, close, rename, and switch the active tab. Tab contents live in sessionStore.
 */

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { useSessionStore, type Tab } from '../../stores/sessionStore'
import { usePreferencesStore } from '../../stores/preferencesStore'
import { useCollabStore } from '../../stores/collabStore'
import {
  collabAddNewTab,
  collabRemoveTab,
  collabRenameTab,
  collabCloseOtherTabs,
} from '../../hooks/useCollabTabs'
import { Plus, X, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react'
import { OutputBadges } from './ExecutionPanel'
import { CollabButton } from './CollabButton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { stripUmpExt } from '@/lib/umpFile'
import { Tip } from '@/components/ui/tooltip'

function getSidebarShortcutLabel() {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
    return 'Cmd+B'
  }
  return 'Ctrl+B'
}

// ── TabBar ────────────────────────────────────────────────────────────

export function TabBar() {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const setActiveTab = useSessionStore((s) => s.setActiveTab)
  const isCollaborating = useCollabStore((s) => s.isCollaborating)

  const removeTab = useCallback(
    (id: string) => isCollaborating ? collabRemoveTab(id) : useSessionStore.getState().removeTab(id),
    [isCollaborating],
  )
  const addNewTab = useCallback(
    () => isCollaborating ? collabAddNewTab() : useSessionStore.getState().addNewTab(),
    [isCollaborating],
  )
  const renameTab = useCallback(
    (id: string, name: string) => isCollaborating ? collabRenameTab(id, name) : useSessionStore.getState().renameTab(id, name),
    [isCollaborating],
  )
  const closeOtherTabs = useCallback(
    (id: string) => isCollaborating ? collabCloseOtherTabs(id) : useSessionStore.getState().closeOtherTabs(id),
    [isCollaborating],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // ── Overflow detection via IntersectionObserver ──

  const leftSentinelRef = useRef<HTMLDivElement>(null)
  const rightSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === leftSentinelRef.current) {
            setCanScrollLeft(!entry.isIntersecting)
          }
          if (entry.target === rightSentinelRef.current) {
            setCanScrollRight(!entry.isIntersecting)
          }
        }
      },
      { root: container, threshold: 0.9 }
    )

    if (leftSentinelRef.current) observer.observe(leftSentinelRef.current)
    if (rightSentinelRef.current) observer.observe(rightSentinelRef.current)

    return () => observer.disconnect()
  }, [tabs.length])

  const scroll = useCallback((direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -150 : 150,
      behavior: 'smooth',
    })
  }, [])

  // ── Delete key (Radix handles ArrowLeft/Right, Home, End) ──

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' && tabs.length > 1) {
        e.preventDefault()
        removeTab(activeTabId)
      }
    },
    [tabs.length, activeTabId, removeTab]
  )

  const showSidebar = usePreferencesStore((s) => s.showSidebar)
  const toggleSidebar = usePreferencesStore((s) => s.toggleSidebar)
  const activeIndex = tabs.findIndex((t) => t.id === activeTabId)
  const sidebarShortcutLabel = getSidebarShortcutLabel()

  return (
    <Tabs value={activeTabId} onValueChange={setActiveTab} className="shrink-0">
      <div className="flex items-center h-[var(--toolbar-h)] shrink-0 border-b border-border">
        <Tip content={`Toggle preferences sidebar (${sidebarShortcutLabel})`} side="bottom">
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex items-center justify-center w-9 h-full transition-colors cursor-pointer shrink-0',
              showSidebar ? 'text-ink bg-surface-2' : 'text-ink-faint hover:text-ink-muted',
            )}
            aria-label="Toggle preferences sidebar"
            aria-pressed={showSidebar}
          >
            <PanelLeft className="size-3.5" />
          </button>
        </Tip>

        {/* Scroll left */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="flex items-center justify-center w-7 h-full text-ink-faint hover:text-ink-muted transition-colors shrink-0"
            aria-label="Scroll tabs left"
            tabIndex={-1}
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}

        {/* Scrollable tab strip */}
        <TabsList
          variant="line"
          ref={scrollRef}
          onKeyDown={handleKeyDown}
          className="flex h-full flex-1 min-w-0 w-auto rounded-none p-0 px-1 justify-start gap-0 bg-transparent overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={canScrollLeft || canScrollRight ? {
            maskImage: `linear-gradient(to right, ${canScrollLeft ? 'transparent, black 1.5rem' : 'black'}, ${canScrollRight ? 'black calc(100% - 1.5rem), transparent' : 'black'})`,
          } : undefined}
        >
          {/* Left sentinel for overflow detection */}
          <div ref={leftSentinelRef} className="w-px shrink-0" aria-hidden="true" />

          {tabs.map((tab, index) => (
            <EditorTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isOnly={tabs.length === 1}
              showSeparator={
                index < tabs.length - 1 &&
                index !== activeIndex &&
                index !== activeIndex - 1
              }
              onClose={() => removeTab(tab.id)}
              onRename={(name) => renameTab(tab.id, name)}
              onCloseOthers={() => closeOtherTabs(tab.id)}
            />
          ))}

          {/* New tab button (inline after last tab) */}
          <button
            onClick={addNewTab}
            className="flex items-center justify-center size-7 text-ink-faint hover:text-ink-muted transition-colors cursor-pointer shrink-0"
            aria-label="New file"
            tabIndex={-1}
          >
            <Plus className="size-3.5" />
          </button>

          {/* Right sentinel for overflow detection */}
          <div ref={rightSentinelRef} className="w-px shrink-0" aria-hidden="true" />
        </TabsList>

        {/* Scroll right */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="flex items-center justify-center w-7 h-full text-ink-faint hover:text-ink-muted transition-colors shrink-0"
            aria-label="Scroll tabs right"
            tabIndex={-1}
          >
            <ChevronRight className="size-3.5" />
          </button>
        )}

        {/* Collaboration button */}
        <CollabButton />

        {/* Error/warning badges (right-aligned) */}
        <OutputBadges />
      </div>
    </Tabs>
  )
}

// ── EditorTab ─────────────────────────────────────────────────────────

const triggerClassName = cn(
  'h-full flex-none rounded-none border-none px-3 pr-1.5 text-[13px] font-medium cursor-pointer select-none',
  'after:!bottom-0 after:!bg-brand after:!inset-x-0 after:!h-0.5',
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink',
  'data-[state=inactive]:text-ink-muted data-[state=inactive]:hover:text-ink',
)

interface EditorTabProps {
  tab: Tab
  isActive: boolean
  isOnly: boolean
  showSeparator: boolean
  onClose: () => void
  onRename: (name: string) => void
  onCloseOthers: () => void
}

function EditorTab({
  tab,
  isActive,
  isOnly,
  showSeparator,
  onClose,
  onRename,
  onCloseOthers,
}: EditorTabProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tabShellRef = useRef<HTMLDivElement>(null)
  const editingWidthRef = useRef<number | null>(null)
  const pendingRenameRef = useRef(false)
  const renameFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (renameFrameRef.current !== null) {
        window.cancelAnimationFrame(renameFrameRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const commitRename = () => {
    const nextName = editValue.trim()
    if (nextName && nextName !== tab.name) {
      onRename(nextName)
    }
    setEditing(false)
  }

  const displayName = stripUmpExt(tab.name)

  const beginRename = () => {
    const width = tabShellRef.current?.getBoundingClientRect().width ?? 0
    editingWidthRef.current = width > 0 ? Math.ceil(width) : null
    setEditValue(displayName)
    setEditing(true)
  }

  const handleRenameSelect = () => {
    pendingRenameRef.current = true
  }

  // Middle-click to close
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1 && !isOnly) {
      e.preventDefault()
      onClose()
    }
  }

  // Prevent middle-click autoscroll
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault()
  }

  // Close button: always visible on active tab, on hover for inactive.
  // When dirty: show dot instead, X replaces dot on hover.
  const showClose = !isOnly && (tab.dirty ? hovered : (isActive || hovered))
  const showDirtyDot = tab.dirty && !showClose

  return (
    <ContextMenu>
      <ContextMenuTrigger
        disabled={editing}
        className="shrink-0"
      >
        <div
          ref={tabShellRef}
          className="flex items-stretch"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {editing ? (
            <div
              className="relative flex items-center h-full px-3 pr-1.5 text-[13px]"
              style={editingWidthRef.current ? { width: `${editingWidthRef.current}px` } : undefined}
            >
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditing(false)
                }}
                aria-label={`Rename ${tab.name}`}
                className="min-w-0 w-full bg-transparent text-[13px] text-ink outline-none border-b border-brand"
              />
            </div>
          ) : (
            <TabsTrigger
              value={tab.id}
              className={triggerClassName}
              onDoubleClick={beginRename}
              onAuxClick={handleAuxClick}
              onMouseDown={handleMouseDown}
            >
              {/* Separator between inactive tabs */}
              {showSeparator && !hovered && (
                <span className="absolute right-0 top-[22%] bottom-[22%] w-px bg-border" />
              )}

              <span className="truncate max-w-[120px]">{displayName}</span>

              {/* Close / dirty indicator — fixed-width to prevent layout shift */}
              <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                {showDirtyDot ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand opacity-70" role="status" aria-label="Unsaved changes" title="Unsaved changes" />
                ) : showClose ? (
                  <button
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); onClose() }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={cn(
                      'flex items-center justify-center w-5 h-5 rounded transition-colors cursor-pointer',
                      isActive
                        ? 'text-ink-muted hover:text-ink hover:bg-surface-1'
                        : 'text-ink-faint hover:text-ink-muted hover:bg-surface-2',
                    )}
                    aria-label={`Close ${tab.name}`}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            </TabsTrigger>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (!pendingRenameRef.current) return

          event.preventDefault()
          pendingRenameRef.current = false
          if (renameFrameRef.current !== null) {
            window.cancelAnimationFrame(renameFrameRef.current)
          }
          renameFrameRef.current = window.requestAnimationFrame(() => {
            renameFrameRef.current = null
            beginRename()
          })
        }}
      >
        <ContextMenuItem onSelect={handleRenameSelect}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onClose} disabled={isOnly}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} disabled={isOnly}>Close Others</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
