
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
  it('detects a backup saved by another browser tab', () => {
    render(<HistoryTestComponent />)

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
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

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
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

    saveModelSnapshot({
      modelId: 'history-a',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Updated {}',
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