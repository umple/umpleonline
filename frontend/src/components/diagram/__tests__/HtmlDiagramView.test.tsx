// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { HtmlDiagramView } from '../HtmlDiagramView'
import { EVENT_SEQUENCE_MESSAGE_SOURCE } from '../eventSequenceSelection'
import type { DiagramSelectDetail } from '../../editor/diagramSelection'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// A reduced Event Sequence document: the cell classes and data-parent values are the
// ones the compiler emits, but the surrounding markup is cut down. These tests drive
// the parent-side listener with messages directly, so only the view mode matters here.
// Real generated markup is exercised by tests/e2e/event-sequence-selection.spec.ts.
const EVENT_SEQUENCE_HTML = `
<h2>Class Garage state machine sm</h2>
<div class="event-sequence-grid">
  <div id="wrapper0" class="wrapper">
    <div class="floating-col"><table>
      <tr><td class="row-header first">States</td></tr>
      <tr><td class="row-header" data-parent="">ss1</td></tr>
      <tr><td class="row-header" data-parent="0">- s1</td></tr>
    </table></div>
  </div>
</div>
`

function captureSelections() {
  const details: DiagramSelectDetail[] = []
  const listener = (event: Event) => details.push((event as CustomEvent<DiagramSelectDetail>).detail)
  window.addEventListener('umple:diagram-select', listener)
  return {
    details,
    stop: () => window.removeEventListener('umple:diagram-select', listener),
  }
}

function renderEventSequence() {
  const result = render(<HtmlDiagramView html={EVENT_SEQUENCE_HTML} viewMode="eventSequence" />)
  const iframe = result.container.querySelector('iframe')
  if (!iframe) throw new Error('iframe was not rendered')
  // Guards the sender checks below from passing vacuously.
  expect(iframe.contentWindow).not.toBeNull()
  expect(iframe.contentWindow).not.toBe(window)
  return { ...result, iframe }
}

function sendMessage(source: MessageEventSource | null, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

afterEach(cleanup)

describe('HtmlDiagramView — Event Sequence bridge', () => {
  it('dispatches umple:diagram-select for a valid transition message from its own iframe', () => {
    const { iframe } = renderEventSequence()
    const captured = captureSelections()

    sendMessage(iframe.contentWindow, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'transition',
      transitionId: 'Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*',
    })

    expect(captured.details).toEqual([
      {
        name: 'Garage_sm_ss1_s1->Garage_sm_ss1_s2',
        kind: 'edge',
        anchorTitle: 'From ss1.s1 to ss1.s2 on ev2',
      },
    ])
    captured.stop()
  })

  it('dispatches umple:diagram-select for a valid state message from its own iframe', () => {
    const { iframe } = renderEventSequence()
    const captured = captureSelections()

    sendMessage(iframe.contentWindow, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'state',
      heading: 'Class Garage state machine sm',
      dottedState: 'ss1.s1',
    })

    expect(captured.details).toEqual([{ name: 'Garage_sm_ss1_s1', kind: 'node' }])
    captured.stop()
  })

  it('ignores messages from an unrelated window', () => {
    renderEventSequence()
    const captured = captureSelections()

    sendMessage(window, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'transition',
      transitionId: 'Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*',
    })
    sendMessage(null, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'state',
      heading: 'Class Garage state machine sm',
      dottedState: 'ss1.s1',
    })

    expect(captured.details).toEqual([])
    captured.stop()
  })

  it('ignores unexpected payloads from its own iframe', () => {
    const { iframe } = renderEventSequence()
    const captured = captureSelections()

    for (const data of [
      undefined,
      null,
      'umple-event-sequence',
      { kind: 'transition', transitionId: 'Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*' },
      { source: 'other-frame', kind: 'transition', transitionId: 'Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*' },
      { source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'navigate', url: 'https://example.com' },
      { source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'transition', transitionId: 'not-a-transition-id' },
      { source: EVENT_SEQUENCE_MESSAGE_SOURCE, kind: 'state', heading: 'nonsense', dottedState: 'ss1' },
    ]) {
      sendMessage(iframe.contentWindow, data)
    }

    expect(captured.details).toEqual([])
    captured.stop()
  })

  it('stops listening once unmounted', () => {
    const { iframe, unmount } = renderEventSequence()
    const captured = captureSelections()
    const frameWindow = iframe.contentWindow

    unmount()
    sendMessage(frameWindow, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'state',
      heading: 'Class Garage state machine sm',
      dottedState: 'ss1.s1',
    })

    expect(captured.details).toEqual([])
    captured.stop()
  })

  it('injects the click bridge only for the Event Sequence view', () => {
    const { iframe } = renderEventSequence()
    expect(iframe.getAttribute('srcdoc')).toContain(EVENT_SEQUENCE_MESSAGE_SOURCE)

    for (const viewMode of ['stateTables', 'structure'] as const) {
      cleanup()
      const { container } = render(<HtmlDiagramView html={EVENT_SEQUENCE_HTML} viewMode={viewMode} />)
      const other = container.querySelector('iframe')
      expect(other?.getAttribute('srcdoc')).not.toContain(EVENT_SEQUENCE_MESSAGE_SOURCE)
    }
  })

  it('leaves other HTML diagram types without a selection bridge', () => {
    const { container } = render(<HtmlDiagramView html={EVENT_SEQUENCE_HTML} viewMode="stateTables" />)
    const iframe = container.querySelector('iframe')
    if (!iframe) throw new Error('iframe was not rendered')
    const captured = captureSelections()

    sendMessage(iframe.contentWindow, {
      source: EVENT_SEQUENCE_MESSAGE_SOURCE,
      kind: 'state',
      heading: 'Class Garage state machine sm',
      dottedState: 'ss1.s1',
    })

    expect(captured.details).toEqual([])
    captured.stop()
  })

  it('keeps the iframe sandbox locked down', () => {
    const { iframe } = renderEventSequence()
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
  })
})
