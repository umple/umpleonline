/**
 * Controls drawn on top of a diagram.
 * Layout algorithm, display options, class filters, and mixsets. DiagramPanel mounts this for diagram targets.
 */

import { useEffect, useMemo, useState } from 'react'
import { CircleHelp, Eye, ChevronDown, Download, LayoutGrid, ListFilter } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { usePreferencesStore, type DisplayPrefKey, type GvLayoutAlgorithm } from '../../stores/preferencesStore'
import { DISPLAY_TOGGLES, LAYOUT_OPTIONS } from '../../constants/diagram'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import {
  CLASS_FILTER_DEFAULT_QUERY,
  discoverNamedClassDiagramOverlays,
} from '@/lib/classDiagramFilters'
import { getCompileSourceSnapshot } from '@/lib/compileSource'
import { cn } from '@/lib/utils'

const btnBase =
  'px-1.5 py-0.5 text-xs cursor-pointer transition-colors rounded focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1 text-ink-muted hover:text-ink hover:bg-surface-2 flex items-center gap-1'

const LEGACY_FILTER_TOOLTIP = (
  <>
    You can choose to display a subset of classes by naming them, separated by spaces.
    <br />
    <br />
    You can use glob wildcards to specify patterns matching several classes.
    <br />
    <br />
    So * matches any number of characters in a class name and ? matches any single character.
    <br />
    <br />
    Preceding a pattern with a ~ indicates to skip classes matching the pattern.
    <br />
    <br />
    Superclasses of any selected classes will always also appear (even if ~ is used)
    <br />
    <br />
    The above is a shortcut for including a filter directive in the code.
    <br />
    <br />
    using the notation filter {'{'}include Classpattern;{'}'}
    <br />
    <br />
    Filters in the code will take precedence.
    <br />
    <br />
    No class pattern starting with 'gv' can be used as these match the suboptions below.
    <br />
    <br />
    You can also use an integer such as 1 or 2 to also add classees that are connected by an association 1 or 2
    (or any number of ) hops away from selected classes.
    <br />
    <br />
    You can also widen (or narrow) the spacing of nodes by using an expression like gvseparator=1.7 , where 1.0 is
    the default spacing.
  </>
)

const LEGACY_NAMED_FILTER_TOOLTIP = 'Activate the named filter to show only the selected classes'
const LEGACY_MIXSET_TOOLTIP = 'Activate the code contained in this named mixset'

interface CanvasToolbarProps {
  hasDiagram: boolean
  onExport: (format: string) => void
  canToggleRenderer: boolean
  renderMode: 'editable' | 'graphviz'
  onRenderModeChange: (mode: 'editable' | 'graphviz') => void
  showDisplayOptions?: boolean
  variant?: 'overlay' | 'banner'
}

export function CanvasToolbar({
  hasDiagram,
  onExport,
  canToggleRenderer,
  renderMode,
  onRenderModeChange,
  showDisplayOptions = true,
  variant = 'overlay',
}: CanvasToolbarProps) {
  const viewMode = useSessionStore((s) => s.viewMode)
  const toggles = DISPLAY_TOGGLES[viewMode]
  const hasToggles = showDisplayOptions && toggles.length > 0

  if (!hasDiagram) return null

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center rounded-lg',
        variant === 'overlay'
          ? 'bg-surface-0/90 backdrop-blur-sm border border-border px-1 py-1 shadow-sm'
          : 'gap-1'
      )}
      data-testid="canvas-toolbar"
    >
      {canToggleRenderer && (
        <>
          <RendererToggle renderMode={renderMode} onRenderModeChange={onRenderModeChange} />
          <ToolbarDivider />
        </>
      )}

      <LayoutGroup />

      {hasToggles && (
        <>
          <ToolbarDivider />
          <DisplayOptionsGroup toggles={toggles} />
        </>
      )}

      <ToolbarDivider />

      <ExportGroup onExport={onExport} />
    </div>
  )
}

export function ToolbarDivider() {
  return <div className="w-px self-stretch bg-border/60 mx-0.5" />
}

