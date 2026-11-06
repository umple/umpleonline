/**
 * Fetches Google's Gemini model list for the AI settings form.
 * models.ts calls this when the selected provider is Google. The request goes through the backend proxy.
 */

import type { ModelInfo } from '../models'

interface GoogleModel {
  name: string           // "models/gemini-2.0-flash"
  displayName: string
  inputTokenLimit: number
  outputTokenLimit: number
  supportedGenerationMethods: string[]
}

export async function fetchGoogleModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('/api/ai/google/v1beta/models?pageSize=100', {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!res.ok) throw new Error(`Google models: ${res.status}`)

  const { models } = (await res.json()) as { models: GoogleModel[] }

  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: m.name.replace('models/', ''),
      name: m.displayName,
      contextLength: m.inputTokenLimit,
      maxOutput: m.outputTokenLimit,
    }))
}
