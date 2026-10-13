/**
 * Turns compiler class JSON and Graphviz layout into React Flow nodes and edges.
 * useCompiler stores the result on the session so UmpleDiagram can draw it.
 */

import type { Edge, Node } from '@xyflow/react'
import type { GvEdgeLayout, GvLayout, GvNodeLayout, Position, StoredLayoutMetadata, UmpleAssociation, UmpleAttribute, UmpleMethod, UmpleModel } from '../../api/types'
import type { ClassNodeData } from '../../components/diagram/nodes/ClassNode'
import type { AssociationEdgeData } from '../../components/diagram/edges/AssociationEdge'
import { buildGridPositions, buildGvPositions, clamp, createLayoutEdgeMatcher, estimateTextWidth, type DiagramNodeMetrics, type LayoutEntry } from './positions'
import type { DiagramResult } from './types'

const DEFAULT_WIDTH = 180

function resolveNodeMetrics(
  position: Position | undefined,
  fallback: DiagramNodeMetrics,
): DiagramNodeMetrics {
  return {
    width: Math.max(position?.width ?? 0, fallback.width),
    height: Math.max(position?.height ?? 0, fallback.height),
  }
}

function exactLayoutMetrics(layout: GvLayout | undefined, name: string, fallback: DiagramNodeMetrics) {
  const layoutNode = layout?.nodes.find((node) => node.name === name)
  if (!layoutNode) return fallback
  return {
    width: layoutNode.width,
    height: layoutNode.height,
  }
}

function withExactEdgeLayout(edge: Edge, layoutEdge: GvEdgeLayout | undefined): Edge {
  if (!layoutEdge) return edge
  const data = (edge.data ?? {}) as Record<string, unknown>
  return {
    ...edge,
    data: {
      ...data,
      exactPoints: layoutEdge.points,
      labelPos: layoutEdge.labelPos,
      headLabelPos: layoutEdge.headLabelPos,
      tailLabelPos: layoutEdge.tailLabelPos,
    },
  }
}

function estimateClassMetrics(
  name: string,
  attributes: UmpleAttribute[] = [],
): DiagramNodeMetrics {
  const lines = [
    name,
    ...attributes.map((attr) => (attr.type ? `${attr.name}: ${attr.type}` : attr.name)),
  ]

  const widestLine = lines.reduce((max, line) => Math.max(max, estimateTextWidth(line)), 0)

  return {
    width: clamp(Math.round(widestLine + 40), DEFAULT_WIDTH, 420),
    height: clamp(38 + (attributes.length > 0 ? attributes.length * 18 : 0), 50, 420),
  }
}

function asBoolean(value: string | boolean | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue
  return value === true || value === 'true'
}

function normalizeDisplayText(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .trim()
}

function formatMethod(method: UmpleMethod): string {
  const params = method.parameters || ''
  return method.type ? `${method.name}(${params}): ${method.type}` : `${method.name}(${params})`
}

function parseMethodSignature(line: string) {
  const match = line.match(/^([^(:]+)\(([^)]*)\)(?::\s*(.+))?$/)
  if (!match) return null

  return {
    name: match[1].trim(),
    params: match[2].trim(),
    returnType: match[3]?.trim() || '',
  }
}

function getVisibleBodyLines(layoutNode: GvNodeLayout | undefined): string[] {
  if (!layoutNode?.textLines?.length) return []

  return layoutNode.textLines
    .map((line) => line.text.trim())
    .filter((line) => line && line !== layoutNode.name)
}

function buildDisplayAttributes(attributes: UmpleAttribute[], layoutNode: GvNodeLayout | undefined): ClassNodeData['attributes'] {
  const all = attributes.map((a) => ({ name: a.name, type: a.type || '' }))

  const bodyLines = getVisibleBodyLines(layoutNode)
  if (bodyLines.length === 0) return all

  // Attribute lines are body lines without parentheses (those are methods)
  const attrLines = bodyLines.filter((line) => !line.includes('('))
  const visibleNames = new Set(attrLines.map((line) => line.split(':')[0].trim()))

  return all.filter((a) => visibleNames.has(a.name))
}

