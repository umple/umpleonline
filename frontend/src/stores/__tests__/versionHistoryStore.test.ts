// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getModelSnapshots,
  getAllModelSnapshots,
  saveModelSnapshot,
  deleteModelSnapshot,
  getOrCreateHistoryId,
  isSnapshotDescendant,
} from "../versionHistoryStore";

const model = {
  modelId: "test-model",
  tabs: [{ id: "tab-1", name: "Model.ump", code: "class Student {}" }],
  activeTabId: "tab-1",
  reason: "automatic" as const,
};

describe("versionHistoryStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and retrieves a model snapshot", () => {
    const saved = saveModelSnapshot(model);

    expect(saved).not.toBeNull();
    expect(getModelSnapshots("test-model")).toHaveLength(1);
    expect(getModelSnapshots("test-model")[0].tabs[0].code).toBe(
      "class Student {}",
    );
  });

  it("avoids duplicate automatic snapshots", () => {
    saveModelSnapshot(model);
    saveModelSnapshot(model);

    expect(getModelSnapshots("test-model")).toHaveLength(1);
  });
  it("preserves parent revision metadata in saved snapshots", () => {
    const original = saveModelSnapshot({
      modelId: "revision-test",
      tabs: [
        {
          id: "main",
          name: "Model.ump",
          code: "class Original {}",
        },
      ],
      activeTabId: "main",
      reason: "automatic",
    });

    expect(original).not.toBeNull();

    const updated = saveModelSnapshot({
      modelId: "revision-test",
      tabs: [
        {
          id: "main",
          name: "Model.ump",
          code: "class Updated {}",
        },
      ],
      activeTabId: "main",
      reason: "automatic",
      parentSnapshotId: original!.id,
    });

    expect(updated).not.toBeNull();
    expect(updated!.parentSnapshotId).toBe(original!.id);

    const snapshots = getModelSnapshots("revision-test");

    expect(snapshots[0].parentSnapshotId).toBe(original!.id);
  });
  it("preserves ancestry when an intermediate automatic backup is thinned", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));

      const tabs = (code: string) => [
        {
          id: "main",
          name: "Model.ump",
          code,
        },
      ];

      const original = saveModelSnapshot({
        modelId: "retention-ancestry",
        tabs: tabs("class Original {}"),
        activeTabId: "main",
        reason: "manual",
        parentSnapshotId: null,
      })!;

      vi.advanceTimersByTime(60 * 1000);

      const intermediate = saveModelSnapshot({
        modelId: "retention-ancestry",
        tabs: tabs("class Intermediate {}"),
        activeTabId: "main",
        reason: "automatic",
        parentSnapshotId: original.id,
      })!;

      vi.advanceTimersByTime(60 * 1000);

      const latest = saveModelSnapshot({
        modelId: "retention-ancestry",
        tabs: tabs("class Latest {}"),
        activeTabId: "main",
        reason: "manual",
        parentSnapshotId: intermediate.id,
      })!;

      // Age the intermediate backup beyond the recent-retention window.
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);

      // Another automatic snapshot in the same retention bucket
      // causes the intermediate backup to be thinned.
      saveModelSnapshot({
        modelId: "retention-ancestry",
        tabs: tabs("class NewBackup {}"),
        activeTabId: "main",
        reason: "automatic",
        parentSnapshotId: latest.id,
      });

      const snapshots = getModelSnapshots("retention-ancestry");

      expect(isSnapshotDescendant(snapshots, latest.id, original.id)).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves ancestry when retention removes an intermediate snapshot", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));

      const tabs = (code: string) => [
        {
          id: "main",
          name: "Model.ump",
          code,
        },
      ];

      const original = saveModelSnapshot({
        modelId: "retention-chain",
        tabs: tabs("class Original {}"),
        activeTabId: "main",
        reason: "manual",
        parentSnapshotId: null,
      })!;

      vi.advanceTimersByTime(60 * 1000);

      const intermediate = saveModelSnapshot({
        modelId: "retention-chain",
        tabs: tabs("class Intermediate {}"),
        activeTabId: "main",
        reason: "automatic",
        parentSnapshotId: original.id,
      })!;

      vi.advanceTimersByTime(60 * 1000);

      const latest = saveModelSnapshot({
        modelId: "retention-chain",
        tabs: tabs("class Latest {}"),
        activeTabId: "main",
        reason: "manual",
        parentSnapshotId: intermediate.id,
      })!;

      // Another automatic snapshot, newer than the intermediate.
      vi.advanceTimersByTime(60 * 1000);

      const competing = saveModelSnapshot({
        modelId: "retention-chain",
        tabs: tabs("class Competing {}"),
        activeTabId: "main",
        reason: "automatic",
        parentSnapshotId: latest.id,
      })!;

      // At this point both automatic snapshots are recent.
      expect(getModelSnapshots("retention-chain")).toHaveLength(4);

      // Move forward so both automatic snapshots are older
      // than 30 minutes and fall into the same retention bucket.
      vi.advanceTimersByTime(60 * 60 * 1000);

      // Trigger another retention pass.
      saveModelSnapshot({
        modelId: "retention-chain",
        tabs: tabs("class Trigger {}"),
        activeTabId: "main",
        reason: "manual",
        parentSnapshotId: competing.id,
      });

      const snapshots = getModelSnapshots("retention-chain");

      // The newer automatic snapshot should survive.
      expect(snapshots.some((snapshot) => snapshot.id === competing.id)).toBe(
        true,
      );

      // The older intermediate snapshot should be removed.
      expect(
        snapshots.some((snapshot) => snapshot.id === intermediate.id),
      ).toBe(false);

      // The retained latest revision should still be recognized
      // as a descendant of the original revision.
      expect(isSnapshotDescendant(snapshots, latest.id, original.id)).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves different automatic backups created five seconds apart", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));

      saveModelSnapshot({
        ...model,
        tabs: [{ id: "tab-1", name: "Model.ump", code: "class A {}" }],
      });

      vi.advanceTimersByTime(5000);

      saveModelSnapshot({
        ...model,
        tabs: [{ id: "tab-1", name: "Model.ump", code: "class A { name; }" }],
      });

      const snapshots = getModelSnapshots("test-model");

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].tabs[0].code).toBe("class A { name; }");
      expect(snapshots[1].tabs[0].code).toBe("class A {}");
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves independent branches from the same parent revision", () => {
    const tabs = (code: string) => [
      {
        id: "main",
        name: "Model.ump",
        code,
      },
    ];

    const original = saveModelSnapshot({
      modelId: "branch-test",
      tabs: tabs("class Original {}"),
      activeTabId: "main",
      reason: "automatic",
    });

    expect(original).not.toBeNull();

    // Browser tab A saves its changes.
    const branchA = saveModelSnapshot({
      modelId: "branch-test",
      tabs: tabs("class VersionA {}"),
      activeTabId: "main",
      reason: "automatic",
      parentSnapshotId: original!.id,
    });

    // Browser tab B was still editing the original revision.
    const branchB = saveModelSnapshot({
      modelId: "branch-test",
      tabs: tabs("class VersionB {}"),
      activeTabId: "main",
      reason: "automatic",
      parentSnapshotId: original!.id,
    });

    expect(branchA).not.toBeNull();
    expect(branchB).not.toBeNull();

    const snapshots = getModelSnapshots("branch-test");

    expect(snapshots.some((snapshot) => snapshot.id === branchA!.id)).toBe(
      true,
    );

    expect(snapshots.some((snapshot) => snapshot.id === branchB!.id)).toBe(
      true,
    );

    expect(branchA!.parentSnapshotId).toBe(original!.id);
    expect(branchB!.parentSnapshotId).toBe(original!.id);
  });
  it("distinguishes descendant revisions from independent branches", () => {
    const tabs = (code: string) => [
      {
        id: "main",
        name: "Model.ump",
        code,
      },
    ];

    const original = saveModelSnapshot({
      modelId: "ancestry-test",
      tabs: tabs("class Original {}"),
      activeTabId: "main",
      reason: "automatic",
    })!;

    const branchA = saveModelSnapshot({
      modelId: "ancestry-test",
      tabs: tabs("class BranchA {}"),
      activeTabId: "main",
      reason: "automatic",
      parentSnapshotId: original.id,
    })!;

    const branchB = saveModelSnapshot({
      modelId: "ancestry-test",
      tabs: tabs("class BranchB {}"),
      activeTabId: "main",
      reason: "automatic",
      parentSnapshotId: original.id,
    })!;

    const snapshots = getModelSnapshots("ancestry-test");

    expect(isSnapshotDescendant(snapshots, branchA.id, original.id)).toBe(true);

    expect(isSnapshotDescendant(snapshots, branchB.id, original.id)).toBe(true);

    expect(isSnapshotDescendant(snapshots, branchB.id, branchA.id)).toBe(false);

    expect(isSnapshotDescendant(snapshots, branchA.id, branchB.id)).toBe(false);
  });
  it("keeps histories for different models separate", () => {
    saveModelSnapshot(model);
    saveModelSnapshot({ ...model, modelId: "other-model" });

    expect(getModelSnapshots("test-model")).toHaveLength(1);
    expect(getModelSnapshots("other-model")).toHaveLength(1);
  });

  it("deletes a snapshot", () => {
    const saved = saveModelSnapshot(model);
    expect(saved).not.toBeNull();

    deleteModelSnapshot(saved!.id);

    expect(getModelSnapshots("test-model")).toHaveLength(0);
  });

  it("preserves a snapshot before switching models", () => {
    const saved = saveModelSnapshot({
      ...model,
      reason: "before-switch",
    });

    expect(saved).not.toBeNull();
    expect(saved?.reason).toBe("before-switch");
    expect(getModelSnapshots("test-model")[0].tabs[0].code).toBe(
      "class Student {}",
    );
  });

  it("preserves multiple tabs and the active tab", () => {
    const saved = saveModelSnapshot({
      ...model,
      tabs: [
        { id: "tab-1", name: "Model.ump", code: "class Student {}" },
        { id: "tab-2", name: "Course.ump", code: "class Course {}" },
      ],
      activeTabId: "tab-2",
    });

    expect(saved).not.toBeNull();

    const snapshots = getModelSnapshots("test-model");

    expect(snapshots[0].tabs).toHaveLength(2);
    expect(snapshots[0].activeTabId).toBe("tab-2");
    expect(snapshots[0].tabs[1].code).toBe("class Course {}");
  });

  it("preserves a snapshot before restoring an older version", () => {
    const saved = saveModelSnapshot({
      ...model,
      tabs: [
        { id: "tab-1", name: "Model.ump", code: "class Student { name; }" },
      ],
      reason: "before-restore",
    });

    expect(saved).not.toBeNull();
    expect(saved?.reason).toBe("before-restore");
    expect(getModelSnapshots("test-model")[0].tabs[0].code).toBe(
      "class Student { name; }",
    );
  });

  it("preserves recent automatic snapshots up to the per-model limit", () => {
    for (let i = 0; i < 105; i++) {
      saveModelSnapshot({
        ...model,
        tabs: [
          { id: "tab-1", name: "Model.ump", code: `class Version${i} {}` },
        ],
      });
    }

    const snapshots = getModelSnapshots("test-model");

    expect(snapshots).toHaveLength(100);
    expect(snapshots[0].tabs[0].code).toBe("class Version104 {}");
    expect(snapshots[99].tabs[0].code).toBe("class Version5 {}");
  });

  it("retains automatic snapshots across different age intervals", () => {
    const now = new Date("2026-11-10T12:00:00Z").getTime();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);

      const agesInMinutes = [
        3, // Last 30 minutes
        35, // 30 minutes to 2 hours
        130, // 2 to 12 hours
        780, // 12 hours to 2 days
        4320, // 3 days
        57600, // 40 days
      ];

      const snapshots = agesInMinutes.map((age, index) => ({
        id: `snapshot-${index}`,
        modelId: "test-model",
        timestamp: now - age * 60 * 1000,
        tabs: [
          {
            id: "tab-1",
            name: "Model.ump",
            code: `class Version${index} {}`,
          },
        ],
        activeTabId: "tab-1",
        reason: "automatic" as const,
      }));

      localStorage.setItem(
        "umple-version-history-v1",
        JSON.stringify(snapshots),
      );

      saveModelSnapshot({
        ...model,
        tabs: [
          {
            id: "tab-1",
            name: "Model.ump",
            code: "class Latest {}",
          },
        ],
      });

      const retained = getModelSnapshots("test-model");

      for (const snapshot of snapshots) {
        expect(retained.some((item) => item.id === snapshot.id)).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves recovery snapshots during thinning", () => {
    saveModelSnapshot({
      ...model,
      tabs: [{ id: "tab-1", name: "Model.ump", code: "class Original {}" }],
    });

    saveModelSnapshot({
      ...model,
      reason: "before-restore",
      tabs: [
        { id: "tab-1", name: "Model.ump", code: "class BeforeRestore {}" },
      ],
    });

    saveModelSnapshot({
      ...model,
      tabs: [{ id: "tab-1", name: "Model.ump", code: "class Latest {}" }],
    });

    const snapshots = getModelSnapshots("test-model");

    expect(
      snapshots.some((snapshot) => snapshot.reason === "before-restore"),
    ).toBe(true);

    expect(
      snapshots.some((snapshot) => snapshot.tabs[0].code === "class Latest {}"),
    ).toBe(true);
  });

  it("keeps the newest recovery checkpoint when history exceeds 100 snapshots", () => {
    const recovery = saveModelSnapshot({
      ...model,
      reason: "before-restore",
      tabs: [{ id: "tab-1", name: "Model.ump", code: "class Recovery {}" }],
    });

    expect(recovery).not.toBeNull();

    for (let i = 0; i < 105; i++) {
      saveModelSnapshot({
        ...model,
        reason: "manual",
        tabs: [
          { id: "tab-1", name: "Model.ump", code: `class Version${i} {}` },
        ],
      });
    }

    const snapshots = getModelSnapshots("test-model");

    expect(snapshots.some((snapshot) => snapshot.id === recovery!.id)).toBe(
      true,
    );
  });

  it("returns null when browser storage fails", () => {
    const storageSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });

    try {
      const saved = saveModelSnapshot(model);

      expect(saved).toBeNull();
      expect(getModelSnapshots("test-model")).toHaveLength(0);
    } finally {
      storageSpy.mockRestore();
    }
  });
  it("reuses the same history ID for a previously opened model", () => {
    const firstHistoryId = getOrCreateHistoryId("permanent-model-a");
    const secondHistoryId = getOrCreateHistoryId("permanent-model-a");
    const otherHistoryId = getOrCreateHistoryId("permanent-model-b");

    expect(secondHistoryId).toBe(firstHistoryId);
    expect(otherHistoryId).not.toBe(firstHistoryId);
  });
  it("finds snapshots from previous browser sessions", () => {
    const oldSession = saveModelSnapshot({
      ...model,
      modelId: "previous-session",
      tabs: [
        {
          id: "tab-1",
          name: "Model.ump",
          code: "class Student {}",
        },
      ],
    });

    const currentSession = saveModelSnapshot({
      ...model,
      modelId: "current-session",
      tabs: [
        {
          id: "tab-1",
          name: "Model.ump",
          code: "class Teacher {}",
        },
      ],
    });

    expect(oldSession).not.toBeNull();
    expect(currentSession).not.toBeNull();

    const allSnapshots = getAllModelSnapshots();

    expect(allSnapshots.some((item) => item.id === oldSession?.id)).toBe(true);

    expect(allSnapshots.some((item) => item.id === currentSession?.id)).toBe(
      true,
    );

    expect(getModelSnapshots("previous-session")).toHaveLength(1);
    expect(getModelSnapshots("current-session")).toHaveLength(1);
  });
});
