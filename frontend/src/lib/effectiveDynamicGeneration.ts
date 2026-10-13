/**
 * Whether generation should run on each edit right now.
 * The preference can be on while a code-only canvas still pauses generation. The compiler hook checks this.
 */

import { useEphemeralStore } from '@/stores/ephemeralStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

function isOutputOnlyModeActive(layout: {
  diagramOnly: boolean
  rightPanelView: 'diagram' | 'generated'
}) {
  return layout.diagramOnly && layout.rightPanelView === 'generated'
}

export function getEffectiveDynamicGeneration() {
  const dynamicGeneration = usePreferencesStore.getState().dynamicGeneration
  const { diagramOnly, rightPanelView } = useEphemeralStore.getState()

  return dynamicGeneration && !isOutputOnlyModeActive({ diagramOnly, rightPanelView })
}

export function useEffectiveDynamicGeneration() {
  const dynamicGeneration = usePreferencesStore((s) => s.dynamicGeneration)
  const diagramOnly = useEphemeralStore((s) => s.diagramOnly)
  const rightPanelView = useEphemeralStore((s) => s.rightPanelView)

  return dynamicGeneration && !isOutputOnlyModeActive({ diagramOnly, rightPanelView })
}
