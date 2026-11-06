/**
 * Model list for Fireworks.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchFireworksModels = createOpenAICompatibleFetcher(
  '/api/ai/fireworks/inference/v1/models', 'Fireworks',
)
