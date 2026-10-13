/**
 * Applies the agent's search-and-replace edits and builds the diff shown in the editor.
 * The editCode tool calls applyCodeEdits. useDiffPreviewSync publishes the preview into ephemeralStore.
 */

export interface CodeEdit {
  oldText: string
  newText: string
}

export interface CodeEditResult {
  code: string
  errors: string[]
}

export interface DiffPreviewState {
  toolCallId: string
  toolName: 'editCode' | 'replaceCode'
  title: string
  description: string
  originalCode: string
  proposedCode: string
}

export interface ToolPreviewInfo {
  toolCallId: string
  preview: DiffPreviewState | null
  error: string | null
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0

  let count = 0
  let startIndex = 0

  while (true) {
    const matchIndex = haystack.indexOf(needle, startIndex)
    if (matchIndex === -1) return count
    count += 1
    startIndex = matchIndex + needle.length
  }
}

/** Normalize CRLF → LF so model-produced oldText (always LF) matches CRLF source. */
function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function applyCodeEdits(code: string, edits: CodeEdit[]): CodeEditResult {
  const normalizedCode = normalizeToLF(code)
  let nextCode = normalizedCode
  const errors: string[] = []

  for (const { oldText, newText } of edits) {
    if (!oldText) {
      errors.push('Edit failed: oldText must not be empty')
      continue
    }

    const normalizedOld = normalizeToLF(oldText)
    const normalizedNew = normalizeToLF(newText)
    const occurrences = countOccurrences(nextCode, normalizedOld)

    if (occurrences === 0) {
      errors.push(`String to replace not found in code. Call readEditorCode to get the exact current code, then retry with corrected oldText.\noldText: "${oldText.slice(0, 80)}"`)
      continue
    }

    if (occurrences > 1) {
      errors.push(`Found ${occurrences} matches of oldText, but each edit must match exactly once. Include more surrounding lines to uniquely identify the target.\noldText: "${oldText.slice(0, 80)}"`)
      continue
    }

    nextCode = nextCode.replace(normalizedOld, normalizedNew)
  }

  return {
    code: nextCode,
    errors,
  }
}

export function buildToolCallDiffPreview(
  toolCallId: string,
  toolName: string,
  input: any,
  currentCode: string,
): { preview: DiffPreviewState | null; error: string | null } {
  if (toolName === 'editCode') {
    const edits = Array.isArray(input?.edits) ? input.edits : null
    if (!edits) {
      return { preview: null, error: 'Edit preview is unavailable for this tool call.' }
    }

    const result = applyCodeEdits(currentCode, edits)
    if (result.errors.length > 0) {
      return { preview: null, error: result.errors.join('; ') }
    }

    return {
      preview: {
        toolCallId,
        toolName: 'editCode',
        title: 'Previewing proposed edit',
        description: input?.explanation || 'Review the proposed edit before applying it.',
        originalCode: currentCode,
        proposedCode: result.code,
      },
      error: null,
    }
  }

  if (toolName === 'replaceCode') {
    if (typeof input?.code !== 'string') {
      return { preview: null, error: 'Replacement preview is unavailable for this tool call.' }
    }

    return {
      preview: {
        toolCallId,
        toolName: 'replaceCode',
        title: 'Previewing proposed replacement',
        description: input?.explanation || 'Review the proposed replacement before applying it.',
        originalCode: currentCode,
        proposedCode: input.code,
      },
      error: null,
    }
  }

  return { preview: null, error: null }
}
