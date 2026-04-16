# Phase 16 — RAG Pipeline: Embeddings & Retrieval

## Overview

Scraped docs are chunked, embedded, and stored in pgvector. At query time, the user's prompt is embedded and similar doc chunks are retrieved and injected into the LLM system prompt.

---

## pgvector Setup

```sql
-- Enable pgvector extension in Supabase
CREATE EXTENSION IF NOT EXISTS vector;

-- Doc embeddings table
CREATE TABLE doc_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- IVFFlat index for approximate nearest neighbor search
CREATE INDEX ON doc_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

---

## Embedding Pipeline (packages/docs-scraper/src/embed.ts)

```typescript
import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { docEmbeddings } from '@app/db'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql)

interface DocPage {
  url: string
  title: string
  content: string
  framework: string
}

// Chunk a document into ~500-token segments
function chunkText(text: string, chunkSize = 1500, overlap = 200): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = start + chunkSize
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
  }
  return chunks
}

// Embed a batch of texts (max 100 per request)
async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  })
  return res.data.map(d => d.embedding)
}

export async function embedAll(): Promise<void> {
  const frameworks = await fs.readdir('docs-cache')

  for (const framework of frameworks) {
    console.log(`Embedding ${framework}...`)
    const dir = path.join('docs-cache', framework)
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && f !== 'index.json')

    const pages: DocPage[] = []
    for (const f of files) {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8')) as DocPage
      if (data.content?.length > 100) pages.push(data)
    }

    // Chunk and embed
    const chunks: { framework: string; title: string; content: string; url: string }[] = []
    for (const page of pages) {
      const parts = chunkText(page.content)
      for (const part of parts) {
        chunks.push({ framework, title: page.title, content: part, url: page.url })
      }
    }

    // Embed in batches of 50
    const BATCH = 50
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      const embeddings = await embedBatch(batch.map(c => c.content))

      // Insert into pgvector
      for (let j = 0; j < batch.length; j++) {
        const { framework, title, content, url } = batch[j]
        const embedding = embeddings[j]
        await sql`
          INSERT INTO doc_embeddings (framework, title, content, source_url, embedding)
          VALUES (${framework}, ${title}, ${content}, ${url}, ${JSON.stringify(embedding)}::vector)
        `
      }

      console.log(`  Embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length} chunks`)
    }

    console.log(`  Done: ${framework} (${chunks.length} chunks)`)
  }
}
```

---

## Retrieval Service (apps/api/src/services/rag.service.ts)

```typescript
import OpenAI from 'openai'
import { sql as sqlClient } from '@app/db'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export interface DocChunk {
  framework: string
  title: string
  content: string
  sourceUrl?: string
  similarity: number
}

// Embed a query and find similar doc chunks
export async function searchDocs(
  query: string,
  framework?: string,
  limit = 5,
): Promise<DocChunk[]> {
  // 1. Embed the query
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const queryEmbedding = JSON.stringify(res.data[0].embedding)

  // 2. Cosine similarity search in pgvector
  const frameworkFilter = framework ? `AND framework = '${framework}'` : ''
  const rows = await sqlClient`
    SELECT
      framework,
      title,
      content,
      source_url,
      1 - (embedding <=> ${queryEmbedding}::vector) AS similarity
    FROM doc_embeddings
    WHERE 1 - (embedding <=> ${queryEmbedding}::vector) > 0.7
    ${sqlClient.unsafe(frameworkFilter)}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `

  return rows.map(r => ({
    framework: r.framework,
    title: r.title,
    content: r.content,
    sourceUrl: r.source_url,
    similarity: parseFloat(r.similarity),
  }))
}

// Format retrieved chunks for the system prompt
export function formatDocsForPrompt(chunks: DocChunk[]): string {
  if (chunks.length === 0) return ''
  return chunks.map(c =>
    `## ${c.framework.toUpperCase()}: ${c.title}\n${c.content}`
  ).join('\n\n---\n\n')
}
```

---

## Integration with Context Builder

```typescript
// apps/api/src/services/context-builder.ts
import { searchDocs, formatDocsForPrompt } from './rag.service'

export async function buildContext(projectId: string, userMessage: string, sandboxId: string) {
  const [fileTree, ragChunks] = await Promise.all([
    listFiles(sandboxId),
    searchDocs(userMessage),
  ])

  return {
    fileTree,
    ragContext: formatDocsForPrompt(ragChunks),
    userMessage,
  }
}
```

---

## Retrieval Quality Tuning

| Parameter | Value | Notes |
|---|---|---|
| Embedding model | text-embedding-3-small | 1536-dim, cost-efficient |
| Chunk size | 1500 chars | ~375 tokens per chunk |
| Chunk overlap | 200 chars | Preserve context across chunks |
| Similarity threshold | 0.7 | Drop irrelevant results |
| Top-k results | 5 | Balance context vs token cost |
| Index type | IVFFlat (lists=100) | Good for <1M vectors |
