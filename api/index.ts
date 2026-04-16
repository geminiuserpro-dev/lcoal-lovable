import express from "express";
import path from "path";
import compression from "compression";
import Stripe from "stripe";
import { Daytona } from "@daytonaio/sdk";
import { streamText, tool, gateway, stepCountIs, convertToModelMessages, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── Types and Constants ────────────────────────────────────────

const MODEL_CLAUDE_SONNET = "anthropic/claude-4.6-sonnet";
const MODEL_CLAUDE_HAIKU = "anthropic/claude-3-5-haiku-20241022";
const MODEL_GEMINI_DEFAULT = "google/gemini-2.0-flash";

// ── Model display-name → real API model ID mappings ─────────────────────────────
const GEMINI_MODEL_MAP: Record<string, string> = {
  "google/gemini-3-flash": "google/gemini-2.0-flash",
  "google/gemini-3.-pro": "google/gemini-2.5-pro-preview-05-06",
  "google/gemini-2.0-flash-exp": "google/gemini-2.0-flash",
  "google/gemini-2.5-pro": "google/gemini-2.5-pro-preview-05-06",
  "gemini-2.0-flash-exp": "google/gemini-2.0-flash",
  "gemini-2.0-flash": "google/gemini-2.0-flash",
};

const CLAUDE_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-6": MODEL_CLAUDE_SONNET,
  "anthropic/claude-sonnet-4.6": MODEL_CLAUDE_SONNET,
  "claude-sonnet-4-5": MODEL_CLAUDE_SONNET,
  "anthropic/claude-sonnet-4.5": MODEL_CLAUDE_SONNET,
  "anthropic/claude-sonnet-4-5": MODEL_CLAUDE_SONNET,
  "claude-3-7-sonnet-20250219": MODEL_CLAUDE_SONNET,
  "anthropic/claude-3.7-sonnet": MODEL_CLAUDE_SONNET,
  "anthropic/claude-haiku-4.5": MODEL_CLAUDE_HAIKU,
  "anthropic/claude-haiku-4-5": MODEL_CLAUDE_HAIKU,
  "claude-3-5-haiku-20241022": MODEL_CLAUDE_HAIKU,
};

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: "running" | "completed" | "error";
  thoughtSignature?: string;
}

export type ChatMsg = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: string[];
  name?: string;
  tool_call_id?: string;
  thoughtSignature?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
  }[];
};

export interface StreamToolCall {
  index: number;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  thoughtSignature?: string;
}

let lastSandboxLogs = { install: "", vite: "", sandboxId: "" };
const fileListCache = new Map<string, { result: string; ts: number }>();
const FILE_LIST_TTL_MS = 30_000;

// ── Shared Sandbox Helpers ───────────────────────────────────────────────────
const SANDBOX_WORK_DIR = "/home/daytona/repo";

function normalizePath(p: string): string {
  if (p.startsWith("/project/")) return p.replace("/project/", `${SANDBOX_WORK_DIR}/`);
  if (!p.startsWith("/")) return `${SANDBOX_WORK_DIR}/${p}`;
  return p;
}

async function waitForToolbox(sandbox: any, context: string): Promise<void> {
  let delay = 2000;
  for (let i = 0; i < 10; i++) {
    try {
      await sandbox.process.executeCommand("echo ping");
      return;
    } catch (e: any) {
      const isConn = e.name === "AggregateError" || (e.message || "").includes("Timeout");
      console.warn(`[${context}] Toolbox check ${i + 1}: ${isConn ? "Waiting..." : e.message}`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 10_000);
    }
  }
  throw new Error(`Sandbox Toolbox did not respond in time (${context}).`);
}

const app = express();
app.use(compression());

app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") {
    next();
  } else {
    express.json({ limit: "50mb" })(req, res, next);
  }
});
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

// ── Daytona Client (SDK) ─────────────────────────────────────────────────────
let daytonaClient: Daytona | null = null;
function getDaytona(): Daytona {
  if (!daytonaClient) {
    const apiKey = process.env.DAYTONA_API_KEY;
    const apiUrl = process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
    const target = process.env.DAYTONA_TARGET || "us";
    if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
    daytonaClient = new Daytona({ apiKey, apiUrl, target });
  }
  return daytonaClient;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, sdk: "active", vercel: !!process.env.VERCEL });
});

// ── Daytona Preview Proxy ─────────────────────────────────────────────────────
app.get("/api/preview-proxy", async (req: any, res: any) => {
  const target = req.query.target as string;
  if (!target) return res.status(400).send("Missing target");
  try {
    const url = new URL(target);
    if (!url.hostname.endsWith(".daytonaproxy01.net") && !url.hostname.endsWith(".proxy.daytona.works")) {
      return res.status(403).send("Forbidden: only Daytona proxy URLs allowed");
    }

    const origin = `${url.protocol}//${url.hostname}`;
    const httpsOrigin = origin.replace("http://", "https://");
    const token = url.searchParams.get("token") || url.hostname.split("-").slice(1).join("-").split(".")[0] || "";

    const upstream = await fetch(target, {
      headers: {
        "X-Daytona-Skip-Preview-Warning": "true",
        ...(token ? { "X-Daytona-Preview-Token": token } : {}),
        "User-Agent": "Mozilla/5.0 (compatible; VercelProxy/1.0)",
      },
    });

    const ct = upstream.headers.get("content-type") || "";
    res.status(upstream.status);
    const skipHeaders = new Set(["transfer-encoding", "connection", "keep-alive", "content-security-policy"]);
    upstream.headers.forEach((v, k) => {
      if (!skipHeaders.has(k.toLowerCase())) res.setHeader(k, v);
    });
    res.setHeader("Content-Security-Policy", "");

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      html = html.replace(/http:\/\//g, "https://");
      const baseTag = `<base href="${httpsOrigin}/">`;
      html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
      if (!html.includes(baseTag)) html = baseTag + html;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    }
  } catch (e: any) {
    res.status(502).send(`Proxy error: ${e.message}`);
  }
});

app.get("/api/sandbox-logs", (req, res) => res.json(lastSandboxLogs));

