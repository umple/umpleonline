/**
 * React Flow canvas for the editable class diagram.
 * Structural edits go through useDiagramSync to POST /api/sync. Layout and display options come from the toolbar.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePreferencesStore } from '../../stores/preferencesStore'
import { useEphemeralStore } from '../../stores/ephemeralStore'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  useNodesInitialized,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Node,
  type Edge,
  type Connection,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react'
import { useSessionStore } from '../../stores/sessionStore'
import { ClassNode } from './nodes/ClassNode'
import { AssociationEdge, LabelRegistry, LabelRegistryContext } from './edges/AssociationEdge'
import { DiagramControls } from './DiagramControls'
import { DiagramContextMenu } from './menus/DiagramContextMenu'
import { NodeContextMenu } from './menus/NodeContextMenu'
import { EdgeContextMenu } from './menus/EdgeContextMenu'
import { ConnectionTypeMenu, type ConnectionChoice } from './menus/ConnectionTypeMenu'
import { useDiagramSync } from '../../hooks/useDiagramSync'
import { extractClassName, edgeDeletionParams, handleToOffset } from '../../lib/diagramHelpers'
import { convertClassDiagram } from '../../hooks/diagrams/classConverter'
import type { UmpleModel, GvLayout, StoredLayoutMetadata } from '../../api/types'

const nodeTypes = { classNode: ClassNode }
const edgeTypes = { association: AssociationEdge }

// ── Types ──

interface RfState { nodes: Node[]; edges: Edge[] }

// ── Keyboard helpers ──

function handleDeleteKey(
  e: KeyboardEvent,
  rfRef: React.RefObject<RfState>,
  setRf: React.Dispatch<React.SetStateAction<RfState>>,
  sync: (action: string, params: Record<string, string>) => Promise<unknown>,
): boolean {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return false

  const { selectedNodeId, selectedEdgeId } = useEphemeralStore.getState()

  if (selectedNodeId) {
    e.preventDefault()
    const className = extractClassName(selectedNodeId)
    setRf((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== selectedNodeId),
      edges: prev.edges.filter((ed) => ed.source !== selectedNodeId && ed.target !== selectedNodeId),
    }))
    useEphemeralStore.getState().setSelectedNode(null)
    sync('removeClass', { className })
    return true
  }
  if (selectedEdgeId) {
    e.preventDefault()
    const edge = rfRef.current.edges.find((ed) => ed.id === selectedEdgeId)
    if (edge) {
      const { action, params } = edgeDeletionParams(edge)
      setRf((prev) => ({ ...prev, edges: prev.edges.filter((ed) => ed.id !== selectedEdgeId) }))
      useEphemeralStore.getState().setSelectedEdge(null)
      sync(action, params)
    }
    return true
  }
  return false
}

function handleRenameKey(e: KeyboardEvent): boolean {
  if (e.key !== 'F2') return false
  const { selectedNodeId, setEditing } = useEphemeralStore.getState()
  if (!selectedNodeId) return false
  e.preventDefault()
  setEditing(selectedNodeId, 'name')
  return true
}

function handleEscapeKey(e: KeyboardEvent, closeAllMenus: () => void): boolean {
  if (e.key !== 'Escape') return false
  const { editingNodeId, setEditing, setSelectedNode, setSelectedEdge } = useEphemeralStore.getState()
  if (editingNodeId) {
    setEditing(null, null)
  } else {
    setSelectedNode(null)
    setSelectedEdge(null)
  }
  closeAllMenus()
  return true
}

function handleUndoRedo(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.key !== 'z') return false
  e.preventDefault()
  if (e.shiftKey) {
    useSessionStore.getState().redo()
  } else {
    useSessionStore.getState().undo()
  }
  return true
}

// ── Auto-fit viewport ──

function AutoFitView({ nodeKey }: { nodeKey: string }) {
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const prevKeyRef = useRef('')

  useLayoutEffect(() => {
    if (!nodesInitialized) return
    if (prevKeyRef.current === nodeKey) return
    prevKeyRef.current = nodeKey
    fitView({ padding: 0.15, duration: 0, maxZoom: 1 })
  }, [nodesInitialized, nodeKey, fitView])

  return null
}

// ── Context menu state ──

interface MenuState<T = undefined> {
  position: { x: number; y: number } | null
  data: T
}

// ── Public API ──

export interface UmpleDiagramProps {
  /** The parsed Umple model (classes, associations, interfaces). */
  model: UmpleModel
  /** Graphviz layout metadata for positioning nodes and edges. */
  layout?: GvLayout
  /** Names of elements with explicitly persisted positions in the hidden layout section. */
  storedLayout?: StoredLayoutMetadata
  /** Whether the diagram supports editing (drag, context menus, keyboard shortcuts). */
  editable?: boolean
}

const UmpleDiagramComponent = ({ model, layout, storedLayout, editable = true }: UmpleDiagramProps) => {
  return (
    <ReactFlowProvider>
      <UmpleDiagramInner model={model} layout={layout} storedLayout={storedLayout} editable={editable} />
    </ReactFlowProvider>
  )
}

