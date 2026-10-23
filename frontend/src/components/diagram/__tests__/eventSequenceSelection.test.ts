import { describe, expect, it } from 'vitest'
import {
  EVENT_SEQUENCE_MESSAGE_SOURCE,
  isEventSequenceMessage,
  toDiagramSelectDetail,
  type EventSequenceMessage,
} from '../eventSequenceSelection'

// Every `transitionId` and `dottedState` below was taken verbatim from HTML emitted by
// jars/umplesync.jar via `-generate EventSequence`.

function transition(transitionId: string): EventSequenceMessage {
  return { source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'transition', transitionId }
}

function state(heading: string, dottedState: string): EventSequenceMessage {
  return { source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'state', heading, dottedState }
}

describe('isEventSequenceMessage', () => {
  it('accepts well-formed transition and state messages', () => {
    expect(isEventSequenceMessage(transition('Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*'))).toBe(true)
    expect(isEventSequenceMessage(state('Class Garage state machine sm', 'ss1.s1'))).toBe(true)
  })

  it('rejects anything without the bridge marker', () => {
    expect(isEventSequenceMessage({ kind: 'transition', transitionId: 'a*^*b*^*c*^*d*^*e*^*' })).toBe(false)
    expect(isEventSequenceMessage({ source: 'something-else', kind: 'transition', transitionId: 'x' })).toBe(false)
  })

  it('rejects unknown kinds and wrongly typed payloads', () => {
    expect(isEventSequenceMessage({ source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'eval' })).toBe(false)
    expect(isEventSequenceMessage({ source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'transition' })).toBe(false)
    expect(isEventSequenceMessage({ source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'transition', transitionId: 42 })).toBe(false)
    expect(isEventSequenceMessage({ source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'state', heading: 'Class A state machine sm' })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isEventSequenceMessage(null)).toBe(false)
    expect(isEventSequenceMessage(undefined)).toBe(false)
    expect(isEventSequenceMessage('umple-event-sequence')).toBe(false)
  })
})

describe('toDiagramSelectDetail — states', () => {
  it('resolves a top-level state', () => {
    expect(toDiagramSelectDetail(state('Class Oven state machine sm2', 'off'))).toEqual({
      name: 'Oven_sm2_off',
      kind: 'node',
    })
  })

  it('resolves a nested state', () => {
    expect(toDiagramSelectDetail(state('Class Garage state machine sm', 'ss1.s2'))).toEqual({
      name: 'Garage_sm_ss1_s2',
      kind: 'node',
    })
  })

  it('resolves a deeply nested state', () => {
    expect(toDiagramSelectDetail(state('Class Oven state machine sm2', 'warming.inner1.deep1'))).toEqual({
      name: 'Oven_sm2_warming_inner1_deep1',
      kind: 'node',
    })
  })

  it('resolves a superstate', () => {
    expect(toDiagramSelectDetail(state('Class Garage state machine sm', 'ss1'))).toEqual({
      name: 'Garage_sm_ss1',
      kind: 'node',
    })
  })

  it('resolves a Next State destination, preserving its dotted path', () => {
    expect(toDiagramSelectDetail(state('Class Garage state machine sm', 'ss2.s3'))).toEqual({
      name: 'Garage_sm_ss2_s3',
      kind: 'node',
    })
  })

  it('keeps state machines of the same class distinct', () => {
    expect(toDiagramSelectDetail(state('Class A state machine sm1', 'p'))).toEqual({
      name: 'A_sm1_p',
      kind: 'node',
    })
    expect(toDiagramSelectDetail(state('Class A state machine sm2', 'r'))).toEqual({
      name: 'A_sm2_r',
      kind: 'node',
    })
  })

  it('returns null for an unparseable heading', () => {
    expect(toDiagramSelectDetail(state('', 'off'))).toBeNull()
    expect(toDiagramSelectDetail(state('Event sequence ending reason: Visited all states', 'off'))).toBeNull()
    expect(toDiagramSelectDetail(state('Class Oven state machine', 'off'))).toBeNull()
  })

  it('returns null for a state path that is not made of Umple identifiers', () => {
    expect(toDiagramSelectDetail(state('Class Oven state machine sm2', ''))).toBeNull()
    expect(toDiagramSelectDetail(state('Class Oven state machine sm2', 'off.'))).toBeNull()
    expect(toDiagramSelectDetail(state('Class Oven state machine sm2', 'States'))).toEqual({
      name: 'Oven_sm2_States',
      kind: 'node',
    })
  })
})

