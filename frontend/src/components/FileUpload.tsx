import { useCallback, useRef, useState } from 'react'
import { uploadFiles } from '../api/ragApi'

interface Props {
  onUploaded: (summary: string) => void
  onError: (message: string) => void
}

export function FileUpload({ onUploaded, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

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
      setUploading(true)
      try {
        const res = await uploadFiles(files)
        onUploaded(
          `Indexed ${res.indexed_chunks} chunks from ${res.files.length} file(s). Total in store: ${res.total_chunks_in_store}.`,
        )
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [onError, onUploaded],
  )

  return (
    <div
      className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        dragOver
          ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
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
  )
}
