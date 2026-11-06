/**
 * Preferences sidebar.
 * Dynamic generation and theme live here. It stays closed until the toolbar opens it.
 */

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { Monitor, Moon, Sun } from 'lucide-react'

function getSidebarShortcutLabel() {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
    return 'Cmd+B'
  }
  return 'Ctrl+B'
}

export function AppSidebar() {
  const open = usePreferencesStore((s) => s.showSidebar)
  const shortcutLabel = getSidebarShortcutLabel()

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => usePreferencesStore.setState({ showSidebar: nextOpen })}
    >
      <SheetContent
        side="left"
        className="w-[20rem] max-w-[20rem] p-0"
      >
        <SheetHeader className="items-start pr-12">
          <SheetTitle>Preferences</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-ink">Theme</h2>
            </div>
            <ThemePicker />
          </section>

          <section className="mt-6 space-y-3">
            <div>
              <h2 className="text-sm font-medium text-ink">Generation</h2>
            </div>
            <DynamicGenerationToggle />
          </section>
        </div>

        <SheetFooter className="border-t border-border bg-surface-1 px-4 py-3">
          <p className="text-xs text-ink-faint">Press {shortcutLabel} to open or close this panel.</p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DynamicGenerationToggle() {
  const dynamicGeneration = usePreferencesStore((s) => s.dynamicGeneration)
  const setDynamicGeneration = usePreferencesStore((s) => s.setDynamicGeneration)

  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-ink">Dynamically generate while editing</p>
        <p className="text-xs text-ink-muted">
          Keep the current output updated as you edit. Turn this off on slower machines or networks.
        </p>
      </div>
      <Switch
        checked={dynamicGeneration}
        onCheckedChange={setDynamicGeneration}
        aria-label="Dynamically generate while editing"
      />
    </div>
  )
}

function ThemePicker() {
  const theme = usePreferencesStore((s) => s.theme)
  const setTheme = usePreferencesStore((s) => s.setTheme)

  function handleSwitch(value: 'light' | 'dark' | 'system') {
    document.documentElement.classList.add('disable-transitions')
    setTheme(value)
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('disable-transitions')
    })
  }

  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={(value) => {
        if (value === 'light' || value === 'dark' || value === 'system') {
          handleSwitch(value)
        }
      }}
      variant="outline"
      className="grid w-full grid-cols-3 gap-2"
      spacing={2}
    >
      <ThemeOption value="light" label="Light" icon={Sun} />
      <ThemeOption value="dark" label="Dark" icon={Moon} />
      <ThemeOption value="system" label="System" icon={Monitor} />
    </ToggleGroup>
  )
}

function ThemeOption({
  value,
  label,
  icon: Icon,
}: {
  value: 'light' | 'dark' | 'system'
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <ToggleGroupItem
      value={value}
      className="flex h-16 flex-col gap-1 rounded-xl border border-border/70 bg-surface-0 px-2 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink data-[state=on]:border-border-strong data-[state=on]:bg-surface-2 data-[state=on]:text-ink"
      aria-label={label}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </ToggleGroupItem>
  )
}
