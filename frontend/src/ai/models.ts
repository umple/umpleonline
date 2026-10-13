/**
 * Model list for the selected AI provider.
 * AiConfigForm calls fetchModels. Each provider's adapter lives next to this file.
 */

import type { AiProvider } from '@/stores/preferencesStore'

export interface ModelInfo {
  id: string
  name: string
  contextLength?: number
  maxOutput?: number
  pricing?: { prompt: number; completion: number } // USD per 1M tokens
}

export async function fetchModels(provider: AiProvider, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'openai': {
      const { fetchOpenAIModels } = await import('./adapters/openai')
      return fetchOpenAIModels(apiKey)
    }
    case 'anthropic': {
      const { fetchAnthropicModels } = await import('./adapters/anthropic')
      return fetchAnthropicModels(apiKey)
    }
    case 'google': {
      const { fetchGoogleModels } = await import('./adapters/google')
      return fetchGoogleModels(apiKey)
    }
    case 'openrouter': {
      const { fetchOpenRouterModels } = await import('./adapters/openrouter')
      return fetchOpenRouterModels(apiKey)
    }
    case 'mistral': {
      const { fetchMistralModels } = await import('./adapters/mistral')
      return fetchMistralModels(apiKey)
    }
    case 'xai': {
      const { fetchXaiModels } = await import('./adapters/xai')
      return fetchXaiModels(apiKey)
    }
    case 'groq': {
      const { fetchGroqModels } = await import('./adapters/groq')
      return fetchGroqModels(apiKey)
    }
    case 'deepseek': {
      const { fetchDeepSeekModels } = await import('./adapters/deepseek')
      return fetchDeepSeekModels(apiKey)
    }
    case 'fireworks': {
      const { fetchFireworksModels } = await import('./adapters/fireworks')
      return fetchFireworksModels(apiKey)
    }
    case 'cerebras': {
      const { fetchCerebrasModels } = await import('./adapters/cerebras')
      return fetchCerebrasModels(apiKey)
    }
    case 'moonshot': {
      const { fetchMoonshotModels } = await import('./adapters/moonshot')
      return fetchMoonshotModels(apiKey)
    }
    case 'minimax': {
      const { fetchMinimaxModels } = await import('./adapters/minimax')
      return fetchMinimaxModels(apiKey)
    }
    case 'zhipu': {
      const { fetchZhipuModels } = await import('./adapters/zhipu')
      return fetchZhipuModels(apiKey)
    }
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
