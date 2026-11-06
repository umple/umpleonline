/**
 * Mirrors editor tabs into the Yjs document so collaborators share the same files.
 * Local tab actions and remote updates both go through these helpers.
 */

import { useEffect } from "react";
import * as Y from "yjs";
import { useCollabStore } from "../stores/collabStore";
import { useSessionStore, nextTabNumber } from "../stores/sessionStore";
import type { ExampleSetId } from "../api/types";
import { getYDoc } from "./useCollab";
import { ensureUmpExt } from "../lib/umpFile";

// ── Helpers ──────────────────────────────────────────────────────────

/** Derive a sorted tab list from the shared Y.Map("tabs"). */
export function readYTabs(
  doc: Y.Doc,
): Array<{ id: string; name: string; code: string; order: number }> {
  const ytabs = doc.getMap("tabs");
  const out: Array<{ id: string; name: string; code: string; order: number }> =
    [];
  ytabs.forEach((value, id) => {
    const meta = value as Y.Map<unknown>;
    out.push({
      id,
      name: (meta.get("name") as string) ?? "untitled.ump",
      code: doc.getText(`tab:${id}`).toString(),
      order: (meta.get("order") as number) ?? 0,
    });
  });
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Replace the full content of a Y.Text, skipping if already equal. */
export function replaceYText(ytext: Y.Text, content: string) {
  if (ytext.toString() === content) return;
  ytext.doc?.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content);
  });
}

/** Reconcile shared Y.Map state into the local sessionStore. */
function syncToLocal(doc: Y.Doc) {
  const collabTabs = readYTabs(doc);
  const store = useSessionStore.getState();
  let shouldUpdate = false;
  let shouldBumpTabsVersion =
    collabTabs.length !== store.tabs.length ||
    collabTabs.some((tab, index) => store.tabs[index]?.id !== tab.id);

  // Build lookup of local tabs
  const localById = new Map(store.tabs.map((t) => [t.id, t]));

  const nextTabs = collabTabs.map((ct) => {
    const local = localById.get(ct.id);
    const nextCode = ct.id === store.activeTabId ? store.code : ct.code;

    if (local) {
      const sharedFieldsChanged = local.name !== ct.name;
      const nonActiveCodeChanged =
        ct.id !== store.activeTabId && local.code !== ct.code;
      const nextTab =
        sharedFieldsChanged || local.code !== nextCode
          ? {
              ...local,
              name: ct.name,
              code: nextCode,
            }
          : local;

      shouldUpdate =
        shouldUpdate ||
        nextTab !== local;
      shouldBumpTabsVersion =
        shouldBumpTabsVersion ||
        sharedFieldsChanged ||
        nonActiveCodeChanged;

      // Preserve local-only fields; update shared fields
      return nextTab;
    }

    shouldUpdate = true;
    shouldBumpTabsVersion = true;

    // New tab from remote
    return {
      id: ct.id,
      name: ct.name,
      code: ct.code,
      dirty: false,
      savedCode: ct.code,
      undoStack: [] as string[],
      redoStack: [] as string[],
    };
  });

  // If the active tab was deleted remotely, switch to an adjacent tab
  let nextActiveTabId = store.activeTabId;
  const activeStillExists = nextTabs.some((t) => t.id === nextActiveTabId);
  if (!activeStillExists && nextTabs.length > 0) {
    nextActiveTabId = nextTabs[0].id;
    shouldUpdate = true;
    shouldBumpTabsVersion = true;
  }

  const nextCode = nextTabs.find((t) => t.id === nextActiveTabId)?.code ?? "";
  if (nextCode !== store.code || nextActiveTabId !== store.activeTabId) {
    shouldUpdate = true;
  }

  if (!shouldUpdate && !shouldBumpTabsVersion) return;

  useSessionStore.setState((state) => ({
    tabs: nextTabs,
    activeTabId: nextActiveTabId,
    code: nextCode,
    ...(shouldBumpTabsVersion ? { tabsVersion: state.tabsVersion + 1 } : {}),
  }));
}

// ── Observer hook ────────────────────────────────────────────────────

/**
 * Watches the shared Y.Map("tabs") and mirrors remote tab changes
 * (add, delete, rename, reorder) into sessionStore.
 *
 * Call this once near the top of the component tree when collaborating.
 */
export function useCollabTabs() {
  const isCollaborating = useCollabStore((s) => s.isCollaborating);
  const ready = useCollabStore((s) => s.ready);

  useEffect(() => {
    if (!isCollaborating || !ready) return;
    const doc = getYDoc();
    if (!doc) return;

    // Transaction observer: fires on tab metadata changes AND tab text edits
    // so non-active collaborative changes still refresh local state/output.
    const observer = () => syncToLocal(doc);
    doc.on('afterTransaction', observer);

    return () => {
      doc.off('afterTransaction', observer);
    };
  }, [isCollaborating, ready]);
}

