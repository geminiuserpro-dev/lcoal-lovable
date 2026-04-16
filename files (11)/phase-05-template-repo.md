# Phase 05 — Template Repository & Snapshot Strategy

## Purpose

The template repo is the base React/Vite/TypeScript project cloned for every new user project.
It is pre-configured and pre-installed so users get a running app in seconds.

---

## File Structure

```
sandbox-template/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json          # shadcn/ui config
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── vite-env.d.ts
    ├── components/
    │   └── ui/              # shadcn/ui primitives
    │       ├── button.tsx
    │       ├── card.tsx
    │       ├── input.tsx
    │       ├── label.tsx
    │       ├── dialog.tsx
    │       └── ...
    └── lib/
        └── utils.ts
```

---

## package.json

```json
{
  "name": "sandbox-template",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 3000",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0",
    "@tanstack/react-query": "^5.45.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0",
    "lucide-react": "^0.395.0",
    "framer-motion": "^11.2.12",
    "sonner": "^1.5.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-scroll-area": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.1",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "zod": "^3.23.8",
    "react-hook-form": "^7.52.0",
    "@hookform/resolvers": "^3.6.0",
    "date-fns": "^3.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react-swc": "^3.7.0",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "tailwindcss": "^3.4.4",
    "tailwindcss-animate": "^1.0.7",
    "postcss": "^8.4.39",
    "autoprefixer": "^10.4.19"
  }
}
```

---

## vite.config.ts

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    hmr: {
      protocol: 'wss',
      clientPort: 443,  // HMR through HTTPS tunnel
    },
  },
})
```

---

## tailwind.config.ts

```typescript
import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
```

---

## src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground font-sans; }
}
```

---

## src/App.tsx (Starter)

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">Hello World</h1>
        <p className="text-muted-foreground text-lg">
          Edit <code className="font-mono bg-muted px-1 rounded">src/App.tsx</code> to start building.
        </p>
        <Button size="lg" onClick={() => setCount(c => c + 1)}>
          Count is {count}
        </Button>
      </div>
    </main>
  )
}
```

---

## Snapshot Rebuild Script

```bash
#!/bin/bash
# scripts/rebuild-snapshot.sh
set -e

# Sync template files into existing workspace
daytona exec template-builder "rm -rf /workspace/* /workspace/.[^.]*" 2>/dev/null || true
daytona fs upload template-builder ./sandbox-template /workspace

# Install dependencies (the key step)
daytona exec template-builder "cd /workspace && npm ci"

# Add all shadcn components we want pre-installed
daytona exec template-builder "cd /workspace && npx shadcn-ui@latest add button card input label textarea dialog dropdown-menu scroll-area tooltip tabs badge avatar skeleton separator --yes"

# Create new snapshot
NEW_SNAP=$(daytona snapshot create \
  --workspace template-builder \
  --name react-vite-ts-v1 \
  --format id)

echo ""
echo "New snapshot ID: $NEW_SNAP"
echo "Update your .env: DAYTONA_TEMPLATE_SNAPSHOT_ID=$NEW_SNAP"
```
