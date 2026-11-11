
import { useState } from 'react'
import { History, Trash2, RotateCcw } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import {
  getModelSnapshots,
  getAllModelSnapshots,
  saveModelSnapshot,
  deleteModelSnapshot,
} from '../../stores/versionHistoryStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'

interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
}: VersionHistoryDialogProps) {
  const modelId = useSessionStore((s) => s.historyId)
  const [revision, setRevision] = useState(0)
  const [showPreviousSessions, setShowPreviousSessions] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const snapshots = showPreviousSessions
  ? getAllModelSnapshots()
  :modelId
    ? getModelSnapshots(modelId)
    : []
  const selected = snapshots.find(
        (snapshot) => snapshot.id === selectedId
      )
  const handleDelete = (id: string) => {
    if (deleteModelSnapshot(id)) {
        if (selectedId === id) setSelectedId(null)
        setRevision((value) => value + 1)
    } else {
        setError('Could not delete this snapshot.')
    }
  }


const handleRestore = () => {
    if (!selected || !modelId) return
    if (!showPreviousSessions && selected.modelId !== modelId) return
    if (
      selected.tabs.length === 0 ||
      !selected.tabs.some((tab) => tab.id === selected.activeTabId)
    ) {
      setError('The selected snapshot has invalid tab data.')
      return
    }

const state = useSessionStore.getState()

    // Preserve current work before restoring an older version.
    const backup = saveModelSnapshot({
      modelId,
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        code: tab.code,
      })),
      activeTabId: state.activeTabId,
      reason: 'before-restore',
    })

    if (!backup) {
      setError(
        'Restoration cancelled because the current model could not be backed up.'
      )
      return
    }
    if (showPreviousSessions && selected.modelId !== modelId) {
      useSessionStore.setState({
        historyId: selected.modelId,
        modelId: null,
      })
    }
    // Restore all tabs from the selected snapshot.
    state.restoreTabs(selected.tabs, selected.activeTabId)

    setSelectedId(null)
    setError(null)
    setRevision((value) => value + 1)
    onOpenChange(false)
  }

  void revision

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Version History
          </DialogTitle>
          <DialogDescription>
            Browse automatically saved versions of your Umple model.
          </DialogDescription>
        </DialogHeader>
  <button
  type="button"
  onClick={() => {
    setShowPreviousSessions((value) => !value)
    setSelectedId(null)
    setError(null)
  }}
  className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
>
  {showPreviousSessions
    ? 'Show Current Model History'
    : 'Recover Previous Session'}
</button>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {!modelId ? (
            <p className="text-sm text-ink-muted">
              This model does not yet have a model ID.
            </p>
          ) : snapshots.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No previous versions are available yet.
            </p>
          ) : (
            snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >

            <button
              type="button"
              onClick={() => {
                setSelectedId(snapshot.id)
                setError(null)
            }}
            className="min-w-0 flex-1 text-left"
            aria-label={`Preview version from ${new Date(snapshot.timestamp).toLocaleString()}`}
            >
              <p className="text-sm font-medium">
                {new Date(snapshot.timestamp).toLocaleString()}
              </p>
              <p className="text-xs text-ink-muted">
                {snapshot.tabs.length} tab(s) · {snapshot.reason}
              </p>
            </button>

                <button
                  type="button"
                  onClick={() => handleDelete(snapshot.id)}
                  aria-label="Delete snapshot"
                  className="rounded-md p-2 text-ink-muted hover:bg-surface-2"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {selected && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-semibold">
              Preview — {new Date(selected.timestamp).toLocaleString()}
            </p>

            {selected.tabs.map((tab) => (
              <div key={tab.id}>
                <p className="mb-1 text-xs font-medium">
                  {tab.name}
                </p>

                <pre className="max-h-48 overflow-auto rounded-md bg-surface-2 p-3 text-xs">
                  <code>{tab.code}</code>
                </pre>
              </div>
            ))}

            <button
              type="button"
              onClick={handleRestore}
              className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm text-white"
            >
              <RotateCcw className="size-4" />
              Restore this version
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
