/**
 * Builds the Graphviz DOT for the object-explorer instance diagram.
 * The browser sends that DOT to POST /api/crud/diagram, which returns SVG.
 */

import type { CrudAssociation, CrudSchema } from '@/api/types'
import {
  collectClassAssociations,
  findReverseAssoc,
  getAssocIds,
  getAssociationRuntimeIdentity,
  type CrudInstance,
} from '@/stores/crudStore'

function escapeLabel(s: string): string {
  return s.replace(/[\\"{}<>|]/g, '\\$&')
}

function associationPairKey(
  schema: CrudSchema,
  srcNode: string,
  tgtNode: string,
  assoc: CrudAssociation,
): string {
  const nodeKey = [srcNode, tgtNode].sort().join('->')
  const reverseAssoc = findReverseAssoc(schema, assoc)
  const assocKey = reverseAssoc
    ? [getAssociationRuntimeIdentity(assoc), getAssociationRuntimeIdentity(reverseAssoc)].sort().join('<->')
    : getAssociationRuntimeIdentity(assoc)
  return `${nodeKey}::${assocKey}`
}

function formatEndpointLabel(multiplicity?: string, roleName?: string): string | undefined {
  const parts = [multiplicity, roleName].filter(Boolean)
  if (parts.length === 0) return undefined
  return escapeLabel(parts.join(' '))
}

export function generateInstanceDiagramDot(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
): string {
  const lines: string[] = [
    'digraph InstanceDiagram {',
    '  rankdir=TB;',
    '  node [shape=record, fontsize=10, fontname="Helvetica"];',
    '  edge [fontsize=8, fontname="Helvetica"];',
    '',
  ]
  const nodeIdByInstanceId = new Map<number, string>()

  for (const cls of schema.classes) {
    const list = instances[cls.name] ?? []
    for (const inst of list) {
      const nodeId = `${cls.name}_${inst._id}`
      nodeIdByInstanceId.set(inst._id, nodeId)
      const header = `${cls.name} #${inst._id}`
      const attrLines = cls.attributes
        .map((a) => {
          const val = inst[a.name]
          const display = val === undefined || val === null ? '-' : String(val)
          return `${escapeLabel(a.name)} = ${escapeLabel(display)}`
        })
        .join('\\l')
      const label = attrLines ? `{${escapeLabel(header)}|${attrLines}\\l}` : escapeLabel(header)
      lines.push(`  ${nodeId} [label="${label}"];`)
    }
  }

  lines.push('')

  const drawnEdges = new Set<string>()
  for (const cls of schema.classes) {
    const list = instances[cls.name] ?? []
    for (const inst of list) {
      for (const assoc of collectClassAssociations(schema, cls.name)) {
        if (!assoc.isNavigable) continue
        const ids = getAssocIds(inst, assoc)

        for (const tid of ids) {
          const srcNode = nodeIdByInstanceId.get(inst._id) ?? `${cls.name}_${inst._id}`
          const tgtNode = nodeIdByInstanceId.get(tid)
          if (!tgtNode) continue
          const edgeKey = associationPairKey(schema, srcNode, tgtNode, assoc)
          if (drawnEdges.has(edgeKey)) continue
          drawnEdges.add(edgeKey)
          const reverseAssoc = findReverseAssoc(schema, assoc)
          const tailLabel = formatEndpointLabel(reverseAssoc?.multiplicity.raw, reverseAssoc?.roleName ?? assoc.reverseRoleName)
          const headLabel = formatEndpointLabel(assoc.multiplicity.raw, assoc.roleName)
          const attrs = ['dir=none']

          if (tailLabel) attrs.push(`taillabel="${tailLabel}"`)
          if (headLabel) attrs.push(`headlabel="${headLabel}"`)

          lines.push(`  ${srcNode} -> ${tgtNode} [${attrs.join(', ')}];`)
        }
      }
    }
  }

  lines.push('}')
  return lines.join('\n')
}
