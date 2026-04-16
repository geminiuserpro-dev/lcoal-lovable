# Phase 11 — Live Preview: Port Forwarding & Iframe

## Architecture

```
Daytona workspace
  npm run dev running on :3000
  Vite HMR active
    |
    | Daytona port forward
    v
  https://3000-project-xxx.daytona.app
    |
    | iframe src
    v
  PreviewPanel in frontend
    |
    | postMessage (optional: HMR reload events)
    v
  User sees live app
```

---

## PreviewPanel.tsx

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { PreviewToolbar } from './PreviewToolbar'
import { useProjectStore } from '@/store/project.store'

export function PreviewPanel({ previewUrl }: { previewUrl?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')

  const handleLoad = () => setIsLoading(false)
  const refresh = () => {
    setIsLoading(true)
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <PreviewToolbar
        previewUrl={previewUrl}
        onRefresh={refresh}
        viewport={viewport}
        onViewportChange={setViewport}
      />

      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-muted/20">
        {!previewUrl ? (
          <div className="text-center text-muted-foreground text-sm">
            <p className="text-4xl mb-3">🚀</p>
            <p>Starting your sandbox...</p>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
                <div className="flex gap-2 items-center text-sm text-muted-foreground">
                  <span className="animate-spin">⟳</span>
                  Loading preview...
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={previewUrl}
              onLoad={handleLoad}
              className={viewport === 'mobile' ? 'w-[375px] h-[812px] border border-border rounded-xl shadow-xl' : 'w-full h-full'}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              title="Live Preview"
            />
          </>
        )}
      </div>
    </div>
  )
}
```

---

## PreviewToolbar.tsx

```tsx
'use client'

import { RefreshCw, ExternalLink, Monitor, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  previewUrl?: string
  onRefresh: () => void
  viewport: 'desktop' | 'mobile'
  onViewportChange: (v: 'desktop' | 'mobile') => void
}

export function PreviewToolbar({ previewUrl, onRefresh, viewport, onViewportChange }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 h-10 border-b border-border bg-background shrink-0">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>

      <div className="flex-1 min-w-0">
        {previewUrl ? (
          <span className="text-xs text-muted-foreground font-mono truncate">{previewUrl}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Starting sandbox...</span>
        )}
      </div>

      <div className="flex gap-1">
        <Button
          variant={viewport === 'desktop' ? 'secondary' : 'ghost'}
          size="icon" className="h-7 w-7"
          onClick={() => onViewportChange('desktop')}
        >
          <Monitor className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={viewport === 'mobile' ? 'secondary' : 'ghost'}
          size="icon" className="h-7 w-7"
          onClick={() => onViewportChange('mobile')}
        >
          <Smartphone className="h-3.5 w-3.5" />
        </Button>
      </div>

      {previewUrl && (
        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
    </div>
  )
}
```

---

## Preview URL Generation (Backend)

```typescript
// apps/api/src/services/sandbox.service.ts

export async function getOrCreatePreviewUrl(project: Project): Promise<string> {
  if (project.previewUrl) {
    // Verify URL is still active
    const ok = await checkUrlAlive(project.previewUrl)
    if (ok) return project.previewUrl
  }

  // Re-forward port (workspace may have restarted)
  const previewUrl = await startDevServer(project.sandboxId)

  // Persist new URL
  await db.update(projects)
    .set({ previewUrl, updatedAt: new Date() })
    .where(eq(projects.id, project.id))

  return previewUrl
}

async function checkUrlAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
    return res.ok || res.status === 304
  } catch {
    return false
  }
}
```

---

## HMR Through Tunnel

Vite's HMR websocket must be configured to work through the HTTPS tunnel:

```typescript
// sandbox-template/vite.config.ts
server: {
  host: '0.0.0.0',
  port: 3000,
  hmr: {
    protocol: 'wss',
    clientPort: 443,   // Daytona tunnel is on 443
    host: undefined,   // Let Daytona handle the host
  },
},
```

This ensures hot module replacement works inside the iframe without page refreshes.

---

## Error Overlay in Preview

When Vite throws a build error, capture it and display inline:

```tsx
// Listen for error messages from iframe
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'vite:error') {
      setBuildError(e.data.err.message)
    }
    if (e.data?.type === 'vite:afterUpdate') {
      setBuildError(null)
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}, [])
```
