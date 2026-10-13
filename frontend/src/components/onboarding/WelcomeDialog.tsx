/**
 * Dialog shown on the first visit, before the spotlight tour.
 * Dismissing it is what lets OnboardingTour start.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { ArrowRight, Route } from 'lucide-react'

export function WelcomeDialog() {
  const hasSeenWelcome = usePreferencesStore((s) => s.hasSeenWelcome)
  const dismissWelcome = usePreferencesStore((s) => s.dismissWelcome)
  const startTour = useEphemeralStore((s) => s.startTour)

  if (hasSeenWelcome) return null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismissWelcome() }}>
      <DialogContent
        className="sm:max-w-[440px] gap-0 border-0 p-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Header band */}
        <div className="bg-brand px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <div className="flex items-center gap-3">
              <img
                src="/umple-logo.svg"
                alt=""
                className="h-7 w-auto brightness-0 invert"
              />
              <DialogTitle className="text-ink-inverse text-xl tracking-tight">
                Welcome to UmpleOnline
              </DialogTitle>
            </div>
            <DialogDescription className="text-ink-inverse/80 text-[13px] leading-relaxed">
              Write Umple models, see diagrams update live, and generate code
              in Java, Python, C++, and more.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Tour prompt */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3.5 rounded-lg border border-border p-4">
            <div className="flex items-center justify-center size-10 rounded-lg bg-brand/8 text-brand shrink-0 mt-0.5">
              <Route className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">Take a quick tour</div>
              <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                We'll walk you through building a state machine, viewing its
                diagram, and generating Python code — about 60 seconds.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={dismissWelcome}
            className="text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer"
          >
            Skip, I'll explore on my own
          </button>
          <Button onClick={startTour} size="sm">
            Start tour
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
