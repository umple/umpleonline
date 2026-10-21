import { describe, expect, it } from 'vitest'

import { getViewForLegacyDiagramType } from './diagram'

describe('getViewForLegacyDiagramType', () => {
  it('maps the diagramtype values accepted by classic UmpleOnline', () => {
    expect(getViewForLegacyDiagramType('class')).toBe('class')
    expect(getViewForLegacyDiagramType('GvClass')).toBe('class')
    expect(getViewForLegacyDiagramType('GvClassTrait')).toBe('class')
    expect(getViewForLegacyDiagramType('state')).toBe('state')
    expect(getViewForLegacyDiagramType('GvState')).toBe('state')
    expect(getViewForLegacyDiagramType('structure')).toBe('structure')
    expect(getViewForLegacyDiagramType('structureDiagram')).toBe('structure')
    expect(getViewForLegacyDiagramType('feature')).toBe('feature')
    expect(getViewForLegacyDiagramType('GvFeature')).toBe('feature')
    expect(getViewForLegacyDiagramType('erd')).toBe('erd')
    expect(getViewForLegacyDiagramType('GvEntityRelationshipDiagram')).toBe('erd')
    expect(getViewForLegacyDiagramType('instanceDiagram')).toBe('instance')
    expect(getViewForLegacyDiagramType('crudUI')).toBe('crud')
    expect(getViewForLegacyDiagramType('stateTables')).toBe('stateTables')
    expect(getViewForLegacyDiagramType('eventSequence')).toBe('eventSequence')
  })

  it('keeps the current view for diagram types without a view mode', () => {
    expect(getViewForLegacyDiagramType('notADiagramType')).toBeNull()
  })
})
