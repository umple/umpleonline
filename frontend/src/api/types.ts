// Types matching the Go backend API responses

export interface GenerationRequest {
  code: string;
  modelId?: string;
  language?: string;
  diagramType?: string;
  suboptions?: string[];
  classFilterQuery?: string;
  namedFilters?: string[];
  mixsets?: string[];
  needsLayout?: boolean;
  tabs?: ApiTab[];
  activeTabId?: string;
}

export interface ApiTab {
  id: string;
  name: string;
  code: string;
}

export interface GetModelResponse {
  modelId: string;
  code: string;
  tabs?: ApiTab[];
  activeTabId?: string;
}

export interface GenerationResponse {
  result: string;
  errors?: string;
  modelId: string;
  svg?: string;
  html?: string;
  layout?: GvLayout;
  storedLayout?: StoredLayoutMetadata;
  generatedOutput?: string;
  generatedLanguage?: string;
  generatedKind?: "text" | "html" | "iframe";
  generatedHtml?: string;
  generatedIframeUrl?: string;
  generatedDownloads?: GeneratedArtifact[];
  generatedFiles?: GeneratedCodeFile[];
}

export interface UmpleModel {
  umpleClasses?: UmpleClass[];
  umpleAssociations?: UmpleAssociation[];
  umpleInterfaces?: UmpleInterface[];
}

export interface UmpleClass {
  name: string;
  position?: Position;
  attributes?: UmpleAttribute[];
  methods?: UmpleMethod[];
  isAbstract?: boolean;
  extendsClass?: string;
  implementedInterfaces?: string[];
  displayColor?: string;
}

export interface UmpleAttribute {
  name: string;
  type: string;
  value?: string;
}

export interface UmpleMethod {
  name: string;
  type: string;
  parameters?: string;
  visibility?: string;
}

export interface UmpleAssociation {
  id?: string;
  classOneId?: string;
  classTwoId?: string;
  name?: string;
  multiplicityOne?: string;
  multiplicityTwo?: string;
  roleOne?: string;
  roleTwo?: string;
  isLeftNavigable?: string; // "true" / "false" from Umple JSON
  isRightNavigable?: string;
  isLeftComposition?: string;
  isRightComposition?: string;
  isSymmetricReflexive?: string;
  offsetOnePosition?: Position;
  offsetTwoPosition?: Position;
  end1?: AssociationEnd;
  end2?: AssociationEnd;
}

export interface AssociationEnd {
  className: string;
  multiplicity: string;
  roleName: string;
  isNavigable?: boolean;
}

export interface UmpleInterface {
  name: string;
  position?: Position;
  methods?: UmpleMethod[];
  extendsInterfaces?: string[];
}

export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GvTextLine {
  text: string;
  bold?: boolean;
}

export interface GvPoint {
  x: number;
  y: number;
}

export interface GvNodeLayout {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: string;
  textLines?: GvTextLine[];
}

export interface GvEdgeLayout {
  source: string;
  target: string;
  label?: string;
  headLabel?: string;
  tailLabel?: string;
  points?: GvPoint[];
  labelPos?: GvPoint;
  headLabelPos?: GvPoint;
  tailLabelPos?: GvPoint;
}

export interface GvLayout {
  bboxWidth: number;
  bboxHeight: number;
  nodes: GvNodeLayout[];
  edges?: GvEdgeLayout[];
}

export interface StoredLayoutMetadata {
  hasStoredLayout: boolean;
  nodeNames?: string[];
  associationNames?: string[];
}

export interface DiagramResponse {
  svg: string;
  html?: string;
  layout?: GvLayout;
  storedLayout?: StoredLayoutMetadata;
  errors?: string;
  modelId: string;
}

export interface ExampleEntry {
  id: string;
  name: string;
  label: string;
  filename: string;
}

export type ExampleCategoryId =
  | "class"
  | "state"
  | "structure"
  | "feature"
  | "other";

