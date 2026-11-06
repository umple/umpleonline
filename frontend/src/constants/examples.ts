/**
 * Which example category belongs to which diagram view.
 * Loading an example can switch the canvas to the view that category is meant to show.
 */

import type { ExampleCategoryId } from '../api/types'
import type { DiagramView } from './diagram'

export const EXAMPLE_CATEGORY_LABELS: Record<ExampleCategoryId, string> = {
  class: 'Class Diagrams',
  state: 'State Machines',
  structure: 'Composite Structure',
  feature: 'Feature Diagrams',
  other: 'Other',
}

const DEFAULT_VIEW_BY_EXAMPLE_CATEGORY: Partial<Record<ExampleCategoryId, DiagramView>> = {
  class: 'class',
  state: 'state',
  structure: 'structure',
  feature: 'feature',
}

const VIEW_TO_EXAMPLE_CATEGORIES: Record<DiagramView, ExampleCategoryId[]> = {
  class: ['class'],
  erd: ['class'],
  instance: ['class'],
  crud: ['class'],
  state: ['state'],
  stateTables: ['state'],
  eventSequence: ['state'],
  structure: ['structure'],
  feature: ['feature'],
}

export function getDefaultViewForExampleCategory(categoryId: ExampleCategoryId): DiagramView | null {
  return DEFAULT_VIEW_BY_EXAMPLE_CATEGORY[categoryId] ?? null
}

export function getExampleCategoryIdsForView(view: DiagramView): ExampleCategoryId[] {
  return VIEW_TO_EXAMPLE_CATEGORIES[view] ?? []
}

export function canViewUseExampleCategory(view: DiagramView, categoryId: ExampleCategoryId): boolean {
  return getExampleCategoryIdsForView(view).includes(categoryId)
}
