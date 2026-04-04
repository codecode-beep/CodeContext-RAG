import { useCallback, useEffect, useState } from 'react'
import { healthCheck, resetIndex } from './api/ragApi'
import { ChatWindow } from './components/ChatWindow'
import { FileUpload } from './components/FileUpload'

function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [chatSessionId, setChatSessionId] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const h = await healthCheck()
        if (!cancelled) {
          setStatus('ok')
          setGeminiConfigured(h.gemini_configured ?? false)
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onUploaded = useCallback((summary: string) => {
    setBanner(summary)
  }, [])

  const onUploadError = useCallback((message: string) => {
    setBanner(`Upload error: ${message}`)
  }, [])

  const onSystemMessage = useCallback((text: string) => {
    setBanner(text)
  }, [])

  const handleNewChat = useCallback(async () => {
    try {
      await resetIndex()
      setChatSessionId((n) => n + 1)
      setBanner('New chat — upload documents to index them for this conversation.')
    } catch (e) {
      setBanner(
        e instanceof Error ? `Could not start new chat: ${e.message}` : 'Could not reset the index.',
      )
    }
  }, [])

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white/90 px-6 py-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Mini RAG Developer Assistant
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Upload code or text, then ask questions with retrieval-augmented answers.
            </p>
          </div>
          <div className="text-sm">
            {status === 'checking' && (
              <span className="text-zinc-500">Checking API…</span>
            )}
            {status === 'ok' && geminiConfigured === true && (
              <span className="text-emerald-600 dark:text-emerald-400">API ready (Gemini configured)</span>
            )}
            {status === 'ok' && geminiConfigured === false && (
              <span
                className="max-w-md text-amber-700 dark:text-amber-400"
                title="Create backend/.env with GOOGLE_API_KEY from Google AI Studio"
              >
                Backend up — set GOOGLE_API_KEY in backend/.env (uploads return 503 until then)
              </span>
            )}
            {status === 'error' && (
              <span className="text-red-600 dark:text-red-400" title="Start backend: uvicorn app.main:app --reload">
                API unreachable (is the backend running?)
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {banner && (
          <div
            className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            role="status"
          >
            {banner}
          </div>
        )}

        <section aria-label="Upload">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Documents
          </h2>
          <FileUpload key={chatSessionId} onUploaded={onUploaded} onError={onUploadError} />
        </section>

        <section aria-label="Chat">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Chat
          </h2>
          <ChatWindow
            key={chatSessionId}
            onSystemMessage={onSystemMessage}
            onNewChat={handleNewChat}
          />
        </section>
      </main>
    </div>
  )
}

export default App
