/**
 * The open model: tabs, Umple text, undo, the current diagram, and the selected generate target.
 * Most of the editor reads this store. Preferences that should survive a reload live in preferencesStore instead.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Node, Edge } from "@xyflow/react";
import type {
  UmpleModel,
  GvLayout,
  StoredLayoutMetadata,
  ApiTab,
  ExampleSetId,
} from "../api/types";
import { VIEW_OUTPUT_KIND } from "../constants/diagram";
import type { DiagramView } from "../constants/diagram";
import { CLASS_FILTER_DEFAULT_QUERY, normalizeClassFilterQuery } from "../lib/classDiagramFilters";
import { useEphemeralStore } from "./ephemeralStore";
import { ensureUmpExt } from "../lib/umpFile";

// ── Diagram types ──
export type { DiagramView } from "../constants/diagram";
export { VIEW_OUTPUT_KIND } from "../constants/diagram";

interface DiagramElements {
  nodes: Node[];
  edges: Edge[];
}

const EMPTY_DIAGRAM_ELEMENTS: DiagramElements = { nodes: [], edges: [] };

// ── Editor types ──

export interface Tab {
  id: string;
  name: string;
  code: string;
  dirty: boolean;
  /** Snapshot of code when tab was created or last saved */
  savedCode: string;
  undoStack: string[];
  redoStack: string[];
  /** Per-tab diagram caches (saved/restored on tab switch) */
  svgCache?: Partial<Record<DiagramView, string>>;
  htmlCache?: Partial<Record<DiagramView, string>>;
  diagramData?: Partial<Record<DiagramView, DiagramElements>>;
  umpleModel?: UmpleModel | null;
  classLayout?: GvLayout | null;
  storedLayout?: StoredLayoutMetadata | null;
}

// ── Chat types ──

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: unknown[];
}

// ── Constants ──

const MAX_UNDO = 50;

const DEFAULT_CODE = "";

