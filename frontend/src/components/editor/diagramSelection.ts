/**
 * Maps a click on the class or state diagram to a range in the Umple editor.
 * The diagram views call this so selecting a class or state selects its source.
 */

export interface DiagramSelectDetail {
  name: string
  kind: 'node' | 'edge'
  anchorTitle?: string | null
}

interface TextRange {
  from: number
  to: number
}

interface ParsedStateEdgeSelection {
  sourceRawId: string
  targetRawId: string
  targetLabel: string
  trigger: string
  guard: string | null
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripNumericInstanceSuffix(value: string): string {
  return value.replace(/_(\d+)$/, '')
}

function normalizeDiagramLookupToken(value: string): string {
  return value.trim().replace(/^cluster_/, '').replace(/^["']|["']$/g, '')
}

function isNumericCandidate(value: string): boolean {
  return /^\d+$/.test(value)
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => value.length > 0 && !isNumericCandidate(value) && values.indexOf(value) === index)
}

function getUnderscoreCandidates(value: string): string[] {
  const parts = value.split('_').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return []

  const suffixes: string[] = []
  for (let i = 0; i < parts.length; i++) {
    suffixes.push(parts.slice(i).join('_'))
  }

  const prefixes: string[] = []
  for (let i = parts.length - 1; i > 0; i--) {
    prefixes.push(parts.slice(0, i).join('_'))
  }

  return unique([...suffixes, ...prefixes, ...parts])
}

function getLookupCandidates(rawName: string, kind: DiagramSelectDetail['kind']): string[] {
  const tokens = kind === 'edge'
    ? rawName.split(/->|--/).map((token) => token.trim())
    : [rawName.trim()]

  return unique(tokens.flatMap((token) => {
    const normalized = normalizeDiagramLookupToken(token)
    const strippedInstance = stripNumericInstanceSuffix(normalized)
    const parts = normalized.split(/::|\./).map((part) => part.trim()).filter(Boolean)
    const strippedParts = strippedInstance === normalized
      ? []
      : strippedInstance.split(/::|\./).map((part) => part.trim()).filter(Boolean)

    return unique([
      normalized,
      strippedInstance,
      ...parts,
      ...parts.flatMap(getUnderscoreCandidates),
      ...strippedParts,
      ...strippedParts.flatMap(getUnderscoreCandidates),
    ])
  }))
}

function lineRangeAt(code: string, index: number): TextRange {
  const from = code.lastIndexOf('\n', index - 1) + 1
  const to = code.indexOf('\n', index)
  return { from, to: to === -1 ? code.length : to }
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

function rangeFromPattern(code: string, pattern: RegExp): TextRange | null {
  const match = pattern.exec(code)
  if (!match) return null

  const from = match.index
  return blockRangeFrom(code, from) ?? lineRangeAt(code, from)
}

function findDefinitionRange(code: string, name: string): TextRange | null {
  const escaped = escapeForRegex(name)
  const keywordBlock = rangeFromPattern(
    code,
    new RegExp(`\\b(?:associationClass|class|interface|trait|statemachine)\\s+${escaped}(?=\\s|\\{|$)`),
  )
  if (keywordBlock) return keywordBlock

  const namedBlock = rangeFromPattern(
    code,
    new RegExp(`^\\s*(?:final\\s+)?${escaped}(?=\\s*\\{)`, 'm'),
  )
  if (namedBlock) return namedBlock

  const relationLine = rangeFromPattern(
    code,
    new RegExp(`^[^\\n]*\\b${escaped}\\b[^\\n]*(?:--|->|<@>)[^\\n]*;?`, 'm'),
  )
  if (relationLine) return relationLine

  const match = new RegExp(`\\b${escaped}\\b`).exec(code)
  return match ? lineRangeAt(code, match.index) : null
}

function partitionUnderscoreSegments(parts: string[]): string[][] {
  const filtered = parts.map((part) => part.trim()).filter(Boolean)
  if (filtered.length === 0) return []

  const partitions: string[][] = []
  const seen = new Set<string>()

  const walk = (index: number, current: string[]) => {
    if (index === filtered.length) {
      const key = current.join('\u0000')
      if (!seen.has(key)) {
        seen.add(key)
        partitions.push([...current])
      }
      return
    }

    const part = filtered[index]
    if (current.length === 0) {
      walk(index + 1, [part])
      return
    }

    current.push(part)
    walk(index + 1, current)
    current.pop()

    const last = current[current.length - 1]
    current[current.length - 1] = `${last}_${part}`
    walk(index + 1, current)
    current[current.length - 1] = last
  }

  walk(0, [])
  return partitions
}

function getNodeLookupPaths(rawName: string): string[][] {
  const normalized = normalizeDiagramLookupToken(rawName)
  const underscoreParts = normalized.split('_').map((part) => part.trim()).filter(Boolean)
  const partitions = partitionUnderscoreSegments(underscoreParts)
    .filter((path) => path.every((segment) => !isNumericCandidate(segment)))
  const strippedInstance = stripNumericInstanceSuffix(normalized)

  if (strippedInstance !== normalized) {
    partitions.push([strippedInstance])
  }

  return partitions
}

function findDefinitionRangeWithin(code: string, name: string, scope: TextRange): TextRange | null {
  const scopedCode = code.slice(scope.from, scope.to)
  const range = findDefinitionRange(scopedCode, name)
  return range
    ? { from: range.from + scope.from, to: range.to + scope.from }
    : null
}

function findRangeForPath(code: string, path: string[]): TextRange | null {
  let scope: TextRange = { from: 0, to: code.length }
  let match: TextRange | null = null

  for (const segment of path) {
    match = findDefinitionRangeWithin(code, segment, scope)
    if (!match) return null
    scope = match
  }

  return match
}

function parseStateEdgeSelection(detail: DiagramSelectDetail): ParsedStateEdgeSelection | null {
  if (detail.kind !== 'edge' || !detail.anchorTitle) return null

  const [sourceRawId = '', targetRawId = ''] = detail.name.split('->')
  if (!sourceRawId || !targetRawId) return null

  const lines = detail.anchorTitle
    .split(/[\r\n]+/)
    .map(normalizeWhitespace)
    .filter(Boolean)

  const firstLine = lines[0] ?? ''
  const match = firstLine.match(/^From\s+(.+?)\s+to\s+(.+?)\s+(.+)$/)
  if (!match) return null

  let trigger = normalizeWhitespace(match[3])
  if (trigger.startsWith('on ')) trigger = trigger.slice(3).trim()
  if (trigger === 'automatically') trigger = ''

  const guardLine = lines.find((line) => line.startsWith('Guard:'))

  return {
    sourceRawId,
    targetRawId,
    targetLabel: match[2].trim(),
    trigger,
    guard: guardLine ? normalizeWhitespace(guardLine.slice('Guard:'.length)) : null,
  }
}

function findTransitionEnd(code: string, from: number): number | null {
  let braceDepth = 0
  let quote: '"' | '\'' | '`' | null = null
  let lineComment = false
  let blockComment = false

  for (let i = from; i < code.length; i++) {
    const char = code[i]
    const next = code[i + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      i++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      braceDepth++
      continue
    }

    if (char === '}') {
      if (braceDepth > 0) braceDepth--
      continue
    }

    if (char === ';' && braceDepth === 0) return i + 1
  }

  return null
}

function transitionMatchesCandidate(
  candidate: string,
  transition: ParsedStateEdgeSelection,
  requireGuard: boolean,
): boolean {
  const normalized = normalizeWhitespace(candidate)
  if (!normalized.startsWith(transition.trigger)) return false

  const destinationPattern = new RegExp(`->\\s*${escapeForRegex(transition.targetLabel)}\\s*;`)
  if (!destinationPattern.test(candidate)) return false

  if (requireGuard && transition.guard && !normalized.includes(transition.guard)) return false

  return true
}

function findStateTransitionRangeWithin(
  stateBlock: string,
  transition: ParsedStateEdgeSelection,
): TextRange | null {
  const triggerPattern = transition.trigger.length > 0
    ? new RegExp(`^[ \\t]*${escapeForRegex(transition.trigger)}(?=[ \\t]|\\[|\\/|\\-|$)`, 'gm')
    : /^[ \t]*(?=(?:\[[^\n]*\]\s*)?(?:\/|->))/gm

  const matches: TextRange[] = []
  let match: RegExpExecArray | null
  while ((match = triggerPattern.exec(stateBlock)) !== null) {
    const from = match.index
    const to = findTransitionEnd(stateBlock, from)
    if (!to) continue
    matches.push({ from, to })
  }

  for (const range of matches) {
    if (transitionMatchesCandidate(stateBlock.slice(range.from, range.to), transition, true)) {
      return range
    }
  }

  for (const range of matches) {
    if (transitionMatchesCandidate(stateBlock.slice(range.from, range.to), transition, false)) {
      return range
    }
  }

  return null
}

function findStateEdgeRange(code: string, detail: DiagramSelectDetail): TextRange | null {
  const parsed = parseStateEdgeSelection(detail)
  if (!parsed) return null

  const sourceRange = findDiagramRange(code, { name: parsed.sourceRawId, kind: 'node' })
  if (!sourceRange) return null

  const stateBlock = code.slice(sourceRange.from, sourceRange.to)
  const localRange = findStateTransitionRangeWithin(stateBlock, parsed)
  if (!localRange) return null

  return {
    from: sourceRange.from + localRange.from,
    to: sourceRange.from + localRange.to,
  }
}

export function findDiagramRange(code: string, detail: DiagramSelectDetail): TextRange | null {
  if (detail.kind === 'node') {
    for (const path of getNodeLookupPaths(detail.name)) {
      const range = findRangeForPath(code, path)
      if (range) return range
    }
  }

  if (detail.kind === 'edge') {
    const stateEdgeRange = findStateEdgeRange(code, detail)
    if (stateEdgeRange) return stateEdgeRange
  }

  for (const candidate of getLookupCandidates(detail.name, detail.kind)) {
    const range = findDefinitionRange(code, candidate)
    if (range) return range
  }

  return null
}
