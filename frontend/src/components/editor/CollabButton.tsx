import { useState, useCallback, useRef, useEffect } from 'react'
import { Users, Copy, Check, LogOut } from 'lucide-react'
import { useCollabStore } from '../../stores/collabStore'
import { useSessionStore } from '../../stores/sessionStore'
import { isTemporaryModel } from '../../lib/modelId'
import { api } from '../../api/client'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function CollabButton() {
  const isCollaborating = useCollabStore((s) => s.isCollaborating)
  const connected = useCollabStore((s) => s.connected)
  const ready = useCollabStore((s) => s.ready)
  const connectedUsers = useCollabStore((s) => s.connectedUsers)
  const startCollab = useCollabStore((s) => s.startCollab)
  const stopCollab = useCollabStore((s) => s.stopCollab)

  const [copied, setCopied] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  const copyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [])

  const handleStartCollab = useCallback(async () => {
    let modelId = useSessionStore.getState().modelId

    // Promote tmp model to permanent so the URL is shareable
    if (isTemporaryModel(modelId)) {
      try {
        const res = await api.promoteModel(modelId!)
        modelId = res.newId
        useSessionStore.getState().setModelId(res.newId)
      } catch {
        // Promotion failed — fall back to the tmp ID
      }
    }

    const roomId = modelId ?? crypto.randomUUID()

    // Update the URL immediately so copyUrl captures the permanent model ID.
    // The React useEffect in useModelFromURL would also do this, but it runs
    // after render — too late for the clipboard copy below.
    if (roomId) {
      const url = new URL(window.location.href)
      for (const key of ['example', 'text', 'filename']) url.searchParams.delete(key)
      url.searchParams.set('model', roomId)
      window.history.replaceState({}, '', url.toString())
    }

    startCollab(roomId)
    setPopoverOpen(true)
    try { await copyUrl() } catch { /* clipboard may be unavailable */ }
  }, [startCollab, copyUrl])

  const handleStopCollab = useCallback(() => {
    stopCollab()
  }, [stopCollab])

  if (!isCollaborating) {
    return (
      <Tip content="Share for collaboration" side="bottom">
        <button
          onClick={handleStartCollab}
          className="flex items-center gap-1.5 px-2.5 h-full text-ink-faint hover:text-ink-muted transition-colors cursor-pointer shrink-0"
          aria-label="Share for collaboration"
          data-testid="collab-share-btn"
        >
          <Users className="size-3.5" />
          <span className="text-xs">Share</span>
        </button>
      </Tip>
    )
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tip content="Collaboration settings" side="bottom">
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-2.5 h-full text-ink-muted hover:text-ink transition-colors cursor-pointer shrink-0"
            aria-label="Collaboration settings"
            data-testid="collab-status-btn"
          >
          {/* User dots */}
          <div className="flex -space-x-1">
            {connectedUsers.slice(0, 4).map((user) => (
              <span
                key={user.clientId}
                className="size-3 rounded-full border border-surface-0"
                style={{ backgroundColor: user.color }}
                title={user.name}
                role="img"
                aria-label={user.name}
              />
            ))}
          </div>
          <span className="text-xs">{connectedUsers.length}</span>
          {/* Connection indicator */}
          <span
            className={cn(
              'size-1.5 rounded-full',
              connected && ready ? 'bg-status-success' : 'bg-status-warning'
            )}
            role="status"
            aria-label={connected && ready ? 'Connected' : 'Connecting'}
          />
          <span className="sr-only">{connected && ready ? 'Connected' : 'Connecting'}</span>
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="space-y-3">
          <div className="text-xs font-medium text-ink">
            {connectedUsers.length} collaborator{connectedUsers.length !== 1 ? 's' : ''}
          </div>

          {/* User list */}
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {connectedUsers.map((user) => (
              <div key={user.clientId} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: user.color }}
                />
                <span className="truncate text-ink-muted">{user.name}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 pt-1.5 border-t border-border">
            <button
              onClick={copyUrl}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-1 rounded transition-colors cursor-pointer"
            >
              {copied ? <Check className="size-3 text-status-success" /> : <Copy className="size-3" />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={handleStopCollab}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-status-error hover:bg-surface-1 rounded transition-colors cursor-pointer"
            >
              <LogOut className="size-3" />
              Stop collaborating
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
