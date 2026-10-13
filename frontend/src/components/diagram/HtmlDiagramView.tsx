/**
 * Sandboxed iframe for diagram HTML the compiler produced, such as a structure diagram.
 * DiagramPanel uses this when the generate target's output is HTML rather than SVG or React Flow.
 */

import { useMemo } from 'react'
import type { DiagramView } from '../../stores/sessionStore'
import { useIsDark } from '../../hooks/useIsDark'

interface HtmlDiagramViewProps {
  html: string
  viewMode?: DiagramView
}

/** Renders jar HTML output (EventSequence, StateTables, StructureDiagram) in a sandboxed iframe */
export function HtmlDiagramView({ html, viewMode }: HtmlDiagramViewProps) {
  const isDark = useIsDark()

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
</body>
</html>`
  }, [html, isDark, viewMode])

  if (!html) {
    return (
      <div className="p-6 text-ink-faint text-sm font-mono">
        No HTML diagram available. Compile a model to generate one.
      </div>
    )
  }

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="Diagram output"
      className="w-full h-full border-0 bg-surface-0"
      data-testid="html-diagram-iframe"
    />
  )
}
