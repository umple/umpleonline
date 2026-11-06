import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import type { StatusSummary } from '@/api/types'

export function updateAge(value?: string): string {
  if (!value) return 'Update time unavailable'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Update time unavailable'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'Updated just now'
  if (seconds < 3600) return 'Updated ' + Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return 'Updated ' + Math.floor(seconds / 3600) + 'h ago'
  return 'Updated ' + Math.floor(seconds / 86400) + 'd ago'
}

export function StatusFooter() {
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    let controller: AbortController | undefined
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const next = await api.statusSummary(controller.signal)
        if (active) { setSummary(next); setUnavailable(false) }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setUnavailable(true)
        }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { active = false; controller?.abort(); window.clearInterval(timer) }
  }, [])

  return (
    <footer data-testid="status-footer" aria-label="UmpleOnline server statistics"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-xs text-ink-muted">
      {summary ? <>
        <span title="Editor page loads since visit tracking began in this deployment">
          {summary.visits?.toLocaleString() ?? 'Unavailable'} visits
        </span>
        <span title="Browser tab sessions since tracking began in this deployment">
          {summary.sessions?.toLocaleString() ?? 'Unavailable'} sessions
        </span>
        <span title="Compiler commands, including monitoring commands, since tracking began in this deployment">
          {summary.compiler.commandsHistorical?.toLocaleString() ?? 'Unavailable'} commands run
        </span>
        <span>Compiler {summary.compiler.version ?? 'unavailable'}</span>
        <span>Branch {summary.branch || 'unavailable'}</span>
        {summary.commit && summary.commit !== 'unknown' ? <span>{summary.commit.slice(0, 12)}</span> : null}
        <span title={summary.updatedAt}>{updateAge(summary.updatedAt)}</span>
      </> : <span>{unavailable ? 'Server statistics unavailable' : 'Loading server statistics?'}</span>}
      {summary && (unavailable || summary.status !== 'ok') ?
        <span className="text-status-warning">{unavailable ? 'Statistics may be out of date' : 'Some statistics unavailable'}</span> : null}
      <Link to="/status" className="ml-auto rounded underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
        Server status
      </Link>
    </footer>
  )
}
