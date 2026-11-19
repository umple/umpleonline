
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { urlModelResolved } from '../useModelFromURL'
import { act, cleanup, render } from '@testing-library/react'

import { useSessionStore } from '../../stores/sessionStore'
import { getModelSnapshots, saveModelSnapshot } from '../../stores/versionHistoryStore'
import { useVersionHistory } from '../useVersionHistory'

// Simulate a fully loaded model.
const startupState = vi.hoisted(() => ({
    resolved: true,
  }))

  vi.mock('../useModelFromURL', () => ({
    get urlModelResolved() {
      return startupState.resolved
    },
  }))
  const toastMocks = vi.hoisted(() => ({
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }))

  vi.mock('sonner', () => ({
    toast: toastMocks,
  }))

function HistoryTestComponent() {
  useVersionHistory()
  return null
}

function createTab(code: string) {
  return {
    id: 'main',
    name: 'Model.ump',
    code,
    dirty: false,
    savedCode: code,
    undoStack: [],
    redoStack: [],
  }
}

describe('useVersionHistory integration', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.useFakeTimers()
    vi.clearAllMocks()
    startupState.resolved = true

    useSessionStore.setState({
      historyId: 'history-a',
      modelId: 'model-a',
      code: 'class ModelA {}',
      tabs: [createTab('class ModelA {}')],
      activeTabId: 'main',
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('automatically backs up changes after five seconds', () => {
    render(<HistoryTestComponent />)

    act(() => {
      useSessionStore.getState().setCode('class ModelA { value; }')
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    const snapshots = getModelSnapshots('history-a')

    expect(snapshots[0].tabs[0].code)
      .toBe('class ModelA { value; }')
  })

  it('saves the outgoing model before switching histories', () => {
    render(<HistoryTestComponent />)

    act(() => {
      useSessionStore.getState().setCode('class ModelA { changed; }')
    })

    // Switch before the pending five-second backup fires.
    act(() => {
      useSessionStore.setState({
        historyId: 'history-b',
        modelId: 'model-b',
        code: 'class ModelB {}',
        tabs: [createTab('class ModelB {}')],
        activeTabId: 'main',
      })
    })

    const historyA = getModelSnapshots('history-a')

    expect(historyA[0].reason).toBe('before-switch')
    expect(historyA[0].tabs[0].code)
      .toBe('class ModelA { changed; }')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    const historyB = getModelSnapshots('history-b')

    expect(historyB[0].tabs[0].code)
      .toBe('class ModelB {}')

    expect(
      getModelSnapshots('history-a').some((snapshot) =>
        snapshot.tabs.some((tab) => tab.code.includes('ModelB')),
      ),
    ).toBe(false)
  })
  it('does not duplicate an already backed-up model when switching', () => {
    render(<HistoryTestComponent />)

    // The initial model is backed up when the hook mounts.
    expect(getModelSnapshots('history-a')).toHaveLength(1)

    act(() => {
      useSessionStore.setState({
        historyId: 'history-b',
        modelId: 'model-b',
        code: 'class ModelB {}',
        tabs: [createTab('class ModelB {}')],
        activeTabId: 'main',
      })
    })

    const snapshots = getModelSnapshots('history-a')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].tabs[0].code).toBe('class ModelA {}')
  })
  it('does not create duplicate snapshots for unchanged code', () => {
    render(<HistoryTestComponent />)

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000)
    })

    expect(getModelSnapshots('history-a')).toHaveLength(1)
  })

  it('does not save temporary workspace content during startup', () => {
    startupState.resolved = false

    useSessionStore.setState({
      historyId: 'startup-history',
      modelId: 'startup-model',
      code: '',
      tabs: [createTab('')],
      activeTabId: 'main',
    })

    render(<HistoryTestComponent />)

    // The initial backup must be skipped while loading.
    expect(getModelSnapshots('startup-history')).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000)
    })

    // Even the periodic backup must not save temporary content.
    expect(getModelSnapshots('startup-history')).toHaveLength(0)

    // Simulate successful model loading.
    act(() => {
      useSessionStore.setState({
        code: 'class LoadedModel {}',
        tabs: [createTab('class LoadedModel {}')],
      })
      startupState.resolved = true
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    const snapshots = getModelSnapshots('startup-history')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].tabs[0].code).toBe('class LoadedModel {}')
  })

  it('does not offer an older snapshot as a newer version', () => {
    render(<HistoryTestComponent />)

    // The hook saves the original model on mount.
    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    // The current tab makes a newer edit.
    act(() => {
      useSessionStore.getState().setCode('class ModelA { latest; }')
      vi.advanceTimersByTime(5000)
    })

    expect(getModelSnapshots('history-a')[0].tabs[0].code)
      .toBe('class ModelA { latest; }')

    // Simulate another tab writing older model content later.
    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: original.tabs[0].code,
      }],
      activeTabId: 'main',
      reason: 'automatic',
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.info).not.toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.anything(),
    )
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'The latest model version has unknown ancestry. Review Version History before restoring.',
      expect.anything(),
    )
  })
  it('links consecutive automatic backups to their parent revision', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    act(() => {
      useSessionStore.getState().setCode('class ModelA { first; }')
      vi.advanceTimersByTime(5000)
    })

    const first = getModelSnapshots('history-a')[0]

    expect(first.parentSnapshotId).toBe(original.id)

    act(() => {
      useSessionStore.getState().setCode('class ModelA { second; }')
      vi.advanceTimersByTime(5000)
    })

    const second = getModelSnapshots('history-a')[0]

    expect(second.parentSnapshotId).toBe(first.id)
    expect(second.tabs[0].code).toBe('class ModelA { second; }')
  })
  it('warns about conflicting branches without replacing local changes', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    // Browser tab A makes a local edit.
    act(() => {
      useSessionStore.getState().setCode('class LocalChange {}')
      vi.advanceTimersByTime(5000)
    })

    const localRevision = getModelSnapshots('history-a')[0]
    expect(localRevision.parentSnapshotId).toBe(original.id)

    // Browser tab B independently edits the original version.
    const remoteRevision = saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class RemoteChange {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    expect(remoteRevision).not.toBeNull()

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.warning).toHaveBeenCalledWith(
      'Conflicting model changes detected. Review Version History before restoring.',
      expect.objectContaining({
        id: 'version-history-history-a',
      }),
    )

    expect(toastMocks.info).not.toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.anything(),
    )

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class LocalChange {}')

    // Both independent revisions must remain recoverable.
    const snapshots = getModelSnapshots('history-a')

    expect(snapshots.some(snapshot => snapshot.id === localRevision.id))
      .toBe(true)

    expect(snapshots.some(snapshot => snapshot.id === remoteRevision!.id))
      .toBe(true)
  })
  it('does not apply a stale update notification after local edits', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class RemoteChange {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    const notification = toastMocks.info.mock.calls.find(
      ([message]) => message === 'A newer model version is available.',
    )

    expect(notification).toBeDefined()

    // The user edits the model after receiving the notification.
    act(() => {
      useSessionStore.getState().setCode('class NewLocalWork {}')
    })

    // The user clicks the now-stale update notification.
    act(() => {
      notification![1].action.onClick()
    })

    // The newer local work must remain untouched.
    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class NewLocalWork {}')

    expect(toastMocks.warning).toHaveBeenCalledWith(
      'Your model changed after this notification. Review Version History before updating.',
    )
  })
  it('uses the restored revision as the parent of subsequent edits', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    const remote = saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class RemoteVersion {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    expect(remote).not.toBeNull()

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    const notification = toastMocks.info.mock.calls.find(
      ([message]) => message === 'A newer model version is available.',
    )

    expect(notification).toBeDefined()

    act(() => {
      notification![1].action.onClick()
    })

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class RemoteVersion {}')

    // Edit the restored version.
    act(() => {
      useSessionStore.getState().setCode('class EditedRestoredVersion {}')
      vi.advanceTimersByTime(5000)
    })

    const latest = getModelSnapshots('history-a')[0]

    expect(latest.tabs[0].code)
      .toBe('class EditedRestoredVersion {}')

    expect(latest.parentSnapshotId)
      .toBe(remote!.id)
  })
  it('tracks the restored revision after a manual restore event', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    // Save another version.
    act(() => {
      useSessionStore.getState().setCode('class VersionB {}')
      vi.advanceTimersByTime(5000)
    })

    const versionB = getModelSnapshots('history-a')[0]
    expect(versionB.id).not.toBe(original.id)

    // Simulate the successful manual restore performed by the dialog.
    act(() => {
      useSessionStore.getState().restoreTabs(
        original.tabs,
        original.activeTabId,
      )

      window.dispatchEvent(
        new CustomEvent('umple-version-restored', {
          detail: {
            modelId: 'history-a',
            snapshotId: original.id,
            tabs: original.tabs,
          },
        }),
      )
    })

    // Edit the restored version.
    act(() => {
      useSessionStore.getState().setCode('class EditedVersionA {}')
      vi.advanceTimersByTime(5000)
    })

    const latest = getModelSnapshots('history-a')[0]

    expect(latest.tabs[0].code)
      .toBe('class EditedVersionA {}')

    expect(latest.parentSnapshotId)
      .toBe(original.id)
  })

  it('warns when a remote revision has unknown ancestry', () => {
    render(<HistoryTestComponent />)

    // Save a revision that has no parent metadata.
    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class UnknownRevision {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.warning).toHaveBeenCalledWith(
      'The latest model version has unknown ancestry. Review Version History before restoring.',
      expect.objectContaining({
        id: 'version-history-history-a',
      }),
    )

    expect(toastMocks.info).not.toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.anything(),
    )

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class ModelA {}')
  })

  it('preserves unsaved local edits when a remote revision has unknown ancestry', () => {
    // Create an existing saved revision with different content.
    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class PreviouslySaved {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
    })

    // The hook creates an initial automatic backup when mounted.
render(<HistoryTestComponent />)

const snapshots = getModelSnapshots('history-a')
const localRevision = snapshots.find(
  (snapshot) =>
    snapshot.tabs[0].code === 'class ModelA {}',
)

expect(localRevision).toBeDefined()

// Change the editor without waiting for the debounce backup.
// The current editor content now has no matching saved snapshot.
act(() => {
  useSessionStore.getState().setCode('class UnsavedLocalChange {}')
})

const updatedSnapshots = getModelSnapshots('history-a')

expect(
  updatedSnapshots.some(
    (snapshot) =>
      snapshot.tabs[0].code === 'class UnsavedLocalChange {}',
  ),
).toBe(false)

    // A remote browser tab saves a new version without ancestry.
    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class RemoteUnknown {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.warning).toHaveBeenCalledWith(
      'The latest model version has unknown ancestry. Review Version History before restoring.',
      expect.objectContaining({
        id: 'version-history-history-a',
      }),
    )

    expect(toastMocks.info).not.toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.anything(),
    )

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class UnsavedLocalChange {}')
  })

  it('detects a backup saved by another browser tab', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.info).toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.objectContaining({
        id: 'version-history-history-a',
      }),
    )
  })

  it('ignores backups belonging to another model', () => {
    render(<HistoryTestComponent />)

    saveModelSnapshot({
      modelId: 'history-b',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class OtherModel {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    expect(toastMocks.info).not.toHaveBeenCalledWith(
      'A newer model version is available.',
      expect.anything(),
    )
  })

  it('updates to the latest version and preserves current work', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    const notification = toastMocks.info.mock.calls.find(
      ([message]) => message === 'A newer model version is available.',
    )

    expect(notification).toBeDefined()

    act(() => {
      notification![1].action.onClick()
    })

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class Updated {}')

    expect(
      getModelSnapshots('history-a').some(
        snapshot =>
          snapshot.reason === 'before-restore' &&
          snapshot.tabs[0].code === 'class ModelA {}',
      ),
    ).toBe(true)

    expect(toastMocks.success).toHaveBeenCalledWith(
      'Updated to the latest saved model version.',
    )
  })

  it('keeps current changes when the user declines the update', () => {
    render(<HistoryTestComponent />)

    const original = getModelSnapshots('history-a')[0]
    expect(original).toBeDefined()

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
      parentSnapshotId: original.id,
    })

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'umple-version-history-v1',
        }),
      )
    })

    const notification = toastMocks.info.mock.calls.find(
      ([message]) => message === 'A newer model version is available.',
    )

    expect(notification).toBeDefined()

    act(() => {
      notification![1].cancel.onClick()
    })

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class ModelA {}')
  })
})