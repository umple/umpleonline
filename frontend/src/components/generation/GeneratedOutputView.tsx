/**
 * Right-hand pane when the generate target is source code.
 * One tab per generated file, plus copy and download. The message pane still holds compiler warnings.
 */

import { useCallback, useState } from 'react'
import type { GeneratedArtifact, GeneratedCodeFile } from '../../api/types'
import { CodeOutput } from './CodeOutput'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface GeneratedOutputViewProps {
  kind: 'text' | 'html' | 'iframe'
  code: string
  html: string
  iframeUrl: string | null
  language: string
  downloads: GeneratedArtifact[]
  files: GeneratedCodeFile[]
}

function DownloadButtons({ downloads }: { downloads: GeneratedArtifact[] }) {
  if (downloads.length === 0) return null

  return (
    <>
      {downloads.map((download) => (
        <a
          key={`${download.url}-${download.label}`}
          href={download.url}
          download={download.filename}
          className="inline-flex items-center rounded-md border border-border bg-surface-0 px-2.5 py-1 text-xs text-ink-muted hover:text-ink hover:border-border-strong transition-colors"
        >
          {download.label}
        </a>
      ))}
    </>
  )
}

const generatedTabTriggerClassName = cn(
  '!flex-none h-7 shrink-0 rounded-none border-b border-b-transparent px-2.5 py-0 text-xs text-ink-muted',
  'data-[state=active]:bg-surface-0 data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_-2px_0_0_var(--color-brand)]',
  'hover:text-ink',
)

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition-colors',
        copied
          ? 'bg-surface-1 text-status-success border-status-success'
          : 'bg-surface-0 text-ink-muted border-border hover:bg-surface-1 hover:border-border-strong',
        className,
      )}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function SearchableCodeBlock({
  code,
  label,
  language,
  downloads,
  testId,
}: {
  code: string
  label?: string
  language: string
  downloads: GeneratedArtifact[]
  testId?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border bg-surface-0/95 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0 text-xs text-ink-muted">
          {label ? <span className="truncate">{label}</span> : <span>All generated code</span>}
        </div>
        <div className="flex items-center gap-2">
          <DownloadButtons downloads={downloads} />
          <CopyButton text={code} />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <CodeOutput code={code} language={language} testId="generated-output-highlighted-all-code" />
        <pre
          className="pointer-events-none absolute inset-0 overflow-hidden opacity-0"
          data-testid={testId}
          aria-hidden="true"
        >
          {code}
        </pre>
      </div>
    </div>
  )
}

export function GeneratedOutputView({
  kind,
  code,
  html,
  iframeUrl,
  language,
  downloads,
  files,
}: GeneratedOutputViewProps) {
  if (kind === 'iframe' && iframeUrl) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-1/60 shrink-0">
          <DownloadButtons downloads={downloads} />
        </div>
        <iframe
          src={iframeUrl}
          title="Generated output"
          sandbox="allow-scripts"
          className="flex-1 w-full border-0 bg-surface-0"
        />
      </div>
    )
  }

  if (kind === 'html') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-1/60 shrink-0">
          <DownloadButtons downloads={downloads} />
        </div>
        <iframe
          srcDoc={html}
          title="Generated HTML output"
          sandbox="" /* all restrictions enabled */
          className="flex-1 w-full border-0 bg-surface-0"
        />
      </div>
    )
  }

  const hasSplitFiles = files.length > 1

  return (
    <div className="h-full flex flex-col">
      {hasSplitFiles ? (
        <Tabs defaultValue="all-code" className="flex-1 min-h-0 gap-0">
          <div className="shrink-0 overflow-x-auto border-b border-border bg-surface-1/60 px-3 py-1">
            <TabsList variant="line" className="h-7 min-w-full justify-start gap-1 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="all-code"
                className={generatedTabTriggerClassName}
                data-testid="generated-output-tab-all-code"
              >
                All code
              </TabsTrigger>
              {files.map((file) => (
                <TabsTrigger
                  key={file.path}
                  value={file.path}
                  className={cn(generatedTabTriggerClassName, 'max-w-[16rem] truncate')}
                  title={file.path}
                  data-testid={`generated-output-tab-${file.name}`}
                >
                  {file.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="all-code" className="flex-1 min-h-0 mt-0 outline-none">
            <SearchableCodeBlock
              code={code}
              language={language}
              downloads={downloads}
              testId="generated-output-all-code"
            />
          </TabsContent>

          {files.map((file) => (
            <TabsContent key={file.path} value={file.path} className="flex-1 min-h-0 mt-0 outline-none">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-0 px-3 py-2">
                  <div className="min-w-0 truncate text-xs text-ink-muted">{file.path}</div>
                  <div className="flex items-center gap-2">
                    <DownloadButtons downloads={downloads} />
                    <CopyButton text={file.content} />
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <CodeOutput code={file.content} language={language} />
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <SearchableCodeBlock
          code={code}
          language={language}
          downloads={downloads}
          testId="generated-output-all-code"
        />
      )}
    </div>
  )
}
