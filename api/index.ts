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
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

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
    FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID ? "SET" : "MISSING",
    FIREBASE_DB_ID: process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ? "SET" : "MISSING",
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
    const SNAPSHOT_NAME = process.env.SNAPSHOT_NAME;
    if (!DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set");

    const authHeaders = { "Authorization": `Bearer ${DAYTONA_API_KEY}`, "Content-Type": "application/json" };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const getToolboxProxyUrl = async (sid: string) => {
      const resp = await fetch(`${DAYTONA_API}/sandbox/${sid}`, { headers: authHeaders });
      const data = await resp.json();
      let url = data.toolboxProxyUrl || "https://proxy.app.daytona.io/toolbox";
      if (url.endsWith("/")) url = url.slice(0, -1);
      return url;
    };

    const runToolboxCommand = async (sid: string, cmd: string, opts?: any) => {
      const retries = opts?.retries ?? 5;
      const delay = opts?.retryDelayMs ?? 1000;
      let lastErr: any = "Unknown error";
      for (let i = 0; i < retries; i++) {
        try {
          const proxyUrl = await getToolboxProxyUrl(sid);
          const resp = await fetch(`${proxyUrl}/${sid}/process/execute`, {
            method: "POST", headers: authHeaders, body: JSON.stringify({ command: cmd }),
          });
          if (resp.ok) return await resp.json();
          lastErr = new Error(`Toolbox error: ${resp.status} ${await resp.text()}`);
        } catch (e) { lastErr = e; }
        if (i < retries - 1) await sleep(delay);
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    };

    const runShellCommand = (sid: string, cmd: string, opts?: any) => 
      runToolboxCommand(sid, `/bin/sh -lc '${cmd.replace(/'/g, "'\\''")}'`, opts);

    const { sandboxId, command, filePath, content, workDir: workDirInput = "/home/daytona" } = params;
    
    // Robust directory finding: try input workDir, then fallback to common Daytona paths
    const findWorkDir = `
      if [ -d "${workDirInput}/repo" ]; then echo "${workDirInput}/repo";
      elif [ -d "/home/daytona/repo" ]; then echo "/home/daytona/repo";
      elif [ -d "/project/repo" ]; then echo "/project/repo";
      else echo "${workDirInput}"; fi
    `.trim();

    if (action === "create") {
      const body: any = { language: params.language || "typescript", isEphemeral: true };
      if (SNAPSHOT_NAME) {
        body.snapshot = SNAPSHOT_NAME;
      }
      const resp = await fetch(`${DAYTONA_API}/sandbox`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      res.json({ sandboxId: data.id, status: data.state });
    } else if (action === "execute") {
      const data = await runShellCommand(sandboxId, command);
      res.json({ result: data.result, exitCode: data.exitCode });
    } else if (action === "writeFile") {
      const b64 = Buffer.from(content || "", "utf8").toString("base64");
      const data = await runShellCommand(sandboxId, `mkdir -p $(dirname '${filePath}') && printf '%s' '${b64}' | base64 -d > '${filePath}'`);
      res.json({ success: true, result: data.result, exitCode: data.exitCode });
    } else if (action === "readFile") {
      const data = await runShellCommand(sandboxId, `base64 -w 0 '${filePath}'`);
      res.json({ content: Buffer.from(data.result || "", "base64").toString("utf8"), exitCode: data.exitCode });
    } else if (action === "cloneRepo") {
      // Clone to a predictable 'repo' subdirectory inside the workdir
      const data = await runShellCommand(sandboxId, `mkdir -p ${workDirInput} && rm -rf ${workDirInput}/repo && git clone --depth 1 ${params.repoUrl} ${workDirInput}/repo`);
      res.json({ success: true, result: data.result, exitCode: data.exitCode });
    } else if (action === "health") {
      const resp = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, { headers: authHeaders });
      const data = await resp.json();
      res.json({ status: data.state });
    } else if (action === "listFiles") {
      const wdResolved = (await runShellCommand(sandboxId, findWorkDir)).result.trim();
      const data = await runShellCommand(sandboxId, `find ${wdResolved} -maxdepth 5 -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -200`);
      res.json({ result: data.result || "", exitCode: data.exitCode });
    } else if (action === "startDevServer") {
      const port = params.port || 3000;
      const wdResolved = (await runShellCommand(sandboxId, findWorkDir)).result.trim();
      let previewToken = "";
      try {
        const tr = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/preview-token`, { headers: authHeaders });
        if (tr.ok) {
          const td = await tr.json();
          previewToken = td.token || "";
        }
      } catch (e) {
        console.error("Token fetch fail:", e);
      }
      const data = await runShellCommand(sandboxId, `cd ${wdResolved} && npm install --legacy-peer-deps && (npx vite --host 0.0.0.0 --port ${port} > /tmp/vite.log 2>&1 &)`);
      res.json({ 
        previewUrl: `https://${port}-${sandboxId}.proxy.daytona.works`, 
        previewToken, 
        serverReady: true, 
        installLog: data.result, 
        viteLog: data.result, 
        exitCode: data.exitCode 
      });
    } else if (action === "setupWatcher") {
      const wdResolved = (await runShellCommand(sandboxId, findWorkDir)).result.trim();
      const cmd = params.command || "npm run build";
      await runShellCommand(sandboxId, `cd ${wdResolved} && (npx chokidar '${params.watchDir || "src"}' -c '${cmd}' > /tmp/watcher.log 2>&1 &)`);
      res.json({ success: true });
    } else if (action === "searchFiles") {
      const wdResolved = (await runShellCommand(sandboxId, findWorkDir)).result.trim();
      const data = await runShellCommand(sandboxId, `grep -rIl "${params.query}" ${wdResolved} | head -50`);
      res.json({ result: data.result, exitCode: data.exitCode });
    } else if (action === "getLogs") {
      const data = await runShellCommand(sandboxId, `tail -n 100 /tmp/vite.log || echo "No logs"`);
      res.json({ result: data.result, exitCode: data.exitCode });
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
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${key}`, {
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
      res.setHeader("Content-Type", "text/event-stream");
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

// ── GitHub & Vercel ──────────────────────────────────────────────────────────
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

// ── Stripe ───────────────────────────────────────────────────────────────────
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
        const { initializeApp, getApps } = await import("firebase-admin/app");
        const { getFirestore } = await import("firebase-admin/firestore");
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

app.post("/api/firecrawl/:action", async (req, res) => {
  try {
    const resp = await fetch(`https://api.firecrawl.dev/v1/${req.params.action}`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    res.status(resp.status).json(await resp.json());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

const publicPath = path.join(process.cwd(), "dist");
app.use(express.static(publicPath));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API not found" });
  res.sendFile(path.join(publicPath, "index.html"));
});

export default app;
