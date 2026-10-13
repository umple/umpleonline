/**
 * Model list for Mistral.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchMistralModels = createOpenAICompatibleFetcher(
  '/api/ai/mistral/v1/models', 'Mistral',
)
