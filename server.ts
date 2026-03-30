import "dotenv/config";
import express from "express";
// Vite is imported dynamically in startServer to avoid crashing in production where it is missing
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
const PORT = 3000;

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

// Preview proxy endpoint to bypass Daytona warning
app.get("/api/sandbox-logs", (req, res) => {
  res.json(lastSandboxLogs);
});

app.get("/api/sandboxes", async (req, res) => {
  try {
    const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
    const DAYTONA_API = process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
    const response = await fetch(`${DAYTONA_API}/sandbox`, {
      headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` }
    });
    res.json(await response.json());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
  // Rate limit: 60 sandbox operations per minute per IP
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`daytona:${ip}`, 60)) {
    return res.status(429).json({ error: "Too many requests. Please slow down." });
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
      let url = data.toolboxProxyUrl;
      if (!url) {
        url = "https://proxy.app.daytona.io/toolbox";
      }
      if (url.endsWith('/')) {
        url = url.slice(0, -1);
      }
      return url;
    };

    const runToolboxCommand = async (
      sid: string,
      cmd: string,
      options?: { retries?: number; retryDelayMs?: number }
    ) => {
      const retries = options?.retries ?? 8;
      const retryDelayMs = options?.retryDelayMs ?? 1200;
      let lastError = "Unknown toolbox error";

      let proxyUrl = "https://proxy.app.daytona.io/toolbox";
      try {
        proxyUrl = await getToolboxProxyUrl(sid);
      } catch (e) {
        console.warn("Failed to get toolbox proxy URL, falling back to default", e);
      }

      for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(`${proxyUrl}/${sid}/process/execute`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ command: cmd }),
        });

        if (response.ok) return await response.json();

        const text = await response.text();
        lastError = `Execute failed [${response.status}]: ${text}`;
        const retryable =
          (response.status === 404 && text.includes("sandbox container not found")) ||
          (response.status === 409 && text.toLowerCase().includes("not ready")) ||
          response.status >= 500;

        if (!retryable || attempt === retries) break;
        await sleep(retryDelayMs * attempt);
      }

      throw new Error(lastError);
    };

    const escapeForSingleQuotes = (input: string) => input.replace(/'/g, `'"'"'`);

    const runShellCommand = async (
      sid: string,
      cmd: string,
      options?: { retries?: number; retryDelayMs?: number }
    ) => {
      const wrapped = `/bin/sh -lc '${escapeForSingleQuotes(cmd)}'`;
      return await runToolboxCommand(sid, wrapped, options);
    };

    const sandboxId = params.sandboxId as string | undefined;
    const command = params.command as string | undefined;
    const filePath = params.filePath as string | undefined;
    const fileContent = params.content as string | undefined;
    const language = params.language as string | undefined;
    const searchQuery = params.query as string | undefined;
    const includePattern = params.includePattern as string | undefined;
    const caseSensitive = params.caseSensitive as boolean | undefined;
    const workDir = (params.workDir as string) || "/home/daytona/workspace";
    const port = params.port as number | undefined;

    if (action === "create") {
      const response = await fetch(`${DAYTONA_API}/sandbox`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          language: language || "typescript",
          isEphemeral: true,
          autoStopInterval: 30, // Auto-stop after 30 mins of inactivity
          autoDeleteInterval: 60 // Auto-delete after 60 mins of inactivity
        }),
      });
      if (!response.ok) throw new Error(`Failed to create sandbox: ${await response.text()}`);
      const data = await response.json();

      // We return immediately without waiting for "ready" to avoid Vercel timeouts.
      // The frontend should poll the "health" endpoint to know when to proceed.
      res.json({ sandboxId: data.id, status: data.state });
    }
    else if (action === "execute") {
      if (!sandboxId) throw new Error("sandboxId is required");
      if (!command) throw new Error("command is required");
      const data = await runShellCommand(sandboxId, command, { retries: 10, retryDelayMs: 1000 });
      res.json({ result: data.result, exitCode: data.exitCode });
    }
    else if (action === "writeFile") {
      if (!sandboxId || !filePath) throw new Error("sandboxId and filePath are required");

      const content = fileContent ?? "";

      // Strategy 1: Use Daytona SDK uploadFile if available
      try {
        const { Daytona } = await import("@daytonaio/sdk");
        const daytona = new Daytona({ apiKey: DAYTONA_API_KEY, serverUrl: DAYTONA_API });
        const sandbox = await daytona.get(sandboxId);
        if (typeof (sandbox as any).uploadFile === "function") {
          await (sandbox as any).uploadFile(filePath, content);
          return res.json({ success: true });
        }
      } catch (e) {
        console.warn("SDK uploadFile failed, falling back to toolbox upload", e);
      }

      // Strategy 2: Use toolbox files/upload with proper Node.js FormData + Blob
      try {
        const proxyUrl = await getToolboxProxyUrl(sandboxId);
        const encodedPath = encodeURIComponent(filePath);
        const fileName = filePath.split("/").pop() || "file";

        const form = new FormData();
        form.append("file", new Blob([content], { type: "text/plain" }), fileName);

        const response = await fetch(
          `${proxyUrl}/${sandboxId}/files/upload?path=${encodedPath}`,
          {
            method: "POST",
            headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` },
            body: form,
          }
        );
        if (response.ok) return res.json({ success: true });
        console.warn("Toolbox upload failed:", await response.text(), "- falling back to shell write");
      } catch (e) {
        console.warn("Toolbox upload threw, falling back to shell write", e);
      }

      // Strategy 3: Write via shell using base64 encoding (most reliable for any content)
      // Encode content to base64, write a temp file, decode it into place
      const b64 = Buffer.from(content, "utf8").toString("base64");
      // Write in chunks if large (avoid ARG_MAX limits)
      const CHUNK = 50000; // ~50KB per chunk safe for shell
      const dir = filePath.split("/").slice(0, -1).join("/");
      if (dir) {
        await runShellCommand(sandboxId, `mkdir -p ${dir}`, { retries: 3, retryDelayMs: 500 });
      }
      // Clear the file first
      await runShellCommand(sandboxId, `printf '' > '${filePath}'`, { retries: 3, retryDelayMs: 500 });

      for (let i = 0; i < b64.length; i += CHUNK) {
        const chunk = b64.slice(i, i + CHUNK);
        await runShellCommand(
          sandboxId,
          `printf '%s' '${chunk.replace(/'/g, "'\''")}' | base64 -d >> '${filePath}'`,
          { retries: 3, retryDelayMs: 500 }
        );
      }

      res.json({ success: true });
    }
    else if (action === "readFile") {
      if (!sandboxId || !filePath) throw new Error("sandboxId and filePath are required");

      // Strategy 1: SDK downloadFile
      try {
        const { Daytona } = await import("@daytonaio/sdk");
        const daytona = new Daytona({ apiKey: DAYTONA_API_KEY, serverUrl: DAYTONA_API });
        const sandbox = await daytona.get(sandboxId);
        if (typeof (sandbox as any).downloadFile === "function") {
          const content = await (sandbox as any).downloadFile(filePath);
          return res.json({ content });
        }
      } catch (e) {
        console.warn("SDK downloadFile failed, falling back to toolbox download", e);
      }

      // Strategy 2: Toolbox files/download endpoint
      try {
        const encodedPath = encodeURIComponent(filePath);
        const proxyUrl = await getToolboxProxyUrl(sandboxId);
        const response = await fetch(
          `${proxyUrl}/${sandboxId}/files/download?path=${encodedPath}`,
          { method: "GET", headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` } }
        );
        if (response.ok) {
          const content = await response.text();
          return res.json({ content });
        }
        console.warn("Toolbox download failed:", response.status, "- falling back to shell cat");
      } catch (e) {
        console.warn("Toolbox download threw, falling back to shell cat", e);
      }

      // Strategy 3: Read via shell cat + base64 (handles any file)
      const catResult = await runShellCommand(sandboxId, `base64 -w 0 '${filePath}' 2>/dev/null || cat '${filePath}' | base64 -w 0`, { retries: 3, retryDelayMs: 500 });
      const content = Buffer.from((catResult.result || "").trim(), "base64").toString("utf8");
      res.json({ content });
    }
    else if (action === "delete") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const response = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
        method: "DELETE",
        headers: authHeaders
      });
      if (!response.ok) throw new Error(`Delete sandbox failed: ${await response.text()}`);
      res.json({ success: true });
    }
    else if (action === "deleteAll") {
      const listResponse = await fetch(`${DAYTONA_API}/sandbox`, {
        headers: authHeaders
      });
      if (!listResponse.ok) throw new Error(`Failed to list sandboxes: ${await listResponse.text()}`);
      const sandboxes = await listResponse.json();

      const results = await Promise.allSettled(
        sandboxes.map((s: any) => {
          // Don't delete the one we might be currently using if it's passed
          if (sandboxId && s.id === sandboxId) return Promise.resolve();
          return fetch(`${DAYTONA_API}/sandbox/${s.id}`, {
            method: "DELETE",
            headers: authHeaders
          });
        })
      );

      res.json({
        success: true,
        deletedCount: results.filter(r => r.status === 'fulfilled').length
      });
    }
    else if (action === "stop") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const response = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/stop`, {
        method: "POST",
        headers: authHeaders
      });
      if (!response.ok) throw new Error(`Stop sandbox failed: ${await response.text()}`);
      res.json({ success: true });
    }
    else if (action === "start") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const response = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/start`, {
        method: "POST",
        headers: authHeaders
      });
      if (!response.ok) throw new Error(`Start sandbox failed: ${await response.text()}`);
      res.json({ success: true });
    }
    else if (action === "health") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const response = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
        headers: authHeaders
      });
      if (!response.ok) throw new Error(`Health check failed: ${await response.text()}`);
      const data = await response.json();
      res.json({ status: data.state });
    }
    else if (action === "searchFiles") {
      if (!sandboxId) throw new Error("sandboxId is required");
      if (!searchQuery) throw new Error("query is required");
      const caseFlag = caseSensitive ? "" : "-i";
      const pattern = includePattern || ".";
      const grepCmd = `cd ${workDir} && grep -rn ${caseFlag} "${searchQuery}" ${pattern} 2>/dev/null | head -50`;
      const data = await runShellCommand(sandboxId, grepCmd, { retries: 4, retryDelayMs: 500 });
      res.json({ result: data.result || "No matches found", exitCode: data.exitCode });
    }
    else if (action === "cloneRepo") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const repoUrl = (params.repoUrl as string | undefined)?.trim();
      if (!repoUrl) throw new Error("repoUrl is required");

      if (!/^https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+(\.git)?$/i.test(repoUrl)) {
        throw new Error("Invalid repository URL. Use a full HTTPS git URL.");
      }

      const lsRemoteData = await runShellCommand(
        sandboxId,
        `git ls-remote ${repoUrl}`,
        { retries: 6, retryDelayMs: 1000 }
      );
      if (!(lsRemoteData.result || "").trim()) {
        throw new Error("Clone failed: repository unreachable, private, or invalid URL");
      }

      const tmpDir = `/home/daytona/repo_tmp_${Date.now()}`;
      const cloneCmd = [
        `rm -rf ${tmpDir}`,
        `git clone --depth 1 ${repoUrl} ${tmpDir}`,
        `rm -rf /home/daytona/repo`,
        `mv ${tmpDir} /home/daytona/repo`
      ].join(" && ");

      const cloneData = await runShellCommand(
        sandboxId,
        cloneCmd,
        { retries: 3, retryDelayMs: 2000 }
      );

      if (cloneData.exitCode !== 0) {
        // If the above failed, try a more desperate cleanup
        await runShellCommand(sandboxId, "chmod -R 777 /home/daytona/repo 2>/dev/null || true; rm -rf /home/daytona/repo");
        const secondAttempt = await runShellCommand(sandboxId, `git clone --depth 1 ${repoUrl} /home/daytona/repo`, { retries: 5, retryDelayMs: 2000 });
        if (secondAttempt.exitCode !== 0) {
          throw new Error(`Clone failed: ${secondAttempt.result || cloneData.result || "Unknown error"}`);
        }
      }

      const verifyData = await runShellCommand(
        sandboxId,
        "git -C /home/daytona/repo rev-parse --is-inside-work-tree",
        { retries: 2, retryDelayMs: 500 }
      );
      const verified = (verifyData.result || "").trim() === "true";

      if (!verified) {
        throw new Error(`Clone failed: ${cloneData.result || "Repository not accessible or does not exist"}`);
      }

      res.json({ result: cloneData.result || "Cloned successfully", exitCode: 0 });
    }
    else if (action === "listFiles") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const dir = (params.dir as string) || workDir;
      const listCmd = `find ${dir} -maxdepth 5 -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -200`;
      const listData = await runShellCommand(sandboxId, listCmd, { retries: 4, retryDelayMs: 500 });
      res.json({ result: listData.result || "", exitCode: listData.exitCode });
    }
    else if (action === "getLogs") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const search = (params.search as string) || "";
      const grepCmd = search
        ? `grep -i "${search}" /tmp/vite.log 2>/dev/null | tail -50`
        : `cat /tmp/vite.log 2>/dev/null | tail -50`;
      const logData = await runShellCommand(sandboxId, grepCmd, { retries: 2, retryDelayMs: 200 });
      res.json({ result: logData.result || "No logs found", exitCode: logData.exitCode });
    }
    else if (action === "addSecret") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const { secretName, secretValue } = params;
      if (!secretName) throw new Error("secretName is required");

      // In a real app, we'd prompt the user. Here we'll append to .env in the sandbox
      // If secretValue is not provided, we'll just return a success message assuming it's handled
      if (secretValue) {
        const envCmd = `echo "${secretName}=${secretValue}" >> ${workDir}/.env`;
        await runShellCommand(sandboxId, envCmd);
        res.json({ success: true, message: `Secret ${secretName} added to .env` });
      } else {
        // This is where we'd normally trigger a UI prompt. 
        // For now, let's just simulate it.
        res.json({ success: true, message: `Secret ${secretName} requested. Please provide the value.` });
      }
    }
    else if (action === "startDevServer") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const portNum = (port as number) || 5173;
      const wd = workDir || "/home/daytona/workspace";

      // Ensure directory exists
      await runToolboxCommand(sandboxId, `mkdir -p ${wd}`);

      const installData = await runShellCommand(
        sandboxId,
        `cd ${wd} && npm install --legacy-peer-deps 2>&1 | tail -20`,
        { retries: 10, retryDelayMs: 1000 }
      );

      try {
        await runShellCommand(sandboxId, `lsof -ti:${portNum} | xargs kill -9 2>/dev/null || true`, {
          retries: 1,
          retryDelayMs: 200,
        });
      } catch { }

      await runShellCommand(
        sandboxId,
        `cd ${wd} && npx vite --host 0.0.0.0 --port ${portNum} > /tmp/vite.log 2>&1 &`,
        { retries: 6, retryDelayMs: 800 }
      );

      let serverReady = false;
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        try {
          const checkData = await runShellCommand(
            sandboxId,
            `curl -s -o /dev/null -w "%{http_code}" http://localhost:${portNum} 2>/dev/null || echo "000"`,
            { retries: 1, retryDelayMs: 200 }
          );
          const statusCode = (checkData.result || "").trim();
          if (statusCode === "200" || statusCode === "304" || statusCode === "302") {
            serverReady = true;
            break;
          }
        } catch { }
      }

      let viteLog = "";
      try {
        const logData = await runShellCommand(sandboxId, "cat /tmp/vite.log 2>/dev/null | tail -20", {
          retries: 1,
          retryDelayMs: 200,
        });
        viteLog = logData.result || "";
      } catch { }

      lastSandboxLogs = { install: installData.result || "", vite: viteLog, sandboxId };
      console.log(`Sandbox ${sandboxId} Dev Server logs:`);
      console.log(`Install log: ${installData.result}`);
      console.log(`Vite log: ${viteLog}`);

      let previewUrl = `https://${portNum}-${sandboxId}.proxy.daytona.works`;
      let previewToken = "";

      try {
        const { Daytona } = await import("@daytonaio/sdk");
        const daytona = new Daytona({
          apiKey: DAYTONA_API_KEY,
          serverUrl: DAYTONA_API,
        });
        const sandbox = await daytona.get(sandboxId);
        // 86400 is 24 hours
        const previewData = await sandbox.getSignedPreviewUrl(portNum, 86400);
        if (previewData.url) {
          previewUrl = previewData.url;
          // Add a flag to disable the preview warning if the proxy supports it
          if (!previewUrl.includes("?")) {
            previewUrl += "?disable_preview_warning=true";
          } else {
            previewUrl += "&disable_preview_warning=true";
          }
        }
        if (previewData.token) previewToken = previewData.token;
      } catch (e: any) {
        console.error("Failed to get signed preview URL via SDK:", e);
      }

      console.log(`Preview URL: ${previewUrl}`);

      res.json({
        previewUrl,
        previewToken,
        port: portNum,
        installLog: installData.result || "",
        viteLog,
        serverReady,
      });
    }
    else if (action === "setupWatcher") {
      if (!sandboxId) throw new Error("sandboxId is required");
      const wd = workDir || "/home/daytona/workspace";
      const watchDir = params.watchDir || "src";
      const command = params.command || "npm run build";

      // Kill any existing nodemon processes to avoid duplicates
      try {
        await runShellCommand(sandboxId, "pkill -f nodemon || true");
      } catch { }

      // Start nodemon in background to watch src and run build
      // We use --watch to specify the directory and --exec to specify the command
      const watchCmd = `cd ${wd} && npx -y nodemon --watch ${watchDir} --ext ts,tsx,js,jsx,css,html --exec "${command}" > /tmp/watcher.log 2>&1 &`;

      const result = await runShellCommand(sandboxId, watchCmd);
      res.json({ success: true, message: "Watcher started", result: result.result });
    }
    else {
      res.status(400).json({ error: "Unknown action" });
    }
  } catch (error: any) {
    console.error("Daytona error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Firecrawl endpoints
app.post("/api/firecrawl/:action", async (req, res) => {
  try {
    const { action } = req.params;
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is not set");
    }

    const response = await fetch(`https://api.firecrawl.dev/v1/${action}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("Firecrawl error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Rate-limited AI endpoint helper ───────────────────────────────────────────
app.use("/api/ai", (req, res, next) => {
  const ipHeader = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string || (req as any).ip || "unknown");
  const ip = ipRaw.split(",")[0].trim();
  if (!rateLimit(`ai:${ip}`, 20)) {
    return res.status(429).json({ error: "Rate limit exceeded. Max 20 AI requests per minute." });
  }
  next();
});

// ── GitHub OAuth token exchange ────────────────────────────────────────────────
app.post("/api/github/oauth", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: "GitHub OAuth not configured" });

    const resp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error_description || data.error });
    res.json({ access_token: data.access_token });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deploy to Vercel via server ────────────────────────────────────────────────
app.post("/api/deploy", async (req, res) => {
  try {
    const { files, projectName } = req.body;
    const token = process.env.VERCEL_TOKEN;
    if (!token) return res.status(500).json({ error: "VERCEL_TOKEN not configured" });

    const fileList = Object.entries(files as Record<string, string>).map(([file, content]) => ({
      file,
      data: Buffer.from(content).toString("base64"),
      encoding: "base64",
    }));

    const safeName = (projectName || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 52);
    const resp = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: safeName,
        files: fileList,
        projectSettings: { framework: "vite", buildCommand: "npm run build", outputDirectory: "dist" },
        public: true,
      }),
    });
    if (!resp.ok) throw new Error(`Vercel error: ${await resp.text()}`);
    const data = await resp.json();
    res.json({ url: `https://${data.url}`, deployId: data.id, provider: "vercel" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe endpoints ───────────────────────────────────────────────────────────
// Webhook to upgrade user plan after successful payment
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: any;
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const priceId = session.metadata?.priceId || session.line_items?.data?.[0]?.price?.id || "";
      const uid = session.metadata?.uid || session.client_reference_id;
      if (uid) {
        const plan = priceId.includes("team") ? "team" : "pro";
        const { initializeApp, getApps } = await import("firebase-admin/app");
        const { getFirestore } = await import("firebase-admin/firestore");
        if (!getApps().length) initializeApp();
        const db = getFirestore();
        await db.collection("users").doc(uid).set({ plan, creditsUsed: 0 }, { merge: true });
      }
    }
    res.json({ received: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Stripe endpoints
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const stripe = getStripe();
    const { priceId, successUrl, cancelUrl } = req.body;

    if (!priceId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({ id: session.id, url: session.url });
  } catch (error: any) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  // Vite middleware for development (only when not in production and not in Vercel)
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn("Vite failed to load (expected on production Vercel):", err);
    }
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only start the server locally if not on Vercel
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer();
}

// Export for Vercel serverless functions
export default app;
