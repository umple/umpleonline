import { useEffect, useMemo, useRef } from 'react'
import type { DiagramView } from '../../stores/sessionStore'
import { useIsDark } from '../../hooks/useIsDark'
import {
  EVENT_SEQUENCE_MESSAGE_SOURCE,
  isEventSequenceMessage,
  toDiagramSelectDetail,
} from './eventSequenceSelection'

interface HtmlDiagramViewProps {
  html: string
  viewMode?: DiagramView
}

// Click delegation injected into the Event Sequence iframe only. The sandbox has no
// allow-same-origin, so the parent cannot read this DOM; the script reports the
// compiler metadata it finds and leaves every interpretation to the parent.
const EVENT_SEQUENCE_BRIDGE_SCRIPT = `
(function () {
  function post(payload) {
    payload.source = '${EVENT_SEQUENCE_MESSAGE_SOURCE}';
    window.parent.postMessage(payload, '*');
  }

  function sectionHeading(element) {
    var section = element.closest('.event-sequence-grid, .event-sequence-list');
    if (!section) return '';
    var node = section.previousElementSibling;
    while (node) {
      if (node.tagName === 'H2') return (node.textContent || '').trim();
      node = node.previousElementSibling;
    }
    return '';
  }

  // Row headers carry a 'data-parent' index into the preceding row headers, so the
  // dotted path has to be rebuilt by walking that chain.
  function stateRowName(cell) {
    var column = cell.closest('.floating-col');
    if (!column) return '';
    var cells = Array.prototype.slice.call(column.querySelectorAll('td'));
    var index = cells.indexOf(cell);
    if (index < 1) return '';

    var names = [];
    for (var i = 1; i < cells.length; i++) {
      var label = (cells[i].textContent || '').replace(/^(?:-\\s+)*/, '').trim();
      var parentIndex = parseInt(cells[i].getAttribute('data-parent'), 10);
      var prefix = isNaN(parentIndex) || typeof names[parentIndex] !== 'string'
        ? ''
        : names[parentIndex] + '.';
      names.push(prefix + label);
    }

    return names[index - 1] || '';
  }

  function nextStateName(cell) {
    var row = cell.closest('tr');
    if (!row || !row.closest('table.event-sequence-list')) return '';
    // The header row labels its columns instead of naming a state.
    if (cell.classList.contains('column-header')) return '';
    var cells = Array.prototype.slice.call(row.querySelectorAll('td'));
    // Only the third column holds a state; the START row's is the initial state.
    if (cells.indexOf(cell) !== 2) return '';
    return (cell.textContent || '').trim();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var transitionCell = target.closest('[data-transition]');
    if (transitionCell) {
      var transitionId = transitionCell.getAttribute('data-transition') || '';
      if (transitionId) post({ kind: 'transition', transitionId: transitionId });
      return;
    }

    var cell = target.closest('td');
    if (!cell) return;

    var dottedState = cell.classList.contains('row-header') && cell.hasAttribute('data-parent')
      ? stateRowName(cell)
      : nextStateName(cell);
    if (!dottedState) return;

    post({ kind: 'state', heading: sectionHeading(cell), dottedState: dottedState });
  });
})();
`