// ── Collab-aware tab actions ─────────────────────────────────────────
// These mutate the Y.Doc; the observer propagates changes to all clients.

export function collabAddNewTab() {
  const doc = getYDoc();
  if (!doc) return;
  const id = `tab-${Date.now()}`;
  const tabs = useSessionStore.getState().tabs;
  const name = `untitled-${nextTabNumber(tabs)}.ump`;
  doc.transact(() => {
    const ytabs = doc.getMap("tabs");
    const meta = new Y.Map<unknown>();
    meta.set("name", name);
    meta.set("order", ytabs.size);
    ytabs.set(id, meta);
  });
  // Locally switch to the new tab
  useSessionStore.getState().setActiveTab(id);
}

export function collabRemoveTab(id: string) {
  const doc = getYDoc();
  if (!doc) return;
  const ytabs = doc.getMap("tabs");
  if (ytabs.size <= 1) return; // don't delete the last tab
  doc.transact(() => {
    ytabs.delete(id);
    const ytext = doc.getText(`tab:${id}`);
    ytext.delete(0, ytext.length);
  });
}

export function collabRenameTab(id: string, rawName: string) {
  const doc = getYDoc();
  if (!doc) return;
  const name = ensureUmpExt(rawName);
  const ytabs = doc.getMap("tabs");
  const meta = ytabs.get(id) as Y.Map<unknown> | undefined;
  if (!meta) return;
  let duplicate = false;
  ytabs.forEach((value, key) => {
    if (key !== id && (value as Y.Map<unknown>).get("name") === name)
      duplicate = true;
  });
  if (duplicate) return;
  meta.set("name", name);
}

export function collabCloseOtherTabs(keepId: string) {
  const doc = getYDoc();
  if (!doc) return;
  const ytabs = doc.getMap("tabs");
  const toDelete: string[] = [];
  ytabs.forEach((_value, id) => {
    if (id !== keepId) toDelete.push(id);
  });
  doc.transact(() => {
    for (const id of toDelete) {
      ytabs.delete(id);
      const ytext = doc.getText(`tab:${id}`);
      ytext.delete(0, ytext.length);
    }
  });
}

function collabBlankTabName(): string {
  const { tabs, activeTabId } = useSessionStore.getState();
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (!active) return "Model.ump";
  if (active.name === "Model.ump" || /^untitled-\d+\.ump$/.test(active.name)) {
    return active.name;
  }
  if (!tabs.some((tab) => tab.id !== activeTabId && tab.name === "Model.ump")) {
    return "Model.ump";
  }
  return `untitled-${nextTabNumber(tabs.filter((tab) => tab.id !== activeTabId))}.ump`;
}

export function collabLoadExample(
  id: string,
  name: string,
  code: string,
  modelId?: string,
  setId?: ExampleSetId | null,
) {
  const doc = getYDoc();
  if (!doc) return;
  const { activeTabId } = useSessionStore.getState();
  const ytabs = doc.getMap("tabs");
  const meta = ytabs.get(activeTabId) as Y.Map<unknown> | undefined;
  doc.transact(() => {
    if (meta) meta.set("name", ensureUmpExt(name));
    replaceYText(doc.getText(`tab:${activeTabId}`), code);
  });
  useSessionStore.setState({
    code,
    selectedExample: name,
    selectedExampleId: id,
    selectedExampleSetId: setId ?? null,
    ...(modelId ? { modelId } : {}),
    svgCache: {},
    htmlCache: {},
    diagramData: {},
    umpleModel: null,
    classLayout: null,
    storedLayout: null,
  });
}

export function collabLoadBlankModel(setId?: ExampleSetId | null) {
  const doc = getYDoc();
  if (!doc) return;
  const { activeTabId } = useSessionStore.getState();
  const ytabs = doc.getMap("tabs");
  const meta = ytabs.get(activeTabId) as Y.Map<unknown> | undefined;
  doc.transact(() => {
    if (meta) meta.set("name", collabBlankTabName());
    replaceYText(doc.getText(`tab:${activeTabId}`), "");
  });
  useSessionStore.setState({
    code: "",
    selectedExample: null,
    selectedExampleId: "blank",
    selectedExampleSetId: setId ?? null,
    svgCache: {},
    htmlCache: {},
    diagramData: {},
    umpleModel: null,
    classLayout: null,
    storedLayout: null,
  });
}
