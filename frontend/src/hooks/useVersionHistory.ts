
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSessionStore } from '../stores/sessionStore'
import { saveModelSnapshot, getModelSnapshots } from '../stores/versionHistoryStore'
import { urlModelResolved } from './useModelFromURL'

const BACKUP_INTERVAL_MS = 2 * 60 * 1000
const BACKUP_DEBOUNCE_MS = 5 * 1000

export function useVersionHistory() {
  useEffect(() => {
    const lastSavedCode = new Map<string, string>()

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

      const saved = saveModelSnapshot({
        modelId: state.historyId,
        tabs,
        activeTabId: state.activeTabId,
        reason: 'automatic',
      })

      if (saved) {
        lastSavedCode.set(state.historyId, signature)
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
      saveModelSnapshot({
        modelId: previousState.historyId,
        tabs: previousState.tabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          code: tab.code,
        })),
        activeTabId: previousState.activeTabId,
        reason: 'before-switch',
      })
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

      toast.info('A newer model version is available.', {
        id: `version-history-${state.historyId}`,
        description: 'Another browser tab saved changes to this model.',
        duration: Infinity,
        action: {
          label: 'Update to latest',
          onClick: () => {
            const current = useSessionStore.getState()

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
    // Capture an already-loaded model when the hook starts.
    saveCurrentVersion()

    return () => {
      unsubscribe()
      window.removeEventListener('storage', handleStorageChange)
      window.clearInterval(timer)

      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer)
      }
    }
  }, [])
}
