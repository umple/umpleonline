/**
 * Draws one association on the editable class diagram.
 * UmpleDiagram registers this as the React Flow edge type. Arrows, diamonds, and labels come from the compiler JSON.
 */

import { createContext, memo, useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useStore, type EdgeProps } from '@xyflow/react'
import type { GvPoint } from '@/api/types'
import { clamp } from '@/hooks/diagrams/positions'
import { buildPathFromPoints } from './pathUtils'

export type AssociationDecoration = 'none' | 'arrow' | 'triangle' | 'diamond-filled' | 'diamond'

export interface AssociationEdgeData {
  sourceMultiplicity: string
  targetMultiplicity: string
  sourceRole: string
  targetRole: string
  sourceDecoration?: AssociationDecoration
  targetDecoration?: AssociationDecoration
  type: 'association' | 'generalization' | 'composition' | 'aggregation' | 'unidirectional' | 'unidirectional-reverse'
  exactPoints?: GvPoint[]
  labelPos?: GvPoint
  headLabelPos?: GvPoint
  tailLabelPos?: GvPoint
  parallelIndex?: number
  parallelCount?: number
  [key: string]: unknown
}

function markerForDecoration(decoration: AssociationDecoration | undefined) {
  switch (decoration) {
    case 'triangle':
      return 'url(#triangle)'
    case 'diamond-filled':
      return 'url(#diamond-filled)'
    case 'diamond':
      return 'url(#diamond)'
    case 'arrow':
      return 'url(#arrow)'
    default:
      return undefined
  }
}

const haloShadow = [
  '-1px -1px 0 var(--color-surface-0)',
  ' 1px -1px 0 var(--color-surface-0)',
  '-1px  1px 0 var(--color-surface-0)',
  ' 1px  1px 0 var(--color-surface-0)',
  ' 0   -1px 0 var(--color-surface-0)',
  ' 0    1px 0 var(--color-surface-0)',
  '-1px  0   0 var(--color-surface-0)',
  ' 1px  0   0 var(--color-surface-0)',
].join(',')

function anchorToTranslateX(anchor: string): string {
  switch (anchor) {
    case 'end': return '-100%'
    case 'middle': return '-50%'
    default: return '0%'
  }
}

function getNodeBorderPoint(
  nodeX: number, nodeY: number, nodeW: number, nodeH: number,
  targetX: number, targetY: number,
): { x: number; y: number } {
  const cx = nodeX + nodeW / 2
  const cy = nodeY + nodeH / 2
  const dx = targetX - cx
  const dy = targetY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scaleX = (nodeW / 2) / Math.abs(dx)
  const scaleY = (nodeH / 2) / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/** Liang-Barsky segment / rectangle intersection test */
function segmentIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number,
  padding: number,
): boolean {
  const left = rx - padding, right = rx + rw + padding
  const top = ry - padding, bottom = ry + rh + padding
  const dx = x2 - x1, dy = y2 - y1
  let tMin = 0, tMax = 1

  if (dx !== 0) {
    const t1 = (left - x1) / dx, t2 = (right - x1) / dx
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
    if (tMin > tMax) return false
  } else if (x1 < left || x1 > right) return false

  if (dy !== 0) {
    const t1 = (top - y1) / dy, t2 = (bottom - y1) / dy
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
    if (tMin > tMax) return false
  } else if (y1 < top || y1 > bottom) return false

  return true
}

/**
 * Compute perpendicular offset for a quadratic bezier that avoids all
 * obstacle nodes between source and target.  Returns 0 when no avoidance
 * is needed.
 */
