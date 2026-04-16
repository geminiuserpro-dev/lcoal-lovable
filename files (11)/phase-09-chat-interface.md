# Phase 09 — Chat Interface & Streaming UI

## Architecture

The chat panel streams LLM output using Vercel AI SDK's `useChat` hook and Server-Sent Events.

```
User types prompt
  -> ChatInput.tsx onSubmit
    -> useChat append()
      -> POST /api/chat (streaming SSE response)
        -> LLM tool calls write files in sandbox
        -> Chunks stream back to client
          -> MessageBubble renders incrementally
            -> File tree refreshes on finish
```

---

## ChatPanel Component

```tsx
// components/chat/ChatPanel.tsx
'use client'

import { useChat } from 'ai/react'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { useProjectStore } from '@/store/project.store'
import { toast } from 'sonner'

export function ChatPanel({ projectId }: { projectId: string }) {
  const { setFile } = useProjectStore()
  const { project } = useProjectStore(s => ({ project: s.project }))

  const { messages, input, handleInputChange, handleSubmit, isLoading, setInput } = useChat({
    api: '/api/chat',
    id: projectId,
    body: {
      projectId,
      sandboxId: project?.sandboxId,
      provider: 'anthropic',
    },
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === 'write_file') {
        const { path, content } = toolCall.args as { path: string; content: string }
        setFile(path, content)  // Optimistic update in editor
        toast.info(`Writing ${path}...`, { duration: 2000 })
      }
    },
    onError: (err) => {
      toast.error('AI error: ' + err.message)
    },
  })

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-medium text-foreground">Chat</h2>
      </div>

      <MessageList messages={messages} isLoading={isLoading} />

      <ChatInput
        value={input}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  )
}
```

---

## MessageList Component

```tsx
// components/chat/MessageList.tsx
import { useEffect, useRef } from 'react'
import { type Message } from 'ai'
import { MessageBubble } from './MessageBubble'

export function MessageList({ messages, isLoading }: { messages: Message[]; isLoading: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="text-center text-muted-foreground text-sm pt-8">
          <p className="text-lg mb-2">What do you want to build?</p>
          <p>Describe your app and I'll create it for you.</p>
        </div>
      )}

      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {isLoading && (
        <div className="flex gap-1 p-3">
          <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

---

## MessageBubble (with Markdown + Tool Calls)

```tsx
// components/chat/MessageBubble.tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { type Message } from 'ai'
import { cn } from '@/lib/utils'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser && 'justify-end')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold shrink-0">
          AI
        </div>
      )}

      <div className={cn(
        'max-w-[85%] rounded-xl px-4 py-2.5 text-sm',
        isUser
          ? 'bg-primary text-primary-foreground ml-auto'
          : 'bg-secondary text-secondary-foreground'
      )}>
        {message.parts?.map((part, i) => {
          if (part.type === 'text') {
            return (
              <ReactMarkdown
                key={i}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                className="prose prose-sm dark:prose-invert max-w-none"
              >
                {part.text}
              </ReactMarkdown>
            )
          }
          if (part.type === 'tool-invocation') {
            return (
              <div key={i} className="mt-2 text-xs bg-muted rounded px-2 py-1 font-mono text-muted-foreground">
                {part.toolInvocation.toolName}({JSON.stringify(part.toolInvocation.args).slice(0, 60)}...)
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
```

---

## ChatInput Component

```tsx
// components/chat/ChatInput.tsx
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { SendHorizonal, StopCircle } from 'lucide-react'
import { type FormEvent, KeyboardEvent } from 'react'

interface Props {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
  isLoading: boolean
}

export function ChatInput({ value, onChange, onSubmit, isLoading }: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit(e as unknown as FormEvent)
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-3 border-t border-border">
      <div className="relative">
        <Textarea
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to build..."
          className="pr-10 resize-none min-h-[60px] max-h-[200px] font-sans text-sm"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          className="absolute bottom-2 right-2 h-7 w-7"
          disabled={isLoading || !value.trim()}
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">Enter to send, Shift+Enter for newline</p>
    </form>
  )
}
```

---

## API Route (app/api/chat/route.ts)

```typescript
import { streamText } from 'ai'
import { getModel } from '@app/llm-router'
import { createTools } from '@app/llm-router/tools'
import { getSandbox } from '@app/sandbox-client'
import { buildSystemMessage, buildContext } from '@/services/context-builder'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const maxDuration = 60  // 60s streaming timeout

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages, projectId, sandboxId, provider = 'anthropic' } = await req.json()

  const sandbox = getSandbox('daytona', sandboxId)
  const ctx = await buildContext(projectId, messages.at(-1)?.content ?? '', sandboxId)
  const systemMessage = buildSystemMessage(ctx)

  const result = streamText({
    model: getModel(provider),
    system: systemMessage,
    messages,
    tools: createTools(sandboxId, sandbox),
    maxSteps: 20,
    temperature: 0.1,
    maxTokens: 16000,
  })

  return result.toDataStreamResponse()
}
```