function buildDisplayMethods(methods: UmpleMethod[], layoutNode: GvNodeLayout | undefined): ClassNodeData['methods'] {
  const explicit = methods.map((method) => ({
    name: method.name,
    returnType: method.type || 'void',
    params: method.parameters || '',
    displayText: formatMethod(method),
    removable: true,
  }))

  const bodyLines = getVisibleBodyLines(layoutNode)
  if (bodyLines.length === 0) return explicit

  const explicitByText = new Map(explicit.map((method) => [normalizeDisplayText(method.displayText ?? ''), method]))

  return bodyLines
    .filter((line) => line.includes('('))
    .map((line) => {
      const normalized = normalizeDisplayText(line)
      const explicitMethod = explicitByText.get(normalized)
      if (explicitMethod) {
        return { ...explicitMethod, displayText: line }
      }

      const parsed = parseMethodSignature(line)
      return {
        name: parsed?.name || line,
        returnType: parsed?.returnType || '',
        params: parsed?.params || '',
        displayText: line,
        removable: false,
      }
    })
}

const GENERALIZATION_EDGE_DATA: AssociationEdgeData = {
  sourceMultiplicity: '',
  targetMultiplicity: '',
  sourceRole: '',
  targetRole: '',
  sourceDecoration: 'none',
  targetDecoration: 'triangle',
  type: 'generalization',
}

type LayoutEdgeMatcher = (predicate: (edge: GvEdgeLayout) => boolean) => GvEdgeLayout | undefined

function buildAssociationEdge(
  assoc: UmpleAssociation,
  index: number,
  matchLayoutEdge: LayoutEdgeMatcher,
): Edge {
  const source = assoc.classOneId
    ? `class-${assoc.classOneId}`
    : `class-${assoc.end1!.className}`
  const target = assoc.classTwoId
    ? `class-${assoc.classTwoId}`
    : `class-${assoc.end2!.className}`

  const srcMult = assoc.multiplicityOne ?? assoc.end1?.multiplicity ?? ''
  const tgtMult = assoc.multiplicityTwo ?? assoc.end2?.multiplicity ?? ''
  const srcRole = assoc.roleOne ?? assoc.end1?.roleName ?? ''
  const tgtRole = assoc.roleTwo ?? assoc.end2?.roleName ?? ''

  const leftComp = asBoolean(assoc.isLeftComposition, false)
  const rightComp = asBoolean(assoc.isRightComposition, false)
  const leftNav = asBoolean(assoc.isLeftNavigable, true)
  const rightNav = asBoolean(assoc.isRightNavigable, true)

  let edgeType: AssociationEdgeData['type'] = 'association'
  if (leftComp || rightComp) {
    edgeType = 'composition'
  } else if (!leftNav && rightNav) {
    edgeType = 'unidirectional'
  } else if (leftNav && !rightNav) {
    edgeType = 'unidirectional-reverse'
  }

  const isSelfLoop = source === target

  const layoutEdge = matchLayoutEdge((edge) =>
    edge.source === assoc.classOneId && edge.target === assoc.classTwoId &&
    (edge.headLabel ?? '') === tgtMult && (edge.tailLabel ?? '') === srcMult,
  ) ?? matchLayoutEdge((edge) =>
    edge.source === source.replace(/^class-/, '') && edge.target === target.replace(/^class-/, '') &&
    (edge.headLabel ?? '') === tgtMult && (edge.tailLabel ?? '') === srcMult,
  )

  return withExactEdgeLayout({
    id: `assoc-${index}`,
    source,
    target,
    ...(isSelfLoop ? { sourceHandle: 'right-source', targetHandle: 'right-target' } : {}),
    type: 'association',
    data: {
      sourceMultiplicity: srcMult,
      targetMultiplicity: tgtMult,
      sourceRole: srcRole,
      targetRole: tgtRole,
      sourceDecoration: leftComp
        ? 'diamond-filled'
        : (!rightNav && leftNav ? 'arrow' : 'none'),
      targetDecoration: rightComp
        ? 'diamond-filled'
        : (!leftNav && rightNav ? 'arrow' : 'none'),
      type: edgeType,
      assocId: assoc.id ?? '',
    } satisfies AssociationEdgeData,
  }, layoutEdge)
}

function buildInheritanceEdge(
  id: string,
  sourceName: string,
  targetName: string,
  matchLayoutEdge: LayoutEdgeMatcher,
): Edge {
  return withExactEdgeLayout({
    id,
    source: `class-${sourceName}`,
    target: `class-${targetName}`,
    type: 'association',
    data: GENERALIZATION_EDGE_DATA,
  }, matchLayoutEdge((edge) =>
    edge.source === sourceName && edge.target === targetName && !edge.headLabel && !edge.tailLabel,
  ))
}

