# Phase 03 — Sandbox Infrastructure: Daytona Deep Dive

## What is Daytona?

Daytona is a workspace-as-a-service platform for development environments. It lets you:
- Create isolated workspaces from container images or snapshots
- Snapshot a workspace (including node_modules) for instant cloning
- Access the filesystem via API
- Forward ports to HTTPS URLs
- Run processes inside workspaces

---

## Workspace Lifecycle per Project

```
[ONE TIME] Build template snapshot
   npm install inside workspace
   snapshot -> DAYTONA_TEMPLATE_SNAPSHOT_ID

[PER PROJECT] Create workspace from snapshot (~3s)
   -> clone snapshot (node_modules cached)
   -> npm run dev --host 0.0.0.0 --port 3000
   -> port forward 3000 -> https://xxx.daytona.app
   -> store previewUrl in DB

[DURING USE] File operations via SDK
   LLM writes files -> workspace FS -> Vite HMR -> iframe

[IDLE >30m] Auto-pause workspace

[DELETE] daytona.delete(workspaceId)
```

---

## Daytona Client (packages/sandbox-client/src/daytona.ts)

```typescript
import Daytona from '@daytona/sdk'

export const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
  serverUrl: process.env.DAYTONA_SERVER_URL!,
})

// Create workspace cloned from template snapshot
export async function createWorkspace(projectId: string) {
  const ws = await daytona.create({
    id: `project-${projectId}`,
    snapshot: process.env.DAYTONA_TEMPLATE_SNAPSHOT_ID!,
    resources: { cpu: 2, memory: 2048, disk: 10240 },
    env: { NODE_ENV: 'development' },
  })
  return { id: ws.id, state: ws.state }
}

// Start dev server, return preview URL
export async function startDevServer(workspaceId: string): Promise<string> {
  const ws = await daytona.get(workspaceId)
  await ws.process.start({
    command: 'npm run dev -- --host 0.0.0.0 --port 3000',
    workingDir: '/workspace',
    background: true,
    name: 'dev-server',
  })
  // Wait up to 30s for port to open
  await ws.waitForPort(3000, 30000)
  const fwd = await ws.portForward(3000)
  return fwd.url
}

export async function writeFile(wsId: string, path: string, content: string) {
  const ws = await daytona.get(wsId)
  await ws.fs.write(`/workspace/${path.replace(/^\//, '')}`, content)
}

export async function readFile(wsId: string, path: string): Promise<string> {
  const ws = await daytona.get(wsId)
  return ws.fs.read(`/workspace/${path.replace(/^\//, '')}`)
}

export async function deleteFile(wsId: string, path: string) {
  const ws = await daytona.get(wsId)
  await ws.fs.delete(`/workspace/${path.replace(/^\//, '')}`)
}

export async function listFiles(wsId: string, dir = 'src'): Promise<string[]> {
  const ws = await daytona.get(wsId)
  const entries = await ws.fs.list(`/workspace/${dir}`, { recursive: true })
  return entries
    .filter(e => !e.path.includes('node_modules'))
    .map(e => e.path.replace('/workspace/', ''))
}

export async function* streamLogs(wsId: string): AsyncGenerator<string> {
  const ws = await daytona.get(wsId)
  for await (const chunk of ws.process.logs('dev-server')) {
    yield chunk.toString()
  }
}

export async function stopWorkspace(wsId: string) {
  await daytona.stop(wsId)
}

export async function deleteWorkspace(wsId: string) {
  await daytona.delete(wsId)
}
```

---

## Building the Template Snapshot (One-Time)

```bash
# 1. Create base workspace
daytona workspace create --name template-builder --image node:20-alpine

# 2. Set up template inside workspace
daytona exec template-builder "git clone https://github.com/org/sandbox-template /workspace"
daytona exec template-builder "cd /workspace && npm ci"  # slow - done once

# 3. Add shadcn components
daytona exec template-builder "cd /workspace && npx shadcn-ui@latest add button card input label textarea dialog dropdown-menu scroll-area tooltip tabs badge avatar skeleton"

# 4. Create snapshot
SNAP_ID=$(daytona snapshot create \
  --workspace template-builder \
  --name react-vite-ts-v1 \
  --format id)

echo "DAYTONA_TEMPLATE_SNAPSHOT_ID=$SNAP_ID"
```

---

## Workspace Pool (Pre-warmed Workspaces)

```typescript
// apps/api/src/services/workspace-pool.ts
import { Redis } from '@upstash/redis'
import { createWorkspace, startDevServer } from '@app/sandbox-client'

const redis = Redis.fromEnv()
const POOL_SIZE = 5

export async function acquireWorkspace() {
  const wsId = await redis.rpop<string>('ws_pool')
  if (wsId) {
    const url = await redis.get<string>(`ws_url:${wsId}`) ?? ''
    refillPool()  // async, non-blocking
    return { wsId, previewUrl: url }
  }
  return createAndStart(`demand-${Date.now()}`)
}

async function createAndStart(id: string) {
  const ws = await createWorkspace(id)
  const url = await startDevServer(ws.id)
  return { wsId: ws.id, previewUrl: url }
}

async function refillPool() {
  const len = await redis.llen('ws_pool')
  for (let i = len; i < POOL_SIZE; i++) {
    const { wsId, previewUrl } = await createAndStart(`pool-${Date.now()}-${i}`)
    await redis.lpush('ws_pool', wsId)
    await redis.set(`ws_url:${wsId}`, previewUrl, { ex: 3600 })
  }
}
```

---

## Daytona Workspace Config (infra/daytona/workspace.yaml)

```yaml
name: lovable-sandbox
snapshot: ${DAYTONA_TEMPLATE_SNAPSHOT_ID}
resources:
  cpu: 2
  memory: 2048   # MB
  disk: 10240    # MB
ports:
  - port: 3000
    protocol: http
    expose: true
    name: vite-dev
env:
  NODE_ENV: development
startup:
  command: "npm run dev -- --host 0.0.0.0 --port 3000"
  cwd: /workspace
  name: dev-server
  background: true
```

---

## Error Handling Strategy

```typescript
export async function safeFileOp<T>(
  op: () => Promise<T>,
  wsId: string,
): Promise<T> {
  try {
    return await op()
  } catch (err: any) {
    if (err?.code === 'WORKSPACE_STOPPED') {
      // Resume workspace and retry once
      await daytona.start(wsId)
      await new Promise(r => setTimeout(r, 3000))
      return op()
    }
    throw err
  }
}
```
