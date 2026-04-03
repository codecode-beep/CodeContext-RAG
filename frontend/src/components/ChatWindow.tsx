import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryMode } from '../api/ragApi'
import { queryRagStream } from '../api/ragApi'
import { MessageBubble, type ChatMessage } from './MessageBubble'

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface Props {
  onSystemMessage: (text: string) => void
}

export function ChatWindow({ onSystemMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<QueryMode>('qa')
  const [topK, setTopK] = useState(5)
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming, scrollToBottom])

  const send = useCallback(async () => {
    const q = input.trim()
    if (!q || isStreaming) return

    const userMsg: ChatMessage = { id: newId(), role: 'user', text: q }
    const assistantId = newId()
    setMessages((m) => [
      ...m,
      userMsg,
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        mode,
        streaming: true,
      },
    ])
    setInput('')
    setIsStreaming(true)

    try {
      await queryRagStream(
        q,
        mode,
        topK,
        (meta) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, mode: meta.mode, retrieved: meta.retrieved }
                : msg,
            ),
          )
        },
        (delta) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId ? { ...msg, text: msg.text + delta } : msg,
            ),
          )
        },
      )
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId ? { ...msg, streaming: false } : msg,
        ),
      )
      onSystemMessage('Response ready.')
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Query failed'
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                streaming: false,
                error: true,
                text: err,
              }
            : msg,
        ),
      )
      onSystemMessage('Query failed.')
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, mode, topK, onSystemMessage])

  return (
    <div className="flex h-full min-h-[22rem] flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as QueryMode)}
          disabled={isStreaming}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="qa">General Q&amp;A</option>
          <option value="explain">Explain code</option>
          <option value="debug">Debug / review</option>
        </select>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">Top K</label>
        <input
          type="number"
          min={1}
          max={20}
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          disabled={isStreaming}
          className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          Streaming on
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Upload files, then ask questions about your code or documents.
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Ask about your uploaded files…"
            rows={2}
            disabled={isStreaming}
            className="min-h-[3rem] flex-1 resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500/0 transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <button
            type="button"
            disabled={isStreaming || !input.trim()}
            onClick={() => void send()}
            className="self-end rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500 disabled:opacity-50"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