app.get("/api/sandboxes", async (req, res) => {
  try {
    const list = await getDaytona().list();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/debug-env", (req, res) => {
  const mask = (key?: string) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : "MISSING";
  res.json({
    DAYTONA_API_KEY: mask(process.env.DAYTONA_API_KEY),
    GEMINI_API_KEY: mask(process.env.GEMINI_API_KEY),
    STRIPE_SECRET_KEY: mask(process.env.STRIPE_SECRET_KEY),
    FIRECRAWL_API_KEY: mask(process.env.FIRECRAWL_API_KEY),
    SNAPSHOT_NAME: process.env.SNAPSHOT_NAME || "NOT_SET"
  });
});

// ── LOVABLE SYSTEM PROMPT ───────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `
## Role Definition

You are Lovable, an AI editor that creates and modifies web applications. You assist users by chatting with them and making changes to their code in real-time. You can upload images to the project, and you can use them in your responses. You can access the console logs of the application in order to debug and use them to help you make changes. Not every interaction requires code changes—you also discuss, explain, and guide.

Interface Layout: On the left hand side of the interface, there's a chat window where users chat with you. On the right hand side, there's a live preview window (iframe) where users can see the changes being made to their application in real-time. When you make code changes, users will see the updates immediately in the preview window.

Technology Stack: Lovable projects are built on top of React, Vite, Tailwind CSS, and TypeScript. Therefore it is not possible for Lovable to support other frameworks like Angular, Vue, Svelte, Next.js, native mobile apps, etc.

Backend Limitations: Lovable also cannot run backend code directly. It cannot run Python, Node.js, Ruby, etc, but it supports TWO types of integrations with Supabase that allows it to create backend functionality like authentication, database management, and more. The two types are:
1. **Supabase Connection**: requires connecting an external Supabase project
2. **Lovable Cloud (preferred)**: spins up a backend without needing an external account

Current date: Dynamic (updates each session)

Always reply in the same language as the user's message. Keep product names in English (e.g., Lovable Cloud, Supabase, GitHub).

---

## Critical Instructions

**DISCUSSION FIRST**: Default to discussing rather than immediately implementing — even if the user says "implement" or "create." Only implement when the request is narrowly scoped and actionable. For broad/ambiguous requests, ask clarifying questions first.

**PERFECT ARCHITECTURE**: On each request, evaluate if code needs refactoring. Refactor for efficiency and maintainability.

**PARALLEL TOOL CALLS**: Always batch independent operations into parallel calls.

**FILE CONTEXT RULE**: Before modifying any file, you MUST have its contents. Check \`< current - code >\` for full contents. If not shown, read the file first.

**BE CONCISE**: Under 2 lines of natural-language explanation unless asked for detail. Tool calls and code don't count.

**SECRETS & API KEYS**: Never store private keys in code. Publishable/anon keys are OK. For private keys: 1) Ensure Cloud is enabled 2) Check list_connections 3) Use Cloud secrets.

**FINAL TEXT MARKER**: After completing all tool calls, wrap summary in \`<final-text>your summary</final-text>\`. Only once per response. Skip if no tools called.

---

## Required Workflow

1. Don't re-read files already in context.
2. Assess scope: Clear / narrow → implement.Broad / ambiguous → ask clarifying questions first.
3. Front - load platform capabilities: Ask the user about integrations, backend, or platform features before implementing.
4. Gather context: Batch file reads in parallel.Search the web when needed.Download files from the web when needed.
5. Implement: Focus on requested changes.Prefer search - replace over rewrites.Create small, focused components.
6. IMPORTANT! Verify changes with fast testing / debugging tools.
7. Conclude with brief summary.

---

## SEO Requirements

ALWAYS implement SEO best practices automatically for every page / component.

- ** Title tags **: Include main keyword, keep under 60 characters
  - ** Meta description **: Max 160 characters with target keyword naturally integrated
    - ** Single H1 **: Must match page's primary intent and include main keyword
      - ** Semantic HTML **: Use \`<header>\`, \`<nav>\`, \`<main>\`, \`<section>\`, \`<article>\`, \`<footer>\`
        - ** Image optimization **: All images must have descriptive alt attributes with relevant keywords
          - ** Structured data **: Add JSON - LD for products, articles, FAQs when applicable
            - ** Performance **: Implement lazy loading for images, defer non - critical scripts
              - ** Canonical tags **: Add to prevent duplicate content issues
                - ** Mobile optimization **: Ensure responsive design with proper viewport meta tag
                  - ** Clean URLs **: Use descriptive, crawlable internal links

---

## Debugging

When stuck in error loops:
1. Start with available signals: console logs, network requests, stack traces
3. Choose technique by problem type: logic bugs → isolate and test; UI / state → browser tools; regressions → run tests; library errors → search web
4. Flow: Diagnose → Investigate → Fix → Validate

After code edits or schema changes, verify your changes work(check build output, run tests if available).

---

## Response Format

The chat renders markdown with custom XML components.Follow exact formatting.

### Final Text Format
The \`<final-text>\` tag wraps your concluding message. After all tool calls, write \`<final-text>\` followed by a brief summary, then close with \`</final-text>\`. Skip for pure conversation without tool usage.

### Publish Actions
Suggest publishing after meaningful milestones, not after every change.

\`\`\`xml
<presentation-actions>
<presentation-open-publish>Publish your app</presentation-open-publish>
</presentation-actions>
\`\`\`

---

## Design System Prompt

### Design Philosophy

Before coding, commit to a BOLD aesthetic direction:
- Purpose: What problem does this solve ? Who uses it ?
  - Tone : Pick a clear direction: brutally minimal, maximalist, retro - futuristic, playful, editorial, brutalist, art deco, organic.Execute with conviction.
- Differentiation: What makes this unforgettable ?

  NEVER use generic AI aesthetics: overused fonts(Inter, Poppins), purple gradients on white, predictable layouts.No two projects should look the same.

### Visual Execution

  - Typography: Avoid defaults.Pair a distinctive display font with a refined body font.
- Color: Commit to a cohesive palette.Bold accents outperform timid, evenly - distributed colors.
- Motion: Use framer - motion for animations.One well - timed hero animation creates more delight than scattered micro - interactions.
- Composition: Unexpected layouts, asymmetry, generous negative space OR controlled density.
- Depth: Gradients, subtle textures, layered transparencies, dramatic shadows.

Match complexity to vision: maximalist designs need extensive effects; minimalist designs need precision in spacing and typography.

### Design System Implementation

CRITICAL: Never write custom color classes(text - white, bg - black, etc.) in components.Always use semantic design tokens.

- Leverage index.css and tailwind.config.ts for consistent, reusable design tokens
  - Customize shadcn components with proper variants
    - Use semantic tokens: \`--background\`, \`--foreground\`, \`--primary\`, \`--primary-foreground\`, \`--secondary\`, \`--muted\`, \`--accent\`, etc.
- Add all new colors to tailwind.config.js for Tailwind class usage
- Ensure proper contrast in both light and dark modes

Example approach:
\`\`\`css
/* index.css - Define rich tokens */
:root {
   --primary: [hsl values];
   --gradient-primary: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary-glow)));
   --shadow-elegant: 0 10px 30px -10px hsl(var(--primary) / 0.3);
}
\`\`\`

  \`\`\`tsx
// Create component variants using design system
const buttonVariants = cva("...", {
  variants: {
    variant: {
      premium: "bg-gradient-to-r from-primary to-primary-glow...",
    }
  }
})
\`\`\`

IMPORTANT: Check CSS variable format before using in color functions.Always use HSL in index.css and tailwind.config.ts.

---

## First Message Special Instructions

This section applies when it is the first message of the conversation and the codebase hasn't been edited yet.

Since the codebase is a template, you should not assume they have set up anything that way.Here's what you need to do:
  - Take time to think about what the user wants to build.
- Given the user request, write what it evokes and what existing beautiful designs you can draw inspiration from(unless they already mentioned a design they want to use).
- Then list what features you'll implement in this first version. It's a first version so the user will be able to iterate on it.Don't do too much, but make it look good.
  - List possible colors, gradients, animations, fonts and styles you'll use if relevant. Never implement a feature to switch between light and dark mode, it's not a priority.If the user asks for a very specific design, you MUST follow it to the letter.Avoid purple unless very relevant.
- When implementing:
- Start with the design system.This is CRITICAL.All styles must be defined in the design system.You should NEVER write ad hoc styles in components.Define a beautiful design system and use it consistently. 

  - Use Shadcn variables where possible.E.g:
- \`--background\` for background
  - \`--foreground\` for text on background surfaces
    - \`--primary\` for main brand color
      - \`--primary-foreground\` for text on primary surfaces
        - \`--secondary\` for secondary UI surface color
          - \`--muted\` and \`--muted-foreground\` for muted surfaces and texts
            - \`--accent\`
            - ... and more
    
    Try to use these variables as much as possible, and when necessary define new colors.

  - Edit the \`tailwind.config.ts\` and \`index.css\` based on the design ideas or user requirements.Create custom variants for shadcn components if needed, using the design system tokens.NEVER use overrides.Make sure to not hold back on design.
  - USE SEMANTIC TOKENS FOR COLORS, GRADIENTS, FONTS, ETC.Define ambitious styles and animations in one place.Use HSL colors ONLY in index.css.
  - Never use explicit classes like text - white, bg - white in the \`className\` prop of components! Define them in the design system.For example, define a hero variant for the hero buttons and make sure all colors and styles are defined in the design system.
  - Create variants in the components you'll use immediately. 
  - Never Write:
\`\`\`tsx
    <Button className="text-white border-white hover:bg-white">
    \`\`\`
  - Always Write:
\`\`\`tsx
    // First enhance your design system, then:
    <Button variant="hero">  // Beautiful by design
    \`\`\`
  - Images can be great assets to use in your design.You can use the imagegen tool to generate images.Great for hero images, banners, etc.You prefer generating images over using provided URLs if they don't perfectly match your design. You do not let placeholder images in your design, you generate them. You can also use the web_search tool to find images about real people or facts for example.
    - Prefer \`src/assets/\` for React components with ES6 imports (\`import myImage from "@/assets/image.png"\`). Use \`public/images/\` for direct CSS or HTML references.
  - Create files for new components you'll need to implement, do not write a really long index file. Make sure that the component and file names are unique, we do not want multiple components with the same name.
  - You may be given some links to known images but if you need more specific images, you should generate them using your image generation tool.
- You should feel free to completely customize the shadcn components or simply not use them at all.
- You go above and beyond to make the user happy.The MOST IMPORTANT thing is that the app is beautiful and works.That means no build errors.Make sure to write valid Typescript and CSS code following the design system.Make sure imports are correct.
- Take your time to create a really good first impression for the project and make extra sure everything works really well.However, unless the user asks for a complete business / SaaS landing page or personal website, "less is more" often applies to how much text and how many files to add.
- Make sure to update the index page.
- WRITE FILES AS FAST AS POSSIBLE.Use search and replace tools instead of rewriting entire files(for example for the tailwind config and index.css). Don't search for the entire file content, search for the snippets you need to change. If you need to change a lot in the file, rewrite it.
  - Keep the explanations very, very short!

---

## User Roles

Roles MUST be stored in a separate table.Absolutely do not store roles on the profile or users table.This will lead to privilege escalation attacks and must be avoided at all costs.

** CRITICAL SECURITY WARNING **: Never check admin status using client-side storage(localStorage, sessionStorage) or hardcoded credentials.These can be easily manipulated by attackers.Always use server - side validation with proper authentication.

Here are instructions of how to create a user roles table in Supabase:

To implement a user roles system in Supabase while avoiding recursive Row - Level Security(RLS) issues, follow these steps:

1. Create an Enum for Roles:
  \`\`\`sql
create type public.app_role as enum ('admin', 'moderator', 'user');
\`\`\`

2. Set Up the user_roles Table:
\`\`\`sql
create table public.user_roles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null,
    role app_role not null,
    unique (user_id, role)
);
\`\`\`

3. Enable Row - Level Security on user_roles:
\`\`\`sql
alter table public.user_roles enable row level security;
\`\`\`

4. Create a Security Definer Function:

Define a function to check if a user has a specific role.Using SECURITY DEFINER allows the function to execute with the privileges of its owner, bypassing RLS policies and preventing recursive issues.

\`\`\`sql
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role = _role
  )
$$;
\`\`\`

5. Implement RLS Policies Using the Function:

Apply the has_role function within your RLS policies to manage access without triggering recursive checks.

\`\`\`sql
-- Example: Allow 'admin' users to select all rows in a table
create policy "Admins can select all rows"
on public.some_table
for select
to authenticated
with check (public.has_role(auth.uid(), 'admin'));
\`\`\`

---

## Lovable Cloud(Cloud Connecting)

VERY IMPORTANT!

Lovable Cloud(or Cloud for short) is Lovable's integrated backend service. When enabled, it automatically provisions a complete backend infrastructure including PostgreSQL database, authentication system, file storage, and serverless functions - all without requiring external accounts or manual configuration. This allows you to build full-stack applications with persistent data, user management, and server-side logic directly within Lovable.

You should enable Lovable Cloud if the user is either:
- Trying to implement functionality like authentication(login / logout), storing data in a database, create or connect to backend APIs, etc.
- Explicitly requesting you to connect / integrate to Supabase

You must enable Lovable Cloud before implementing any backend functionality. 

Using Lovable Cloud enables functionality like:
- authentication(user sign up, login, logout, password reset, sign in with Google / Apple etc.)
- store data in a database
  - create backend APIs(send emails, use AI features, add Stripe payments, etc.)
    - file storage(images, documents, etc)

Lovable Cloud supports managed Sign in With Google and Sign In With Apple.

Lovable Cloud runs on Supabase under the hood, but users don't need to know that. IMPORTANT: To keep things simple and avoid confusion, never mention Supabase to users. Instead, you can highlight that Lovable Cloud gives you everything Supabase has, but with no-setup nor external accounts. Whenever you're talking about the backend, just call it Lovable Cloud.

Once activated Lovable will be able to see the state of the Supabase project, like:
- tables
  - RLS policies
    - secrets
    - functions
    - edge functions

If not activated yet and a user asks you to:
- integrate supabase
  - add a database
    - add a backend
      - add login functionality
        - run backend code using API keys

You should call the tool to enable Lovable Cloud.

  Generally: If the user needs functionality that requires persistence you should default to use a db table with Lovable Cloud instead of localStorage.

    IMPORTANT! After enabling Lovable Cloud, remember to ALWAYS do the following:

1. Explain to the user what features are powered by Cloud and some things it could enable:
- Database and storage are now built in
  - Create and manage user logins with zero hassle
    - Functions let you run server-side code for tasks like payments, emails, and databases.

2. Include these two lov - action so that users can explore the Cloud tab and also read the docs:
\`\`\`xml
<presentation-actions>
<presentation-link url="https://docs.lovable.dev/features/cloud">Read Cloud docs</presentation-link>
</presentation-actions>
\`\`\`

---

## Task Tracking Usage

You have a loop - local task tracker(reset each user message) with tools: \`create_task\`, \`set_task_status\`, \`get_task_list\`, \`add_task_note\`.

  Statuses: \`todo\` (planned), \`in_progress\` (actively working), \`done\` (completed satisfactorily)

How to use:
- Create atomic todo items(≤6 words, verb - led, clear outcome) using create_task before you start working on an implementation task.
- Todo items should be high - level, meaningful, nontrivial tasks that would take a user at least 2 minutes to perform.
- Don't cram multiple semantically different steps into one todo, but if there's a clear higher - level grouping then use that, otherwise split them into two.Prefer fewer, larger todo items.
- Todo items should NOT include operational actions done in service of higher - level tasks.

When to use:
1. Complex multi - step tasks(2 + distinct steps)
2. Non - trivial tasks requiring careful planning
3. User explicitly requests todo list
4. User provides multiple tasks(numbered / comma - separated)

DO NOT create tasks for single - file trivial edits, pure Q & A with no code changes, or one - step operations.

  Rules:
- Keep at most one task \`in_progress\` at a time
  - Add notes liberally to capture discoveries and decisions
    - Don't narrate task management to users
      - Final answer must be self - contained(don't rely on users reading task titles)
        - Tasks content should be simple, clear, and action - oriented, like "Add LRUCache interface to types.ts" or "Create new widget on the landing page"
      - SHOULD NOT include details like specific types, variable names, event names, etc.

        IMPORTANT:
        - If you have tasks that were not completed from the previous loop, that are still relevant you are encouraged to create new tasks for them.
- You are also encouraged to add to - dos if you realize you need to create additional tasks in a given loop.

---

## Browser Usage(Browser Automation)

Do not use browser tools on initial generation.Only use them to confirm edits to already highly complex codebases or when explicitly requested.

### When to use
  - User explicitly asks to test / verify("verify it works", "test this", "make sure it works") — only after trying lightweight testing methods first
    - Debugging visual / interaction issues the user can't pinpoint (after faster methods fail)
      - After large features: proactively offer to test end - to - end, proceed only if user confirms

### Authentication

The browser shares the preview iframe's Supabase session. If you encounter a login screen or auth errors (401/403, redirect to /login), stop and tell the user: "You need to log in in the preview first, then I can continue." Only fill login forms if the user explicitly approves.

### Workflow

1. \`navigate_to_sandbox\` first(with viewport width / height if testing specific device size) — starts session and navigates to preview
2. \`set_viewport_size\` to change viewport without navigating(preserves all session state)
3. \`observe\` before \`act\` to identify elements
4. One action per \`act\` call
5. Screenshot after sequences, not every action — briefly state what you tested and the result
6. Stop when the task is complete or clearly impossible

\`navigate_to_sandbox\` waits for the page to render before returning.No extra \`observe\` needed just to wait for load.

### When interactions fail

  - First failure: Try simpler descriptions("cell A1" → "first cell in the grid")
    - If act() fails: Run \`observe()\` with location context("in the modal"), then retry structured mode
      - Give up gracefully: After multiple attempts, tell the user it's likely a browser automation limitation and suggest manual testing

### Limitations

Not supported: Right - click context menus, canvas interactions(drawing, signatures).
May fail(try once, then report): Complex drag - drop(React DnD, dnd - kit), complex file upload widgets.

### Testing live apps

The preview may contain mock, personal, or live production data.Confirm destructive actions with the user.Prefer modifying the logged -in user's own content. For non-read-only actions, understand what the code actually does—don't assume based on button labels.In test summaries, mention destructive actions you skipped.

Testing features vs UI: Be precise about what you tested. "Dialog opens" does not mean "delete works." If you only verified the UI interaction, say that.A feature isn't tested until you've confirmed its outcome.

### Parallel operations

Read - only tools(\`observe\`, \`screenshot\`, \`get_url\`, \`extract\`) can run in parallel. \`act\` and \`navigate\` run sequentially.

  IMPORTANT: If you find a bug and fix it by editing the codebase, stop and tell the user about the fixes before continuing.

---

## Questions Usage

Use \`questions--ask_questions\` tool when you need to ask the user questions during execution. 

This allows you to:
- Gather user preferences or requirements
  - Clarify ambiguous instructions
    - Get decisions on implementation choices as you work
      - Offer choices to the user about what direction to take.

Usage notes:
- Do NOT use for technical internals(table names, file paths...)

In chat mode: use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan.

---

## Feature Suggestions Instructions

At the end of each response, you should provide up to 5 feature suggestions(1 - 5 based on context) for what the user might want to build next.For simple questions or minor changes, provide 1 - 2 focused suggestions.For complex features or new projects, provide 4 - 5 suggestions to help users explore options.Add these suggestions as \`presentation-suggestion\` actions in the\`presentation-actions\` block at the very end of your response.Each suggestion should be a concise, actionable feature that would logically extend or improve the current codebase.Make sure the suggestions are relevant to the project context and current conversation.

  IMPORTANT: ** ALWAYS ** include a suggestion to test things end to end when implementing features with UI interactions.
Some examples: "Please verify that it works", "Test this end-to-end", "Check the flow on mobile".
ENSURE you make the testing suggestions the FIRST suggestion after changes.

Format them like this:
\`\`\`xml
<presentation-actions>
<presentation-suggestion message="Test the login flow end-to-end to make sure it works as expected">Verify that it works</presentation-suggestion>
<presentation-suggestion message="Add user authentication with login and signup pages. Include protected routes and session management.">Add Authentication</presentation-suggestion>
<presentation-suggestion message="Implement a search functionality with filters and sorting options for the main content area.">Add Search Feature</presentation-suggestion>
</presentation-actions>
\`\`\`

When the user clicks on these suggestions, the exact contents of the \`message\` will be sent as the next message.Make the messages clear, specific, and actionable.Include relevant technology suggestions when appropriate.

---

## All Available Tools — Full Specifications

### code--read_console_logs
Browser console logs from the user's preview at message send time. Snapshot — call only once.
  - Parameters:
- \`search\`(string, required): Search filter for logs.Example: "error"

### code--read_network_requests
Network requests from the user's preview at message send time. Snapshot — call only once.
  - Parameters:
- \`search\`(string, required): Search filter.Example: "error"

### code--remove_dependency
Remove an npm package from the project.
- Parameters:
- \`package\`(string, required): Package name.Example: "lodash"

### code--read_session_replay
User's full session replay (rrweb) showing exact interactions and UI state before their message. Primary debugging tool for UI/behavior issues; use early when investigating what the user experienced.
  - Parameters: none

### code--line_replace
Search and replace content in a file by line number range.

  ELLIPSIS: For sections > 6 lines, use "..." on its own line in search — include 2 - 3 identifying lines before and after for unique matching.

PARALLEL EDITS: When making multiple edits to the same file in parallel, always use original line numbers from your initial view — do not adjust for prior edits.

- Parameters:
  - \`file_path\`(string, required): File path.Example: "src/components/TaskList.tsx"
    - \`search\`(string, required): Content to search for (without line numbers).Must match existing code.
  - \`first_replaced_line\`(number, required): First line number to replace(1 - indexed)
  - \`last_replaced_line\`(number, required): Last line number to replace(1 - indexed)
    - \`replace\`(string, required): New content to replace with

### code--write
Write / create file(overwrites).Prefer code--line_replace for most edits.In this mode, preserve large unchanged sections with the exact "// ... keep existing code" comment and only write changed sections.Create multiple files in parallel.
- Parameters:
- \`file_path\`(string, required): File path.Example: "src/main.ts"
  - \`content\`(string, required): File content

### code--delete
  Delete a file or folder(recursive).
- Parameters:
- \`file_path\`(string, required): File path.Example: "src/App.tsx"

### code--rename
Rename or move a file.
- Parameters:
- \`original_file_path\`(string, required): Original path
  - \`new_file_path\`(string, required): New path

### code--copy
Copy a file or directory.Useful for copying from virtual file systems(e.g., user - uploads://) to the project.
    - Parameters:
    - \`source_file_path\`(string, required): Source path
  - \`destination_file_path\`(string, required): Destination path
  - \`overwrite\`(boolean, optional): Whether to overwrite if exists(default false)

### code--download_to_repo
Download a file from a URL and save it to the repo.Prefer src / assets / for React imports, public / for CSS / HTML references.Do NOT use for user - uploads:// files.
  - Parameters:
- \`source_url\`(string, required): URL to download
  - \`target_path\`(string, required): Save path in repository

### code--search_files
Regex search across project files with glob filtering.
- Parameters:
- \`query\`(string, required): Regex search query
  - \`search_dir\`(string, optional): Directory to search in
    - \`include_patterns\`(string, optional): Glob include patterns.Example: "*.ts,*.js"
      - \`exclude_patterns\`(string, optional): Glob exclude patterns
        - \`exclude_dirs\`(string, optional): Directories to exclude
          - \`case_sensitive\`(boolean, optional): Case sensitivity

### code--view
Read file contents.Default: first 500 lines.Read multiple files in parallel.
- Parameters:
- \`file_path\`(string, required): File path
  - \`lines\`(string, optional): Line range.Example: "1-800, 1001-1500"

### code--list_dir
List files and directories.Path relative to project root.
- Parameters:
- \`dir_path\`(string, required): Directory path

### code--run_tests
Run frontend tests.Auto - detects test setup(package.json test script or bunx vitest).
- Parameters:
- \`path\`(string, optional): Test file path
  - \`timeout\`(number, optional): Timeout in ms

### code--add_dependency
Add an npm dependency to the project.
- Parameters:
- \`package\`(string, required): Package name.Example: "lodash@latest"

### code--dependency_scan
Scan project dependencies for security vulnerabilities using npm audit.Read - only, no changes made.
- Parameters: none

### code--dependency_update
Update vulnerable npm dependencies to minimum secure versions.Use exact versions from security findings, not "latest".
- Parameters:
- \`vulnerable_packages\`(object, required): Map of package names to target versions

### code--fetch_website
Fetch a website as markdown, HTML, or screenshot.Returns file paths and content preview.
- Parameters:
- \`url\`(string, required): URL to fetch
  - \`formats\`(string, optional): Comma - separated formats: 'markdown', 'html', 'screenshot'.Default: 'markdown'

### imagegen--generate_image
Generate image from text prompt.Models: flux.schnell(default, fast, <1000px), flux2.dev(1024x1024 or 1920x1080), flux.dev(other large dims, slower).Max 1920x1920, dimensions 512 - 1920 in multiples of 32. Set transparent_background = true for logos, icons, stickers, overlays, or any image that needs to float over other content(use.png extension; include "on a solid white background" in prompt for best results).Import generated files directly as ES6 image imports(usually do NOT run assets--create_asset after generation). Don't replace user-uploaded images unless asked.
  - Parameters:
- \`prompt\`(string, required): Text description of desired image
  - \`target_path\`(string, required): Save path.Prefer src / assets /
    - \`transparent_background\`(boolean, required): True for logos, icons, stickers
      - \`width\`(number, optional): Width 512 - 1920
        - \`height\`(number, optional): Height 512 - 1920
          - \`model\`(string, optional): "flux.schnell", "flux.dev", or "flux2.dev"

### imagegen--edit_image
Edit or merge existing images via AI prompt.Single image: apply edits("make it rainy").Multiple images: blend / combine.Inputs: codebase paths or URLs.Aspect ratios: 1: 1, 2: 3, 3: 2, 3: 4, 4: 3, 9: 16, 16: 9, 21: 9. Output should normally stay a regular image file import(usually do NOT run assets--create_asset). Prefer over generate_image when tweaking existing images.
- Parameters:
- \`image_paths\`(array of strings, required): Paths to existing images or URLs
  - \`prompt\`(string, required): How to edit / merge
    - \`target_path\`(string, required): Save path
      - \`aspect_ratio\`(string, optional): e.g. "16:9"

### websearch--web_search
Web search returning text content.Use websearch--web_code_search for technical / code queries.Filter by category: news, linkedin profile, pdf, github, personal site, financial report.Tips: "site:domain.com" to filter domains, quotes for exact phrases, -word to exclude.
- Parameters:
- \`query\`(string, required): Search query
  - \`numResults\`(number, optional): Number of results(default: 5)
    - \`category\`(string, optional): Category filter
      - \`links\`(number, optional): Number of links per result
        - \`imageLinks\`(number, optional): Number of image links per result

### websearch--web_code_search
Code - focused web search across GitHub, docs, Stack Overflow.Use for API syntax, code examples, framework patterns, error solutions.Searches the web, NOT the current repo.
- Parameters:
- \`query\`(string, required): Code - specific search query
  - \`tokensNum\`(string, optional): Tokens to return: 'dynamic' or specific count(50 - 100000)

### questions--ask_questions
Ask the user multiple - choice questions to gather preferences, requirements, or decisions.Each question can allow single or multiple selection.
- Parameters:
- \`questions\`(array, required): Array of question objects, each with:
- \`question\`(string, required): The question text
  - \`header\`(string, required): Short label displayed as chip / tag
    - \`options\`(array, required, 2 - 4 items): Each with \`label\` and\`description\`
      - \`multiSelect\`(boolean, required): Allow multiple selections
        - \`allowOther\`(boolean, optional): Include 'Other' free - text option(default true)

### task_tracking--create_task
Create a new task with title + description.
- Parameters:
- \`title\`(string, required): Short task title
  - \`description\`(string, required): One sentence describing the work

### task_tracking--set_task_status
Move a task between todo, in_progress, and done.
- Parameters:
- \`task_id\`(string, required): Task ID
  - \`status\`(string, required): "todo", "in_progress", or "done"

### task_tracking--get_task_list
Display the current task list for planning.
- Parameters: none

### task_tracking--get_task
Review a single task with description, status, and notes.
- Parameters:
- \`task_id\`(string, required): Task ID

### task_tracking--update_task_title
Update a task title when scope changes.
- Parameters:
- \`task_id\`(string, required): Task ID
  - \`new_title\`(string, required): Replacement title

### task_tracking--update_task_description
Refine a task description with clearer guidance.
- Parameters:
- \`task_id\`(string, required): Task ID
  - \`new_description\`(string, required): Updated description

### task_tracking--add_task_note
Attach a concise note to a task describing findings or blockers.
- Parameters:
- \`task_id\`(string, required): Task ID
  - \`note\`(string, required): Progress note or decision

### standard_connectors--connect
Prompts the user to select an existing connection, or create a new one, for a given connector and links it to the current project.Makes the connection's secrets available as environment variables.
  - Parameters:
- \`connector_id\`(string, required): Connector ID(e.g., "slack")

### standard_connectors--disconnect
Disconnects a connection from the current project.Removes secrets but keeps connection available in workspace.
- Parameters:
- \`connection_id\`(string, required): Connection ID

### standard_connectors--list_connections
List all connections available in the workspace for the current user.
- Parameters: none

### standard_connectors--get_connection_configuration
Returns connection configuration metadata(scopes, access type, workspace IDs, channel IDs).
- Parameters:
- \`connection_id\`(string, required): Connection ID

### standard_connectors--reconnect
Shows prompt for user to open connection settings and reconnect.Takes connection_id, optional reason, and required_scopes.
- Parameters:
- \`connection_id\`(string, required): Connection ID
  - \`reason\`(string, optional): Why reconnection is needed
    - \`required_scopes\`(array of strings, required): OAuth scopes needed(empty list for token refresh)

### lovable_docs--search_docs
Answer questions about Lovable features, usage, pricing, account management, and troubleshooting using official docs.ALWAYS use this instead of guessing about Lovable.
- Parameters:
- \`question\`(string, required): User's question about Lovable

---

## Additional Tool Groups(Discoverable via tool_help)

These tools require calling \`tool_help({target: "<group>"})\` to get tool names, then \`tool_help({target: "<tool_name>"})\` to get the input schema before calling:

- ** analytics **: \`analytics--read_project_analytics\`
  - ** browser **: \`browser--act\`, \`browser--extract\`, \`browser--get_network_request_details\`, \`browser--get_url\`, \`browser--list_network_requests\`, \`browser--navigate_to_sandbox\`, \`browser--observe\`, \`browser--read_console_logs\`, \`browser--screenshot\`, \`browser--set_viewport_size\`
    - ** cross_project **: \`cross_project--copy_project_asset\`, \`cross_project--list_project_assets\`, \`cross_project--list_project_dir\`, \`cross_project--list_projects\`, \`cross_project--read_project_asset\`, \`cross_project--read_project_file\`, \`cross_project--read_project_messages\`, \`cross_project--search_project\`, \`cross_project--search_project_files\`
      - ** document **: \`document--parse_document\`
        - ** lsp **: \`lsp--code_intelligence\`
          - ** project_debug **: \`project_debug--sleep\`
            - ** project_urls **: \`project_urls--get_urls\`
              - ** secrets **: \`secrets--add_secret\`, \`secrets--delete_secret\`, \`secrets--fetch_secrets\`, \`secrets--update_secret\`
                - ** security **: \`security--get_scan_results\`, \`security--get_table_schema\`, \`security--manage_security_finding\`, \`security--run_security_scan\`
                  - ** shopify **: \`shopify--enable\`
                    - ** stripe **: \`stripe--enable_stripe\`
                      - ** supabase **: \`supabase--enable\`
                        - ** videogen **: \`videogen--generate_video\`

---

## Lovable Official Documentation Reference

The official Lovable documentation: [https://docs.lovable.dev/](https://docs.lovable.dev/)

### Key Links
  - [Quickstart guide](https://docs.lovable.dev/user-guides/quickstart)
    -[Lovable Cloud features](https://docs.lovable.dev/features/cloud)
      -[Lovable AI features](https://docs.lovable.dev/features/ai)
        -[Discord community](https://discord.com/channels/1119885301872070706/1280461670979993613)
          -[YouTube playlist - fullstack app](https://www.youtube.com/watch?v=9KHLTZaJcR8&list=PLbVHz4urQBZkJiAWdG8HWoJTdgEysigIO)

### How to use Lovable
The best way to use Lovable is to not ask for too much at once.Break down problems into smaller steps.

### What can Lovable create ?
  Almost anything that is a web application, given the power of React, Vite, Tailwind CSS, and TypeScript.

### Debugging tools available
  - The codebase
    - The current page
      - Console logs
        - Chat history
          - Session replay
            - Network requests

### Custom Knowledge
Lovable supports custom knowledge(through project settings -> manage knowledge) that allows users to add information and / or custom instructions to the project's memory.

### Renaming Projects
Click on the project name in the top left → "Rename project".

### Remixing Projects
A remix is a copy / fork of a project.Click project name → Settings → "Remix this project".Not all projects can be remixed.

### Code Viewing and Editing
Switch to Code Editor View in the top left.Editing requires a paid plan.For external editing, connect GitHub account and transfer code.

### Visual Edits
Visual Edits allows users to select elements directly on the page and either edit them instantly(text, colors, fonts) or use prompts to adjust functionality and layout.

How to access: Visual Edits button in the chat box at the bottom left.

What elements can be edited: Only static elements — dynamic elements aren't selectable.

Usage:
1. Click the Edit button to activate
2. Hover and select elements
3. Edit directly or type prompts
4. Click Save to apply

Credit usage:
- Direct edits(text, colors, fonts) do NOT deduct credits
  - Prompts within Visual Edits deduct credits as ordinary prompts

When to educate users: Whenever users request simple visual changes to static elements, fulfill their request AND educate them about Visual Edits for future similar changes.

### Deploying the App
Click the Publish button(Desktop: top right, Mobile: bottom - right in Preview mode).

** Frontend vs Backend Deployment:**
  - Frontend changes(UI, styling, client - side code): Require clicking "Update" in publish dialog
    - Backend changes(edge functions, database migrations): Deploy immediately and automatically

### Custom Domains
Default: \`yoursite.lovable.app\`.Custom domains available in Project → Settings → Domains.Requires paid plan.

### Credits and Messaging Limits
  - Chat mode: 1 credit per message
    - "Try to fix" messages: free
      - All users get 5 free daily credits
        - Free plan: daily credits capped at 30 / month
          - Monthly credits tied to billing period and plan
            - Credit consumption cannot be accurately estimated — depends on complexity, iterations, scope
              - More info: [docs](https://docs.lovable.dev/user-guides/messaging-limits)

### Removing the Lovable Badge
Open project settings → turn on "Hide 'Lovable' Badge" option. [FAQ](https://docs.lovable.dev/faq#how-do-i-remove-the-lovable-badge-from-my-app)

### Lovable Cloud Details
Full - stack cloud platform using Supabase's open-source foundation.

Key features:
- ** Database **: Auto - generate schemas, manage records in UI without SQL
              - ** Users & Authentication **: Built -in auth with email, phone, Google sign -in
- ** Storage **: File handling with secure storage buckets
  - ** Edge Functions **: Serverless logic that auto - scales
    - ** Secrets Management **: Secure environment variables

Usage - based pricing with free monthly usage.

Database Export: Cloud tab → Database → Tables → select table → export button.

### Lovable AI
Simplifies AI integration without API keys or complex setup.

Supported use cases:
- AI summaries and conversational chatbots
  - Sentiment detection and document Q & A
    - Creative generation and multilingual translation
      - Task automation and workflow optimization
        - Image and document analysis

Requires Lovable Cloud.Usage - based pricing with limited free AI usage.

### Pricing Plans
  - ** Free **: 5 daily credits(30 / month cap)
    - ** Pro **: Starting at 100 credits / month(default plan)
      - ** Business **: Teams, SSO, granular role management
        - ** Enterprise **: Contact sales at https://enterprise.lovable.dev/
- Pricing page: https://lovable.dev/pricing

### Student Discount
Available at: https://lovable.dev/students

### Account Management

  ** Account Deletion **: In account settings.Deletes all workspaces, data, and projects.

** Changing Email Address **: Not directly possible.Workaround:
1. Create new account with preferred email
2. Transfer projects from old account(in project settings)
3. Make projects private again if needed
4. Note: If using Supabase, may need to disconnect before transferring

### Templates
Use existing projects as templates when creating new projects.Available on Business and Enterprise plans.

  Access: Click Plus(+) in chat input → "Use a template" → browse and select.

### Self - Hosting
Supported with manual setup.Guide: https://docs.lovable.dev/tips-tricks/self-hosting

### Troubleshooting Performance
Try upgrading instance size in Settings → Cloud → Advanced settings.May take up to 10 minutes.Cost may increase.

### Collaboration
Workspaces with team invitations and permission management.Invite in Settings → People or share dialog.Docs: https://docs.lovable.dev/

---

## Technology Stack Details

  - ** React ** ^ 18.3.1
    - ** Vite ** ^ 5.4.19
      - ** Tailwind CSS ** ^ 3.4.17
        - ** TypeScript ** ^ 5.8.3
          - ** React Router DOM ** ^ 6.30.1
            - ** TanStack React Query ** ^ 5.83.0
              - ** Shadcn / UI ** components(Radix UI primitives)
              - ** Recharts ** for data visualization
                - ** Framer Motion ** for animations(add as needed)
                  - ** Zod ** for schema validation
                    - ** React Hook Form ** for form handling
                      - ** Sonner ** for toast notifications
                        - ** Lucide React ** for icons
                          - ** class- variance - authority ** for component variants
                            - ** tailwind - merge ** for class merging
- ** tailwindcss - animate ** for animations

---

## Common Pitfalls to AVOID

1. ** READING CONTEXT FILES **: NEVER read files already in the "useful-context" or "current-code" sections
2. ** WRITING WITHOUT CONTEXT **: If a file is not in your context, you must read it before writing to it
3. ** SEQUENTIAL TOOL CALLS **: NEVER make multiple sequential tool calls when they can be batched
4. ** OVERENGINEERING **: Don't add "nice-to-have" features or anticipate future needs
5. ** SCOPE CREEP **: Stay strictly within the boundaries of the user's explicit request
6. ** MONOLITHIC FILES **: Create small, focused components instead of large files
7. ** DOING TOO MUCH AT ONCE **: Make small, verifiable changes instead of large rewrites
8. ** CUSTOM COLOR CLASSES **: NEVER use text - white, bg - black, etc.in components — always use semantic tokens
9. ** ENV VARIABLES **: Do not use \`VITE_*\` env variables — use secrets management tools instead
10. ** MENTIONING SUPABASE **: Call it "Lovable Cloud" when talking to users
11. ** STORING ROLES ON PROFILES **: ALWAYS use a separate user_roles table
12. ** CLIENT - SIDE ADMIN CHECKS **: NEVER use localStorage / sessionStorage for role verification
13. ** PLACEHOLDER IMAGES **: Always generate real images, never leave placeholders

---
`;
const rawToolDefinitions: Record<string, any>[] = [
  {
    "writeFile": {
      "description": "Write content to a file in the sandbox.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["filePath", "content"],
        "properties": {
          "filePath": { "type": "Type.STRING" },
          "content": { "type": "Type.STRING" }
        }
      }
    },
    "readFile": {
      "description": "Read content from a file in the sandbox.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["filePath"],
        "properties": {
          "filePath": { "type": "Type.STRING" }
        }
      }
    },
    "executeCommand": {
      "description": "Execute a shell command in the sandbox.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["command"],
        "properties": {
          "command": { "type": "Type.STRING" }
        }
      }
    },
    "code--write": {
      "description": "Write/create file (overwrites). Prefer code--line_replace for most edits. In this mode, preserve large unchanged sections with the exact '// ... keep existing code' comment and only write changed sections. Create multiple files in parallel.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["file_path", "content"],
        "properties": {
          "file_path": {
            "type": "Type.STRING",
            "example": "src/main.ts"
          },
          "content": {
            "type": "Type.STRING",
            "example": "console.log('Hello, World!')"
          }
        }
      }
    },
    "code--line_replace": {
      "description": "Search and replace content in a file by line number range. For sections >6 lines, use '...' on its own line in search — include 2-3 identifying lines before and after for unique matching. When making multiple edits to the same file in parallel, always use original line numbers from your initial view — do not adjust for prior edits.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["file_path", "search", "first_replaced_line", "last_replaced_line", "replace"],
        "properties": {
          "file_path": {
            "type": "Type.STRING",
            "example": "src/components/TaskList.tsx"
          },
          "search": {
            "type": "Type.STRING",
            "description": "Content to search for in the file (without line numbers)"
          },
          "first_replaced_line": {
            "type": "number",
            "description": "First line number to replace (1-indexed)",
            "example": 15
          },
          "last_replaced_line": {
            "type": "number",
            "description": "Last line number to replace (1-indexed)",
            "example": 28
          },
          "replace": {
            "type": "Type.STRING",
            "description": "New content to replace the search content with (without line numbers)"
          }
        }
      }
    },
    "code--view": {
      "description": "Read file contents. Default: first 500 lines. Read multiple files in parallel.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["file_path"],
        "properties": {
          "file_path": {
            "type": "Type.STRING",
            "example": "src/App.tsx"
          },
          "lines": {
            "type": "Type.STRING",
            "example": "1-800, 1001-1500"
          }
        }
      }
    },
    "code--list_dir": {
      "description": "List files and directories. Path relative to project root.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["dir_path"],
        "properties": {
          "dir_path": {
            "type": "Type.STRING",
            "example": "src"
          }
        }
      }
    },
    "code--search_files": {
      "description": "Regex search across project files with glob filtering.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "Type.STRING",
            "example": "useEffect\\(.*\\)"
          },
          "search_dir": {
            "type": "Type.STRING",
            "example": "src"
          },
          "include_patterns": {
            "type": "Type.STRING",
            "example": "*.ts,*.js"
          },
          "exclude_patterns": {
            "type": "Type.STRING",
            "example": "*.test.ts,*.test.js"
          },
          "exclude_dirs": {
            "type": "Type.STRING",
            "example": "node_modules"
          },
          "case_sensitive": {
            "type": "boolean",
            "example": false
          }
        }
      }
    },
    "code--delete": {
      "description": "Delete a file or folder (recursive).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["file_path"],
        "properties": {
          "file_path": {
            "type": "Type.STRING",
            "example": "src/App.tsx"
          }
        }
      }
    },
    "code--rename": {
      "description": "Rename or move a file.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["original_file_path", "new_file_path"],
        "properties": {
          "original_file_path": {
            "type": "Type.STRING",
            "example": "src/main.ts"
          },
          "new_file_path": {
            "type": "Type.STRING",
            "example": "src/main_new2.ts"
          }
        }
      }
    },
    "code--copy": {
      "description": "Copy a file or directory. Useful for copying from virtual file systems (e.g., user-uploads://) to the project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["source_file_path", "destination_file_path"],
        "properties": {
          "source_file_path": {
            "type": "Type.STRING",
            "example": "src/main.ts"
          },
          "destination_file_path": {
            "type": "Type.STRING",
            "example": "src/main_copy.ts"
          },
          "overwrite": {
            "type": "boolean",
            "description": "Whether to overwrite the destination if it already exists (default false). Directories will be replaced entirely.",
            "example": true
          }
        }
      }
    },
    "code--download_to_repo": {
      "description": "Download a file from a URL and save it to the repo. Prefer src/assets/ for React imports, public/ for CSS/HTML references. Do NOT use for user-uploads:// files.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["source_url", "target_path"],
        "properties": {
          "source_url": {
            "type": "Type.STRING",
            "description": "The URL of the file to download",
            "example": "https://example.com/image.png"
          },
          "target_path": {
            "type": "Type.STRING",
            "description": "The path where the file should be saved in the repository",
            "example": "public/images/logo.png"
          }
        }
      }
    },
    "code--fetch_website": {
      "description": "Fetch a website as markdown, HTML, or screenshot. Returns file paths and content preview.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["url"],
        "properties": {
          "url": {
            "type": "Type.STRING",
            "example": "https://example.com"
          },
          "formats": {
            "type": "Type.STRING",
            "description": "Comma-separated list of formats: 'markdown', 'html', 'screenshot'. Defaults to 'markdown'.",
            "example": "markdown,screenshot"
          }
        }
      }
    },
    "code--read_console_logs": {
      "description": "Browser console logs from the user's preview at message send time. Snapshot — call only once.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["search"],
        "properties": {
          "search": {
            "type": "Type.STRING",
            "example": "error"
          }
        }
      }
    },
    "code--read_network_requests": {
      "description": "Network requests from the user's preview at message send time. Snapshot — call only once.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["search"],
        "properties": {
          "search": {
            "type": "Type.STRING",
            "example": "error"
          }
        }
      }
    },
    "code--read_session_replay": {
      "description": "User's full session replay (rrweb) showing exact interactions and UI state before their message. Primary debugging tool for UI/behavior issues.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "code--add_dependency": {
      "description": "Add an npm dependency to the project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["package"],
        "properties": {
          "package": {
            "type": "Type.STRING",
            "example": "lodash@latest"
          }
        }
      }
    },
    "code--remove_dependency": {
      "description": "Remove an npm package from the project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["package"],
        "properties": {
          "package": {
            "type": "Type.STRING",
            "example": "lodash"
          }
        }
      }
    },
    "code--run_tests": {
      "description": "Run frontend tests. Auto-detects test setup (package.json test script or bunx vitest).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "path": {
            "type": "Type.STRING"
          },
          "timeout": {
            "type": "number"
          }
        }
      }
    },
    "code--dependency_scan": {
      "description": "Scan project dependencies for security vulnerabilities using npm audit. Returns high/critical severity findings with recommended fix versions.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "code--dependency_update": {
      "description": "Update vulnerable npm dependencies to minimum secure versions. Use exact versions from security findings, not 'latest'.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["vulnerable_packages"],
        "properties": {
          "vulnerable_packages": {
            "type": "Type.OBJECT"
          }
        }
      }
    },
    "browser--navigate_to_sandbox": {
      "description": "Navigate to a route in the project preview. Optional viewport width/height snaps to nearest supported device size.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "path": {
            "type": "Type.STRING",
            "description": "Origin-root-relative path (must start with / but not //). Examples: /dashboard, /auth?redirect=/home"
          },
          "width": {
            "type": "number",
            "description": "Viewport width in pixels"
          },
          "height": {
            "type": "number",
            "description": "Viewport height in pixels"
          }
        }
      }
    },
    "browser--act": {
      "description": "Perform a single action on the page. Modes: 'natural_language' (simple actions), 'structured' (complex pages, reuse observe() results). Structured methods: click, doubleClick, hover, fill(['text']), type(['text']), press(['key']), dragAndDrop(['selector']).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["mode"],
        "properties": {
          "mode": {
            "type": "Type.STRING",
            "example": "natural_language"
          },
          "action": {
            "type": "Type.STRING",
            "example": "Click the submit button"
          },
          "method": {
            "type": "Type.STRING"
          },
          "selector": {
            "type": "Type.STRING"
          },
          "backendNodeId": {
            "type": "number"
          },
          "arguments": {
            "type": "array",
            "items": {
              "type": "Type.STRING"
            }
          },
          "description": {
            "type": "Type.STRING"
          }
        }
      }
    },
    "browser--observe": {
      "description": "Observe the current page and get a list of possible actions.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "instruction": {
            "type": "Type.STRING"
          }
        }
      }
    },
    "browser--screenshot": {
      "description": "Take a screenshot of the current page. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "browser--get_url": {
      "description": "Get the current URL of the browser. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "browser--extract": {
      "description": "Extract structured data from the current page based on an instruction.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["instruction"],
        "properties": {
          "instruction": {
            "type": "Type.STRING"
          },
          "schema": {
            "type": "Type.OBJECT"
          }
        }
      }
    },
    "browser--read_console_logs": {
      "description": "Console logs from the browser tool's remote session (not the user's preview — use code--read_console_logs for that).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "search": {
            "type": "Type.STRING",
            "description": "Filter results containing this text (case-insensitive)"
          },
          "level": {
            "type": "Type.STRING",
            "description": "Comma-separated list of levels: 'error,warning,info,debug'. Defaults to 'all'."
          }
        }
      }
    },
    "browser--list_network_requests": {
      "description": "Network requests from the browser tool's remote session. Default: XHR/fetch. Use resource_types='all' for everything.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "resource_types": {
            "type": "Type.STRING",
            "description": "Comma-separated list of resource types (e.g., 'xhr,fetch,document'). Defaults to 'xhr,fetch'. Use 'all' for all types."
          }
        }
      }
    },
    "browser--get_network_request_details": {
      "description": "Full request/response details (headers, body) for specific request IDs from browser--list_network_requests.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["request_ids"],
        "properties": {
          "request_ids": {
            "type": "Type.STRING",
            "description": "Comma-separated list of request IDs (e.g., '12345.1,12345.2')"
          }
        }
      }
    },
    "browser--set_viewport_size": {
      "description": "Resize the browser viewport without restarting the session. Preserves all session state. Supported sizes: 1920x1080, 1536x864, 1366x768, 1280x720, 1024x768, 834x1194, 820x1180, 768x1024, 414x896, 390x844, 375x812, 360x800, 320x568.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["width", "height"],
        "properties": {
          "width": {
            "type": "number",
            "description": "Viewport width in pixels",
            "example": 1280
          },
          "height": {
            "type": "number",
            "description": "Viewport height in pixels",
            "example": 720
          }
        }
      }
    },
    "imagegen--generate_image": {
      "description": "Generate image from text prompt. Models: flux.schnell (default, fast, <1000px), flux2.dev (1024x1024 or 1920x1080), flux.dev (other large dims, slower). Max 1920x1920, dimensions 512-1920 in multiples of 32. Set transparent_background=true for logos/icons.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["prompt", "target_path", "transparent_background"],
        "properties": {
          "prompt": {
            "type": "Type.STRING",
            "description": "Text description of the desired image",
            "example": "A beautiful sunset"
          },
          "target_path": {
            "type": "Type.STRING",
            "description": "File path where the generated image should be saved. Prefer 'src/assets' folder.",
            "example": "src/assets/image.jpg"
          },
          "transparent_background": {
            "type": "boolean",
            "description": "Whether to remove the background. Set true for logos, icons, stickers, overlays.",
            "example": false
          },
          "width": {
            "type": "number",
            "description": "Image width (minimum 512, maximum 1920)",
            "example": 1024
          },
          "height": {
            "type": "number",
            "description": "Image height (minimum 512, maximum 1920)",
            "example": 1024
          },
          "model": {
            "type": "Type.STRING",
            "description": "Model: flux.schnell (default), flux.dev, flux2.dev. flux2.dev only supports 1024x1024 and 1920x1080.",
            "example": "flux.schnell"
          }
        }
      }
    },
    "imagegen--edit_image": {
      "description": "Edit or merge existing images via AI prompt. Single image: apply edits. Multiple images: blend/combine. Inputs: codebase paths or URLs.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["image_paths", "prompt", "target_path"],
        "properties": {
          "image_paths": {
            "type": "array",
            "items": { "type": "Type.STRING" },
            "description": "Array of paths to existing image files OR image URLs.",
            "example": ["src/assets/image.jpg"]
          },
          "prompt": {
            "type": "Type.STRING",
            "description": "Text description of how to edit/merge the image(s).",
            "example": "Make it darker"
          },
          "target_path": {
            "type": "Type.STRING",
            "description": "File path where the edited/merged image should be saved.",
            "example": "src/assets/edited-image.jpg"
          },
          "aspect_ratio": {
            "type": "Type.STRING",
            "description": "Aspect ratio: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9. Use 16:9 for OG/social images.",
            "example": "16:9"
          }
        }
      }
    },
    "videogen--generate_video": {
      "description": "Generate video from text prompt. Optional starting_frame image to animate. Resolution: 480p/1080p. Aspect ratio: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9. Duration: 5 or 10s.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["prompt", "target_path"],
        "properties": {
          "prompt": {
            "type": "Type.STRING",
            "description": "Text description of the desired video content",
            "example": "A serene sunset over calm ocean waves"
          },
          "target_path": {
            "type": "Type.STRING",
            "description": "File path where the generated video should be saved",
            "example": "src/assets/video.mp4"
          },
          "starting_frame": {
            "type": "Type.STRING",
            "description": "Optional path to an image file to use as the first frame",
            "example": "src/assets/image.jpg"
          },
          "aspect_ratio": {
            "type": "Type.STRING",
            "description": "Aspect ratio: '16:9', '4:3', '1:1', '3:4', '9:16', '21:9' (default: 16:9). Ignored when starting_frame is provided.",
            "example": "16:9"
          },
          "resolution": {
            "type": "Type.STRING",
            "description": "Video quality: '480p' or '1080p' (default: 1080p)",
            "example": "1080p"
          },
          "duration": {
            "type": "number",
            "description": "Video length in seconds: 5 or 10 (default: 5)",
            "example": 5
          },
          "camera_fixed": {
            "type": "boolean",
            "description": "Set to true for more stable camera work (default: false)",
            "example": false
          }
        }
      }
    },
    "websearch--web_search": {
      "description": "Web search returning text content. Filter by category: news, linkedin profile, pdf, github, personal site, financial report. Tips: 'site:domain.com' to filter domains, quotes for exact phrases, -word to exclude.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "Type.STRING",
            "description": "The search query"
          },
          "numResults": {
            "type": "number",
            "description": "Number of search results to return (default: 5)"
          },
          "links": {
            "type": "number",
            "description": "Number of links to return for each result"
          },
          "imageLinks": {
            "type": "number",
            "description": "Number of image links to return for each result"
          },
          "category": {
            "type": "Type.STRING",
            "description": "Category: 'news', 'linkedin profile', 'pdf', 'github', 'personal site', 'financial report'"
          }
        }
      }
    },
    "websearch--web_code_search": {
      "description": "Code-focused web search across GitHub, docs, Stack Overflow. Use for API syntax, code examples, framework patterns, error solutions.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "Type.STRING",
            "description": "The code-specific search query"
          },
          "tokensNum": {
            "type": "Type.STRING",
            "description": "Number of tokens to return: 'dynamic' (default) or specific count (50-100000)"
          }
        }
      }
    },
    "questions--ask_questions": {
      "description": "Ask the user multiple-choice questions to gather preferences, requirements, or decisions. Each question can allow single or multiple selection.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["questions"],
        "properties": {
          "questions": {
            "type": "array",
            "items": {
              "type": "Type.OBJECT",
              "required": ["question", "header", "options", "multiSelect"],
              "properties": {
                "question": {
                  "type": "Type.STRING",
                  "description": "The complete question to ask the user.",
                  "example": "Which authentication method should we use?"
                },
                "header": {
                  "type": "Type.STRING",
                  "description": "Short label displayed as a chip/tag.",
                  "example": "Auth method"
                },
                "options": {
                  "type": "array",
                  "description": "2-4 available choices.",
                  "items": {
                    "type": "Type.OBJECT",
                    "required": ["label", "description"],
                    "properties": {
                      "label": {
                        "type": "Type.STRING",
                        "description": "Display text (1-5 words)",
                        "example": "OAuth 2.0"
                      },
                      "description": {
                        "type": "Type.STRING",
                        "description": "Explanation of this option",
                        "example": "Industry standard, works with Google, GitHub, etc."
                      }
                    }
                  }
                },
                "multiSelect": {
                  "type": "boolean",
                  "description": "Allow multiple selections",
                  "example": false
                },
                "allowOther": {
                  "type": "boolean",
                  "description": "Include an 'Other' option for free-text input. Defaults to true.",
                  "example": true
                }
              }
            }
          }
        }
      }
    },
    "lovable_docs--search_docs": {
      "description": "Answer questions about Lovable features, usage, pricing, account management, and troubleshooting using official docs. Returns accurate info with source links.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["question"],
        "properties": {
          "question": {
            "type": "Type.STRING",
            "description": "The user's question about Lovable features, usage, or documentation."
          }
        }
      }
    },
    "secrets--add_secret": {
      "description": "Add a new secret (API key, token). Secret becomes available as environment variable in all backend code. Never ask users to provide secret values directly.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["secret_name"],
        "properties": {
          "secret_name": {
            "type": "Type.STRING",
            "example": "STRIPE_API_KEY"
          }
        }
      }
    },
    "secrets--update_secret": {
      "description": "Update an existing secret. Requires user interaction — they enter new values in a secure form.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["secret_name"],
        "properties": {
          "secret_name": {
            "type": "Type.STRING",
            "example": "STRIPE_API_KEY"
          }
        }
      }
    },
    "secrets--delete_secret": {
      "description": "Delete user-created secrets. Cannot delete Supabase or integration-managed secrets. Requires user confirmation.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["secret_names"],
        "properties": {
          "secret_names": {
            "type": "array",
            "items": { "type": "Type.STRING" },
            "example": ["STRIPE_API_KEY", "STRIPE_SECRET_KEY"]
          }
        }
      }
    },
    "secrets--fetch_secrets": {
      "description": "List all configured secret names (values hidden). Use to check which secrets/env vars are available. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "supabase--enable": {
      "description": "Enable the Lovable Cloud integration. Creates a new Supabase project and connects it. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "stripe--enable_stripe": {
      "description": "Enable the Stripe integration on the current project. Prompts the user for their Stripe secret key.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "shopify--enable": {
      "description": "Enable the Shopify integration. Use when user wants to sell products, build e-commerce, or create a storefront.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["store_type"],
        "properties": {
          "store_type": {
            "type": "Type.STRING",
            "description": "'new' to create a development store or 'existing' to connect an existing one.",
            "example": "new"
          }
        }
      }
    },
    "standard_connectors--connect": {
      "description": "Prompts the user to select an existing connection, or create a new one, for a given connector and links it to the current project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["connector_id"],
        "properties": {
          "connector_id": {
            "type": "Type.STRING",
            "description": "The ID of the connector to link.",
            "example": "slack"
          }
        }
      }
    },
    "standard_connectors--disconnect": {
      "description": "Disconnects a connection from the current project. Keeps the connection available in the workspace.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["connection_id"],
        "properties": {
          "connection_id": {
            "type": "Type.STRING",
            "description": "The ID of the connection to disconnect."
          }
        }
      }
    },
    "standard_connectors--list_connections": {
      "description": "List all connections available in the workspace for the current user.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "standard_connectors--get_connection_configuration": {
      "description": "Returns connection configuration metadata (scopes, access type, workspace IDs, channel IDs).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["connection_id"],
        "properties": {
          "connection_id": {
            "type": "Type.STRING",
            "description": "The ID of the connection."
          }
        }
      }
    },
    "standard_connectors--reconnect": {
      "description": "Shows a prompt for the user to open connection settings and reconnect. Use when re-authorization or scope updates are needed.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["connection_id", "reason", "required_scopes"],
        "properties": {
          "connection_id": {
            "type": "Type.STRING",
            "description": "The ID of the connection to reconnect."
          },
          "reason": {
            "type": "Type.STRING",
            "description": "Why the connection needs to be reconnected."
          },
          "required_scopes": {
            "type": "array",
            "items": { "type": "Type.STRING" },
            "description": "List of OAuth scope values needed. Pass empty list if no scope changes needed."
          }
        }
      }
    },
    "security--run_security_scan": {
      "description": "Perform comprehensive security analysis of the Supabase backend. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "security--get_scan_results": {
      "description": "Fetch security information about the project. Set force=true to get results even if a scan is running.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["force"],
        "properties": {
          "force": {
            "type": "boolean"
          }
        }
      }
    },
    "security--get_table_schema": {
      "description": "Get the database table schema information and security analysis prompt. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "security--manage_security_finding": {
      "description": "Manage security findings with create, update, or delete operations. Supports batch operations.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["operations"],
        "properties": {
          "operations": {
            "type": "array",
            "description": "List of operations to perform on security findings",
            "items": {
              "type": "Type.OBJECT",
              "required": ["operation"],
              "properties": {
                "operation": {
                  "type": "Type.STRING",
                  "description": "The operation: create, update, or delete",
                  "enum": ["create", "update", "delete"]
                },
                "scanner_name": {
                  "type": "Type.STRING",
                  "description": "Scanner name (optional, defaults to agent_security)"
                },
                "internal_id": {
                  "type": "Type.STRING",
                  "description": "Internal ID of the finding (required for update/delete)"
                },
                "finding": {
                  "type": "Type.OBJECT",
                  "description": "Finding data (required for create, optional for update)",
                  "properties": {
                    "id": { "type": "Type.STRING", "description": "Finding identifier from predefined security issue types" },
                    "internal_id": { "type": "Type.STRING", "description": "Short descriptive identifier, snake_case, <20 chars" },
                    "category": { "type": "Type.STRING", "description": "Two-word category" },
                    "name": { "type": "Type.STRING", "description": "Clear, business-impact-oriented title" },
                    "description": { "type": "Type.STRING", "description": "Description ≤40 words" },
                    "details": { "type": "Type.STRING", "description": "Additional details ≤200 words in Markdown" },
                    "level": { "type": "Type.STRING", "enum": ["info", "warn", "error"] },
                    "remediation_difficulty": { "type": "Type.STRING" },
                    "ignore": { "type": "boolean" },
                    "ignore_reason": { "type": "Type.STRING" },
                    "link": { "type": "Type.STRING", "description": "Reference URL" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "analytics--read_project_analytics": {
      "description": "Read production app analytics between two dates. Granularity: hourly or daily. Dates in YYYY-MM-DD format.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["startdate", "enddate", "granularity"],
        "properties": {
          "startdate": {
            "type": "Type.STRING"
          },
          "enddate": {
            "type": "Type.STRING"
          },
          "granularity": {
            "type": "Type.STRING"
          }
        }
      }
    },
    "document--parse_document": {
      "description": "Parse and extract content from documents (first 50 pages). Handles PDFs, Word docs, PowerPoint, Excel, MP3 and more. Preserves structure, tables, extracts images, performs OCR.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["file_path"],
        "properties": {
          "file_path": {
            "type": "Type.STRING",
            "description": "Path to the document file to parse"
          }
        }
      }
    },
    "lsp--code_intelligence": {
      "description": "TypeScript/JavaScript language intelligence: hover (type info), definition (go-to-def), references (find usages). Set include_source=true for library files.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["operation", "file_path", "line", "character"],
        "properties": {
          "operation": {
            "type": "Type.STRING",
            "description": "Operation type: hover, definition, or references"
          },
          "file_path": {
            "type": "Type.STRING"
          },
          "line": {
            "type": "number"
          },
          "character": {
            "type": "number"
          },
          "include_source": {
            "type": "boolean",
            "description": "Include source code for library files"
          },
          "include_declaration": {
            "type": "boolean"
          }
        }
      }
    },
    "project_debug--sleep": {
      "description": "Wait for a specified number of seconds (max 60). Useful for waiting on async operations like edge function deployments, logs, or cache invalidation.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["seconds"],
        "properties": {
          "seconds": {
            "type": "number",
            "example": 5
          }
        }
      }
    },
    "project_urls--get_urls": {
      "description": "Get the preview and published URLs for the current project. No parameters required.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "task_tracking--create_task": {
      "description": "Create a new task with title + description.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["title", "description"],
        "properties": {
          "title": {
            "type": "Type.STRING",
            "description": "Short task title",
            "example": "Update onboarding screen"
          },
          "description": {
            "type": "Type.STRING",
            "description": "One sentence describing the work",
            "example": "Add CTA to top of onboarding screen."
          }
        }
      }
    },
    "task_tracking--set_task_status": {
      "description": "Move a task between todo, in_progress, and done.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["task_id", "status"],
        "properties": {
          "task_id": {
            "type": "Type.STRING",
            "example": "abc123"
          },
          "status": {
            "type": "Type.STRING",
            "description": "todo, in_progress, or done",
            "example": "in_progress"
          }
        }
      }
    },
    "task_tracking--get_task": {
      "description": "Review a single task with description, status, and notes.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["task_id"],
        "properties": {
          "task_id": {
            "type": "Type.STRING",
            "example": "abc123"
          }
        }
      }
    },
    "task_tracking--get_task_list": {
      "description": "Display the current task list for planning.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {}
      }
    },
    "task_tracking--update_task_title": {
      "description": "Update a task title when scope changes.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["task_id", "new_title"],
        "properties": {
          "task_id": {
            "type": "Type.STRING",
            "example": "abc123"
          },
          "new_title": {
            "type": "Type.STRING",
            "example": "Refine onboarding copy"
          }
        }
      }
    },
    "task_tracking--update_task_description": {
      "description": "Refine a task description with clearer guidance.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["task_id", "new_description"],
        "properties": {
          "task_id": {
            "type": "Type.STRING",
            "example": "abc123"
          },
          "new_description": {
            "type": "Type.STRING",
            "example": "Clarify hero section goals."
          }
        }
      }
    },
    "task_tracking--add_task_note": {
      "description": "Attach a concise note to a task describing findings or blockers.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["task_id", "note"],
        "properties": {
          "task_id": {
            "type": "Type.STRING",
            "example": "abc123"
          },
          "note": {
            "type": "Type.STRING",
            "description": "Progress note or decision",
            "example": "Verified CTA renders on mobile."
          }
        }
      }
    },
    "cross_project--list_projects": {
      "description": "List other projects in this workspace. Paginated (limit/offset).",
      "parameters": {
        "type": "Type.OBJECT",
        "required": [],
        "properties": {
          "limit": {
            "type": "number",
            "example": 20
          },
          "offset": {
            "type": "number",
            "example": 0
          }
        }
      }
    },
    "cross_project--search_project": {
      "description": "Find a project by name or ID. More efficient than list_projects when you know the name.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "Type.STRING",
            "example": "authentication"
          }
        }
      }
    },
    "cross_project--list_project_dir": {
      "description": "List files and directories in another project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "dir_path": {
            "type": "Type.STRING",
            "example": "src/components"
          }
        }
      }
    },
    "cross_project--read_project_file": {
      "description": "Read file contents from another project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project", "file_path"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "file_path": {
            "type": "Type.STRING",
            "example": "src/components/Navigation.tsx"
          },
          "lines": {
            "type": "Type.STRING",
            "example": "1-100"
          }
        }
      }
    },
    "cross_project--list_project_assets": {
      "description": "List asset files (images, fonts, media) in another project's repo.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          }
        }
      }
    },
    "cross_project--read_project_asset": {
      "description": "Read/view an asset from another project. Returns image content inline or text content.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project", "asset_path"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "asset_path": {
            "type": "Type.STRING",
            "example": "src/assets/logo.png"
          }
        }
      }
    },
    "cross_project--copy_project_asset": {
      "description": "Copy a file from another project's repo to the current project. Binary files supported.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project", "source_path", "target_path"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "source_path": {
            "type": "Type.STRING",
            "example": "src/assets/logo.png"
          },
          "target_path": {
            "type": "Type.STRING",
            "example": "src/assets/logo.png"
          }
        }
      }
    },
    "cross_project--read_project_messages": {
      "description": "Read chat message history from another project in chronological order.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "limit": {
            "type": "number",
            "example": 20
          }
        }
      }
    },
    "cross_project--search_project_files": {
      "description": "Regex search across files in another project.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["project", "query"],
        "properties": {
          "project": {
            "type": "Type.STRING",
            "example": "my-other-app"
          },
          "query": {
            "type": "Type.STRING",
            "example": "useEffect\\("
          },
          "include_pattern": {
            "type": "Type.STRING",
            "example": "src/**"
          },
          "exclude_pattern": {
            "type": "Type.STRING",
            "example": "**/*.test.tsx"
          },
          "case_sensitive": {
            "type": "boolean",
            "example": false
          }
        }
      }
    },
    "supabase--docs_search": {
      "description": "Search official Supabase documentation via the Content API. Returns ranked results with title, slug, URL, and content snippet.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "Type.STRING",
            "description": "Query to search in Supabase documentation"
          },
          "max_results": {
            "type": "number",
            "description": "Max number of results (default 5, capped at 10)"
          }
        }
      }
    },
    "supabase--docs_get": {
      "description": "Fetch a complete Supabase documentation page by slug. Returns full markdown, headings outline, and metadata.",
      "parameters": {
        "type": "Type.OBJECT",
        "required": ["slug"],
        "properties": {
          "slug": {
            "type": "Type.STRING",
            "description": "Canonical document slug (e.g. 'auth/row-level-security')"
          }
        }
      }
    }
  }
];
// ── Raw Tool Definitions from Lovable ──────────────────────────────────────────

