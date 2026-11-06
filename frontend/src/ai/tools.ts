/**
 * Tools the Umple AI agent can call against the open model.
 * It can read the buffer, apply a search-and-replace, replace the whole file, or ask the backend to compile.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { useSessionStore } from '@/stores/sessionStore'
import { api } from '@/api/client'
import { applyCodeEdits } from './editPreview'

export const agentTools = {
  readEditorCode: tool({
    description: 'Read the current Umple code in the editor',
    inputSchema: z.object({}),
    execute: async () => {
      return useSessionStore.getState().code
    },
  }),

  editCode: tool({
    description: `Make targeted edits to the Umple code in the editor. Each edit replaces one exact occurrence of oldText with newText.

Usage:
- You MUST call readEditorCode first before editing. Edits will fail if oldText does not exactly match the current code.
- Copy oldText verbatim from readEditorCode output. Never guess or paraphrase — whitespace and indentation must match exactly.
- The edit will FAIL if oldText is not unique. Include more surrounding lines for context to make it unique.
- If an edit fails, call readEditorCode to get the current code, then retry with corrected oldText.
- Prefer small, focused edits. Only batch multiple edits when they are independent and non-overlapping.`,
    inputSchema: z.object({
      edits: z.array(
        z.object({
          oldText: z.string().describe('Exact text to find — must match the current code verbatim'),
          newText: z.string().describe('Text to replace it with'),
        }),
      ),
      explanation: z.string().describe('Brief explanation of what this change does'),
    }),
    needsApproval: true,
    execute: async ({ edits, explanation }) => {
      const { code: currentCode } = useSessionStore.getState()
      const { code, errors } = applyCodeEdits(currentCode, edits)

      if (errors.length > 0) {
        return `Edit failed — ${errors.join('\n')}\n\nCurrent code:\n${currentCode}`
      }

      useSessionStore.getState().setCode(code)
      return `Edit applied: ${explanation}`
    },
  }),

  verifyCode: tool({
    description:
      'Verify the current Umple code and return any validation errors',
    inputSchema: z.object({}),
    execute: async () => {
      const { code, modelId } = useSessionStore.getState()
      const res = await api.generate({ code, modelId: modelId ?? undefined })
      return {
        success: !res.errors,
        errors: res.errors || null,
        modelId: res.modelId,
      }
    },
  }),

  replaceCode: tool({
    description: `Replace the entire code in the editor. You MUST call readEditorCode first.

Prefer editCode for modifying existing code — it shows a targeted diff. Only use replaceCode when the change affects the majority of the code and targeted edits would be impractical (e.g. rewriting from scratch, restructuring the entire file).`,
    inputSchema: z.object({
      code: z.string().describe('The complete new code'),
      explanation: z.string().describe('Brief explanation of what this change does'),
    }),
    needsApproval: true,
    execute: async ({ code, explanation }) => {
      useSessionStore.getState().setCode(code)
      return `Code replaced: ${explanation}`
    },
  }),
}
