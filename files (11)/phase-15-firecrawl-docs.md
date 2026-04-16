# Phase 15 — Firecrawl Integration & Doc Scraping

## Purpose

Download and index all relevant framework documentation locally so the LLM always has accurate, up-to-date API references. This prevents hallucinations about component APIs, CSS class names, etc.

---

## Docs to Scrape

| Framework | URL | Local cache path |
|---|---|---|
| React | https://react.dev/reference | docs-cache/react/ |
| Vite | https://vitejs.dev/guide | docs-cache/vite/ |
| Tailwind CSS | https://tailwindcss.com/docs | docs-cache/tailwind/ |
| shadcn/ui | https://ui.shadcn.com/docs | docs-cache/shadcn/ |
| TypeScript | https://www.typescriptlang.org/docs | docs-cache/typescript/ |
| Framer Motion | https://www.framer.com/motion | docs-cache/framer-motion/ |
| TanStack Query | https://tanstack.com/query/latest/docs | docs-cache/tanstack-query/ |
| Zustand | https://docs.pmnd.rs/zustand | docs-cache/zustand/ |
| Zod | https://zod.dev | docs-cache/zod/ |
| React Router | https://reactrouter.com/en/main | docs-cache/react-router/ |
| Lucide React | https://lucide.dev/icons | docs-cache/lucide/ |

---

## Firecrawl Scraper (packages/docs-scraper/src/scrape.ts)

```typescript
import FirecrawlApp from '@firecrawl/sdk'
import fs from 'fs/promises'
import path from 'path'

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })

const DOCS_TO_SCRAPE = [
  { framework: 'react',         url: 'https://react.dev/reference',                maxPages: 200 },
  { framework: 'vite',          url: 'https://vitejs.dev/guide',                   maxPages: 50 },
  { framework: 'tailwind',      url: 'https://tailwindcss.com/docs',               maxPages: 150 },
  { framework: 'shadcn',        url: 'https://ui.shadcn.com/docs',                 maxPages: 100 },
  { framework: 'typescript',    url: 'https://www.typescriptlang.org/docs/handbook', maxPages: 100 },
  { framework: 'framer-motion', url: 'https://www.framer.com/motion',              maxPages: 50 },
  { framework: 'tanstack-query',url: 'https://tanstack.com/query/latest/docs',     maxPages: 80 },
  { framework: 'zustand',       url: 'https://docs.pmnd.rs/zustand',               maxPages: 30 },
  { framework: 'zod',           url: 'https://zod.dev',                            maxPages: 40 },
  { framework: 'react-router',  url: 'https://reactrouter.com/en/main',            maxPages: 80 },
]

interface ScrapedDoc {
  url: string
  title: string
  content: string     // Clean markdown
  framework: string
  scrapedAt: string
}

export async function scrapeAll(): Promise<void> {
  for (const { framework, url, maxPages } of DOCS_TO_SCRAPE) {
    console.log(`Scraping ${framework} from ${url}...`)
    try {
      await scrapeFramework(framework, url, maxPages)
      console.log(`  Done: ${framework}`)
    } catch (err) {
      console.error(`  Error scraping ${framework}:`, err)
    }
  }
}

async function scrapeFramework(framework: string, startUrl: string, maxPages: number): Promise<void> {
  const outDir = path.join('docs-cache', framework)
  await fs.mkdir(outDir, { recursive: true })

  // Use Firecrawl crawl mode to follow links
  const crawl = await firecrawl.crawlUrl(startUrl, {
    limit: maxPages,
    scrapeOptions: {
      formats: ['markdown'],
      excludeTags: ['nav', 'footer', 'header', '.sidebar', '.toc', 'script', 'style'],
      onlyMainContent: true,
    },
  })

  // Poll until complete
  let status = crawl
  while (status.status === 'scraping') {
    await new Promise(r => setTimeout(r, 2000))
    status = await firecrawl.checkCrawlStatus(crawl.id)
  }

  // Save each page as a JSON file
  const docs: ScrapedDoc[] = status.data?.map(page => ({
    url: page.url ?? '',
    title: page.metadata?.title ?? '',
    content: page.markdown ?? '',
    framework,
    scrapedAt: new Date().toISOString(),
  })) ?? []

  // Save index
  await fs.writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ framework, url: startUrl, pageCount: docs.length, scrapedAt: new Date() }, null, 2)
  )

  // Save individual pages
  for (let i = 0; i < docs.length; i++) {
    await fs.writeFile(
      path.join(outDir, `${i.toString().padStart(4, '0')}.json`),
      JSON.stringify(docs[i], null, 2)
    )
  }

  console.log(`  Saved ${docs.length} pages to docs-cache/${framework}/`)
}
```

---

## CLI Runner (packages/docs-scraper/src/cli.ts)

```typescript
import { scrapeAll } from './scrape'
import { embedAll } from './embed'

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--scrape')) {
    console.log('Starting doc scraping...')
    await scrapeAll()
    console.log('Scraping complete.')
  }

  if (args.includes('--embed')) {
    console.log('Starting embedding...')
    await embedAll()
    console.log('Embedding complete.')
  }

  if (args.length === 0 || args.includes('--all')) {
    await scrapeAll()
    await embedAll()
  }
}

main().catch(console.error)
```

```json
// package.json scripts
{
  "scripts": {
    "scrape": "tsx src/cli.ts --scrape",
    "embed": "tsx src/cli.ts --embed",
    "scrape:all": "tsx src/cli.ts --all"
  }
}
```

---

## Scraping Strategy

| Mode | Use Case |
|---|---|
| `crawlUrl` | Follow all links from a root URL (best for full docs) |
| `scrapeUrl` | Single page only (for specific API pages) |
| `search` | Find specific content without knowing the URL |

### Firecrawl Options for Code-Heavy Docs

```typescript
scrapeOptions: {
  formats: ['markdown'],          // Get clean markdown, not HTML
  onlyMainContent: true,          // Strip nav, footer, ads
  excludeTags: ['nav', 'footer', 'aside', '.sidebar'],
  includeTags: ['main', 'article', '.content', 'pre', 'code'],
  waitFor: 1000,                  // Wait 1s for JS to render
  timeout: 30000,
},
```

---

## Update Schedule

Run the scraper weekly via a GitHub Action or cron job to keep docs current:

```yaml
# .github/workflows/update-docs.yml
on:
  schedule:
    - cron: '0 2 * * 0'  # Every Sunday at 2am
  workflow_dispatch:
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run scrape:all
        env:
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - run: git add docs-cache && git commit -m "chore: update docs cache" && git push
```
