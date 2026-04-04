import { useCallback, useRef, useState } from 'react'
import { uploadFiles } from '../api/ragApi'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileKind(name: string): 'py' | 'txt' {
  return name.toLowerCase().endsWith('.py') ? 'py' : 'txt'
}

function FileTypeBadge({ kind }: { kind: 'py' | 'txt' }) {
  if (kind === 'py') {
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3776AB] to-[#306998] text-[11px] font-bold tracking-tight text-white shadow-inner"
        aria-hidden
      >
        .py
      </div>
    )
  }
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-500 to-zinc-600 text-[10px] font-bold tracking-tight text-white shadow-inner"
      aria-hidden
    >
      TXT
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
      aria-hidden
    />
  )
}

interface AttachmentCardProps {
  name: string
  subtitle: string
  kind: 'py' | 'txt'
  variant: 'pending' | 'indexed'
}

function AttachmentCard({ name, subtitle, kind, variant }: AttachmentCardProps) {
  const indexed = variant === 'indexed'
  return (
    <div
      className={`flex max-w-[min(100%,280px)] min-w-[200px] flex-1 basis-[200px] items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm transition-shadow ${
        indexed
          ? 'border-emerald-200/90 bg-white dark:border-emerald-800/60 dark:bg-zinc-800/90'
          : 'border-zinc-200/90 bg-white dark:border-zinc-600 dark:bg-zinc-800/90'
      }`}
    >
      <FileTypeBadge kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" title={name}>
          {name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>
      {indexed ? (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400"
          title="Indexed"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  )
}

interface Props {
  onUploaded: (summary: string) => void
  onError: (message: string) => void
}

export function FileUpload({ onUploaded, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<{ name: string; size: string }[]>([])
  const [indexedDocs, setIndexedDocs] = useState<string[]>([])

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return
      const files = Array.from(fileList).filter(
        (f) => f.name.endsWith('.txt') || f.name.endsWith('.py'),
      )
      if (!files.length) {
        onError('Please choose .txt or .py files.')
        return
      }
      setSelected(files.map((f) => ({ name: f.name, size: formatBytes(f.size) })))
      setUploading(true)
      try {
        const res = await uploadFiles(files)
        setIndexedDocs((prev) => {
          const next = [...prev]
          for (const name of res.files) {
            if (!next.includes(name)) next.push(name)
          }
          return next
        })
        setSelected([])
        onUploaded(
          `Indexed ${res.indexed_chunks} chunks from ${res.files.length} file(s). Total in store: ${res.total_chunks_in_store}.`,
        )
      } catch (e) {
        setSelected([])
        onError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [onError, onUploaded],
  )

  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl border-2 border-dashed transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50/50 dark:border-indigo-400 dark:bg-indigo-950/30'
            : 'border-zinc-300 bg-zinc-50/80 dark:border-zinc-600 dark:bg-zinc-900/50'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
      >
        <div className="px-6 py-8 text-center">
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.py"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Drop <span className="font-medium">.txt</span> or{' '}
            <span className="font-medium">.py</span> files here, or
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="mt-3 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-500 disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : 'Choose files'}
          </button>
        </div>

        {selected.length > 0 && (
          <div
            className="border-t border-zinc-200/80 bg-zinc-100/50 px-4 py-3 dark:border-zinc-600/80 dark:bg-zinc-900/40"
            role="status"
            aria-live="polite"
          >
            <p className="mb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {uploading ? 'Uploading files' : 'Selected'}
            </p>
            <div className="flex flex-wrap gap-2">
              {selected.map((f) => (
                <AttachmentCard
                  key={f.name}
                  name={f.name}
                  subtitle={`${fileKind(f.name) === 'py' ? 'Python' : 'Text'} · ${f.size}`}
                  kind={fileKind(f.name)}
                  variant="pending"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {indexedDocs.length > 0 && (
        <div>
          <p className="mb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            In your knowledge base
          </p>
          <div className="flex flex-wrap gap-2">
            {indexedDocs.map((name) => (
              <AttachmentCard
                key={name}
                name={name}
                subtitle={fileKind(name) === 'py' ? 'Python · Indexed' : 'Text · Indexed'}
                kind={fileKind(name)}
                variant="indexed"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
