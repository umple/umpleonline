/**
 * Object explorer shown when that generate target is selected.
 * Lists classes, edits instances, and draws the instance diagram from crudStore.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Loader2, RefreshCw, Download, Upload, Network, X, Dices } from 'lucide-react'
import { useCrudStore, buildCrudSchemaRequestKey } from '@/stores/crudStore'
import { useSessionStore } from '@/stores/sessionStore'
import { ClassList } from './ClassList'
import { InstanceTable } from './InstanceTable'
import { InstanceEditor } from './InstanceEditor'
import { Tip } from '@/components/ui/tooltip'
import { SmartSvgView } from '@/components/diagram/SmartSvgView'
import { api } from '@/api/client'
import { generateInstanceDiagramDot } from './instanceDiagram'

export function ObjectExplorer() {
  const schema = useCrudStore((s) => s.schema)
  const schemaLoading = useCrudStore((s) => s.schemaLoading)
  const schemaError = useCrudStore((s) => s.schemaError)
  const schemaRequestKey = useCrudStore((s) => s.schemaRequestKey)
  const selectedClass = useCrudStore((s) => s.selectedClass)
  const fetchSchema = useCrudStore((s) => s.fetchSchema)
  const exportJson = useCrudStore((s) => s.exportJson)
  const importJson = useCrudStore((s) => s.importJson)
  const instances = useCrudStore((s) => s.instances)
  const adjustmentMessages = useCrudStore((s) => s.adjustmentMessages)
  const globalValidationErrors = useCrudStore((s) => s.globalValidationErrors)
  const globalValidationCount = useCrudStore((s) => s.globalValidationCount)
  const generateRandomAll = useCrudStore((s) => s.generateRandomAll)

  const code = useSessionStore((s) => s.code)
  const sessionModelId = useSessionStore((s) => s.modelId)
  const crudModelId = useCrudStore((s) => s.crudModelId)

  // Prefer the CRUD-specific modelId so the backend reuses the same model
  // directory; fall back to the session-level modelId for first requests.
  const modelId = crudModelId ?? sessionModelId

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [diagramSvg, setDiagramSvg] = useState<string | null>(null)
  const [diagramLoading, setDiagramLoading] = useState(false)
  const currentSchemaRequestKey = code ? buildCrudSchemaRequestKey(code) : null

  useEffect(() => {
    if (!code) {
      // Editor is empty — clear stale schema and instances
      if (schema) {
        useCrudStore.setState({
          schema: null,
          schemaError: null,
          schemaRequestKey: null,
          crudModelId: null,
          selectedClass: null,
          instances: {},
          nextId: 1,
          editingInstance: null,
          validationErrors: [],
          adjustmentMessages: [],
          globalValidationErrors: [],
          globalValidationCount: 0,
        })
      }
      return
    }
    if (currentSchemaRequestKey !== schemaRequestKey) {
      fetchSchema(code, modelId ?? undefined)
    }
  }, [code, currentSchemaRequestKey, fetchSchema, modelId, schema, schemaRequestKey])

  const handleRefresh = () => {
    if (code) {
      fetchSchema(code, modelId ?? undefined)
    }
  }

  const handleExport = () => {
    const json = exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'umple-crud-data.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importJson(reader.result)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleViewDiagram = useCallback(async () => {
    if (!schema) return
    const dot = generateInstanceDiagramDot(schema, instances)
    setDiagramLoading(true)
    try {
      const res = await api.crudDiagram(dot)
      if (res.error) {
        console.error('Diagram error:', res.error)
        return
      }
      setDiagramSvg(res.svg)
    } catch (err) {
      console.error('Failed to render diagram:', err)
    } finally {
      setDiagramLoading(false)
    }
  }, [schema, instances])

  const selectedCls = schema?.classes.find((c) => c.name === selectedClass)
  const hasGlobalErrors = globalValidationErrors.length > 0
  const hasAdjustmentMessages = adjustmentMessages.length > 0
  // Count total instances across all classes
  const totalInstances = Object.values(instances).reduce((sum, list) => sum + list.length, 0)

  if (schemaLoading && !schema) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Loading schema...
        </div>
      </div>
    )
  }

  if (!schema && schemaError) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <p className="text-sm text-status-error">{schemaError}</p>
          <button
            onClick={handleRefresh}
            className="mt-2 text-xs text-brand hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!schema || schema.classes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <p className="text-sm text-ink-muted">No classes in model</p>
          <p className="text-xs text-ink-faint mt-1">Write Umple code with classes to explore objects</p>
          {code && (
            <button
              onClick={handleRefresh}
              className="mt-2 text-xs text-brand hover:underline cursor-pointer"
            >
              Load schema
            </button>
          )}
        </div>
      </div>
    )
  }

  // Show diagram overlay
  if (diagramSvg) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <h3 className="text-sm font-medium text-ink">Instance Diagram</h3>
          <button
            onClick={() => setDiagramSvg(null)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-ink-muted hover:text-ink rounded-md hover:bg-surface-1 transition-colors cursor-pointer"
          >
            <X className="size-3" />
            Close
          </button>
        </div>
        <div className="flex-1 relative">
          <SmartSvgView svg={diagramSvg} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {hasAdjustmentMessages && (
        <div
          data-testid="crud-adjustment-banner"
          className="border-b border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-ink-muted"
        >
          <p className="font-medium text-status-warning">Schema adjustments applied.</p>
          <ul className="mt-1 list-disc pl-4 space-y-1">
            {adjustmentMessages.map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {hasGlobalErrors && (
        <div
          data-testid="crud-validation-banner"
          className="border-b border-status-error/30 bg-status-error/5 px-3 py-2 text-xs text-status-error"
        >
          <p className="font-medium">
            Total {globalValidationCount} validation error{globalValidationCount === 1 ? '' : 's'}.
          </p>
          <ul className="mt-1 list-disc pl-4 space-y-1">
            {globalValidationErrors.map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Class list sidebar */}
        <div className="w-44 shrink-0 border-r border-border flex flex-col">
          <ClassList />
          <div className="px-2 py-1.5 border-t border-border space-y-1">
            <div className="flex items-center gap-1">
              <Tip content="Refresh schema" side="right">
                <button
                  onClick={handleRefresh}
                  disabled={schemaLoading}
                  className="flex items-center gap-1 px-2 py-1 text-xxs text-ink-faint hover:text-ink-muted transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${schemaLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </Tip>
              <div className="ml-auto flex items-center gap-0.5">
                <Tip content="Export instances (JSON)" side="top">
                  <button
                    onClick={handleExport}
                    className="p-1 text-ink-faint hover:text-ink-muted transition-colors cursor-pointer rounded hover:bg-surface-1"
                  >
                    <Download className="size-3" />
                  </button>
                </Tip>
                <Tip content="Import instances (JSON)" side="top">
                  <button
                    onClick={handleImport}
                    className="p-1 text-ink-faint hover:text-ink-muted transition-colors cursor-pointer rounded hover:bg-surface-1"
                  >
                    <Upload className="size-3" />
                  </button>
                </Tip>
              </div>
            </div>
            <Tip content="Generate random instances for all classes with associations" side="right">
              <button
                onClick={generateRandomAll}
                className="flex items-center gap-1 w-full px-2 py-1 text-xxs text-ink-faint hover:text-ink-muted transition-colors cursor-pointer rounded hover:bg-surface-1"
              >
                <Dices className="size-3" />
                Generate All
              </button>
            </Tip>
            {totalInstances > 0 && (
              <Tip content="View instance diagram" side="right">
                <button
                  onClick={handleViewDiagram}
                  disabled={diagramLoading}
                  className="flex items-center gap-1 w-full px-2 py-1 text-xxs text-ink-faint hover:text-ink-muted transition-colors cursor-pointer disabled:opacity-50 rounded hover:bg-surface-1"
                >
                  {diagramLoading
                    ? <Loader2 className="size-3 animate-spin" />
                    : <Network className="size-3" />
                  }
                  Instance Diagram
                </button>
              </Tip>
            )}
          </div>
        </div>

        {/* Instance area */}
        <div className="flex-1 min-w-0">
          {selectedCls ? (
            <InstanceTable cls={selectedCls} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-ink-muted">Select a class to view instances</p>
            </div>
          )}
        </div>

        {/* Editor sheet */}
        <InstanceEditor />
      </div>
    </div>
  )
}
