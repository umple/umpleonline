import { LayoutGrid } from 'lucide-react'

export type DiagramView =
  | 'class'
  | 'state'
  | 'feature'
  | 'structure'
  | 'erd'
  | 'instance'
  | 'eventSequence'
  | 'stateTables'
  | 'crud'

export type DiagramOutputKind = 'gv' | 'html' | 'component'

export type DisplayPrefKey =
  | 'showAttributes'
  | 'showMethods'
  | 'showOrthogonalEdges'
  | 'showTraits'
  | 'showActions'
  | 'showTransitionLabels'
  | 'showGuards'
  | 'showGuardLabels'
  | 'showNaturalLanguage'
  | 'showFeatureDependency'

export interface DiagramDisplayToggle {
  key: DisplayPrefKey
  label: string
  enabledSuboption?: string
  disabledSuboption?: string
}

export interface DiagramViewMode {
  value: DiagramView
  label: string
  longLabel: string
  outputKind: DiagramOutputKind
  diagramType?: string
  legacyDiagramTypes?: string[]
  displayToggles?: DiagramDisplayToggle[]
}

export interface DiagramViewGroup {
  label: string
  modes: DiagramViewMode[]
}

export interface LayoutOption {
  value: 'dot' | 'sfdp' | 'circo' | 'neato' | 'fdp' | 'twopi'
  label: string
  suboption?: string
}

export const LAYOUT_OPTIONS = [
  { value: 'dot', label: 'Dot (default)' },
  { value: 'sfdp', label: 'SFDP', suboption: 'gvsfdp' },
  { value: 'circo', label: 'Circo', suboption: 'gvcirco' },
  { value: 'neato', label: 'Neato', suboption: 'gvneato' },
  { value: 'fdp', label: 'FDP', suboption: 'gvfdp' },
  { value: 'twopi', label: 'Twopi', suboption: 'gvtwopi' },
] as const satisfies readonly LayoutOption[]

export type GvLayoutAlgorithm = (typeof LAYOUT_OPTIONS)[number]['value']

export interface DiagramDisplayPrefs {
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
}

const CLASS_TOGGLES: DiagramDisplayToggle[] = [
  { key: 'showAttributes', label: 'Attributes', disabledSuboption: 'hideattributes' },
  { key: 'showMethods', label: 'Methods', enabledSuboption: 'showmethods' },
  { key: 'showOrthogonalEdges', label: 'Orthogonal Edges', enabledSuboption: 'gvortho' },
  { key: 'showTraits', label: 'Traits' },
]

const STATE_TOGGLES: DiagramDisplayToggle[] = [
  { key: 'showActions', label: 'Actions', disabledSuboption: 'hideactions' },
  { key: 'showTransitionLabels', label: 'Transition Labels', enabledSuboption: 'showtransitionlabels' },
  { key: 'showGuards', label: 'Guards', disabledSuboption: 'hideguards' },
  { key: 'showGuardLabels', label: 'Guard Labels', enabledSuboption: 'showguardlabels' },
  { key: 'showNaturalLanguage', label: 'Natural Language', disabledSuboption: 'hidenaturallanguage' },
]

const FEATURE_TOGGLES: DiagramDisplayToggle[] = [
  { key: 'showFeatureDependency', label: 'Feature Dependency', enabledSuboption: 'showFeatureDependency' },
]

/** Grouped diagram view modes following the legacy UmpleOnline live-view menu.
 *  Editable class view is controlled separately by render mode, so it is not listed here.
 */
