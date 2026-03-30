import express from "express";
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
    if (!key) throw new Error('STRIPE_SECRET_KEY is required');
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

// ── Diagnostic endpoints ──────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, vercel: !!process.env.VERCEL });
});

app.get("/api/debug-env", (req, res) => {
  const mask = (key?: string) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : "MISSING";
  res.json({
    DAYTONA_API_KEY: mask(process.env.DAYTONA_API_KEY),
    GEMINI_API_KEY: mask(process.env.GEMINI_API_KEY),
    ANTHROPIC_API_KEY: mask(process.env.ANTHROPIC_API_KEY),
    FIRECRAWL_API_KEY: mask(process.env.FIRECRAWL_API_KEY),
  });
});

// ── Daytona API Handler ──────────────────────────────────────────────────────
app.post("/api/daytona", async (req, res) => {
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`daytona:${ip}`, 60)) return res.status(429).json({ error: "Too many requests" });

  try {
    const { action, ...params } = req.body;
    const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
    const DAYTONA_API = process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
    if (!DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set");

    const authHeaders = { "Authorization": `Bearer ${DAYTONA_API_KEY}`, "Content-Type": "application/json" };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const getToolboxProxyUrl = async (sid: string) => {
      const resp = await fetch(`${DAYTONA_API}/sandbox/${sid}`, { headers: authHeaders });
      const data = await resp.json();
      let url = data.toolboxProxyUrl || "https://proxy.app.daytona.io/toolbox";
      if (url.endsWith('/')) url = url.slice(0, -1);
      return url;
    };

    const runToolboxCommand = async (sid: string, cmd: string, opts?: any) => {
      const retries = opts?.retries ?? 8;
      const delay = opts?.retryDelayMs ?? 1200;
      let lastErr = "Unknown error";
      let proxyUrl = await getToolboxProxyUrl(sid);
      for (let i = 1; i <= retries; i++) {
        const resp = await fetch(`${proxyUrl}/${sid}/process/execute`, {
          method: "POST", headers: authHeaders, body: JSON.stringify({ command: cmd }),
        });
        if (resp.ok) return await resp.json();
        lastErr = await resp.text();
        if (i < retries) await sleep(delay * i);
      }
      throw new Error(lastErr);
    };

    const runShellCommand = (sid: string, cmd: string, opts?: any) => 
      runToolboxCommand(sid, `/bin/sh -lc '${cmd.replace(/'/g, "'\\''")}'`, opts);

    const { sandboxId, command, filePath, content, workDir = "/home/daytona/workspace" } = params;

    if (action === "create") {
      const resp = await fetch(`${DAYTONA_API}/sandbox`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ language: params.language || "typescript", isEphemeral: true }),
      });
      const data = await resp.json();
      res.json({ sandboxId: data.id, status: data.state });
    } else if (action === "execute") {
      const data = await runShellCommand(sandboxId, command);
      res.json({ result: data.result, exitCode: data.exitCode });
    } else if (action === "writeFile") {
      const b64 = Buffer.from(content || "", "utf8").toString("base64");
      await runShellCommand(sandboxId, `mkdir -p $(dirname '${filePath}') && printf '%s' '${b64}' | base64 -d > '${filePath}'`);
      res.json({ success: true });
    } else if (action === "readFile") {
      const data = await runShellCommand(sandboxId, `base64 -w 0 '${filePath}'`);
      res.json({ content: Buffer.from(data.result || "", "base64").toString("utf8") });
    } else if (action === "cloneRepo") {
      const { repoUrl } = params;
      await runShellCommand(sandboxId, `rm -rf ${workDir} && git clone --depth 1 ${repoUrl} ${workDir}`);
      res.json({ success: true });
    } else if (action === "listFiles") {
      const data = await runShellCommand(sandboxId, `find ${params.dir || workDir} -maxdepth 4 -not -path '*/node_modules/*' -type f | head -100`);
      res.json({ result: data.result });
    } else if (action === "startDevServer") {
      const port = params.port || 5173;
      await runShellCommand(sandboxId, `cd ${workDir} && npm install --legacy-peer-deps && (npx vite --host 0.0.0.0 --port ${port} > /tmp/vite.log 2>&1 &)`);
      res.json({ previewUrl: `https://${port}-${sandboxId}.proxy.daytona.works`, serverReady: true });
    } else if (action === "health") {
      const resp = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, { headers: authHeaders });
      const data = await resp.json();
      res.json({ status: data.state });
    } else {
      res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI Proxy Handlers ────────────────────────────────────────────────────────
app.post("/api/ai/gemini", async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    const { model, contents, generationConfig, system_instruction } = req.body;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig, system_instruction })
    });
    res.status(resp.status).json(await resp.json());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ai/anthropic", async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(req.body)
    });
    if (req.body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const reader = resp.body?.getReader();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else { res.status(resp.status).json(await resp.json()); }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Static Files & SPA Fallback ──────────────────────────────────────────────
const publicPath = path.join(process.cwd(), 'dist');
app.use(express.static(publicPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: "API not found" });
  res.sendFile(path.join(publicPath, 'index.html'));
});

export default app;
