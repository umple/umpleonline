/**
 * Sends a class-diagram edit to POST /api/sync and applies the Umple text that comes back.
 * UmpleDiagram calls this for structural changes. The compiler hook then refreshes the drawing.
 */

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useSessionStore } from '../stores/sessionStore'
import { useEphemeralStore } from '../stores/ephemeralStore'
import { useCollabStore } from '../stores/collabStore'
import { usePreferencesStore } from '../stores/preferencesStore'
import { getYDoc } from './useCollab'
import { replaceYText } from './useCollabTabs'
import { generateAndRefresh } from './useCompiler'
import { getGenerateTargetIdForView } from '../generation/targets'
import { getCompileSourceSnapshot } from '../lib/compileSource'

interface SyncResult {
  success: boolean
  code?: string
  error?: string
}

/**
 * Extracts the sync pattern into a reusable hook.
 * sync(action, params) → api.sync() → editorStore.setCodeFromSync(response.code)
 *
 * Calling setCodeFromSync triggers the existing useCompiler debounce → generateAndRefresh() →
 * diagram updates from backend-authoritative state.
 */
export function useDiagramSync() {
  const inflightRef = useRef(0)
  // Serializes requests that need a modelId: the first request creates the
  // model and subsequent ones wait for it before proceeding.
  const modelIdPromiseRef = useRef<Promise<string> | null>(null)

  const sync = useCallback(async (
    action: string,
    params: Record<string, string>,
  ): Promise<SyncResult> => {
    let modelId = useSessionStore.getState().modelId ?? ''

    // If another request is already creating a model, wait for it
    if (!modelId && modelIdPromiseRef.current) {
      modelId = await modelIdPromiseRef.current
    }

    let ownsGate = false
    let resolveGate: ((id: string) => void) | undefined
    if (!modelId) {
      ownsGate = true
      // First request without a modelId — create a gate for subsequent callers
      modelIdPromiseRef.current = new Promise<string>((r) => {
        resolveGate = r
      })
    }

    inflightRef.current++
    try {
      const response = await api.sync({
        action,
        modelId,
        params,
      })

      // Capture modelId from response if we didn't have one
      if (response.modelId && !modelId) {
        useSessionStore.getState().setModelId(response.modelId)
        resolveGate?.(response.modelId)
        ownsGate = false
        modelIdPromiseRef.current = null
      }

      // Generation gate: if the backend rejected the edit (the mutated
      // model became invalid), do NOT update the code editor. Instead
      // show an error toast and regenerate to revert optimistic UI changes.
      if (response.rejected) {
        const msg = response.errors || 'Edit rejected — the change would produce invalid code'
        toast.error('Invalid edit', { description: simplifyError(msg) })
        // Regenerate from the existing (unchanged) code so the diagram reverts
        // any optimistic node/edge additions or removals.
        generateAndRefresh(resolveIsDark()).catch((e) => console.warn('Revert regeneration failed:', e))
        console.warn(`Diagram sync rejected (${action}):`, msg)
        return { success: false, error: msg }
      }

      // No-op detection: if the edit didn't change the code (e.g. adding
      // a generalization to a class that already has a parent), warn the
      // user and revert any optimistic UI changes.
      if (response.noEffect) {
        toast.warning('Edit had no effect', {
          description: noEffectHint(action),
        })
        generateAndRefresh(resolveIsDark()).catch((e) => console.warn('Revert regeneration failed:', e))
        return { success: false, error: 'no effect' }
      }

      // Apply the code update — the backend reads from the file on disk
      // which reflects the actual state, even when umplesync also produces
      // warnings/errors.
      if (response.code) {
        const session = useSessionStore.getState()
        session.setCodeFromSync(response.code)

        const {
          renderMode,
          rightPanelView,
          markDiagramFresh,
        } = useEphemeralStore.getState()
        const diagramTargetId =
          getGenerateTargetIdForView(session.viewMode) ?? session.generateTargetId

        // In collab mode, also write to Y.Text so the change propagates
        // to other collaborators. The editor effect no longer does this.
        if (useCollabStore.getState().isCollaborating) {
          const doc = getYDoc()
          if (doc) {
            replaceYText(doc.getText(`tab:${session.activeTabId}`), response.code!)
          }
        }

        // Editable class-diagram actions already mutate the visible diagram in-place,
        // so in manual mode they should not immediately mark that same diagram stale.
        if (
          session.viewMode === 'class' &&
          renderMode === 'editable' &&
          rightPanelView === 'diagram' &&
          diagramTargetId
        ) {
          const source = getCompileSourceSnapshot()
          markDiagramFresh(diagramTargetId, {
            code: source.activeCode,
            tabId: source.activeTabId,
            signature: source.signature,
          })
        }
      }

      if (response.errors) {
        useEphemeralStore.getState().setExecutionOutput('', response.errors)
        console.warn(`Diagram sync warning (${action}):`, response.errors)
        return { success: true, code: response.code, error: response.errors }
      }

      return { success: true, code: response.code }
    } catch (err: any) {
      useEphemeralStore.getState().setExecutionOutput('', err.message)
      console.warn(`Diagram sync failed (${action}):`, err.message)
      return { success: false, error: err.message }
    } finally {
      inflightRef.current--
      // If we owned the gate but never resolved it (request failed or
      // no modelId in response), resolve with '' so waiters retry
      // instead of blocking forever.
      if (ownsGate) {
        resolveGate?.('')
        modelIdPromiseRef.current = null
      }
    }
  }, [])

  return { sync }
}

/** Resolve current dark mode state outside of a React hook context. */
function resolveIsDark(): boolean {
  const theme = usePreferencesStore.getState().theme
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return theme === 'dark'
}

/** Provide a hint for why a specific action had no effect. */
function noEffectHint(action: string): string {
  switch (action) {
    case 'addGeneralization':
      return 'The child class may already extend another class (single inheritance)'
    case 'addAssociation':
      return 'This association may already exist between these classes'
    case 'addAttribute':
      return 'An attribute with this name may already exist'
    case 'addMethod':
      return 'A method with this signature may already exist'
    default:
      return 'The model was not changed by this edit'
  }
}

/** Extract a user-friendly message from a raw backend error string. */
function simplifyError(raw: string): string {
  let msg = raw.replace(/^failed to load current model:\s*/i, '')

  // If the error is a JSON compilation result, extract the message fields
  try {
    const parsed = JSON.parse(msg)
    const results = parsed?.results
    if (Array.isArray(results) && results.length > 0) {
      return results.map((r: { message?: string }) => r.message).filter(Boolean).join('; ')
    }
  } catch {
    // not JSON — use as-is
  }

  if (msg.length > 200) msg = msg.slice(0, 200) + '…'
  return msg || 'The change would produce invalid code'
}
