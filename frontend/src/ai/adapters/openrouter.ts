/**
 * Fetches OpenRouter's model list for the AI settings form.
 * models.ts calls this when the selected provider is OpenRouter. The request goes through the backend proxy.
 */

import type { ModelInfo } from '../models'

interface OpenRouterModel {
  id: string
  name: string
  context_length: number
  pricing: {
    prompt: string   // cost per token as string, e.g. "0.000003"
    completion: string
  }
}

export async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('/api/ai/openrouter/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`)

  const { data } = (await res.json()) as { data: OpenRouterModel[] }

  return data.map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    pricing: {
      prompt: parseFloat(m.pricing.prompt) * 1_000_000,
      completion: parseFloat(m.pricing.completion) * 1_000_000,
    },
  }))
}
