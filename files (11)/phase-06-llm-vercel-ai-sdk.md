# Phase 06 — LLM Integration via Vercel AI SDK

## Why Vercel AI SDK?

The Vercel AI SDK (`ai` package) provides:
- **Unified interface** across OpenAI, Anthropic, Google, Mistral, and more
- **Native streaming** with React hooks (`useChat`, `useCompletion`)
- **Tool use / function calling** with automatic schema generation from Zod
- **`streamText`** for server-sent events with partial delta streaming
- **`generateObject`** for structured JSON output

This means swapping from Claude to GPT-4o is a one-line change.

---

## Provider Setup

```typescript
// packages/ai/providers.ts

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export type ModelProvider = "openai" | "anthropic" | "google";

export function getModel(provider: ModelProvider, modelId?: string) {
  switch (provider) {
    case "openai":
      return openai(modelId ?? "gpt-4o");
    case "anthropic":
      return anthropic(modelId ?? "claude-sonnet-4-5");
    case "google":
      return google(modelId ?? "gemini-2.5-flash");
  }
}
```

---

## AI Tools Definition

The LLM is given tools to interact with the sandbox:

```typescript
// packages/ai/tools/index.ts

import { tool } from "ai";
import { z } from "zod";
import { DaytonaClient } from "@/sandbox/daytona";

export function createSandboxTools(workspaceId: string, daytona: DaytonaClient) {
  
  return {

    writeFile: tool({
      description: "Write or overwrite a file in the project",
      parameters: z.object({
        path: z.string().describe("File path relative to project root, e.g. src/components/Button.tsx"),
        content: z.string().describe("Full file content to write"),
      }),
      execute: async ({ path, content }) => {
        await daytona.writeFile(workspaceId, path, content);
        return { success: true, path };
      },
    }),

    readFile: tool({
      description: "Read the contents of a file",
      parameters: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => {
        const content = await daytona.readFile(workspaceId, path);
        return { path, content };
      },
    }),

    listFiles: tool({
      description: "List files in a directory",
      parameters: z.object({
        path: z.string().default("src"),
      }),
      execute: async ({ path }) => {
        const files = await daytona.listFiles(workspaceId, path);
        return { files };
      },
    }),

    deleteFile: tool({
      description: "Delete a file from the project",
      parameters: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => {
        await daytona.deleteFile(workspaceId, path);
        return { success: true, path };
      },
    }),

    searchDocs: tool({
      description: "Search the framework documentation (React, Vite, Tailwind, shadcn) for accurate API references",
      parameters: z.object({
        query: z.string().describe("What to search for"),
        framework: z.enum(["react", "vite", "tailwind", "shadcn", "typescript"]).optional(),
      }),
      execute: async ({ query, framework }) => {
        const results = await ragSearch(query, framework);
        return { results };
      },
    }),

    runCommand: tool({
      description: "Run a shell command in the project (e.g. install a new npm package)",
      parameters: z.object({
        command: z.string().describe("Shell command to run, e.g. 'npm install framer-motion'"),
      }),
      execute: async ({ command }) => {
        const output = await daytona.exec(workspaceId, command.split(" "));
        return { output };
      },
    }),

  };
}
```

---

## Chat Endpoint (Next.js API Route)

```typescript
// apps/web/app/api/chat/route.ts

import { streamText } from "ai";
import { getModel } from "@/packages/ai/providers";
import { createSandboxTools } from "@/packages/ai/tools";
import { getSystemPrompt } from "@/packages/ai/prompts/system";
import { DaytonaClient } from "@/packages/sandbox/daytona";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const { messages, projectId, provider = "anthropic" } = await req.json();
  
  const session = await auth();
  if (!session) return new Response("Unauthorized", { status: 401 });
  
  // Get project workspace
  const project = await db.projects.findById(projectId);
  const daytona = new DaytonaClient();
  
  const tools = createSandboxTools(project.workspaceId, daytona);
  
  const result = streamText({
    model: getModel(provider),
    system: getSystemPrompt(project),
    messages,
    tools,
    maxSteps: 20,           // Allow multi-step tool use
    onFinish: async ({ usage, finishReason }) => {
      // Save message to DB, update token usage
      await db.messages.create({
        projectId,
        role: "assistant",
        content: result.text,
        tokens: usage.totalTokens,
      });
    },
  });
  
  return result.toDataStreamResponse();
}
```

---

## Streaming to the Client

```typescript
// apps/web/app/projects/[id]/page.tsx  (simplified)
"use client";

import { useChat } from "ai/react";

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
    body: { projectId: params.id, provider: "anthropic" },
    onToolCall: ({ toolCall }) => {
      // Real-time tool call notifications (file writes, etc.)
      showToast(`AI is writing ${toolCall.args.path ?? "files"}...`);
    },
  });
  
  return (
    <ChatPanel
      messages={messages}
      input={input}
      onInputChange={handleInputChange}
      onSubmit={handleSubmit}
      isLoading={isLoading}
    />
  );
}
```

---

## Model Selection UI

Users can switch models mid-conversation:

```typescript
const MODEL_OPTIONS = [
  { provider: "anthropic", model: "claude-sonnet-4-5", label: "Claude Sonnet (Recommended)" },
  { provider: "openai",    model: "gpt-4o",            label: "GPT-4o" },
  { provider: "google",    model: "gemini-2.5-flash",  label: "Gemini 2.5 Flash" },
  { provider: "anthropic", model: "claude-opus-4-5",   label: "Claude Opus (Powerful)" },
  { provider: "openai",    model: "gpt-4o-mini",       label: "GPT-4o Mini (Fast)" },
];
```

---

## Token Budget Management

```typescript
// Estimated token costs per action
const COST_ESTIMATES = {
  simpleEdit:     1_500,   // Change a color, fix a typo
  componentBuild: 8_000,   // Build a new React component
  featureAdd:    20_000,   // Add auth, routing, complex feature
  fullApp:       60_000,   // Build from scratch
};

// Warn user if prompt will be expensive
async function estimateCost(messages: Message[], tools: Tool[]) {
  const inputTokens = countTokens(messages);
  const maxOutputTokens = 4096;
  return { inputTokens, maxOutputTokens, totalEstimate: inputTokens + maxOutputTokens };
}
```
