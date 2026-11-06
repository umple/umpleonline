/**
 * State for the object explorer.
 * Holds the compiled schema, the instances the user creates, and the association links between them.
 * ObjectExplorer and the instance diagram read this store.
 */

import { create } from 'zustand'
import { api } from '@/api/client'
import type { CrudSchema, CrudAssociation, CrudAttribute, CrudClass } from '@/api/types'
import { useSessionStore } from './sessionStore'

export interface CrudInstance {
  _id: number
  [key: string]: unknown
}

type AssocKeyInput = string | Pick<
  CrudAssociation,
  'targetClass' | 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'
>

const associationRuntimeIds = new WeakMap<object, string>()
const associationLegacyRuntimeIds = new WeakMap<object, string>()
const standaloneAssociationRuntimeCounts = new Map<string, number>()

/** Stable key for the model input used to fetch a CRUD schema.
 *  Keyed on code only — the modelId is a backend implementation detail
 *  and should not trigger refetches when it changes (e.g. crudModelId
 *  set from a response). */
export function buildCrudSchemaRequestKey(code: string) {
  return code
}

/** Key used to store an association value inside a CrudInstance. */
function buildAssociationBaseSignature(
  assoc: Pick<CrudAssociation, 'targetClass' | 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
) {
  return [
    assoc.targetClass,
    assoc.roleName,
    assoc.reverseRoleName,
    assoc.multiplicity.min,
    assoc.multiplicity.max,
    assoc.isNavigable ? '1' : '0',
    assoc.isComposition ? '1' : '0',
    assoc.isReflexive ? '1' : '0',
  ].join('|')
}

/** Assign deterministic per-schema association identities used for CRUD storage keys.
 *  The current key includes the source class so reloading the same schema yields the
 *  same keys, while the legacy key mirrors the earlier shape-only runtime identity so
 *  imported/session data saved before this fix can still be read and re-keyed. */
export function prepareCrudSchema<T extends CrudSchema | null>(schema: T): T {
  if (!schema) return schema

  const scopedCounts = new Map<string, number>()
  const legacyCounts = new Map<string, number>()

  for (const cls of schema.classes) {
    for (const assoc of cls.associations) {
      const baseSignature = buildAssociationBaseSignature(assoc)
      const scopedKey = `${cls.name}|${baseSignature}`
      const scopedOccurrence = scopedCounts.get(scopedKey) ?? 0
      scopedCounts.set(scopedKey, scopedOccurrence + 1)
      associationRuntimeIds.set(assoc, `${scopedKey}::${scopedOccurrence}`)

      const legacyOccurrence = legacyCounts.get(baseSignature) ?? 0
      legacyCounts.set(baseSignature, legacyOccurrence + 1)
      associationLegacyRuntimeIds.set(assoc, `${baseSignature}::${legacyOccurrence}`)
    }
  }

  return schema
}

export function getAssociationRuntimeIdentity(
  assoc: Pick<CrudAssociation, 'targetClass' | 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
) {
  const cached = associationRuntimeIds.get(assoc)
  if (cached) return cached

  const baseSignature = buildAssociationBaseSignature(assoc)
  const occurrenceIndex = standaloneAssociationRuntimeCounts.get(baseSignature) ?? 0
  standaloneAssociationRuntimeCounts.set(baseSignature, occurrenceIndex + 1)

  const runtimeIdentity = `${baseSignature}::${occurrenceIndex}`
  associationRuntimeIds.set(assoc, runtimeIdentity)
  return runtimeIdentity
}

export function assocKey(input: AssocKeyInput) {
  const identity = typeof input === 'string' ? input : getAssociationRuntimeIdentity(input)
  return `__assoc__${identity}` as const
}

function getAssociationLegacyKeys(input: AssocKeyInput) {
  if (typeof input === 'string') return []

  const currentKey = assocKey(input)
  const keys = new Set<string>()

  const legacyRuntimeIdentity = associationLegacyRuntimeIds.get(input)
  if (legacyRuntimeIdentity) keys.add(`__assoc__${legacyRuntimeIdentity}`)

  const roleOrTargetIdentity = input.roleName || input.targetClass
  if (roleOrTargetIdentity) keys.add(`__assoc__${roleOrTargetIdentity}`)

  keys.delete(currentKey)
  return [...keys]
}

export interface ValidationError {
  field: string     // attribute name or assocKey
  message: string
}

export interface ReconcileResult {
  instances: Record<string, CrudInstance[]>
  adjustments: string[]
}

export interface GlobalValidationResult {
  messages: string[]
  count: number
}

interface CrudState {
  // Schema from backend
  schema: CrudSchema | null
  schemaLoading: boolean
  schemaError: string | null
  schemaRequestKey: string | null
  crudModelId: string | null

  // Instances keyed by class name
  instances: Record<string, CrudInstance[]>
  nextId: number

  // UI
  selectedClass: string | null
  editingInstance: { className: string; instanceId: number | null } | null
  validationErrors: ValidationError[]
  adjustmentMessages: string[]
  globalValidationErrors: string[]
  globalValidationCount: number

