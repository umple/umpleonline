/**
 * Model list for Cerebras.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchCerebrasModels = createOpenAICompatibleFetcher(
  '/api/ai/cerebras/v1/models', 'Cerebras',
)
