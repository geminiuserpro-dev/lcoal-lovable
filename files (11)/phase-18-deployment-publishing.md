# Phase 18 — Deployment & Publishing Flow

## Two Deployment Contexts

### 1. Platform Infrastructure (Our app)
- **Frontend**: Deployed on Vercel (automatic on git push)
- **Backend API**: Deployed on Modal or Railway
- **Database**: Supabase managed PostgreSQL

### 2. User Project Publishing (Users publish their apps)
- Static export -> Vercel for each user project
- Custom subdomain: `projectname.lovable.app`

---

## Platform Infrastructure Deployment

### Frontend (Vercel)

```json
// apps/web/vercel.json
{
  "buildCommand": "cd ../.. && turbo build --filter=@app/web",
  "outputDirectory": "apps/web/.next",
  "installCommand": "npm install",
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase_url",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "@supabase_anon_key",
    "NEXT_PUBLIC_API_URL": "@api_url",
    "NEXT_PUBLIC_WS_URL": "@ws_url"
  }
}
```

### Backend API (Modal)

```python
# infra/modal/api.py
import modal

image = (
    modal.Image.debian_slim()
    .apt_install("curl")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs")
    .copy_local_dir("../../apps/api/dist", "/app")
    .run_commands("cd /app && npm install --production")
)

app = modal.App("lovable-api", image=image)

@app.function(
    secrets=[modal.Secret.from_name("lovable-secrets")],
    keep_warm=1,
)
@modal.web_endpoint(method="GET")
def fastify_api():
    import subprocess
    subprocess.run(["node", "/app/index.js"])
```

---

## User Project Publishing Flow

```
User clicks "Publish" button
  -> Frontend: POST /api/projects/:id/publish
    -> Backend:
      1. Trigger build in Daytona workspace: npm run build
      2. Get build output (/workspace/dist/)
      3. Copy dist/ to Supabase Storage (or Cloudflare Pages)
      4. Generate subdomain: {project-slug}.lovable.app
      5. Configure Cloudflare DNS / Vercel deployment
      6. Return published URL
    -> Frontend shows: "Published at https://my-app.lovable.app"
```

---

## Publish API Route

```typescript
// apps/api/src/routes/publish.ts
app.post('/api/projects/:id/publish', async (req, reply) => {
  const { id } = req.params as { id: string }
  const project = await getProject(id)

  // 1. Run build in sandbox
  await daytona.exec(project.sandboxId, 'cd /workspace && npm run build')

  // 2. Verify dist/ exists
  const distFiles = await listFiles(project.sandboxId, 'dist')
  if (distFiles.length === 0) {
    throw new Error('Build produced no output files')
  }

  // 3. Upload dist/ to Cloudflare Pages or Vercel
  const publishedUrl = await deployToCloudflarePages(project, distFiles)

  // 4. Update project record
  await db.update(projects)
    .set({ publishedUrl, publishedAt: new Date() })
    .where(eq(projects.id, id))

  return { url: publishedUrl }
})
```

---

## Cloudflare Pages Deployment

```typescript
// apps/api/src/services/cloudflare-pages.service.ts

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!

export async function deployToCloudflarePages(
  project: Project,
  distFiles: string[],
): Promise<string> {
  const projectName = `lovable-${project.id.slice(0, 8)}`

  // Create or get CF Pages project
  await ensureCFProject(projectName)

  // Upload files using CF Pages direct upload API
  const formData = new FormData()
  for (const filePath of distFiles) {
    const content = await readFile(project.sandboxId, `dist/${filePath}`)
    formData.append('files', new Blob([content]), filePath)
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
      body: formData,
    }
  )

  const data = await res.json()
  return data.result.url  // https://xxx.lovable-project.pages.dev
}

async function ensureCFProject(name: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${name}`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  )
  if (res.status === 404) {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, production_branch: 'main' }),
      }
    )
  }
}
```

---

## Publish Button UI

```tsx
// components/layout/PublishButton.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink, Loader2, Globe } from 'lucide-react'
import { toast } from 'sonner'

export function PublishButton({ projectId }: { projectId: string }) {
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  const publish = async () => {
    setPublishing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, { method: 'POST' })
      const data = await res.json()
      setPublishedUrl(data.url)
      toast.success('Published!', { description: data.url })
    } catch (err: any) {
      toast.error('Publish failed', { description: err.message })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {publishedUrl && (
        <Button variant="ghost" size="sm" asChild>
          <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
            <Globe className="h-4 w-4 mr-1" />
            View
          </a>
        </Button>
      )}
      <Button size="sm" onClick={publish} disabled={publishing}>
        {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        {publishing ? 'Publishing...' : 'Publish'}
      </Button>
    </div>
  )
}
```
