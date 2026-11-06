/**
 * Fetches Anthropic's model list for the AI settings form.
 * models.ts calls this when the selected provider is Anthropic. The request goes through the backend proxy.
 */

import type { ModelInfo } from '../models'

interface AnthropicModel {
  id: string
  display_name: string
  max_input_tokens: number
  max_tokens: number
  created_at: string
}

// Anthropic doesn't expose pricing via API — maintain manually.
// https://docs.anthropic.com/en/docs/about-claude/pricing
const PRICING: Record<string, { prompt: number; completion: number }> = {
  'claude-opus-4-6':   { prompt: 5, completion: 25 },
  'claude-sonnet-4-6': { prompt: 3, completion: 15 },
  'claude-haiku-4-5':  { prompt: 1, completion: 5 },
}

function matchPricing(id: string) {
  for (const [prefix, price] of Object.entries(PRICING)) {
    if (id.startsWith(prefix)) return price
  }
  return undefined
}

export async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('/api/ai/anthropic/v1/models?limit=100', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })
  if (!res.ok) throw new Error(`Anthropic models: ${res.status}`)

  const { data } = (await res.json()) as { data: AnthropicModel[] }

  return data.map((m) => ({
    id: m.id,
    name: m.display_name,
    contextLength: m.max_input_tokens,
    maxOutput: m.max_tokens,
    pricing: matchPricing(m.id),
  }))
}
