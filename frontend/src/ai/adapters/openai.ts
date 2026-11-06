/**
 * Fetches OpenAI's model list for the AI settings form.
 * models.ts calls this when the selected provider is OpenAI. The request goes through the backend proxy.
 */

import type { ModelInfo } from '../models'

interface OpenAIModel {
  id: string
  created: number
  owned_by: string
}

export async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('/api/ai/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI models: ${res.status}`)

  const { data } = (await res.json()) as { data: OpenAIModel[] }

  return data
    .filter((m) => m.id.startsWith('gpt') || m.id.startsWith('o') || m.id.startsWith('chatgpt'))
    .sort((a, b) => b.created - a.created)
    .map((m) => ({
      id: m.id,
      name: m.id,
    }))
}