  // Actions
  fetchSchema: (code: string, modelId?: string) => Promise<void>
  setSelectedClass: (name: string | null) => void
  createInstance: (className: string, data: Record<string, unknown>) => number
  updateInstance: (className: string, instanceId: number, data: Record<string, unknown>) => void
  deleteInstance: (className: string, instanceId: number) => void
  clearAllInstances: (className: string) => void
  openEditor: (className: string, instanceId: number | null) => void
  closeEditor: () => void
  setValidationErrors: (errors: ValidationError[]) => void
  resetInstances: () => void
  exportJson: () => string
  importJson: (json: string) => boolean
  generateRandomAll: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Get the IDs stored in an association slot (normalises to number[]). */
export function getAssocIds(instance: CrudInstance, assoc: AssocKeyInput): number[] {
  const key = assocKey(assoc)
  let val = instance[key]
  if (val === undefined) {
    for (const legacyKey of getAssociationLegacyKeys(assoc)) {
      if (legacyKey in instance) {
        val = instance[legacyKey]
        break
      }
    }
  }
  if (val === undefined || val === null) return []
  if (Array.isArray(val)) return val as number[]
  if (typeof val === 'number') return [val]
  return []
}

/** Set association IDs on an instance (mutates). */
function setAssocIds(instance: CrudInstance, assoc: AssocKeyInput, ids: number[], max = -1) {
  const key = assocKey(assoc)
  if (ids.length === 0) {
    delete instance[key]
    for (const legacyKey of getAssociationLegacyKeys(assoc)) delete instance[legacyKey]
    return
  }
  instance[key] = max === 1 ? ids[0] : ids
  for (const legacyKey of getAssociationLegacyKeys(assoc)) delete instance[legacyKey]
}

/** Remove a single ID from an association slot on an instance (mutates). */
function removeAssocId(instance: CrudInstance, assoc: AssocKeyInput, targetId: number, max = -1) {
  const ids = getAssocIds(instance, assoc).filter((id) => id !== targetId)
  setAssocIds(instance, assoc, ids, max)
}

function associationEndpointsMatch(
  left: Pick<CrudAssociation, 'targetClass' | 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
  right: Pick<CrudAssociation, 'targetClass' | 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
) {
  return (
    left.targetClass === right.targetClass &&
    left.roleName === right.roleName &&
    left.reverseRoleName === right.reverseRoleName &&
    left.multiplicity.min === right.multiplicity.min &&
    left.multiplicity.max === right.multiplicity.max &&
    left.isNavigable === right.isNavigable &&
    left.isComposition === right.isComposition &&
    Boolean(left.isReflexive) === Boolean(right.isReflexive)
  )
}

function findAssociationSourceClassName(schema: CrudSchema, assoc: CrudAssociation): string | undefined {
  for (const cls of schema.classes) {
    const match = cls.associations.find((candidate) => candidate === assoc || associationEndpointsMatch(candidate, assoc))
    if (match) return cls.name
  }

  return undefined
}

function getAssociationOrdinal(
  associations: CrudAssociation[],
  assoc: CrudAssociation,
  matches: (candidate: CrudAssociation, assoc: CrudAssociation) => boolean,
) {
  let ordinal = 0

  for (const candidate of associations) {
    if (!matches(candidate, assoc)) continue
    if (candidate === assoc) return ordinal
    ordinal++
  }

  return -1
}

export function findReverseAssoc(schema: CrudSchema, assoc: CrudAssociation): CrudAssociation | undefined {
  const targetClass = schema.classes.find((cls) => cls.name === assoc.targetClass)
  if (!targetClass) return undefined

  const sourceClassName = findAssociationSourceClassName(schema, assoc)
  const reverseCandidates = targetClass.associations.filter((candidate) =>
    candidate.roleName === assoc.reverseRoleName &&
    candidate.reverseRoleName === assoc.roleName &&
    (!sourceClassName || candidate.targetClass === sourceClassName),
  )

  if (reverseCandidates.length <= 1) return reverseCandidates[0]
  if (!sourceClassName) return reverseCandidates[0]

  const sourceClass = schema.classes.find((cls) => cls.name === sourceClassName)
  if (!sourceClass) return reverseCandidates[0]

  const ordinal = getAssociationOrdinal(
    sourceClass.associations,
    assoc,
    (candidate, current) =>
      candidate.targetClass === current.targetClass &&
      candidate.roleName === current.roleName &&
      candidate.reverseRoleName === current.reverseRoleName,
  )

  return reverseCandidates[ordinal] ?? reverseCandidates[0]
}

export function classHasCompositionChildren(schema: CrudSchema | null, className: string): boolean {
  if (!schema) return false
  return schema.classes.some((candidate) =>
    candidate.associations.some((assoc) => assoc.isComposition && assoc.targetClass === className),
  )
}

/** Check for hierarchical cycles: would linking sourceId → targetId via a reflexive
 *  association create a cycle? Walks up from targetId following the same role. */
function wouldCreateCycle(
  instances: CrudInstance[],
  sourceId: number,
  targetId: number,
  assoc: AssocKeyInput,
): boolean {
  const visited = new Set<number>()
  let current: number | undefined = targetId
  while (current !== undefined && current !== null) {
    if (current === sourceId) return true
    if (visited.has(current)) return false // already a cycle elsewhere, don't loop
    visited.add(current)
    const inst = instances.find((i) => i._id === current)
    if (!inst) return false
    const parentIds = getAssocIds(inst, assoc)
    // For to-one reflexive (parent pointer), follow first link
    current = parentIds[0]
  }
  return false
}

// ── Random data generation ───────────────────────────────────────────

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack']
const LAST_NAMES = ['Smith', 'Jones', 'Brown', 'Lee', 'Wilson', 'Clark', 'Hall', 'Young', 'King', 'Wright']
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'theta', 'lambda', 'kappa', 'zeta']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function randomValue(type: string, typeKind: string, schema: import('@/api/types').CrudSchema): unknown {
  if (typeKind === 'enum') {
    const enumDef = schema.enums.find((e) => e.name === type)
    return enumDef ? pick(enumDef.values) : ''
  }

  const t = type.toLowerCase()
  if (t === 'boolean') return Math.random() > 0.5
  if (t === 'integer' || t === 'int') return Math.floor(Math.random() * 100) + 1
  if (t === 'float' || t === 'double') return Math.round(Math.random() * 1000) / 10
  if (t === 'date') {
    const d = new Date(Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000))
    return d.toISOString().slice(0, 10)
  }
  if (t === 'time') {
    const h = String(Math.floor(Math.random() * 24)).padStart(2, '0')
    const m = String(Math.floor(Math.random() * 60)).padStart(2, '0')
    return `${h}:${m}`
  }
  // String — generate contextual names based on attribute name patterns
  if (t === 'string' || t === '') {
    return `${pick(WORDS)}-${Math.floor(Math.random() * 1000)}`
  }
  return ''
}

/** Collect instances for a class, including concrete subclass instances. */
export function collectClassInstances(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  className: string,
): CrudInstance[] {
  const result: CrudInstance[] = [...(instances[className] ?? [])]
  for (const cls of schema.classes) {
    if (cls.extendsClass === className) {
      result.push(...collectClassInstances(schema, instances, cls.name))
    }
  }
  return result
}

function findInstanceInClassFamily(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  className: string,
  instanceId: number,
): CrudInstance | undefined {
  return collectClassInstances(schema, instances, className).find((instance) => instance._id === instanceId)
}

export function collectClassAssociations(schema: CrudSchema, className: string): CrudAssociation[] {
  prepareCrudSchema(schema)
  const associations: CrudAssociation[] = []
  const seenAssociations = new Set<string>()
  const visitedClasses = new Set<string>()

  let currentClassName: string | undefined = className
  while (currentClassName) {
    if (visitedClasses.has(currentClassName)) break
    visitedClasses.add(currentClassName)

    const cls = schema.classes.find((candidate) => candidate.name === currentClassName)
    if (!cls) break

    for (const assoc of cls.associations) {
      const identity = getAssociationRuntimeIdentity(assoc)
      if (seenAssociations.has(identity)) continue
      seenAssociations.add(identity)
      associations.push(assoc)
    }

    currentClassName = cls.extendsClass
  }

  return associations
}

interface PendingGlobalValidation {
  className: string
  instanceId: number | null
  newInstance: CrudInstance
}

const EMPTY_GLOBAL_VALIDATION_RESULT: GlobalValidationResult = {
  messages: [],
  count: 0,
}

function hasMeaningfulCrudValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function cloneInstances(instances: Record<string, CrudInstance[]>): Record<string, CrudInstance[]> {
  const snapshot: Record<string, CrudInstance[]> = {}

  for (const [className, list] of Object.entries(instances)) {
    snapshot[className] = list.map((instance) => ({ ...instance }))
  }

  return snapshot
}

function formatAssociationRequirement(assoc: CrudAssociation) {
  const { min, max } = assoc.multiplicity
  const instanceWord = max === 1 ? 'instance' : 'instances'

  if (max !== -1 && max === min) {
    return `exactly ${min} ${assoc.targetClass} ${instanceWord}`
  }

  if (max === -1) {
    return `at least ${min} ${assoc.targetClass} ${instanceWord}`
  }

  if (max > min) {
    return `between ${min} and ${max} ${assoc.targetClass} ${instanceWord}`
  }

  return `at least ${min} ${assoc.targetClass} ${instanceWord}`
}

function formatAssociationReference(assoc: CrudAssociation) {
  return assoc.roleName
    ? `association '${assoc.roleName}'`
    : `association to ${assoc.targetClass}`
}

function formatAssociationMessage(base: string, assoc: CrudAssociation) {
  if (!assoc.roleName) return `${base}.`
  return `${base} to satisfy ${formatAssociationReference(assoc)}.`
}

function computeGlobalValidationState(
  schema: CrudSchema | null,
  instances: Record<string, CrudInstance[]>,
) {
  if (!schema) return { globalValidationErrors: [], globalValidationCount: 0 }

  const result = validateGlobalModel(schema, instances)
  return {
    globalValidationErrors: result.messages,
    globalValidationCount: result.count,
  }
}

// ── Validation ───────────────────────────────────────────────────────