function computeAvoidanceOffset(
  sx: number, sy: number, tx: number, ty: number,
  sourceId: string, targetId: string,
  nodeLookup: ReadonlyMap<string, { internals: { positionAbsolute: { x: number; y: number } }; measured?: { width?: number; height?: number } }>,
): number {
  const edgeLen = Math.hypot(tx - sx, ty - sy)
  if (edgeLen < 1) return 0

  const ux = (tx - sx) / edgeLen
  const uy = (ty - sy) / edgeLen
  const nx = -uy, ny = ux
  const pad = 20
  let maxPos = 0, maxNeg = 0, found = false

  for (const [id, node] of nodeLookup) {
    if (id === sourceId || id === targetId) continue
    const w = node.measured?.width ?? 0
    const h = node.measured?.height ?? 0
    if (w === 0 || h === 0) continue

    const pos = node.internals.positionAbsolute
    if (!segmentIntersectsRect(sx, sy, tx, ty, pos.x, pos.y, w, h, pad)) continue
    found = true

    // Quadratic bezier displacement from chord at parameter t is 2·t·(1−t)·offset.
    // Scale the required clearance so the curve actually clears the obstacle.
    const ocx = pos.x + w / 2, ocy = pos.y + h / 2
    const t = clamp(((ocx - sx) * ux + (ocy - sy) * uy) / edgeLen, 0.05, 0.95)
    const scale = 1 / Math.max(2 * t * (1 - t), 0.25)

    const corners = [
      [pos.x, pos.y], [pos.x + w, pos.y],
      [pos.x, pos.y + h], [pos.x + w, pos.y + h],
    ]
    for (const [cx, cy] of corners) {
      const d = (cx - sx) * nx + (cy - sy) * ny
      // Include padding in the clearance distance before scaling
      if (d > 0) maxPos = Math.max(maxPos, (d + pad) * scale)
      else maxNeg = Math.max(maxNeg, (-d + pad) * scale)
    }
  }

  if (!found) return 0
  // Route on the side requiring less clearance
  return maxPos <= maxNeg ? maxPos : -maxNeg
}

// ── Label collision avoidance ──

interface LabelRect { x: number; y: number; w: number; h: number }

/**
 * Greedy label-placement registry.  Each edge registers its labels in render
 * order; later labels nudge themselves away from earlier ones.
 * Call `reset(generation)` once per render cycle (in the diagram wrapper)
 * to flush stale entries.
 */
export class LabelRegistry {
  private rects: LabelRect[] = []
  private gen = -1

  reset(generation: number) {
    if (generation !== this.gen) { this.rects = []; this.gen = generation }
  }

  /** Register a label and return an adjusted position that avoids all previously registered labels. */
  place(x: number, y: number, w: number, h: number): { x: number; y: number } {
    const candidate: LabelRect = { x, y, w, h }
    // Nudge until no overlap (up to 6 attempts)
    for (let attempt = 0; attempt < 6; attempt++) {
      let collision = false
      for (const r of this.rects) {
        if (rectsOverlap(candidate, r)) {
          // Push candidate away from r along the axis of least overlap
          const overlapX = Math.min(candidate.x + candidate.w, r.x + r.w) - Math.max(candidate.x, r.x)
          const overlapY = Math.min(candidate.y + candidate.h, r.y + r.h) - Math.max(candidate.y, r.y)
          if (overlapX < overlapY) {
            candidate.x += (candidate.x < r.x ? -overlapX : overlapX) - 1
          } else {
            candidate.y += (candidate.y < r.y ? -overlapY : overlapY) - 1
          }
          collision = true
          break // re-check from scratch
        }
      }
      if (!collision) break
    }
    this.rects.push({ ...candidate })
    return { x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2 }
  }
}

function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export const LabelRegistryContext = createContext<LabelRegistry | null>(null)

const CHAR_W = 6 // approximate pixels per character at font-size 12 (Times Roman)
const LABEL_H = 16

/** Push a label position out of any non-source/target node it overlaps. */
function nudgeLabelFromNodes(
  lx: number, ly: number,
  nx: number, ny: number,
  sourceId: string, targetId: string,
  nodeLookup: ReadonlyMap<string, { internals: { positionAbsolute: { x: number; y: number } }; measured?: { width?: number; height?: number } }>,
): { x: number; y: number } {
  const pad = 6
  for (const [id, node] of nodeLookup) {
    if (id === sourceId || id === targetId) continue
    const w = node.measured?.width ?? 0
    const h = node.measured?.height ?? 0
    if (w === 0 || h === 0) continue
    const pos = node.internals.positionAbsolute

    if (lx >= pos.x - pad && lx <= pos.x + w + pad &&
        ly >= pos.y - pad && ly <= pos.y + h + pad) {
      // Ray-cast in the normal direction to exit the rect
      let tExit = Infinity
      if (nx > 0) tExit = Math.min(tExit, (pos.x + w + pad - lx) / nx)
      else if (nx < 0) tExit = Math.min(tExit, (pos.x - pad - lx) / nx)
      if (ny > 0) tExit = Math.min(tExit, (pos.y + h + pad - ly) / ny)
      else if (ny < 0) tExit = Math.min(tExit, (pos.y - pad - ly) / ny)
      if (tExit < Infinity) {
        return { x: lx + nx * (tExit + pad), y: ly + ny * (tExit + pad) }
      }
    }
  }
  return { x: lx, y: ly }
}