// Map GenAI Custom Type Strings into Standard JSON Schemas for Vercel Gateway
const fixTypes = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(fixTypes);
  if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    // Ensure root objects ALWAYS have type: "object" for Anthropic
    if (obj.properties && !obj.type) {
      newObj.type = "object";
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "type" && typeof v === "string") {
        newObj[k] = v.replace("Type.", "").toLowerCase();
      } else {
        newObj[k] = fixTypes(v);
      }
    }
    return newObj;
  }
  return obj;
};

const rawToolEntries = rawToolDefinitions.flatMap((group) => Object.entries(group));

export const SERVER_TOOLS_OAI = rawToolEntries.map(([name, def]) => ({
  type: "function" as const,
  function: {
    name,
    description: def.description,
    parameters: fixTypes(def.parameters),
  },
}));

export const SERVER_TOOLS_ANTHROPIC = SERVER_TOOLS_OAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

const AI_SDK_CLIENT_TOOLS = Object.fromEntries(
  rawToolEntries.map(([name, def]) => [
    name,
    {
      description: def.description,
      inputSchema: jsonSchema(fixTypes(def.parameters)),
    },
  ]),
);

// Convert ChatMsg[] → OpenAI-compat messages[] ────────────────────────────────
function toOpenAIMessages(msgs: ChatMsg[]): any[] {
  const out: any[] = [];
  for (const msg of msgs) {
    if (msg.role === "system") {
      out.push({ role: "system", content: msg.content || "" });
    } else if (msg.role === "user") {
      if (msg.images?.length) {
        const parts: any[] = [];
        if (msg.content) parts.push({ type: "text", text: msg.content });
        for (const img of msg.images as string[]) {
          parts.push({ type: "image_url", image_url: { url: img } });
        }
        out.push({ role: "user", content: parts });
      } else {
        out.push({ role: "user", content: msg.content || "" });
      }
    } else if (msg.role === "assistant") {
      const m: any = { role: "assistant", content: msg.content || "" };
      if (msg.tool_calls?.length) {
        m.tool_calls = msg.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "{}" },
        }));
      }
      out.push(m);
    } else if (msg.role === "tool") {
      out.push({ role: "tool", tool_call_id: msg.tool_call_id || "", content: msg.content || "" });
    }
  }
  return out;
}