describe('toDiagramSelectDetail — transitions', () => {
  it('translates a regular event into the Graphviz tooltip form', () => {
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*turnOn*^*off*^*warming*^*'))).toEqual({
      name: 'Oven_sm2_off->Oven_sm2_warming',
      kind: 'edge',
      anchorTitle: 'From off to warming on turnOn',
    })
  })

  it('translates an event with arguments', () => {
    expect(toDiagramSelectDetail(transition('Flow*^*st*^*go(String who,Integer n)*^*a*^*b*^*'))).toEqual({
      name: 'Flow_st_a->Flow_st_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(String who,Integer n)',
    })
  })

  it('translates an automatic transition to "automatically" rather than "on "', () => {
    expect(toDiagramSelectDetail(transition('Flow*^*st*^**^*b*^*c*^*'))).toEqual({
      name: 'Flow_st_b->Flow_st_c',
      kind: 'edge',
      anchorTitle: 'From b to c automatically',
    })
  })

  it('translates a guarded automatic transition', () => {
    expect(toDiagramSelectDetail(transition('Flow*^*st*^**^*c*^*d*^*[n > 1]'))).toEqual({
      name: 'Flow_st_c->Flow_st_d',
      kind: 'edge',
      anchorTitle: 'From c to d automatically\nGuard: [n > 1]',
    })
  })

  it('translates a timed transition without an "on" prefix', () => {
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*after(3)*^*warming.inner1.deep2*^*warming.inner2*^*'))).toEqual({
      name: 'Oven_sm2_warming_inner1_deep2->Oven_sm2_warming_inner2',
      kind: 'edge',
      anchorTitle: 'From warming.inner1.deep2 to warming.inner2 after(3)',
    })
  })

  it('translates a guarded event between nested states', () => {
    expect(
      toDiagramSelectDetail(
        transition('Oven*^*sm2*^*tick*^*warming.inner1.deep1*^*warming.inner1.deep2*^* [temp > 5]'),
      ),
    ).toEqual({
      name: 'Oven_sm2_warming_inner1_deep1->Oven_sm2_warming_inner1_deep2',
      kind: 'edge',
      anchorTitle: 'From warming.inner1.deep1 to warming.inner1.deep2 on tick\nGuard: [temp > 5]',
    })
  })

  it('translates a transition leaving a superstate', () => {
    expect(toDiagramSelectDetail(transition('Garage*^*sm*^*ev4*^*ss1*^*ss2*^*'))).toEqual({
      name: 'Garage_sm_ss1->Garage_sm_ss2',
      kind: 'edge',
      anchorTitle: 'From ss1 to ss2 on ev4',
    })
  })

  it('keeps a separator appearing inside the guard with the guard', () => {
    expect(toDiagramSelectDetail(transition('X*^*sm*^*e*^*a*^*b*^*[p *^* q]'))).toEqual({
      name: 'X_sm_a->X_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on e\nGuard: [p *^* q]',
    })
  })

  it('returns null rather than guessing when metadata is incomplete', () => {
    expect(toDiagramSelectDetail(transition(''))).toBeNull()
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*turnOn*^*off*^*warming'))).toBeNull()
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*turnOn'))).toBeNull()
  })

  it('returns null when a state field is not made of Umple identifiers', () => {
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*turnOn*^**^*warming*^*'))).toBeNull()
    expect(toDiagramSelectDetail(transition('Oven*^*sm2*^*turnOn*^*off*^**^*'))).toBeNull()
    expect(toDiagramSelectDetail(transition('*^*sm2*^*turnOn*^*off*^*warming*^*'))).toBeNull()
  })
})
