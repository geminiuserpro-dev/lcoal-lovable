import express from "express";
import path from "path";
import compression from "compression";
import Stripe from "stripe";
import { Daytona } from "@daytonaio/sdk";
import { GoogleGenAI } from "@google/genai";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, generateText, tool, stepCountIs, zodSchema } from "ai";
import { z } from "zod";

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
      console.log(`Sandbox ${sandbox.id} created. Waiting for network...`);
      await new Promise(r => setTimeout(r, 5000));
      res.json({ sandboxId: sandbox.id });
    } else if (action === "health") {
      await daytona.get(sandboxId);
      res.json({ status: "ready" });
    } else {
      const sandbox = await daytona.get(sandboxId);
      const wd = "/home/daytona/repo";
      const normalizePath = (p: string) => {
        let normalized = p;
        if (p.startsWith("/project/")) {
          normalized = p.replace("/project/", `${wd}/`);
        } else if (!p.startsWith("/")) {
          normalized = `${wd}/${p}`;
        }
        return normalized;
      };
      
      if (action === "execute") {
        const data = await sandbox.process.executeCommand(params.command);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "writeFile") {
        fileListCache.delete(`${sandboxId}:/home/daytona/repo`);
        const content = params.content || "";
        const fp = normalizePath(params.filePath);
        const dir = fp.split("/").slice(0, -1).join("/");
        if (dir) {
          try { await sandbox.fs.createFolder(dir, "755"); } catch (e) {}
        }
        await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), fp);
        res.json({ success: true });
      } else if (action === "readFile") {
        const fp = normalizePath(params.filePath as string);
        try {
          const buffer = await sandbox.fs.downloadFile(fp);
          const content = buffer.toString("utf8");
          res.json({ content, exitCode: 0 });
        } catch (e: any) {
          res.json({ content: `[Error reading file: ${e.message}]`, exitCode: 1 });
        }
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
        let ready = false;
        let delay = 2000;
        for (let i = 0; i < 10; i++) {
          try {
            await sandbox.process.executeCommand("echo ping");
            ready = true;
            break;
          } catch (e: any) {
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 10000);
          }
        }
        if (!ready) throw new Error("Sandbox Toolbox did not respond in time.");
        const data = await sandbox.process.executeCommand(`mkdir -p ${wd} && cd ${wd} && (npm run dev -- --port ${port} --host 0.0.0.0 > /tmp/vite.log 2>&1 &)`);
        let previewUrl = `https://${port}-${sandboxId}.proxy.daytona.works`;
        let previewToken = "";
        try {
          const apiBase = process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
          const signedUrl = `${apiBase}/sandbox/${sandboxId}/ports/${port}/signed-preview-url?expiresInSeconds=3600`;
          const tr = await fetch(signedUrl, { headers: { "Authorization": `Bearer ${process.env.DAYTONA_API_KEY}` } });
          if (tr.ok) {
            const json = await tr.json();
            if (json.url) { previewUrl = json.url; previewToken = json.token || ""; }
          }
        } catch (e) {}
        lastSandboxLogs = { install: "Skiping npm install", vite: data.result || "Vite started", sandboxId };
        res.json({ previewUrl, previewToken, serverReady: true, installLog: lastSandboxLogs.install, viteLog: lastSandboxLogs.vite });
      } else if (action === "getLogs") {
        const data = await sandbox.process.executeCommand(`tail -n 100 /tmp/vite.log || echo "No logs"`);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "searchFiles") {
        const data = await sandbox.process.executeCommand(`grep -rIl "${params.query}" /home/daytona/repo | head -50`);
        res.json({ result: data.result, exitCode: data.exitCode });
      } else if (action === "cloneRepo") {
        const repoUrl = (params.repoUrl as string || "").trim();
        if (!repoUrl) throw new Error("repoUrl is required");
        const tmpDir = `/home/daytona/repo_tmp_${Date.now()}`;
        const cloneCmd = `cd /home/daytona && git clone --depth 1 ${repoUrl} ${tmpDir} && rm -rf /home/daytona/repo && mv ${tmpDir} /home/daytona/repo`;
        const data = await sandbox.process.executeCommand(cloneCmd);
        res.json({ result: data.result || "Cloned successfully", exitCode: data.exitCode });
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
    res.status(500).json({ error: e.message });
  }
});

