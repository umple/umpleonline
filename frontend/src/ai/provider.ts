/**
 * Creates the AI SDK model for the provider the user picked.
 * Every provider is reached through /api/ai so the browser talks to our backend, which forwards to the vendor.
 */

import type { LanguageModel } from 'ai'
import type { AiProvider } from '@/stores/preferencesStore'

/**
 * Create the correct AI SDK language model instance for the given provider.
 * Each provider SDK is dynamically imported so only the selected provider's
 * code is loaded — the others stay out of the bundle chunk.
 *
 * All providers route through the backend proxy (`/api/ai/...`) so that
 * API keys never leave the browser directly to third-party origins.
 */
export async function getModel(
  provider: AiProvider,
  model: string,
  apiKey: string,
): Promise<LanguageModel> {
  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({
        apiKey,
        baseURL: '/api/ai/openai/v1',
      }).chat(model)
    }

    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({
        apiKey,
        baseURL: '/api/ai/anthropic',
        headers: { 'anthropic-version': '2023-06-01' },
      }).languageModel(model)
    }

    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({
        apiKey,
        baseURL: '/api/ai/google/v1beta',
      }).languageModel(model)
    }

    case 'openrouter': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({
        apiKey,
        baseURL: '/api/ai/openrouter/v1',
        name: 'openrouter',
      }).chat(model)
    }

    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral')
      return createMistral({
        apiKey,
        baseURL: '/api/ai/mistral/v1',
      }).chat(model)
    }

    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai')
      return createXai({
        apiKey,
        baseURL: '/api/ai/xai/v1',
      }).chat(model)
    }

    case 'groq': {
      const { createGroq } = await import('@ai-sdk/groq')
      return createGroq({
        apiKey,
        baseURL: '/api/ai/groq/openai/v1',
      })(model)
    }

    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return createDeepSeek({
        apiKey,
        baseURL: '/api/ai/deepseek',
      }).languageModel(model)
    }

    case 'fireworks': {
      const { createFireworks } = await import('@ai-sdk/fireworks')
      return createFireworks({
        apiKey,
        baseURL: '/api/ai/fireworks/inference/v1',
      }).languageModel(model)
    }

    case 'cerebras': {
      const { createCerebras } = await import('@ai-sdk/cerebras')
      return createCerebras({
        apiKey,
        baseURL: '/api/ai/cerebras/v1',
      }).chat(model)
    }

    case 'moonshot': {
      const { createMoonshotAI } = await import('@ai-sdk/moonshotai')
      return createMoonshotAI({
        apiKey,
        baseURL: '/api/ai/moonshot/v1',
      }).languageModel(model)
    }

    case 'minimax': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({
        apiKey,
        baseURL: '/api/ai/minimax/anthropic/v1',
      }).languageModel(model)
    }

    case 'zhipu': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({
        apiKey,
        baseURL: '/api/ai/zhipu/api/paas/v4',
        name: 'zhipu',
      }).chat(model)
    }

    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown AI provider: ${_exhaustive}`)
    }
  }
}
