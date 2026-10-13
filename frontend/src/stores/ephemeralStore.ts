/**
 * State that lasts for this page view.
 * Compiler issues, generated output, which panes are open, and the AI diff preview. Nothing here is written to local storage.
 */

import { create } from 'zustand'
import type { DiffPreviewState } from '@/ai/editPreview'
import type { GenerateResponse, GeneratedArtifact, GeneratedCodeFile } from '../api/types'
import { useSessionStore } from './sessionStore'
import { usePreferencesStore } from './preferencesStore'

export interface ParsedIssue {
  severity: number
  errorCode: string
  message: string
  line: number
  filename: string
  url: string
}

/** Parse raw error string (possibly multiple JSON objects joined by newlines)
 *  into deduplicated, structured issues.
 *  Umple severity: 1-2 = error, 3-5 = warning. */
function parseIssuesAndRaw(raw: string | null | undefined): {
  issues: ParsedIssue[]
  rawText: string
  errors: number
  warnings: number
} {
  if (!raw) return { issues: [], rawText: '', errors: 0, warnings: 0 }

  const allResults: ParsedIssue[] = []
  const rawLines: string[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      const results = parsed?.results
      if (Array.isArray(results)) {
        for (const r of results) {
          allResults.push({
            severity: Number(r.severity ?? 1),
            errorCode: String(r.errorCode ?? ''),
            message: String(r.message ?? ''),
            line: Number(r.line ?? 0),
            filename: String(r.filename ?? ''),
            url: String(r.url ?? ''),
          })
        }
      } else {
        rawLines.push(trimmed)
      }
    } catch {
      rawLines.push(trimmed)
    }
  }

  // Deduplicate by errorCode + line + message
  const seen = new Set<string>()
  const unique: ParsedIssue[] = []
  for (const issue of allResults) {
    const key = `${issue.errorCode}:${issue.line}:${issue.message}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(issue)
    }
  }

  // Sort: errors first (severity 1-2), then warnings (3-5), then by line number
  unique.sort((a, b) => {
    const aIsErr = a.severity <= 2 ? 0 : 1
    const bIsErr = b.severity <= 2 ? 0 : 1
    if (aIsErr !== bIsErr) return aIsErr - bIsErr
    return a.line - b.line
  })

  const rawText = rawLines.join('\n')
  const errCount = unique.filter((i) => i.severity <= 2).length + (rawText && !unique.length ? 1 : 0)
  const warnCount = unique.filter((i) => i.severity > 2).length

  return { issues: unique, rawText, errors: errCount, warnings: warnCount }
}

type OutputView = 'hidden' | 'strip' | 'panel'

interface EphemeralState {
  // Layout
  showEditor: boolean
  outputView: OutputView
  commandPaletteOpen: boolean
  diagramOnly: boolean
  readOnly: boolean
  rightPanelView: 'diagram' | 'generated'

  // Execution
  executing: boolean
  executionOutput: string
  executionErrors: string | null
  parsedIssues: ParsedIssue[]
  rawErrorText: string
  outputErrorCount: number
  outputWarningCount: number

  // Code generation
  generatedCode: string
  generatedHtml: string
  generatedKind: 'text' | 'html' | 'iframe'
  generatedIframeUrl: string | null
  generatedDownloads: GeneratedArtifact[]
  generatedFiles: GeneratedCodeFile[]
  generatedTargetId: string
  generatedLanguage: string
  generatedSourceCode: string | null
  generatedSourceTabId: string | null
  generatedSourceSignature: string | null
  generatingCode: boolean
  generatedError: string | null
  generationRequested: boolean
  generationSuspendedByError: boolean
  generationErrorSourceCode: string | null
  generationErrorSourceTabId: string | null
  generationErrorSourceSignature: string | null

  // Diagram ephemeral
  diagramSourceCode: string | null
  diagramSourceTabId: string | null
  diagramSourceSignature: string | null
  diagramTargetId: string | null
  renderMode: 'editable' | 'graphviz'
  selectedNodeId: string | null
  selectedEdgeId: string | null
  editingNodeId: string | null
  editingField: 'name' | 'newAttribute' | 'newMethod' | null
  generatingOutput: boolean

  // Editor ephemeral
  diffPreview: DiffPreviewState | null
  pendingEditorJump: { tabId: string; line: number } | null
  selection: { fromLine: number; toLine: number; text: string; coords?: { x: number; yTop: number; yBottom: number } } | null

  // LSP
  lspConnected: boolean

  // Agent message queue
  pendingAgentMessage: string | null

  // Onboarding tour
  tourStep: number | null
  startTour: () => void
  setTourStep: (step: number | null) => void
  finishTour: () => void

  // Layout actions
  toggleEditor: () => void
  setOutputView: (view: OutputView) => void
  toggleOutputPanel: () => void
  openCommandPalette: () => void
  openExamplesPalette: () => void
  closeCommandPalette: () => void
  setDiagramOnly: (v: boolean) => void
  setReadOnly: (v: boolean) => void
  setRightPanelView: (view: 'diagram' | 'generated') => void

  // Execution actions
  setExecuting: (executing: boolean) => void
  setExecutionOutput: (output: string, errors?: string | null) => void

  // Code generation actions
  setGeneratedOutput: (
    result: GenerateResponse,
    targetId: string,
    source: { code: string; tabId: string; signature: string },
  ) => void
  markGenerationErrored: (source: { code: string; tabId: string; signature: string }) => void
  clearGenerationError: () => void
  setGeneratingCode: (generating: boolean, targetId?: string) => void
  setGeneratedError: (error: string | null) => void
  clearGenerated: () => void

  // Diagram ephemeral actions
  markDiagramFresh: (targetId: string, source: { code: string; tabId: string; signature: string }) => void
  setRenderMode: (mode: 'editable' | 'graphviz') => void
  setSelectedNode: (id: string | null) => void
  setSelectedEdge: (id: string | null) => void
  setEditing: (nodeId: string | null, field: 'name' | 'newAttribute' | 'newMethod' | null) => void
  setGeneratingOutput: (generatingOutput: boolean) => void


  // LSP actions
  setLspConnected: (connected: boolean) => void

  // Editor ephemeral actions
  showDiffPreview: (preview: DiffPreviewState) => void
  clearDiffPreview: (toolCallId?: string) => void
  requestEditorJump: (jump: { tabId: string; line: number }) => void
  clearPendingEditorJump: () => void
  setSelection: (sel: EphemeralState['selection']) => void

  // Agent message queue actions
  queueAgentMessage: (msg: string) => void
  consumeAgentMessage: () => string | null
}

export const useEphemeralStore = create<EphemeralState>((set, get) => ({
  // Layout
  showEditor: true,
  outputView: 'hidden',
  commandPaletteOpen: false,
  diagramOnly: false,
  readOnly: false,
  rightPanelView: 'diagram',

  // Execution
  executing: false,
  executionOutput: '',
  executionErrors: null,
  parsedIssues: [],
  rawErrorText: '',
  outputErrorCount: 0,
  outputWarningCount: 0,

  // Code generation
  generatedCode: '',
  generatedHtml: '',
  generatedKind: 'text',
  generatedIframeUrl: null,
  generatedDownloads: [],
  generatedFiles: [],
  generatedTargetId: 'Java',
  generatedLanguage: 'Java',
  generatedSourceCode: null,
  generatedSourceTabId: null,
  generatedSourceSignature: null,
  generatingCode: false,
  generatedError: null,
  generationRequested: false,
  generationSuspendedByError: false,
  generationErrorSourceCode: null,
  generationErrorSourceTabId: null,
  generationErrorSourceSignature: null,

  // Diagram ephemeral
  diagramSourceCode: null,
  diagramSourceTabId: null,
  diagramSourceSignature: null,
  diagramTargetId: null,
  renderMode: 'graphviz',
  selectedNodeId: null,
  selectedEdgeId: null,
  editingNodeId: null,
  editingField: null,
  generatingOutput: false,

  // Editor ephemeral
  diffPreview: null,
  pendingEditorJump: null,
  selection: null,

  // LSP
  lspConnected: false,

  // Agent message queue
  pendingAgentMessage: null,

  // Onboarding tour
  tourStep: null,
  startTour: () => {
    usePreferencesStore.getState().dismissWelcome()
    set({ tourStep: 0 })
  },
  setTourStep: (tourStep) => set({ tourStep }),
  finishTour: () => set({ tourStep: null }),

  // Layout actions
  toggleEditor: () => set((s) => ({ showEditor: !s.showEditor })),
  setOutputView: (outputView) => set({ outputView }),
  toggleOutputPanel: () => set((s) => ({ outputView: s.outputView === 'hidden' ? 'panel' : 'hidden' })),
  openCommandPalette: () => set({
    commandPaletteOpen: true,
  }),
  openExamplesPalette: () => set({
    commandPaletteOpen: true,
  }),
  closeCommandPalette: () => set({
    commandPaletteOpen: false,
  }),
  setDiagramOnly: (diagramOnly) => set({ diagramOnly, showEditor: !diagramOnly }),
  setReadOnly: (readOnly) => set({ readOnly }),
  setRightPanelView: (rightPanelView) => set({ rightPanelView }),

  // Execution actions
  setExecuting: (executing) => set({ executing }),
  setExecutionOutput: (executionOutput, executionErrors = null) => {
    const { issues, rawText, errors, warnings } = parseIssuesAndRaw(executionErrors)
    const showAgentPanel = useSessionStore.getState().showAgentPanel
    set((s) => ({
      executionOutput,
      executionErrors,
      parsedIssues: issues,
      rawErrorText: rawText,
      outputErrorCount: errors,
      outputWarningCount: warnings,
      ...(errors > 0 && !showAgentPanel ? { outputView: 'panel' as const } : {}),
    }))
  },

  // Code generation actions
  setGeneratedOutput: (result, generatedTargetId, source) =>
    set({
      generatedCode: result.output ?? '',
      generatedHtml: result.html ?? '',
      generatedKind: result.kind ?? (result.iframeUrl ? 'iframe' : result.html ? 'html' : 'text'),
      generatedIframeUrl: result.iframeUrl ?? null,
      generatedDownloads: result.downloads ?? [],
      generatedFiles: result.files ?? [],
      generatedTargetId,
      generatedLanguage: result.language,
      generatedSourceCode: source.code,
      generatedSourceTabId: source.tabId,
      generatedSourceSignature: source.signature,
      rightPanelView: 'generated',
      generatedError: result.errors ?? null,
    }),
  markGenerationErrored: (source) => set({
    generationSuspendedByError: true,
    generationErrorSourceCode: source.code,
    generationErrorSourceTabId: source.tabId,
    generationErrorSourceSignature: source.signature,
  }),
  clearGenerationError: () => set({
    generationSuspendedByError: false,
    generationErrorSourceCode: null,
    generationErrorSourceTabId: null,
    generationErrorSourceSignature: null,
  }),
  setGeneratingCode: (generatingCode, targetId) => set(generatingCode
    ? { generatingCode, generationRequested: true, ...(targetId ? { generatedTargetId: targetId } : {}) }
    : { generatingCode }
  ),
  setGeneratedError: (generatedError) => set({ generatedError }),
  clearGenerated: () => set({
    generatedCode: '',
    generatedHtml: '',
    generatedKind: 'text',
    generatedIframeUrl: null,
    generatedDownloads: [],
    generatedFiles: [],
    generatedSourceCode: null,
    generatedSourceTabId: null,
    generatedSourceSignature: null,
    generatedError: null,
    rightPanelView: 'diagram',
    generationRequested: false,
    generationSuspendedByError: false,
    generationErrorSourceCode: null,
    generationErrorSourceTabId: null,
    generationErrorSourceSignature: null,
  }),

  // Diagram ephemeral actions
  markDiagramFresh: (diagramTargetId, source) => set({
    diagramTargetId,
    diagramSourceCode: source.code,
    diagramSourceTabId: source.tabId,
    diagramSourceSignature: source.signature,
  }),
  setRenderMode: (renderMode) => set({ renderMode }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setSelectedEdge: (selectedEdgeId) => set({ selectedEdgeId }),
  setEditing: (editingNodeId, editingField) => set({ editingNodeId, editingField }),
  setGeneratingOutput: (generatingOutput) => set({ generatingOutput }),


  // LSP actions
  setLspConnected: (lspConnected) => set((s) => s.lspConnected === lspConnected ? s : { lspConnected }),

  // Editor ephemeral actions
  showDiffPreview: (diffPreview) => set({ diffPreview }),
  clearDiffPreview: (toolCallId) => set((s) => {
    if (toolCallId && s.diffPreview?.toolCallId !== toolCallId) return s
    return { diffPreview: null }
  }),
  requestEditorJump: (pendingEditorJump) => set({ pendingEditorJump }),
  clearPendingEditorJump: () => set({ pendingEditorJump: null }),
  setSelection: (selection) => set({ selection }),

  // Agent message queue actions
  queueAgentMessage: (msg) => set({ pendingAgentMessage: msg }),
  consumeAgentMessage: (): string | null => {
    const msg = get().pendingAgentMessage
    if (msg) set({ pendingAgentMessage: null })
    return msg
  },
}))
