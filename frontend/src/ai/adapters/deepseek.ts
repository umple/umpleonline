/**
 * Model list for DeepSeek.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchDeepSeekModels = createOpenAICompatibleFetcher(
  '/api/ai/deepseek/models', 'DeepSeek',
)
