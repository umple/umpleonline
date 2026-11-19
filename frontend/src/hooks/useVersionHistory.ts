
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSessionStore } from '../stores/sessionStore'
import { saveModelSnapshot, getModelSnapshots, isSnapshotDescendant } from '../stores/versionHistoryStore'
import { urlModelResolved } from './useModelFromURL'

const BACKUP_INTERVAL_MS = 2 * 60 * 1000
const BACKUP_DEBOUNCE_MS = 5 * 1000

export function useVersionHistory() {
  useEffect(() => {
    const lastSavedCode = new Map<string, string>()
    // Track the revision this editor is currently based on.
    const baseRevision = new Map<string, string | null>()

    const getBaseRevision = (historyId: string): string | null => {
      if (!baseRevision.has(historyId)) {
      const snapshots = getModelSnapshots(historyId)

    // Only adopt a saved revision when its content matches
    // the model currently loaded in this editor.
    const state = useSessionStore.getState()
    const currentTabs = state.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      code: tab.code,
    }))

    const matching = snapshots.find(
      (snapshot) =>
        JSON.stringify(snapshot.tabs) === JSON.stringify(currentTabs) &&
        snapshot.activeTabId === state.activeTabId
    )

    baseRevision.set(historyId, matching?.id ?? null)
  }

  return baseRevision.get(historyId) ?? null
}
const handleVersionRestored = (event: Event) => {
  const { modelId, snapshotId, tabs } = (
    event as CustomEvent<{
      modelId: string
      snapshotId: string
      tabs: { id: string; name: string; code: string }[]
    }>
  ).detail

  baseRevision.set(modelId, snapshotId)
  lastSavedCode.set(modelId, JSON.stringify(tabs))
}
    const saveCurrentVersion = () => {
        // Do not back up the temporary workspace while a URL model is loading.
      if (!urlModelResolved) return
      const state = useSessionStore.getState()

      if (!state.historyId || !state.tabs.length) return

      const tabs = state.tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        code: tab.code,
      }))

      const signature = JSON.stringify(tabs)

      if (lastSavedCode.get(state.historyId) === signature) return

      const parentSnapshotId = getBaseRevision(state.historyId)

      const saved = saveModelSnapshot({
        modelId: state.historyId,
        tabs,
        activeTabId: state.activeTabId,
        reason: 'automatic',
        parentSnapshotId,
      })

      if (saved) {
        lastSavedCode.set(state.historyId, signature)
        baseRevision.set(state.historyId, saved.id)
      }
    }


    let debounceTimer: number | undefined

    // Save the current model after a short period of inactivity.
    const unsubscribe = useSessionStore.subscribe((state, previousState) => {
      // A new model history has started.
  if (state.historyId !== previousState.historyId) {
    if (!urlModelResolved) {
        return
      }
    // Cancel any pending backup for the previous model.
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer)
      debounceTimer = undefined
    }

     // Save the outgoing model before switching histories.
     // Cross-session recovery already creates a before-restore checkpoint.
    const isCrossSessionRecovery =
      state.modelId === null &&
      previousState.modelId !== null
    if (!isCrossSessionRecovery && previousState.historyId && previousState.tabs.length > 0) {
      const outgoingTabs = previousState.tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        code: tab.code,
      }))

      const latestSnapshot = getModelSnapshots(previousState.historyId)[0]

      const isAlreadyBackedUp =
        latestSnapshot &&
        JSON.stringify(latestSnapshot.tabs) === JSON.stringify(outgoingTabs) &&
        latestSnapshot.activeTabId === previousState.activeTabId

      if (!isAlreadyBackedUp) {
      saveModelSnapshot({
        modelId: previousState.historyId,
        tabs: outgoingTabs,
        activeTabId: previousState.activeTabId,
        reason: 'before-switch',
      })
    }
  }
    // Schedule a backup for the new model.
    debounceTimer = window.setTimeout(() => {
      saveCurrentVersion()
      debounceTimer = undefined
    }, BACKUP_DEBOUNCE_MS)

    return
  }

  // Ignore state changes unrelated to model content.
  if (state.tabs === previousState.tabs) return

  // Restart the debounce timer after edits.
  if (debounceTimer !== undefined) {
    window.clearTimeout(debounceTimer)
  }

  debounceTimer = window.setTimeout(() => {
    saveCurrentVersion()
    debounceTimer = undefined
  }, BACKUP_DEBOUNCE_MS)
})

    // Also check periodically for unsaved changes.
    const timer = window.setInterval(
      saveCurrentVersion,
      BACKUP_INTERVAL_MS,
    )
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'umple-version-history-v1') return
      if (!urlModelResolved) return

      const state = useSessionStore.getState()

      if (!state.historyId) return

      const snapshots = getModelSnapshots(state.historyId)
      const latest = snapshots[0]

      if (!latest) return

      const currentRevisionId = getBaseRevision(state.historyId)

      if (latest.id === currentRevisionId) return

      if (!currentRevisionId) {
        toast.warning(
          'The latest model version has unknown ancestry. Review Version History before restoring.',
          {
            id: `version-history-${state.historyId}`,
            duration: Infinity,
          },
        )
        return
      }

      const currentRevision = snapshots.find(
        (snapshot) => snapshot.id === currentRevisionId,
      )

      const latestIsDescendant = isSnapshotDescendant(
        snapshots,
        latest.id,
        currentRevisionId,
      )

      if (!latestIsDescendant) {
        const latestHasKnownParent =
          latest.parentSnapshotId != null &&
          snapshots.some(
            (snapshot) => snapshot.id === latest.parentSnapshotId,
          )

        const currentHasKnownParent =
          currentRevision?.parentSnapshotId != null &&
          snapshots.some(
            (snapshot) => snapshot.id === currentRevision.parentSnapshotId,
          )

        const hasKnownCommonParent =
          latestHasKnownParent &&
          currentHasKnownParent &&
          latest.parentSnapshotId === currentRevision?.parentSnapshotId

        toast.warning(
          hasKnownCommonParent
            ? 'Conflicting model changes detected. Review Version History before restoring.'
            : 'The latest model version has unknown ancestry. Review Version History before restoring.',
          {
            id: `version-history-${state.historyId}`,
            duration: Infinity,
          },
        )
        return
      }
      const currentTabs = state.tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        code: tab.code,
      }))

      if (
        JSON.stringify(currentTabs) === JSON.stringify(latest.tabs) &&
        state.activeTabId === latest.activeTabId
      ) {
        return
      }

      const notifiedTabs = JSON.stringify(currentTabs)
      const notifiedActiveTabId = state.activeTabId
      const notifiedRevisionId = baseRevision.get(state.historyId)

      toast.info('A newer model version is available.', {
        id: `version-history-${state.historyId}`,
        description: 'Another browser tab saved changes to this model.',
        duration: Infinity,
        action: {
          label: 'Update to latest',
          onClick: () => {
            const current = useSessionStore.getState()
            const currentTabsJson = JSON.stringify(
              current.tabs.map(({ id, name, code }) => ({
                id,
                name,
                code,
              })),
            )

            if (
              currentTabsJson !== notifiedTabs ||
              current.activeTabId !== notifiedActiveTabId ||
              baseRevision.get(current.historyId) !== notifiedRevisionId
            ) {
              toast.warning(
                'Your model changed after this notification. Review Version History before updating.',
              )
              return
            }

            // Never apply a snapshot belonging to another model.
            if (current.historyId !== latest.modelId) {
              toast.error('The active model has changed.')
              return
            }

            // Read the latest snapshot again in case another
            // browser tab has saved more changes.
            const newest = getModelSnapshots(current.historyId)[0]

            if (!newest || newest.id !== latest.id) {
              toast.info('A newer backup is available. Please review Version History.')
              return
            }

            if (
              !newest.tabs.length ||
              !newest.tabs.some((tab) => tab.id === newest.activeTabId)
            ) {
              toast.error('The saved version contains invalid tab data.')
              return
            }

            // Preserve this tab's current work before updating.
            const recovery = saveModelSnapshot({
              modelId: current.historyId,
              tabs: current.tabs.map((tab) => ({
                id: tab.id,
                name: tab.name,
                code: tab.code,
              })),
              activeTabId: current.activeTabId,
              reason: 'before-restore',
            })

            if (!recovery) {
              toast.error('Update cancelled: could not save a recovery backup.')
              return
            }

            current.restoreTabs(newest.tabs, newest.activeTabId)

            // The editor is now based on the restored revision.
            baseRevision.set(current.historyId, newest.id)

            // Prevent an unnecessary automatic backup of unchanged restored content.
            lastSavedCode.set(
              current.historyId,
              JSON.stringify(newest.tabs),
            )

            toast.success('Updated to the latest saved model version.')
          },
        },
        cancel: {
          label: 'Keep my changes',
          onClick: () => {
            toast.info('Your current model was kept unchanged.')
          },
        },
      })
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener(
      'umple-version-restored',
      handleVersionRestored,
    )
    // Capture an already-loaded model when the hook starts.
    saveCurrentVersion()

    return () => {
      unsubscribe()
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener(
        'umple-version-restored',
        handleVersionRestored,
      )
      window.clearInterval(timer)

      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer)
      }
    }
  }, [])
}
