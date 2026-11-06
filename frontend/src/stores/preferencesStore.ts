/**
 * Settings saved in the browser.
 * Theme, dynamic generation, diagram display options, and the AI provider configuration. sessionStore holds the open model instead.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  DISPLAY_PREF_DEFAULTS,
  DISPLAY_PREF_KEYS,
  type DisplayPrefKey,
  type DiagramDisplayPrefs,
  type DiagramView,
  type GvLayoutAlgorithm,
  buildSuboptions,
  getEffectiveDiagramType,
} from '../constants/diagram'

// ── AI Config types ──

export type AiProvider =
  | 'openai' | 'anthropic' | 'google' | 'openrouter'
  | 'mistral' | 'xai' | 'groq' | 'deepseek'
  | 'fireworks' | 'cerebras'
  | 'moonshot' | 'minimax' | 'zhipu'

export interface ProviderConfig {
  apiKey: string
  model: string
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  apiKey: '',
  model: '',
}

const ALL_PROVIDERS: AiProvider[] = [
  'openai', 'anthropic', 'google', 'openrouter',
  'mistral', 'xai', 'groq', 'deepseek',
  'fireworks', 'cerebras', 'moonshot', 'minimax', 'zhipu',
]

export function createDefaultProviderConfigs(): Record<AiProvider, ProviderConfig> {
  return Object.fromEntries(
    ALL_PROVIDERS.map((p) => [p, { ...DEFAULT_PROVIDER_CONFIG }]),
  ) as Record<AiProvider, ProviderConfig>
}

const memoryStorage = (() => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size
    },
  } satisfies Storage
})()

function isStorageLike(value: unknown): value is Storage {
  return !!value
    && typeof (value as Storage).getItem === 'function'
    && typeof (value as Storage).setItem === 'function'
    && typeof (value as Storage).removeItem === 'function'
}

function getBrowserStorage(): Storage {
  if (typeof window !== 'undefined' && isStorageLike(window.localStorage)) {
    return window.localStorage
  }
  if (isStorageLike(globalThis.localStorage)) {
    return globalThis.localStorage
  }
  return memoryStorage
}

export type { DisplayPrefKey, GvLayoutAlgorithm } from '../constants/diagram'

// ── Store ──

interface PreferencesState {
  // Theme
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void

  // Onboarding
  hasSeenWelcome: boolean
  dismissWelcome: () => void

  // Sidebar
  showSidebar: boolean
  toggleSidebar: () => void

  // Compile behavior
  dynamicGeneration: boolean
  setDynamicGeneration: (dynamicGeneration: boolean) => void

  // Diagram display preferences
  showAttributes: boolean
  showMethods: boolean
  showOrthogonalEdges: boolean
  showTraits: boolean
  showActions: boolean
  showTransitionLabels: boolean
  showGuards: boolean
  showGuardLabels: boolean
  showNaturalLanguage: boolean
  showFeatureDependency: boolean
  layoutAlgorithm: GvLayoutAlgorithm
  toggleDisplayPref: (key: DisplayPrefKey) => void
  setLayoutAlgorithm: (algo: GvLayoutAlgorithm) => void

  // AI config
  activeProvider: AiProvider
  configs: Record<AiProvider, ProviderConfig>
  setActiveProvider: (provider: AiProvider) => void
  setModel: (model: string) => void
  setApiKey: (key: string) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),

      // Onboarding
      hasSeenWelcome: false,
      dismissWelcome: () => set({ hasSeenWelcome: true }),

      // Sidebar
      showSidebar: false,
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),

      // Generation behavior
      dynamicGeneration: true,
      setDynamicGeneration: (dynamicGeneration) => set({ dynamicGeneration }),

      // Diagram display preferences (match Umple compiler defaults)
      ...DISPLAY_PREF_DEFAULTS,
      layoutAlgorithm: 'dot',
      toggleDisplayPref: (key) => set((s) => ({ [key]: !s[key] })),
      setLayoutAlgorithm: (layoutAlgorithm) => set({ layoutAlgorithm }),

      // AI config
      activeProvider: 'openai',
      configs: createDefaultProviderConfigs(),
      setActiveProvider: (activeProvider) => set({ activeProvider }),
      setModel: (model) => set((state) => ({
        configs: {
          ...state.configs,
          [state.activeProvider]: {
            ...state.configs[state.activeProvider],
            model,
          },
        },
      })),
      setApiKey: (apiKey) => set((state) => ({
        configs: {
          ...state.configs,
          [state.activeProvider]: {
            ...state.configs[state.activeProvider],
            apiKey,
          },
        },
      })),
    }),
    {
      name: 'umple-preferences-v1',
      version: 4,
      storage: createJSONStorage(getBrowserStorage),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version < 2) {
          return {
            ...state,
            showSidebar: false,
            dynamicGeneration: state.dynamicGeneration ?? state.autoCompile ?? true,
          } as any
        }
        if (version < 3) {
          return {
            ...state,
            dynamicGeneration: state.dynamicGeneration ?? state.autoCompile ?? true,
          } as any
        }
        if (version < 4) {
          return {
            ...state,
            dynamicGeneration: state.dynamicGeneration ?? state.autoCompile ?? true,
          } as any
        }
        return state as any
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        // Only restore keys that partialize stores — stale keys from older
        // schemas (e.g. serialized action names stored as null) would
        // otherwise shadow the real store actions after the spread.
        const DATA_KEYS = [
          'theme',
          'hasSeenWelcome',
          'showSidebar',
          'dynamicGeneration',
          ...DISPLAY_PREF_KEYS,
          'layoutAlgorithm',
          'activeProvider',
          'configs',
        ] as const
        const safe: Record<string, unknown> = {}
        for (const k of DATA_KEYS) {
          if (k in p) safe[k] = p[k]
        }
        const merged = { ...current, ...safe }
        // Backfill any new providers missing from persisted localStorage
        const defaults = createDefaultProviderConfigs()
        const configs = { ...defaults, ...(merged as any).configs }
        return { ...merged, configs } as any
      },
      partialize: (state) => ({
        theme: state.theme,
        hasSeenWelcome: state.hasSeenWelcome,
        showSidebar: state.showSidebar,
        dynamicGeneration: state.dynamicGeneration,
        ...Object.fromEntries(DISPLAY_PREF_KEYS.map((key) => [key, state[key]])),
        layoutAlgorithm: state.layoutAlgorithm,
        activeProvider: state.activeProvider,
        configs: state.configs,
      }),
    }
  )
)

/** Selector that returns a stable key representing all display preferences.
 *  Use as an effect dependency to trigger diagram refresh on pref changes. */
export function selectSuboptionsKey(s: PreferencesState): string {
  return JSON.stringify([
    ...DISPLAY_PREF_KEYS.map((key) => s[key]),
    s.layoutAlgorithm,
  ])
}

export { buildSuboptions, getEffectiveDiagramType }

export function selectDiagramDisplayPrefs(
  s: Pick<PreferencesState, keyof DiagramDisplayPrefs>
): DiagramDisplayPrefs {
  return {
    showAttributes: s.showAttributes,
    showMethods: s.showMethods,
    showOrthogonalEdges: s.showOrthogonalEdges,
    showTraits: s.showTraits,
    showActions: s.showActions,
    showTransitionLabels: s.showTransitionLabels,
    showGuards: s.showGuards,
    showGuardLabels: s.showGuardLabels,
    showNaturalLanguage: s.showNaturalLanguage,
    showFeatureDependency: s.showFeatureDependency,
    layoutAlgorithm: s.layoutAlgorithm,
  }
}

export type { DiagramDisplayPrefs, DiagramView } from '../constants/diagram'
