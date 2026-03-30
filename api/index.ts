import express from "express";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import compression from "compression";
import Stripe from "stripe";

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}
// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

const app = express();

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

let lastSandboxLogs = { install: "", vite: "", sandboxId: "" };

// Diagnostic endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, vercel: !!process.env.VERCEL });
});

app.get("/api/debug-env", (req, res) => {
  const mask = (key?: string) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : "MISSING";
  res.json({
    DAYTONA_API_KEY: mask(process.env.DAYTONA_API_KEY),
    GEMINI_API_KEY: mask(process.env.GEMINI_API_KEY),
    STRIPE_SECRET_KEY: mask(process.env.STRIPE_SECRET_KEY),
    FIRECRAWL_API_KEY: mask(process.env.FIRECRAWL_API_KEY),
  });
});

// Daytona endpoint
app.post("/api/daytona", async (req, res) => {
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`daytona:${ip}`, 60)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const { action, ...params } = req.body;
    const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
    const DAYTONA_API = process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";

    if (!DAYTONA_API_KEY) {
      throw new Error("DAYTONA_API_KEY is not set");
    }

    const authHeaders = {
      "Authorization": `Bearer ${DAYTONA_API_KEY}`,
      "Content-Type": "application/json"
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const getToolboxProxyUrl = async (sid: string) => {
      const response = await fetch(`${DAYTONA_API}/sandbox/${sid}`, {
        headers: authHeaders
      });
      if (!response.ok) {
        throw new Error(`Failed to get sandbox details: ${await response.text()}`);
      }
      const data = await response.json();
      let url = data.toolboxProxyUrl || "https://proxy.app.daytona.io/toolbox";
      if (url.endsWith('/')) url = url.slice(0, -1);
      return url;
    };

    const runToolboxCommand = async (sid: string, cmd: string, options?: { retries?: number; retryDelayMs?: number }) => {
      const retries = options?.retries ?? 8;
      const retryDelayMs = options?.retryDelayMs ?? 1200;
      let lastError = "Unknown toolbox error";
      let proxyUrl = "https://proxy.app.daytona.io/toolbox";
      try { proxyUrl = await getToolboxProxyUrl(sid); } catch (e) {}

      for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(`${proxyUrl}/${sid}/process/execute`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ command: cmd }),
        });
        if (response.ok) return await response.json();
        const text = await response.text();
        lastError = `Execute failed: ${text}`;
        if (attempt === retries) break;
        await sleep(retryDelayMs * attempt);
      }
      throw new Error(lastError);
    };

    const escapeForSingleQuotes = (input: string) => input.replace(/'/g, `'"'"'`);
    const runShellCommand = async (sid: string, cmd: string, options?: { retries?: number; retryDelayMs?: number }) => {
      const wrapped = `/bin/sh -lc '${escapeForSingleQuotes(cmd)}'`;
      return await runToolboxCommand(sid, wrapped, options);
    };

    const sandboxId = params.sandboxId as string | undefined;
    const command = params.command as string | undefined;
    const filePath = params.filePath as string | undefined;
    const content = params.content as string | undefined;

    if (action === "create") {
      const response = await fetch(`${DAYTONA_API}/sandbox`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ language: params.language || "typescript", isEphemeral: true }),
      });
      if (!response.ok) throw new Error(`Failed to create sandbox: ${await response.text()}`);
      const data = await response.json();
      res.json({ sandboxId: data.id, status: data.state });
    } else if (action === "execute") {
      if (!sandboxId || !command) throw new Error("Missing params");
      const data = await runShellCommand(sandboxId, command);
      res.json({ result: data.result, exitCode: data.exitCode });
    } else if (action === "writeFile") {
      if (!sandboxId || !filePath) throw new Error("Missing params");
      const b64 = Buffer.from(content || "", "utf8").toString("base64");
      await runShellCommand(sandboxId, `mkdir -p $(dirname '${filePath}') && printf '%s' '${b64}' | base64 -d > '${filePath}'`);
      res.json({ success: true });
    } else if (action === "readFile") {
      if (!sandboxId || !filePath) throw new Error("Missing params");
      const catResult = await runShellCommand(sandboxId, `cat '${filePath}' | base64 -w 0`);
      const resContent = Buffer.from(catResult.result || "", "base64").toString("utf8");
      res.json({ content: resContent });
    } else if (action === "health") {
      if (!sandboxId) throw new Error("Missing sandboxId");
      const response = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, { headers: authHeaders });
      const data = await response.json();
      res.json({ status: data.state });
    } else {
      res.status(400).json({ error: "Unknown action" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI endpoints
app.use("/api/ai", (req, res, next) => {
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`ai:${ip}`, 20)) return res.status(429).json({ error: "Rate limit exceeded" });
  next();
});

// ── Fallback for single page app ──────────────────────────────────────────────
const publicPath = path.join(process.cwd(), 'dist');
app.use(express.static(publicPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: "API route not found" });
  res.sendFile(path.join(publicPath, 'index.html'));
});

export default app;
