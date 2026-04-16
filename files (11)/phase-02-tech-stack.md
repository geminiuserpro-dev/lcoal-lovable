# Phase 02 — Tech Stack & Dependency Manifest

## Root Monorepo (Turborepo)

The project uses Turborepo to manage a monorepo with shared packages, caching, and parallel builds.

### package.json (root)

```json
{
  "name": "lovable-clone",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "type-check": "turbo type-check"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.5",
    "prettier": "^3.2.0"
  }
}
```

---

## apps/web — Next.js 14 Frontend

### Core Dependencies

| Package | Version | Purpose |
|---|---|---|
| next | 14.2.4 | App Router, RSC, streaming SSR |
| react | 18.3.1 | UI library |
| @supabase/supabase-js | 2.43.4 | Auth + DB client |
| @supabase/ssr | 0.3.0 | Server-side Supabase helpers |
| ai | 3.2.22 | Vercel AI SDK (streaming, hooks) |
| @ai-sdk/anthropic | 0.0.39 | Claude models |
| @ai-sdk/openai | 0.0.36 | GPT-4o |
| @ai-sdk/google | 0.0.22 | Gemini models |
| @monaco-editor/react | 4.6.0 | VSCode editor in browser |
| tailwindcss | 3.4.4 | Utility CSS |
| tailwind-merge | 2.3.0 | Safe class merging |
| class-variance-authority | 0.7.0 | Component variants |
| lucide-react | 0.395.0 | Icons |
| sonner | 1.5.0 | Toast notifications |
| react-markdown | 9.0.1 | Render LLM markdown output |
| framer-motion | 11.2.12 | Animations |
| zustand | 4.5.4 | Global state management |
| react-resizable-panels | 2.0.19 | Resizable 3-panel layout |
| date-fns | 3.6.0 | Date formatting |

### Radix UI Primitives (headless, accessible)

| Package | Purpose |
|---|---|
| @radix-ui/react-dialog | Modal dialogs |
| @radix-ui/react-dropdown-menu | Context menus |
| @radix-ui/react-scroll-area | Custom scrollbars |
| @radix-ui/react-tooltip | Hover tooltips |
| @radix-ui/react-tabs | Tab navigation |
| @radix-ui/react-separator | Visual dividers |
| @radix-ui/react-slot | Polymorphic as-child pattern |

---

## apps/api — Fastify Backend

| Package | Version | Purpose |
|---|---|---|
| fastify | 4.27.0 | Web framework (2x faster than Express) |
| @fastify/cors | 9.0.1 | CORS handling |
| @fastify/websocket | 10.0.1 | WebSocket support |
| @fastify/jwt | 8.0.1 | JWT auth middleware |
| @fastify/rate-limit | 9.1.0 | Rate limiting |
| @fastify/sensible | 5.6.0 | HTTP error helpers |
| ai | 3.2.22 | Vercel AI SDK for server |
| @daytona/sdk | 0.1.0 | Daytona workspace management |
| @supabase/supabase-js | 2.43.4 | Auth verification |
| drizzle-orm | 0.30.10 | Type-safe ORM |
| postgres | 3.4.4 | PostgreSQL driver |
| @upstash/redis | 1.31.3 | Redis client (HTTP-based) |
| zod | 3.23.8 | Schema validation |
| pino | 9.2.0 | Structured JSON logging |
| @firecrawl/sdk | 0.0.36 | Docs scraping |
| openai | 4.51.0 | Embeddings API |
| nanoid | 5.0.7 | ID generation |

---

## packages/db — Drizzle ORM Schema

```typescript
// packages/db/src/schema.ts
import { pgTable, text, timestamp, uuid, varchar, integer, jsonb } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),  // Supabase auth UID
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sandboxId: text("sandbox_id"),
  sandboxProvider: text("sandbox_provider").default("daytona"),
  previewUrl: text("preview_url"),
  status: text("status").default("creating").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  role: text("role").notNull(),  // user | assistant | system
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  tokens: integer("tokens"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const projectFiles = pgTable("project_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})
```

---

## turbo.json

```json
{
  "schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "type-check": {}
  }
}
```

---

## Docker Compose (Local Dev)

```yaml
version: "3.8"
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: lovable_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  postgres_data:
```