// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getModelSnapshots,
  getAllModelSnapshots,
  saveModelSnapshot,
  deleteModelSnapshot,
  getOrCreateHistoryId,
} from '../versionHistoryStore'

const model = {
  modelId: 'test-model',
  tabs: [
    { id: 'tab-1', name: 'Model.ump', code: 'class Student {}' },
  ],
  activeTabId: 'tab-1',
  reason: 'automatic' as const,
}

describe('versionHistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and retrieves a model snapshot', () => {
    const saved = saveModelSnapshot(model)

    expect(saved).not.toBeNull()
    expect(getModelSnapshots('test-model')).toHaveLength(1)
    expect(getModelSnapshots('test-model')[0].tabs[0].code)
      .toBe('class Student {}')
  })

  it('avoids duplicate automatic snapshots', () => {
    saveModelSnapshot(model)
    saveModelSnapshot(model)

    expect(getModelSnapshots('test-model')).toHaveLength(1)
  })

  it('keeps histories for different models separate', () => {
    saveModelSnapshot(model)
    saveModelSnapshot({ ...model, modelId: 'other-model' })

    expect(getModelSnapshots('test-model')).toHaveLength(1)
    expect(getModelSnapshots('other-model')).toHaveLength(1)
  })

  it('deletes a snapshot', () => {
    const saved = saveModelSnapshot(model)
    expect(saved).not.toBeNull()

    deleteModelSnapshot(saved!.id)

    expect(getModelSnapshots('test-model')).toHaveLength(0)
  })

  it('preserves a snapshot before switching models', () => {
    const saved = saveModelSnapshot({
      ...model,
      reason: 'before-switch',
    })

    expect(saved).not.toBeNull()
    expect(saved?.reason).toBe('before-switch')
    expect(getModelSnapshots('test-model')[0].tabs[0].code)
      .toBe('class Student {}')
  })

  it('preserves multiple tabs and the active tab', () => {
    const saved = saveModelSnapshot({
      ...model,
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: 'class Student {}' },
        { id: 'tab-2', name: 'Course.ump', code: 'class Course {}' },
      ],
      activeTabId: 'tab-2',
    })

    expect(saved).not.toBeNull()

    const snapshots = getModelSnapshots('test-model')

    expect(snapshots[0].tabs).toHaveLength(2)
    expect(snapshots[0].activeTabId).toBe('tab-2')
    expect(snapshots[0].tabs[1].code).toBe('class Course {}')
  })

  it('preserves a snapshot before restoring an older version', () => {
    const saved = saveModelSnapshot({
      ...model,
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: 'class Student { name; }' },
      ],
      reason: 'before-restore',
    })

    expect(saved).not.toBeNull()
    expect(saved?.reason).toBe('before-restore')
    expect(getModelSnapshots('test-model')[0].tabs[0].code)
      .toBe('class Student { name; }')
  })

  it('thins automatic snapshots within the same time bucket', () => {
    for (let i = 0; i < 105; i++) {
      saveModelSnapshot({
        ...model,
        tabs: [
          { id: 'tab-1', name: 'Model.ump', code: `class Version${i} {}` },
        ],
      })
    }

    const snapshots = getModelSnapshots('test-model')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].tabs[0].code)
    .toBe('class Version104 {}')
  })

  it('retains automatic snapshots across different age intervals', () => {
  const now = new Date('2026-11-10T12:00:00Z').getTime()

  vi.useFakeTimers()
  try {
    vi.setSystemTime(now)

    const agesInMinutes = [
      3,       // Last 30 minutes
      35,      // 30 minutes to 2 hours
      130,     // 2 to 12 hours
      780,     // 12 hours to 2 days
      4320,    // 3 days
      57600,   // 40 days
    ]

    const snapshots = agesInMinutes.map((age, index) => ({
      id: `snapshot-${index}`,
      modelId: 'test-model',
      timestamp: now - age * 60 * 1000,
      tabs: [{
        id: 'tab-1',
        name: 'Model.ump',
        code: `class Version${index} {}`,
      }],
      activeTabId: 'tab-1',
      reason: 'automatic' as const,
    }))

    localStorage.setItem(
      'umple-version-history-v1',
      JSON.stringify(snapshots),
    )

    saveModelSnapshot({
      ...model,
      tabs: [{
        id: 'tab-1',
        name: 'Model.ump',
        code: 'class Latest {}',
      }],
    })

    const retained = getModelSnapshots('test-model')

    for (const snapshot of snapshots) {
      expect(retained.some((item) => item.id === snapshot.id)).toBe(true)
    }
  } finally {
    vi.useRealTimers()
  }
})

  it('preserves recovery snapshots during thinning', () => {
    saveModelSnapshot({
      ...model,
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: 'class Original {}' },
      ],
    })

    saveModelSnapshot({
      ...model,
      reason: 'before-restore',
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: 'class BeforeRestore {}' },
      ],
    })

    saveModelSnapshot({
      ...model,
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: 'class Latest {}' },
      ],
    })

    const snapshots = getModelSnapshots('test-model')

    expect(snapshots.some(
      (snapshot) => snapshot.reason === 'before-restore',
    )).toBe(true)

    expect(snapshots.some(
      (snapshot) => snapshot.tabs[0].code === 'class Latest {}',
    )).toBe(true)
  })


