/**
 * Model list for Zhipu.
 * Uses the shared OpenAI-compatible fetcher. The settings form displays the result.
 */

import { createOpenAICompatibleFetcher } from './openai-compatible'

export const fetchZhipuModels = createOpenAICompatibleFetcher(
  '/api/ai/zhipu/api/paas/v4/models', 'Zhipu',
)
