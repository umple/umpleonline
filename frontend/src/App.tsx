/**
 * Root React layout.
 * Applies the saved theme, sets the document title, and renders the active route plus toasts.
 */

import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { usePreferencesStore } from './stores/preferencesStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

function useThemeEffect() {
  const theme = usePreferencesStore((s) => s.theme)

  useEffect(() => {
    const apply = (resolved: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', resolved === 'dark')
    }

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }

    apply(theme)
  }, [theme])
}

function useDocumentTitleEffect() {
  useEffect(() => {
    document.title = 'UmpleOnline v2 (experimental)'
  }, [])
}

export default function App() {
  useThemeEffect()
  useDocumentTitleEffect()
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster />
    </TooltipProvider>
  )
}
