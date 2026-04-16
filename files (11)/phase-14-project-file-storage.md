# Phase 14 — Project & File Storage

## Storage Architecture

```
User edits file via Monaco Editor
  -> Debounced save (1s) -> PUT /api/projects/:id/files/:path
    -> Backend writes to Daytona workspace (primary source of truth)
    -> Backend also persists to PostgreSQL (project_files table)
      -> Enables file history and recovery

On project load:
  -> Fetch files from Daytona workspace (live FS)
  -> Fall back to PostgreSQL if workspace is paused

Periodic snapshot (every 5 min while active):
  -> Sync all workspace files to Supabase Storage (S3-compatible)
  -> Enables project export / clone
```

---

## Drizzle ORM Schema (packages/db/src/schema.ts)

```typescript
import {
  pgTable, text, timestamp, uuid, integer, jsonb, boolean, index
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  sandboxId: text('sandbox_id'),
  sandboxProvider: text('sandbox_provider').default('daytona').notNull(),
  previewUrl: text('preview_url'),
  status: text('status').default('creating').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('projects_user_idx').on(t.userId),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  tokens: integer('tokens'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('messages_project_idx').on(t.projectId),
}))

export const projectFiles = pgTable('project_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  path: text('path').notNull(),
  content: text('content').notNull(),
  sizeBytes: integer('size_bytes'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  projectPathIdx: index('files_project_path_idx').on(t.projectId, t.path),
}))

export const docEmbeddings = pgTable('doc_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  framework: text('framework').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceUrl: text('source_url'),
  embedding: text('embedding'),  // vector(1536) via pgvector
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

---

## File Sync Service

```typescript
// apps/api/src/services/file-sync.service.ts

// Persist a file write to both Daytona and PostgreSQL
export async function persistFileWrite(
  projectId: string,
  sandboxId: string,
  path: string,
  content: string,
): Promise<void> {
  // 1. Write to live sandbox (primary)
  await writeFile(sandboxId, path, content)

  // 2. Persist to DB (backup + history)
  await db.insert(projectFiles)
    .values({ projectId, path, content, sizeBytes: content.length, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [projectFiles.projectId, projectFiles.path],
      set: { content, sizeBytes: content.length, updatedAt: new Date() },
    })
}

// Restore files from DB into sandbox (e.g., after workspace restart)
export async function restoreFromDb(projectId: string, sandboxId: string): Promise<void> {
  const files = await db.select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))

  await Promise.all(
    files.map(f => writeFile(sandboxId, f.path, f.content))
  )
}

// Full project snapshot to Supabase Storage
export async function snapshotToStorage(projectId: string, sandboxId: string): Promise<void> {
  const files = await listFiles(sandboxId)

  await Promise.all(
    files.map(async (path) => {
      const content = await readFile(sandboxId, path)
      const blob = new Blob([content], { type: 'text/plain' })
      await supabase.storage
        .from('project-snapshots')
        .upload(`${projectId}/${path}`, blob, { upsert: true })
    })
  )
}
```

---

## Supabase Storage Setup

```sql
-- Create storage bucket
insert into storage.buckets (id, name, public)
values ('project-snapshots', 'project-snapshots', false);

-- RLS: users can only access their own project files
create policy "Users access own project files"
on storage.objects for all
using (
  bucket_id = 'project-snapshots'
  and auth.uid()::text = (storage.foldername(name))[1]
);
```

---

## Drizzle Kit Config (packages/db/drizzle.config.ts)

```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config
```

---

## Database Client

```typescript
// packages/db/src/index.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const queryClient = postgres(process.env.DATABASE_URL!)
export const db = drizzle(queryClient, { schema })
export * from './schema'
```

---

## Periodic Auto-Save (Frontend)

```typescript
// Debounced file save on every keystroke
const debouncedSave = useMemo(
  () => debounce(async (path: string, content: string) => {
    await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  }, 1000),
  [projectId]
)

// Call on every Monaco editor change
const handleChange = (value: string | undefined) => {
  if (activeFile && value !== undefined) {
    setFile(activeFile, value)
    debouncedSave(activeFile, value)
  }
}
```