export function validateInstance(
  schema: CrudSchema,
  className: string,
  data: Record<string, unknown>,
  instances: Record<string, CrudInstance[]>,
  editingId: number | null,
): ValidationError[] {
  const cls = schema.classes.find((c) => c.name === className)
  if (!cls) return []
  const errors: ValidationError[] = []
  const classAssociations = collectClassAssociations(schema, cls.name)

  // Check association multiplicity constraints
  for (const assoc of classAssociations) {
    if (!assoc.isNavigable) continue
    const key = assocKey(assoc)
    const ids = getAssocIds(data as CrudInstance, assoc)

    const { min, max } = assoc.multiplicity

    if (ids.length < min) {
      errors.push({
        field: key,
        message: `Requires at least ${min} ${assoc.targetClass} (have ${ids.length})`,
      })
    }
    if (max !== -1 && ids.length > max) {
      errors.push({
        field: key,
        message: `At most ${max} ${assoc.targetClass} allowed (have ${ids.length})`,
      })
    }

    const reverseAssoc = findReverseAssoc(schema, assoc)
    if (reverseAssoc && reverseAssoc.multiplicity.max !== -1) {
      for (const tid of ids) {
        const targetInst = findInstanceInClassFamily(schema, instances, assoc.targetClass, tid)
        if (!targetInst) continue
        const reverseIds = getAssocIds(targetInst, reverseAssoc ?? assoc.reverseRoleName)
        const occupiedByOthers = reverseIds.filter((id) => id !== editingId)
        if (occupiedByOthers.length >= reverseAssoc.multiplicity.max) {
          const reverseLabel = reverseAssoc?.roleName || assoc.reverseRoleName || className
          errors.push({
            field: key,
            message: `${assoc.targetClass} #${tid} already has the maximum number of ${reverseLabel} links`,
          })
        }
      }
    }

    // Reflexive cycle detection — only for hierarchical (to-one) self-links
    // like a parent pointer, where cycles would form an infinite loop.
    // To-many reflexive links (e.g. symmetric "friends") are valid and skipped.
    if (assoc.isReflexive && editingId !== null && assoc.multiplicity.max === 1) {
      const classInstances = instances[className] ?? []
      for (const tid of ids) {
        if (tid === editingId) {
          errors.push({ field: key, message: `Cannot associate with itself` })
        } else if (wouldCreateCycle(classInstances, editingId, tid, assoc)) {
          errors.push({ field: key, message: `Would create a circular reference` })
        }
      }
    }

  }

  return errors
}

export function validateGlobalModel(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  pendingUpdate?: PendingGlobalValidation,
): GlobalValidationResult {
  prepareCrudSchema(schema)
  if (!schema) return EMPTY_GLOBAL_VALIDATION_RESULT

  const snapshot = cloneInstances(instances)

  if (pendingUpdate) {
    const list = [...(snapshot[pendingUpdate.className] ?? [])]

    if (pendingUpdate.instanceId === null) {
      list.push({ ...pendingUpdate.newInstance })
    } else {
      const idx = list.findIndex((instance) => instance._id === pendingUpdate.instanceId)
      if (idx === -1) {
        list.push({ ...pendingUpdate.newInstance })
      } else {
        list[idx] = { ...pendingUpdate.newInstance }
      }
    }

    snapshot[pendingUpdate.className] = list
  }

  const messages: string[] = []
  let totalViolations = 0

  for (const cls of schema.classes) {
    const sourceList = snapshot[cls.name] ?? []

    for (const assoc of cls.associations) {
      if (!assoc.isNavigable) continue

      const { min, max } = assoc.multiplicity
      if (min <= 0 && max === -1) continue

      let missingCount = 0
      let overMaxCount = 0
      let firstMissingId: number | null = null
      let firstOverMaxId: number | null = null

      for (const instance of sourceList) {
        const ids = getAssocIds(instance, assoc)
        const linkCount = ids.length

        if (linkCount < min) {
          missingCount++
          if (firstMissingId === null) firstMissingId = instance._id
        }

        if (max !== -1 && linkCount > max) {
          overMaxCount++
          if (firstOverMaxId === null) firstOverMaxId = instance._id
        }
      }

      if (missingCount > 0) {
        totalViolations += missingCount
        const availableTargets = collectClassInstances(schema, snapshot, assoc.targetClass)

        if (availableTargets.length === 0) {
          messages.push(
            `Conflict: ${cls.name} cannot exist without ${assoc.targetClass} according to the updated association. ` +
            `Create at least one ${assoc.targetClass} instance and associate it with the existing ${cls.name} instances.`,
          )
        } else {
          const targetLabel = firstMissingId === null ? cls.name : `${cls.name} #${firstMissingId}`
          messages.push(
            formatAssociationMessage(
              `Please associate ${targetLabel} with ${formatAssociationRequirement(assoc)}`,
              assoc,
            ),
          )
        }
      }

      if (overMaxCount > 0) {
        totalViolations += overMaxCount
        const maxText = max === 1 ? 'one' : String(max)

        if (firstOverMaxId === null) {
          messages.push(formatAssociationMessage(
            `Some ${cls.name} instances exceed the maximum allowed number of ${assoc.targetClass} links`,
            assoc,
          ))
        } else {
          messages.push(formatAssociationMessage(
            `Please reduce the number of associated ${assoc.targetClass} instances for ${cls.name} #${firstOverMaxId} to at most ${maxText}`,
            assoc,
          ))
        }
      }
    }
  }

  return {
    messages,
    count: totalViolations,
  }
}

function buildAttributeMap(cls: CrudClass) {
  return new Map(cls.attributes.map((attr) => [attr.name, attr]))
}

function buildAssociationExactSignature(
  assoc: Pick<CrudAssociation, 'roleName' | 'reverseRoleName' | 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
) {
  return [
    assoc.roleName,
    assoc.reverseRoleName,
    assoc.multiplicity.min,
    assoc.multiplicity.max,
    assoc.isNavigable ? '1' : '0',
    assoc.isComposition ? '1' : '0',
    assoc.isReflexive ? '1' : '0',
  ].join('|')
}

function buildAssociationRenameSignature(
  assoc: Pick<CrudAssociation, 'multiplicity' | 'isNavigable' | 'isComposition' | 'isReflexive'>,
) {
  return [
    assoc.multiplicity.min,
    assoc.multiplicity.max,
    assoc.isNavigable ? '1' : '0',
    assoc.isComposition ? '1' : '0',
    assoc.isReflexive ? '1' : '0',
  ].join('|')
}

function buildInstanceKey(className: string, instanceId: number) {
  return `${className}:${instanceId}`
}

function getAssociationOrdinalBySignature(
  associations: CrudAssociation[],
  assoc: CrudAssociation,
  signatureFor: (assoc: CrudAssociation) => string,
) {
  const signature = signatureFor(assoc)
  let ordinal = 0

  for (const candidate of associations) {
    if (candidate.targetClass !== assoc.targetClass) continue
    if (signatureFor(candidate) !== signature) continue
    if (candidate === assoc) return ordinal
    ordinal++
  }

  return -1
}

function normalizeCrudTypeName(type: string) {
  const normalized = type.trim().toLowerCase().replace(/\s+/g, '')
  if (normalized === 'integer') return 'int'
  if (normalized === 'bool') return 'boolean'
  if (normalized === 'char') return 'character'
  return normalized
}

function buildAttributeCompatibilitySignature(attr: CrudAttribute) {
  const typeName = attr.typeKind === 'enum' ? attr.type.trim() : normalizeCrudTypeName(attr.type)
  return [attr.typeKind, typeName].join(':')
}

function attributeTypesChanged(oldAttr: CrudAttribute, newAttr: CrudAttribute) {
  return buildAttributeCompatibilitySignature(oldAttr) !== buildAttributeCompatibilitySignature(newAttr)
}

function buildAttributeRenameMap(oldClass: CrudClass, newClass: CrudClass) {
  const oldByName = new Map(oldClass.attributes.map((attr) => [attr.name, attr]))
  const newByName = new Map(newClass.attributes.map((attr) => [attr.name, attr]))
  const oldOnly = oldClass.attributes.filter((attr) => !newByName.has(attr.name))
  const newOnly = newClass.attributes.filter((attr) => !oldByName.has(attr.name))
  const usedOldNames = new Set<string>()
  const renameMap = new Map<string, string>()

  for (const newAttr of newOnly) {
    const candidates = oldOnly.filter((oldAttr) =>
      !usedOldNames.has(oldAttr.name) &&
      buildAttributeCompatibilitySignature(oldAttr) === buildAttributeCompatibilitySignature(newAttr),
    )

    if (candidates.length === 1) {
      const matchedOld = candidates[0]!
      renameMap.set(newAttr.name, matchedOld.name)
      usedOldNames.add(matchedOld.name)
    }
  }

  return renameMap
}

function buildClassAttributeSignature(cls: CrudClass) {
  return [...cls.attributes]
    .map((attr) => [
      attr.name,
      normalizeCrudTypeName(attr.type),
      attr.typeKind,
      attr.isInherited ? '1' : '0',
      attr.inheritedFrom ?? '',
    ].join(':'))
    .sort()
    .join(';')
}

