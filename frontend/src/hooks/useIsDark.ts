/**
 * Whether the page is currently in dark mode.
 * Diagram requests send this so the compiler can pick colors that match the theme.
 */

import { useEffect, useState } from 'react'
import { usePreferencesStore } from '../stores/preferencesStore'

export function useIsDark(): boolean {
  const theme = usePreferencesStore((s) => s.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  if (theme === 'system') return systemDark
  return theme === 'dark'
}
