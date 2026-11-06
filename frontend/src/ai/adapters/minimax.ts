/**
 * Curated MiniMax model list for the AI settings form.
 * MiniMax has no models endpoint we can list, so the ids here are fixed.
 */

import type { ModelInfo } from '../models'

/** Minimax exposes an Anthropic-compatible API; model list is curated. */
const MINIMAX_MODELS: ModelInfo[] = [
  { id: 'MiniMax-Text-01', name: 'MiniMax-Text-01', contextLength: 1_000_000, maxOutput: 4096 },
  { id: 'abab6.5s-chat', name: 'abab6.5s-chat', contextLength: 245_760, maxOutput: 4096 },
  { id: 'abab6.5-chat', name: 'abab6.5-chat', contextLength: 8192, maxOutput: 4096 },
]

export async function fetchMinimaxModels(_apiKey: string): Promise<ModelInfo[]> {
  return MINIMAX_MODELS
}
