/**
 * Rewrites state-diagram Umple when the user edits the SVG.
 * The state adapter in state.ts calls these helpers to rename a state, recolor it, or change a transition.
 */

import { findDiagramRange } from '../../editor/diagramSelection'

export interface SvgStateTarget {
  rawId: string
  anchorTitle: string | null
}

export interface ParsedStateNodeTarget {
  rawId: string
  label: string
  stateName: string
  isCluster: boolean
}

export interface ParsedStateEdgeTarget {
  rawId: string
  sourceRawId: string
  targetRawId: string
  sourceLabel: string
  targetLabel: string
  trigger: string
  guard: string | null
  action: string | null
}

interface TextRange {
  from: number
  to: number
}

interface ParsedTransitionLine {
  indent: string
  trigger: string
  guard: string | null
  action: string | null
  destination: string
}

const STATE_HEADER_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\{/m
const DISPLAY_COLOR_RE = /^(\s*)displayColor\s+#[0-9a-fA-F]{6}\s*;$/m

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function blockRangeFrom(code: string, from: number): TextRange | null {
  const braceIndex = code.indexOf('{', from)
  if (braceIndex === -1) return null

  let depth = 0
  for (let i = braceIndex; i < code.length; i++) {
    if (code[i] === '{') depth++
    if (code[i] === '}') {
      depth--
      if (depth === 0) return { from, to: i + 1 }
    }
  }

  return null
}

function findEnclosingStateMachineRange(code: string, index: number): TextRange | null {
  const pattern = /\bstatemachine\s+[A-Za-z_][A-Za-z0-9_]*\b/g
  let match: RegExpExecArray | null
  let best: TextRange | null = null

  while ((match = pattern.exec(code)) !== null) {
    const range = blockRangeFrom(code, match.index)
    if (!range) continue
    if (index < range.from || index > range.to) continue
    if (!best || range.to - range.from < best.to - best.from) best = range
  }

  return best
}

function findEnclosingNamedBlockRange(code: string, index: number, exclude: TextRange): TextRange | null {
  const fallbackPattern = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*)\s*\{/gm
  let match: RegExpExecArray | null
  let best: TextRange | null = null

  while ((match = fallbackPattern.exec(code)) !== null) {
    const range = blockRangeFrom(code, match.index)
    if (!range) continue
    if (index < range.from || index > range.to) continue
    if (range.from === exclude.from && range.to === exclude.to) continue
    if (!best || range.to - range.from < best.to - best.from) best = range
  }

  return best
}

function parseStateHeader(block: string): { indent: string; stateName: string } | null {
  const match = block.match(STATE_HEADER_RE)
  if (!match) return null
  return { indent: match[1], stateName: match[2] }
}

function findStateRange(code: string, target: SvgStateTarget): TextRange | null {
  const parsed = parseStateNodeTarget(target)
  const candidates = [target.rawId, parsed.label, parsed.stateName]

  for (const candidate of candidates) {
    const range = findDiagramRange(code, { name: candidate, kind: 'node' })
    if (range) return range
  }

  return null
}

function updateCodeRange(code: string, range: TextRange, next: string): string {
  return code.slice(0, range.from) + next + code.slice(range.to)
}

function stateBodyIndent(block: string): string | null {
  const parsed = parseStateHeader(block)
  if (!parsed) return null
  return `${parsed.indent}  `
}

function parseTransitionLine(line: string): ParsedTransitionLine | null {
  const match = line.match(/^(\s*)(.+?)(?:\s+(\[[^\]]+\]))?(?:\s*\/\s*(\{.*\}))?\s*->\s*([A-Za-z_][A-Za-z0-9_.]*)\s*;\s*$/)
  if (!match) return null

  return {
    indent: match[1],
    trigger: normalizeWhitespace(match[2]),
    guard: match[3] ? normalizeWhitespace(match[3]) : null,
    action: match[4] ? normalizeWhitespace(match[4]) : null,
    destination: normalizeWhitespace(match[5]),
  }
}