export type ExampleSetId =
  | "example-set-1"
  | "example-set-2"
  | "example-set-3"
  | "example-set-4"
  | "example-set-5";

export interface ExampleSet {
  id: ExampleSetId;
  label: string;
  categoryId: ExampleCategoryId;
  examples: ExampleEntry[];
}

export interface ExampleResponse {
  id: string;
  name: string;
  label: string;
  code: string;
  modelId?: string;
  setId?: ExampleSetId;
  defaultCategoryId?: ExampleCategoryId;
}

export interface GeneratedArtifact {
  label: string;
  url: string;
  filename?: string;
}

export interface GeneratedCodeFile {
  name: string;
  path: string;
  content: string;
}

export interface GenerateResponse {
  output: string;
  language: string;
  errors?: string;
  modelId?: string;
  kind?: "text" | "html" | "iframe";
  html?: string;
  iframeUrl?: string;
  downloads?: GeneratedArtifact[];
  files?: GeneratedCodeFile[];
}

// CRUD schema types (from POST /api/crud/schema)

export interface CrudSchemaResponse {
  schema: CrudSchema;
  errors?: string;
  modelId: string;
}

export interface CrudSchema {
  classes: CrudClass[];
  enums: CrudEnum[];
}

export interface CrudClass {
  name: string;
  isAbstract: boolean;
  extendsClass?: string;
  attributes: CrudAttribute[];
  associations: CrudAssociation[];
}

export interface CrudAttribute {
  name: string;
  type: string;
  typeKind: "primitive" | "enum" | "class";
  isInherited: boolean;
  inheritedFrom?: string;
}

export interface CrudAssociation {
  targetClass: string;
  roleName: string;
  reverseRoleName: string;
  multiplicity: CrudMultiplicity;
  isNavigable: boolean;
  isComposition: boolean;
  isReflexive?: boolean;
}

export interface CrudMultiplicity {
  min: number;
  max: number; // -1 means unbounded
  raw: string;
}

export interface CrudEnum {
  name: string;
  values: string[];
}

export interface PromoteResponse {
  oldId: string;
  newId: string;
}

export interface StatusSummary {
  status: string;
  compiler: { version?: string; commandsSinceStart?: number; commandsHistorical?: number };
  visits?: number;
  sessions?: number;
  branch?: string;
  commit?: string;
  updatedAt?: string;
}

export interface StatusResponse {
  summary?: StatusSummary;
  status: "ok" | "degraded" | string;
  generatedAt: string;
  uptimeSeconds: number;
  build: Record<string, unknown>;
  release?: Record<string, unknown>;
  process: Record<string, unknown>;
  config: Record<string, unknown>;
  dependencies: Array<Record<string, unknown>>;
  checks: Record<string, Record<string, unknown>>;
  umplesync: Record<string, unknown>;
  services: Record<string, Record<string, unknown>>;
  counters: Record<string, unknown>;
  legacy: Record<string, unknown>;
}

// ── Task types ──

export interface TaskTab {
  name: string;
  code: string;
}

export interface TaskView {
  taskName: string;
  requestorName: string;
  completionURL?: string;
  isExperiment: boolean;
  createdAt: string;
  instructions: string;
  modelCode: string;
  tabs?: TaskTab[];
}

export interface CreateTaskRequest {
  taskName: string;
  requestorName: string;
  completionURL?: string;
  isExperiment: boolean;
  instructions: string;
  modelCode: string;
  tabs?: TaskTab[];
}

export interface UpdateTaskRequest {
  requestorName: string;
  completionURL: string;
  isExperiment: boolean;
  instructions: string;
  modelCode: string;
  tabs?: TaskTab[];
}

export interface ResponseView {
  taskName: string;
  responseId: string;
  submittedAt?: string;
  modelCode: string;
  tabs?: TaskTab[];
}

export interface ResponseSummary {
  responseId: string;
  submittedAt?: string;
}
