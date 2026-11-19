// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { VersionHistoryDialog } from '../VersionHistoryDialog'
import { useCollabStore } from '../../../stores/collabStore'
import { useSessionStore } from '../../../stores/sessionStore'
import {
  getModelSnapshots,
  saveModelSnapshot,
} from '../../../stores/versionHistoryStore'

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

describe('VersionHistoryDialog collaboration safety', () => {
  beforeEach(() => {
    localStorage.clear()
    useCollabStore.getState().stopCollab()

    useSessionStore.setState({
      historyId: 'test-history',
      modelId: 'test-model',
      code: 'class Current {}',
      tabs: [createTab('class Current {}')],
      activeTabId: 'main',
    })

    saveModelSnapshot({
      modelId: 'test-history',
      tabs: [{
        id: 'main',
        name: 'Model.ump',
        code: 'class Previous {}',
      }],
      activeTabId: 'main',
      reason: 'manual',
    })
  })

  afterEach(() => {
    cleanup()
    useCollabStore.getState().stopCollab()
  })

  it('disables restoration during a shared session', () => {
    useCollabStore.getState().startCollab('room-123')

    render(
      <VersionHistoryDialog
        open={true}
        onOpenChange={vi.fn()}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /preview version from/i,
      })
    )

    const restoreButton = screen.getByRole('button', {
      name: /restore this version/i,
    })

    expect(restoreButton.hasAttribute('disabled')).toBe(true)

    expect(
      screen.getByText(/restoration is disabled during shared sessions/i)
    ).toBeTruthy()

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class Current {}')
  })

  it('allows restoration outside a shared session', () => {
    const onOpenChange = vi.fn()

    render(
      <VersionHistoryDialog
        open={true}
        onOpenChange={onOpenChange}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /preview version from/i,
      })
    )

    const restoreButton = screen.getByRole('button', {
      name: /restore this version/i,
    })

    expect(restoreButton.hasAttribute('disabled')).toBe(false)

    fireEvent.click(restoreButton)

    expect(useSessionStore.getState().tabs[0].code)
      .toBe('class Previous {}')

    expect(onOpenChange).toHaveBeenCalledWith(false)

    const snapshots = getModelSnapshots('test-history')

    expect(
      snapshots.some((snapshot) => snapshot.reason === 'before-restore')
    ).toBe(true)
  })
  it('dispatches the restored revision event after manual restoration', () => {
    const onOpenChange = vi.fn()
    const restoreListener = vi.fn()

    window.addEventListener(
      'umple-version-restored',
      restoreListener,
    )

    try {
      const original = getModelSnapshots('test-history')[0]
      expect(original).toBeDefined()

      render(
        <VersionHistoryDialog
          open={true}
          onOpenChange={onOpenChange}
        />
      )

      fireEvent.click(
        screen.getByRole('button', {
          name: /preview version from/i,
        })
      )

      fireEvent.click(
        screen.getByRole('button', {
          name: /restore this version/i,
        })
      )

      // Verify that the selected version was restored.
      expect(useSessionStore.getState().tabs[0].code)
        .toBe('class Previous {}')

      // Verify that the current work was preserved.
      const snapshots = getModelSnapshots('test-history')

      const recovery = snapshots.find(
        (snapshot) => snapshot.reason === 'before-restore',
      )

      expect(recovery).toBeDefined()
      expect(recovery!.tabs[0].code)
        .toBe('class Current {}')

      // Verify that the dialog notified the version-history hook.
      expect(restoreListener).toHaveBeenCalledTimes(1)

      const event = restoreListener.mock.calls[0][0] as CustomEvent

      expect(event.detail).toEqual({
        modelId: 'test-history',
        snapshotId: original.id,
        tabs: original.tabs,
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
      window.removeEventListener(
        'umple-version-restored',
        restoreListener,
      )
    }
  })
})