function findTransitionLineRange(
  sourceBlock: string,
  edge: ParsedStateEdgeTarget,
): TextRange | null {
  let offset = 0
  for (const line of sourceBlock.split('\n')) {
    const parsed = parseTransitionLine(line)
    const lineRange = { from: offset, to: offset + line.length }
    offset += line.length + 1

    if (!parsed) continue
    if (parsed.destination !== edge.targetLabel) continue
    if (normalizeWhitespace(parsed.trigger) !== normalizeWhitespace(edge.trigger)) continue
    if ((parsed.guard ?? null) !== (edge.guard ?? null)) continue
    return lineRange
  }

  offset = 0
  for (const line of sourceBlock.split('\n')) {
    const parsed = parseTransitionLine(line)
    const lineRange = { from: offset, to: offset + line.length }
    offset += line.length + 1

    if (!parsed) continue
    if (parsed.destination !== edge.targetLabel) continue
    if (normalizeWhitespace(parsed.trigger) !== normalizeWhitespace(edge.trigger)) continue
    return lineRange
  }

  return null
}

function cleanEmptyBlockLines(code: string): string {
  return code
    .replace(/\{\n(\s*)\n(\s*)\}/g, '{\n$2}')
    .replace(/\{\n(?:\s*\n)+/g, '{\n')
}

function trimClusterPrefix(rawId: string): string {
  if (rawId.startsWith('cluster_')) return rawId.slice('cluster_'.length)
  if (rawId.startsWith('cluster')) return rawId.slice('cluster'.length)
  return rawId
}

function formatAction(action: string | null): string | null {
  if (!action) return null
  const trimmed = normalizeWhitespace(action)
  if (trimmed.length === 0) return null
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  return `{ ${trimmed} }`
}

function buildTransitionLine(
  parsed: ParsedTransitionLine,
  overrides: Partial<Pick<ParsedTransitionLine, 'trigger' | 'guard' | 'action' | 'destination'>>,
): string {
  const trigger = overrides.trigger ?? parsed.trigger
  const guard = overrides.guard === undefined ? parsed.guard : overrides.guard
  const action = overrides.action === undefined ? parsed.action : overrides.action
  const destination = overrides.destination ?? parsed.destination

  const guardPart = guard ? ` ${guard}` : ''
  const actionPart = action ? ` / ${formatAction(action)}` : ''
  return `${parsed.indent}${trigger}${guardPart}${actionPart} -> ${destination};`
}

function replaceInEnclosingStateMachine(
  code: string,
  stateRange: TextRange,
  replacer: (stateMachineCode: string, localStateRange: TextRange) => string | null,
): string | null {
  const stateMachineRange = findEnclosingStateMachineRange(code, stateRange.from)
    ?? findEnclosingNamedBlockRange(code, stateRange.from, stateRange)
  if (!stateMachineRange) return null

  const localStateRange = {
    from: stateRange.from - stateMachineRange.from,
    to: stateRange.to - stateMachineRange.from,
  }
  const stateMachineCode = code.slice(stateMachineRange.from, stateMachineRange.to)
  const nextStateMachineCode = replacer(stateMachineCode, localStateRange)
  if (!nextStateMachineCode) return null

  return code.slice(0, stateMachineRange.from) + nextStateMachineCode + code.slice(stateMachineRange.to)
}

function parseEdgeOrNull(target: SvgStateTarget): ParsedStateEdgeTarget | null {
  try {
    return parseStateEdgeTarget(target)
  } catch {
    return null
  }
}

export function parseStateNodeTarget(target: SvgStateTarget): ParsedStateNodeTarget {
  const isCluster = target.rawId.startsWith('cluster')
  const titleMatch = target.anchorTitle?.match(/^Class .*?, SM state, State ([^\r\n]+)/)
  const label = titleMatch?.[1]?.trim() || trimClusterPrefix(target.rawId)
  const stateName = label.split(/[._]/).slice(-1)[0]?.trim() || label

  return {
    rawId: target.rawId,
    label,
    stateName,
    isCluster,
  }
}

export function parseStateEdgeTarget(target: SvgStateTarget): ParsedStateEdgeTarget {
  const [sourceRawId = '', targetRawId = ''] = target.rawId.split('->')
  const lines = (target.anchorTitle ?? '').split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean)
  const firstLine = lines[0] ?? ''
  const match = firstLine.match(/^From\s+(.+?)\s+to\s+(.+?)\s+(.+)$/)

  let sourceLabel = trimClusterPrefix(sourceRawId)
  let targetLabel = trimClusterPrefix(targetRawId)
  let trigger = ''
  if (match) {
    sourceLabel = match[1].trim()
    targetLabel = match[2].trim()
    trigger = match[3].trim()
    if (trigger.startsWith('on ')) trigger = trigger.slice(3).trim()
  }

  const guardMatch = (target.anchorTitle ?? '').match(/(?:^|[\r\n]+)Guard:\s*(.+?)(?:[\r\n]+|$)/)
  const actionMatch = (target.anchorTitle ?? '').match(/Transition Action:\s*([\s\S]+)$/)

  return {
    rawId: target.rawId,
    sourceRawId,
    targetRawId,
    sourceLabel,
    targetLabel,
    trigger,
    guard: guardMatch?.[1]?.trim() || null,
    action: actionMatch ? normalizeWhitespace(actionMatch[1]) : null,
  }
}

