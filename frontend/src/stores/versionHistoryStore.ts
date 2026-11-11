
export interface ModelSnapshot {
    id: string
    modelId: string
    timestamp: number
    tabs: {
      id: string
      name: string
      code: string
    }[]
    activeTabId: string
    reason: 'automatic' | 'manual' | 'before-restore' | 'before-switch'
  }

  const STORAGE_KEY = 'umple-version-history-v1'
  const MAX_SNAPSHOTS_PER_MODEL = 100
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

function retentionBucket(timestamp: number, now: number): string {
  const age = Math.max(0, now - timestamp)

  if (age < 30 * MINUTE) {
    return `recent-${Math.floor(age / (2 * MINUTE))}`
  }

  if (age < 2 * HOUR) {
    return `short-${Math.floor((age - 30 * MINUTE) / (5 * MINUTE))}`
  }

  if (age < 12 * HOUR) {
    return `medium-${Math.floor((age - 2 * HOUR) / (10 * MINUTE))}`
  }

  if (age < 2 * DAY) {
    return `long-${Math.floor((age - 12 * HOUR) / (30 * MINUTE))}`
  }

  if (age < 30 * DAY) {
    return `daily-${new Date(timestamp).toISOString().slice(0, 10)}`
  }

  return `monthly-${new Date(timestamp).toISOString().slice(0, 7)}`
}

function thinSnapshots(
  snapshots: ModelSnapshot[],
  now: number,
): ModelSnapshot[] {
  const seen = new Set<string>()
  const counts = new Map<string, number>()

  const sorted = [...snapshots].sort(
    (a, b) => b.timestamp - a.timestamp,
  )

  const retainedRecovery = new Set<string>()

  return sorted.filter((snapshot) => {
    const count = counts.get(snapshot.modelId) ?? 0

    // Always retain the newest before-restore checkpoint.
    if (
      snapshot.reason === 'before-restore' &&
      !retainedRecovery.has(snapshot.modelId)
    ) {
      retainedRecovery.add(snapshot.modelId)
      counts.set(snapshot.modelId, count + 1)
      return true
    }

      if (count >= MAX_SNAPSHOTS_PER_MODEL) {
        return false
      }
   // Manual and model-switch checkpoints are not age-thinned.
    if (snapshot.reason !== 'automatic') {
    counts.set(snapshot.modelId, count + 1)
    return true
    }
  const bucket = `${snapshot.modelId}:${retentionBucket(snapshot.timestamp, now)}`

    if (seen.has(bucket)) {
    return false
    }

    seen.add(bucket)
    counts.set(snapshot.modelId, count + 1)
    return true
    })
}

  function readSnapshots(): ModelSnapshot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []

      const data: unknown = JSON.parse(raw)
      return Array.isArray(data) ? data as ModelSnapshot[] : []
    } catch {
      return []
    }
  }

  function writeSnapshots(snapshots: ModelSnapshot[]): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
      return true
    } catch {
      return false
    }
  }

  export function getModelSnapshots(modelId: string): ModelSnapshot[] {
    return readSnapshots()
      .filter((snapshot) => snapshot.modelId === modelId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }
  export function getAllModelSnapshots(): ModelSnapshot[] {
    return readSnapshots()
      .sort((a, b) => b.timestamp - a.timestamp)
  }
  export function saveModelSnapshot(
    snapshot: Omit<ModelSnapshot, 'id' | 'timestamp'>,
  ): ModelSnapshot | null {
    const all = readSnapshots()
    const previous = all
      .filter((item) => item.modelId === snapshot.modelId)
      .sort((a, b) => b.timestamp - a.timestamp)[0]

    // Avoid saving identical automatic snapshots.
    if (
      snapshot.reason === 'automatic' &&
      previous &&
      JSON.stringify(previous.tabs) === JSON.stringify(snapshot.tabs) &&
      previous.activeTabId === snapshot.activeTabId
    ) {
      return previous
    }

    const newSnapshot: ModelSnapshot = {
      ...snapshot,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    const updated = [newSnapshot, ...all]
    const retained = thinSnapshots(updated, Date.now())

    return writeSnapshots(retained) ? newSnapshot : null
  }

  export function deleteModelSnapshot(id: string): boolean {
    return writeSnapshots(readSnapshots().filter((snapshot) => snapshot.id !== id))
  }

const MODEL_HISTORY_MAP_KEY = 'umple-model-history-map-v1'

export function getOrCreateHistoryId(modelId: string): string {
  try {
    const raw = localStorage.getItem(MODEL_HISTORY_MAP_KEY)

    const parsed: unknown = raw ? JSON.parse(raw) : {}
    const mapping: Record<string, string> =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, string>
        : {}

    const existing = mapping[modelId]

    if (typeof existing === 'string' && existing.length > 0) {
      return existing
    }

    const historyId = crypto.randomUUID()

    localStorage.setItem(
      MODEL_HISTORY_MAP_KEY,
      JSON.stringify({
        ...mapping,
        [modelId]: historyId,
      }),
    )

    return historyId
  } catch {
    return crypto.randomUUID()
  }
}