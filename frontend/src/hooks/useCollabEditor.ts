/**
 * The shared Yjs text for the active tab, or null when this session is not collaborating.
 * UmpleEditor rebinds CodeMirror to that text when the tab changes.
 */

import { useMemo } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { useCollabStore } from '../stores/collabStore'
import { useSessionStore } from '../stores/sessionStore'
import { getYDoc, getAwareness } from './useCollab'

export interface CollabConfig {
  ytext: Y.Text
  awareness: Awareness
}

/**
 * Returns the Yjs collab config for the **active tab's** shared text buffer,
 * or null when not collaborating / not ready.
 *
 * When `activeTabId` changes, a new CollabConfig is returned (different ytext
 * reference), which causes UmpleEditor to rebind yCollab to the new tab.
 */
export function useCollabEditor(): CollabConfig | null {
  const isCollaborating = useCollabStore((s) => s.isCollaborating)
  const ready = useCollabStore((s) => s.ready)
  const activeTabId = useSessionStore((s) => s.activeTabId)

  return useMemo(() => {
    if (!isCollaborating || !ready) return null

    const doc = getYDoc()
    const awareness = getAwareness()
    if (!doc || !awareness) return null

    return {
      ytext: doc.getText(`tab:${activeTabId}`),
      awareness,
    }
  }, [isCollaborating, ready, activeTabId])
}
