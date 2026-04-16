# Phase 07 — AI Prompt Engineering & Code Generation Pipeline

## System Prompt Design

The system prompt is the most critical element. It defines the AI's role, constraints, output format, and tool usage rules.

---

## Full System Prompt

```
You are an expert React developer who creates and modifies web applications.
You help users by chatting with them and making precise code changes.

## INTERFACE CONTEXT
- Left panel: Chat (where users talk to you)
- Center panel: Monaco code editor showing project files
- Right panel: Live preview iframe of the running app (React + Vite + Tailwind + shadcn/ui)

## TECHNOLOGY STACK
Every project uses:
- React 18 with TypeScript
- Vite 5 as the build tool
- Tailwind CSS 3 for styling (use CSS variables from index.css — NEVER hardcode colors)
- shadcn/ui components (import from @/components/ui/*)
- React Router DOM 6 for routing
- TanStack React Query 5 for data fetching
- Framer Motion for animations
- Lucide React for icons
- Sonner for toast notifications

## RULES
1. ALWAYS write TypeScript, never plain JavaScript
2. ALWAYS use Tailwind for styling — never inline styles or separate CSS files (except index.css for CSS variables)
3. Use semantic Tailwind tokens from the design system (bg-background, text-foreground, etc.) — NOT hardcoded colors
4. Use shadcn/ui components whenever possible — import from @/components/ui/*
5. Create small, focused components — never build a single monolithic file
6. Every file MUST have correct TypeScript types — no 'any'
7. Make the app look beautiful — thoughtful spacing, good typography, smooth animations
8. SEO: add proper HTML title, meta description, and semantic HTML structure

## TOOL USE
You have access to these tools:
- write_file(path, content): Create or overwrite a file
- read_file(path): Read an existing file before modifying it
- delete_file(path): Delete a file
- list_files(dir): List files in a directory
- search_docs(query, framework): Search framework documentation for accurate APIs

## WORKFLOW
1. Understand the user's request
2. Call list_files to understand the current project structure
3. Call read_file on any file you plan to modify
4. Search docs if you need accurate API references
5. Make precise, minimal changes — don't rewrite what doesn't need changing
6. Write all necessary files using write_file
7. Give a brief explanation of what you changed

## DESIGN PRINCIPLES
- Beautiful > Functional: if it works but looks bad, fix the design
- Minimalist but not bare: use whitespace, clear hierarchy, subtle animations
- Consistent: use the design system tokens everywhere
- Accessible: proper ARIA labels, keyboard navigation, contrast ratios

## RESPONSE FORMAT
- Start with a brief plan (1-2 sentences)
- Make all tool calls
- End with a 1-2 sentence summary of what changed
- NEVER explain code line-by-line — be concise
```

---

## Context Injection Pipeline

```typescript
// apps/api/src/services/context-builder.ts

interface PromptContext {
  fileTree: string[]
  openFiles: { path: string; content: string }[]
  errorLogs: string[]
  ragChunks: string[]
  userMessage: string
}

export async function buildContext(
  projectId: string,
  userMessage: string,
  sandboxId: string,
): Promise<PromptContext> {
  // 1. Get current file tree
  const fileTree = await listFiles(sandboxId)

  // 2. RAG: find relevant docs
  const ragChunks = await searchDocs(userMessage, { limit: 5 })

  // 3. Get recent console errors (if any)
  const errorLogs = await getRecentErrors(projectId)

  return { fileTree, openFiles: [], errorLogs, ragChunks, userMessage }
}

export function buildSystemMessage(ctx: PromptContext): string {
  let system = BASE_SYSTEM_PROMPT

  system += `\n\n## CURRENT PROJECT FILES\n${ctx.fileTree.map(f => `- ${f}`).join('\n')}`

  if (ctx.ragChunks.length > 0) {
    system += `\n\n## RELEVANT DOCUMENTATION\n${ctx.ragChunks.join('\n\n---\n\n')}`
  }

  if (ctx.errorLogs.length > 0) {
    system += `\n\n## RECENT CONSOLE ERRORS\n\`\`\`\n${ctx.errorLogs.join('\n')}\n\`\`\``
  }

  return system
}
```

---

## Tool Definitions (Vercel AI SDK)

```typescript
// packages/llm-router/src/tools.ts
import { tool } from 'ai'
import { z } from 'zod'

export function createTools(sandboxId: string, sandbox: ISandbox) {
  return {
    write_file: tool({
      description: 'Create or overwrite a file in the project. Always read the file first before overwriting.',
      parameters: z.object({
        path: z.string().describe('File path relative to project root, e.g. src/components/Header.tsx'),
        content: z.string().describe('Complete file content to write'),
      }),
      execute: async ({ path, content }) => {
        await sandbox.writeFile(path, content)
        return { success: true, path, bytesWritten: content.length }
      },
    }),

    read_file: tool({
      description: 'Read the full contents of a file. Call this before modifying any existing file.',
      parameters: z.object({
        path: z.string().describe('File path to read'),
      }),
      execute: async ({ path }) => {
        const content = await sandbox.readFile(path)
        return { path, content }
      },
    }),

    delete_file: tool({
      description: 'Permanently delete a file from the project.',
      parameters: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => {
        await sandbox.deleteFile(path)
        return { success: true, path }
      },
    }),

    list_files: tool({
      description: 'List all files in the project or a subdirectory.',
      parameters: z.object({
        dir: z.string().default('src').describe('Directory to list, defaults to src/'),
      }),
      execute: async ({ dir }) => {
        const files = await sandbox.listFiles(dir)
        return { files, count: files.length }
      },
    }),

    search_docs: tool({
      description: 'Search framework documentation to get accurate API references.',
      parameters: z.object({
        query: z.string().describe('What to search for'),
        framework: z.enum(['react', 'vite', 'tailwind', 'shadcn', 'typescript', 'framer-motion'])
          .optional()
          .describe('Narrow search to a specific framework'),
      }),
      execute: async ({ query, framework }) => {
        const results = await searchEmbeddings(query, framework)
        return { results: results.map(r => r.content).join('\n\n---\n\n') }
      },
    }),
  }
}
```

---

## Multi-Step Tool Use (maxSteps)

The LLM often needs to: list files → read file → modify → write. We allow up to 20 steps per request:

```typescript
const result = streamText({
  model: getModel(provider),
  system: systemMessage,
  messages,
  tools: createTools(sandboxId, sandbox),
  maxSteps: 20,   // Allow multi-turn tool calls within one response
  temperature: 0.1,  // Low temperature for consistent code generation
  maxTokens: 16000,
})
```

---

## Response Streaming to Frontend

```typescript
// Tool call progress shown in UI
const { messages, append, isLoading } = useChat({
  api: '/api/chat',
  body: { projectId, sandboxId, provider: selectedModel },
  onToolCall: ({ toolCall }) => {
    // Show live indicator: "Writing src/components/Header.tsx..."
    setCurrentAction(`Writing ${toolCall.args?.path ?? 'files'}...`)
  },
  onFinish: () => {
    setCurrentAction(null)
    refreshFileTree()
  },
})
```

---

## Prompt Chaining for Large Features

For complex requests, break into phases:

```typescript
// Phase 1: Plan
const plan = await generateText({
  model: getModel('anthropic'),
  prompt: `The user wants: "${userRequest}". List the files you need to create or modify as a JSON array.`,
  maxTokens: 500,
})

// Phase 2: Execute each file
for (const file of JSON.parse(plan.text)) {
  await generateAndWriteFile(file, userRequest, sandbox)
}
```
