/**
 * Light, dark, and system theme control.
 * Writes the choice to preferencesStore. App.tsx applies it on the document.
 */

import { Moon, Sun, Monitor } from 'lucide-react'
import { usePreferencesStore } from '../../stores/preferencesStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

const options = [
  { value: 'light' as const, icon: Sun, label: 'Light' },
  { value: 'dark' as const, icon: Moon, label: 'Dark' },
  { value: 'system' as const, icon: Monitor, label: 'System' },
]

export function ThemeToggle() {
  const theme = usePreferencesStore((s) => s.theme)
  const setTheme = usePreferencesStore((s) => s.setTheme)

  function handleSwitch(value: (typeof options)[number]['value']) {
    document.documentElement.classList.add('disable-transitions')
    setTheme(value)
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('disable-transitions')
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative p-1.5 transition-colors cursor-pointer rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 data-[state=open]:bg-surface-2"
        aria-label="Toggle theme"
      >
        <Sun className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute inset-0 m-auto size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        {options.map(({ value, icon: Icon, label }) => (
          <DropdownMenuItem key={value} onSelect={() => handleSwitch(value)}>
            <Icon className="size-3.5" />
            {label}
            {theme === value && (
              <span className="ml-auto text-xs text-ink-muted">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
