/**
 * The node-and-edge result the class-diagram converter returns.
 * sessionStore stores a DiagramResult per view.
 */

import type { Edge, Node } from '@xyflow/react'

export interface DiagramResult {
  nodes: Node[]
  edges: Edge[]
}