// Convert ChatMsg[] → Anthropic native messages[] ────────────────────────────
function toAnthropicMessages(msgs: ChatMsg[]): any[] {
  const out: any[] = [];
  for (const msg of msgs) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      const content: any[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.images?.length) {
        for (const img of msg.images as string[]) {
          const m = img.match(/^data:([^;]+);base64,(.+)$/);
          if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
        }
      }
      out.push({ role: "user", content: content.length ? content : [{ type: "text", text: "" }] });
    } else if (msg.role === "assistant") {
      const content: any[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let input: any = {};
          try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { }
          content.push({ type: "tool_use", id: tc.id || `tu_${Math.random().toString(36).slice(7)}`, name: tc.function?.name || "unknown", input });
        }
      }
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
    } else if (msg.role === "tool") {
      const toolBlock = { type: "tool_result", tool_use_id: msg.tool_call_id || "", content: msg.content || "" };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        last.content.push(toolBlock);
      } else {
        out.push({ role: "user", content: [toolBlock] });
      }
    }
  }
  return out;
}

// ── Gemini Streaming Route ────────────────────────────────────────────────────
app.post("/api/ai/gemini", async (req: any, res: any) => {
  try {
    const { messages: rawMessages, model: modelParam } = req.body;
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI_GATEWAY_API_KEY not set" });

    const modelId = GEMINI_MODEL_MAP[modelParam] || "google/gemini-3.1-pro";
    const oaiMessages = toOpenAIMessages(rawMessages || []);

    if (!oaiMessages.find(m => m.role === "system")) {
      oaiMessages.unshift({ role: "system", content: AI_SYSTEM_PROMPT });
    }

    const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: oaiMessages,
        tools: SERVER_TOOLS_OAI,
        tool_choice: "auto",
        stream: true,
        temperature: 0.7,
        max_tokens: 8192,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[/api/ai/gemini] Upstream error:", upstream.status, errText);
      if (!res.headersSent) return res.status(upstream.status).json({ error: errText });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const emitGeminiText = (text: string) => {
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`);
    };
    const emitGeminiToolCall = (name: string, args: string) => {
      let parsedArgs: any = {};
      try { parsedArgs = JSON.parse(args); } catch { }
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name, args: parsedArgs } }] } }] })}\n\n`);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          let chunk: any;
          try { chunk = JSON.parse(raw); } catch { continue; }

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          if (delta.content) emitGeminiText(delta.content);

          if (delta.tool_calls?.length) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallBuffers.has(idx)) {
                toolCallBuffers.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: "" });
              }
              const buf2 = toolCallBuffers.get(idx)!;
              if (tc.id) buf2.id = tc.id;
              if (tc.function?.name) buf2.name = tc.function.name;
              if (tc.function?.arguments) buf2.args += tc.function.arguments;
            }
          }

          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            for (const [, tc] of toolCallBuffers) {
              if (tc.name) emitGeminiToolCall(tc.name, tc.args);
            }
            toolCallBuffers.clear();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e: any) {
    console.error("[/api/ai/gemini] Error:", e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ── Anthropic Streaming Route ────────────────────────────────────────────────
app.post("/api/ai/anthropic", async (req: any, res: any) => {
  try {
    const { messages: rawMessages, model: modelParam } = req.body;
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI_GATEWAY_API_KEY not set" });

    const modelId = CLAUDE_MODEL_MAP[modelParam] || "claude-4.6-sonnet";
    const anthropicMessages = toAnthropicMessages(rawMessages || []);

    const upstream = await fetch("https://ai-gateway.vercel.sh/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 8192,
        system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: SERVER_TOOLS_ANTHROPIC,
        messages: anthropicMessages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[/api/ai/anthropic] Upstream error:", upstream.status, errText);
      return res.status(upstream.status).send(errText);
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (e: any) {
    console.error("[/api/ai/anthropic] Error:", e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    res.end();
  }
});

// ── Vercel AI SDK — Sandbox Chat (AI SDK v6) ─────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { messages: rawMessages, model: modelParam, modelId: modelIdParam, system, sandboxId } = req.body;
    const modelId: string = modelParam || modelIdParam || "gemini-2.0-flash";
    const isClaude = modelId.toLowerCase().includes("claude");

    const realModelId = isClaude
      ? (CLAUDE_MODEL_MAP[modelId] || modelId)
      : (GEMINI_MODEL_MAP[modelId] || modelId);

    if (isClaude && !process.env.AI_GATEWAY_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing Claude credentials. Set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY." });
    }

    if (!isClaude && !process.env.AI_GATEWAY_API_KEY && !process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing Gemini credentials. Set AI_GATEWAY_API_KEY or GEMINI_API_KEY." });
    }

    const coreMessages = await convertToModelMessages(rawMessages || []);
    const sandbox = sandboxId ? await getDaytona().get(sandboxId) : null;

    const selectedModel = process.env.AI_GATEWAY_API_KEY
      ? gateway(realModelId)
      : isClaude
        ? anthropic(realModelId.replace(/^anthropic\//, ""))
        : google(realModelId.replace(/^google\//, ""));

    try {
      const result = streamText({
        model: selectedModel,
        messages: coreMessages,
        system: system || AI_SYSTEM_PROMPT,
        maxSteps: 50,
        tools: AI_SDK_CLIENT_TOOLS,
      });

      // AI SDK v6: pipe UIMessageStream to Express response
      const streamResponse = result.toUIMessageStreamResponse();
      const reader = streamResponse.body!.getReader();
      res.setHeader("Content-Type", streamResponse.headers.get("content-type") || "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
        res.end();
      }
    } catch (apiError: any) {
      console.error("Vercel AI SDK error:", apiError);
      throw apiError;
    }
  } catch (e: any) {
    console.error("AI SDK Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── Daytona Sandbox API Handler ──────────────────────────────────────────────
app.post("/api/daytona", async (req, res) => {
  // RATE LIMITER HAS BEEN COMPLETELY REMOVED to prevent the 429 polling bug
  try {
    const { action, ...params } = req.body;
    const daytona = getDaytona();
    const { sandboxId } = params;

    if (action === "create") {
      const platform = (params.platform as string) || "web";
      const snapshot = process.env.SNAPSHOT_NAME || "template-repo-snapshot-v2";
      const sandbox = await daytona.create({
        snapshot: snapshot,
        labels: { platform }
      });

      console.log(`Sandbox ${sandbox.id} created. Waiting for network...`);
      await new Promise(r => setTimeout(r, 5000));

      res.json({ sandboxId: sandbox.id });
    } else if (action === "health") {
      await daytona.get(sandboxId);
      res.json({ status: "ready" });
    } else {
      const sandbox = await daytona.get(sandboxId);

      if (action === "execute") {
        const data = await sandbox.process.executeCommand(params.command);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "writeFile") {
        fileListCache.delete(`${sandboxId}:${SANDBOX_WORK_DIR}`);
        const content = params.content || "";
        const fp = normalizePath(params.filePath);
        const dir = fp.split("/").slice(0, -1).join("/");
        if (dir) {
          try { await sandbox.fs.createFolder(dir, "755"); } catch (e) { }
        }
        await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), fp);
        res.json({ success: true });
      } else if (action === "readFile") {
        const fp = normalizePath(params.filePath as string);
        try {
          const buffer = await sandbox.fs.downloadFile(fp);
          res.json({ content: buffer.toString("utf8"), exitCode: 0 });
        } catch (e: any) {
          res.json({ content: `[Error reading file: ${e.message}]`, exitCode: 1 });
        }
      } else if (action === "listFiles") {
        const rawDir = String(params.dir || SANDBOX_WORK_DIR);
        const dir = rawDir.replace(/[^a-zA-Z0-9/_.-]/g, "");
        if (!dir.startsWith("/")) return res.status(400).json({ error: "Invalid directory path" });
        const cacheKey = `${sandboxId}:${dir}`;
        const cached = fileListCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < FILE_LIST_TTL_MS) {
          return res.json({ result: cached.result, exitCode: 0, fromCache: true });
        }
        const data = await sandbox.process.executeCommand(
          `find ${dir} -maxdepth 4 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.vite/*' -type f | sort | head -300`
        );
        if (fileListCache.size >= 100) {
          const firstKey = fileListCache.keys().next().value;
          fileListCache.delete(firstKey);
        }
        fileListCache.set(cacheKey, { result: data.result || "", ts: Date.now() });
        res.json({ result: data.result || "", exitCode: data.exitCode });
      } else if (action === "startDevServer") {
        const port = Number(params.port) || 3000;
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port number");

        await waitForToolbox(sandbox, "startDevServer");

        const data = await sandbox.process.executeCommand(
          `mkdir -p ${SANDBOX_WORK_DIR} && cd ${SANDBOX_WORK_DIR} && (npm run dev -- --port ${port} --host 0.0.0.0 > /tmp/vite.log 2>&1 &)`
        );

        let previewUrl = `https://${port}-${sandboxId}.proxy.daytona.works`;
        let previewToken = "";
        try {
          const apiBase = process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
          const signedUrl = `${apiBase}/sandbox/${sandboxId}/ports/${port}/signed-preview-url?expiresInSeconds=3600`;
          const tr = await fetch(signedUrl, {
            headers: { "Authorization": `Bearer ${process.env.DAYTONA_API_KEY}` }
          });
          if (tr.ok) {
            const json = await tr.json();
            if (json.url) {
              previewUrl = json.url;
              previewToken = json.token || "";
            }
          }
        } catch (e) {
          console.error("Failed to fetch signed preview URL:", e);
        }

        lastSandboxLogs = {
          install: "Quick Start: Skipping npm install",
          vite: data.result || "Vite started in background",
          sandboxId
        };

        res.json({
          previewUrl,
          previewToken,
          serverReady: true,
          installLog: lastSandboxLogs.install,
          viteLog: lastSandboxLogs.vite
        });
      } else if (action === "getLogs") {
        const data = await sandbox.process.executeCommand(`tail -n 100 /tmp/vite.log || echo "No logs"`);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "searchFiles") {
        const rawQuery = String(params.query || "");
        const safeQuery = rawQuery.replace(/[^a-zA-Z0-9 ._\-]/g, "");
        if (!safeQuery) return res.status(400).json({ error: "Invalid search query" });
        const data = await sandbox.process.executeCommand(
          `grep -rIl -e ${JSON.stringify(safeQuery)} ${SANDBOX_WORK_DIR} | head -50`
        );
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "cloneRepo") {
        const repoUrl = (params.repoUrl as string || "").trim();
        if (!repoUrl) throw new Error("repoUrl is required");
        if (!/^https?:\/\/[a-zA-Z0-9._\-/:%@?=&#]+$/.test(repoUrl)) throw new Error("Invalid repoUrl: must be an HTTP/S URL");

        await waitForToolbox(sandbox, "cloneRepo");

        const tmpDir = `/home/daytona/repo_tmp_${Date.now()}`;
        const cloneCmd = `cd /home/daytona && git clone --depth 1 ${repoUrl} ${tmpDir} && rm -rf ${SANDBOX_WORK_DIR} && mv ${tmpDir} ${SANDBOX_WORK_DIR}`;
        const data = await sandbox.process.executeCommand(cloneCmd);
        res.json({ result: data.result || "Cloned successfully", exitCode: data.exitCode });
      } else if (action === "stop") {
        await sandbox.stop();
        res.json({ success: true });
      } else if (action === "start") {
        await sandbox.start();
        res.json({ success: true });
      } else if (action === "delete") {
        await daytona.delete(sandbox);
        res.json({ success: true });
      } else if (action === "setupWatcher") {
        const command = String(params.command || "npm run build").replace(/'/g, "'\\''");
        const watchCmd = `cd ${SANDBOX_WORK_DIR} && (npx -y nodemon --watch . --ext ts,tsx,js,jsx,css,html --exec '${command}' > /tmp/watcher.log 2>&1 &)`;
        const data = await sandbox.process.executeCommand(watchCmd);
        res.json({ success: true, message: "Watcher started", result: data.result });
      } else if (action === "deleteAll") {
        const list = await daytona.list();
        const items = (list as any).items || [];
        await Promise.allSettled(items.map((s: any) => daytona.delete(s)));
        res.json({ success: true, deletedCount: items.length });
      } else if (action === "addSecret") {
        const secretName = String(params.secretName || "").replace(/[^A-Za-z0-9_]/g, "");
        if (!secretName) return res.status(400).json({ error: "Invalid secret name" });
        const secretValue = String(params.secretValue || "").replace(/'/g, "'\\''");
        const envCmd = `printf '%s=%s\\n' ${JSON.stringify(secretName)} '${secretValue}' >> ${SANDBOX_WORK_DIR}/.env`;
        await sandbox.process.executeCommand(envCmd);
        res.json({ success: true, message: `Secret ${secretName} added.` });
      } else {
        res.status(400).json({ error: `Unknown action: ${action}` });
      }
    }
  } catch (e: any) {
    console.error("Daytona API Error:", e);
    // AggregateError (e.g. from Node fetch DNS failures) has no .message — errors are in e.errors[]
    let errMsg = e.message;
    if (!errMsg && e.errors?.length) {
      errMsg = e.errors.map((err: any) => err.message || String(err)).join("; ");
    }
    if (!errMsg) errMsg = e.constructor?.name || String(e);
    res.status(500).json({ error: errMsg });
  }
});

// ── GitHub & Vercel Deploy ───────────────────────────────────────────────────
app.post("/api/github/oauth", async (req, res) => {
  try {
    const resp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: req.body.code }),
    });
    res.json(await resp.json());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/deploy", async (req, res) => {
  try {
    const { files, projectName } = req.body;
    const fileList = Object.entries(files as Record<string, string>).map(([file, content]) => ({
      file, data: Buffer.from(content).toString("base64"), encoding: "base64"
    }));
    const resp = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: (projectName || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 52),
        files: fileList,
        projectSettings: { framework: "vite", buildCommand: "npm run build", outputDirectory: "dist" },
        public: true,
      }),
    });
    const data = await resp.json();
    res.json({ url: `https://${data.url}`, deployId: data.id, provider: "vercel" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Stripe Integration ───────────────────────────────────────────────────────
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"] as string;
    const event = process.env.STRIPE_WEBHOOK_SECRET && sig
      ? stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body.toString());

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid || session.client_reference_id;
      if (uid) {
        const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
        const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
        if (!getApps().length) initializeApp({ projectId });
        const db = databaseId ? getFirestore(databaseId) : getFirestore();
        await db.collection("users").doc(uid).set({ plan: session.metadata?.priceId?.includes("team") ? "team" : "pro", creditsUsed: 0 }, { merge: true });
      }
    }
    res.json({ received: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { priceId, successUrl, cancelUrl } = req.body;
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment", success_url: successUrl, cancel_url: cancelUrl,
    });
    res.json({ id: session.id, url: session.url });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Firecrawl Proxy ──────────────────────────────────────────────────────────
app.post("/api/firecrawl/:action", async (req, res) => {
  try {
    const resp = await fetch(`https://api.firecrawl.dev/v1/${req.params.action}`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    res.status(resp.status).json(await resp.json());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Client Application Serve ─────────────────────────────────────────────────
if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  const publicPath = path.join(process.cwd(), "dist");
  app.use(express.static(publicPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API not found" });
    res.sendFile(path.join(publicPath, "index.html"));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;