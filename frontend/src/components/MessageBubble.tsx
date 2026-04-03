import type { QueryMode, RetrievedChunk } from '../api/ragApi'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  mode?: QueryMode
  retrieved?: RetrievedChunk[]
  error?: boolean
  /** True while tokens are streaming in (ChatGPT-style). */
  streaming?: boolean
}

interface Props {
  message: ChatMessage
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-indigo-600 text-white'
            : message.error
              ? 'border border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100'
              : 'border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'
        }`}
      >
        {!isUser && message.mode && !message.error && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Mode: {message.mode}
          </p>
        )}
        <div className="whitespace-pre-wrap break-words">
          {message.streaming && !message.text && !message.error && (
            <span className="text-zinc-400 dark:text-zinc-500">Thinking…</span>
          )}
          {message.text}
          {message.streaming && message.text && !message.error && (
            <span
              className="ml-0.5 inline-block h-[1.1em] w-0.5 animate-pulse bg-indigo-500 align-text-bottom dark:bg-indigo-400"
              aria-hidden
            />
          )}
        </div>
        {!isUser && message.retrieved && message.retrieved.length > 0 && (
          <details className="mt-3 border-t border-zinc-200/80 pt-2 dark:border-zinc-600">
            <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
              Retrieved context ({message.retrieved.length} chunks)
            </summary>
            <ul className="mt-2 space-y-2 text-left text-xs text-zinc-600 dark:text-zinc-300">
              {message.retrieved.map((c, i) => (
                <li
                  key={`${c.source_file}-${c.chunk_index}-${i}`}
                  className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/80"
                >
                  <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                    {c.source_file} · chunk {c.chunk_index} · score {c.score.toFixed(3)}
                  </span>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
                    {c.excerpt}
                  </pre>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
