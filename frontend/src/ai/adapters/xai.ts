/**
 * Model list for xAI.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchXaiModels = createOpenAICompatibleFetcher(
  '/api/ai/xai/v1/models', 'xAI',
)
