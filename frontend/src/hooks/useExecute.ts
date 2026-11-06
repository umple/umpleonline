/**
 * Runs Execute, and the manual Regenerate used when dynamic generation is paused.
 * The top menu bar calls both hooks.
 */

import { useState, useCallback, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useEphemeralStore } from '../stores/ephemeralStore'
import { useIsDark } from './useIsDark'
import { api } from '../api/client'
import { generateAndRefresh } from './useCompiler'

/** Sends code to the backend execute endpoint (code-exec service). */
export function useExecute() {
  const runningRef = useRef(false)

  const execute = useCallback(async (languageOverride?: string) => {
    if (runningRef.current) return
    runningRef.current = true

    const { setExecutionOutput, setOutputView, setExecuting } = useEphemeralStore.getState()
    setOutputView('panel')
    setExecutionOutput('')
    setExecuting(true)

    const { code, modelId, activeTabId } = useSessionStore.getState()
    const language = languageOverride || useEphemeralStore.getState().generatedLanguage
    try {
      const result = await api.execute({ code, language, activeTabId, modelId: modelId ?? undefined })
      setExecutionOutput(result.output || '', result.errors || null)
    } catch (err: unknown) {
      setExecutionOutput('', err instanceof Error ? err.message : 'Execution failed')
    } finally {
      runningRef.current = false
      setExecuting(false)
    }
  }, [])

  return { execute }
}

/** Triggers an immediate regenerate of the currently selected output target. */
export function useRegenerate() {
  const [regenerating, setRegenerating] = useState(false)
  const regeneratingRef = useRef(false)
  const isDark = useIsDark()

  const regenerate = useCallback(async () => {
    const { generatingOutput, generatingCode } = useEphemeralStore.getState()
    if (regeneratingRef.current || generatingOutput || generatingCode) return
    regeneratingRef.current = true
    setRegenerating(true)

    try {
      const { success } = await generateAndRefresh(isDark)
      if (success) {
        useEphemeralStore.getState().setExecutionOutput('Output regenerated.')
        useEphemeralStore.getState().setOutputView('strip')
      } else {
        // Show strip for warnings-only (errors auto-open panel via setExecutionOutput)
        const { outputWarningCount, outputErrorCount } = useEphemeralStore.getState()
        if (outputWarningCount > 0 && outputErrorCount === 0) {
          useEphemeralStore.getState().setOutputView('strip')
        }
      }
    } catch {
      // generateAndRefresh handles error reporting
    } finally {
      regeneratingRef.current = false
      setRegenerating(false)
    }
  }, [isDark])

  return { regenerate, regenerating }
}
