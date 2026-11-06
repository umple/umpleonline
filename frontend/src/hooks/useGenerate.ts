/**
 * Switches the Generate target and runs generation immediately.
 * Menu commands use this when the user picks a diagram or language, including when dynamic generation is off.
 */

import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { getGenerateTarget } from '../generation/targets'
import { generateAndRefresh } from './useCompiler'
import { useIsDark } from './useIsDark'
import { useEffectiveDynamicGeneration } from '../lib/effectiveDynamicGeneration'

function selectGenerateTarget(targetId: string) {
  const target = getGenerateTarget(targetId)
  if (!target) return null

  useSessionStore.getState().setGenerateTargetId(target.id)
  return target
}

/** Explicit generate action. Used by commands that should always run generation immediately. */
export function useGenerate() {
  const isDark = useIsDark()

  return useCallback(async (targetId: string) => {
    const target = selectGenerateTarget(targetId)
    if (!target) return

    await generateAndRefresh(isDark, undefined, target.id)
  }, [isDark])
}

/** Target-picker behavior. Respects the dynamic generation preference. */
export function useSelectGenerateTarget() {
  const dynamicGeneration = useEffectiveDynamicGeneration()
  const isDark = useIsDark()

  return useCallback(async (targetId: string) => {
    const target = selectGenerateTarget(targetId)
    if (!target || !dynamicGeneration) return

    await generateAndRefresh(isDark, undefined, target.id)
  }, [dynamicGeneration, isDark])
}
