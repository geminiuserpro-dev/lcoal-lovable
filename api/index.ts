import express from "express";
import path from "path";
import compression from "compression";
import Stripe from "stripe";
import { Daytona } from "@daytonaio/sdk";

// ── Rate Limiter ─────────────────────────────────────────────────────────────
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

let lastSandboxLogs = { install: "", vite: "", sandboxId: "" };
const fileListCache = new Map<string, { result: string; ts: number }>();
const FILE_LIST_TTL_MS = 30_000;

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
// Only proxies the initial HTML load, adding X-Daytona-Skip-Preview-Warning so
// the iframe never sees Daytona's warning page (which has an HTTP form action).
// A <base href> is injected so all sub-resources (JS, CSS, WS) resolve from the
// real Daytona origin directly — avoiding the proxy MIME-type mismatch.
app.get("/api/preview-proxy", async (req: any, res: any) => {
  const target = req.query.target as string;
  if (!target) return res.status(400).send("Missing target");
  try {
    const url = new URL(target);
    // Safety: only proxy daytona domains
    if (!url.hostname.endsWith(".daytonaproxy01.net") && !url.hostname.endsWith(".proxy.daytona.works")) {
      return res.status(403).send("Forbidden: only Daytona proxy URLs allowed");
    }

    // Build canonical origin for base href (https, no query string)
    const origin = `${url.protocol}//${url.hostname}`;
    const httpsOrigin = origin.replace("http://", "https://");

    // Extract token from query string if present (for X-Daytona-Preview-Token header)
    const token = url.searchParams.get("token") || url.hostname.split("-").slice(1).join("-").split(".")[0] || "";

    const upstream = await fetch(target, {
      headers: {
        "X-Daytona-Skip-Preview-Warning": "true",
        ...(token ? { "X-Daytona-Preview-Token": token } : {}),
        "User-Agent": "Mozilla/5.0 (compatible; VercelProxy/1.0)",
      },
    });

    // Rewrite & inject base href into the HTML so sub-resources load from Daytona origin
    const ct = upstream.headers.get("content-type") || "";
    res.status(upstream.status);
    // Skip hop-by-hop headers, allow CORS from our origin
    const skipHeaders = new Set(["transfer-encoding", "connection", "keep-alive", "content-security-policy"]);
    upstream.headers.forEach((v, k) => {
      if (!skipHeaders.has(k.toLowerCase())) res.setHeader(k, v);
    });
    res.setHeader("Content-Security-Policy", "");

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      // Rewrite any http:// → https:// to prevent mixed content from Daytona's HTML
      html = html.replace(/http:\/\//g, "https://");
      // Inject <base href> so relative paths (JS modules, CSS, WS) resolve from Daytona origin
      const baseTag = `<base href="${httpsOrigin}/">`;
      html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
      if (!html.includes(baseTag)) html = baseTag + html; // fallback if no <head>
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






app.get("/api/sandbox-logs", (req, res) => {
  res.json(lastSandboxLogs);
});

app.get("/api/sandboxes", async (req, res) => {
  try {
    const daytona = getDaytona();
    const list = await daytona.list();
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

// ── Daytona API Handler (Refactored to SDK) ──────────────────────────────────
app.post("/api/daytona", async (req, res) => {
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`daytona:${ip}`, 60)) return res.status(429).json({ error: "Too many requests" });

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
      
      // Add minimal delay for toolbox to breathe
      console.log(`Sandbox ${sandbox.id} created. Waiting for network...`);
      await new Promise(r => setTimeout(r, 5000));
      
      res.json({ sandboxId: sandbox.id });
    } else if (action === "health") {
      const sandbox = await daytona.get(sandboxId);
      res.json({ status: "ready" }); // Simplified for SDK
    } else {
      const sandbox = await daytona.get(sandboxId);
      
      if (action === "execute") {
        const data = await sandbox.process.executeCommand(params.command);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "writeFile") {
        fileListCache.delete(`${sandboxId}:/home/daytona/repo`); // invalidate on write
        const b64 = Buffer.from(params.content || "", "utf8").toString("base64");
        const data = await sandbox.process.executeCommand(`mkdir -p $(dirname '${params.filePath}') && printf '%s' '${b64}' | base64 -d > '${params.filePath}'`);
        res.json({ success: true, result: data.result, exitCode: data.exitCode });
      } else if (action === "readFile") {
        const data = await sandbox.process.executeCommand(`base64 -w 0 '${params.filePath}'`);
        res.json({ content: Buffer.from(data.result || "", "base64").toString("utf8"), exitCode: data.exitCode });
      } else if (action === "listFiles") {
        const dir = params.dir || "/home/daytona/repo";
        const cacheKey = `${sandboxId}:${dir}`;
        const cached = fileListCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < FILE_LIST_TTL_MS) {
          return res.json({ result: cached.result, exitCode: 0, fromCache: true });
        }
        const data = await sandbox.process.executeCommand(
          `find ${dir} -maxdepth 4 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.vite/*' -type f | sort | head -300`
        );
        fileListCache.set(cacheKey, { result: data.result || "", ts: Date.now() });
        res.json({ result: data.result || "", exitCode: data.exitCode });
      } else if (action === "startDevServer") {
        const port = params.port || 3000;
        const wd = "/home/daytona/repo";

        // Wait for Toolbox to be network-ready before running any command
        let ready = false;
        let delay = 2000;
        for (let i = 0; i < 10; i++) {
          try {
            await sandbox.process.executeCommand("echo ping");
            ready = true;
            break;
          } catch (e: any) {
            const isConnErr = e.name === "AggregateError" || (e.message || "").includes("Timeout");
            console.warn(`[startDevServer] Toolbox check ${i+1}: ${isConnErr ? "Waiting..." : e.message}`);
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 10000);
          }
        }
        if (!ready) throw new Error("Sandbox Toolbox did not respond in time. Cannot start dev server.");

        // Start dev server from a stable dir to avoid getcwd issues
        const data = await sandbox.process.executeCommand(`mkdir -p ${wd} && cd ${wd} && (npm run dev -- --port ${port} --host 0.0.0.0 > /tmp/vite.log 2>&1 &)`);

        // Fetch SIGNED preview URL (token embedded in URL — no OAuth redirect needed)
        // Standard token causes browser OAuth → 400 "authentication state verification failed"
        let previewUrl = `https://${port}-${sandboxId}.proxy.daytona.works`; // fallback
        let previewToken = "";
        try {
          const apiBase = process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
          const signedUrl = `${apiBase}/sandbox/${sandboxId}/ports/${port}/signed-preview-url?expiresInSeconds=3600`;
          const tr = await fetch(signedUrl, {
            headers: { "Authorization": `Bearer ${process.env.DAYTONA_API_KEY}` }
          });
          if (tr.ok) {
            const json = await tr.json();
            // Signed URL format: https://{port}-{token}.proxy.daytona.works
            // This bypasses OAuth and works directly in iframes
            if (json.url) {
              previewUrl = json.url;
              previewToken = json.token || "";
            }
          } else {
            console.error(`Signed preview URL fetch failed: ${tr.status} ${tr.statusText}`);
          }
        } catch (e) {
          console.error("Failed to fetch signed preview URL:", e);
        }

        lastSandboxLogs = { 
          install: "Quick Start: Skipping npm install", 
          vite: data.result || "Vite started in background", 
          sandboxId: sandboxId 
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
        const data = await sandbox.process.executeCommand(`grep -rIl "${params.query}" /home/daytona/repo | head -50`);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "cloneRepo") {
        const repoUrl = (params.repoUrl as string || "").trim();
        if (!repoUrl) throw new Error("repoUrl is required");
        
        // Robust polling for network-readiness (Daytona Toolbox)
        let ready = false;
        let delay = 2000;
        for (let i = 0; i < 10; i++) {
          try {
            await sandbox.process.executeCommand("echo ping");
            ready = true;
            break;
          } catch (e: any) {
            const isConnErr = e.name === "AggregateError" || e.message.includes("Timeout");
            console.warn(`Sandbox connectivity check ${i+1}: ${isConnErr ? "Waiting for Toolbox..." : e.message}`);
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 10000); // Exponential backoff max 10s
          }
        }
        if (!ready) throw new Error("Sandbox Toolbox failed to respond. Network stability issues detected.");

        const tmpDir = `/home/daytona/repo_tmp_${Date.now()}`;
        const cloneCmd = `cd /home/daytona && git clone --depth 1 ${repoUrl} ${tmpDir} && rm -rf /home/daytona/repo && mv ${tmpDir} /home/daytona/repo`;
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
      } else if (action === "deleteAll") {
        const list = await daytona.list();
        const items = (list as any).items || [];
        await Promise.allSettled(items.map((s: any) => daytona.delete(s)));
        res.json({ success: true, deletedCount: items.length });
      } else if (action === "setupWatcher") {
        const wd = "/home/daytona/repo";
        const command = params.command || "npm run build";
        const watchCmd = `cd ${wd} && (npx -y nodemon --watch . --ext ts,tsx,js,jsx,css,html --exec "${command}" > /tmp/watcher.log 2>&1 &)`;
        const data = await sandbox.process.executeCommand(watchCmd);
        res.json({ success: true, message: "Watcher started", result: data.result });
      } else if (action === "addSecret") {
        const { secretName, secretValue } = params;
        const envCmd = `echo "${secretName}=${secretValue}" >> /home/daytona/repo/.env`;
        await sandbox.process.executeCommand(envCmd);
        res.json({ success: true, message: `Secret ${secretName} added.` });
      } else {
        res.status(400).json({ error: `Unknown action: ${action}` });
      }
    }
  } catch (e: any) {
    console.error("Daytona API Error:", e);
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
