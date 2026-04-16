export interface SandboxState {
  sandboxId: string | null;
  status: "idle" | "creating" | "ready" | "error";
  error?: string;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 5) {
  for (let i = 0; i < retries; i++) {
    let resp: Response;
    try {
      resp = await fetch(url, options);
    } catch (networkErr: any) {
      // fetch() itself threw — network unreachable, ECONNREFUSED, DNS failure, etc.
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      throw new Error(`Network error: ${networkErr.message || String(networkErr)}`);
    }

    const contentType = resp.headers.get("content-type");
    
    if (!resp.ok) {
      const text = await resp.text();
      if (i < retries - 1 && (text.includes("failed to resolve container IP") || text.includes("Is the Sandbox started?") || text.includes("Sandbox not found"))) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      throw new Error(text || `HTTP error! status: ${resp.status}`);
    }

    if (contentType && contentType.includes("application/json")) {
      const data = await resp.json();
      if (data.error) {
        if (i < retries - 1 && (data.error.includes("failed to resolve container IP") || data.error.includes("Is the Sandbox started?") || data.error.includes("Sandbox not found"))) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        throw new Error(data.error);
      }
      return data;
    } else {
      // If not JSON, return as text or just success
      const text = await resp.text();
      return { result: text, success: true };
    }
  }
  throw new Error("Failed after retries");
}

export async function createSandbox(language = "typescript") {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", language }),
  });
  return data as { sandboxId: string; status: string };
}

export async function executeCommand(sandboxId: string, command: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "execute", sandboxId, command }),
  });
  return data as { result: string; exitCode: number };
}

export async function writeFile(sandboxId: string, filePath: string, content: string) {
  return await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "writeFile", sandboxId, filePath, content }),
  });
}

export async function readFile(sandboxId: string, filePath: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "readFile", sandboxId, filePath }),
  });
  return data as { content: string };
}

export async function deleteSandbox(sandboxId: string) {
  return await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", sandboxId }),
  });
}

export async function searchFiles(sandboxId: string, query: string, includePattern?: string, caseSensitive?: boolean) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "searchFiles", sandboxId, query, includePattern, caseSensitive }),
  });
  return data as { result: string; exitCode: number };
}

export async function cloneRepo(sandboxId: string, repoUrl: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cloneRepo", sandboxId, repoUrl }),
  });
  return data as { result: string; exitCode: number };
}

export async function listFiles(sandboxId: string, dir = "/home/daytona") {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "listFiles", sandboxId, dir }),
  });
  return data as { result: string; exitCode: number };
}

export async function getLogs(sandboxId: string, search = "") {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getLogs", sandboxId, search }),
  });
  return data as { result: string; exitCode: number };
}

export async function addSecret(sandboxId: string, secretName: string, secretValue?: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "addSecret", sandboxId, secretName, secretValue }),
  });
  return data as { success: boolean; message: string };
}

export async function deleteAllSandboxes(keepSandboxId?: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "deleteAll", sandboxId: keepSandboxId }),
  });
  return data as { success: boolean; deletedCount: number };
}

export async function stopSandbox(sandboxId: string) {
  return await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop", sandboxId }),
  });
}

export async function startSandbox(sandboxId: string) {
  return await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", sandboxId }),
  });
}

export async function getSandboxHealth(sandboxId: string) {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "health", sandboxId }),
  });
  return data as { status: string };
}

export async function startDevServer(sandboxId: string, port = 5173, workDir = "/home/daytona") {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "startDevServer", sandboxId, port, workDir }),
  });
  return data as { previewUrl: string; previewToken?: string; port: number; installLog: string; viteLog: string; serverReady: boolean };
}

export async function setupWatcher(sandboxId: string, workDir = "/home/daytona", watchDir = "src", command = "npm run build") {
  const data = await fetchWithRetry("/api/daytona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setupWatcher", sandboxId, workDir, watchDir, command }),
  });
  return data as { success: boolean; message: string };
}
