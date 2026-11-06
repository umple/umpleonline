/**
 * Turns a list of Graphviz points into the SVG path an association follows.
 * AssociationEdge uses this when the compiler returned an explicit route.
 */

import type { GvPoint } from '@/api/types'

export function buildPathFromPoints(points: GvPoint[]) {
  if (points.length === 0) {
    return ''
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  let path = `M ${points[0].x} ${points[0].y}`
  let i = 1
  for (; i + 2 < points.length; i += 3) {
    path += ` C ${points[i].x} ${points[i].y} ${points[i + 1].x} ${points[i + 1].y} ${points[i + 2].x} ${points[i + 2].y}`
  }
  for (; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`
  }
  return path
}
