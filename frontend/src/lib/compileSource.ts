/**
 * Snapshot of every open tab, which is what generation and diagram requests send.
 * Collaboration reads the same text from the Yjs document so a remote edit is included.
 */

import type { ApiTab } from '@/api/types'
import { getYDoc } from '@/hooks/useCollab'
import { useCollabStore } from '@/stores/collabStore'
import { useSessionStore } from '@/stores/sessionStore'

export interface CompileSourceSnapshot {
  activeCode: string
  activeTabId: string
  signature: string
  tabs: ApiTab[]
}

export function buildCompileSourceSignature(tabs: ApiTab[], activeTabId: string): string {
  let hash = 0x811c9dc5

  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }

  feed(activeTabId)
  feed('\u0000')

  for (const tab of tabs) {
    feed(tab.id)
    feed('\u0001')
    feed(tab.name)
    feed('\u0002')
    feed(tab.code)
    feed('\u0003')
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getCompileSourceSnapshot(): CompileSourceSnapshot {
  const { tabs, activeTabId, code } = useSessionStore.getState()
  const doc = useCollabStore.getState().isCollaborating ? getYDoc() : null

  const compileTabs = tabs.map(({ id, name, code: localCode }) => ({
    id,
    name,
    code:
      id === activeTabId
        ? (doc ? doc.getText(`tab:${id}`).toString() : code)
        : (doc ? doc.getText(`tab:${id}`).toString() : localCode),
  }))

  const activeCode = compileTabs.find((tab) => tab.id === activeTabId)?.code ?? code

  return {
    activeCode,
    activeTabId,
    signature: buildCompileSourceSignature(compileTabs, activeTabId),
    tabs: compileTabs,
  }
}