function DisplayOptionsGroup({ toggles }: { toggles: { key: DisplayPrefKey; label: string }[] }) {
  const viewMode = useSessionStore((s) => s.viewMode)
  const showClassFilters = viewMode === 'class'

  return (
    <Popover>
      <Tip content="Display options" side="bottom">
        <PopoverTrigger asChild>
          <button className={btnBase} data-testid="canvas-display-options-button">
            <Eye className="size-3" />
            <ChevronDown className="size-2.5 text-ink-faint" />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        className="w-auto p-2"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          {showClassFilters && (
            <>
              <ClassFilterSection />
              <div className="my-1 h-px bg-border/70" />
            </>
          )}
          {toggles.map(({ key, label }) => (
            <ToggleItem key={key} prefKey={key} label={label} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LayoutGroup() {
  const layoutAlgorithm = usePreferencesStore((s) => s.layoutAlgorithm)
  const setLayoutAlgorithm = usePreferencesStore((s) => s.setLayoutAlgorithm)
  const current = LAYOUT_OPTIONS.find((o) => o.value === layoutAlgorithm)

  return (
    <DropdownMenu>
      <Tip content="Layout algorithm" side="bottom">
        <DropdownMenuTrigger asChild>
          <button className={btnBase}>
            <LayoutGrid className="size-3" />
            {current?.label ?? 'Dot'}
            <ChevronDown className="size-2.5 text-ink-faint" />
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup value={layoutAlgorithm} onValueChange={(v) => setLayoutAlgorithm(v as GvLayoutAlgorithm)}>
          {LAYOUT_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ClassFilterSection() {
  const code = useSessionStore((s) => s.code)
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tabsVersion = useSessionStore((s) => s.tabsVersion)
  const classFilterQuery = useSessionStore((s) => s.classFilterQuery)
  const activeNamedFilters = useSessionStore((s) => s.activeNamedFilters)
  const activeMixsets = useSessionStore((s) => s.activeMixsets)
  const setClassFilterQuery = useSessionStore((s) => s.setClassFilterQuery)
  const toggleNamedFilter = useSessionStore((s) => s.toggleNamedFilter)
  const toggleMixset = useSessionStore((s) => s.toggleMixset)
  const [draftQuery, setDraftQuery] = useState(classFilterQuery)

  useEffect(() => {
    setDraftQuery(classFilterQuery)
  }, [classFilterQuery])

  const availableOptions = useMemo(
    () => discoverNamedClassDiagramOverlays(getCompileSourceSnapshot().tabs),
    [tabs, activeTabId, code, tabsVersion],
  )
  const activeOptionCount = activeNamedFilters.length + activeMixsets.length
  const availableOptionCount = availableOptions.namedFilters.length + availableOptions.mixsets.length
  const filterHelpContent = (
    <>
      {LEGACY_FILTER_TOOLTIP}
      {availableOptions.namedFilters.length > 0 ? (
        <>
          <br />
          <br />
          Named Filters: {LEGACY_NAMED_FILTER_TOOLTIP}
        </>
      ) : null}
      {availableOptions.mixsets.length > 0 ? (
        <>
          <br />
          <br />
          Mixsets: {LEGACY_MIXSET_TOOLTIP}
        </>
      ) : null}
    </>
  )

  const commitQuery = () => {
    setClassFilterQuery(draftQuery)
  }

  const revertQuery = () => {
    setDraftQuery(classFilterQuery)
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-2" data-testid="class-filter-group">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xxs font-medium text-ink">Class Filters</div>
        {availableOptionCount > 0 ? (
          <span className="text-xxs text-ink-muted" data-testid="class-filter-options-count">
            {activeOptionCount > 0 ? `${activeOptionCount} active` : `${availableOptionCount} available`}
          </span>
        ) : null}
      </div>

      <div
        className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface-0 px-2 text-xs text-ink-muted hover:bg-surface-1 focus-within:border-brand focus-within:text-ink focus-within:ring-1 focus-within:ring-brand"
        data-testid="class-filter-shell"
      >
        <ListFilter className="size-3 shrink-0" />
        <Input
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
          onBlur={commitQuery}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitQuery()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              revertQuery()
              event.currentTarget.blur()
            }
          }}
          placeholder={CLASS_FILTER_DEFAULT_QUERY}
          className="h-auto w-[170px] border-0 bg-transparent px-0 py-0 text-xs text-ink shadow-none hover:bg-transparent focus:border-0 focus:ring-0"
          data-testid="class-filter-input"
          aria-label="Class filter query"
        />
        <Tip content={filterHelpContent} side="bottom">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
            data-testid="class-filter-info-button"
            aria-label="Class filter help"
          >
            <CircleHelp className="size-3.5" />
          </button>
        </Tip>
      </div>

      {availableOptions.namedFilters.length > 0 ? (
        <NamedFilterList
          title="Named Filters"
          options={availableOptions.namedFilters}
          active={activeNamedFilters}
          onToggle={toggleNamedFilter}
          testIdPrefix="class-filter-named-filter"
        />
      ) : null}
      {availableOptions.mixsets.length > 0 ? (
        <NamedFilterList
          title="Mixsets"
          options={availableOptions.mixsets}
          active={activeMixsets}
          onToggle={toggleMixset}
          testIdPrefix="class-filter-mixset"
        />
      ) : null}
    </div>
  )
}

function NamedFilterList({
  title,
  options,
  active,
  onToggle,
  testIdPrefix,
}: {
  title: string
  options: string[]
  active: string[]
  onToggle: (name: string) => void
  testIdPrefix: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xxs font-medium text-ink-muted">{title}</div>
      {options.map((name) => {
        const checked = active.includes(name)
        return (
          <label
            key={name}
            className="flex items-center justify-between gap-3 py-0.5 cursor-pointer min-w-[120px]"
            data-testid={`${testIdPrefix}-${name}`}
          >
            <span className={`text-xxs transition-colors ${checked ? 'text-ink font-medium' : 'text-ink-muted'}`}>
              {name}
            </span>
            <Switch size="sm" checked={checked} onCheckedChange={() => onToggle(name)} />
          </label>
        )
      })}
    </div>
  )
}

function ExportGroup({ onExport }: { onExport: (format: string) => void }) {
  return (
    <DropdownMenu>
      <Tip content="Export" side="bottom">
        <DropdownMenuTrigger asChild>
          <button className={btnBase}>
            <Download className="size-3" />
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="center">
        <DropdownMenuLabel>Diagram</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport('svg')}>SVG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport('png')}>PNG</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport('ump')}>Umple Code (.ump)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RendererToggle({
  renderMode,
  onRenderModeChange,
}: {
  renderMode: 'editable' | 'graphviz'
  onRenderModeChange: (mode: 'editable' | 'graphviz') => void
}) {
  return (
    <Tip content={`Renderer: ${renderMode === 'editable' ? 'Editable' : 'Graphviz'}`} side="bottom">
      <label className="flex items-center gap-1.5 cursor-pointer px-1">
        <span className={`text-xs ${renderMode === 'editable' ? 'text-ink font-semibold' : 'text-ink-muted'}`}>
          Edit
        </span>
        <Switch
          size="sm"
          checked={renderMode === 'graphviz'}
          onCheckedChange={(checked) => onRenderModeChange(checked ? 'graphviz' : 'editable')}
        />
        <span className={`text-xs ${renderMode === 'graphviz' ? 'text-ink font-semibold' : 'text-ink-muted'}`}>
          GV
        </span>
      </label>
    </Tip>
  )
}

function ToggleItem({ prefKey, label }: { prefKey: DisplayPrefKey; label: string }) {
  const checked = usePreferencesStore((s) => s[prefKey])
  const toggleDisplayPref = usePreferencesStore((s) => s.toggleDisplayPref)

  return (
    <label
      className="flex items-center justify-between gap-3 py-0.5 cursor-pointer min-w-[120px]"
      data-testid={`canvas-toggle-${prefKey}`}
    >
      <span className={`text-xxs transition-colors ${checked ? 'text-ink font-medium' : 'text-ink-muted'}`}>
        {label}
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={() => toggleDisplayPref(prefKey)} />
    </label>
  )
}
