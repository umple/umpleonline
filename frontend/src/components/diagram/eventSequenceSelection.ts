import type { DiagramSelectDetail } from '../editor/diagramSelection'

/** Marker that every bridge message from the Event Sequence iframe must carry. */
export const EVENT_SEQUENCE_MESSAGE_SOURCE = 'umple-event-sequence'

/** Separator the Umple compiler uses between `data-transition` fields. */
const TRANSITION_FIELD_SEPARATOR = '*^*'

/** `<h2>Class Garage state machine sm</h2>` precedes every Event Sequence section. */
const HEADING_PATTERN = /^Class\s+(\S+)\s+state machine\s+(\S+)$/

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface EventSequenceTransitionMessage {
  source: typeof EVENT_SEQUENCE_MESSAGE_SOURCE
  kind: 'transition'
  /** Raw `data-transition` value emitted by the compiler. */
  transitionId: string
}

export interface EventSequenceStateMessage {
  source: typeof EVENT_SEQUENCE_MESSAGE_SOURCE
  kind: 'state'
  /** Text of the `<h2>` heading owning the clicked section. */
  heading: string
  /** Dotted state path, e.g. `ss1.s2`. */
  dottedState: string
}

export type EventSequenceMessage = EventSequenceTransitionMessage | EventSequenceStateMessage

/** Narrows an untrusted `MessageEvent.data` to a bridge message. */
export function isEventSequenceMessage(data: unknown): data is EventSequenceMessage {
  if (typeof data !== 'object' || data === null) return false

  const candidate = data as Record<string, unknown>
  if (candidate.source !== EVENT_SEQUENCE_MESSAGE_SOURCE) return false

  if (candidate.kind === 'transition') {
    return typeof candidate.transitionId === 'string'
  }

  if (candidate.kind === 'state') {
    return typeof candidate.heading === 'string' && typeof candidate.dottedState === 'string'
  }

  return false
}

/** Joins a dotted Umple state path into the underscore form `findDiagramRange` resolves. */
function toNodeName(className: string, smName: string, dottedState: string): string | null {
  const segments = [className, smName, ...dottedState.split('.')].map((segment) => segment.trim())
  if (segments.some((segment) => !IDENTIFIER_PATTERN.test(segment))) return null
  return segments.join('_')
}

function parseHeading(heading: string): { className: string; smName: string } | null {
  const match = HEADING_PATTERN.exec(heading.trim())
  return match ? { className: match[1], smName: match[2] } : null
}

function toTransitionDetail(transitionId: string): DiagramSelectDetail | null {
  const fields = transitionId.split(TRANSITION_FIELD_SEPARATOR)
  if (fields.length < 6) return null

  const [className, smName, trigger, fromState, toState] = fields
  // The guard is the trailing field and the only one that can itself contain the
  // separator, so everything past field five belongs to it.
  const guard = fields.slice(5).join(TRANSITION_FIELD_SEPARATOR).trim()

  const sourceName = toNodeName(className, smName, fromState)
  const targetName = toNodeName(className, smName, toState)
  if (!sourceName || !targetName) return null

  // Rebuild the Graphviz transition tooltip that `parseStateEdgeSelection` reads.
  // `EventSequenceGenerator.extractTransitionId` and the state diagram's
  // `getTriggerDescription` spell the trigger identically, so the two agree.
  let anchorTitle = `From ${fromState} to ${toState}`
  if (trigger === '') anchorTitle += ' automatically'
  else if (trigger.startsWith('after(')) anchorTitle += ` ${trigger}`
  else anchorTitle += ` on ${trigger}`
  if (guard) anchorTitle += `\nGuard: ${guard}`

  return { name: `${sourceName}->${targetName}`, kind: 'edge', anchorTitle }
}

function toStateDetail(message: EventSequenceStateMessage): DiagramSelectDetail | null {
  const heading = parseHeading(message.heading)
  if (!heading) return null

  const name = toNodeName(heading.className, heading.smName, message.dottedState)
  return name ? { name, kind: 'node' } : null
}

/** Translates a bridge message into the detail `umple:diagram-select` already carries.
 *  Returns null for metadata that cannot be resolved, so a malformed message selects
 *  nothing rather than the wrong source range.
 */
export function toDiagramSelectDetail(message: EventSequenceMessage): DiagramSelectDetail | null {
  return message.kind === 'transition'
    ? toTransitionDetail(message.transitionId)
    : toStateDetail(message)
}
