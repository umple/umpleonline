/**
 * Form for one object in the object explorer.
 * Edits attributes and associations on the instance held in crudStore.
 */

import { useMemo, useState, useEffect } from 'react'
import { useCrudStore, type CrudInstance, assocKey, collectClassAssociations, collectClassInstances, getAssocIds, validateGlobalModel, validateInstance } from '@/stores/crudStore'
import type { CrudAttribute, CrudAssociation, CrudClass, CrudEnum } from '@/api/types'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

export function InstanceEditor() {
  const editingInstance = useCrudStore((s) => s.editingInstance)
  const closeEditor = useCrudStore((s) => s.closeEditor)
  const schema = useCrudStore((s) => s.schema)
  const instances = useCrudStore((s) => s.instances)
  const createInstance = useCrudStore((s) => s.createInstance)
  const updateInstance = useCrudStore((s) => s.updateInstance)
  const validationErrors = useCrudStore((s) => s.validationErrors)
  const setValidationErrors = useCrudStore((s) => s.setValidationErrors)

  const isOpen = editingInstance !== null

  const cls = schema?.classes.find((c) => c.name === editingInstance?.className)
  const isNew = editingInstance?.instanceId === null
  const existing = !isNew && cls
    ? (instances[cls.name] ?? []).find((i) => i._id === editingInstance?.instanceId)
    : undefined
  const classAssociations = useMemo(
    () => (schema && cls ? collectClassAssociations(schema, cls.name) : []),
    [schema, cls],
  )

  const [formData, setFormData] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!cls) return
    if (existing) {
      const data: Record<string, unknown> = {}
      for (const attr of cls.attributes) {
        data[attr.name] = existing[attr.name] ?? getDefaultValue(attr)
      }
      for (const assoc of classAssociations) {
        if (!assoc.isNavigable) continue
        const key = assocKey(assoc)
        const ids = getAssocIds(existing, assoc)
        data[key] = assoc.multiplicity.max === 1 ? ids[0] : ids
      }
      setFormData(data)
    } else {
      const data: Record<string, unknown> = {}
      for (const attr of cls.attributes) {
        data[attr.name] = getDefaultValue(attr)
      }
      for (const assoc of classAssociations) {
        if (!assoc.isNavigable) continue
        data[assocKey(assoc)] = assoc.multiplicity.max === 1 ? undefined : []
      }
      setFormData(data)
    }
  }, [classAssociations, cls, existing])

  const handleSave = () => {
    if (!cls || !editingInstance || !schema) return

    const errors = validateInstance(schema, cls.name, formData, instances, editingInstance.instanceId)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }

    if (isNew) {
      createInstance(cls.name, formData)
    } else if (editingInstance.instanceId !== null) {
      updateInstance(cls.name, editingInstance.instanceId, formData)
    }
    closeEditor()
  }

  const setField = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
    // Clear validation error for this field when user changes it
    if (validationErrors.length > 0) {
      setValidationErrors(validationErrors.filter((e) => e.field !== name))
    }
  }

  const fieldError = (field: string) => validationErrors.find((e) => e.field === field)?.message

  const navigableAssocs = classAssociations.filter((assoc) => assoc.isNavigable)

  // Check if required associations can be satisfied
  const missingTargets = navigableAssocs
    .filter((a) => a.multiplicity.min > 0)
    .filter((a) => schema ? collectClassInstances(schema, instances, a.targetClass).length === 0 : true)

  const pendingGlobalValidation = useMemo(() => {
    if (!schema || !cls || !editingInstance || Object.keys(formData).length === 0) return { messages: [], count: 0 }

    return validateGlobalModel(schema, instances, {
      className: cls.name,
      instanceId: editingInstance.instanceId,
      newInstance: {
        _id: editingInstance.instanceId ?? -1,
        ...formData,
      } as CrudInstance,
    })
  }, [cls, editingInstance, formData, instances, schema])

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closeEditor() }}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isNew ? `New ${cls?.name ?? ''}` : `Edit ${cls?.name ?? ''} #${editingInstance?.instanceId}`}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {missingTargets.length > 0 && isNew && (
            <div className="rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-ink-muted">
              <p className="font-medium text-status-warning mb-1">Required associations need instances first:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {missingTargets.map((a) => (
                  <li key={assocKey(a)}>
                    {a.multiplicity.raw} {a.targetClass}
                    {a.roleName ? ` (${a.roleName})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingGlobalValidation.messages.length > 0 && (
            <div className="rounded-md border border-status-error/30 bg-status-error/5 px-3 py-2 text-xs text-status-error">
              <p className="font-medium mb-1">
                Model-wide issue{pendingGlobalValidation.count === 1 ? '' : 's'} after this change:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {pendingGlobalValidation.messages.map((message, index) => (
                  <li key={`${index}:${message}`}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {cls?.attributes.map((attr) => (
            <AttributeField
              key={attr.name}
              attr={attr}
              value={formData[attr.name]}
              onChange={(v) => setField(attr.name, v)}
              enums={schema?.enums ?? []}
              error={fieldError(attr.name)}
            />
          ))}

          {navigableAssocs.length > 0 && (
            <>
              <div className="border-t border-border pt-3 mt-4">
                <h4 className="text-xxs font-semibold text-ink-muted uppercase tracking-wider mb-2">Associations</h4>
              </div>
              {navigableAssocs.map((assoc) => (
                <AssociationField
                  key={assocKey(assoc)}
                  assoc={assoc}
                  value={formData[assocKey(assoc)]}
                  onChange={(v) => setField(assocKey(assoc), v)}
                  targetInstances={schema ? collectClassInstances(schema, instances, assoc.targetClass) : []}
                  targetClassName={assoc.targetClass}
                  currentInstanceId={editingInstance?.instanceId ?? undefined}
                  error={fieldError(assocKey(assoc))}
                />
              ))}
            </>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={closeEditor}
            className="px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink rounded-md hover:bg-surface-1 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium text-ink-inverse bg-brand hover:bg-brand-hover rounded-md transition-colors cursor-pointer"
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function AttributeField({ attr, value, onChange, enums, error }: {
  attr: CrudAttribute
  value: unknown
  onChange: (v: unknown) => void
  enums: CrudEnum[]
  error?: string
}) {
  const typeLower = attr.type.toLowerCase()

  if (attr.typeKind === 'enum') {
    const enumDef = enums.find((e) => e.name === attr.type)
    return (
      <FieldWrapper attr={attr} error={error}>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
        >
          <option value="">Select...</option>
          {enumDef?.values.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </FieldWrapper>
    )
  }

  if (typeLower === 'boolean') {
    return (
      <FieldWrapper attr={attr} error={error}>
        <Switch
          size="sm"
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </FieldWrapper>
    )
  }

  if (typeLower === 'integer' || typeLower === 'int' || typeLower === 'float' || typeLower === 'double') {
    return (
      <FieldWrapper attr={attr} error={error}>
        <input
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') { onChange(undefined); return }
            onChange(typeLower === 'integer' || typeLower === 'int' ? parseInt(v, 10) : parseFloat(v))
          }}
          step={typeLower === 'integer' || typeLower === 'int' ? '1' : 'any'}
          className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
        />
      </FieldWrapper>
    )
  }

  if (typeLower === 'date') {
    return (
      <FieldWrapper attr={attr} error={error}>
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
        />
      </FieldWrapper>
    )
  }

  if (typeLower === 'time') {
    return (
      <FieldWrapper attr={attr} error={error}>
        <input
          type="time"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
        />
      </FieldWrapper>
    )
  }

  return (
    <FieldWrapper attr={attr} error={error}>
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
      />
    </FieldWrapper>
  )
}

function FieldWrapper({ attr, error, children }: { attr: CrudAttribute; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span className={attr.isInherited ? 'italic' : ''}>{attr.name}</span>
        <span className="text-xxs text-ink-faint">{attr.type}</span>
        {attr.isInherited && attr.inheritedFrom && (
          <span className="text-xxs text-ink-faint italic">from {attr.inheritedFrom}</span>
        )}
      </label>
      {children}
      {error && <p className="text-xxs text-status-error">{error}</p>}
    </div>
  )
}

function AssociationField({ assoc, value, onChange, targetInstances, targetClassName, currentInstanceId, error }: {
  assoc: CrudAssociation
  value: unknown
  onChange: (v: unknown) => void
  targetInstances: CrudInstance[]
  targetClassName: string
  currentInstanceId?: number
  error?: string
}) {
  const isToOne = assoc.multiplicity.max === 1
  const label = assoc.roleName || targetClassName
  // Filter out self when reflexive
  const available = assoc.isReflexive
    ? targetInstances.filter((i) => i._id !== currentInstanceId)
    : targetInstances

  if (isToOne) {
    return (
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span>{label}</span>
          <span className="text-xxs text-ink-faint">
            {assoc.multiplicity.raw} {targetClassName}
            {assoc.isComposition && <span className="text-status-warning ml-1">(composition)</span>}
          </span>
        </label>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full px-2 py-1.5 text-xs bg-surface-0 border border-border rounded-md text-ink focus:outline-none focus:border-brand"
        >
          <option value="">None</option>
          {available.map((inst) => (
            <option key={inst._id} value={inst._id}>
              {targetClassName} #{inst._id}
              {inst.name ? ` - ${inst.name}` : ''}
            </option>
          ))}
        </select>
        {error && <p className="text-xxs text-status-error">{error}</p>}
      </div>
    )
  }

  const selected = Array.isArray(value) ? (value as number[]) : []

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span>{label}</span>
        <span className="text-xxs text-ink-faint">
          {assoc.multiplicity.raw} {targetClassName}
          {assoc.isComposition && <span className="text-status-warning ml-1">(composition)</span>}
        </span>
        <span className="text-xxs text-ink-faint ml-auto tabular-nums">{selected.length} selected</span>
      </label>
      {available.length === 0 ? (
        <p className="text-xxs text-ink-faint">No {targetClassName} instances available</p>
      ) : (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {available.map((inst) => (
            <label key={inst._id} className="flex items-center gap-2 px-1 py-0.5 text-xs text-ink hover:bg-surface-1 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(inst._id)}
                onChange={() => toggle(inst._id)}
                className="rounded border-border"
              />
              {targetClassName} #{inst._id}
              {inst.name ? ` - ${String(inst.name)}` : ''}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xxs text-status-error">{error}</p>}
    </div>
  )
}

function getDefaultValue(attr: CrudAttribute): unknown {
  const t = attr.type.toLowerCase()
  if (t === 'boolean') return false
  if (t === 'integer' || t === 'int' || t === 'float' || t === 'double') return undefined
  return ''
}
