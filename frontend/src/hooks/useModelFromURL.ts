import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSessionStore } from "../stores/sessionStore";
import { useCollabStore } from "../stores/collabStore";
import { useEphemeralStore } from "../stores/ephemeralStore";
import { isTemporaryModel } from "../lib/modelId";
import { getViewForLegacyDiagramType } from "../constants/diagram";
import { getDefaultViewForExampleCategory } from "../constants/examples";
import { getGenerateTarget } from "../generation/targets";
import { api } from "../api/client";

const initialParams = new URLSearchParams(window.location.search);

/** The URL model param read once at module load — before any React effect. */
const initialUrlModelId = initialParams.get("model") || null;
// Match legacy source precedence; a saved bookmark always wins.
const initialUrlExample = initialUrlModelId
  ? null
  : initialParams.get("example") || null;
// The legacy manual's Documenter_Code.ump double-encodes plus signs. Decode
// that known escape only; decoding the whole source again would corrupt % text.
const initialText = initialUrlModelId || initialUrlExample
  ? null
  : initialParams.get("text")?.replace(/%2B/gi, "+") ?? null;
const initialFilename = initialUrlModelId || initialUrlExample || initialText !== null
  ? null
  : initialParams.get("filename");
const hasExplicitSource = !!initialUrlModelId || !!initialUrlExample
  || initialText !== null || initialFilename !== null;

/** Legacy ?diagramtype= param (GvClass, state, etc.). */
const initialDiagramType = initialParams.get("diagramtype");

/** ?readOnly flag. */
const initialReadOnly = initialParams.has("readOnly");

/** ?generateDefault= param. */
const initialGenerateDefault = initialParams.get("generateDefault");

/**
 * Read the persisted modelId from sessionStorage (Zustand hydrates async, so
 * we read the raw storage to get the value synchronously at module load).
 */
function readStoredModelId(): string | null {
  try {
    const raw = sessionStorage.getItem("umple-session-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.modelId ?? null;
  } catch {
    return null;
  }
}

const initialStoreModelId = hasExplicitSource ? null : readStoredModelId();

/** The model ID to restore on mount — URL takes priority over sessionStorage. */
const initialModelId = initialUrlModelId ?? initialStoreModelId;

/** True when a startup source needs to resolve before compilation. */
const needsResolve = hasExplicitSource || !!initialModelId;

/**
 * True once the initial model (from URL or sessionStorage) has been
 * resolved. Exported so useCompiler can defer compilation until the server
 * state is known, preventing stale/empty code from overwriting the server model.
 */
export let urlModelResolved = !needsResolve;

/**
 * On mount, reads URL params and applies them:
 * - `?model=<id>` loads a saved model
 * - `?example=<name>`, `?text=<source>`, or `?filename=<url>` loads fresh source
 * - `?diagramtype=<type>` sets the diagram view mode
 * - `?readOnly` enables read-only mode
 * - `?generateDefault=<lang>` sets the default generate target
 *
 * After compilation assigns a modelId, syncs permanent IDs back to the URL.
 */
export function useModelFromURL() {
  const setModelId = useSessionStore((s) => s.setModelId);
  const restoreTabs = useSessionStore((s) => s.restoreTabs);
  const loadExample = useSessionStore((s) => s.loadExample);
  const setViewMode = useSessionStore((s) => s.setViewMode);
  const modelId = useSessionStore((s) => s.modelId);

  const resolvedRef = useRef(!needsResolve);

  // Apply simple URL options synchronously on first mount.
  useEffect(() => {
    // ?diagramtype=
    if (initialDiagramType) {
      const mapped = getViewForLegacyDiagramType(initialDiagramType);
      if (mapped) useSessionStore.getState().setViewMode(mapped);
    }

    // ?readOnly
    if (initialReadOnly) {
      useEphemeralStore.getState().setReadOnly(true);
    }

    // ?generateDefault=
    if (initialGenerateDefault) {
      // Case-insensitive lookup: try exact match first, then lowercase match.
      if (getGenerateTarget(initialGenerateDefault)) {
        useSessionStore.getState().setGenerateTargetId(initialGenerateDefault);
      } else {
        const lower = initialGenerateDefault.toLowerCase();
        // Capitalize first letter to match target IDs like "Java", "Python".
        const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
        if (getGenerateTarget(capitalized)) {
          useSessionStore.getState().setGenerateTargetId(capitalized);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!needsResolve) return;
    const abort = new AbortController();

    // Detach persisted tabs and model identity before resolving an explicit link.
    // Compilation stays gated until the entire source has been installed.
    if (hasExplicitSource) {
      useSessionStore.setState({ modelId: null });
      restoreTabs([{ id: "main", name: "Model.ump", code: "" }], "main");
    }

    async function resolve() {
      try {
        if (initialModelId) {
          const res = await api.getModel(initialModelId, abort.signal);
          if (abort.signal.aborted) return;
          const tabs = res.tabs?.length
            ? res.tabs
            : [{ id: "main", name: "Model.ump", code: res.code }];
          restoreTabs(tabs, res.activeTabId ?? tabs[0].id);
          setModelId(res.modelId);
          if (initialUrlModelId && !isTemporaryModel(res.modelId)) {
            useCollabStore.getState().startCollab(res.modelId);
          }
        } else if (initialUrlExample) {
          const res = await api.resolveExample(initialUrlExample, abort.signal);
          if (abort.signal.aborted) return;
          loadExample(res.id, res.name, res.code, res.modelId, res.setId ?? null);
          if (!initialDiagramType && res.defaultCategoryId) {
            const nextView = getDefaultViewForExampleCategory(res.defaultCategoryId);
            if (nextView) setViewMode(nextView);
          }
        } else if (initialText !== null || initialFilename !== null) {
          const code = initialText
            ?? (await api.loadSource(initialFilename!, abort.signal)).code;
          if (abort.signal.aborted) return;
          restoreTabs([{ id: "main", name: "Model.ump", code }], "main");
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        useSessionStore.setState({ modelId: null });
        toast.error("Could not load model", {
          description: err instanceof Error ? err.message : "Please check the link and try again.",
        });
      } finally {
        if (!abort.signal.aborted) {
          urlModelResolved = true;
          resolvedRef.current = true;
          useSessionStore.setState((s) => ({ tabsVersion: s.tabsVersion + 1 }));
        }
      }
    }
    void resolve();
    return () => abort.abort();
  }, [loadExample, restoreTabs, setModelId, setViewMode]);

  // Sync modelId to URL whenever it changes — only for permanent IDs.
  useEffect(() => {
    if (!resolvedRef.current || modelId !== useSessionStore.getState().modelId) return;

    const url = new URL(window.location.href);
    if (modelId && !isTemporaryModel(modelId)) {
      url.searchParams.set("model", modelId);
      for (const key of ["example", "text", "filename"]) url.searchParams.delete(key);
    } else {
      url.searchParams.delete("model");
    }
    window.history.replaceState({}, "", url.toString());
  }, [modelId]);
}
