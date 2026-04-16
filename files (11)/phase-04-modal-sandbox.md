# Phase 04 — Sandbox Infrastructure: Modal Deep Dive

## What is Modal?

Modal is a serverless cloud compute platform (Python-first). We use it as:
1. Fallback sandbox when Daytona is unavailable
2. Burst compute for parallel build jobs
3. Serverless dev server via Modal's `web_server` decorator (auto-HTTPS)

---

## Modal App (infra/modal/sandbox.py)

```python
import modal, os, shutil, subprocess

# Node 20 image with pre-installed template
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .copy_local_dir("../../sandbox-template", "/template")
    .run_commands("cd /template && npm ci")  # cached in image layer
)

app = modal.App("lovable-sandbox", image=image)

# Persistent volume for workspace files
volume = modal.Volume.from_name("workspaces", create_if_missing=True)

@app.cls(
    cpu=2.0,
    memory=2048,
    timeout=3600,
    volumes={"/workspaces": volume},
)
class Workspace:
    project_id: str = modal.parameter()

    @modal.enter()
    def setup(self):
        self.ws = f"/workspaces/{self.project_id}"
        if not os.path.exists(self.ws):
            shutil.copytree("/template", self.ws,
                            symlinks=False, ignore=shutil.ignore_patterns("node_modules"))
            os.symlink("/template/node_modules", f"{self.ws}/node_modules")

    @modal.web_server(port=3000, startup_timeout=30)
    def run(self):
        subprocess.Popen(
            ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"],
            cwd=self.ws,
            env={**os.environ, "NODE_ENV": "development"},
        ).wait()

    @modal.method()
    def write_file(self, path: str, content: str):
        full = os.path.join(self.ws, path.lstrip("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(content)
        volume.commit()

    @modal.method()
    def read_file(self, path: str) -> str:
        with open(os.path.join(self.ws, path.lstrip("/"))) as f:
            return f.read()

    @modal.method()
    def delete_file(self, path: str):
        full = os.path.join(self.ws, path.lstrip("/"))
        if os.path.exists(full):
            os.remove(full)
        volume.commit()

    @modal.method()
    def list_files(self, dir_path: str = "src") -> list[str]:
        base = os.path.join(self.ws, dir_path)
        result = []
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist")]
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), self.ws)
                result.append(rel.replace("\\", "/"))
        return result
```

---

## Deploy

```bash
cd infra/modal
pip install modal
modal deploy sandbox.py
# -> https://org--lovable-sandbox-workspace-run.modal.run
```

---

## TypeScript Client (packages/sandbox-client/src/modal.ts)

```typescript
const BASE = process.env.MODAL_WORKSPACE_URL!

async function call<T>(projectId: string, method: string, args: object): Promise<T> {
  const res = await fetch(`${BASE}/${projectId}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MODAL_TOKEN_ID}:${process.env.MODAL_TOKEN_SECRET}`,
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`Modal ${method} ${res.status}: ${await res.text()}`)
  return (await res.json()).result
}

export function createModalClient(projectId: string) {
  return {
    writeFile:  (p: string, c: string)  => call<void>(projectId, 'write_file',  { path: p, content: c }),
    readFile:   (p: string)              => call<string>(projectId, 'read_file', { path: p }),
    deleteFile: (p: string)              => call<void>(projectId, 'delete_file', { path: p }),
    listFiles:  (d?: string)             => call<string[]>(projectId, 'list_files', { dir_path: d ?? 'src' }),
    getPreviewUrl: ()                    => `${BASE}/${projectId}/run`,
  }
}
```

---

## Unified Sandbox Interface

```typescript
// packages/sandbox-client/src/index.ts
import { createDaytonaClient } from './daytona'
import { createModalClient }   from './modal'

export type SandboxProvider = 'daytona' | 'modal'

export interface ISandbox {
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  deleteFile(path: string): Promise<void>
  listFiles(dir?: string): Promise<string[]>
  getPreviewUrl(): string
}

export function getSandbox(provider: SandboxProvider, id: string): ISandbox {
  return provider === 'daytona'
    ? createDaytonaClient(id)
    : createModalClient(id)
}
```

---

## Daytona vs Modal: Decision Matrix

| Factor | Daytona | Modal |
|---|---|---|
| Cold start | ~3s (snapshot) | ~20-30s |
| Persistence | Native FS | Volume-backed |
| File speed | Native | I/O over volume |
| Idle cost | Ongoing | Zero (serverless) |
| Port forward | Built-in | web_server decorator |
| Best for | All standard projects | Burst / fallback |