/** Resolve a label position: avoid nodes, then avoid other labels. */
function resolveLabel(
  rawX: number, rawY: number,
  text: string, fontSize: number,
  nx: number, ny: number,
  sourceId: string, targetId: string,
  nodeLookup: ReadonlyMap<string, { internals: { positionAbsolute: { x: number; y: number } }; measured?: { width?: number; height?: number } }>,
  registry: LabelRegistry | null,
): { x: number; y: number } {
  // 1. Push out of nodes
  const nudged = nudgeLabelFromNodes(rawX, rawY, nx, ny, sourceId, targetId, nodeLookup)
  if (!registry) return nudged
  // 2. Push away from other labels
  const estW = text.length * CHAR_W * (fontSize / 12)
  const estH = LABEL_H
  return registry.place(nudged.x - estW / 2, nudged.y - estH / 2, estW, estH)
}

function EdgeLabel({ testId, x, y, fontSize, color, children, translateX = '0%' }: {
  testId: string
  x: number
  y: number
  fontSize: number
  color: string
  children: React.ReactNode
  translateX?: string
}) {
  return (
    <div
      data-testid={testId}
      className="nodrag nopan"
      style={{
        position: 'absolute',
        transform: `translate(${x}px, ${y}px) translateX(${translateX}) translateY(-50%)`,
        fontSize,
        fontFamily: "Times, 'Times New Roman', serif",
        color,
        textShadow: haloShadow,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {children}
    </div>
  )
}

export const AssociationEdge = memo(function AssociationEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, data } = props
  const d = data as AssociationEdgeData | undefined
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const nodeLookup = useStore((s) => s.nodeLookup)

  let sourceDecoration = d?.sourceDecoration
  let targetDecoration = d?.targetDecoration

  if (!sourceDecoration && !targetDecoration) {
    switch (d?.type) {
      case 'generalization':
        targetDecoration = 'triangle'
        break
      case 'composition':
        sourceDecoration = 'diamond-filled'
        break
      case 'aggregation':
        sourceDecoration = 'diamond'
        break
      case 'unidirectional':
        targetDecoration = 'arrow'
        break
      case 'unidirectional-reverse':
        sourceDecoration = 'arrow'
        break
    }
  }

  // Check if Graphviz exact points are still valid (nodes haven't been dragged)
  const exactPointsValid = !!d?.exactPoints?.length && (() => {
    const pts = d!.exactPoints!
    const first = pts[0]
    const last = pts[pts.length - 1]
    const margin = 10
    const nearNode = (p: GvPoint, node: typeof sourceNode) => {
      if (!node?.measured?.width || !node?.measured?.height) return true
      const pos = node.internals.positionAbsolute
      const w = node.measured.width
      const h = node.measured.height
      return p.x >= pos.x - margin && p.x <= pos.x + w + margin &&
             p.y >= pos.y - margin && p.y <= pos.y + h + margin
    }
    return nearNode(first, sourceNode) && nearNode(last, targetNode)
  })()

  // Self-loop: source and target are the same node
  if (source === target) {
    if (exactPointsValid) {
      const exactPath = buildPathFromPoints(d!.exactPoints!)
      return (
        <>
          <BaseEdge
            path={exactPath}
            markerEnd={markerForDecoration(targetDecoration)}
            markerStart={markerForDecoration(sourceDecoration)}
            style={{ stroke: 'var(--color-border-strong)', strokeWidth: 1.5 }}
          />
          <EdgeLabelRenderer>
            {d?.sourceMultiplicity && d.tailLabelPos && (
              <EdgeLabel testId={`edge-label-${id}-source-multiplicity`} x={d.tailLabelPos.x} y={d.tailLabelPos.y} fontSize={12} color="var(--color-ink-muted)" translateX="-50%">{d.sourceMultiplicity}</EdgeLabel>
            )}
            {d?.targetMultiplicity && d.headLabelPos && (
              <EdgeLabel testId={`edge-label-${id}-target-multiplicity`} x={d.headLabelPos.x} y={d.headLabelPos.y} fontSize={12} color="var(--color-ink-muted)" translateX="-50%">{d.targetMultiplicity}</EdgeLabel>
            )}
          </EdgeLabelRenderer>
        </>
      )
    }
    // Right-side handles: source at 20% (upper), target at 80% (lower)
    const midY = (sourceY + targetY) / 2
    const offset = 50
    // Smooth D-shaped bezier — no sharp corners
    const loopPath = `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY} ${targetX + offset} ${targetY} ${targetX} ${targetY}`
    const labelX = sourceX + offset * 0.55
    const labelY = midY

    return (
      <>
        <BaseEdge
          path={loopPath}
          markerEnd={markerForDecoration(targetDecoration)}
          markerStart={markerForDecoration(sourceDecoration)}
          style={{ stroke: 'var(--color-border-strong)', strokeWidth: 1.5 }}
        />
        <EdgeLabelRenderer>
          {d?.sourceMultiplicity && (
            <EdgeLabel testId={`edge-label-${id}-source-multiplicity`} x={labelX} y={labelY - 10} fontSize={12} color="var(--color-ink-muted)">{d.sourceMultiplicity}</EdgeLabel>
          )}
          {d?.targetMultiplicity && (
            <EdgeLabel testId={`edge-label-${id}-target-multiplicity`} x={labelX} y={labelY + 10} fontSize={12} color="var(--color-ink-muted)">{d.targetMultiplicity}</EdgeLabel>
          )}
          {d?.sourceRole && (
            <EdgeLabel testId={`edge-label-${id}-source-role`} x={labelX} y={labelY - 24} fontSize={10} color="var(--color-ink-faint)">{d.sourceRole}</EdgeLabel>
          )}
          {d?.targetRole && (
            <EdgeLabel testId={`edge-label-${id}-target-role`} x={labelX} y={labelY + 24} fontSize={10} color="var(--color-ink-faint)">{d.targetRole}</EdgeLabel>
          )}
        </EdgeLabelRenderer>
      </>
    )
  }

  // --- Smart border attachment points ---
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY
  const parallelIndex = d?.parallelIndex ?? 0
  const parallelCount = d?.parallelCount ?? 1
  const perpOffset = parallelCount > 1
    ? (parallelIndex - (parallelCount - 1) / 2) * 60
    : 0

  if (sourceNode && targetNode) {
    const sPos = sourceNode.internals.positionAbsolute
    const tPos = targetNode.internals.positionAbsolute
    const sW = sourceNode.measured?.width ?? 0
    const sH = sourceNode.measured?.height ?? 0
    const tW = targetNode.measured?.width ?? 0
    const tH = targetNode.measured?.height ?? 0

    if (sW > 0 && sH > 0 && tW > 0 && tH > 0) {
      const sCx = sPos.x + sW / 2
      const sCy = sPos.y + sH / 2
      const tCx = tPos.x + tW / 2
      const tCy = tPos.y + tH / 2

      // For parallel edges, offset aim points so each edge attaches at a different border position
      let aimTx = tCx, aimTy = tCy, aimSx = sCx, aimSy = sCy
      if (perpOffset !== 0) {
        const [csx, csy, ctx_, cty] = source < target
          ? [sCx, sCy, tCx, tCy]
          : [tCx, tCy, sCx, sCy]
        const cLen = Math.hypot(ctx_ - csx, cty - csy) || 1
        const nx = -(cty - csy) / cLen
        const ny = (ctx_ - csx) / cLen
        aimTx += nx * perpOffset
        aimTy += ny * perpOffset
        aimSx += nx * perpOffset
        aimSy += ny * perpOffset
      }

      const sp = getNodeBorderPoint(sPos.x, sPos.y, sW, sH, aimTx, aimTy)
      const tp = getNodeBorderPoint(tPos.x, tPos.y, tW, tH, aimSx, aimSy)
      sx = sp.x; sy = sp.y
      tx = tp.x; ty = tp.y
    }
  }

  // --- Build path ---
  const exactPath = exactPointsValid ? buildPathFromPoints(d!.exactPoints!) : ''
  let edgePath: string
  if (exactPath) {
    edgePath = exactPath
  } else {
    const avoidOffset = computeAvoidanceOffset(sx, sy, tx, ty, source, target, nodeLookup)
    if (avoidOffset !== 0) {
      const mx = (sx + tx) / 2, my = (sy + ty) / 2
      const len = Math.hypot(tx - sx, ty - sy) || 1
      const anx = -(ty - sy) / len, any_ = (tx - sx) / len
      edgePath = `M ${sx} ${sy} Q ${mx + anx * avoidOffset} ${my + any_ * avoidOffset} ${tx} ${ty}`
    } else {
      edgePath = `M ${sx} ${sy} L ${tx} ${ty}`
    }
  }

  // --- Label positioning ---
  const dx = tx - sx
  const dy = ty - sy
  const length = Math.hypot(dx, dy) || 1
  const unitX = dx / length
  const unitY = dy / length
  let normalX = -unitY
  let normalY = unitX

  if (parallelCount > 1 && perpOffset !== 0) {
    // Orient labels outward from the center line between parallel edges
    const [csx, csy, ctx_, cty] = source < target ? [sx, sy, tx, ty] : [tx, ty, sx, sy]
    const cLen = Math.hypot(ctx_ - csx, cty - csy) || 1
    const cnx = -(cty - csy) / cLen
    const cny = (ctx_ - csx) / cLen
    normalX = perpOffset > 0 ? cnx : -cnx
    normalY = perpOffset > 0 ? cny : -cny
  } else {
    // Single edge: keep the label offset mostly upward
    if (normalY > 0 || (Math.abs(normalY) < 0.15 && normalX > 0)) {
      normalX *= -1
      normalY *= -1
    }
  }

  const alongOffset = Math.min(
    clamp(length * 0.18, 24, 44),
    Math.max(12, length / 2 - 10),
  )
  const sourceBaseX = sx + unitX * alongOffset
  const sourceBaseY = sy + unitY * alongOffset
  const targetBaseX = tx - unitX * alongOffset
  const targetBaseY = ty - unitY * alongOffset

  const sourceAnchor = Math.abs(dx) > Math.abs(dy)
    ? (unitX >= 0 ? 'start' : 'end')
    : 'middle'
  const targetAnchor = Math.abs(dx) > Math.abs(dy)
    ? (unitX >= 0 ? 'end' : 'start')
    : 'middle'

  // Only trust Graphviz label positions when exact points are still valid
  const tailLabel = exactPointsValid ? d?.tailLabelPos : undefined
  const headLabel = exactPointsValid ? d?.headLabelPos : undefined

  // Label collision resolution (node + label-to-label)
  const registry = useContext(LabelRegistryContext)
  const resolve = (rawX: number, rawY: number, text: string, fs: number) =>
    resolveLabel(rawX, rawY, text, fs, normalX, normalY, source, target, nodeLookup, registry)

  const srcMultPos = d?.sourceMultiplicity
    ? resolve(tailLabel?.x ?? (sourceBaseX + normalX * 12), tailLabel?.y ?? (sourceBaseY + normalY * 12), d.sourceMultiplicity, 12)
    : null
  const tgtMultPos = d?.targetMultiplicity
    ? resolve(headLabel?.x ?? (targetBaseX + normalX * 12), headLabel?.y ?? (targetBaseY + normalY * 12), d.targetMultiplicity, 12)
    : null
  const srcRolePos = d?.sourceRole
    ? resolve(tailLabel?.x ?? (sourceBaseX + normalX * 28), (tailLabel?.y ?? (sourceBaseY + normalY * 28)) + 14, d.sourceRole, 10)
    : null
  const tgtRolePos = d?.targetRole
    ? resolve(headLabel?.x ?? (targetBaseX + normalX * 28), (headLabel?.y ?? (targetBaseY + normalY * 28)) + 14, d.targetRole, 10)
    : null

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerForDecoration(targetDecoration)}
        markerStart={markerForDecoration(sourceDecoration)}
        style={{ stroke: 'var(--color-border-strong)', strokeWidth: 1.5 }}
      />

      <EdgeLabelRenderer>
        {srcMultPos && (
          <EdgeLabel
            testId={`edge-label-${id}-source-multiplicity`}
            x={srcMultPos.x}
            y={srcMultPos.y}
            fontSize={12}
            color="var(--color-ink-muted)"
            translateX={tailLabel ? '-50%' : anchorToTranslateX(sourceAnchor)}
          >
            {d!.sourceMultiplicity}
          </EdgeLabel>
        )}
        {tgtMultPos && (
          <EdgeLabel
            testId={`edge-label-${id}-target-multiplicity`}
            x={tgtMultPos.x}
            y={tgtMultPos.y}
            fontSize={12}
            color="var(--color-ink-muted)"
            translateX={headLabel ? '-50%' : anchorToTranslateX(targetAnchor)}
          >
            {d!.targetMultiplicity}
          </EdgeLabel>
        )}
        {srcRolePos && (
          <EdgeLabel
            testId={`edge-label-${id}-source-role`}
            x={srcRolePos.x}
            y={srcRolePos.y}
            fontSize={10}
            color="var(--color-ink-faint)"
            translateX={tailLabel ? '-50%' : anchorToTranslateX(sourceAnchor)}
          >
            {d!.sourceRole}
          </EdgeLabel>
        )}
        {tgtRolePos && (
          <EdgeLabel
            testId={`edge-label-${id}-target-role`}
            x={tgtRolePos.x}
            y={tgtRolePos.y}
            fontSize={10}
            color="var(--color-ink-faint)"
            translateX={headLabel ? '-50%' : anchorToTranslateX(targetAnchor)}
          >
            {d!.targetRole}
          </EdgeLabel>
        )}
      </EdgeLabelRenderer>
    </>
  )
})