export function nextTabNumber(tabs: Array<{ name: string }>): number {
  const used = new Set(
    tabs
      .map((t) => t.name.match(/^untitled-(\d+)\.ump$/))
      .filter(Boolean)
      .map((m) => Number(m![1])),
  );
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// ── Store ──

interface SessionState {
  // Editor
  code: string;
  modelId: string | null;
  tabs: Tab[];
  activeTabId: string;
  selectedExample: string | null;
  selectedExampleId: string | null;
  selectedExampleSetId: ExampleSetId | null;
  generateTargetId: string;
  classFilterQuery: string;
  activeNamedFilters: string[];
  activeMixsets: string[];
  /** Set by setCodeFromSync so useCompiler can skip the debounce */
  syncPending: boolean;
  /** Bumped on tab rename/reorder to trigger a compile that persists tabs.json */
  tabsVersion: number;

  // Diagram content
  viewMode: DiagramView;
  umpleModel: UmpleModel | null;
  classLayout: GvLayout | null;
  storedLayout: StoredLayoutMetadata | null;
  diagramData: Partial<Record<DiagramView, DiagramElements>>;
  svgCache: Partial<Record<DiagramView, string>>;
  htmlCache: Partial<Record<DiagramView, string>>;

  // Agent panel
  showAgentPanel: boolean;
  showAgentBar: boolean;
  chatMessages: ChatMessage[];

  // Editor actions
  setCode: (code: string) => void;
  setCodeFromSync: (code: string) => void;
  clearSyncPending: () => void;
  undo: () => void;
  redo: () => void;
  setModelId: (id: string) => void;
  markSaved: (id?: string) => void;
  addTab: (tab: Omit<Tab, "dirty" | "savedCode">) => void;
  addNewTab: () => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  loadExample: (
    id: string,
    name: string,
    code: string,
    modelId?: string,
    setId?: ExampleSetId | null,
  ) => void;
  loadBlankModel: (setId?: ExampleSetId | null) => void;
  closeOtherTabs: (id: string) => void;
  restoreTabs: (tabs: ApiTab[], activeTabId: string) => void;
  setSelectedExample: (name: string | null) => void;
  setGenerateTargetId: (id: string) => void;
  setClassFilterQuery: (query: string) => void;
  toggleNamedFilter: (name: string) => void;
  toggleMixset: (name: string) => void;
  resetClassDiagramFilters: () => void;
  reconcileClassDiagramFilters: (namedFilters: string[], mixsets: string[]) => void;

  // Diagram actions
  setViewMode: (mode: DiagramView) => void;
  setUmpleModel: (
    model: UmpleModel | null,
    layout?: GvLayout | null,
    storedLayout?: StoredLayoutMetadata | null,
  ) => void;
  setDiagramData: (view: DiagramView, nodes: Node[], edges: Edge[]) => void;
  getDiagramData: (view: DiagramView) => DiagramElements;
  setSvgForView: (view: DiagramView, svg: string) => void;
  clearSvgCache: () => void;
  setHtmlForView: (view: DiagramView, html: string) => void;
  clearHtmlCache: () => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  renameNode: (oldId: string, newName: string) => void;

  // Agent panel actions
  openAgentPanel: () => void;
  closeAgentPanel: () => void;
  toggleAgentPanel: () => void;
  revealAgentBar: () => void;
  hideAgentBar: () => void;
  setChatMessages: (messages: ChatMessage[]) => void;
}

/** Returns the active tab's filename, or 'Model.ump' if no tab is active. */
export function getActiveTabName(): string {
  const { tabs, activeTabId } = useSessionStore.getState();
  return tabs.find((t) => t.id === activeTabId)?.name ?? "Model.ump";
}

export function selectClassFilterKey(
  s: Pick<SessionState, "classFilterQuery" | "activeNamedFilters" | "activeMixsets">,
): string {
  return JSON.stringify([s.classFilterQuery, s.activeNamedFilters, s.activeMixsets])
}

function suggestBlankTabName(tabs: Tab[], activeTabId: string): string {
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (!active) return "Model.ump";

  if (active.name === "Model.ump" || /^untitled-\d+\.ump$/.test(active.name)) {
    return active.name;
  }

  if (!tabs.some((tab) => tab.id !== activeTabId && tab.name === "Model.ump")) {
    return "Model.ump";
  }

  const next = nextTabNumber(tabs.filter((tab) => tab.id !== activeTabId));
  return `untitled-${next}.ump`;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      // ── Editor state ──
      code: DEFAULT_CODE,
      modelId: null,
      tabs: [
        {
          id: "main",
          name: "Model.ump",
          code: DEFAULT_CODE,
          dirty: false,
          savedCode: DEFAULT_CODE,
          undoStack: [],
          redoStack: [],
        },
      ],
      activeTabId: "main",
      selectedExample: null,
      selectedExampleId: null,
      selectedExampleSetId: null,
      generateTargetId: "classDiagram",
      classFilterQuery: CLASS_FILTER_DEFAULT_QUERY,
      activeNamedFilters: [],
      activeMixsets: [],
      syncPending: false,
      tabsVersion: 0,

      // ── Diagram content ──
      viewMode: "class",
      umpleModel: null,
      classLayout: null,
      storedLayout: null,
      diagramData: {},
      svgCache: {},
      htmlCache: {},

      // ── Agent panel ──
      showAgentPanel: false,
      showAgentBar: false,
      chatMessages: [],

      // ── Editor actions ──

      setCode: (code) =>
        set((s) => ({
          code,
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId
              ? { ...t, code, dirty: code !== t.savedCode }
              : t,
          ),
        })),

      setCodeFromSync: (code) =>
        set((s) => {
          if (code === s.code) return s;
          return {
            code,
            syncPending: true,
            tabs: s.tabs.map((t) =>
              t.id === s.activeTabId
                ? {
                    ...t,
                    code,
                    dirty: code !== t.savedCode,
                    undoStack: [...t.undoStack.slice(-(MAX_UNDO - 1)), s.code],
                    redoStack: [],
                  }
                : t,
            ),
          };
        }),

      clearSyncPending: () => set({ syncPending: false }),

      undo: () =>
        set((s) => {
          const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
          if (!activeTab || activeTab.undoStack.length === 0) return s;
          const prev = activeTab.undoStack[activeTab.undoStack.length - 1];
          return {
            code: prev,
            tabs: s.tabs.map((t) =>
              t.id === s.activeTabId
                ? {
                    ...t,
                    code: prev,
                    dirty: prev !== t.savedCode,
                    undoStack: t.undoStack.slice(0, -1),
                    redoStack: [...t.redoStack, s.code],
                  }
                : t,
            ),
          };
        }),

      redo: () =>
        set((s) => {
          const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
          if (!activeTab || activeTab.redoStack.length === 0) return s;
          const next = activeTab.redoStack[activeTab.redoStack.length - 1];
          return {
            code: next,
            tabs: s.tabs.map((t) =>
              t.id === s.activeTabId
                ? {
                    ...t,
                    code: next,
                    dirty: next !== t.savedCode,
                    undoStack: [...t.undoStack, s.code],
                    redoStack: t.redoStack.slice(0, -1),
                  }
                : t,
            ),
          };
        }),

      setModelId: (modelId) => set({ modelId }),

      markSaved: (id) =>
        set((s) => {
          const targetId = id ?? s.activeTabId;
          return {
            tabs: s.tabs.map((t) =>
              t.id === targetId ? { ...t, dirty: false, savedCode: t.code } : t,
            ),
          };
        }),

      addTab: (tab) => {
        set((s) => ({
          // Save outgoing tab's diagram caches and model before switching
          tabs: [
            ...s.tabs.map((t) =>
              t.id === s.activeTabId
                ? {
                    ...t,
                    svgCache: s.svgCache,
                    htmlCache: s.htmlCache,
                    diagramData: s.diagramData,
                    umpleModel: s.umpleModel,
                    classLayout: s.classLayout,
                    storedLayout: s.storedLayout,
                  }
                : t,
            ),
            {
              ...tab,
              dirty: false,
              savedCode: tab.code,
              undoStack: [],
              redoStack: [],
            },
          ],
          activeTabId: tab.id,
          code: tab.code,
          // New tab starts with empty state
          svgCache: {},
          htmlCache: {},
          diagramData: {},
          umpleModel: null,
          classLayout: null,
          storedLayout: null,
        }));
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
          renderMode: "graphviz" as const,
        });
      },

      addNewTab: () => {
        set((s) => {
          const id = `tab-${Date.now()}`;
          const name = `untitled-${nextTabNumber(s.tabs)}.ump`;
          return {
            // Save outgoing tab's diagram caches and model before switching
            tabs: [
              ...s.tabs.map((t) =>
                t.id === s.activeTabId
                  ? {
                      ...t,
                      svgCache: s.svgCache,
                      htmlCache: s.htmlCache,
                      diagramData: s.diagramData,
                      umpleModel: s.umpleModel,
                      classLayout: s.classLayout,
                      storedLayout: s.storedLayout,
                    }
                  : t,
              ),
              {
                id,
                name,
                code: "",
                dirty: false,
                savedCode: "",
                undoStack: [],
                redoStack: [],
              },
            ],
            activeTabId: id,
            code: "",
            // New tab starts with empty state
            svgCache: {},
            htmlCache: {},
            diagramData: {},
            umpleModel: null,
            classLayout: null,
            storedLayout: null,
          };
        });
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
          renderMode: "graphviz" as const,
        });
      },

      removeTab: (id) => {
        const wasActive = get().activeTabId === id;
        set((s) => {
          const remaining = s.tabs.filter((t) => t.id !== id);
          if (remaining.length === 0) return s;

          if (s.activeTabId === id) {
            const removedIndex = s.tabs.findIndex((t) => t.id === id);
            const nextTab =
              remaining[Math.min(removedIndex, remaining.length - 1)];
            return {
              tabs: remaining,
              activeTabId: nextTab.id,
              code: nextTab.code,
              // Restore the next tab's diagram state
              svgCache: nextTab.svgCache ?? {},
              htmlCache: nextTab.htmlCache ?? {},
              diagramData: nextTab.diagramData ?? {},
              umpleModel: nextTab.umpleModel ?? null,
              classLayout: nextTab.classLayout ?? null,
              storedLayout: nextTab.storedLayout ?? null,
              tabsVersion: s.tabsVersion + 1,
            };
          }
          return { tabs: remaining, tabsVersion: s.tabsVersion + 1 };
        });
        if (wasActive) {
          useEphemeralStore.setState({
            selectedNodeId: null,
            selectedEdgeId: null,
            editingNodeId: null,
            editingField: null,
            renderMode: "graphviz" as const,
          });
        }
      },

      setActiveTab: (activeTabId) => {
        if (activeTabId === get().activeTabId) return;
        set((s) => {
          // Save outgoing tab's code, diagram caches, and model
          const updatedTabs = s.tabs.map((t) =>
            t.id === s.activeTabId
              ? {
                  ...t,
                  code: s.code,
                  svgCache: s.svgCache,
                  htmlCache: s.htmlCache,
                  diagramData: s.diagramData,
                  umpleModel: s.umpleModel,
                  classLayout: s.classLayout,
                  storedLayout: s.storedLayout,
                }
              : t,
          );
          const nextTab = updatedTabs.find((t) => t.id === activeTabId);
          if (!nextTab) return s;
          return {
            tabs: updatedTabs,
            activeTabId,
            code: nextTab.code,
            // Restore incoming tab's diagram state (empty/null for new tabs)
            svgCache: nextTab.svgCache ?? {},
            htmlCache: nextTab.htmlCache ?? {},
            diagramData: nextTab.diagramData ?? {},
            umpleModel: nextTab.umpleModel ?? null,
            classLayout: nextTab.classLayout ?? null,
            storedLayout: nextTab.storedLayout ?? null,
          };
        });
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
          renderMode: "graphviz" as const,
        });
      },

      renameTab: (id, rawName) =>
        set((s) => {
          const name = ensureUmpExt(rawName);
          const target = s.tabs.find((t) => t.id === id);
          if (!target || target.name === name) return s;
          // Prevent duplicate tab names
          if (s.tabs.some((t) => t.id !== id && t.name === name)) return s;
          return {
            tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
            tabsVersion: s.tabsVersion + 1,
          };
        }),

      reorderTabs: (fromIndex, toIndex) =>
        set((s) => {
          if (fromIndex === toIndex) return s;
          const newTabs = [...s.tabs];
          const [moved] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, moved);
          return { tabs: newTabs, tabsVersion: s.tabsVersion + 1 };
        }),

      setSelectedExample: (selectedExample) =>
        set({
          selectedExample,
          ...(selectedExample
            ? {}
            : { selectedExampleId: null, selectedExampleSetId: null }),
        }),
      setGenerateTargetId: (generateTargetId) => set({ generateTargetId }),
      setClassFilterQuery: (classFilterQuery) =>
        set({ classFilterQuery: normalizeClassFilterQuery(classFilterQuery) }),
      toggleNamedFilter: (name) =>
        set((s) => ({
          activeNamedFilters: s.activeNamedFilters.includes(name)
            ? s.activeNamedFilters.filter((value) => value !== name)
            : [...s.activeNamedFilters, name].sort((left, right) => left.localeCompare(right)),
        })),
      toggleMixset: (name) =>
        set((s) => ({
          activeMixsets: s.activeMixsets.includes(name)
            ? s.activeMixsets.filter((value) => value !== name)
            : [...s.activeMixsets, name].sort((left, right) => left.localeCompare(right)),
        })),
      resetClassDiagramFilters: () =>
        set({
          classFilterQuery: CLASS_FILTER_DEFAULT_QUERY,
          activeNamedFilters: [],
          activeMixsets: [],
        }),
      reconcileClassDiagramFilters: (namedFilters, mixsets) =>
        set((s) => {
          const nextNamedFilters = s.activeNamedFilters.filter((name) => namedFilters.includes(name))
          const nextMixsets = s.activeMixsets.filter((name) => mixsets.includes(name))

          if (
            nextNamedFilters.join("\u0000") === s.activeNamedFilters.join("\u0000") &&
            nextMixsets.join("\u0000") === s.activeMixsets.join("\u0000")
          ) {
            return s
          }

          return {
            activeNamedFilters: nextNamedFilters,
            activeMixsets: nextMixsets,
          }
        }),

      loadExample: (id, name, code, modelId, setId) => {
        set((s) => ({
          code,
          selectedExample: name,
          selectedExampleId: id,
          selectedExampleSetId: setId ?? null,
          ...(modelId ? { modelId } : {}),
          classFilterQuery: CLASS_FILTER_DEFAULT_QUERY,
          activeNamedFilters: [],
          activeMixsets: [],
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId
              ? {
                  ...t,
                  name: ensureUmpExt(name),
                  code,
                  dirty: false,
                  savedCode: code,
                  undoStack: [],
                  redoStack: [],
                }
              : t,
          ),
          // New example code — clear stale diagram and model state
          svgCache: {},
          htmlCache: {},
          diagramData: {},
          umpleModel: null,
          classLayout: null,
          storedLayout: null,
        }));
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
        });
      },

      loadBlankModel: (setId) => {
        set((s) => ({
          code: "",
          selectedExample: null,
          selectedExampleId: "blank",
          selectedExampleSetId: setId ?? null,
          classFilterQuery: CLASS_FILTER_DEFAULT_QUERY,
          activeNamedFilters: [],
          activeMixsets: [],
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId
              ? {
                  ...t,
                  name: suggestBlankTabName(s.tabs, s.activeTabId),
                  code: "",
                  dirty: false,
                  savedCode: "",
                  undoStack: [],
                  redoStack: [],
                }
              : t,
          ),
          svgCache: {},
          htmlCache: {},
          diagramData: {},
          umpleModel: null,
          classLayout: null,
          storedLayout: null,
        }));
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
        });
      },

      closeOtherTabs: (id) => {
        const switchingTab = get().activeTabId !== id;
        set((s) => {
          const tab = s.tabs.find((t) => t.id === id);
          if (!tab) return s;
          // If keeping the active tab, caches are already correct in top-level fields.
          // If keeping a different tab, restore its cached diagram state.
          const keepingActive = id === s.activeTabId;
          return {
            tabs: [
              keepingActive
                ? tab
                : {
                    ...tab,
                    svgCache: s.svgCache,
                    htmlCache: s.htmlCache,
                    diagramData: s.diagramData,
                    umpleModel: s.umpleModel,
                    classLayout: s.classLayout,
                    storedLayout: s.storedLayout,
                  },
            ],
            activeTabId: id,
            code: tab.code,
            ...(keepingActive
              ? {}
              : {
                  svgCache: tab.svgCache ?? {},
                  htmlCache: tab.htmlCache ?? {},
                  diagramData: tab.diagramData ?? {},
                  umpleModel: tab.umpleModel ?? null,
                  classLayout: tab.classLayout ?? null,
                  storedLayout: tab.storedLayout ?? null,
                }),
            tabsVersion: s.tabsVersion + 1,
          };
        });
        if (switchingTab) {
          useEphemeralStore.setState({
            selectedNodeId: null,
            selectedEdgeId: null,
            editingNodeId: null,
            editingField: null,
            renderMode: "graphviz" as const,
          });
        }
      },

      restoreTabs: (tabs, activeTabId) => {
        set(() => {
          const restored = tabs.map((t) => ({
            ...t,
            dirty: false,
            savedCode: t.code,
            undoStack: [] as string[],
            redoStack: [] as string[],
          }));
          const active =
            restored.find((t) => t.id === activeTabId) ?? restored[0];
          return {
            tabs: restored,
            activeTabId: active.id,
            code: active.code,
            selectedExample: null,
            selectedExampleId: null,
            selectedExampleSetId: null,
            classFilterQuery: CLASS_FILTER_DEFAULT_QUERY,
            activeNamedFilters: [],
            activeMixsets: [],
            // Fresh restore — no cached diagram or model state
            svgCache: {},
            htmlCache: {},
            diagramData: {},
            umpleModel: null,
            classLayout: null,
            storedLayout: null,
          };
        });
        useEphemeralStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          editingNodeId: null,
          editingField: null,
          renderMode: "graphviz" as const,
        });
      },

      // ── Diagram actions ──

      setViewMode: (viewMode) => set({ viewMode }),

      setUmpleModel: (umpleModel, layout, storedLayout) =>
        set((s) => {
          if (
            s.umpleModel === umpleModel &&
            (layout === undefined || s.classLayout === layout) &&
            (storedLayout === undefined || s.storedLayout === storedLayout)
          )
            return s;
          return {
            umpleModel,
            ...(layout !== undefined ? { classLayout: layout } : {}),
            ...(storedLayout !== undefined ? { storedLayout } : {}),
          };
        }),

      setDiagramData: (view, nodes, edges) =>
        set((s) => {
          const current = s.diagramData[view];
          if (current && current.nodes === nodes && current.edges === edges)
            return s;
          return {
            diagramData: { ...s.diagramData, [view]: { nodes, edges } },
          };
        }),

      getDiagramData: (view): DiagramElements =>
        get().diagramData[view] ?? EMPTY_DIAGRAM_ELEMENTS,

      setSvgForView: (view, svg) =>
        set((s) => ({ svgCache: { ...s.svgCache, [view]: svg } })),

      clearSvgCache: () => set({ svgCache: {} }),

      setHtmlForView: (view, html) =>
        set((s) => ({ htmlCache: { ...s.htmlCache, [view]: html } })),

      clearHtmlCache: () => set({ htmlCache: {} }),

      updateNodePosition: (id, x, y) =>
        set((s) => {
          const current = s.diagramData.class;
          if (!current) return s;
          return {
            diagramData: {
              ...s.diagramData,
              class: {
                ...current,
                nodes: current.nodes.map((n) =>
                  n.id === id ? { ...n, position: { x, y } } : n,
                ),
              },
            },
          };
        }),

      addNode: (node) =>
        set((s) => {
          const current = s.diagramData.class ?? EMPTY_DIAGRAM_ELEMENTS;
          return {
            diagramData: {
              ...s.diagramData,
              class: { ...current, nodes: [...current.nodes, node] },
            },
          };
        }),

      removeNode: (id) => {
        set((s) => {
          const current = s.diagramData.class ?? EMPTY_DIAGRAM_ELEMENTS;
          return {
            diagramData: {
              ...s.diagramData,
              class: {
                nodes: current.nodes.filter((n) => n.id !== id),
                edges: current.edges.filter(
                  (e) => e.source !== id && e.target !== id,
                ),
              },
            },
          };
        });
        // Clear ephemeral selection if the removed node was selected
        const eph = useEphemeralStore.getState();
        if (eph.selectedNodeId === id) eph.setSelectedNode(null);
      },

      removeEdge: (id) => {
        set((s) => {
          const current = s.diagramData.class ?? EMPTY_DIAGRAM_ELEMENTS;
          return {
            diagramData: {
              ...s.diagramData,
              class: {
                ...current,
                edges: current.edges.filter((e) => e.id !== id),
              },
            },
          };
        });
        // Clear ephemeral selection if the removed edge was selected
        const eph = useEphemeralStore.getState();
        if (eph.selectedEdgeId === id) eph.setSelectedEdge(null);
      },

      renameNode: (oldId, newName) =>
        set((s) => {
          const newId = `class-${newName}`;
          return {
            diagramData: {
              ...s.diagramData,
              class: {
                nodes: (s.diagramData.class?.nodes ?? []).map((n) =>
                  n.id === oldId
                    ? { ...n, id: newId, data: { ...n.data, name: newName } }
                    : n,
                ),
                edges: (s.diagramData.class?.edges ?? []).map((e) => ({
                  ...e,
                  source: e.source === oldId ? newId : e.source,
                  target: e.target === oldId ? newId : e.target,
                })),
              },
            },
          };
        }),

      // ── Agent panel actions ──

      openAgentPanel: () => set({ showAgentPanel: true, showAgentBar: true }),
      closeAgentPanel: () => set({ showAgentPanel: false, showAgentBar: true }),
      toggleAgentPanel: () =>
        set((s) => ({ showAgentPanel: !s.showAgentPanel, showAgentBar: true })),
      revealAgentBar: () => set({ showAgentBar: true, showAgentPanel: false }),
      hideAgentBar: () => set({ showAgentBar: false, showAgentPanel: false }),
      setChatMessages: (chatMessages) => set({ chatMessages }),
    }),
    {
      name: "umple-session-v1",
      version: 2,
      storage: createJSONStorage(() => sessionStorage),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          return {
            ...state,
            showAgentPanel: false,
            showAgentBar: false,
          } as any;
        }
        return state as any;
      },
      partialize: (state) => ({
        modelId: state.modelId,
        selectedExample: state.selectedExample,
        selectedExampleId: state.selectedExampleId,
        selectedExampleSetId: state.selectedExampleSetId,
        generateTargetId: state.generateTargetId,
        viewMode: state.viewMode,
        showAgentPanel: state.showAgentPanel,
        showAgentBar: state.showAgentBar,
        chatMessages: state.chatMessages,
      }),
    },
  ),
);
