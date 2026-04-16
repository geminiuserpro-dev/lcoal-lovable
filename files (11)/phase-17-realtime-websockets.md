# Phase 17 — Real-time: WebSockets & Build Log Streaming

## Real-time Data Flows

```
1. BUILD LOG STREAMING
   Daytona (npm run dev stdout)
     -> StreamLogs async generator in backend
       -> Fastify WebSocket handler
         -> WS connection to frontend
           -> BuildLogPanel component

2. FILE CHANGE EVENTS
   LLM tool call: write_file
     -> Backend emits SSE chunk (via streamText)
       -> useChat onToolCall fires
         -> Monaco editor updates in real-time

3. SANDBOX STATUS UPDATES
   Backend polls Daytona workspace status
     -> Supabase Realtime (postgres_changes)
       -> Frontend status indicator updates

4. COLLABORATIVE EDITS (future)
   Supabase Realtime -> broadcast channel
     -> Cursor positions, file changes shared
```

---

## Fastify WebSocket for Build Logs

```typescript
// apps/api/src/routes/sandbox.ts
app.get('/:id/logs', { websocket: true }, async (connection, req) => {
  const { id } = req.params as { id: string }

  console.log(`WS connected for workspace ${id} logs`)

  try {
    for await (const chunk of streamLogs(id)) {
      if (connection.socket.readyState !== 1) break  // OPEN

      connection.socket.send(JSON.stringify({
        type: 'log',
        data: chunk,
        timestamp: Date.now(),
      }))
    }
  } catch (err: any) {
    connection.socket.send(JSON.stringify({ type: 'error', message: err.message }))
  } finally {
    connection.socket.close()
  }
})
```

---

## Frontend Build Log Hook

```typescript
// apps/web/hooks/useBuildLogs.ts
'use client'

import { useEffect, useRef, useState } from 'react'

interface LogEntry {
  type: 'log' | 'error'
  data: string
  timestamp: number
}

export function useBuildLogs(sandboxId: string | undefined) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sandboxId) return

    const ws = new WebSocket(
      `${process.env.NEXT_PUBLIC_WS_URL}/api/sandbox/${sandboxId}/logs`
    )
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as LogEntry
      setLogs(prev => [...prev.slice(-500), msg])  // Keep last 500 lines
    }

    return () => ws.close()
  }, [sandboxId])

  const clearLogs = () => setLogs([])

  return { logs, connected, clearLogs }
}
```

---

## Build Log UI Component

```tsx
// components/preview/BuildLogs.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useBuildLogs } from '@/hooks/useBuildLogs'
import { cn } from '@/lib/utils'

export function BuildLogs({ sandboxId }: { sandboxId?: string }) {
  const { logs, connected } = useBuildLogs(sandboxId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800">
        <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
        <span className="text-gray-400">Dev Server Logs</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {logs.map((log, i) => (
          <div key={i} className={cn(
            'font-mono leading-relaxed whitespace-pre-wrap break-all',
            log.type === 'error' ? 'text-red-400' : 'text-green-400'
          )}>
            {log.data}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

---

## SSE Streaming (LLM Responses)

```typescript
// The Vercel AI SDK's streamText() returns a DataStreamResponse
// which uses Server-Sent Events automatically

// Backend: just return result.toDataStreamResponse()
const result = streamText({ ... })
return result.toDataStreamResponse()

// Frontend: useChat() handles SSE parsing automatically
const { messages, isLoading } = useChat({ api: '/api/chat' })
```

---

## Supabase Realtime (Sandbox Status)

```typescript
// apps/web/hooks/useSandboxStatus.ts
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'

export function useSandboxStatus(projectId: string) {
  const [status, setStatus] = useState<string>('unknown')

  useEffect(() => {
    // Subscribe to project row changes
    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          setStatus(payload.new.status as string)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  return status
}
```

---

## WebSocket Reconnection Logic

```typescript
// apps/web/hooks/useReconnectingWS.ts
export function useReconnectingWS(url: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryCount = useRef(0)

  function connect() {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onclose = () => {
      if (retryCount.current < 5) {
        const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
        retryCount.current++
        setTimeout(connect, delay)
      }
    }

    ws.onopen = () => { retryCount.current = 0 }
  }

  useEffect(() => { connect(); return () => wsRef.current?.close() }, [url])
  return wsRef
}
```
