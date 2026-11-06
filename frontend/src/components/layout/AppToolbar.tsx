/**
 * The top menu bar.
 * Holds examples, generate, execute, AI, tasks, search, and the links that used to live in the sidebar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useEphemeralStore } from "../../stores/ephemeralStore";
import { useSessionStore } from "../../stores/sessionStore";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useRegenerate, useExecute } from "../../hooks/useExecute";
import { useSelectGenerateTarget } from "../../hooks/useGenerate";
import { useExamples } from "../../hooks/useExamples";
import type { ExampleSetId } from "../../api/types";
import {
  APP_TOOLBAR_GENERATE_TARGET_GROUPS,
  getGenerateTarget,
} from "../../generation/targets";
import { getCompileSourceSnapshot } from "@/lib/compileSource";
import { AiConfigForm } from "@/components/sidebar/AiConfigForm";
import { useTaskStore } from "../../stores/taskStore";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Code,
  GitFork,
  Hammer,
  Loader2,
  Play,
  Plus,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { Combobox, type ComboboxGroup } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffectiveDynamicGeneration } from "@/lib/effectiveDynamicGeneration";

const shellBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";
const toolbarBtn =
  "flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer";
const iconBtn =
  "inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";
const acknowledgementLinkBtn =
  "inline-flex items-center rounded-md px-0.5 py-1 text-ink-muted/80 transition-colors hover:bg-surface-2 hover:text-ink xl:px-1";

const toolbarAcknowledgements = [
  {
    href: "https://alliancecan.ca/en",
    label: "Digital Research Alliance of Canada",
    src: "/alliance-logo.jpeg",
    imageClassName: "h-[13px] xl:h-[16px]",
  },
  {
    href: "https://www.nserc-crsng.gc.ca/ase-oro/Details-Detailles_eng.asp?id=752498",
    label: "NSERC",
    src: "/nserc-logo.png",
    imageClassName: "h-[15px] xl:h-[18px]",
  },
  {
    href: "https://www.uottawa.ca/faculty-engineering/school-electrical-engineering-computer-science",
    label: "University of Ottawa",
    src: "/uottawa-logo.svg",
    imageClassName: "h-[16px] xl:h-[20px]",
  },
] as const;

export function AppToolbar() {
  const { regenerate, regenerating } = useRegenerate();
  const { execute } = useExecute();
  const openCommandPalette = useEphemeralStore((s) => s.openCommandPalette);
  const generatingOutput = useEphemeralStore((s) => s.generatingOutput);
  const generatingCode = useEphemeralStore((s) => s.generatingCode);
  const executing = useEphemeralStore((s) => s.executing);
  const errorCount = useEphemeralStore((s) => s.outputErrorCount);
  const dynamicGeneration = usePreferencesStore((s) => s.dynamicGeneration);
  const effectiveDynamicGeneration = useEffectiveDynamicGeneration();
  const diagramOnly = useEphemeralStore((s) => s.diagramOnly);
  const rightPanelView = useEphemeralStore((s) => s.rightPanelView);
  const generateTargetId = useSessionStore((s) => s.generateTargetId);
  const tabsVersion = useSessionStore((s) => s.tabsVersion);
  const selectedExampleId = useSessionStore((s) => s.selectedExampleId);
  const selectedExampleSetId = useSessionStore((s) => s.selectedExampleSetId);
  const generationErrorSourceSignature = useEphemeralStore((s) => s.generationErrorSourceSignature);
  const handleGenerate = useSelectGenerateTarget();
  const {
    sets: exampleSets,
    loadExample,
    loadBlank,
    loading: loadingExamples,
  } = useExamples();
  const selectedGenerateTarget = getGenerateTarget(generateTargetId);
  const canExecuteGenerateTarget = Boolean(selectedGenerateTarget?.executable);
  const regeneratingOutput = regenerating || generatingOutput;
  const currentSource = getCompileSourceSnapshot();
  const generationSuspendedForCurrentInput =
    generationErrorSourceSignature === currentSource.signature;
  const generationPausedForFullscreen =
    dynamicGeneration && !effectiveDynamicGeneration && diagramOnly && rightPanelView === "generated";
  const showTemporaryRegenerate =
    generationPausedForFullscreen || (dynamicGeneration && generationSuspendedForCurrentInput);
  const [examplePickerOpen, setExamplePickerOpen] = useState(false);
  const [activeExampleSetId, setActiveExampleSetId] =
    useState<ExampleSetId | null>(null);
  const [exampleQuery, setExampleQuery] = useState("");
  void tabsVersion;

  const selectedExampleSet = useMemo(
    () =>
      exampleSets.find((set) => set.id === selectedExampleSetId) ??
      exampleSets[0] ??
      null,
    [exampleSets, selectedExampleSetId],
  );

  const selectedExample = useMemo(
    () =>
      exampleSets
        .flatMap((set) => set.examples)
        .find((example) => example.id === selectedExampleId) ?? null,
    [exampleSets, selectedExampleId],
  );

  const filteredExampleSets = useMemo(() => {
    const query = exampleQuery.trim().toLowerCase();
    if (!query) return exampleSets;

    return exampleSets.filter((set) => {
      const setMatches = set.label.toLowerCase().includes(query);
      const exampleMatches = set.examples.some((example) =>
        `${example.name} ${example.label ?? ""}`.toLowerCase().includes(query),
      );
      return setMatches || exampleMatches;
    });
  }, [exampleSets, exampleQuery]);

  const activeExampleSet = useMemo(
    () =>
      filteredExampleSets.find((set) => set.id === activeExampleSetId) ??
      filteredExampleSets.find((set) => set.id === selectedExampleSetId) ??
      filteredExampleSets[0] ??
      null,
    [filteredExampleSets, activeExampleSetId, selectedExampleSetId],
  );

  const filteredExamples = useMemo(() => {
    if (!activeExampleSet) return [];

    const query = exampleQuery.trim().toLowerCase();
    if (!query) return activeExampleSet.examples;

    return activeExampleSet.examples.filter((example) =>
      `${example.name} ${example.label ?? ""}`.toLowerCase().includes(query),
    );
  }, [activeExampleSet, exampleQuery]);

  const exampleTriggerLabel = useMemo(() => {
    if (selectedExampleId === "blank") {
      return "Select Example";
    }

    return selectedExample?.label || selectedExample?.name || "Select Example";
  }, [selectedExample, selectedExampleId]);

  const exampleTriggerSetLabel = useMemo(
    () => selectedExampleSet?.label ?? activeExampleSet?.label ?? null,
    [selectedExampleSet, activeExampleSet],
  );

  const generateGroups = useMemo<ComboboxGroup[]>(
    () =>
      APP_TOOLBAR_GENERATE_TARGET_GROUPS.map((group) => ({
        label: group.label,
        options: group.targets.map((target) => ({
          value: target.id,
          label: target.label,
          keywords: [target.id, group.label],
        })),
      })),
    [],
  );

  // Regeneration success micro-interaction
  const prevGeneratingOutputRef = useRef(generatingOutput);
  const [justRegenerated, setJustRegenerated] = useState(false);

  useEffect(() => {
    const didJustRegenerate =
      prevGeneratingOutputRef.current && !generatingOutput && errorCount === 0;
    prevGeneratingOutputRef.current = generatingOutput;

    if (didJustRegenerate) {
      setJustRegenerated(true);
      const timer = setTimeout(() => setJustRegenerated(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [generatingOutput, errorCount]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        regenerate();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [regenerate]);

  useEffect(() => {
    if (selectedExampleSetId) {
      setActiveExampleSetId(selectedExampleSetId);
    }
  }, [selectedExampleSetId]);

  useEffect(() => {
    if (!activeExampleSetId && exampleSets.length > 0) {
      setActiveExampleSetId(exampleSets[0].id);
    }
  }, [activeExampleSetId, exampleSets]);

  useEffect(() => {
    if (!examplePickerOpen) {
      setExampleQuery("");
    }
  }, [examplePickerOpen]);

  return (
    <div
      className="relative flex items-center justify-between gap-3 h-[var(--toolbar-h)] px-3 shrink-0 border-b border-border/70 bg-surface-1/95 backdrop-blur-sm"
      data-testid="app-toolbar"
    >
      <div className="flex items-center gap-2 shrink-0">
        <Tip
          side="bottom"
          content={
            <div className="space-y-1">
              <p className="font-medium">UmpleOnline v2 is experimental.</p>
              <p>
                Use{" "}
                <a
                  href="https://try.umple.org"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:text-brand-hover"
                >
                  try.umple.org
                </a>{" "}
                for production work.
              </p>
            </div>
          }
        >
          <a
            href="https://umple.org"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-ink transition-colors hover:bg-surface-2"
            aria-label="Open the Umple website"
          >
            <img src="/umple-logo.svg" alt="" className="h-5 w-auto shrink-0" />
            <span className="text-sm font-semibold tracking-tight whitespace-nowrap">
              UmpleOnline (v2)
            </span>
          </a>
        </Tip>

        <Tip content="Open the user manual" side="bottom">
          <a
            href="https://manual.umple.org"
            target="_blank"
            rel="noreferrer"
            className={shellBtn}
          >
            <BookOpen className="size-3.5" />
            Manual
          </a>
        </Tip>
      </div>

      <div className="flex flex-1 min-w-0 justify-center">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-1" data-tour="examples">
            <Popover
              open={examplePickerOpen}
              onOpenChange={setExamplePickerOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Examples"
                  disabled={loadingExamples && exampleSets.length === 0}
                  className={cn(
                    toolbarBtn,
                    "h-8 min-w-[14rem] border border-border/70 bg-surface-0 px-2.5 py-1 shadow-sm focus:border-border-strong focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    {exampleTriggerSetLabel ? (
                      <>
                        <span className="truncate">{exampleTriggerSetLabel}</span>
                        <span className="text-ink-faint">/</span>
                      </>
                    ) : null}
                    <span
                      className={cn(
                        "truncate",
                        selectedExampleId === "blank" || !selectedExampleId
                          ? "text-ink-muted"
                          : "text-ink",
                      )}
                    >
                      {exampleTriggerLabel}
                    </span>
                  </span>
                  <ChevronDown className="size-3 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-[34rem] p-0">
                <PopoverHeader className="gap-0.5 border-b border-border px-3 py-2.5">
                  <PopoverTitle className="text-sm">Examples</PopoverTitle>
                  <PopoverDescription className="text-xs">
                    Choose a type, then an example.
                  </PopoverDescription>
                </PopoverHeader>

                <div className="border-b border-border px-3 py-2">
                  <Input
                    value={exampleQuery}
                    onChange={(event) => setExampleQuery(event.target.value)}
                    placeholder="Search example types and examples..."
                    aria-label="Search examples"
                  />
                </div>

                <div className="grid grid-cols-[13rem_minmax(0,1fr)]">
                  <div className="border-r border-border bg-surface-1/40 p-2">
                    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                      {filteredExampleSets.length > 0 ? (
                        filteredExampleSets.map((set) => {
                          const isActive = set.id === activeExampleSet?.id;
                          return (
                            <button
                              key={set.id}
                              type="button"
                              onClick={() => setActiveExampleSetId(set.id)}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                isActive
                                  ? "bg-surface-2 text-ink"
                                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                              )}
                            >
                              <span className="truncate">{set.label}</span>
                              <Check
                                className={cn(
                                  "size-3.5 shrink-0",
                                  isActive ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-2 py-4 text-xs text-ink-faint">
                          {loadingExamples
                            ? "Loading example types..."
                            : "No example types."}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-2">
                    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                      {activeExampleSet ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              loadBlank(
                                activeExampleSet.id,
                                activeExampleSet.categoryId,
                                { switchToDefaultView: true },
                              );
                              setExamplePickerOpen(false);
                            }}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                              selectedExampleId === "blank" &&
                                selectedExampleSetId === activeExampleSet.id
                                ? "bg-surface-2 text-ink"
                                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                            )}
                          >
                            <Plus className="size-3.5 shrink-0" />
                            <span className="truncate">Start Blank Model</span>
                            <Check
                              className={cn(
                                "ml-auto size-3.5 shrink-0",
                                selectedExampleId === "blank" &&
                                  selectedExampleSetId === activeExampleSet.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                          </button>

                          {filteredExamples.length > 0 ? (
                            filteredExamples.map((example) => {
                              const isSelected =
                                selectedExampleId === example.id;
                              return (
                                <button
                                  key={example.id}
                                  type="button"
                                  onClick={() => {
                                    void loadExample(example.id, {
                                      switchToDefaultView: true,
                                    });
                                    setExamplePickerOpen(false);
                                  }}
                                  className={cn(
                                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                    isSelected
                                      ? "bg-surface-2 text-ink"
                                      : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                                  )}
                                >
                                  <span className="truncate">
                                    {example.label || example.name}
                                  </span>
                                  <Check
                                    className={cn(
                                      "ml-auto size-3.5 shrink-0",
                                      isSelected ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-2 py-4 text-xs text-ink-faint">
                              {loadingExamples
                                ? "Loading examples..."
                                : "No examples in this type."}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="px-2 py-4 text-xs text-ink-faint">
                          {loadingExamples
                            ? "Loading examples..."
                            : "No examples."}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {(!effectiveDynamicGeneration || showTemporaryRegenerate) && (
            <Tip
              content={
                generationPausedForFullscreen
                  ? "Auto-generation is paused while output is fullscreen"
                  : showTemporaryRegenerate
                    ? "Temporary retry while auto-generation is paused by an error"
                  : "Regenerate output (Ctrl+Enter)"
              }
              side="bottom"
            >
              <span className="inline-flex" data-testid="regenerate-button-wrapper">
                <button
                  onClick={regenerate}
                  disabled={regeneratingOutput}
                  aria-label={
                    regeneratingOutput
                      ? "Regenerating output"
                      : "Regenerate output (Ctrl+Enter)"
                  }
                  data-testid="regenerate-button"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-surface-0 px-2.5 text-xs font-medium text-ink-muted shadow-sm transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-70",
                    showTemporaryRegenerate && "border-brand/70",
                  )}
                >
                  {regeneratingOutput ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  ) : justRegenerated ? (
                    <Check className="size-3.5 shrink-0 text-status-success animate-fade-in" />
                  ) : (
                    <Hammer className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {regeneratingOutput ? (
                      "Regenerating..."
                    ) : justRegenerated ? (
                      <span className="text-status-success animate-fade-in">
                        Regenerated
                      </span>
                    ) : (
                      "Regenerate"
                    )}
                  </span>
                </button>
              </span>
            </Tip>
          )}

          <span className="inline-flex" data-tour="generate" data-testid="generate-target-wrapper">
            <Combobox
              groups={generateGroups}
              value={generateTargetId}
              onSelect={(targetId) => {
                void handleGenerate(targetId);
              }}
              placeholder="Generate"
              searchPlaceholder="Search targets..."
              disabled={generatingCode}
              className="w-auto h-8 border border-border/70 bg-surface-0 px-2.5 py-1 font-medium text-ink-muted shadow-sm hover:text-ink hover:bg-surface-2 focus:border-border-strong focus:ring-0"
              contentClassName="w-72 min-w-[18rem]"
              listClassName="max-h-80"
              triggerChildren={
                <>
                  {generatingCode ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Code className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {generatingCode
                      ? "Generating..."
                      : selectedGenerateTarget?.label ?? "Generate"}
                  </span>
                  <ChevronDown className="size-3 shrink-0" />
                </>
              }
              ariaLabel="Generate"
            />
          </span>

          <Tip
            content={
              canExecuteGenerateTarget
                ? `Execute ${selectedGenerateTarget?.label ?? generateTargetId}`
                : "Execution is only supported for Java and Python"
            }
            side="bottom"
          >
            <button
              onClick={() => void execute(generateTargetId)}
              disabled={executing || !canExecuteGenerateTarget}
              aria-label={
                executing
                  ? "Executing"
                  : `Execute ${selectedGenerateTarget?.label ?? generateTargetId}`
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-surface-0 px-2.5 text-xs font-medium text-ink-muted shadow-sm transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-70"
            >
              {executing ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
              ) : (
                <Play className="size-3.5 shrink-0" />
              )}
              <span className="truncate">
                {executing ? "Executing..." : "Execute"}
              </span>
            </button>
          </Tip>

          <Popover>
            <Tip content="Umple AI" side="bottom">
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    shellBtn,
                    "border border-border/70 bg-surface-0 shadow-sm",
                  )}
                  aria-label="Umple AI configuration"
                >
                  <Sparkles className="size-3.5" />
                  AI
                </button>
              </PopoverTrigger>
            </Tip>
            <PopoverContent align="end" className="w-72">
              <p className="text-xs font-medium mb-2">Umple AI</p>
              <AiConfigForm />
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <Tip content="Tasks" side="bottom">
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    shellBtn,
                    "border border-border/70 bg-surface-0 shadow-sm",
                  )}
                  aria-label="Tasks"
                >
                  <ClipboardList className="size-3.5" />
                  Tasks
                  <ChevronDown className="size-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => useTaskStore.getState().openSheet("create")}
              >
                <Plus className="size-3.5" />
                Create Task
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => useTaskStore.getState().openSheet("manage")}
              >
                <Search className="size-3.5" />
                Manage Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <TopLinkIconButton
          href="https://umple.org/questions"
          label="Ask a question"
          icon={CircleHelp}
        />
        <TopLinkIconButton
          href="https://github.com/umple/umpleonline"
          label="GitHub repository"
          icon={GitFork}
        />
        <TopLinkIconButton
          href="https://umple.org/privacy"
          label="Privacy and security"
          icon={Shield}
        />
        <Tip content="Search commands and examples (Ctrl+K)" side="bottom">
          <button
            onClick={openCommandPalette}
            className={iconBtn}
            aria-label="Open command palette"
          >
            <Search className="size-4" />
          </button>
        </Tip>

        <div
          className="ml-1 hidden shrink-0 items-center gap-0.5 border-l border-border/70 pl-1.5 lg:flex xl:gap-1.5 xl:pl-2"
          aria-label="Project acknowledgements"
          data-testid="toolbar-acknowledgements"
        >
          {toolbarAcknowledgements.map((acknowledgement) => (
            <Tip key={acknowledgement.label} content={acknowledgement.label} side="bottom">
              <a
                href={acknowledgement.href}
                target="_blank"
                rel="noreferrer"
                className={acknowledgementLinkBtn}
                aria-label={acknowledgement.label}
              >
                <img
                  src={acknowledgement.src}
                  alt=""
                  className={cn(
                    "w-auto shrink-0 object-contain",
                    acknowledgement.imageClassName,
                  )}
                />
              </a>
            </Tip>
          ))}
        </div>
      </div>

      {(regenerating || generatingCode || executing) && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/4 bg-brand animate-progress-indeterminate" />
        </div>
      )}
    </div>
  );
}

function TopLinkIconButton({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Tip content={label} side="bottom">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={iconBtn}
        aria-label={label}
      >
        <Icon className="size-4" />
      </a>
    </Tip>
  );
}
