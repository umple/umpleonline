/**
 * Command search opened from the toolbar.
 * Runs editor commands and loads an example by name. It is the only search box in the app.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useEphemeralStore } from "../../stores/ephemeralStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGenerate } from "../../hooks/useGenerate";
import { useExamples } from "../../hooks/useExamples";
import { GENERATE_TARGET_GROUPS } from "../../generation/targets";
import type { ExampleCategoryId } from "../../api/types";
import {
  LayoutGrid,
  Workflow,
  GitBranch,
  Network,
  Code,
  Layers,
  Maximize2,
  Minimize2,
  Terminal,
  FileCode,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";

const CATEGORY_ICONS: Partial<Record<ExampleCategoryId, React.ReactNode>> = {
  class: <LayoutGrid />,
  state: <Workflow />,
  structure: <Network />,
  feature: <GitBranch />,
};

export function CommandPalette() {
  const {
    commandPaletteOpen,
    closeCommandPalette,
    setDiagramOnly,
    diagramOnly,
    rightPanelView,
    toggleOutputPanel,
    setRenderMode,
    renderMode,
  } = useEphemeralStore();
  const viewMode = useSessionStore((s) => s.viewMode);
  const umpleModel = useSessionStore((s) => s.umpleModel);
  const generate = useGenerate();
  const { examples, loadExample, loading } = useExamples();

  const [search, setSearch] = useState("");

  // Reset state when palette closes
  useEffect(() => {
    if (!commandPaletteOpen) {
      setSearch("");
    }
  }, [commandPaletteOpen]);

  // Global Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        const state = useEphemeralStore.getState();
        if (state.commandPaletteOpen) {
          state.closeCommandPalette();
        } else {
          state.openCommandPalette();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleGenerate = useCallback(
    async (language: string) => {
      closeCommandPalette();
      generate(language);
    },
    [closeCommandPalette, generate],
  );

  const exampleItems = useMemo(
    () =>
      examples.map((example) => ({
        exampleId: example.id,
        categoryId: example.categoryId,
        setLabel: example.setLabel,
        exampleName: example.name,
        exampleLabel: example.label || example.name,
      })),
    [examples],
  );
  const canToggleRenderer =
    viewMode === "class" && !!umpleModel?.umpleClasses?.length;
  const fullscreenLabel =
    rightPanelView === "generated" ? "Output Only Mode" : "Diagram Only Mode";

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={(open) => {
        if (!open) closeCommandPalette();
      }}
      showCloseButton={false}
      className="sm:max-w-[520px]"
      data-testid="command-palette"
    >
      <CommandInput
        placeholder="Search outputs, views, and examples..."
        data-testid="command-palette-input"
        value={search}
        onValueChange={setSearch}
      />

      <CommandList data-testid="command-palette-results">
        <CommandEmpty>No results found</CommandEmpty>

        {GENERATE_TARGET_GROUPS.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.targets.map((target) => (
              <CommandItem
                key={target.id}
                onSelect={() => handleGenerate(target.id)}
                data-testid={`command-item-gen-${target.id}`}
              >
                <Code />
                {target.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />
        <CommandGroup heading="View">
          {canToggleRenderer && (
            <CommandItem
              onSelect={() => {
                setRenderMode(
                  renderMode === "editable" ? "graphviz" : "editable",
                );
                closeCommandPalette();
              }}
              data-testid="command-item-view-renderer"
            >
              <Layers />
              Switch to {renderMode === "editable"
                ? "Graphviz"
                : "Editable"}{" "}
              Rendering
            </CommandItem>
          )}
          <CommandItem
            onSelect={() => {
              setDiagramOnly(!diagramOnly);
              closeCommandPalette();
            }}
            data-testid="command-item-view-diagram-only"
          >
            {diagramOnly ? <Minimize2 /> : <Maximize2 />}
            {diagramOnly ? "Exit Fullscreen Output" : fullscreenLabel}
          </CommandItem>
          <CommandItem
            onSelect={() => {
              toggleOutputPanel();
              closeCommandPalette();
            }}
            data-testid="command-item-view-output-panel"
          >
            <Terminal />
            Toggle Output Panel
            <CommandShortcut>Ctrl+'</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Examples">
          {loading ? (
            <div className="py-2 text-center text-xs text-muted-foreground">
              Loading examples...
            </div>
          ) : (
            exampleItems.map((item) => (
              <CommandItem
                key={item.exampleId}
                value={`${item.exampleLabel} ${item.exampleName} ${item.setLabel}`}
                onSelect={() => {
                  closeCommandPalette();
                  void loadExample(item.exampleId, {
                    switchToDefaultView: true,
                  });
                }}
                data-testid={`command-item-example-${item.exampleId}`}
              >
                {CATEGORY_ICONS[item.categoryId] ?? <FileCode />}
                {item.exampleLabel}
                <span className="ml-auto text-xs text-muted-foreground">
                  {item.setLabel}
                </span>
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
