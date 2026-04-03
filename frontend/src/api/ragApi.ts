/**
 * HTTP client for the FastAPI RAG backend.
 * In dev, calls go to `/api/*` and Vite proxies to `http://127.0.0.1:8000/*`.
 * Set `VITE_API_URL` (e.g. http://localhost:8000) to call the API directly.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined

function url(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (API_URL) {
    return `${API_URL.replace(/\/$/, '')}${p}`
  }
  return `/api${p}`
}

export type QueryMode = 'explain' | 'debug' | 'qa'

export interface RetrievedChunk {
  source_file: string
  chunk_index: number
  score: number
  excerpt: string
}

export interface QueryResponse {
  answer: string
  mode: QueryMode
  retrieved: RetrievedChunk[]
}

export interface UploadResponse {
  indexed_chunks: number
  files: string[]
  total_chunks_in_store: number
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail)) {
      return data.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
    }
    return JSON.stringify(data)
  } catch {
    return res.statusText || 'Request failed'
  }
}

export interface HealthResponse {
  status: string
  gemini_configured?: boolean
}

export async function healthCheck(): Promise<HealthResponse> {
  const res = await fetch(url('/health'))
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData()
  for (const f of files) {
    form.append('files', f)
  }
  const res = await fetch(url('/upload'), {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function queryRag(
  query: string,
  mode: QueryMode,
  topK: number,
): Promise<QueryResponse> {
  const res = await fetch(url('/query'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode, top_k: topK }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

type NdjsonRow =
  | { type: 'meta'; mode: QueryMode; retrieved: RetrievedChunk[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: number; detail: string }

/**
 * Streams NDJSON from POST /query/stream: meta → deltas → done (or error row).
 */
export async function queryRagStream(
  query: string,
  mode: QueryMode,
  topK: number,
  onMeta: (payload: { mode: QueryMode; retrieved: RetrievedChunk[] }) => void,
  onDelta: (text: string) => void,
): Promise<void> {
  const res = await fetch(url('/query/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode, top_k: topK }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let row: NdjsonRow
      try {
        row = JSON.parse(line) as NdjsonRow
      } catch {
        continue
      }
      if (row.type === 'meta') {
        onMeta({ mode: row.mode, retrieved: row.retrieved })
      } else if (row.type === 'delta') {
        onDelta(row.text)
      } else if (row.type === 'done') {
        return
      } else if (row.type === 'error') {
        throw new Error(row.detail)
      }
    }
  }
}
