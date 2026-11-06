import { useEffect, useRef } from "react";
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
const initialUrlModelId = initialParams.get("model");
const initialUrlExample = initialParams.get("example");
const initialUrlText = initialParams.get("text");

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

const initialStoreModelId =
  initialUrlModelId || initialUrlExample || initialUrlText ? null : readStoredModelId();

/** The model ID to restore on mount — URL takes priority over sessionStorage. */
const initialModelId = initialUrlModelId ?? initialStoreModelId;

/** True when any startup loading (model or example) needs to resolve first. */
const needsResolve = !!(
  initialModelId || initialUrlExample || initialUrlText !== null
);
/**
 * True once the initial model (from URL or sessionStorage) has been
 * resolved. Exported so useCompiler can defer compilation until the server
 * state is known, preventing stale/empty code from overwriting the server model.
 */
export let urlModelResolved = !needsResolve;

/**
 * On mount, reads URL params and applies them:
 * - `?model=<id>` loads a saved model
 * - `?diagramtype=<type>` sets the diagram view mode
 * - `?readOnly` enables read-only mode
 * - `?generateDefault=<lang>` sets the default generate target
 *
 * After compilation assigns a modelId, syncs permanent IDs back to the URL.
 */
export function useModelFromURL() {
  const setCode = useSessionStore((s) => s.setCode);
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
    if (initialUrlText === null || initialUrlExample || initialUrlModelId) {
      return;
    }

    setCode(initialUrlText);
    urlModelResolved = true;
    resolvedRef.current = true;

    useSessionStore.setState((s) => ({
      tabsVersion: s.tabsVersion + 1,
    }));
  }, [setCode]);

  useEffect(() => {
    if (!initialUrlExample) return;

    let cancelled = false;

    api
      .resolveExample(initialUrlExample)
      .then((res) => {
        if (cancelled) return;
        loadExample(res.id, res.name, res.code, res.modelId, res.setId ?? null);

        if (!initialDiagramType && res.defaultCategoryId) {
          const nextView = getDefaultViewForExampleCategory(
            res.defaultCategoryId,
          );
          if (nextView) setViewMode(nextView);
        }
      })
      .catch(() => {
        if (cancelled) return;
        const url = new URL(window.location.href);
        url.searchParams.delete("example");
        window.history.replaceState({}, "", url.toString());
      })
      .finally(() => {
        if (cancelled) return;
        urlModelResolved = true;
        resolvedRef.current = true;
        useSessionStore.setState((s) => ({ tabsVersion: s.tabsVersion + 1 }));
      });

    return () => {
      cancelled = true;
    };
  }, [loadExample, setViewMode]);

  // Load model from ?model= or sessionStorage on mount.
  useEffect(() => {
    if (initialUrlExample) return;
    if (!initialModelId) return;

    const abort = new AbortController();

    api
      .getModel(initialModelId, abort.signal)
      .then((res) => {
        if (abort.signal.aborted) return;
        if (res.tabs?.length) {
          restoreTabs(res.tabs, res.activeTabId ?? res.tabs[0].id);
        } else {
          setCode(res.code);
        }
        setModelId(res.modelId);

        // Auto-start collab for permanent models loaded from the URL.
        // Permanent model URLs are always collab-enabled — if a room exists
        // the user joins it; otherwise a new room is created.
        if (initialUrlModelId && !isTemporaryModel(res.modelId)) {
          useCollabStore.getState().startCollab(res.modelId);
        }
      })
      .catch((err) => {
        if (abort.signal.aborted || err.name === "AbortError") return;
        // Model not found or expired — clean up
        if (initialUrlModelId) {
          const url = new URL(window.location.href);
          url.searchParams.delete("model");
          window.history.replaceState({}, "", url.toString());
        }
        // Clear stale modelId and bump tabsVersion so the compile effect
        // fires with a clean slate.
        useSessionStore.setState((s) => ({
          modelId: null,
          tabsVersion: s.tabsVersion + 1,
        }));
      })
      .finally(() => {
        if (abort.signal.aborted) return;
        urlModelResolved = true;
        resolvedRef.current = true;
        // Force the compile effect to re-fire now that urlModelResolved is true.
        useSessionStore.setState((s) => ({ tabsVersion: s.tabsVersion + 1 }));
      });

    return () => abort.abort();
  }, [setCode, setModelId, restoreTabs]);

  // Sync modelId to URL whenever it changes — only for permanent IDs.
  useEffect(() => {
    if (!resolvedRef.current) return;

    const url = new URL(window.location.href);
    if (modelId && !isTemporaryModel(modelId)) {
      url.searchParams.set("model", modelId);
    } else {
      url.searchParams.delete("model");
    }
    window.history.replaceState({}, "", url.toString());
  }, [modelId]);
}