function buildClassAssociationSignature(cls: CrudClass) {
  return cls.associations
    .filter((assoc) => assoc.isNavigable)
    .map((assoc) => [
      assoc.targetClass,
      assoc.multiplicity.min,
      assoc.multiplicity.max,
      assoc.reverseRoleName ? '1' : '0',
      assoc.isComposition ? '1' : '0',
    ].join('|'))
    .sort()
    .join(';')
}

function buildClassStructuralSignature(cls: CrudClass) {
  return [
    cls.isAbstract ? '1' : '0',
    cls.extendsClass ?? '',
    buildClassAttributeSignature(cls),
    buildClassAssociationSignature(cls),
  ].join('||')
}

function buildClassSourceMap(oldSchema: CrudSchema | null, newSchema: CrudSchema) {
  const sourceMap = new Map<string, string>()
  if (!oldSchema) return sourceMap

  const oldClassesByName = new Map(oldSchema.classes.map((cls) => [cls.name, cls]))
  const matchedOldNames = new Set<string>()
  const matchedNewNames = new Set<string>()

  for (const newClass of newSchema.classes) {
    const oldByName = oldClassesByName.get(newClass.name)
    if (oldByName) {
      sourceMap.set(newClass.name, oldByName.name)
      matchedOldNames.add(oldByName.name)
      matchedNewNames.add(newClass.name)
    }
  }

  const unmatchedOld = oldSchema.classes.filter((cls) => !matchedOldNames.has(cls.name))
  const unmatchedNew = newSchema.classes.filter((cls) => !matchedNewNames.has(cls.name))
  const oldSignatures = new Map(unmatchedOld.map((cls) => [cls.name, buildClassStructuralSignature(cls)]))
  const usedHeuristicOldNames = new Set<string>()

  for (const newClass of unmatchedNew) {
    const newSignature = buildClassStructuralSignature(newClass)
    const candidates = unmatchedOld.filter((oldClass) =>
      !usedHeuristicOldNames.has(oldClass.name) && oldSignatures.get(oldClass.name) === newSignature,
    )

    if (candidates.length === 1) {
      const matchedOld = candidates[0]!
      sourceMap.set(newClass.name, matchedOld.name)
      usedHeuristicOldNames.add(matchedOld.name)
    }
  }

  return sourceMap
}

function associationTargetsMatch(
  oldAssoc: CrudAssociation,
  newAssoc: CrudAssociation,
  classSourceMap: Map<string, string>,
) {
  if (oldAssoc.targetClass === newAssoc.targetClass) return true
  return classSourceMap.get(newAssoc.targetClass) === oldAssoc.targetClass
}

function associationsExactlyMatch(
  oldAssoc: CrudAssociation,
  newAssoc: CrudAssociation,
  classSourceMap: Map<string, string>,
) {
  return (
    associationTargetsMatch(oldAssoc, newAssoc, classSourceMap) &&
    buildAssociationExactSignature(oldAssoc) === buildAssociationExactSignature(newAssoc)
  )
}

function associationsMatchIgnoringRoleNames(
  oldAssoc: CrudAssociation,
  newAssoc: CrudAssociation,
  classSourceMap: Map<string, string>,
) {
  return (
    associationTargetsMatch(oldAssoc, newAssoc, classSourceMap) &&
    buildAssociationRenameSignature(oldAssoc) === buildAssociationRenameSignature(newAssoc)
  )
}

function pickAssociationMatchByOrdinal(
  oldAssociations: CrudAssociation[],
  newAssociations: CrudAssociation[],
  newAssoc: CrudAssociation,
  candidates: CrudAssociation[],
  signatureFor: (assoc: CrudAssociation) => string,
) {
  if (candidates.length <= 1) return candidates[0]

  const ordinal = getAssociationOrdinalBySignature(newAssociations, newAssoc, signatureFor)
  if (ordinal < 0) return candidates[0]

  const orderedCandidates = oldAssociations.filter((candidate) => candidates.includes(candidate))
  return orderedCandidates[ordinal] ?? candidates[0]
}

function buildAssociationSourceMap(
  oldClass: CrudClass,
  newClass: CrudClass,
  classSourceMap: Map<string, string>,
) {
  const sourceMap = new Map<CrudAssociation, CrudAssociation>()
  const usedOldAssociations = new Set<CrudAssociation>()

  for (const newAssoc of newClass.associations) {
    const exactCandidates = oldClass.associations.filter((oldAssoc) =>
      !usedOldAssociations.has(oldAssoc) && associationsExactlyMatch(oldAssoc, newAssoc, classSourceMap),
    )
    const exactMatch = pickAssociationMatchByOrdinal(
      oldClass.associations,
      newClass.associations,
      newAssoc,
      exactCandidates,
      buildAssociationExactSignature,
    )

    if (exactMatch) {
      sourceMap.set(newAssoc, exactMatch)
      usedOldAssociations.add(exactMatch)
      continue
    }

    const renamedCandidates = oldClass.associations.filter((oldAssoc) =>
      !usedOldAssociations.has(oldAssoc) && associationsMatchIgnoringRoleNames(oldAssoc, newAssoc, classSourceMap),
    )
    const renamedMatch = pickAssociationMatchByOrdinal(
      oldClass.associations,
      newClass.associations,
      newAssoc,
      renamedCandidates,
      buildAssociationRenameSignature,
    )

    if (!renamedMatch) continue

    sourceMap.set(newAssoc, renamedMatch)
    usedOldAssociations.add(renamedMatch)
  }

  return sourceMap
}

export function resolveSelectedClassName(
  oldSchema: CrudSchema | null,
  newSchema: CrudSchema,
  selectedClassName: string | null,
) {
  if (!selectedClassName) return null
  if (newSchema.classes.some((cls) => cls.name === selectedClassName)) return selectedClassName
  if (!oldSchema) return null

  const classSourceMap = buildClassSourceMap(oldSchema, newSchema)
  for (const [newClassName, oldClassName] of classSourceMap.entries()) {
    if (oldClassName === selectedClassName) return newClassName
  }
  return null
}

function coercePrimitiveValue(value: unknown, type: string): unknown {
  const normalized = type.toLowerCase()

  if (normalized === 'string' || normalized === '') {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return undefined
  }

  if (normalized === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase()
      if (lowered === 'true') return true
      if (lowered === 'false') return false
    }
    return undefined
  }

  if (normalized === 'integer' || normalized === 'int') {
    if (typeof value === 'number' && Number.isInteger(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') return undefined
      const parsed = Number(trimmed)
      if (Number.isInteger(parsed)) return parsed
    }
    return undefined
  }

  if (normalized === 'float' || normalized === 'double') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') return undefined
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  if (normalized === 'date' || normalized === 'time') {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }

  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}

function coerceAttributeValue(value: unknown, attr: CrudAttribute, schema: CrudSchema): unknown {
  if (value === undefined) return undefined

  if (attr.typeKind === 'enum') {
    if (typeof value !== 'string') return undefined
    const enumDef = schema.enums.find((candidate) => candidate.name === attr.type)
    if (!enumDef) return undefined
    return enumDef.values.includes(value) ? value : undefined
  }

  if (attr.typeKind === 'primitive') {
    return coercePrimitiveValue(value, attr.type)
  }

  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}

function addAssocId(instance: CrudInstance, assoc: AssocKeyInput, targetId: number, max = -1): boolean {
  const ids = getAssocIds(instance, assoc)
  if (ids.includes(targetId)) return true
  if (max !== -1 && ids.length >= max) return false
  setAssocIds(instance, assoc, [...ids, targetId], max)
  return true
}

