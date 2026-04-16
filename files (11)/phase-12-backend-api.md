# Phase 12 — Backend API Design

## Fastify Server Setup

```typescript
// apps/api/src/index.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { projectRoutes } from './routes/projects'
import { messageRoutes } from './routes/messages'
import { sandboxRoutes } from './routes/sandbox'
import { fileRoutes } from './routes/files'

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } })

app.register(cors, { origin: process.env.FRONTEND_URL, credentials: true })
app.register(websocket)
app.register(jwt, { secret: process.env.SUPABASE_JWT_SECRET! })
app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

// Auth middleware
app.addHook('preHandler', async (req, reply) => {
  if (req.routerPath?.startsWith('/public')) return
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.register(projectRoutes, { prefix: '/api/projects' })
app.register(messageRoutes, { prefix: '/api/projects/:projectId/messages' })
app.register(sandboxRoutes, { prefix: '/api/sandbox' })
app.register(fileRoutes, { prefix: '/api/projects/:projectId/files' })

app.listen({ port: 8080, host: '0.0.0.0' })
```

---

## Project Routes

```typescript
// apps/api/src/routes/projects.ts
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db, projects } from '@app/db'
import { createProject, deleteProject } from '../services/project.service'

const CreateProjectSchema = z.object({ name: z.string().min(1).max(100) })

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/projects — list user's projects
  app.get('/', async (req) => {
    const userId = req.user.sub
    return db.select().from(projects).where(eq(projects.userId, userId))
  })

  // POST /api/projects — create project + sandbox
  app.post('/', async (req, reply) => {
    const body = CreateProjectSchema.parse(req.body)
    const project = await createProject(req.user.sub, body.name)
    return reply.code(201).send(project)
  })

  // GET /api/projects/:id
  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string }
    const [project] = await db.select().from(projects).where(eq(projects.id, id))
    if (!project) throw app.httpErrors.notFound('Project not found')
    return project
  })

  // PATCH /api/projects/:id
  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string }
    const { name } = req.body as { name?: string }
    const [updated] = await db.update(projects)
      .set({ name, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning()
    return updated
  })

  // DELETE /api/projects/:id
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    await deleteProject(id)
    return reply.code(204).send()
  })
}
```

---

## Sandbox Routes

```typescript
// apps/api/src/routes/sandbox.ts
export const sandboxRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/sandbox/:id/status
  app.get('/:id/status', async (req) => {
    const { id } = req.params as { id: string }
    return getWorkspaceStatus(id)
  })

  // POST /api/sandbox/:id/start
  app.post('/:id/start', async (req) => {
    const { id } = req.params as { id: string }
    const previewUrl = await startDevServer(id)
    return { previewUrl }
  })

  // POST /api/sandbox/:id/stop
  app.post('/:id/stop', async (req) => {
    const { id } = req.params as { id: string }
    await stopWorkspace(id)
    return { status: 'stopped' }
  })

  // WebSocket: /api/sandbox/:id/logs — stream build logs
  app.get('/:id/logs', { websocket: true }, async (connection, req) => {
    const { id } = req.params as { id: string }
    for await (const chunk of streamLogs(id)) {
      connection.socket.send(JSON.stringify({ type: 'log', data: chunk }))
    }
  })
}
```

---

## File Routes

```typescript
// apps/api/src/routes/files.ts
export const fileRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/projects/:projectId/files — list all files
  app.get('/', async (req) => {
    const { projectId } = req.params as { projectId: string }
    const project = await getProject(projectId)
    return listFiles(project.sandboxId)
  })

  // GET /api/projects/:projectId/files/*path — read file
  app.get('/*', async (req) => {
    const { projectId } = req.params as { projectId: string }
    const path = (req.params as any)['*']
    const project = await getProject(projectId)
    const content = await readFile(project.sandboxId, path)
    return { path, content }
  })

  // PUT /api/projects/:projectId/files/*path — write file
  app.put('/*', async (req) => {
    const { projectId } = req.params as { projectId: string }
    const path = (req.params as any)['*']
    const { content } = req.body as { content: string }
    const project = await getProject(projectId)
    await writeFile(project.sandboxId, path, content)
    return { path, success: true }
  })

  // DELETE /api/projects/:projectId/files/*path
  app.delete('/*', async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const path = (req.params as any)['*']
    const project = await getProject(projectId)
    await deleteFile(project.sandboxId, path)
    return reply.code(204).send()
  })
}
```

---

## Project Service

```typescript
// apps/api/src/services/project.service.ts
import { nanoid } from 'nanoid'
import { db, projects } from '@app/db'
import { acquireWorkspace } from './workspace-pool'

export async function createProject(userId: string, name: string) {
  const id = nanoid()

  // Get pre-warmed workspace from pool (or create on-demand)
  const { wsId, previewUrl } = await acquireWorkspace()

  const [project] = await db.insert(projects).values({
    id, userId, name,
    sandboxId: wsId,
    sandboxProvider: 'daytona',
    previewUrl,
    status: 'running',
  }).returning()

  return project
}

export async function deleteProject(id: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, id))
  if (!project) return

  // Destroy sandbox
  await deleteWorkspace(project.sandboxId).catch(console.error)

  // Delete all project data
  await db.delete(messages).where(eq(messages.projectId, id))
  await db.delete(projectFiles).where(eq(projectFiles.projectId, id))
  await db.delete(projects).where(eq(projects.id, id))
}
```

---

## Error Handling

```typescript
// Consistent error responses
app.setErrorHandler((err, req, reply) => {
  const statusCode = err.statusCode ?? 500
  reply.code(statusCode).send({
    error: err.message,
    code: err.code,
    statusCode,
  })
})
```
