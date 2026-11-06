/**
 * Shared types for SVG diagram adapters: a click target, a menu action, and the adapter interface.
 * state.ts implements SvgDiagramAdapter. SmartSvgView only depends on this interface.
 */

import type { DiagramView } from '@/constants/diagram'
export interface SvgInteractionTarget {
  kind: 'node' | 'edge'
  rawId: string
  anchorTitle: string | null
}

export interface SvgMenuAction {
  id: string
  label: string
  variant?: 'destructive'
  run(): void | Promise<void>
}

export interface SvgTextInputRequest {
  title: string
  description?: string
  label: string
  defaultValue?: string
  placeholder?: string
  submitLabel?: string
  inputType?: 'text' | 'color'
}

export interface SvgAdapterContext {
  getCode(): string
  replaceCode(next: string): void
  requestTextInput(request: SvgTextInputRequest): Promise<string | null>
  report(message: string): void
}

export interface SvgDiagramAdapter {
  viewMode: DiagramView
  getContextMenuActions(target: SvgInteractionTarget, ctx: SvgAdapterContext): SvgMenuAction[]
}