function canGenerateAssociationLink(
  source: CrudInstance,
  target: CrudInstance,
  assoc: CrudAssociation,
  reverseAssoc?: CrudAssociation,
): boolean {
  if (assoc.isReflexive && target._id === source._id) return false
  // For reflexive to-one (tree/parent), only link to lower IDs to prevent cycles.
  if (assoc.isReflexive && assoc.multiplicity.max === 1 && target._id >= source._id) return false

  const sourceIds = getAssocIds(source, assoc)
  if (sourceIds.includes(target._id)) return false
  if (assoc.multiplicity.max !== -1 && sourceIds.length >= assoc.multiplicity.max) return false

  if (!reverseAssoc) return true

  const reverseIds = getAssocIds(target, reverseAssoc)
  if (reverseIds.includes(source._id)) return false
  if (reverseAssoc.multiplicity.max !== -1 && reverseIds.length >= reverseAssoc.multiplicity.max) return false

  return true
}

function createAssociationLink(
  source: CrudInstance,
  target: CrudInstance,
  assoc: CrudAssociation,
  reverseAssoc?: CrudAssociation,
): boolean {
  const added = addAssocId(source, assoc, target._id, assoc.multiplicity.max)
  if (!added) return false
  if (!reverseAssoc) return true

  const reverseAdded = addAssocId(target, reverseAssoc, source._id, reverseAssoc.multiplicity.max)
  if (reverseAdded) return true

  removeAssocId(source, assoc, target._id, assoc.multiplicity.max)
  return false
}

function satisfyAssociationMinimum(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  primaryClassName: string,
  secondaryClassName: string,
  primaryAssoc: CrudAssociation,
  secondaryAssoc: CrudAssociation | undefined,
  scoreCandidate: (candidate: CrudInstance) => number,
  nextId: number,
) {
  if (primaryAssoc.multiplicity.min <= 0) return nextId

  const createRandomInstanceForFamily = (className: string) => {
    const familyCandidates = schema.classes
      .filter((cls) => !cls.isAbstract && (cls.name === className || cls.extendsClass === className || isDescendantOf(schema, cls.name, className)))
      .sort((left, right) => {
        const leftExact = left.name === className ? 0 : 1
        const rightExact = right.name === className ? 0 : 1
        if (leftExact !== rightExact) return leftExact - rightExact
        return (instances[left.name] ?? []).length - (instances[right.name] ?? []).length
      })

    const targetClass = familyCandidates[0]
    if (!targetClass) return null

    const instance = createRandomInstanceForClass(targetClass, schema, nextId)
    instances[targetClass.name] = [...(instances[targetClass.name] ?? []), instance]
    nextId++
    return instance
  }

  const primaryList = collectClassInstances(schema, instances, primaryClassName)
  const shuffledPrimary = [...primaryList].sort(() => Math.random() - 0.5)
  for (const primary of shuffledPrimary) {
    while (getAssocIds(primary, primaryAssoc).length < primaryAssoc.multiplicity.min) {
      let secondaryList = collectClassInstances(schema, instances, secondaryClassName)
      let candidates = secondaryList.filter((secondary) =>
        canGenerateAssociationLink(primary, secondary, primaryAssoc, secondaryAssoc),
      )
      let candidate = pickAssociationCandidate(candidates, scoreCandidate)
      if (!candidate) {
        const created = createRandomInstanceForFamily(secondaryClassName)
        if (!created) break
        secondaryList = collectClassInstances(schema, instances, secondaryClassName)
        candidates = secondaryList.filter((secondary) =>
          canGenerateAssociationLink(primary, secondary, primaryAssoc, secondaryAssoc),
        )
        candidate = candidates.find((secondary) => secondary._id === created._id) ?? pickAssociationCandidate(candidates, scoreCandidate)
      }
      if (!candidate) break
      if (!createAssociationLink(primary, candidate, primaryAssoc, secondaryAssoc)) break
    }
  }

  return nextId
}

function addRandomAssociationExtras(
  sourceList: CrudInstance[],
  targetList: CrudInstance[],
  assoc: CrudAssociation,
  reverseAssoc?: CrudAssociation,
) {
  for (const source of sourceList) {
    const available = targetList.filter((target) => canGenerateAssociationLink(source, target, assoc, reverseAssoc))
    const currentCount = getAssocIds(source, assoc).length
    const { max } = assoc.multiplicity
    const effectiveMax = max === -1 ? currentCount + available.length : Math.min(max, currentCount + available.length)
    const additionalMax = effectiveMax - currentCount
    if (additionalMax <= 0) continue

    const linkCount = Math.floor(Math.random() * (additionalMax + 1))
    const shuffled = [...available].sort(() => Math.random() - 0.5)
    const picked = shuffled.slice(0, linkCount)

    for (const target of picked) {
      createAssociationLink(source, target, assoc, reverseAssoc)
    }
  }
}

function pickAssociationCandidate<T>(
  candidates: T[],
  score: (candidate: T) => number,
): T | undefined {
  if (candidates.length === 0) return undefined

  const ranked = [...candidates].sort((left, right) => {
    const leftScore = score(left)
    const rightScore = score(right)
    if (leftScore !== rightScore) return leftScore - rightScore
    return Math.random() - 0.5
  })

  return ranked[0]
}

function createRandomInstanceForClass(cls: CrudClass, schema: CrudSchema, instanceId: number): CrudInstance {
  const data: Record<string, unknown> = {}
  for (const attr of cls.attributes) {
    data[attr.name] = randomValue(attr.type, attr.typeKind, schema)
  }
  return { _id: instanceId, ...data }
}

function buildRandomAssociationProcessingKey(
  className: string,
  assoc: CrudAssociation,
  reverseAssoc?: CrudAssociation,
) {
  return reverseAssoc
    ? [`${className}:${getAssociationRuntimeIdentity(assoc)}`, `${assoc.targetClass}:${getAssociationRuntimeIdentity(reverseAssoc)}`]
      .sort()
      .join('<->')
    : `${className}:${getAssociationRuntimeIdentity(assoc)}`
}

function forEachRandomAssociationPair(
  schema: CrudSchema,
  concreteClasses: CrudClass[],
  visit: (cls: CrudClass, assoc: CrudAssociation, reverseAssoc?: CrudAssociation) => void,
) {
  const processed = new Set<string>()

  for (const cls of concreteClasses) {
    for (const assoc of cls.associations) {
      if (!assoc.isNavigable) continue

      const reverseAssoc = findReverseAssoc(schema, assoc)
      const processingKey = buildRandomAssociationProcessingKey(cls.name, assoc, reverseAssoc)
      if (processed.has(processingKey)) continue
      processed.add(processingKey)

      visit(cls, assoc, reverseAssoc)
    }
  }
}

function isDescendantOf(schema: CrudSchema, className: string, ancestorName: string): boolean {
  let current = schema.classes.find((cls) => cls.name === className)?.extendsClass
  while (current) {
    if (current === ancestorName) return true
    current = schema.classes.find((cls) => cls.name === current)?.extendsClass
  }
  return false
}

function ensureRandomAssociationMinimums(
  schema: CrudSchema,
  concreteClasses: CrudClass[],
  instances: Record<string, CrudInstance[]>,
  nextId: number,
) {
  const maxPasses = Math.max(1, schema.classes.length * 4)

  for (let pass = 0; pass < maxPasses; pass++) {
    const previousNextId = nextId

    forEachRandomAssociationPair(schema, concreteClasses, (cls, assoc, reverseAssoc) => {
      if (reverseAssoc) {
        nextId = satisfyAssociationMinimum(
          schema,
          instances,
          assoc.targetClass,
          cls.name,
          reverseAssoc,
          assoc,
          (source) => getAssocIds(source, assoc).length,
          nextId,
        )
      }

      nextId = satisfyAssociationMinimum(
        schema,
        instances,
        cls.name,
        assoc.targetClass,
        assoc,
        reverseAssoc,
        (target) => reverseAssoc ? getAssocIds(target, reverseAssoc).length : 0,
        nextId,
      )
    })

    if (nextId === previousNextId) break
  }

  return nextId
}

function clearAssociationFields(instances: Record<string, CrudInstance[]>) {
  for (const list of Object.values(instances)) {
    for (const instance of list) {
      for (const key of Object.keys(instance)) {
        if (key.startsWith('__assoc__')) delete instance[key]
      }
    }
  }
}