export const VIEW_MODE_GROUPS: DiagramViewGroup[] = [
  {
    label: 'Class Views',
    modes: [
      {
        value: 'class',
        label: 'Class',
        longLabel: 'Class Diagram',
        outputKind: 'gv',
        diagramType: 'GvClassDiagram',
        legacyDiagramTypes: ['GvClass', 'class', 'GvClassTrait'],
        displayToggles: CLASS_TOGGLES,
      },
      {
        value: 'erd',
        label: 'Entity Relationship',
        longLabel: 'Entity Relationship Diagram',
        outputKind: 'gv',
        diagramType: 'GvEntityRelationshipDiagram',
        legacyDiagramTypes: ['erd', 'GvEntityRelationshipDiagram'],
      },
      {
        value: 'crud',
        label: 'CRUD UI',
        longLabel: 'CRUD UI',
        outputKind: 'component',
        legacyDiagramTypes: ['crudUI'],
      },
    ],
  },
  {
    label: 'State Views',
    modes: [
      {
        value: 'state',
        label: 'State',
        longLabel: 'State Machine Diagram',
        outputKind: 'gv',
        diagramType: 'GvStateDiagram',
        legacyDiagramTypes: ['state', 'GvState'],
        displayToggles: STATE_TOGGLES,
      },
      {
        value: 'stateTables',
        label: 'State Tables',
        longLabel: 'State Tables Diagram',
        outputKind: 'html',
        diagramType: 'StateTables',
        legacyDiagramTypes: ['stateTables'],
      },
    ],
  },
  {
    label: 'Special Views',
    modes: [
      {
        value: 'structure',
        label: 'Structure',
        longLabel: 'Composite Structure Diagram',
        outputKind: 'html',
        diagramType: 'StructureDiagram',
        legacyDiagramTypes: ['structure', 'structureDiagram'],
      },
      {
        value: 'feature',
        label: 'Feature',
        longLabel: 'Feature Diagram',
        outputKind: 'gv',
        diagramType: 'GvFeatureDiagram',
        legacyDiagramTypes: ['feature', 'GvFeature'],
        displayToggles: FEATURE_TOGGLES,
      },
    ],
  },
  {
    label: 'Instance Views',
    modes: [
      {
        value: 'instance',
        label: 'Instance',
        longLabel: 'Instance Diagram',
        outputKind: 'gv',
        diagramType: 'InstanceDiagram',
        legacyDiagramTypes: ['instanceDiagram'],
      },
      {
        value: 'eventSequence',
        label: 'Event Sequence',
        longLabel: 'Event Sequence Diagram',
        outputKind: 'html',
        diagramType: 'EventSequence',
        legacyDiagramTypes: ['eventSequence'],
      },
    ],
  },
]

export const DIAGRAM_VIEW_ICON = LayoutGrid

export const ALL_VIEW_MODES = VIEW_MODE_GROUPS.flatMap((group) => group.modes)

const VIEW_MODE_BY_VALUE = new Map(ALL_VIEW_MODES.map((mode) => [mode.value, mode]))
const LAYOUT_OPTION_BY_VALUE = new Map(LAYOUT_OPTIONS.map((option) => [option.value, option]))

export const VIEW_OUTPUT_KIND = Object.fromEntries(
  ALL_VIEW_MODES.map((mode) => [mode.value, mode.outputKind] as const)
) as Record<DiagramView, DiagramOutputKind>

export const DISPLAY_TOGGLES = Object.fromEntries(
  ALL_VIEW_MODES.map((mode) => [mode.value, mode.displayToggles ?? []] as const)
) as Record<DiagramView, DiagramDisplayToggle[]>

export const DISPLAY_PREF_DEFAULTS: Record<DisplayPrefKey, boolean> = {
  showAttributes: true,
  showMethods: false,
  showOrthogonalEdges: false,
  showTraits: false,
  showActions: true,
  showTransitionLabels: false,
  showGuards: true,
  showGuardLabels: false,
  showNaturalLanguage: true,
  showFeatureDependency: false,
}

export const DISPLAY_PREF_KEYS = Object.keys(DISPLAY_PREF_DEFAULTS) as DisplayPrefKey[]

const LEGACY_DIAGRAM_TYPE_TO_VIEW = Object.fromEntries(
  ALL_VIEW_MODES.flatMap((mode) =>
    (mode.legacyDiagramTypes ?? []).map((legacyType) => [legacyType, mode.value] as const)
  )
) as Partial<Record<string, DiagramView>>

export function getViewModeOption(view: DiagramView): DiagramViewMode | null {
  return VIEW_MODE_BY_VALUE.get(view) ?? null
}

export function getViewForLegacyDiagramType(diagramType: string): DiagramView | null {
  return LEGACY_DIAGRAM_TYPE_TO_VIEW[diagramType] ?? null
}

export function getLayoutOption(algo: GvLayoutAlgorithm): LayoutOption | null {
  return LAYOUT_OPTION_BY_VALUE.get(algo) ?? null
}

export function buildSuboptions(
  prefs: DiagramDisplayPrefs,
  viewMode: DiagramView,
  isDark: boolean,
): string[] {
  const opts: string[] = []
  const view = getViewModeOption(viewMode)

  for (const toggle of view?.displayToggles ?? []) {
    const enabled = prefs[toggle.key]
    if (toggle.enabledSuboption && enabled) opts.push(toggle.enabledSuboption)
    if (toggle.disabledSuboption && !enabled) opts.push(toggle.disabledSuboption)
  }

  const layoutOption = getLayoutOption(prefs.layoutAlgorithm)
  if (layoutOption?.suboption) {
    opts.push(layoutOption.suboption)
  }

  if (isDark) opts.push('gvdark')

  return opts
}

/** Returns the effective backend diagram type, accounting for the Traits toggle. */
export function getEffectiveDiagramType(viewMode: DiagramView, showTraits: boolean): string {
  if (viewMode === 'class' && showTraits) return 'GvClassTraitDiagram'
  return getViewModeOption(viewMode)?.diagramType ?? 'GvClassDiagram'
}
