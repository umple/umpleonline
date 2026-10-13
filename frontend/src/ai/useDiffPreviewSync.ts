/**
 * Watches the agent transcript and stores the latest proposed edit.
 * UmpleDiffEditor reads that preview from ephemeralStore while a tool call is in progress.
 */

import { useMemo, useEffect } from 'react'
import { isToolUIPart, getToolName, type UIMessage } from 'ai'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { buildToolCallDiffPreview, type ToolPreviewInfo } from './editPreview'

function getLatestToolPreview(
  messages: UIMessage[],
  currentCode: string,
): ToolPreviewInfo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]
      if (!isToolUIPart(part)) continue
      if (part.state !== 'approval-requested') continue

      const toolName = getToolName(part)
      const result = buildToolCallDiffPreview(part.toolCallId, toolName, part.input, currentCode)
      if (result.preview || result.error) {
        return {
          toolCallId: part.toolCallId,
          ...result,
        }
      }
    }
  }

  return null
}

/**
 * Computes the pending diff preview from agent messages and syncs it
 * to the editor store so UmpleDiffEditor can display it.
 */
export function useDiffPreviewSync(messages: UIMessage[], code: string): ToolPreviewInfo | null {
  const pendingPreview = useMemo(() => getLatestToolPreview(messages, code), [messages, code])
  const diffPreview = useEphemeralStore((s) => s.diffPreview)
  const showDiffPreview = useEphemeralStore((s) => s.showDiffPreview)
  const clearDiffPreview = useEphemeralStore((s) => s.clearDiffPreview)

  useEffect(() => {
    if (!pendingPreview) {
      if (diffPreview) clearDiffPreview()
      return
    }

    if (pendingPreview.error) {
      if (diffPreview?.toolCallId === pendingPreview.toolCallId) {
        clearDiffPreview(pendingPreview.toolCallId)
      }
      return
    }

    const preview = pendingPreview.preview
    if (!preview) return

    if (
      diffPreview?.toolCallId === preview.toolCallId &&
      diffPreview.originalCode === preview.originalCode &&
      diffPreview.proposedCode === preview.proposedCode
    ) {
      return
    }

    showDiffPreview(preview)
  }, [clearDiffPreview, diffPreview, pendingPreview, showDiffPreview])

  return pendingPreview
}