function normalizeInstancesForSchema(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
): Record<string, CrudInstance[]> {
  prepareCrudSchema(schema)
  const normalized: Record<string, CrudInstance[]> = {}

  for (const cls of schema.classes) {
    const list = instances[cls.name] ?? []
    normalized[cls.name] = list.map((instance) => {
      const nextInstance: CrudInstance = { _id: instance._id }

      for (const [key, value] of Object.entries(instance)) {
        if (key !== '_id' && !key.startsWith('__assoc__')) nextInstance[key] = value
      }

      for (const assoc of collectClassAssociations(schema, cls.name)) {
        const ids = getAssocIds(instance, assoc)
        if (ids.length === 0) continue
        setAssocIds(nextInstance, assoc, [...new Set(ids)], assoc.multiplicity.max)
      }

      return nextInstance
    })
  }

  return normalized
}

export function reconcileInstancesDetailed(
  oldSchema: CrudSchema | null,
  newSchema: CrudSchema,
  oldInstances: Record<string, CrudInstance[]>,
): ReconcileResult {
  prepareCrudSchema(oldSchema)
  prepareCrudSchema(newSchema)
  const nextInstances: Record<string, CrudInstance[]> = {}
  const adjustments: string[] = []

  if (!oldSchema) {
    for (const cls of newSchema.classes) nextInstances[cls.name] = []
    return { instances: nextInstances, adjustments }
  }

  const oldClassesByName = new Map(oldSchema.classes.map((cls) => [cls.name, cls]))
  const classSourceMap = buildClassSourceMap(oldSchema, newSchema)
  const associationCandidates = new Map<string, Record<string, number[]>>()

  for (const newClass of newSchema.classes) {
    const oldClassName = classSourceMap.get(newClass.name)
    const oldClass = oldClassName ? oldClassesByName.get(oldClassName) : undefined

    if (!oldClass || newClass.isAbstract) {
      nextInstances[newClass.name] = []
      continue
    }

    const sourceList = oldInstances[oldClass.name] ?? []
    const oldAttributes = buildAttributeMap(oldClass)
    const oldAssociationSources = buildAssociationSourceMap(oldClass, newClass, classSourceMap)
    const attributeRenameMap = buildAttributeRenameMap(oldClass, newClass)
    const migratedList: CrudInstance[] = []
    const attributeRenameMoves = new Map<string, { oldName: string; movedCount: number }>()
    const attributeTypeChanges = new Map<string, { oldType: string; newType: string; kept: number; removed: number }>()

    for (const oldInstance of sourceList) {
      const nextInstance: CrudInstance = { _id: oldInstance._id }

      for (const attr of newClass.attributes) {
        const oldAttr = oldAttributes.get(attr.name)

        if (oldAttr) {
          const oldValue = oldInstance[attr.name]
          const migrated = coerceAttributeValue(oldValue, attr, newSchema)

          if (migrated !== undefined) nextInstance[attr.name] = migrated

          if (attributeTypesChanged(oldAttr, attr) && hasMeaningfulCrudValue(oldValue)) {
            const summary = attributeTypeChanges.get(attr.name) ?? {
              oldType: oldAttr.type,
              newType: attr.type,
              kept: 0,
              removed: 0,
            }

            if (migrated !== undefined) {
              summary.kept++
            } else {
              summary.removed++
            }

            attributeTypeChanges.set(attr.name, summary)
          }
          continue
        }

        const renamedFrom = attributeRenameMap.get(attr.name)
        if (!renamedFrom) continue

        const oldValue = oldInstance[renamedFrom]
        if (!hasMeaningfulCrudValue(oldValue)) continue

        const migrated = coerceAttributeValue(oldValue, attr, newSchema)
        if (migrated === undefined || nextInstance[attr.name] !== undefined) continue

        nextInstance[attr.name] = migrated

        const summary = attributeRenameMoves.get(attr.name) ?? { oldName: renamedFrom, movedCount: 0 }
        summary.movedCount++
        attributeRenameMoves.set(attr.name, summary)
      }

      const instanceAssocCandidates: Record<string, number[]> = {}
      for (const assoc of newClass.associations) {
        const assocIdentity = getAssociationRuntimeIdentity(assoc)
        const oldAssoc = oldAssociationSources.get(assoc)
        if (!oldAssoc) continue
        const ids = getAssocIds(oldInstance, oldAssoc)
        if (ids.length > 0) instanceAssocCandidates[assocIdentity] = ids
      }

      associationCandidates.set(buildInstanceKey(newClass.name, oldInstance._id), instanceAssocCandidates)
      migratedList.push(nextInstance)
    }

    nextInstances[newClass.name] = migratedList

    if (oldClass.name !== newClass.name && migratedList.length > 0) {
      adjustments.push(
        `Class '${oldClass.name}' was renamed to '${newClass.name}'. Existing instances were preserved because the class still matched uniquely.`,
      )
    }

    for (const [newAttrName, summary] of attributeRenameMoves.entries()) {
      if (summary.movedCount <= 0) continue
      adjustments.push(
        `Attribute '${summary.oldName}' in class '${newClass.name}' was renamed to '${newAttrName}'. Existing data was preserved because the attribute type did not change.`,
      )
    }

    for (const [attrName, summary] of attributeTypeChanges.entries()) {
      if (summary.kept > 0 && summary.removed === 0) {
        adjustments.push(
          `Data type of attribute '${attrName}' in class '${newClass.name}' was updated from ${summary.oldType} to ${summary.newType}. Existing data was kept because it is compatible with the new type.`,
        )
      } else if (summary.kept > 0 && summary.removed > 0) {
        adjustments.push(
          `Data type of attribute '${attrName}' in class '${newClass.name}' was updated from ${summary.oldType} to ${summary.newType}. Existing data was adjusted: compatible values were kept where possible, and incompatible values were removed from ${summary.removed} instance(s).`,
        )
      } else if (summary.removed > 0) {
        adjustments.push(
          `Data type of attribute '${attrName}' in class '${newClass.name}' was updated from ${summary.oldType} to ${summary.newType}. Existing data was removed from ${summary.removed} instance(s) because it is not compatible with the new type.`,
        )
      }
    }
  }

  clearAssociationFields(nextInstances)
  const associationAdjustments = new Map<string, { fromClass: string; roleName: string; targetClass: string; removedCount: number }>()

  for (const cls of newSchema.classes) {
    for (const assoc of cls.associations) {
      const reverseAssoc = findReverseAssoc(newSchema, assoc)
      const sourceList = nextInstances[cls.name] ?? []
      const targetById = new Map(
        collectClassInstances(newSchema, nextInstances, assoc.targetClass).map((instance) => [instance._id, instance]),
      )

      for (const source of sourceList) {
        const candidateIds = associationCandidates.get(buildInstanceKey(cls.name, source._id))?.[getAssociationRuntimeIdentity(assoc)] ?? []
        const filteredIds = [...new Set(candidateIds)]
          .filter((id) => targetById.has(id))
          .filter((id) => !assoc.isReflexive || id !== source._id)

        const trimmedIds = assoc.multiplicity.max === -1
          ? filteredIds
          : filteredIds.slice(0, assoc.multiplicity.max)

        const adjustmentKey = `${cls.name}:${getAssociationRuntimeIdentity(assoc)}`
        const adjustment = associationAdjustments.get(adjustmentKey) ?? {
          fromClass: cls.name,
          roleName: assoc.roleName || assoc.targetClass,
          targetClass: assoc.targetClass,
          removedCount: 0,
        }
        adjustment.removedCount += filteredIds.length - trimmedIds.length
        associationAdjustments.set(adjustmentKey, adjustment)

        for (const targetId of trimmedIds) {
          const target = targetById.get(targetId)
          if (!target) continue
          const added = addAssocId(source, assoc, targetId, assoc.multiplicity.max)
          if (!added) continue

          if (assoc.reverseRoleName && reverseAssoc) {
            const accepted = addAssocId(target, reverseAssoc, source._id, reverseAssoc.multiplicity.max)
            if (!accepted) {
              removeAssocId(source, assoc, targetId, assoc.multiplicity.max)
              adjustment.removedCount++
            }
          }
        }
      }
    }
  }

  for (const adjustment of associationAdjustments.values()) {
    if (adjustment.removedCount <= 0) continue
    adjustments.push(
      adjustment.roleName && adjustment.roleName !== adjustment.targetClass
        ? `Existing links for association '${adjustment.roleName}' from ${adjustment.fromClass} to ${adjustment.targetClass} were trimmed to satisfy the updated multiplicity constraints.`
        : `Existing links from ${adjustment.fromClass} to ${adjustment.targetClass} were trimmed to satisfy the updated multiplicity constraints.`,
    )
  }

  return {
    instances: nextInstances,
    adjustments: [...new Set(adjustments)],
  }
}

