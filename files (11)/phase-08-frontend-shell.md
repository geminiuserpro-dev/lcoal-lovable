/# Phase 08 — Frontend Shell & Design System

## Application Layout

Three-panel layout with resizable panels:

```
┌────────────────────────────────────────────────────────┐
│  HEADER: Logo | Project Name | Model Selector | User   │
├──────────────┬─────────────────────┬───────────────────┤
│              │                     │                   │
│  CHAT        │  CODE EDITOR        │  LIVE PREVIEW     │
│  PANEL       │  + FILE TREE        │  iframe           │
│  (left)      │  (center)           │  (right)          │
│              │                     │                   │
│  Messages    │  Monaco Editor      │  Preview URL      │
│  Input box   │  Tab bar            │  Refresh toolbar  │
│              │  File tree (bottom) │                   │
└──────────────┴─────────────────────┴───────────────────┘
```

---

## Next.js App Router Structure

```
apps/web/
├── app/
│   ├── layout.tsx              Root layout (providers, fonts)
│   ├── page.tsx                Landing / redirect to /dashboard
│   ├── (auth)/
│   │   ├── login/page.tsx      Google OAuth login page
│   │   └── callback/page.tsx   OAuth callback handler
│   ├── dashboard/
│   │   └── page.tsx            Project list
│   └── projects/
│       └── [id]/
│           ├── page.tsx        Main editor page (3-panel layout)
│           └── loading.tsx     Loading skeleton
├── components/
│   ├── ui/                     shadcn/ui primitives
│   ├── layout/
│   │   ├── Header.tsx
│   │   └── Sidebar.tsx
│   ├── chat/
│   │   ├── ChatPanel.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageBubble.tsx
│   │   └── ChatInput.tsx
│   ├── editor/
│   │   ├── CodeEditor.tsx
│   │   ├── FileTree.tsx
│   │   └── EditorTabs.tsx
│   └── preview/
│       ├── PreviewPanel.tsx
│       └── PreviewToolbar.tsx
├── lib/
│   ├── supabase.ts             Supabase client
│   ├── auth.ts                 Auth helpers
│   └── api.ts                  API client (fetch wrappers)
└── store/
    ├── project.store.ts        Zustand project state
    └── editor.store.ts         Zustand editor state
```

---

## Root Layout (app/layout.tsx)

```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Providers } from '@/components/Providers'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Lovable Clone — AI Web App Builder',
  description: 'Build web apps with AI. Describe what you want, get a live preview.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

---

## Three-Panel Layout (app/projects/[id]/page.tsx)

```tsx
'use client'

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { Header } from '@/components/layout/Header'
import { useProject } from '@/store/project.store'

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { project } = useProject(params.id)

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <Header project={project} />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
          <ChatPanel projectId={params.id} />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={40} minSize={25}>
          <CodeEditor projectId={params.id} />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={35} minSize={20}>
          <PreviewPanel previewUrl={project?.previewUrl} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
```

---

## Global CSS (globals.css)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 222 47% 11%;        /* Deep dark blue */
    --foreground: 210 40% 96%;
    --primary: 221 83% 53%;           /* Electric blue */
    --primary-foreground: 210 40% 98%;
    --secondary: 217 33% 17%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --accent: 217 33% 22%;
    --accent-foreground: 210 40% 98%;
    --border: 217 33% 22%;
    --input: 217 33% 22%;
    --ring: 221 83% 53%;
    --radius: 0.5rem;
    --font-sans: 'Inter', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { @apply bg-muted; }
  ::-webkit-scrollbar-thumb { @apply bg-muted-foreground/30 rounded-full; }
}
```

---

## Zustand Store (store/project.store.ts)

```typescript
import { create } from 'zustand'

interface ProjectState {
  projectId: string | null
  project: Project | null
  files: Record<string, string>   // path -> content
  activeFile: string | null
  setProject: (p: Project) => void
  setFile: (path: string, content: string) => void
  setActiveFile: (path: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  project: null,
  files: {},
  activeFile: null,
  setProject: (project) => set({ project, projectId: project.id }),
  setFile: (path, content) => set(s => ({ files: { ...s.files, [path]: content } })),
  setActiveFile: (path) => set({ activeFile: path }),
}))

export function useProject(id: string) {
  return useProjectStore(s => ({ project: s.project, setProject: s.setProject }))
}
```

---

## Header Component

```tsx
// components/layout/Header.tsx
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/ModelSelector'
import { UserMenu } from '@/components/UserMenu'

export function Header({ project }: { project: Project | null }) {
  return (
    <header className="h-12 border-b border-border flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2">
        <Logo className="h-6 w-6" />
        <span className="font-semibold text-sm">{project?.name ?? 'Loading...'}</span>
      </div>

      <div className="flex-1" />

      <ModelSelector />
      <Button variant="outline" size="sm">Publish</Button>
      <UserMenu />
    </header>
  )
}
```
