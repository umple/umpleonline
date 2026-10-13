/**
 * Reads filter and mixset declarations out of the Umple text for the class-diagram request.
 * The canvas toolbar edits these, and the diagram request sends them to the backend overlay.
 */

import type { ApiTab } from '@/api/types'

export const CLASS_FILTER_DEFAULT_QUERY = '*'

export interface NamedClassDiagramOverlays {
  namedFilters: string[]
  mixsets: string[]
}

export interface ClassDiagramFilterRequestFields {
  classFilterQuery?: string
  namedFilters?: string[]
  mixsets?: string[]
}

const DECLARATION_RE = /^\s*(mixset|filter)\s+([A-Za-z0-9_-]+)\b/

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

export function normalizeClassFilterQuery(query: string | null | undefined): string {
  const trimmed = (query ?? '').trim()
  if (!trimmed) return CLASS_FILTER_DEFAULT_QUERY
  return trimmed.replace(/\s+/g, ' ')
}

export function isInactiveClassFilterQuery(query: string | null | undefined): boolean {
  return normalizeClassFilterQuery(query) === CLASS_FILTER_DEFAULT_QUERY
}

export function hasTransientClassDiagramFilters(
  query: string | null | undefined,
  namedFilters: readonly string[],
  mixsets: readonly string[],
): boolean {
  return !isInactiveClassFilterQuery(query) || namedFilters.length > 0 || mixsets.length > 0
}

export function buildClassDiagramFilterRequestFields(
  query: string | null | undefined,
  namedFilters: readonly string[],
  mixsets: readonly string[],
): ClassDiagramFilterRequestFields {
  const normalized = normalizeClassFilterQuery(query)
  const fields: ClassDiagramFilterRequestFields = {}

  if (normalized !== CLASS_FILTER_DEFAULT_QUERY) {
    fields.classFilterQuery = normalized
  }
  if (namedFilters.length > 0) {
    fields.namedFilters = [...namedFilters]
  }
  if (mixsets.length > 0) {
    fields.mixsets = [...mixsets]
  }

  return fields
}

export function discoverNamedClassDiagramOverlays(
  tabs: ReadonlyArray<Pick<ApiTab, 'code'>>,
): NamedClassDiagramOverlays {
  const namedFilters = new Set<string>()
  const mixsets = new Set<string>()

  for (const tab of tabs) {
    const code = stripComments(tab.code)
    for (const line of code.split('\n')) {
      const match = line.match(DECLARATION_RE)
      if (!match) continue

      const [, kind, name] = match
      if (kind === 'filter') {
        namedFilters.add(name)
      } else {
        mixsets.add(name)
      }
    }
  }

  return {
    namedFilters: [...namedFilters].sort((left, right) => left.localeCompare(right)),
    mixsets: [...mixsets].sort((left, right) => left.localeCompare(right)),
  }
}
