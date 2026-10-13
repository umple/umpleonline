/**
 * Loads an example's Umple into the editor and remembers which example set is selected.
 * The toolbar example menus and the command palette both call this.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useCollabStore } from "../stores/collabStore";
import { useEphemeralStore } from "../stores/ephemeralStore";
import { collabLoadBlankModel, collabLoadExample } from "./useCollabTabs";
import { api } from "../api/client";
import type { ExampleSet, ExampleSetId, ExampleCategoryId } from "../api/types";
import { getDefaultViewForExampleCategory } from "../constants/examples";
import { getGenerateTargetIdForView } from "../generation/targets";

let cachedSets: ExampleSet[] | null = null;
let fetchPromise: Promise<ExampleSet[]> | null = null;

interface LoadExampleOptions {
  switchToDefaultView?: boolean;
}

export function useExamples() {
  const [sets, setSets] = useState<ExampleSet[]>(cachedSets ?? []);
  const [loading, setLoading] = useState(cachedSets === null);
  const localLoadExample = useSessionStore((s) => s.loadExample);
  const localLoadBlankModel = useSessionStore((s) => s.loadBlankModel);
  const isCollaborating = useCollabStore((s) => s.isCollaborating);

  useEffect(() => {
    if (cachedSets) {
      setSets(cachedSets);
      setLoading(false);
      return;
    }
    if (!fetchPromise) {
      fetchPromise = api.listExamples();
      fetchPromise
        .then((nextSets) => {
          cachedSets = nextSets;
        })
        .catch(() => {
          fetchPromise = null;
        });
    }
    fetchPromise
      .then((nextSets) => {
        setSets(nextSets);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const examples = useMemo(
    () =>
      sets.flatMap((set) =>
        set.examples.map((example) => ({
          ...example,
          setId: set.id,
          setLabel: set.label,
          categoryId: set.categoryId,
        })),
      ),
    [sets],
  );

  const loadExample = useCallback(
    async (id: string, options?: LoadExampleOptions) => {
      try {
        const res = await api.getExample(id);
        if (options?.switchToDefaultView && res.defaultCategoryId) {
          const targetView = getDefaultViewForExampleCategory(
            res.defaultCategoryId,
          );
          if (targetView) {
            const targetId = getGenerateTargetIdForView(targetView);
            useSessionStore.getState().setViewMode(targetView);
            if (targetId) useSessionStore.getState().setGenerateTargetId(targetId);
          }
        }

        if (isCollaborating) {
          collabLoadExample(
            res.id,
            res.name,
            res.code,
            res.modelId,
            res.setId ?? null,
          );
        } else {
          localLoadExample(
            res.id,
            res.name,
            res.code,
            res.modelId,
            res.setId ?? null,
          );
        }
        useEphemeralStore.getState().setRightPanelView("diagram");
      } catch {
        // Ignore list/load failures in the UI and leave the current model intact.
      }
    },
    [isCollaborating, localLoadExample],
  );

  const loadBlank = useCallback(
    (
      setId: ExampleSetId,
      categoryId: ExampleCategoryId,
      options?: LoadExampleOptions,
    ) => {
      if (options?.switchToDefaultView) {
        const targetView = getDefaultViewForExampleCategory(categoryId);
        if (targetView) {
          const targetId = getGenerateTargetIdForView(targetView);
          useSessionStore.getState().setViewMode(targetView);
          if (targetId) useSessionStore.getState().setGenerateTargetId(targetId);
        }
      }

      if (isCollaborating) {
        collabLoadBlankModel(setId);
      } else {
        localLoadBlankModel(setId);
      }
      useEphemeralStore.getState().setRightPanelView("diagram");
    },
    [isCollaborating, localLoadBlankModel],
  );

  return { sets, examples, loadExample, loadBlank, loading };
}
