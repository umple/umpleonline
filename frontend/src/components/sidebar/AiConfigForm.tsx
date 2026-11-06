/**
 * Form for the AI provider, API key, and model.
 * The sidebar and the toolbar popover both render it. The choice is stored in preferencesStore.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePreferencesStore, type AiProvider } from '@/stores/preferencesStore'
import { fetchModels, type ModelInfo } from '@/ai/models'
import { Input } from '@/components/ui/input'
import { Combobox, type ComboboxGroup } from '@/components/ui/combobox'
import { Tip } from '@/components/ui/tooltip'
import { Eye, EyeOff, Info, Loader2, RefreshCw } from 'lucide-react'

const PROVIDER_GROUPS: ComboboxGroup[] = [
  {
    label: 'Popular',
    options: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'google', label: 'Gemini' },
      { value: 'openrouter', label: 'OpenRouter' },
    ],
  },
  {
    label: 'Open Source',
    options: [
      { value: 'mistral', label: 'Mistral' },
      { value: 'xai', label: 'xAI Grok' },
      { value: 'groq', label: 'Groq' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'fireworks', label: 'Fireworks' },
      { value: 'cerebras', label: 'Cerebras' },
      { value: 'moonshot', label: 'Kimi (Moonshot)' },
      { value: 'minimax', label: 'Minimax' },
      { value: 'zhipu', label: 'Zhipu GLM' },
    ],
  },
]

/** Shared AI configuration form used by both the sidebar and the toolbar popover. */
export function AiConfigForm() {
  const provider = usePreferencesStore((state) => state.activeProvider)
  const { model, apiKey } = usePreferencesStore((state) => state.configs[state.activeProvider] ?? { apiKey: '', model: '' })
  const setActiveProvider = usePreferencesStore((state) => state.setActiveProvider)
  const setModel = usePreferencesStore((state) => state.setModel)
  const setApiKey = usePreferencesStore((state) => state.setApiKey)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // Track what we last fetched for so we don't re-fetch unnecessarily
  const lastFetchRef = useRef<string>('')

  const loadModels = useCallback(async () => {
    if (!apiKey.trim()) return
    const key = `${provider}:${apiKey}`
    lastFetchRef.current = key
    setLoadingModels(true)
    setModelError(null)
    try {
      const result = await fetchModels(provider, apiKey)
      if (lastFetchRef.current === key) setModels(result)
    } catch {
      if (lastFetchRef.current === key) {
        setModelError('Failed to load models')
        setModels([])
      }
    } finally {
      if (lastFetchRef.current === key) setLoadingModels(false)
    }
  }, [provider, apiKey])

  // Fetch models when provider or apiKey changes (debounced for key typing)
  useEffect(() => {
    lastFetchRef.current = apiKey.trim() ? `${provider}:${apiKey}` : ''

    if (!apiKey.trim()) {
      setModels([])
      setModelError(null)
      return
    }

    const timer = setTimeout(loadModels, 600)
    return () => clearTimeout(timer)
  }, [loadModels])

  // Reset models when provider changes
  useEffect(() => {
    setModels([])
    setModelError(null)
  }, [provider])

  const modelOptions = models.map((m) => {
    let label = m.name || m.id
    if (m.pricing) {
      label += ` ($${m.pricing.prompt}/$${m.pricing.completion})`
    }
    return { value: m.id, label }
  })

  const selectedModel = models.find((m) => m.id === model)
  const modelDetail = selectedModel
    ? [
        selectedModel.contextLength && `${Math.round(selectedModel.contextLength / 1000)}k ctx`,
        selectedModel.maxOutput && `${Math.round(selectedModel.maxOutput / 1000)}k out`,
      ].filter(Boolean).join(' · ')
    : null

  return (
    <div className="flex flex-col gap-2.5">
      <Combobox
        groups={PROVIDER_GROUPS}
        value={provider}
        onSelect={(v) => setActiveProvider(v as AiProvider)}
        placeholder="Select provider..."
        searchPlaceholder="Search providers..."
      />

      <div className="relative">
        <Input
          aria-label="API key"
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key"
          className="pr-12 font-mono"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <Tip content="Your key is proxied through our server but is never stored or logged." side="top">
            <button
              type="button"
              className="p-0.5 text-ink-faint hover:text-ink transition-colors cursor-pointer"
              aria-label="Key security info"
              tabIndex={-1}
            >
              <Info className="size-3" />
            </button>
          </Tip>
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="p-0.5 text-ink-faint hover:text-ink transition-colors cursor-pointer"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            {modelOptions.length > 0 ? (
              <Combobox
                options={modelOptions}
                value={model}
                onSelect={setModel}
                placeholder="Select model..."
                searchPlaceholder="Search models..."
              />
            ) : (
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={loadingModels ? 'Loading models...' : 'Model ID'}
                disabled={loadingModels}
              />
            )}
          </div>
          {apiKey.trim() && (
            <button
              type="button"
              onClick={loadModels}
              disabled={loadingModels}
              className="shrink-0 p-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Refresh models"
            >
              {loadingModels ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
            </button>
          )}
        </div>
        {modelDetail && (
          <p className="mt-1 text-xxs text-ink-faint">{modelDetail}</p>
        )}
        {modelError && (
          <p className="mt-1 text-xxs text-status-error">{modelError}</p>
        )}
      </div>
    </div>
  )
}

