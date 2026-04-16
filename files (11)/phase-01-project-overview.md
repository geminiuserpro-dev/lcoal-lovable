# Phase 01 — Project Overview & System Architecture

## Vision

Build a **Lovable-style AI-powered web application editor** where users describe what they want in a chat interface and an LLM generates, edits, and runs a full React/Vite/TypeScript app in a sandboxed cloud environment — with a live preview link.

---

## Core User Flow

```
User types prompt
      │
      ▼
Chat UI (Next.js frontend)
      │
      ▼
Backend API (FastAPI or Next.js API routes)
      │
      ├─► Vercel AI SDK → LLM (Anthropic / OpenAI / Google)
      │         │
      │         ▼
      │   Generated code diffs / files
      │
      ▼
Sandbox Orchestrator
      │
      ├─► Daytona  (persistent workspace, file system)
      └─► Modal    (ephemeral compute for npm run dev)
            │
            ▼
      Port 3000 exposed → Preview URL
            │
            ▼
      Iframe in frontend
```

---

## High-Level Components

| Component | Responsibility |
|-----------|---------------|
| **Frontend (Next.js 14 App Router)** | Chat UI, code editor, file tree, live preview iframe |
| **Backend API** | LLM orchestration, sandbox management, auth, project CRUD |
| **Vercel AI SDK** | Streaming LLM responses, tool use, multi-provider support |
| **Daytona** | Persistent workspace snapshots, file system, git |
| **Modal** | Serverless compute to run `npm run dev`, port forwarding |
| **Firecrawl** | Scrape docs, strip HTML, feed into RAG |
| **Vector Store (Qdrant / pgvector)** | Store scraped docs for retrieval-augmented generation |
| **PostgreSQL (Supabase)** | Users, projects, messages, file snapshots |
| **Redis** | Session cache, pub/sub for streaming |

---

## Key Design Principles

1. **Snapshot-first sandboxing**: Template repo is pre-built (`npm install` cached). Every new project clones this snapshot — cold starts under 3 seconds.
2. **Streaming everything**: LLM responses, file writes, and build logs all stream to the client via Server-Sent Events or WebSocket.
3. **Diff-based edits**: LLM outputs unified diffs, not full file rewrites, to minimize tokens and latency.
4. **Provider-agnostic LLM layer**: Vercel AI SDK abstracts OpenAI, Anthropic, Google — swap models per request.
5. **Docs-grounded generation**: All framework docs (React, Vite, Tailwind, shadcn) are pre-scraped and embedded — LLM always has accurate API references.

---

## Repository Structure (Monorepo)

```
/
├── apps/
│   ├── web/               # Next.js 14 frontend
│   └── api/               # FastAPI backend (Python)
├── packages/
│   ├── ai/                # Vercel AI SDK wrappers, prompts
│   ├── sandbox/           # Daytona + Modal client abstractions
│   ├── docs-scraper/      # Firecrawl + embedding pipeline
│   └── shared/            # Types, constants
├── templates/
│   └── react-vite-ts/     # Base template repo (pre-npm-installed snapshot)
├── infra/
│   ├── modal/             # Modal app definitions
│   └── daytona/           # Daytona workspace configs
└── docs/
    └── architecture/      # These phase files
```

---

## Technology Decisions Summary

| Concern | Choice | Reason |
|---------|--------|--------|
| Frontend framework | Next.js 14 (App Router) | RSC, streaming, file-based routing |
| LLM orchestration | Vercel AI SDK | Multi-provider, streaming, tool use |
| Primary sandbox | Daytona | Workspace snapshots, persistent FS |
| Compute sandbox | Modal | Serverless GPU/CPU, port tunnels |
| Doc scraping | Firecrawl | Clean markdown output, JS rendering |
| Database | Supabase (PostgreSQL) | Auth + DB + realtime built-in |
| Vector DB | pgvector (via Supabase) | Co-located with main DB |
| Cache / pub-sub | Upstash Redis | Serverless, edge-compatible |
| Deployment | Vercel (frontend) + Modal (backend compute) | Zero-ops |

---

## Phases Overview

| Phase | Title |
|-------|-------|
| 01 | Project Overview & System Architecture (this file) |
| 02 | Tech Stack & Dependency Manifest |
| 03 | Sandbox Infrastructure — Daytona Deep Dive |
| 04 | Sandbox Infrastructure — Modal Deep Dive |
| 05 | Template Repo & Snapshot Strategy |
| 06 | LLM Integration via Vercel AI SDK |
| 07 | AI Prompt Engineering & Code Generation Pipeline |
| 08 | Frontend Shell & Design System |
| 09 | Chat Interface & Streaming UI |
| 10 | Code Editor & File Tree UI |
| 11 | Live Preview — Port Forwarding & Iframe |
| 12 | Backend API Design |
| 13 | Authentication & User Management |
| 14 | Project & File Storage |
| 15 | Firecrawl Integration & Doc Scraping |
| 16 | RAG Pipeline — Embeddings & Retrieval |
| 17 | Real-time — WebSockets & Build Log Streaming |
| 18 | Deployment & Publishing Flow |
| 19 | Observability, Logging & Analytics |
| 20 | Roadmap & Future Enhancements |