export function reconcileInstances(
  oldSchema: CrudSchema | null,
  newSchema: CrudSchema,
  oldInstances: Record<string, CrudInstance[]>,
): Record<string, CrudInstance[]> {
  return reconcileInstancesDetailed(oldSchema, newSchema, oldInstances).instances
}

// ── Session storage persistence ─────────────────────────────────────

const CRUD_STORAGE_KEY = 'umple-crud-instances'

function restoreFromSession(schemaKey: string): { instances: Record<string, CrudInstance[]>; nextId: number } | null {
  try {
    const raw = sessionStorage.getItem(CRUD_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Any code change produces a different key — discard everything on mismatch
    // to avoid confusing users with stale/partial data.
    if (data.schemaKey !== schemaKey || !data.instances) return null
    return {
      instances: data.instances as Record<string, CrudInstance[]>,
      nextId: typeof data.nextId === 'number' ? data.nextId : 1,
    }
  } catch {
    return null
  }
}

function saveToSession(schemaKey: string | null, instances: Record<string, CrudInstance[]>, nextId: number) {
  try {
    const hasData = Object.values(instances).some((list) => list.length > 0)
    if (!schemaKey || !hasData) {
      sessionStorage.removeItem(CRUD_STORAGE_KEY)
      return
    }
    sessionStorage.setItem(CRUD_STORAGE_KEY, JSON.stringify({ schemaKey, instances, nextId }))
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

// ── Store ────────────────────────────────────────────────────────────

export const useCrudStore = create<CrudState>((set, get) => ({
  schema: null,
  schemaLoading: false,
  schemaError: null,
  schemaRequestKey: null,
  crudModelId: null,
  instances: {},
  nextId: 1,
  selectedClass: null,
  editingInstance: null,
  validationErrors: [],
  adjustmentMessages: [],
  globalValidationErrors: [],
  globalValidationCount: 0,

  fetchSchema: async (code, modelId) => {
    const schemaRequestKey = buildCrudSchemaRequestKey(code)
    set({
      schemaLoading: true,
      schemaError: null,
      schemaRequestKey,
      adjustmentMessages: [],
      globalValidationErrors: [],
      globalValidationCount: 0,
    })
    try {
      const activeTabId = useSessionStore.getState().activeTabId
      const res = await api.crudSchema({ code, modelId, activeTabId })
      // Ignore stale responses: if another fetch was started while we were
      // awaiting, the stored schemaRequestKey will have changed.
      if (get().schemaRequestKey !== schemaRequestKey) return
      const schema = prepareCrudSchema(res.schema)
      const state = get()
      let selected = resolveSelectedClassName(state.schema, schema, state.selectedClass)
      if (!selected || !schema.classes.some((c) => c.name === selected)) {
        selected = schema.classes.find((c) => !c.isAbstract)?.name ?? null
      }
      const restored = restoreFromSession(schemaRequestKey)
      const restoredInstances = restored ? normalizeInstancesForSchema(schema, restored.instances) : {}
      const reconciliation = state.schema
        ? reconcileInstancesDetailed(state.schema, schema, state.instances)
        : { instances: restoredInstances, adjustments: [] }
      const reconciledInstances = reconciliation.instances
      const globalValidation = validateGlobalModel(schema, reconciledInstances)
      set({
        schema,
        schemaLoading: false,
        schemaError: res.errors || null,
        schemaRequestKey,
        crudModelId: res.modelId || null,
        selectedClass: selected,
        instances: reconciledInstances,
        nextId: state.schema ? state.nextId : (restored?.nextId ?? 1),
        editingInstance: null,
        validationErrors: [],
        adjustmentMessages: reconciliation.adjustments,
        globalValidationErrors: globalValidation.messages,
        globalValidationCount: globalValidation.count,
      })
    } catch (err) {
      if (get().schemaRequestKey !== schemaRequestKey) return
      set({
        schemaLoading: false,
        schemaError: err instanceof Error ? err.message : 'Failed to fetch schema',
        schemaRequestKey,
      })
    }
  },

  setSelectedClass: (name) => set({ selectedClass: name, editingInstance: null, validationErrors: [] }),

  createInstance: (className, data) => {
    const { schema, nextId } = get()
    const id = nextId
    const instance: CrudInstance = { _id: id, ...data }

    set((s) => {
      const newInstances = { ...s.instances }
      newInstances[className] = [...(newInstances[className] ?? []), instance]

      // Bidirectional association sync
      if (schema) {
        syncReverseLinks(schema, newInstances, className, id, instance, {})
      }

      return {
        nextId: s.nextId + 1,
        instances: newInstances,
        validationErrors: [],
        ...computeGlobalValidationState(schema, newInstances),
      }
    })
    return id
  },

  updateInstance: (className, instanceId, data) => {
    const { schema } = get()

    set((s) => {
      const newInstances = { ...s.instances }
      const list = [...(newInstances[className] ?? [])]
      const idx = list.findIndex((i) => i._id === instanceId)
      if (idx === -1) return s

      const oldInst = list[idx]!
      const oldAssocData: Record<string, unknown> = {}
      for (const key of Object.keys(oldInst)) {
        if (key.startsWith('__assoc__')) oldAssocData[key] = oldInst[key]
      }

      const preservedFields: CrudInstance = { _id: oldInst._id }
      for (const [key, value] of Object.entries(oldInst)) {
        if (key !== '_id' && !key.startsWith('__assoc__')) preservedFields[key] = value
      }

      const preservedAssociations: Record<string, unknown> = {}
      if (schema) {
        for (const assoc of collectClassAssociations(schema, className)) {
          const ids = getAssocIds(oldInst, assoc)
          if (ids.length === 0) continue
          preservedAssociations[assocKey(assoc)] = assoc.multiplicity.max === 1 ? ids[0] : ids
        }
      }

      const newInst: CrudInstance = { ...preservedFields, ...preservedAssociations, ...data }
      list[idx] = newInst
      newInstances[className] = list

      // Bidirectional sync: diff old vs new association values
      if (schema) {
        syncReverseLinks(schema, newInstances, className, instanceId, newInst, oldAssocData)
      }

      return {
        instances: newInstances,
        validationErrors: [],
        ...computeGlobalValidationState(schema, newInstances),
      }
    })
  },

  deleteInstance: (className, instanceId) => {
    const { schema } = get()

    set((s) => {
      const newInstances = { ...s.instances }
      deleteInstancesInPlace(schema, newInstances, [{ cls: className, id: instanceId }])

      return {
        instances: newInstances,
        ...computeGlobalValidationState(schema, newInstances),
      }
    })
  },

  clearAllInstances: (className) => {
    const { schema } = get()

    set((s) => {
      const newInstances = { ...s.instances }
      if (!schema) {
        newInstances[className] = []
        return {
          instances: newInstances,
          ...computeGlobalValidationState(schema, newInstances),
        }
      }

      const seeds = (newInstances[className] ?? []).map((inst) => ({ cls: className, id: inst._id }))
      deleteInstancesInPlace(schema, newInstances, seeds)
      return {
        instances: newInstances,
        ...computeGlobalValidationState(schema, newInstances),
      }
    })
  },

  openEditor: (className, instanceId) => set({ editingInstance: { className, instanceId }, validationErrors: [] }),

  closeEditor: () => set({ editingInstance: null, validationErrors: [] }),

  setValidationErrors: (errors) => set({ validationErrors: errors }),

  resetInstances: () => {
    saveToSession(null, {}, 1)
    set({
      instances: {},
      nextId: 1,
      editingInstance: null,
      validationErrors: [],
      globalValidationErrors: [],
      globalValidationCount: 0,
    })
  },

  exportJson: () => {
    const { instances, schema, nextId } = get()
    return JSON.stringify({ instances, nextId, schemaHash: schema?.classes.map((c) => c.name).join(',') }, null, 2)
  },

  importJson: (json) => {
    try {
      const data = JSON.parse(json)
      if (!data.instances || typeof data.instances !== 'object') return false
      // Filter to only classes present in the current schema
      const { schema } = get()
      if (schema) {
        const validClassNames = new Set(schema.classes.map((c) => c.name))
        const filtered: Record<string, CrudInstance[]> = {}
        for (const [cls, list] of Object.entries(data.instances)) {
          if (validClassNames.has(cls) && Array.isArray(list)) {
            filtered[cls] = list as CrudInstance[]
          }
        }
        data.instances = filtered
      }
      const normalizedInstances = schema
        ? normalizeInstancesForSchema(schema, data.instances as Record<string, CrudInstance[]>)
        : data.instances as Record<string, CrudInstance[]>
      set({
        instances: normalizedInstances,
        nextId: typeof data.nextId === 'number' ? data.nextId : 1,
        editingInstance: null,
        validationErrors: [],
        ...computeGlobalValidationState(schema, normalizedInstances),
      })
      return true
    } catch {
      return false
    }
  },

  generateRandomAll: () => {
    const { schema } = get()
    if (!schema) return
    prepareCrudSchema(schema)

    const concreteClasses = schema.classes.filter((c) => !c.isAbstract)
    if (concreteClasses.length === 0) return

    // Step 1: Generate 1-2 instances per concrete class with random attributes
    const newInstances: Record<string, CrudInstance[]> = {}
    let nextId = 1

    for (const cls of concreteClasses) {
      const count = Math.random() < 0.5 ? 1 : 2
      const list: CrudInstance[] = []
      for (let i = 0; i < count; i++) {
        list.push(createRandomInstanceForClass(cls, schema, nextId))
        nextId++
      }
      newInstances[cls.name] = list
    }

    // Step 2: Generate random associations respecting multiplicity constraints
    nextId = ensureRandomAssociationMinimums(schema, concreteClasses, newInstances, nextId)

    // Step 3: Generate random associations respecting multiplicity constraints
    forEachRandomAssociationPair(schema, concreteClasses, (cls, assoc, reverseAssoc) => {
      const sourceList = collectClassInstances(schema, newInstances, cls.name)
      const targetList = collectClassInstances(schema, newInstances, assoc.targetClass)
      if (sourceList.length === 0 || targetList.length === 0) return

      addRandomAssociationExtras(sourceList, targetList, assoc, reverseAssoc)
    })

    set({
      instances: newInstances,
      nextId,
      editingInstance: null,
      validationErrors: [],
      ...computeGlobalValidationState(schema, newInstances),
    })
  },
}))

// ── Auto-persist to sessionStorage (debounced) ──────────────────────

let _saveTimer: ReturnType<typeof setTimeout> | null = null

useCrudStore.subscribe((state, prev) => {
  if (state.instances === prev.instances && state.nextId === prev.nextId) return
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    const { schemaRequestKey, instances, nextId } = useCrudStore.getState()
    saveToSession(schemaRequestKey, instances, nextId)
  }, 300)
})

// ── Reverse link sync helper ─────────────────────────────────────────

/**
 * Syncs bidirectional association links.
 * Compares newData vs oldData for __assoc__ keys and updates reverse ends.
 * Mutates newInstances in place.
 */
function syncReverseLinks(
  schema: CrudSchema,
  newInstances: Record<string, CrudInstance[]>,
  className: string,
  instanceId: number,
  newData: Record<string, unknown>,
  oldData: Record<string, unknown>,
) {
  const sourceList = newInstances[className] ?? []
  const source = sourceList.find((inst) => inst._id === instanceId)

  for (const assoc of collectClassAssociations(schema, className)) {
    const reverseAssoc = findReverseAssoc(schema, assoc)
    if (!assoc.reverseRoleName && !reverseAssoc) continue
    const key = assocKey(assoc)

    const oldVal = oldData[key]
    const newVal = newData[key]

    const oldIds = toIdArray(oldVal)
    const newIds = toIdArray(newVal)

    const added = newIds.filter((id) => !oldIds.includes(id))
    const removed = oldIds.filter((id) => !newIds.includes(id))

    // Add reverse links for newly added targets
    for (const tid of added) {
      const target = findInstanceInClassFamily(schema, newInstances, assoc.targetClass, tid)
      if (!target) continue
      const reverseIds = getAssocIds(target, reverseAssoc ?? assoc.reverseRoleName)
      const occupiedByOthers = reverseIds.filter((id) => id !== instanceId)

      if (
        reverseAssoc &&
        reverseAssoc.multiplicity.max !== -1 &&
        occupiedByOthers.length >= reverseAssoc.multiplicity.max
      ) {
        // Reject the forward link when the reverse end is already full.
        if (source) {
          removeAssocId(source, assoc, tid, assoc.multiplicity.max)
        }
        continue
      }

      if (!reverseIds.includes(instanceId)) {
        setAssocIds(
          target,
          reverseAssoc ?? assoc.reverseRoleName,
          [...reverseIds, instanceId],
          reverseAssoc?.multiplicity.max,
        )
      }
    }

    // Remove reverse links for removed targets
    for (const tid of removed) {
      const target = findInstanceInClassFamily(schema, newInstances, assoc.targetClass, tid)
      if (target) {
        removeAssocId(target, reverseAssoc ?? assoc.reverseRoleName, instanceId, reverseAssoc?.multiplicity.max)
      }
    }
  }
}

/** Normalise a stored association value to a number[]. */
export function toIdArray(val: unknown): number[] {
  if (val === undefined || val === null) return []
  if (Array.isArray(val)) return val as number[]
  if (typeof val === 'number') return [val]
  return []
}

function enqueueCompositionChildren(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  className: string,
  instanceId: number,
  cascadeQueue: Array<{ cls: string; id: number }>,
) {
  for (const childCls of schema.classes) {
    for (const assoc of collectClassAssociations(schema, childCls.name)) {
      if (!assoc.isComposition || assoc.targetClass !== className) continue
      for (const child of instances[childCls.name] ?? []) {
        if (getAssocIds(child, assoc).includes(instanceId)) {
          cascadeQueue.push({ cls: childCls.name, id: child._id })
        }
      }
    }
  }
}

function removeReverseLinksForInstance(
  schema: CrudSchema,
  instances: Record<string, CrudInstance[]>,
  className: string,
  inst: CrudInstance,
) {
  for (const assoc of collectClassAssociations(schema, className)) {
    if (!assoc.reverseRoleName) continue
    const reverseAssoc = findReverseAssoc(schema, assoc)
    const targetIds = getAssocIds(inst, assoc)

    for (const tid of targetIds) {
      const targetInst = findInstanceInClassFamily(schema, instances, assoc.targetClass, tid)
      if (targetInst) {
        removeAssocId(targetInst, reverseAssoc ?? assoc.reverseRoleName, inst._id, reverseAssoc?.multiplicity.max)
      }
    }
  }
}

function deleteInstancesInPlace(
  schema: CrudSchema | null,
  instances: Record<string, CrudInstance[]>,
  seeds: Array<{ cls: string; id: number }>,
) {
  const cascadeQueue = [...seeds]
  const deleted = new Set<string>()

  while (cascadeQueue.length > 0) {
    const { cls, id } = cascadeQueue.pop()!
    const key = `${cls}:${id}`
    if (deleted.has(key)) continue
    deleted.add(key)

    const list = instances[cls] ?? []
    const inst = list.find((candidate) => candidate._id === id)
    if (!inst) continue

    if (schema) {
      enqueueCompositionChildren(schema, instances, cls, id, cascadeQueue)
      removeReverseLinksForInstance(schema, instances, cls, inst)
    }

    instances[cls] = list.filter((candidate) => candidate._id !== id)
  }
}