it('keeps the newest recovery checkpoint when history exceeds 100 snapshots', () => {
  const recovery = saveModelSnapshot({
    ...model,
    reason: 'before-restore',
    tabs: [
      { id: 'tab-1', name: 'Model.ump', code: 'class Recovery {}' },
    ],
  })

  expect(recovery).not.toBeNull()

  for (let i = 0; i < 105; i++) {
    saveModelSnapshot({
      ...model,
      reason: 'manual',
      tabs: [
        { id: 'tab-1', name: 'Model.ump', code: `class Version${i} {}` },
      ],
    })
  }

  const snapshots = getModelSnapshots('test-model')

  expect(snapshots.some(
    (snapshot) => snapshot.id === recovery!.id,
  )).toBe(true)
})

it('returns null when browser storage fails', () => {
    const storageSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      })

    try {
      const saved = saveModelSnapshot(model)

      expect(saved).toBeNull()
      expect(getModelSnapshots('test-model')).toHaveLength(0)
    } finally {
      storageSpy.mockRestore()
    }
  })
  it('reuses the same history ID for a previously opened model', () => {
    const firstHistoryId = getOrCreateHistoryId('permanent-model-a')
    const secondHistoryId = getOrCreateHistoryId('permanent-model-a')
    const otherHistoryId = getOrCreateHistoryId('permanent-model-b')

    expect(secondHistoryId).toBe(firstHistoryId)
    expect(otherHistoryId).not.toBe(firstHistoryId)
  })
  it('finds snapshots from previous browser sessions', () => {
    const oldSession = saveModelSnapshot({
      ...model,
      modelId: 'previous-session',
      tabs: [
        {
          id: 'tab-1',
          name: 'Model.ump',
          code: 'class Student {}',
        },
      ],
    })

    const currentSession = saveModelSnapshot({
      ...model,
      modelId: 'current-session',
      tabs: [
        {
          id: 'tab-1',
          name: 'Model.ump',
          code: 'class Teacher {}',
        },
      ],
    })

    expect(oldSession).not.toBeNull()
    expect(currentSession).not.toBeNull()

    const allSnapshots = getAllModelSnapshots()

    expect(
      allSnapshots.some((item) => item.id === oldSession?.id),
    ).toBe(true)

    expect(
      allSnapshots.some((item) => item.id === currentSession?.id),
    ).toBe(true)

    expect(getModelSnapshots('previous-session')).toHaveLength(1)
    expect(getModelSnapshots('current-session')).toHaveLength(1)
  })
})
