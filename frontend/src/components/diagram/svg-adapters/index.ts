/**
 * Looks up the click-to-edit adapter for a diagram view.
 * Only state diagrams have one today. SmartSvgView asks here before it binds click handlers.
 */

import type { DiagramView } from '@/constants/diagram'
import type { SvgDiagramAdapter } from './types'
import { stateSvgAdapter } from './state'

const ADAPTERS = new Map<DiagramView, SvgDiagramAdapter>([
  ['state', stateSvgAdapter],
])

export function getSvgDiagramAdapter(viewMode?: DiagramView): SvgDiagramAdapter | null {
  if (!viewMode) return null
  return ADAPTERS.get(viewMode) ?? null
}
