/**
 * Shared fetcher for providers that expose an OpenAI-style /v1/models endpoint.
 * The smaller adapter files call createOpenAICompatibleFetcher with their proxy URL.
 */

import type { ModelInfo } from '../models'

interface OpenAICompatibleModel {
  id: string
  created: number
  owned_by: string
  context_window?: number
}

/**
 * Factory for providers that expose an OpenAI-compatible /v1/models endpoint.
 * Covers: Mistral, xAI, Groq, DeepSeek, Fireworks, Cerebras, Moonshot, Zhipu.
 */
export function createOpenAICompatibleFetcher(
  endpoint: string,
  providerName: string,
  options?: {
    mapExtra?: (model: OpenAICompatibleModel) => Partial<ModelInfo>
    filter?: (model: OpenAICompatibleModel) => boolean
  },
) {
  return async (apiKey: string): Promise<ModelInfo[]> => {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`${providerName} models: ${res.status}`)

    const { data } = (await res.json()) as { data: OpenAICompatibleModel[] }

    return data
      .filter(options?.filter ?? (() => true))
      .sort((a, b) => b.created - a.created)
      .map((m) => ({
        id: m.id,
        name: m.id,
        ...options?.mapExtra?.(m),
      }))
  }
}
