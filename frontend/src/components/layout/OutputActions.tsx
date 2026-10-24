import { Code, LayoutGrid, Workflow, Play, Loader2, ChevronDown } from 'lucide-react'
import { useGenerate } from '@/hooks/useGenerate'
import { useExecute } from '@/hooks/useExecute'
import { useSessionStore } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { getGenerateTarget } from '@/generation/targets'
import { Tip } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const actionButton = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-surface-0 px-2.5 text-xs font-medium text-ink-muted shadow-sm transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-70'

/** Common actions stay visible independently of the searchable output picker. */
export function OutputActions() {
  const generate = useGenerate()
  const { execute } = useExecute()
  const generateTargetId = useSessionStore((s) => s.generateTargetId)
  const generatingOutput = useEphemeralStore((s) => s.generatingOutput)
  const generatingCode = useEphemeralStore((s) => s.generatingCode)
  const executing = useEphemeralStore((s) => s.executing)
  const executionLanguage = getGenerateTarget(generateTargetId)?.executable ? generateTargetId : 'Java'

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 bg-surface-1 px-3 py-1.5" data-testid="common-actions">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Common outputs">
        {[
          { id: 'Java', label: 'Generate Java', Icon: Code },
          { id: 'classDiagram', label: 'Show class diagram', Icon: LayoutGrid },
          { id: 'stateDiagram', label: 'Show state diagram', Icon: Workflow },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => void generate(id)}
            disabled={generatingOutput || generatingCode || executing}
            aria-label={label}
            aria-pressed={generateTargetId === id}
            data-testid={`quick-output-${id}`}
            className={cn(actionButton, generateTargetId === id && 'text-brand')}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      <div className="ml-2 inline-flex shrink-0 items-center gap-0.5">
        <Tip content={`Generate and execute ${executionLanguage}`} side="bottom">
          <button
            type="button"
            onClick={() => void execute()}
            disabled={executing}
            aria-label={executing ? 'Executing' : `Execute ${executionLanguage}`}
            data-testid="execute-button"
            className={actionButton}
          >
            {executing ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Play className="size-3.5 shrink-0" />}
            {executing ? 'Executing...' : 'Execute'}
          </button>
        </Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Execution language" disabled={executing} className={cn(actionButton, 'w-8 justify-center px-0')}>
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void execute('Java')}>Execute Java</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void execute('Python')}>Execute Python</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
