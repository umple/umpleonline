/**
 * Places class-diagram nodes from Graphviz coordinates, or on a grid when no layout came back.
 * classConverter.ts calls this while it builds the React Flow graph.
 */

import type { GvEdgeLayout, GvLayout } from '../../api/types'

export interface DiagramNodeMetrics {
  width: number
  height: number
}

export interface LayoutEntry {
  name: string
  metrics: DiagramNodeMetrics
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function estimateTextWidth(text: string) {
  return text.length * 7.5
}

export function buildGvPositions(layout: GvLayout, entries: LayoutEntry[]) {
  const positions = new Map<string, { x: number; y: number }>()
  const nodeMap = new Map(layout.nodes.map((n) => [n.name, n]))

  for (const entry of entries) {
    const gvNode = nodeMap.get(entry.name)
    if (!gvNode) continue

    positions.set(entry.name, {
      x: gvNode.x - entry.metrics.width / 2,
      y: gvNode.y - entry.metrics.height / 2,
    })
  }

  return positions
}

export function buildGridPositions(
  entries: LayoutEntry[],
  {
    cols = 3,
    xGap = 250,
    yGap = 200,
    offsetX = 50,
    offsetY = 50,
  }: {
    cols?: number
    xGap?: number
    yGap?: number
    offsetX?: number
    offsetY?: number
  } = {},
) {
  const positions = new Map<string, { x: number; y: number }>()
  for (let i = 0; i < entries.length; i++) {
    positions.set(entries[i].name, {
      x: (i % cols) * xGap + offsetX,
      y: Math.floor(i / cols) * yGap + offsetY,
    })
  }
  return positions
}

export function createLayoutEdgeMatcher(layout?: GvLayout) {
  const edges = [...(layout?.edges ?? [])]
  const used = new Set<number>()

  return (predicate: (edge: GvEdgeLayout) => boolean) => {
    for (let i = 0; i < edges.length; i++) {
      if (used.has(i)) continue
      if (!predicate(edges[i])) continue
      used.add(i)
      return edges[i]
    }
    return undefined
  }
}