// ── Vercel AI SDK (Generative AI) ────────────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { messages, model: modelId = "gemini-1.5-flash", system, sandboxId } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set." });

    const googleAI = createGoogleGenerativeAI({ apiKey });
    const wd = "/home/daytona/repo";
    const normalizePath = (p: string) => {
      let normalized = p;
      if (p.startsWith("/project/")) {
        normalized = p.replace("/project/", `${wd}/`);
      } else if (!p.startsWith("/")) {
        normalized = `${wd}/${p}`;
      }
      return normalized;
    };

    const sandbox = sandboxId ? await getDaytona().get(sandboxId) : null;
    const model = googleAI(modelId.startsWith("gemini-3") ? modelId : "gemini-1.5-flash");

    const result = streamText({
      model,
      messages,
      system,
      stopWhen: stepCountIs(10),
      tools: {
        writeFile: tool({
          description: "Write content to a file in the sandbox.",
          parameters: z.object({
            filePath: z.string().describe("The path to the file"),
            content: z.string().describe("The content to write")
          }),
          execute: async ({ filePath, content }) => {
            if (!sandbox) return "Error: No sandbox active.";
            const fp = normalizePath(filePath);
            const dir = fp.split("/").slice(0, -1).join("/");
            if (dir) { try { await sandbox.fs.createFolder(dir, "755"); } catch (e) {} }
            await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), fp);
            return `Successfully wrote to ${filePath}`;
          }
        }),
        readFile: tool({
          description: "Read the content of a file from the sandbox.",
          parameters: z.object({ filePath: z.string().describe("The path to the file") }),
          execute: async ({ filePath }) => {
            if (!sandbox) return "Error: No sandbox active.";
            const fp = normalizePath(filePath);
            const buffer = await sandbox.fs.downloadFile(fp);
            return buffer.toString("utf8");
          }
        }),
        executeCommand: tool({
          description: "Run a shell command in the sandbox repository.",
          parameters: z.object({ command: z.string().describe("The command to execute") }),
          execute: async ({ command }) => {
            if (!sandbox) return "Error: No sandbox active.";
            const data = await sandbox.process.executeCommand(`cd ${wd} && ${command}`);
            return data.result || "Command executed";
          }
        }),
        listFiles: tool({
          description: "List files in the sandbox repository.",
          parameters: z.object({ directory: z.string().optional().describe("The directory to list") }),
          execute: async ({ directory }) => {
            if (!sandbox) return "Error: No sandbox active.";
            const data = await sandbox.process.executeCommand(`find ${directory || wd} -maxdepth 4 -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -100`);
            return data.result || "(empty)";
          }
        })
      }
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const part of result.fullStream) {
      res.write(`data: ${JSON.stringify(part)}\n\n`);
    }
    res.end();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Gemini AI (Legacy/Specific Image Tools) ──────────────────────────────────
app.post("/api/gemini", async (req, res) => {
  try {
    const { action, prompt, images } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set." });

    const genAI = new GoogleGenAI({ apiKey });
    const modelId = "gemini-3.1-flash-image-preview";
    const model = genAI.getGenerativeModel({ model: modelId });

    if (action === "generateImage") {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as any,
      });
      const response = await result.response;
      let b64 = "";
      let mimeType = "image/jpeg";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) { b64 = part.inlineData.data; mimeType = part.inlineData.mimeType || "image/jpeg"; break; }
      }
      return res.json({ b64, mimeType });

    } else if (action === "editImage") {
      const parts: any[] = (images || []).map((img: any) => ({ inlineData: { data: img.data, mimeType: img.mimeType } }));
      parts.push({ text: prompt });
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as any,
      });
      const response = await result.response;
      let b64 = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) { b64 = part.inlineData.data; break; }
      }
      return res.json({ b64 });
    }
    res.status(400).json({ error: "Invalid action." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
