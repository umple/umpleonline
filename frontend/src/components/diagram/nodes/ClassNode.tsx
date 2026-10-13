/**
 * One class box on the editable class diagram, including its attributes and connection handles.
 * UmpleDiagram registers this as the React Flow node type.
 */

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/sessionStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { useDiagramSync } from '@/hooks/useDiagramSync'
import { EditableField } from './EditableField'

export interface ClassNodeData {
  name: string
  attributes: { name: string; type: string }[]
  methods: { name: string; returnType: string; params: string; displayText?: string; removable?: boolean }[]
  isAbstract: boolean
  isInterface: boolean
  [key: string]: unknown
}

function validateClassName(value: string): string | null {
  if (!/^[A-Z]/.test(value)) return 'Must start with uppercase'
  if (!/^[A-Za-z_]\w*$/.test(value)) return 'Invalid identifier'
  return null
}

const handleCls = '!w-2.5 !h-2.5 !bg-brand !border-2 !border-surface-0 !rounded-full !opacity-0 group-hover:!opacity-100 !transition-opacity'

export const ClassNode = memo(function ClassNode({ id, data, selected }: NodeProps) {
  const d = data as ClassNodeData
  const isEditableView = useSessionStore((s) => s.viewMode === 'class')
  const showAttributes = usePreferencesStore((s) => s.showAttributes)
  const showMethods = usePreferencesStore((s) => s.showMethods)
  const editingNodeId = useEphemeralStore((s) => s.editingNodeId)
  const editingField = useEphemeralStore((s) => s.editingField)
  const { sync } = useDiagramSync()

  const isEditing = editingNodeId === id
  const isEditingName = isEditing && editingField === 'name'
  const isAddingAttribute = isEditing && editingField === 'newAttribute'
  const isAddingMethod = isEditing && editingField === 'newMethod'

  const clearEditing = useCallback(() => {
    useEphemeralStore.getState().setEditing(null, null)
  }, [])

  const handleNameDoubleClick = useCallback(() => {
    if (!isEditableView) return
    useEphemeralStore.getState().setEditing(id, 'name')
  }, [id, isEditableView])

  const handleRenameCommit = useCallback(async (newName: string) => {
    clearEditing()
    if (newName === d.name) return
    // Optimistic rename — update node id, data.name, and connected edges
    useSessionStore.getState().renameNode(id, newName)
    await sync('editClass', { className: d.name, newName })
  }, [id, d.name, sync, clearEditing])

  const handleAddAttributeCommit = useCallback(async (value: string) => {
    clearEditing()
    // Parse "name: Type" or just "name"
    const parts = value.split(':').map((s) => s.trim())
    const attributeName = parts[0]
    const attributeType = parts[1] || ''
    await sync('addAttribute', {
      className: d.name,
      attributeName,
      attributeType,
    })
  }, [d.name, sync, clearEditing])

  const handleAddMethodCommit = useCallback(async (value: string) => {
    clearEditing()
    // Parse "name(params): ReturnType" or just "name()"
    const match = value.match(/^(\w+)\(([^)]*)\)(?:\s*:\s*(.+))?$/)
    if (match) {
      await sync('addMethod', {
        className: d.name,
        methodName: match[1],
        methodType: match[3]?.trim() || 'void',
        methodParameters: match[2]?.trim() || '',
      })
    } else {
      // Simple name only
      await sync('addMethod', {
        className: d.name,
        methodName: value,
        methodType: 'void',
        methodParameters: '',
      })
    }
  }, [d.name, sync, clearEditing])

  const handleRemoveAttribute = useCallback(async (attrName: string) => {
    await sync('removeAttribute', { className: d.name, attributeName: attrName })
  }, [d.name, sync])

  const handleRemoveMethod = useCallback(async (methodName: string) => {
    await sync('removeMethod', { className: d.name, methodName })
  }, [d.name, sync])

  const headerClasses = d.isInterface
    ? 'bg-node-interface-bg text-node-interface-fg'
    : d.isAbstract
      ? 'bg-node-abstract-bg text-node-abstract-fg'
      : 'bg-node-class-bg text-node-class-fg'

  const visibleAttrs = showAttributes ? d.attributes : []
  const visibleMethods = showMethods ? d.methods : []
  const hasBody = visibleAttrs.length > 0 || visibleMethods.length > 0 || isAddingAttribute || isAddingMethod

  return (
    <div
      className={cn(
        'group h-full w-full bg-surface-0 border-2 shadow-md transition-shadow overflow-hidden',
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-border-strong',
      )}
      style={{ fontFamily: 'var(--font-diagram)', fontSize: '0.875rem' }}
      data-testid={`class-node-${d.name}`}
    >
      {/* Class name header */}
      <div
        className={cn('px-2.5 py-1.5 font-bold text-center', headerClasses, hasBody && 'border-b border-border-strong')}
        onDoubleClick={handleNameDoubleClick}
      >
        {isEditingName ? (
          <EditableField
            initialValue={d.name}
            placeholder="Class name"
            onCommit={handleRenameCommit}
            onCancel={clearEditing}
            validate={validateClassName}
          />
        ) : (
          d.name
        )}
      </div>

      {/* Attributes */}
      {(visibleAttrs.length > 0 || isAddingAttribute) && (
        <div className={cn('px-2.5 py-1', (visibleMethods.length > 0 || isAddingMethod) && 'border-b border-border-strong')}>
          {visibleAttrs.map((attr, i) => (
            <div key={i} className="group/attr flex items-center py-px">
              <span className="flex-1">
                {attr.type ? `${attr.name}: ${attr.type}` : attr.name}
              </span>
              <button
                onClick={() => handleRemoveAttribute(attr.name)}
                disabled={!isEditableView}
                className="opacity-0 group-hover/attr:opacity-100 ml-1 p-0.5 rounded hover:bg-destructive/10 text-ink-faint hover:text-destructive transition-opacity"
                aria-label={`Remove attribute ${attr.name}`}
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
          {isAddingAttribute && (
            <EditableField
              initialValue=""
              placeholder="name: Type"
              onCommit={handleAddAttributeCommit}
              onCancel={clearEditing}
              selectAll={false}
            />
          )}
        </div>
      )}

      {/* Methods */}
      {(visibleMethods.length > 0 || isAddingMethod) && (
        <div className="px-2.5 py-1">
          {visibleMethods.map((method, i) => (
            <div key={i} className="group/method flex items-center py-px">
              <span className="flex-1">
                {method.displayText ?? (method.returnType ? `${method.name}(${method.params}): ${method.returnType}` : `${method.name}(${method.params})`)}
              </span>
              {method.removable !== false && (
                <button
                  onClick={() => handleRemoveMethod(method.name)}
                  disabled={!isEditableView}
                  className="opacity-0 group-hover/method:opacity-100 ml-1 p-0.5 rounded hover:bg-destructive/10 text-ink-faint hover:text-destructive transition-opacity"
                  aria-label={`Remove method ${method.name}`}
                >
                  <X className="size-2.5" />
                </button>
              )}
            </div>
          ))}
          {isAddingMethod && (
            <EditableField
              initialValue=""
              placeholder="name(params): Type"
              onCommit={handleAddMethodCommit}
              onCancel={clearEditing}
              selectAll={false}
            />
          )}
        </div>
      )}

      {/* Connection handles — appear on node hover as branded dots */}
      <Handle type="source" position={Position.Top} id="top" className={handleCls} />
      <Handle type="source" position={Position.Right} id="right" className={handleCls} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={handleCls} />
      <Handle type="source" position={Position.Left} id="left" className={handleCls} />
      {/* Self-loop edge routing (invisible, non-interactive) */}
      <Handle type="source" position={Position.Right} id="right-source" className="!invisible" style={{ top: '20%' }} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="right-target" className="!invisible" style={{ top: '80%' }} isConnectable={false} />
    </div>
  )
})
