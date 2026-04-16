# Phase 10 — Code Editor & File Tree UI

## Overview

The center panel contains Monaco Editor (VSCode's engine) and a file tree for navigation.

---

## Component Structure

```
editor/
├── CodeEditor.tsx       Main editor wrapper
├── EditorTabs.tsx       Open file tabs
├── FileTree.tsx         Directory tree navigation
├── FileTreeItem.tsx     Individual file/folder node
└── EditorToolbar.tsx    Save, format, open in Daytona buttons
```

---

## CodeEditor.tsx

```tsx
'use client'

import { Editor } from '@monaco-editor/react'
import { useRef, useCallback } from 'react'
import { EditorTabs } from './EditorTabs'
import { FileTree } from './FileTree'
import { useProjectStore } from '@/store/project.store'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  css: 'css', json: 'json', html: 'html', md: 'markdown', py: 'python',
}

export function CodeEditor({ projectId }: { projectId: string }) {
  const editorRef = useRef<any>(null)
  const { files, activeFile, setFile, setActiveFile } = useProjectStore()

  const language = activeFile
    ? (LANGUAGE_MAP[activeFile.split('.').pop() ?? ''] ?? 'plaintext')
    : 'plaintext'

  const handleChange = useCallback((value: string | undefined) => {
    if (activeFile && value !== undefined) {
      setFile(activeFile, value)
    }
  }, [activeFile, setFile])

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor

    // Configure TypeScript
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      strict: true,
    })

    // Dark theme
    monaco.editor.defineTheme('lovable-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0f1117',
        'editor.lineHighlightBackground': '#1a1d2e',
      },
    })
    monaco.editor.setTheme('lovable-dark')
  }

  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      <ResizablePanel defaultSize={70} minSize={40}>
        <div className="flex flex-col h-full">
          <EditorTabs />
          <div className="flex-1">
            {activeFile ? (
              <Editor
                height="100%"
                language={language}
                value={files[activeFile] ?? ''}
                onChange={handleChange}
                onMount={handleEditorMount}
                options={{
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: 'on',
                  padding: { top: 12 },
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  formatOnPaste: true,
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Select a file from the tree
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
        <FileTree projectId={projectId} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

---

## FileTree.tsx

```tsx
'use client'

import { useEffect, useState } from 'react'
import { FileTreeItem } from './FileTreeItem'
import { useProjectStore } from '@/store/project.store'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: Record<string, any> = {}
  for (const p of paths) {
    const parts = p.split('/')
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!cur[part]) {
        cur[part] = i < parts.length - 1 ? {} : null
      }
      if (cur[part] !== null) cur = cur[part]
    }
  }
  function toNodes(obj: Record<string, any>, prefix = ''): TreeNode[] {
    return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)).map(([name, children]) => {
      const path = prefix ? `${prefix}/${name}` : name
      return children === null
        ? { name, path, type: 'file' }
        : { name, path, type: 'dir', children: toNodes(children, path) }
    })
  }
  return toNodes(root)
}

export function FileTree({ projectId }: { projectId: string }) {
  const { files, setActiveFile } = useProjectStore()
  const [tree, setTree] = useState<TreeNode[]>([])

  useEffect(() => {
    setTree(buildTree(Object.keys(files)))
  }, [files])

  return (
    <div className="h-full overflow-y-auto bg-secondary/30 p-2">
      <p className="text-xs text-muted-foreground px-2 py-1 font-medium uppercase tracking-wider">Files</p>
      {tree.map(node => (
        <FileTreeItem key={node.path} node={node} onSelect={setActiveFile} />
      ))}
    </div>
  )
}
```

---

## EditorTabs.tsx

```tsx
'use client'

import { X } from 'lucide-react'
import { useProjectStore } from '@/store/project.store'
import { cn } from '@/lib/utils'

export function EditorTabs() {
  const { openTabs, activeFile, setActiveFile, closeTab } = useProjectStore()

  if (openTabs.length === 0) return null

  return (
    <div className="flex border-b border-border overflow-x-auto bg-background shrink-0">
      {openTabs.map(tab => (
        <button
          key={tab}
          onClick={() => setActiveFile(tab)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border shrink-0 hover:bg-accent transition-colors',
            activeFile === tab && 'bg-editor-active text-foreground border-b-2 border-b-primary'
          )}
        >
          <span>{tab.split('/').pop()}</span>
          <X className="h-3 w-3 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(tab) }} />
        </button>
      ))}
    </div>
  )
}
```