export const UmpleDiagram = memo(UmpleDiagramComponent)
UmpleDiagram.displayName = 'UmpleDiagram'

// ── Inner component (inside ReactFlowProvider) ──

function UmpleDiagramInner({ model, layout, storedLayout, editable = true }: UmpleDiagramProps) {
  // Convert UmpleModel → ReactFlow nodes/edges
  const converted = useMemo(() => convertClassDiagram(model, layout, storedLayout), [model, layout, storedLayout])

  // Single state slot for nodes+edges — atomic updates, one render per change
  const [rf, setRf] = useState<RfState>({ nodes: converted.nodes, edges: converted.edges })
  const { nodes, edges } = rf

  // Label collision registry — reset each render cycle
  const labelRegistry = useRef(new LabelRegistry()).current
  const renderGen = useRef(0)
  labelRegistry.reset(++renderGen.current)

  // Ref for stable keyboard handler access (avoids listener churn)
  const rfRef = useRef(rf)
  rfRef.current = rf

  // Update when model/layout changes — preserve existing node positions so that
  // a Graphviz re-layout (triggered by sync or code edit) doesn't overwrite
  // positions the user has already arranged.  Only genuinely new nodes receive
  // the computed (Graphviz / stored-layout) position.
  const prevConvertedRef = useRef(converted)
  useEffect(() => {
    if (prevConvertedRef.current === converted) return
    prevConvertedRef.current = converted
    const storedIds = new Set(
      (storedLayout?.nodeNames ?? []).map((name) => `class-${name}`),
    )
    setRf((prev) => {
      const prevPositions = new Map(prev.nodes.map((n) => [n.id, n.position]))
      return {
        nodes: converted.nodes.map((n) => {
          // Nodes with stored positions have authoritative coords from the code —
          // always honour them so undo/redo and model switches work correctly.
          if (storedIds.has(n.id)) return n
          // Auto-laid-out nodes: preserve local position to prevent Graphviz thrashing.
          const existing = prevPositions.get(n.id)
          return existing ? { ...n, position: existing } : n
        }),
        edges: converted.edges,
      }
    })
  }, [converted, storedLayout])

  // Keep session store in sync so child components (ClassNode, DiagramControls) can read from it
  const setDiagramData = useSessionStore((s) => s.setDiagramData)
  useEffect(() => {
    setDiagramData('class', nodes, edges)
  }, [nodes, edges, setDiagramData])

  const setSelectedNode = useEphemeralStore((s) => s.setSelectedNode)
  const setSelectedEdge = useEphemeralStore((s) => s.setSelectedEdge)
  const updateNodePosition = useSessionStore((s) => s.updateNodePosition)
  const theme = usePreferencesStore((s) => s.theme)
  const rfColorMode = theme === 'system' ? 'system' : theme
  const { sync } = useDiagramSync()
  const { screenToFlowPosition, getNode } = useReactFlow()

  // Context menu states
  const [paneMenu, setPaneMenu] = useState<MenuState & { flowPosition: { x: number; y: number } | null }>({
    position: null, data: undefined, flowPosition: null,
  })
  const [nodeMenu, setNodeMenu] = useState<MenuState<string>>({ position: null, data: '' })
  const [edgeMenu, setEdgeMenu] = useState<MenuState<string>>({ position: null, data: '' })
  const [connectionMenu, setConnectionMenu] = useState<MenuState<Connection | null>>({ position: null, data: null })

  const closeAllMenus = useCallback(() => {
    setPaneMenu({ position: null, data: undefined, flowPosition: null })
    setNodeMenu({ position: null, data: '' })
    setEdgeMenu({ position: null, data: '' })
    setConnectionMenu({ position: null, data: null })
  }, [])

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setRf((prev) => ({ ...prev, nodes: applyNodeChanges(changes, prev.nodes) }))
      for (const c of changes) {
        if (c.type === 'select' && c.selected) {
          setSelectedNode(c.id)
          setSelectedEdge(null)
        }
      }
    },
    [setSelectedNode, setSelectedEdge]
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setRf((prev) => ({ ...prev, edges: applyEdgeChanges(changes, prev.edges) }))
      for (const c of changes) {
        if (c.type === 'select' && c.selected) {
          setSelectedEdge(c.id)
          setSelectedNode(null)
        }
      }
    },
    [setSelectedEdge, setSelectedNode]
  )

  const onNodeDragStop = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      if (!editable) return
      updateNodePosition(node.id, node.position.x, node.position.y)
      const className = extractClassName(node.id)

      await sync('editPosition', {
        className,
        x: String(Math.round(node.position.x)),
        y: String(Math.round(node.position.y)),
      })
    },
    [editable, updateNodePosition, sync]
  )

  // Context menu handlers
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      if (!editable) return
      event.preventDefault()
      closeAllMenus()
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setPaneMenu({
        position: { x: event.clientX, y: event.clientY },
        data: undefined,
        flowPosition: flowPos,
      })
    },
    [editable, closeAllMenus, screenToFlowPosition]
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!editable) return
      event.preventDefault()
      closeAllMenus()
      setNodeMenu({ position: { x: event.clientX, y: event.clientY }, data: node.id })
    },
    [editable, closeAllMenus]
  )

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!editable) return
      event.preventDefault()
      closeAllMenus()
      setEdgeMenu({ position: { x: event.clientX, y: event.clientY }, data: edge.id })
    },
    [editable, closeAllMenus]
  )

  // Connection drawing
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!editable) return
      if (!connection.source || !connection.target) return
      setConnectionMenu({
        position: lastMouseRef.current,
        data: connection,
      })
    },
    [editable]
  )

  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const handleMouseMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleConnectionChoice = useCallback(
    async (type: ConnectionChoice) => {
      const conn = connectionMenu.data
      if (!conn) return
      const sourceClass = extractClassName(conn.source!)
      const targetClass = extractClassName(conn.target!)

      setConnectionMenu({ position: null, data: null })

      if (type === 'generalization') {
        await sync('addGeneralization', {
          childClass: sourceClass,
          parentClass: targetClass,
        })
      } else {
        const sourceNode = getNode(conn.source!)
        const targetNode = getNode(conn.target!)
        const srcOff = handleToOffset(conn.sourceHandle, sourceNode?.measured?.width ?? 0, sourceNode?.measured?.height ?? 0)
        const tgtOff = handleToOffset(conn.targetHandle, targetNode?.measured?.width ?? 0, targetNode?.measured?.height ?? 0)
        await sync('addAssociation', {
          classOneId: sourceClass,
          classTwoId: targetClass,
          offsetOneX: String(srcOff.x),
          offsetOneY: String(srcOff.y),
          offsetTwoX: String(tgtOff.x),
          offsetTwoY: String(tgtOff.y),
        })
      }
    },
    [connectionMenu.data, sync, getNode]
  )

  // Keyboard handlers (stable — reads nodes/edges via ref)
  useEffect(() => {
    if (!editable) return

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (handleDeleteKey(e, rfRef, setRf, sync)) return
      if (handleRenameKey(e)) return
      if (handleEscapeKey(e, closeAllMenus)) return
      if (handleUndoRedo(e)) return
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editable, sync, closeAllMenus])

  // Stable key for auto-fit (triggers when the set of node IDs changes)
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join(','), [nodes])

  return (
    <LabelRegistryContext.Provider value={labelRegistry}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => { setSelectedNode(node.id); setSelectedEdge(null) }}
        onEdgeClick={(_, edge) => { setSelectedEdge(edge.id); setSelectedNode(null) }}
        onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); closeAllMenus() }}
        onPaneContextMenu={editable ? onPaneContextMenu : undefined}
        onNodeContextMenu={editable ? onNodeContextMenu : undefined}
        onEdgeContextMenu={editable ? onEdgeContextMenu : undefined}
        onConnect={editable ? onConnect : undefined}
        onMouseMove={handleMouseMove}
        colorMode={rfColorMode}
        minZoom={0.2}
        maxZoom={2}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'association' }}
        deleteKeyCode={null}
        nodesDraggable={editable}
        nodesConnectable={editable}
      >
        <Background />
        <DiagramControls allowClassEditing={editable} />
        <AutoFitView nodeKey={nodeKey} />

        {/* SVG marker definitions for edge types */}
        <svg className="absolute w-0 h-0">
          <defs>
            <marker id="triangle" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="none" stroke="var(--color-border-strong)" strokeWidth="1" />
            </marker>
            <marker id="diamond-filled" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
              <path d="M 0 6 L 6 0 L 12 6 L 6 12 z" fill="var(--color-border-strong)" stroke="var(--color-border-strong)" strokeWidth="1" />
            </marker>
            <marker id="diamond" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
              <path d="M 0 6 L 6 0 L 12 6 L 6 12 z" fill="var(--color-surface-0)" stroke="var(--color-border-strong)" strokeWidth="1" />
            </marker>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinejoin="round" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>

      {/* Context menus rendered as portals outside ReactFlow */}
      {editable && (
        <>
          <DiagramContextMenu
            position={paneMenu.position}
            flowPosition={paneMenu.flowPosition}
            onClose={() => setPaneMenu({ position: null, data: undefined, flowPosition: null })}
          />
          <NodeContextMenu
            position={nodeMenu.position}
            nodeId={nodeMenu.data}
            onClose={() => setNodeMenu({ position: null, data: '' })}
          />
          <EdgeContextMenu
            position={edgeMenu.position}
            edgeId={edgeMenu.data}
            onClose={() => setEdgeMenu({ position: null, data: '' })}
          />
          <ConnectionTypeMenu
            position={connectionMenu.position}
            onSelect={handleConnectionChoice}
            onClose={() => setConnectionMenu({ position: null, data: null })}
          />
        </>
      )}
    </LabelRegistryContext.Provider>
  )
}
