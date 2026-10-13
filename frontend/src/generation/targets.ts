/**
 * The Generate menu: each target is a diagram view or a generated language.
 * The toolbar, the compiler hook, and the right-hand pane look targets up by id.
 */

import type { DiagramView } from '../stores/sessionStore'

export interface GenerateTarget {
  id: string
  label: string
  action: 'generate' | 'diagram'
  requestLanguage?: string
  diagramView?: DiagramView
  executable?: boolean
}

export interface GenerateTargetGroup {
  label: string
  targets: GenerateTarget[]
}

function groupContainsDiagram(group: GenerateTargetGroup): boolean {
  return group.targets.some((target) => target.action === 'diagram')
}

function sortGroupTargetsDiagramsFirst(group: GenerateTargetGroup): GenerateTargetGroup {
  if (!groupContainsDiagram(group)) return group

  return {
    ...group,
    targets: [
      ...group.targets.filter((target) => target.action === 'diagram'),
      ...group.targets.filter((target) => target.action !== 'diagram'),
    ],
  }
}

export const GENERATE_TARGET_GROUPS: GenerateTargetGroup[] = [
  {
    label: 'Programming Language Code',
    targets: [
      { id: 'Java', label: 'Java Code', action: 'generate', executable: true },
      { id: 'javadoc', label: 'Java API Doc', action: 'generate' },
      { id: 'Php', label: 'PHP Code', action: 'generate' },
      { id: 'Python', label: 'Python Code', action: 'generate', executable: true },
      { id: 'RTCpp', label: 'C++ Code (Beta)', action: 'generate' },
      { id: 'Ruby', label: 'Ruby Code', action: 'generate' },
      { id: 'Cpp', label: 'C++ Code', action: 'generate' },
      { id: 'SimpleCpp', label: 'Simple C++ (under development)', action: 'generate' },
    ],
  },
  {
    label: 'Data Model Views',
    targets: [
      { id: 'classDiagram', label: 'GraphViz Class Diagram', action: 'diagram', diagramView: 'class' },
      { id: 'entityRelationshipDiagram', label: 'Entity Relationship Diagram (GraphViz SVG)', action: 'diagram', diagramView: 'erd' },
      { id: 'crud', label: 'CRUD User Interface', action: 'diagram', diagramView: 'crud' },
      { id: 'Sql', label: 'Sql', action: 'generate' },
    ],
  },
  {
    label: 'State Model Views',
    targets: [
      { id: 'stateDiagram', label: 'State Diagram (GraphViz SVG)', action: 'diagram', diagramView: 'state' },
      { id: 'StateTables', label: 'State Tables', action: 'diagram', diagramView: 'stateTables' },
    ],
  },
  {
    label: 'Random Instance Views',
    targets: [
      { id: 'instanceDiagram', label: 'Instance Diagram', action: 'diagram', diagramView: 'instance' },
      { id: 'EventSequence', label: 'Event Sequence', action: 'diagram', diagramView: 'eventSequence' },
    ],
  },
  {
    label: 'Formal Methods',
    targets: [
      { id: 'Alloy', label: 'Alloy Model', action: 'generate' },
      { id: 'NuSMV', label: 'NuSMV Model', action: 'generate' },
    ],
  },
  {
    label: 'Other Modeling Notations',
    targets: [
      { id: 'Ecore', label: 'Ecore', action: 'generate' },
      { id: 'TextUml', label: 'TextUml', action: 'generate' },
      { id: 'Papyrus', label: 'Papyrus XMI', action: 'generate' },
      { id: 'Yuml', label: 'Yuml Class Diagram', action: 'generate' },
      { id: 'Mermaid', label: 'Mermaid', action: 'generate' },
      { id: 'Scxml', label: 'Scxml (Experimental)', action: 'generate' },
      { id: 'USE', label: 'USE Model', action: 'generate' },
      { id: 'Json', label: 'Json', action: 'generate' },
      { id: 'Umlet', label: 'Umlet', action: 'generate' },
    ],
  },
  {
    label: 'Special Views',
    targets: [
      { id: 'PlainRequirementsDoc', label: 'Plain Requirements Doc', action: 'generate' },
      { id: 'featureDiagram', label: 'Feature Diagram (GraphViz SVG)', action: 'diagram', diagramView: 'feature' },
      { id: 'StructureDiagram', label: 'Structure Diagram', action: 'diagram', diagramView: 'structure' },
      { id: 'SimpleMetrics', label: 'Simple Metrics', action: 'generate' },
      { id: 'CodeAnalysis', label: 'Code Analysis', action: 'generate' },
      { id: 'UmpleSelf', label: 'Internal Umple Representation', action: 'generate' },
      { id: 'UmpleAnnotaiveToComposition', label: 'Compositional Mixsets from Inline Mixsets', action: 'generate' },
      { id: 'SimulateJava', label: 'Simulate Java', action: 'generate' },
    ],
  },
]

export const GENERATE_TARGETS: GenerateTarget[] = GENERATE_TARGET_GROUPS.flatMap((g) => g.targets)
export const APP_TOOLBAR_GENERATE_TARGET_GROUPS: GenerateTargetGroup[] = [
  ...GENERATE_TARGET_GROUPS.filter(groupContainsDiagram).map(sortGroupTargetsDiagramsFirst),
  ...GENERATE_TARGET_GROUPS.filter((group) => !groupContainsDiagram(group)),
]

const TARGETS_BY_ID = new Map(GENERATE_TARGETS.map((target) => [target.id, target]))
const DIAGRAM_TARGET_IDS_BY_VIEW = new Map(
  GENERATE_TARGETS
    .filter((target) => target.action === 'diagram' && target.diagramView)
    .map((target) => [target.diagramView!, target.id])
)

export function getGenerateTarget(id: string): GenerateTarget | undefined {
  return TARGETS_BY_ID.get(id)
}

export function getGenerateTargetIdForView(view: DiagramView): string | null {
  return DIAGRAM_TARGET_IDS_BY_VIEW.get(view) ?? null
}

export function resolveGenerateRequestLanguage(target: GenerateTarget, viewMode: DiagramView): string {
  if (target.id === 'Mermaid') {
    return viewMode === 'state' ? 'Mermaid.state' : 'Mermaid.class'
  }
  return target.requestLanguage ?? target.id
}
