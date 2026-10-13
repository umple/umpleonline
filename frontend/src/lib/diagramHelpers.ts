/**
 * Small helpers for the editable class diagram.
 * Turns a React Flow node id into a class name, and decides which sync action deletes an edge.
 */

import type { Edge } from '@xyflow/react'
import type { AssociationEdgeData } from '@/components/diagram/edges/AssociationEdge'

const MODEL_DELIMITER = '//$?[End_of_model]$?'

/** Extract the Umple class name from a ReactFlow node ID (e.g. "class-Foo" → "Foo"). */
export function extractClassName(nodeId: string): string {
  return nodeId.replace(/^class-/, '')
}

/** Generate a unique class name that doesn't conflict with existing nodes. */
export function generateClassName(nodes: { id: string }[]): string {
  const existing = new Set(nodes.map((n) => extractClassName(n.id)))
  let i = 1
  while (existing.has(`NewClass${i}`)) i++
  return `NewClass${i}`
}

/** Check whether a node name comes from an associationClass definition in the editable code. */
export function isAssociationClass(code: string, className: string): boolean {
  const userCode = code.split(MODEL_DELIMITER, 1)[0]
  const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\n)\\s*associationClass\\s+${escapedName}\\b`).test(userCode)
}

/** Determine the correct sync action and params for deleting an edge. */
export function edgeDeletionParams(edge: Edge): { action: string; params: Record<string, string> } {
  const data = edge.data as AssociationEdgeData | undefined
  const sourceClass = extractClassName(edge.source)
  const targetClass = extractClassName(edge.target)

  if (data?.type === 'generalization') {
    return { action: 'removeGeneralization', params: { childClass: sourceClass, parentClass: targetClass } }
  }
  const assocId = (data as any)?.assocId ?? ''
  return { action: 'removeAssociation', params: { classOneId: sourceClass, classTwoId: targetClass, assocId } }
}

/** Map a handle ID to an offset (px) relative to the node's top-left corner. */
export function handleToOffset(
  handleId: string | null | undefined,
  width: number,
  height: number,
): { x: number; y: number } {
  const side = handleId?.replace(/-in$/, '') ?? 'top'
  switch (side) {
    case 'top':    return { x: Math.round(width / 2), y: 0 }
    case 'right':  return { x: width, y: Math.round(height / 2) }
    case 'bottom': return { x: Math.round(width / 2), y: height }
    case 'left':   return { x: 0, y: Math.round(height / 2) }
    default:       return { x: 0, y: 0 }
  }
}
