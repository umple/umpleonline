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

/** Drops whitespace that cannot change meaning, keeping string and character literals
 *  byte for byte so `"a b"` never compares equal to `"ab"`. Umple re-prints guard
 *  expressions from the model, so their spacing rarely survives from the source.
 */
function stripInsignificantWhitespace(value: string): string {
  let result = ''
  let quote: '"' | '\'' | null = null

  for (let i = 0; i < value.length; i++) {
    const char = value[i]

    if (quote) {
      result += char
      if (char === '\\' && i + 1 < value.length) {
        result += value[i + 1]
        i++
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      result += char
      continue
    }

    if (!/\s/.test(char)) result += char
  }

  return result
}

/** Splits `go(String who,Integer n)` into the event name and its argument list. */
function splitTrigger(trigger: string): { name: string; args: string | null } {
  const match = trigger.match(/^([^(]*)\((.*)\)$/)
  return match
    ? { name: match[1].trim(), args: match[2].trim() }
    : { name: trigger.trim(), args: null }
}

/** A trigger pattern that tolerates the spacing Umple drops when it re-prints event
 *  arguments. Only spaces and tabs are allowed to vary, so the pattern can never run
 *  past the end of the line it starts on.
 */
function triggerPatternSource(trigger: string): string {
  const { name, args } = splitTrigger(trigger)
  const escapedName = escapeForRegex(name)
  if (args === null) return escapedName

  const argsPattern = args
    .split(',')
    .map((arg) => arg.trim().split(/\s+/).map(escapeForRegex).join('[ \\t]+'))
    .join('[ \\t]*,[ \\t]*')

  return `${escapedName}[ \\t]*\\([ \\t]*${argsPattern}[ \\t]*\\)`
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

/** Walks `code` from `from`, reporting only positions that are live code: string
 *  literals, character literals and comments are skipped. `depth` counts the braces
 *  open before that character, clamped at zero so the walk can leave the block it
 *  started in. Returning false ends the walk.
 */
function scanCode(
  code: string,
  from: number,
  visit: (position: { index: number; char: string; depth: number }) => boolean | void,
): void {
  let depth = 0
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

    if (visit({ index: i, char, depth }) === false) return

    if (char === '{') depth++
    else if (char === '}' && depth > 0) depth--
  }
}

function findTransitionEnd(code: string, from: number): number | null {
  let end: number | null = null

  scanCode(code, from, ({ index, char, depth }) => {
    if (char === ';' && depth === 0) {
      end = index + 1
      return false
    }
  })

  return end
}

/** The brace depth at which a block's own declarations sit: just inside its opening
 *  brace, or the top level when the range is a bare line with no block at all.
 */
function ownDeclarationDepth(block: string): number {
  let own = 0

  scanCode(block, 0, ({ char, depth }) => {
    if (char === '{') {
      own = depth + 1
      return false
    }
  })

  return own
}

/** Brace depth at each of the given indices, measured from the start of `block`. */
function braceDepthsAt(block: string, indices: number[]): Map<number, number> {
  const wanted = new Set(indices)
  const depths = new Map<number, number>()

  scanCode(block, 0, ({ index, depth }) => {
    if (wanted.has(index)) depths.set(index, depth)
  })

  return depths
}

/** Destination spellings the source may use for this transition, most qualified first.
 *  Umple reprints the destination as a full dotted path, while the source is free to
 *  abbreviate it; a transition declared inside `ss2.s1` as `-> s2;` resolves to
 *  `ss1.s2` when that is the first `s2` in the machine, so an abbreviation cannot be
 *  constrained to the enclosing superstate. Only trailing suffixes of the real target
 *  path are offered, never a name taken from anywhere else, and the search is confined
 *  to the source state's own block.
 */
function getDestinationCandidates(targetLabel: string): string[] {
  const segments = targetLabel.split('.')
  const candidates: string[] = []

  for (let drop = 0; drop < segments.length; drop++) {
    const candidate = segments.slice(drop).join('.')
    if (candidate.length > 0) candidates.push(candidate)
  }

  return candidates
}

function triggerMatchesCandidate(candidate: string, trigger: string): boolean {
  // An automatic transition has no trigger; the scan already anchored the candidate.
  if (trigger.length === 0) return true

  const pattern = new RegExp(`^[ \\t]*${triggerPatternSource(trigger)}(?=[ \\t]|\\[|\\/|\\-|$)`)
  return pattern.test(candidate)
}

/** The transition's own guard expression, brackets included, or null when it has none.
 *  Only the bracketed group that precedes the arrow counts: a bracket inside the
 *  event's argument list, inside a transition action, or inside a string literal is
 *  not the guard.
 */
function extractCandidateGuard(candidate: string): string | null {
  let parenDepth = 0
  let bracketDepth = 0
  let start = -1
  let end = -1

  scanCode(candidate, 0, ({ index, char, depth }) => {
    if (start === -1) {
      // An action body is nested in braces, so anything inside one is not the guard.
      if (depth > 0) return
      if (char === '(') parenDepth++
      else if (char === ')' && parenDepth > 0) parenDepth--
      else if (parenDepth === 0) {
        if (char === '[') {
          start = index
          bracketDepth = 1
        } else if (char === '-' && candidate[index + 1] === '>') {
          // The arrow ends the region a guard could occupy.
          return false
        }
      }
      return
    }

    if (char === '[') bracketDepth++
    else if (char === ']') {
      bracketDepth--
      if (bracketDepth === 0) {
        end = index + 1
        return false
      }
    }
  })

  return start !== -1 && end !== -1 ? candidate.slice(start, end) : null
}

function guardMatchesCandidate(candidate: string, guard: string): boolean {
  const candidateGuard = extractCandidateGuard(candidate)
  if (candidateGuard === null) return false

  if (normalizeWhitespace(candidateGuard) === normalizeWhitespace(guard)) return true

  // Umple reprints guard expressions, so compare again with the spacing that cannot
  // change meaning removed. String literals keep their contents, so `"a b"` still
  // differs from `"ab"`.
  return stripInsignificantWhitespace(candidateGuard) === stripInsignificantWhitespace(guard)
}

function transitionMatchesCandidate(
  candidate: string,
  transition: ParsedStateEdgeSelection,
  destination: string,
): boolean {
  if (!triggerMatchesCandidate(candidate, transition.trigger)) return false

  // `\s*` rather than `[ \t]*` so a destination on its own line still matches; the
  // pattern stays bounded by `->` and `;`.
  const destinationPattern = new RegExp(`->\\s*${escapeForRegex(destination)}\\s*;`)
  if (!destinationPattern.test(candidate)) return false

  if (transition.guard && !guardMatchesCandidate(candidate, transition.guard)) return false

  return true
}

/** Every statement in the block that starts with this trigger's event name.
 *  Scanning on the name alone collects the event's overloads too, so
 *  `transitionMatchesCandidate` can tell them apart instead of the scan missing them.
 */
function collectTransitionRanges(stateBlock: string, trigger: string): TextRange[] {
  const { name } = splitTrigger(trigger)
  const scanPattern = name.length > 0
    ? new RegExp(`^[ \\t]*${escapeForRegex(name)}(?=[ \\t]|\\[|\\/|\\-|\\(|$)`, 'gm')
    : /^[ \t]*(?=(?:\[[^\n]*\]\s*)?(?:\/|->))/gm

  const ranges: TextRange[] = []
  let match: RegExpExecArray | null
  while ((match = scanPattern.exec(stateBlock)) !== null) {
    const to = findTransitionEnd(stateBlock, match.index)
    if (to) ranges.push({ from: match.index, to })

    // The automatic-transition pattern matches the indentation and then looks ahead,
    // so an unindented transition matches empty and leaves lastIndex where it is.
    // Step past it, or exec would return the same position forever.
    if (scanPattern.lastIndex === match.index) scanPattern.lastIndex++
  }

  // A transition belongs to the state that declares it, so only this block's own
  // declarations may answer for it. Nested substate bodies are excluded: the diagram
  // stays clickable while it regenerates, and a stale superstate identity must not
  // reach into a substate for a transition the superstate never declared.
  const own = ownDeclarationDepth(stateBlock)
  const depths = braceDepthsAt(stateBlock, ranges.map((range) => range.from))

  return ranges.filter((range) => depths.get(range.from) === own)
}

function findStateTransitionRangeWithin(
  stateBlock: string,
  transition: ParsedStateEdgeSelection,
): TextRange | null {
  const ranges = collectTransitionRanges(stateBlock, transition.trigger)
  const destinations = getDestinationCandidates(transition.targetLabel)

  const candidateMatches = (range: TextRange, destination: string) =>
    transitionMatchesCandidate(stateBlock.slice(range.from, range.to), transition, destination)

  // Under the hideGuards suboption the metadata carries no guard at all, so a guard in
  // the source cannot be checked against it. If more than one candidate is guarded,
  // the metadata genuinely cannot name one of them and the destination spelling must
  // not be left to choose, so nothing is reported.
  if (!transition.guard) {
    const guarded = ranges.filter(
      (range) =>
        destinations.some((destination) => candidateMatches(range, destination)) &&
        extractCandidateGuard(stateBlock.slice(range.from, range.to)) !== null,
    )

    if (guarded.length > 1) return null
  }

  // The guard is part of the transition's identity, while the destination spelling is
  // only a notation the source chose, so the guard is always enforced and the
  // destination forms are tried from the most qualified down. A guard the metadata
  // does not carry is not enforced at all: the state diagram omits it under the
  // hideGuards suboption even when the source transition is guarded.
  for (const destination of destinations) {
    const matches = ranges.filter((range) => candidateMatches(range, destination))

    // Stop at the first form that fits anything: a less qualified destination must
    // never override a more qualified one, and an ambiguous fit must not fall through
    // to a looser rule that would pick one of the candidates by accident. Several fits
    // means the metadata cannot name one of them, so nothing is reported rather than
    // the wrong line.
    if (matches.length > 0) return matches.length === 1 ? matches[0] : null
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