export function renameStateInCode(code: string, target: SvgStateTarget, nextName: string): string | null {
  const stateRange = findStateRange(code, target)
  if (!stateRange) return null

  return replaceInEnclosingStateMachine(code, stateRange, (stateMachineCode, localStateRange) => {
    const stateBlock = stateMachineCode.slice(localStateRange.from, localStateRange.to)
    const parsed = parseStateHeader(stateBlock)
    if (!parsed) return null

    const oldName = parsed.stateName
    const namePattern = new RegExp(`\\b${escapeForRegex(oldName)}\\b`, 'g')
    return stateMachineCode.replace(namePattern, nextName)
  })
}

export function deleteStateInCode(code: string, target: SvgStateTarget): string | null {
  const stateRange = findStateRange(code, target)
  if (!stateRange) return null

  return replaceInEnclosingStateMachine(code, stateRange, (stateMachineCode, localStateRange) => {
    const stateBlock = stateMachineCode.slice(localStateRange.from, localStateRange.to)
    const parsed = parseStateHeader(stateBlock)
    if (!parsed) return null

    const node = parseStateNodeTarget(target)
    const destinationCandidates = new Set([parsed.stateName, node.label])

    let nextStateMachineCode = stateMachineCode.slice(0, localStateRange.from) + stateMachineCode.slice(localStateRange.to)
    nextStateMachineCode = nextStateMachineCode
      .split('\n')
      .filter((line) => {
        const transition = parseTransitionLine(line)
        if (!transition) return true
        return !destinationCandidates.has(transition.destination)
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')

    return cleanEmptyBlockLines(nextStateMachineCode)
  })
}

export function addSubstateInCode(code: string, target: SvgStateTarget, stateName: string): string | null {
  const stateRange = findStateRange(code, target)
  if (!stateRange) return null

  const stateBlock = code.slice(stateRange.from, stateRange.to)
  const parsed = parseStateHeader(stateBlock)
  const bodyIndent = stateBodyIndent(stateBlock)
  if (!parsed || !bodyIndent) return null

  const closeIndex = stateBlock.lastIndexOf('}')
  if (closeIndex === -1) return null

  let prefix = stateBlock.slice(0, closeIndex).replace(/[ \t]+$/, '')
  if (!prefix.endsWith('\n')) prefix += '\n'

  const nextBlock = `${prefix}${bodyIndent}${stateName} {\n${bodyIndent}}\n${parsed.indent}}`
  return updateCodeRange(code, stateRange, nextBlock)
}

export function setStateColorInCode(code: string, target: SvgStateTarget, color: string): string | null {
  const stateRange = findStateRange(code, target)
  if (!stateRange) return null

  const stateBlock = code.slice(stateRange.from, stateRange.to)
  const parsed = parseStateHeader(stateBlock)
  const bodyIndent = stateBodyIndent(stateBlock)
  if (!parsed || !bodyIndent) return null

  let nextBlock = stateBlock
  if (DISPLAY_COLOR_RE.test(nextBlock)) {
    nextBlock = nextBlock.replace(DISPLAY_COLOR_RE, `${bodyIndent}displayColor ${color};`)
  } else {
    const openBraceIndex = nextBlock.indexOf('{')
    if (openBraceIndex === -1) return null
    nextBlock = `${nextBlock.slice(0, openBraceIndex + 1)}\n${bodyIndent}displayColor ${color};${nextBlock.slice(openBraceIndex + 1)}`
  }

  return updateCodeRange(code, stateRange, nextBlock)
}

export function addTransitionInCode(
  code: string,
  source: SvgStateTarget,
  trigger: string,
  destination: SvgStateTarget,
): string | null {
  const sourceRange = findStateRange(code, source)
  if (!sourceRange) return null

  const sourceBlock = code.slice(sourceRange.from, sourceRange.to)
  const parsed = parseStateHeader(sourceBlock)
  const bodyIndent = stateBodyIndent(sourceBlock)
  const parsedDestination = parseStateNodeTarget(destination)
  if (!parsed || !bodyIndent) return null

  const closeIndex = sourceBlock.lastIndexOf('}')
  if (closeIndex === -1) return null

  let prefix = sourceBlock.slice(0, closeIndex).replace(/[ \t]+$/, '')
  if (!prefix.endsWith('\n')) prefix += '\n'

  const nextBlock = `${prefix}${bodyIndent}${normalizeWhitespace(trigger)} -> ${parsedDestination.label};\n${parsed.indent}}`
  return updateCodeRange(code, sourceRange, nextBlock)
}

function updateTransitionInCode(
  code: string,
  target: SvgStateTarget,
  overrides: Partial<Pick<ParsedTransitionLine, 'trigger' | 'guard' | 'action' | 'destination'>>,
): string | null {
  const edge = parseEdgeOrNull(target)
  if (!edge) return null

  const sourceRange = findDiagramRange(code, { name: edge.sourceRawId, kind: 'node' })
  if (!sourceRange) return null

  const sourceBlock = code.slice(sourceRange.from, sourceRange.to)
  const lineRange = findTransitionLineRange(sourceBlock, edge)
  if (!lineRange) return null

  const line = sourceBlock.slice(lineRange.from, lineRange.to)
  const parsedLine = parseTransitionLine(line)
  if (!parsedLine) return null

  const nextLine = buildTransitionLine(parsedLine, overrides)
  const nextBlock = sourceBlock.slice(0, lineRange.from) + nextLine + sourceBlock.slice(lineRange.to)
  return updateCodeRange(code, sourceRange, cleanEmptyBlockLines(nextBlock))
}

export function setTransitionTriggerInCode(code: string, target: SvgStateTarget, trigger: string): string | null {
  return updateTransitionInCode(code, target, { trigger: normalizeWhitespace(trigger) })
}

export function setTransitionGuardInCode(code: string, target: SvgStateTarget, guard: string): string | null {
  return updateTransitionInCode(code, target, { guard: normalizeWhitespace(guard) })
}

export function setTransitionActionInCode(code: string, target: SvgStateTarget, action: string): string | null {
  return updateTransitionInCode(code, target, { action: normalizeWhitespace(action) })
}

export function setTransitionDestinationInCode(code: string, target: SvgStateTarget, destination: SvgStateTarget): string | null {
  const parsedDestination = parseStateNodeTarget(destination)
  return updateTransitionInCode(code, target, { destination: parsedDestination.label })
}

export function deleteTransitionInCode(code: string, target: SvgStateTarget): string | null {
  const edge = parseEdgeOrNull(target)
  if (!edge) return null

  const sourceRange = findDiagramRange(code, { name: edge.sourceRawId, kind: 'node' })
  if (!sourceRange) return null

  const sourceBlock = code.slice(sourceRange.from, sourceRange.to)
  const lineRange = findTransitionLineRange(sourceBlock, edge)
  if (!lineRange) return null

  let nextBlock = sourceBlock.slice(0, lineRange.from) + sourceBlock.slice(lineRange.to)
  nextBlock = cleanEmptyBlockLines(nextBlock)
  return updateCodeRange(code, sourceRange, nextBlock)
}
