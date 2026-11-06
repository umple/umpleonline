/**
 * Table of instances for the class selected in the object explorer.
 * Rows come from crudStore. Opening a row edits it in InstanceEditor.
 */

import { useState } from 'react'
import { Plus, Pencil, Trash2, Trash, ChevronRight, ChevronDown } from 'lucide-react'
import { useCrudStore, type CrudInstance, assocKey, getAssocIds, classHasCompositionChildren, collectClassAssociations, collectClassInstances } from '@/stores/crudStore'
import type { CrudAssociation, CrudClass, CrudSchema } from '@/api/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'

const EMPTY_INSTANCES: CrudInstance[] = []

export function InstanceTable({ cls }: { cls: CrudClass }) {
  const schema = useCrudStore((s) => s.schema)
  const instances = useCrudStore((s) => s.instances[cls.name] ?? EMPTY_INSTANCES)
  const allInstances = useCrudStore((s) => s.instances)
  const openEditor = useCrudStore((s) => s.openEditor)
  const deleteInstance = useCrudStore((s) => s.deleteInstance)
  const clearAllInstances = useCrudStore((s) => s.clearAllInstances)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const visibleAttrs = cls.attributes.slice(0, 8)
  const hiddenAttrCount = cls.attributes.length - visibleAttrs.length
  const navigableAssocs = schema
    ? collectClassAssociations(schema, cls.name).filter((assoc) => assoc.isNavigable)
    : cls.associations.filter((assoc) => assoc.isNavigable)
  const hasAssocs = navigableAssocs.length > 0
  const deletesComposedChildren = classHasCompositionChildren(schema, cls.name)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-ink">{cls.name}</h3>
          <span className="text-xs text-ink-faint tabular-nums">{instances.length} instance{instances.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          {instances.length > 0 && (
            <Tip content="Clear all instances" side="bottom">
              <button
                onClick={() => clearAllInstances(cls.name)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-ink-faint hover:text-status-error transition-colors cursor-pointer rounded-md hover:bg-surface-1"
              >
                <Trash className="size-3" />
                Clear{deletesComposedChildren ? ' (cascade)' : ''}
              </button>
            </Tip>
          )}
          <Tip content="New instance" side="bottom">
            <button
              onClick={() => openEditor(cls.name, null)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light rounded-md transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              New
            </button>
          </Tip>
        </div>
      </div>

      {instances.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-ink-muted">No instances yet</p>
            <button
              onClick={() => openEditor(cls.name, null)}
              className="mt-2 text-xs text-brand hover:underline cursor-pointer"
            >
              Create the first {cls.name}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-1/40">
                {hasAssocs && <th className="w-6" />}
                <th className="px-3 py-1.5 text-left font-medium text-ink-muted w-12">#</th>
                {visibleAttrs.map((attr) => (
                  <th key={attr.name} className="px-3 py-1.5 text-left font-medium text-ink-muted">
                    <span className={attr.isInherited ? 'italic' : ''}>{attr.name}</span>
                  </th>
                ))}
                {hiddenAttrCount > 0 && (
                  <th className="px-3 py-1.5 text-left font-medium text-ink-faint text-xxs">+{hiddenAttrCount} more</th>
                )}
                <th className="px-3 py-1.5 text-right font-medium text-ink-muted w-12" />
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => {
                const isExpanded = expandedRow === inst._id
                return (
                  <InstanceRow
                    key={inst._id}
                    inst={inst}
                    cls={cls}
                    visibleAttrs={visibleAttrs}
                    hiddenAttrCount={hiddenAttrCount}
                    hasAssocs={hasAssocs}
                    navigableAssocs={navigableAssocs}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpandedRow(isExpanded ? null : inst._id)}
                    onEdit={() => openEditor(cls.name, inst._id)}
                    onDelete={() => deleteInstance(cls.name, inst._id)}
                    allInstances={allInstances}
                    deletesComposedChildren={deletesComposedChildren}
                    schema={schema}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InstanceRow({
  inst, cls, visibleAttrs, hiddenAttrCount, hasAssocs, navigableAssocs, isExpanded,
  onToggleExpand, onEdit, onDelete, allInstances, deletesComposedChildren, schema,
}: {
  inst: CrudInstance
  cls: CrudClass
  visibleAttrs: CrudClass['attributes']
  hiddenAttrCount: number
  hasAssocs: boolean
  navigableAssocs: CrudAssociation[]
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
  allInstances: Record<string, CrudInstance[]>
  deletesComposedChildren: boolean
  schema: CrudSchema | null
}) {
  const colSpan = (hasAssocs ? 1 : 0) + 1 + visibleAttrs.length + (hiddenAttrCount > 0 ? 1 : 0) + 1

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface-1/30 transition-colors">
        {hasAssocs && (
          <td className="pl-2">
            <button
              onClick={onToggleExpand}
              className="p-0.5 rounded hover:bg-surface-2 transition-colors cursor-pointer text-ink-faint hover:text-ink"
            >
              {isExpanded
                ? <ChevronDown className="size-3" />
                : <ChevronRight className="size-3" />
              }
            </button>
          </td>
        )}
        <td className="px-3 py-1.5 text-ink-faint tabular-nums">{inst._id}</td>
        {visibleAttrs.map((attr) => (
          <td key={attr.name} className="px-3 py-1.5 text-ink max-w-48 truncate">
            {formatValue(inst[attr.name])}
          </td>
        ))}
        {hiddenAttrCount > 0 && <td />}
        <td className="px-3 py-1.5 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger className="p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer text-ink-faint hover:text-ink outline-none">
              <span className="sr-only">Actions</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onSelect={onEdit} className="text-xs gap-2">
                <Pencil className="size-3" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-xs gap-2 text-status-error focus:text-status-error"
              >
                <Trash2 className="size-3" />
                Delete{deletesComposedChildren ? ' (cascade)' : ''}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-surface-1/20">
          <td colSpan={colSpan} className="px-4 py-2">
            <AssociationDetail inst={inst} assocs={navigableAssocs} allInstances={allInstances} schema={schema} />
          </td>
        </tr>
      )}
    </>
  )
}

function AssociationDetail({ inst, assocs, allInstances, schema }: {
  inst: CrudInstance
  assocs: CrudAssociation[]
  allInstances: Record<string, CrudInstance[]>
  schema: CrudSchema | null
}) {
  return (
    <div className="space-y-2">
      {assocs.map((assoc) => {
        const ids = getAssocIds(inst, assoc)
        const targetInstances = schema
          ? collectClassInstances(schema, allInstances, assoc.targetClass)
          : (allInstances[assoc.targetClass] ?? [])
        const assocRowKey = assocKey(assoc)

        return (
          <div key={assocRowKey}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xxs font-semibold text-ink-muted uppercase tracking-wider">
                {assoc.roleName || assoc.targetClass}
              </span>
              <span className="text-xxs text-ink-faint">
                {assoc.multiplicity.raw} {assoc.targetClass}
                {assoc.isComposition && ' (composition)'}
              </span>
            </div>
            {ids.length === 0 ? (
              <span className="text-xxs text-ink-faint italic">none</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {ids.map((id) => {
                  const target = targetInstances.find((instance) => instance._id === id)
                  const label = target
                    ? `${assoc.targetClass} #${id}${target.name ? ` - ${String(target.name)}` : ''}`
                    : `#${id} (deleted)`
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center px-1.5 py-0.5 text-xxs rounded bg-surface-2 text-ink-muted"
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return '-'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (Array.isArray(val)) return `[${val.length}]`
  return String(val)
}