/** Renders jar HTML output (EventSequence, StateTables, StructureDiagram) in a sandboxed iframe */
export function HtmlDiagramView({ html, viewMode }: HtmlDiagramViewProps) {
  const isDark = useIsDark()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isEventSequence = viewMode === 'eventSequence'

  // Bridge Event Sequence clicks to the selection event the editor already handles.
  useEffect(() => {
    if (!isEventSequence) return

    const handler = (event: MessageEvent) => {
      // The sandbox gives the frame an opaque origin, so identify the sender by the
      // window itself rather than by event.origin.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      if (!isEventSequenceMessage(event.data)) return

      const detail = toDiagramSelectDetail(event.data)
      if (!detail) return

      window.dispatchEvent(new CustomEvent('umple:diagram-select', { detail }))
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isEventSequence])

  const srcDoc = useMemo(() => {
    // Use the design-token values so they stay in sync with the main app theme
    const bgColor = isDark ? 'var(--color-surface-0, #1a1a1a)' : 'var(--color-surface-0, #ffffff)'
    const textColor = isDark ? 'var(--color-ink, #e4e2df)' : 'var(--color-ink, #2d2d2c)'
    const borderColor = isDark ? 'var(--color-border, #3a3a3a)' : 'var(--color-border, #d4d0cd)'
    // Derived shades for table headers and backgrounds
    const headerBg = isDark ? '#252525' : '#f5f5f5'

    // Umple's HTML output includes its own <style> blocks with hardcoded light-mode
    // colors (black borders, white/light-gray backgrounds). We inject overrides AFTER
    // the content so they win by source order at equal specificity.
    const darkOverrides = isDark ? `
  /* Override Umple's hardcoded light-mode colors */
  .statetable td,
  .statetable .state-header,
  .statetable .event-header,
  .event-sequence-grid .content-cell,
  .event-sequence-grid .column-header span,
  .event-sequence-grid .floating-col,
  .event-sequence-grid .floating-col td,
  .event-sequence-list td {
    border-color: ${borderColor} !important;
  }
  .statetable .state-header,
  .statetable .event-header {
    background-color: ${headerBg} !important;
  }
  .event-sequence-grid .floating-col td {
    background-color: ${bgColor} !important;
  }
  h1, h2, h3, h4, h5, h6 {
    color: ${textColor};
  }
` : ''

    // Structure diagram: the JS runtime creates SVG elements with hardcoded
    // light-mode colors via setAttribute("fill",...) and inline style strings.
    // Presentation attributes (fill="white") are overridden by regular CSS;
    // inline styles (style="fill: #000000") need !important.
    const structureDarkOverrides = isDark && viewMode === 'structure' ? `
  /* Text: black → light */
  #svgCanvas text {
    fill: ${textColor} !important;
  }

  /* White fills on shapes — both attribute and inline style forms */
  #svgCanvas [fill="white"],
  #svgCanvas [fill="#FFFFFF"],
  #svgCanvas [fill="#fff"],
  #svgCanvas [fill="rgb(255,255,255)"] {
    fill: #252525;
  }
  #svgCanvas [style*="fill: rgb(255"],
  #svgCanvas [style*="fill:rgb(255"] {
    fill: #252525 !important;
  }

  /* Container label highlight: light gray → dark gray (attribute + inline style) */
  #svgCanvas [fill="#e6e6e6"] {
    fill: #383838;
  }
  #svgCanvas [style*="fill:#e6e6e6"],
  #svgCanvas [style*="fill: #e6e6e6"] {
    fill: #383838 !important;
  }

  /* Part highlight: bright cyan → muted teal for dark mode */
  #svgCanvas [fill="#5DBCD2"] {
    fill: #2a7d8d;
  }

  /* Port fills: light yellow → dark-mode yellow */
  #svgCanvas [fill="#FFFFCC"] {
    fill: #3d3920;
  }

  /* Black fills — attribute form (port symbols, arrowheads) */
  #svgCanvas [fill="#000000"]:not(text),
  #svgCanvas [fill="black"]:not(text) {
    fill: #999;
  }

  /* Black fills — inline style form */
  #svgCanvas [style*="fill: #000000"],
  #svgCanvas [style*="fill:#000000"],
  #svgCanvas [style*="fill:black"],
  #svgCanvas [style*="fill: black"],
  #svgCanvas [style*="fill: #222"],
  #svgCanvas [style*="fill:#222"],
  #svgCanvas [style*="fill: #444"],
  #svgCanvas [style*="fill:#444"] {
    fill: #999 !important;
  }

  /* Dark strokes — inline style → lighter for dark bg */
  #svgCanvas [style*="stroke: #000000"],
  #svgCanvas [style*="stroke:#000000"],
  #svgCanvas [style*="stroke: black"],
  #svgCanvas [style*="stroke:black"],
  #svgCanvas [style*="stroke: #222"],
  #svgCanvas [style*="stroke:#222"],
  #svgCanvas [style*="stroke: #444"],
  #svgCanvas [style*="stroke:#444"] {
    stroke: #666 !important;
  }

  /* Dark strokes — attribute form */
  #svgCanvas [stroke="#000000"],
  #svgCanvas [stroke="black"] {
    stroke: #666;
  }

  /* White strokes (containers using this.color default) → subtle border */
  #svgCanvas [style*="stroke: rgb(255"],
  #svgCanvas [style*="stroke:rgb(255"] {
    stroke: #555 !important;
  }
` : ''

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body>${html}
<style>
  body {
    margin: 16px;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    background: ${bgColor};
    color: ${textColor};
  }
  table {
    border-collapse: collapse;
    margin: 8px 0;
  }
  th, td {
    border: 1px solid ${borderColor};
    padding: 4px 8px;
    text-align: left;
  }
  th {
    font-weight: 600;
    background: ${headerBg};
  }
  img { max-width: 100%; }
  ${darkOverrides}
  ${structureDarkOverrides}
</style>
${isEventSequence ? `<script>${EVENT_SEQUENCE_BRIDGE_SCRIPT}</script>` : ''}
</body>
</html>`
  }, [html, isDark, viewMode, isEventSequence])

  if (!html) {
    return (
      <div className="p-6 text-ink-faint text-sm font-mono">
        No HTML diagram available. Compile a model to generate one.
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="Diagram output"
      className="w-full h-full border-0 bg-surface-0"
      data-testid="html-diagram-iframe"
    />
  )
}
