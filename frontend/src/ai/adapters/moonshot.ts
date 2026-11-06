/**
 * Model list for Moonshot.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchMoonshotModels = createOpenAICompatibleFetcher(
  '/api/ai/moonshot/v1/models', 'Moonshot',
)