function annotateParallelEdges(edges: Edge[]): Edge[] {
  const groups = new Map<string, number[]>()
  edges.forEach((edge, i) => {
    if (edge.source === edge.target) return
    const key = [edge.source, edge.target].sort().join('|')
    const group = groups.get(key)
    if (group) group.push(i)
    else groups.set(key, [i])
  })

  const result = [...edges]
  for (const indices of groups.values()) {
    if (indices.length <= 1) continue
    for (let j = 0; j < indices.length; j++) {
      const edge = result[indices[j]]
      result[indices[j]] = {
        ...edge,
        data: {
          ...edge.data,
          parallelIndex: j,
          parallelCount: indices.length,
        },
      }
    }
  }
  return result
}

export function convertClassDiagram(model: UmpleModel, gvLayout?: GvLayout, storedLayout?: StoredLayoutMetadata): DiagramResult {
  const classes = model.umpleClasses || []
  const associations = model.umpleAssociations || []
  const interfaces = model.umpleInterfaces || []
  const layoutNodeMap = new Map((gvLayout?.nodes ?? []).map((node) => [node.name, node]))
  const storedNodeNames = new Set(storedLayout?.nodeNames ?? [])

  const layoutEntries: LayoutEntry[] = [
    ...classes.map((cls) => ({
      name: cls.name,
      metrics: exactLayoutMetrics(
        gvLayout,
        cls.name,
        resolveNodeMetrics(cls.position, estimateClassMetrics(cls.name, cls.attributes)),
      ),
    })),
    ...interfaces.map((iface) => ({
      name: iface.name,
      metrics: exactLayoutMetrics(
        gvLayout,
        iface.name,
        resolveNodeMetrics(iface.position, estimateClassMetrics(iface.name)),
      ),
    })),
  ]

  const positions = gvLayout
    ? buildGvPositions(gvLayout, layoutEntries)
    : buildGridPositions(layoutEntries)
  const matchLayoutEdge = createLayoutEdgeMatcher(gvLayout)

  const classNodes: Node[] = classes.map((cls): Node => {
    const metrics = layoutEntries.find((entry) => entry.name === cls.name)?.metrics ?? estimateClassMetrics(cls.name, cls.attributes)
    const layoutNode = layoutNodeMap.get(cls.name)
    return {
      id: `class-${cls.name}`,
      type: 'classNode',
      position: storedNodeNames.has(cls.name) && cls.position
        ? { x: cls.position.x, y: cls.position.y }
        : (positions.get(cls.name) ?? { x: 50, y: 50 }),
      style: { width: metrics.width, height: metrics.height },
      data: {
        name: cls.name,
        attributes: buildDisplayAttributes(cls.attributes || [], layoutNode),
        methods: buildDisplayMethods(cls.methods || [], layoutNode),
        isAbstract: cls.isAbstract || false,
        isInterface: false,
        displayColor: cls.displayColor || '',
      } satisfies ClassNodeData,
    }
  })

  const ifaceNodes: Node[] = interfaces.map((iface): Node => {
    const metrics = layoutEntries.find((entry) => entry.name === iface.name)?.metrics ?? estimateClassMetrics(iface.name)
    const layoutNode = layoutNodeMap.get(iface.name)
    return {
      id: `class-${iface.name}`,
      type: 'classNode',
      position: storedNodeNames.has(iface.name) && iface.position
        ? { x: iface.position.x, y: iface.position.y }
        : (positions.get(iface.name) ?? { x: 50, y: 50 }),
      style: { width: metrics.width, height: metrics.height },
      data: {
        name: iface.name,
        attributes: [],
        methods: buildDisplayMethods(iface.methods || [], layoutNode),
        isAbstract: false,
        isInterface: true,
      } satisfies ClassNodeData,
    }
  })

  const assocEdges: Edge[] = associations
    .filter((a) => (a.classOneId && a.classTwoId) || (a.end1 && a.end2))
    .map((assoc, i) => buildAssociationEdge(assoc, i, matchLayoutEdge))

  const genEdges: Edge[] = classes
    .filter((cls) => cls.extendsClass)
    .map((cls) => buildInheritanceEdge(`gen-${cls.name}`, cls.name, cls.extendsClass!, matchLayoutEdge))

  const implEdges: Edge[] = classes
    .filter((cls) => cls.implementedInterfaces?.length)
    .flatMap((cls) =>
      cls.implementedInterfaces!.map((iface) =>
        buildInheritanceEdge(`impl-${cls.name}-${iface}`, cls.name, iface, matchLayoutEdge),
      ),
    )

  return {
    nodes: [...classNodes, ...ifaceNodes],
    edges: annotateParallelEdges([...assocEdges, ...genEdges, ...implEdges]),
  }
}
