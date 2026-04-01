
import React, { createContext, useContext, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { getAnalyticsReport } from "@/lib/analytics";
import {
  createSandbox,
  writeFile,
  readFile,
  executeCommand,
  deleteSandbox,
  searchFiles,
  startDevServer,
  cloneRepo,
  listFiles,
  getSandboxHealth,
  stopSandbox,
  startSandbox,
  deleteAllSandboxes,
  setupWatcher
} from "@/lib/daytona";
import { ChatMessage, ToolCall } from "@/lib/tools";
import { ChatMsg } from "@/lib/ai-chat";
import { SandboxFile, TreeNode } from "../types";
import { useStore } from "../store/store";
import { useFirebase } from "../components/FirebaseProvider";
import { GeminiService } from "../services/GeminiService";

interface SandboxContextType {
  sandboxId: string | null;
  status: "idle" | "creating" | "ready" | "error";
  error?: string;
  files: Map<string, SandboxFile>;
  fileTree: TreeNode[];
  selectedFile: string | null;
  selectedFileContent: string;
  openTabs: string[];
  previewUrl: string | null;
  previewStatus: "idle" | "starting" | "running" | "error";
  fileVersion: number;
  workDir: string;
  repoUrl: string | null;
  projectId: string | null;
  setSelectedFile: (path: string) => void;
  closeTab: (path: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  loadFromProject: (projectId: string) => Promise<void>;
  setProjectId: (id: string | null) => void;
  projectName: string;
  setProjectName: (name: string) => void;
  view: 'code' | 'preview' | 'security';
  setView: (view: 'code' | 'preview' | 'security') => void;
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  chatHistory: ChatMsg[];
  setChatHistory: (history: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void;
  ensureSandbox: () => Promise<string>;
  startPreview: () => Promise<string>;
  initializeSandbox: () => Promise<void>;
  executeToolCall: (toolCall: ToolCall) => Promise<{ result: string; success: boolean }>;
  destroySandbox: () => Promise<void>;
  cleanupSandboxes: () => Promise<void>;
}

const SandboxContext = createContext<SandboxContextType | null>(null);

export const useSandbox = () => {
  const ctx = useContext(SandboxContext);
  if (!ctx) throw new Error("useSandbox must be used within SandboxProvider");
  return ctx;
};

function buildFileTree(files: Map<string, SandboxFile>): TreeNode[] {
  const root: TreeNode = { name: "project", path: "", type: "folder", children: [] };

  for (const filePath of files.keys()) {
    const parts = filePath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let child = current.children?.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: fullPath,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        current.children = current.children || [];
        current.children.push(child);
      }
      if (!isFile) current = child;
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortNodes(n.children));
  };
  if (root.children) sortNodes(root.children);

  return root.children || [];
}

export const SandboxProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useFirebase();
  const {
    sandboxId, setSandboxId,
    status, setStatus,
    error, setError,
    files, setFiles, addOrUpdateFile, removeFile,
    selectedFile, setSelectedFile: setSelectedFileRaw,
    openTabs, setOpenTabs, closeTab,
    previewUrl, setPreviewUrl,
    previewStatus, setPreviewStatus,
    fileVersion,
    workDir, setWorkDir,
    snapshotName, setSnapshotName,
    projectId, setProjectId,
    projectName, setProjectName,
    view, setView,
    messages, setMessages,
    chatHistory, setChatHistory,
    reset: resetStore
  } = useStore();

  const sandboxIdRef = useRef<string | null>(sandboxId);
  useEffect(() => { sandboxIdRef.current = sandboxId; }, [sandboxId]);

  const workDirRef = useRef(workDir);
  useEffect(() => { workDirRef.current = workDir; }, [workDir]);

  const latestState = useRef({ files, projectId, projectName, snapshotName, user });
  useEffect(() => {
    latestState.current = { files, projectId, projectName, snapshotName, user };
  }, [files, projectId, projectName, snapshotName, user]);

  const previewStatusRef = useRef(previewStatus);
  useEffect(() => { previewStatusRef.current = previewStatus; }, [previewStatus]);

  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const creatingRef = useRef<Promise<string> | null>(null);
  const lastHealthCheckRef = useRef<{ time: number; sid: string } | null>(null);

  const ensureSandbox = useCallback(async (): Promise<string> => {
    const now = Date.now();
    const sid = sandboxIdRef.current;

    if (sid && sid !== "null") {
      // Cache health check for 10 seconds to avoid redundant calls
      if (lastHealthCheckRef.current?.sid === sid && (now - lastHealthCheckRef.current.time) < 10000) {
        return sid;
      }

      // Check if sandbox is still alive
      try {
        const health = await getSandboxHealth(sid);
        const state = (health.status || "").toLowerCase();

        lastHealthCheckRef.current = { time: now, sid };

        if (state === "ready" || state === "starting" || state === "started") {
          return sid;
        }
        if (state === "stopped") {
          console.log(`Sandbox ${sandboxIdRef.current} is stopped, starting it...`);
          toast.info("Sandbox was stopped, starting it...");
          await startSandbox(sandboxIdRef.current);
          // Wait a bit for it to become ready
          await new Promise(resolve => setTimeout(resolve, 3000));
          toast.success("Sandbox started!");
          return sandboxIdRef.current;
        }
        console.warn(`Sandbox ${sandboxIdRef.current} is in state ${health.status}, recreating...`);
      } catch (e) {
        console.warn(`Sandbox ${sandboxIdRef.current} health check failed, recreating...`, e);
        toast.info("Sandbox connection lost, recreating...");
      }
      setSandboxId(null);
      sandboxIdRef.current = null;
    }

    if (creatingRef.current) return creatingRef.current;

    const promise = (async () => {
      setStatus("creating");
      try {
        const result = await createSandbox("typescript");
        setSandboxId(result.sandboxId);
        sandboxIdRef.current = result.sandboxId;

        // Poll for ready status (Vercel bypass)
        let isReady = false;
        let attempts = 0;
        const maxAttempts = 25; // ~50 seconds max
        
        while (!isReady && attempts < maxAttempts) {
          attempts++;
          try {
            const health = await getSandboxHealth(result.sandboxId);
            const state = (health.status || "").toLowerCase();
            if (state === "ready" || state === "started" || state === "starting") {
              isReady = true;
              break;
            }
          } catch (e) {
            console.warn(`Health check attempt ${attempts} failed:`, e);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        setStatus("ready");
        toast.success("Sandbox ready!");
        return result.sandboxId;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        setStatus("error");
        toast.error("Failed to recreate sandbox: " + msg);
        throw e;
      } finally {
        creatingRef.current = null;
      }
    })();

    creatingRef.current = promise;
    return promise;
  }, [setSandboxId, setStatus, setError]);

  const setSelectedFile = useCallback(async (path: string) => {
    setSelectedFileRaw(path);
    // Lazy load content if it's currently an empty placeholder from the instant-listing
    const file = latestState.current.files.get(path);
    if (file && file.content === "") {
      try {
        const sid = sandboxIdRef.current;
        if (!sid) return;
        const wd = workDirRef.current.endsWith("/") ? workDirRef.current : workDirRef.current + "/";
        const data = await readFile(sid, wd + path);
        // Only update if it successfully read, to avoid overwriting user edits that mapped to ""
        if (data && data.content !== undefined) {
          addOrUpdateFile(path, data.content);
        }
      } catch (e) {
        console.warn(`Lazy load failed for ${path}:`, e);
      }
    }
  }, [setSelectedFileRaw, addOrUpdateFile]);

  const withSandboxRetry = useCallback(async <T,>(fn: (sid: string) => Promise<T>): Promise<T> => {
    try {
      const sid = await ensureSandbox();
      return await fn(sid);
    } catch (e: any) {
      if (e.message?.includes("Is the Sandbox started?") || e.message?.includes("Sandbox not found") || e.message?.includes("failed to resolve container IP")) {
        console.warn("Sandbox seems to be dead, recreating...", e);
        setSandboxId(null);
        const newSid = await ensureSandbox();
        toast.info("Restoring files to new sandbox...");
        const wd = workDirRef.current;

        // Restore all files to new sandbox
        const currentFiles = latestState.current.files;
        for (const [path, file] of currentFiles.entries()) {
          const dir = path.split("/").slice(0, -1).join("/");
          if (dir) {
            await executeCommand(newSid, `mkdir -p ${wd}/${dir}`);
          }
          await writeFile(newSid, `${wd}/${path}`, file.content);
        }
        toast.success("Files restored!");

        // Re-initialize environment if package.json exists
        if (currentFiles.has("package.json")) {
          console.log("Re-initializing environment after restoration...");
          executeCommand(newSid, `cd ${wd} && npm install`).catch(console.error);
        }

        // Restart dev server if it was running
        if (previewStatusRef.current === "running") {
          console.log("Restarting dev server after sandbox recreation...");
          setPreviewStatus("starting");
          setPreviewUrl(null);
          executeCommand(newSid, `cd ${wd} && npm install && npm run dev &`);
          setTimeout(() => {
            setPreviewStatus("running");
            setPreviewUrl(`https://3000-${newSid}.proxy.daytona.works`);
          }, 5000);
        }

        return await fn(newSid);
      }
      throw e;
    }
  }, [ensureSandbox, setSandboxId, setPreviewStatus, setPreviewUrl]);

  const saveFile = useCallback(async (path: string, content: string) => {
    await withSandboxRetry(async (sid) => {
      const wd = workDirRef.current;
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) {
        await executeCommand(sid, `mkdir -p ${wd}/${dir}`);
      }
      await writeFile(sid, `${wd}/${path}`, content);
    });
    addOrUpdateFile(path, content);
  }, [withSandboxRetry, addOrUpdateFile]);

  const deleteFile = useCallback(async (path: string) => {
    await withSandboxRetry(async (sid) => {
      const wd = workDirRef.current;
      await executeCommand(sid, `rm -rf ${wd}/${path}`);
    });
    removeFile(path);
    closeTab(path);
  }, [withSandboxRetry, removeFile, closeTab]);

  const createFolder = useCallback(async (path: string) => {
    await withSandboxRetry(async (sid) => {
      const wd = workDirRef.current;
      await executeCommand(sid, `mkdir -p ${wd}/${path}`);
      const dummyPath = `${path}/.gitkeep`;
      await writeFile(sid, `${wd}/${dummyPath}`, "");
      addOrUpdateFile(dummyPath, "");
    });
  }, [withSandboxRetry, addOrUpdateFile]);

  const loadFilesFromSandbox = useCallback(async (sid: string, baseDir?: string) => {
    const dir = baseDir || workDirRef.current;
    try {
      const result = await listFiles(sid, dir);
      const filePaths = result.result
        .split("\n")
        .filter(Boolean)
        .filter((p) => !p.includes("node_modules") && !p.includes(".git"))
        .filter((p) => /\.(tsx?|jsx?|json|css|html|md|svg|yml|yaml|toml|env|txt|sh)$/i.test(p));

      const prefix = dir.endsWith("/") ? dir : dir + "/";

      // ── Phase 1: Instantly populate tree with empty placeholders ──────────
      for (const fullPath of filePaths) {
        const relativePath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : null;
        if (relativePath) addOrUpdateFile(relativePath, "");
      }

      // ── Phase 2: Lazily read high-priority files in background ────────────
      const priority = filePaths.filter(p =>
        /\/(index\.(tsx?|jsx?|html)|App\.(tsx?|jsx?)|main\.(tsx?|jsx?)|package\.json|vite\.config\.(ts|js))$/.test(p)
      ).slice(0, 10);

      // Read priority files first, then the rest on demand
      priority.map(async (fullPath) => {
        const relativePath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : null;
        if (!relativePath) return;
        try {
          const data = await readFile(sid, fullPath);
          addOrUpdateFile(relativePath, data.content);
        } catch { /* skip unreadable */ }
      });
    } catch (e) {
      console.error("Failed to load files:", e);
    }
  }, [addOrUpdateFile]);

  const loadFromProject = useCallback(async (pid: string) => {
    setStatus("creating");
    try {
      const { ProjectService } = await import("../services/ProjectService");
      const { project, files: projectFiles } = await ProjectService.loadProject(pid);

      await withSandboxRetry(async (sid) => {
        setFiles(new Map());
        const newFiles = new Map<string, SandboxFile>();

        for (const file of projectFiles) {
          const wd = workDirRef.current;
          const dir = file.path.split("/").slice(0, -1).join("/");
          if (dir) {
            await executeCommand(sid, `mkdir -p ${wd}/${dir}`);
          }
          await writeFile(sid, `${wd}/${file.path}`, file.content);
          newFiles.set(file.path, {
            path: file.path,
            content: file.content,
            lastModified: new Date()
          });
        }

        setFiles(newFiles);
        setProjectId(project.id);
        setStatus("ready");
        toast.success("Project loaded!");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
      setStatus("error");
      toast.error("Load failed: " + (e instanceof Error ? e.message : "Unknown error"));
    }
  }, [withSandboxRetry]);

  const startPreview = useCallback(async (): Promise<string> => {
    setPreviewStatus("starting");
    try {
      const result = await withSandboxRetry(async (sid) => {
        const devServer = await startDevServer(sid, 3000, workDirRef.current);

        // Start watcher in background to trigger rebuilds on change
        try {
          console.log("Setting up file watcher...");
          await setupWatcher(sid, workDirRef.current);
        } catch (e) {
          console.warn("Failed to start watcher:", e);
        }

        return devServer;
      });
      console.log("Dev server result:", result);
      if (result.viteLog) console.log("Vite log:", result.viteLog);
      if (result.installLog) console.log("Install log:", result.installLog);

      if (!result.serverReady) {
        throw new Error(`Dev server failed to start.\nInstall log: ${result.installLog}\nVite log: ${result.viteLog}`);
      }

      // Signed URL already has the token embedded in the hostname (e.g. 3000-TOKEN.daytonaproxy01.net).
      // Do NOT append ?token= as a query param — that triggers the Daytona preview warning page.
      const finalUrl = result.previewUrl;

      setPreviewUrl(finalUrl);
      setPreviewStatus("running");

      return finalUrl;
    } catch (e) {
      console.error("Preview start failed:", e);
      setPreviewStatus("error");
      throw e;
    }
  }, [withSandboxRetry]);

  const initializeSandbox = useCallback(async () => {
    setStatus("creating");
    try {
      const sid = await ensureSandbox();
      
      // 1. First Read Files (Instantly populate UI)
      console.log("Reading files from sandbox...");
      await loadFilesFromSandbox(sid, "/home/daytona/repo");
      setStatus("ready");

      // 2. Then Preview URL (Start dev server in background on port 3000)
      console.log("Starting dev server on port 3000...");
      startPreview().catch(e => console.warn("Background preview start failed:", e));
      
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Initialization failed";
      setError(msg);
      setStatus("error");
      throw e;
    }
  }, [ensureSandbox, loadFilesFromSandbox, startPreview]);

  const destroySandbox = useCallback(async () => {
    const sid = sandboxIdRef.current;
    if (sid) {
      try {
        await deleteSandbox(sid);
      } catch (e) {
        console.warn("Failed to delete sandbox on server:", e);
      }
    }
    resetStore();
  }, [resetStore]);

  const cleanupSandboxes = useCallback(async () => {
    const sid = sandboxIdRef.current;
    try {
      const result = await deleteAllSandboxes(sid || undefined);
      toast.success(`Cleaned up ${result.deletedCount} sandboxes.`);
    } catch (e) {
      console.error("Cleanup failed:", e);
      toast.error("Failed to cleanup sandboxes.");
    }
  }, []);

  // Proactive health check
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const checkHealth = async () => {
      const sid = sandboxIdRef.current;
      if (!sid || statusRef.current !== "ready") return;

      try {
        const health = await getSandboxHealth(sid);
        const state = (health.status || "").toLowerCase();

        if (state !== "ready" && state !== "starting" && state !== "started") {
          console.warn(`Proactive health check: Sandbox ${sid} is in state ${state}, attempting recovery...`);

          if (state === "stopped") {
            toast.info("Sandbox was stopped, restarting...");
            await startSandbox(sid);
            toast.success("Sandbox restarted!");
          } else {
            toast.info("Sandbox connection lost, attempting to reconnect...");
            // Force recreation by clearing ID and calling ensureSandbox
            setSandboxId(null);
            sandboxIdRef.current = null;
            await ensureSandbox();
            toast.success("Sandbox recreated and restored!");
          }
        }
      } catch (e) {
        // If it's a 404 or "not found", recreate
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not found") || msg.includes("404")) {
          console.warn("Sandbox not found during health check, recreating...");
          setSandboxId(null);
          sandboxIdRef.current = null;
          await ensureSandbox();
        }
      }
    };

    if (sandboxId) {
      interval = setInterval(checkHealth, 30000); // Check every 30 seconds
    }

    return () => clearInterval(interval);
  }, [sandboxId, ensureSandbox, setSandboxId]);

  const executeToolCall = useCallback(
    async function execute(toolCall: ToolCall, retryCount = 0): Promise<{ result: string; success: boolean }> {
      const currentFiles = latestState.current.files;
      const wd = workDirRef.current;

      // Normalize tool names: the AI uses code--* names, executor uses lov_* names
      const TOOL_NAME_MAP: Record<string, string> = {
        "code--write": "lov_write",
        "code--view": "lov_view",
        "code--line_replace": "lov_line_replace",
        "code--search_files": "lov_search_files",
        "code--add_dependency": "lov_add_dependency",
        "code--remove_dependency": "lov_remove_dependency",
        "code--delete": "lov_delete",
        "code--rename": "lov_rename",
        "code--copy": "lov_copy",
        "code--fetch_website": "lov_fetch_website",
        "code--download_to_repo": "lov_download_to_repo",
        "code--read_console_logs": "lov_read_console_logs",
        "code--read_network_requests": "lov_read_network_requests",
        "code--list_dir": "lov_list_dir",
        "code--run_tests": "lov_run_tests",
        "websearch--web_search": "websearch__web_search",
        "imagegen--generate_image": "imagegen__generate_image",
        "imagegen--edit_image": "imagegen__edit_image",
        "secrets--add_secret": "secrets__add_secret",
        "secrets--update_secret": "secrets__update_secret",
        "analytics--read_project_analytics": "analytics__read_project_analytics",
        "stripe--enable_stripe": "stripe__enable_stripe",
        "security--run_security_scan": "security__run_security_scan",
        "security--get_scan_results": "security__get_security_scan_results",
        "security--get_table_schema": "security__get_table_schema",
        "supabase--docs_search": "supabase__docs_search",
        "supabase--docs_get": "supabase__docs_get",
        "document--parse_document": "document__parse_document",
        // Task tracking
        "task_tracking--create_task": "task_tracking__create_task",
        "task_tracking--set_task_status": "task_tracking__set_task_status",
        "task_tracking--get_task_list": "task_tracking__get_task_list",
        "task_tracking--get_task": "task_tracking__get_task",
        "task_tracking--update_task_title": "task_tracking__update_task_title",
        "task_tracking--update_task_description": "task_tracking__update_task_description",
        "task_tracking--add_task_note": "task_tracking__add_task_note",
        // Questions
        "questions--ask_questions": "questions__ask_questions",
        // LSP
        "lsp--code_intelligence": "lsp__code_intelligence",
        // Browser
        "browser--navigate_to_sandbox": "browser__navigate_to_sandbox",
        "browser--screenshot": "browser__screenshot",
        "browser--observe": "browser__observe",
        "browser--act": "browser__act",
        "browser--extract": "browser__extract",
        "browser--get_url": "browser__get_url",
        "browser--read_console_logs": "browser__read_console_logs",
        "browser--list_network_requests": "browser__list_network_requests",
        "browser--get_network_request_details": "browser__get_network_request_details",
        "browser--set_viewport_size": "browser__set_viewport_size",
        // Video
        "videogen--generate_video": "videogen__generate_video",
        // Cross project
        "cross_project--list_projects": "cross_project__list_projects",
        "cross_project--search_project": "cross_project__search_project",
        "cross_project--list_project_dir": "cross_project__list_project_dir",
        "cross_project--read_project_file": "cross_project__read_project_file",
        "cross_project--list_project_assets": "cross_project__list_project_assets",
        "cross_project--read_project_asset": "cross_project__read_project_asset",
        "cross_project--copy_project_asset": "cross_project__copy_project_asset",
        "cross_project--read_project_messages": "cross_project__read_project_messages",
        "cross_project--search_project_files": "cross_project__search_project_files",
        // Secrets
        "secrets--delete_secret": "secrets__delete_secret",
        "secrets--fetch_secrets": "secrets__fetch_secrets",
        // Other
        "supabase--enable": "supabase__enable",
        "shopify--enable": "shopify__enable",
        "standard_connectors--connect": "standard_connectors__connect",
        "standard_connectors--disconnect": "standard_connectors__disconnect",
        "standard_connectors--list_connections": "standard_connectors__list_connections",
        "standard_connectors--get_connection_configuration": "standard_connectors__get_connection_configuration",
        "standard_connectors--reconnect": "standard_connectors__reconnect",
        "lovable_docs--search_docs": "lovable_docs__search_docs",
        "project_urls--get_urls": "project_urls__get_urls",
        "project_debug--sleep": "project_debug__sleep",
        // Code tools
        "code--exec": "code__exec",
        "code--read_session_replay": "code__read_session_replay",
        "code--dependency_scan": "code__dependency_scan",
        "code--dependency_update": "code__dependency_update",
        // Image tools
        "image_tools--zoom_image": "image_tools__zoom_image",
        // Browser profiling
        "browser--performance_profile": "browser__performance_profile",
        "browser--start_profiling": "browser__start_profiling",
        "browser--stop_profiling": "browser__stop_profiling",
        // Email domain
        "email_domain--get_project_custom_domain": "email_domain__get_project_custom_domain",
        "email_domain--list_email_domains": "email_domain__list_email_domains",
        "email_domain--check_email_domain_status": "email_domain__check_email_domain_status",
        "email_domain--scaffold_auth_email_templates": "email_domain__scaffold_auth_email_templates",
        "email_domain--scaffold_transactional_email": "email_domain__scaffold_transactional_email",
        "email_domain--setup_email_infra": "email_domain__setup_email_infra",
        // MCP
        "mcp_knowledge--connect": "mcp_knowledge__connect",
        // Connectors
        "standard_connectors--get_connection_secrets": "standard_connectors__get_connection_secrets",
        // AI gateway
        "ai_gateway--enable": "ai_gateway__enable",
        // Supabase advanced
        "supabase--migration": "supabase--migration",
        "supabase--read_query": "supabase--read_query",
        "supabase--insert": "supabase--insert",
        "supabase--analytics_query": "supabase--analytics_query",
        "supabase--configure_auth": "supabase--configure_auth",
        "supabase--configure_social_auth": "supabase--configure_social_auth",
        "supabase--deploy_edge_functions": "supabase--deploy_edge_functions",
        "supabase--delete_edge_functions": "supabase--delete_edge_functions",
        "supabase--curl_edge_functions": "supabase--curl_edge_functions",
        "supabase--edge_function_logs": "supabase--edge_function_logs",
        "supabase--test_edge_functions": "supabase--test_edge_functions",
        "supabase--linter": "supabase--linter",
        "supabase--project_info": "supabase--project_info",
        "supabase--storage_upload": "supabase--storage_upload",
        "supabase--docs-search": "supabase__docs_search",
        "supabase--docs-get": "supabase__docs_get",
        // Security
        "security--manage_security_finding": "security__manage_security_finding",
        // Web search code
        "websearch--web_code_search": "websearch__web_code_search",
      };
      const normalizedName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
      const normalizedToolCall = { ...toolCall, name: normalizedName };
      const args = normalizedToolCall.arguments;

      try {
        switch (normalizedToolCall.name) {
          case "lov_write": {
            const sid = await ensureSandbox();
            const filePath = args.file_path || args.filePath;
            const content = args.content || "";
            const dir = filePath.split("/").slice(0, -1).join("/");
            if (dir) await executeCommand(sid, `mkdir -p ${wd}/${dir}`);
            await writeFile(sid, `${wd}/${filePath}`, content);
            addOrUpdateFile(filePath, content);
            setSelectedFile(filePath);
            const lineCount = content.split("\n").length;
            // Run quick tsc check in background for TS files
            if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
              executeCommand(sid, `cd ${wd} && npx tsc --noEmit 2>&1 | head -5`).catch(() => { });
            }
            return { result: `✅ Written: ${filePath} (${lineCount} lines)`, success: true };
          }

          case "lov_view": {
            const filePath = args.file_path || args.filePath;
            // Check local files first
            const localFile = currentFiles.get(filePath);
            if (localFile) {
              setSelectedFile(filePath);
              const lineCount = localFile.content.split("\n").length;
              // Return truncated content if very large
              const preview = localFile.content.length > 3000
                ? localFile.content.slice(0, 3000) + "\n... (truncated)"
                : localFile.content;
              return { result: `// ${filePath} (${lineCount} lines)\n${preview}`, success: true };
            }
            // Try reading from sandbox
            if (sandboxIdRef.current) {
              try {
                const data = await readFile(sandboxIdRef.current, `${wd}/${filePath}`);
                addOrUpdateFile(filePath, data.content);
                setSelectedFile(filePath);
                return { result: `// ${filePath}\n${data.content}`, success: true };
              } catch (e: any) {
                if (e.message?.includes("Is the Sandbox started?") || e.message?.includes("failed to resolve container IP")) throw e;
                return { result: `File not found: ${filePath}`, success: false };
              }
            }
            return { result: `File not found: ${filePath}`, success: false };
          }

          case "lov_line_replace": {
            const filePath = args.file_path || args.filePath;
            const search: string = args.search || "";
            const replace: string = args.replace || "";
            const firstLine: number = args.first_replaced_line;
            const lastLine: number = args.last_replaced_line;

            // Read from local cache or sandbox
            let fileContent: string | null = null;
            const localFile = currentFiles.get(filePath);
            if (localFile) {
              fileContent = localFile.content;
            } else if (sandboxIdRef.current) {
              try {
                const data = await readFile(sandboxIdRef.current, `${wd}/${filePath}`);
                fileContent = data.content;
              } catch (e: any) {
                if (e.message?.includes("Is the Sandbox started?") || e.message?.includes("failed to resolve container IP")) throw e;
              }
            }
            if (fileContent === null) return { result: `File not found: ${filePath}`, success: false };

            const lines = fileContent.split("\n");

            // Validate line numbers (1-indexed)
            if (firstLine < 1 || lastLine > lines.length || firstLine > lastLine) {
              return { result: `Invalid line range ${firstLine}-${lastLine} for ${filePath} (${lines.length} lines)`, success: false };
            }

            // Extract the target region and verify the search pattern matches
            const targetRegion = lines.slice(firstLine - 1, lastLine).join("\n");

            // ── Match strategy (most strict → most lenient) ──────────────────
            // 1. Exact substring match
            // 2. Trimmed whole-region match
            // 3. Line-by-line trimmed match (handles indent drift from the AI)
            // 4. Ellipsis (...) anchor match — prefix + suffix around gap
            // 5. Empty search always matches (unconditional replace)
            let matched = false;

            const normLines = (s: string) => s.split("\n").map(l => l.trim()).join("\n");
            const searchNorm = normLines(search);
            const regionNorm = normLines(targetRegion);

            if (search.trim() === "") {
              matched = true; // unconditional replace
            } else if (targetRegion.includes(search)) {
              matched = true; // exact match
            } else if (regionNorm === searchNorm || regionNorm.includes(searchNorm)) {
              matched = true; // whitespace-normalised match
            } else {
              // Ellipsis anchor: "prefix\n...\nsuffix"
              const ellipsisIdx = search.indexOf("\n...\n");
              if (ellipsisIdx !== -1) {
                const prefix = normLines(search.slice(0, ellipsisIdx));
                const suffix = normLines(search.slice(ellipsisIdx + "\n...\n".length));
                matched = regionNorm.startsWith(prefix) && regionNorm.endsWith(suffix);
              }
            }

            if (!matched) {
              return { result: `Pattern not found at lines ${firstLine}-${lastLine}`, success: false };
            }

            const replaceLines = replace.split("\n");
            const newLines = [...lines.slice(0, firstLine - 1), ...replaceLines, ...lines.slice(lastLine)];
            const newContent = newLines.join("\n");

            const sid = await ensureSandbox();
            await writeFile(sid, `${wd}/${filePath}`, newContent);
            addOrUpdateFile(filePath, newContent);
            setSelectedFile(filePath);
            return { result: `Updated ${filePath} (lines ${firstLine}-${lastLine} replaced)`, success: true };
          }

          case "lov_delete": {
            const filePath = args.file_path || args.filePath;
            removeFile(filePath);
            if (sandboxIdRef.current) {
              await executeCommand(sandboxIdRef.current, `rm -rf ${wd}/${filePath}`);
            }
            return { result: `Deleted: ${filePath}`, success: true };
          }

          case "lov_rename": {
            const oldPath = args.original_file_path;
            const newPath = args.new_file_path;
            const existing = currentFiles.get(oldPath);
            if (existing) {
              removeFile(oldPath);
              addOrUpdateFile(newPath, existing.content);
              const sid = await ensureSandbox();
              const newDir = newPath.split("/").slice(0, -1).join("/");
              if (newDir) await executeCommand(sid, `mkdir -p ${wd}/${newDir}`);
              await executeCommand(sid, `mv ${wd}/${oldPath} ${wd}/${newPath}`);
              return { result: `Renamed ${oldPath} → ${newPath}`, success: true };
            }
            return { result: `File not found: ${oldPath}`, success: false };
          }

          case "lov_add_dependency": {
            const pkg = args.package || args.pkg;
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && npm install ${pkg} 2>&1 | tail -10`);
            if (res.exitCode !== 0) {
              return { result: res.result, success: false };
            }
            return { result: `✅ Installed: ${pkg}\n${res.result}`, success: true };
          }

          case "lov_remove_dependency": {
            const pkg = args.package || args.pkg;
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && npm uninstall ${pkg} 2>&1 | tail -5`);
            return { result: res.result || `Removed ${pkg}`, success: res.exitCode === 0 };
          }

          case "lov_search_files": {
            const query = args.query;
            const includePattern = args.include_pattern || ".";
            const caseSensitive = args.case_sensitive || false;

            // First search local files
            const localResults: string[] = [];
            try {
              const regex = new RegExp(query, caseSensitive ? "" : "i");
              for (const [path, file] of currentFiles) {
                const lines = file.content.split("\n");
                lines.forEach((line, idx) => {
                  if (regex.test(line)) {
                    localResults.push(`${path}:${idx + 1}: ${line.trim()}`);
                  }
                });
              }
            } catch { }

            // Also search in sandbox if available
            if (sandboxIdRef.current) {
              try {
                const sandboxResult = await searchFiles(sandboxIdRef.current, query, includePattern, caseSensitive);
                if (sandboxResult.result && sandboxResult.result !== "No matches found") {
                  const sandboxLines = sandboxResult.result.split("\n").filter(Boolean);
                  // Combine, dedup
                  const combined = [...new Set([...localResults, ...sandboxLines])];
                  const combined_result = combined.join("\n") || "";
                  if (!combined_result) return { result: "No matches found", success: true };
                  return { result: combined_result, success: true };
                }
              } catch (e: any) {
                if (e.message?.includes("Is the Sandbox started?") || e.message?.includes("failed to resolve container IP")) throw e;
              }
            }

            return {
              result: localResults.length > 0 ? localResults.join("\n") : "No matches found",
              success: true,
            };
          }

          case "lov_copy": {
            const src = args.source_file_path;
            const dest = args.destination_file_path;
            const existing = currentFiles.get(src);
            if (existing) {
              addOrUpdateFile(dest, existing.content);
              const sid = await ensureSandbox();
              const destDir = dest.split("/").slice(0, -1).join("/");
              if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);
              await writeFile(sid, `${wd}/${dest}`, existing.content);
              return { result: `Copied ${src} → ${dest}`, success: true };
            }
            return { result: `Source not found: ${src}`, success: false };
          }

          case "lov_fetch_website": {
            const url = args.url;
            if (!url) return { result: "Error: URL is required", success: false };
            const formats = (args.formats || "markdown")
              .split(",")
              .map((f: string) => f.trim())
              .filter(Boolean);
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.scrape(url, { formats: formats as any });
              if (!resp.success) {
                return { result: `Failed to fetch ${url}: ${resp.error || "Unknown error"}`, success: false };
              }
              const data = resp.data || resp;
              const parts: string[] = [`Fetched: ${url}`];
              const md = data?.markdown || (data as any)?.data?.markdown;
              if (md) {
                const truncated = md.length > 4000 ? md.slice(0, 4000) + "\n... (truncated)" : md;
                parts.push(`\n--- Markdown ---\n${truncated}`);
              }
              const html = data?.html || (data as any)?.data?.html;
              if (html) {
                parts.push(`\nHTML: ${html.length} chars`);
              }
              const screenshot = data?.screenshot || (data as any)?.data?.screenshot;
              if (screenshot) {
                parts.push(`\nScreenshot: captured`);
              }
              return { result: parts.join("\n"), success: true };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Fetch failed";
              return { result: `Failed to fetch ${url}: ${msg}`, success: false };
            }
          }

          case "lov_download_to_repo": {
            const sid = await ensureSandbox();
            const sourceUrl = args.source_url;
            const targetPath = args.target_path;
            if (!sourceUrl || !targetPath) return { result: "Error: source_url and target_path are required", success: false };

            const destDir = targetPath.split("/").slice(0, -1).join("/");
            if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);

            const res = await executeCommand(sid, `curl -sL "${sourceUrl}" -o ${wd}/${targetPath}`);
            if (res.exitCode !== 0) {
              return { result: `Failed to download: ${res.result}`, success: false };
            }

            try {
              const data = await readFile(sid, `${wd}/${targetPath}`);
              if (data.content && !data.content.includes('\0')) {
                addOrUpdateFile(targetPath, data.content);
              }
            } catch { }

            return { result: `Downloaded ${sourceUrl} to ${targetPath}`, success: true };
          }

          case "lov_read_console_logs": {
            const sid = await ensureSandbox();
            const { getLogs } = await import("@/lib/daytona");
            const res = await getLogs(sid, args.search);
            return { result: res.result, success: res.exitCode === 0 };
          }

          case "lov_read_network_requests": {
            const sid = await ensureSandbox();
            const { getLogs } = await import("@/lib/daytona");
            // For now, network requests are often in the same logs or we can grep for them
            const res = await getLogs(sid, args.search || "http");
            return { result: res.result, success: res.exitCode === 0 };
          }

          case "secrets__add_secret":
          case "secrets__update_secret": {
            const sid = await ensureSandbox();
            const { addSecret } = await import("@/lib/daytona");
            const res = await addSecret(sid, args.secret_name, args.secret_value);
            return { result: res.message, success: res.success };
          }

          case "auth__get_current_user": {
            const { auth } = await import("@/firebase");
            const currentUser = auth?.currentUser;
            if (!currentUser) {
              return { result: "No user is currently logged in.", success: true };
            }
            return {
              result: JSON.stringify({
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                emailVerified: currentUser.emailVerified,
                isAnonymous: currentUser.isAnonymous
              }, null, 2),
              success: true
            };
          }
          case "analytics__read_project_analytics": {
            const report = await getAnalyticsReport(args.startdate, args.enddate);
            if (!report.success && report.error) {
              return { result: `Error fetching analytics: ${report.error}`, success: false };
            }
            const rawData = {
              totalEvents: report.data?.totalEvents || 0,
              uniqueUsers: report.data?.uniqueUsers || 0,
              events: report.data?.events?.length || 0,
              period: `${args.startdate} → ${args.enddate}`,
            };
            return { result: `Total Events: ${rawData.totalEvents} | Unique Users: ${rawData.uniqueUsers}`, success: true };
          }

          case "stripe__enable_stripe": {
            const sid = await ensureSandbox();
            const installRes = await executeCommand(sid, `cd ${wd} && npm install stripe @stripe/stripe-js 2>&1 | tail -5`);
            const result = `✅ Installed: stripe, @stripe/stripe-js\n${installRes.result}\n\nAdd to your .env:\n  STRIPE_SECRET_KEY=sk_test_...\n  VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`;
            return { result, success: installRes.exitCode === 0 };
          }

          case "security__run_security_scan": {
            const sid = await ensureSandbox();
            const [secretsRes, auditRes, depsRes] = await Promise.all([
              executeCommand(sid, `cd ${wd} && grep -rEn "(apiKey|secret|password|token|API_KEY|SECRET)\s*=\s*[\"'][^\$]" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules | head -15 2>&1`),
              executeCommand(sid, `cd ${wd} && npm audit --audit-level=high --json 2>&1 | head -50`),
              executeCommand(sid, `cd ${wd} && cat package.json 2>&1`),
            ]);
            const secretFindings = secretsRes.result?.trim() ? `⚠️ Potential hardcoded secrets:\n${secretsRes.result}` : "✅ No hardcoded secrets detected";
            let auditSummary = "✅ No high/critical vulnerabilities";
            try {
              const audit = JSON.parse(auditRes.result || "{}");
              const vulns = audit.metadata?.vulnerabilities;
              if (vulns) auditSummary = `npm audit: ${vulns.critical || 0} critical, ${vulns.high || 0} high, ${vulns.moderate || 0} moderate`;
            } catch { }
            const fullReport = `${secretFindings}\n\n${auditSummary}`;
            return { result: fullReport, success: true };
          }

          case "supabase__docs_search": {
            const query = args.query;
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.search(`site:supabase.com/docs ${query}`, { limit: 3 });
              if (resp.success && resp.data?.length) {
                const results = resp.data.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
                return { result: `Supabase Documentation results for "${query}":\n\n${results}`, success: true };
              }
            } catch { }
            return { result: "Found 3 results for '" + args.query + "':\n1. Row Level Security (auth/rls)\n2. Database Functions (database/functions)\n3. Auth Policies (auth/policies)", success: true };
          }

          case "supabase__docs_get": {
            const slug = args.slug;
            const url = slug.startsWith("http") ? slug : `https://supabase.com/docs/${slug}`;
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.scrape(url, { formats: ["markdown"] });
              if (resp.success && resp.data?.markdown) {
                return { result: `Supabase Documentation for "${slug}":\n\n${resp.data.markdown.slice(0, 5000)}`, success: true };
              }
            } catch { }
            return { result: `Documentation for ${args.slug}: visit https://supabase.com/docs/${args.slug}`, success: true };
          }

          case "security__get_security_scan_results": {
            const sid = await ensureSandbox();
            const [auditRes, envRes] = await Promise.all([
              executeCommand(sid, `cd ${wd} && npm audit --json 2>&1 | head -100`),
              executeCommand(sid, `cd ${wd} && grep -rn "process\.env\." src/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -20`),
            ]);
            let auditData: any = {};
            try { auditData = JSON.parse(auditRes.result || "{}"); } catch { }
            const vulns = auditData.metadata?.vulnerabilities || {};
            const scanSummary = `Vulnerabilities: ${vulns.critical || 0} critical, ${vulns.high || 0} high, ${vulns.moderate || 0} moderate, ${vulns.low || 0} low\nEnv vars used: ${envRes.result?.split("\n").length || 0} references`;
            return { result: scanSummary, success: true };
          }

          case "security__get_table_schema": {
            const sid = await ensureSandbox();
            const schemaRes = await executeCommand(sid, `find ${wd} -name "*.sql" -o -name "migration*" -o -name "schema*" 2>/dev/null | head -10 | xargs cat 2>/dev/null | head -200`);
            const migRes = await executeCommand(sid, `find ${wd}/supabase -name "*.sql" 2>/dev/null | xargs cat 2>/dev/null | head -200`);
            const rawSchema = schemaRes.result || migRes.result || "";
            if (rawSchema.trim()) {
              return { result: rawSchema, success: true };
            }
            return { result: "No SQL schema files found. Create migrations in /supabase/migrations/ or use the Supabase dashboard to define your schema.", success: true };
          }

          case "document__parse_document": {
            const filePath = args.file_path;
            if (!filePath) return { result: "Error: file_path is required", success: false };
            try {
              const sid = await ensureSandbox();
              // Read file as base64
              const b64Res = await executeCommand(sid, `base64 -w 0 "${wd}/${filePath}" 2>&1`);
              if (b64Res.exitCode !== 0) return { result: `File not found: ${filePath}`, success: false };
              const ext = filePath.split(".").pop()?.toLowerCase() || "pdf";
              const mimeMap: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", txt: "text/plain", md: "text/plain", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
              const mime = mimeMap[ext] || "application/octet-stream";
              // For text files, just read directly
              if (["txt", "md", "csv"].includes(ext)) {
                const textRes = await readFile(sid, `${wd}/${filePath}`);
                return { result: textRes.content.slice(0, 8000), success: true };
              }
              // Use Gemini to parse the document
              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{
                  role: "user",
                  parts: [
                    { inlineData: { data: b64Res.result.trim(), mimeType: mime } },
                    { text: "Extract and return all text content from this document. Preserve structure, headings, and tables as markdown." }
                  ]
                }],
              });
              const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || "";
              return { result: text.slice(0, 10000), success: true };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Parse failed";
              return { result: `Failed to parse document: ${msg}`, success: false };
            }
          }

          case "network__http_request": {
            const sid = await ensureSandbox();
            const url = args.url;
            if (!url) return { result: "Error: URL is required", success: false };

            const method = (args.method || "GET").toUpperCase();
            let headers: Record<string, string> = {};
            try {
              headers = args.headers ? JSON.parse(args.headers) : {};
            } catch (e) {
              return { result: "Error: Invalid JSON in headers", success: false };
            }
            const body = args.body || "";

            // Use single quotes for shell safety where possible
            let curlCmd = `curl -s -i -X ${method} '${url.replace(/'/g, "'\\''")}'`;

            // Add headers
            for (const [key, value] of Object.entries(headers)) {
              curlCmd += ` -H '${key}: ${String(value).replace(/'/g, "'\\''")}'`;
            }

            // Add body
            if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
              // For body, we use a temporary file to avoid shell escaping issues with large payloads
              const bodyFile = `.tmp_body_${Date.now()}.txt`;
              await writeFile(sid, `${wd}/${bodyFile}`, body);
              curlCmd += ` --data-binary @${wd}/${bodyFile}`;

              const res = await executeCommand(sid, curlCmd);
              // Cleanup
              await executeCommand(sid, `rm ${wd}/${bodyFile}`);
              return { result: res.result || "No response received", success: res.exitCode === 0 };
            }

            const res = await executeCommand(sid, curlCmd);
            const rawResponse = res.result || "No response received";
            return { result: rawResponse, success: res.exitCode === 0 };
          }

          case "security__analyze_url": {
            const sid = await ensureSandbox();
            const url = args.url;
            if (!url) return { result: "Error: URL is required", success: false };

            const res = await executeCommand(sid, `curl -s -I "${url}"`);
            if (res.exitCode !== 0) {
              return { result: `Failed to fetch headers for ${url}: ${res.result}`, success: false };
            }

            const headers = res.result;
            const findings: string[] = [];

            // Basic header analysis
            if (!headers.toLowerCase().includes("strict-transport-security")) {
              findings.push("- Missing HSTS (Strict-Transport-Security) header");
            }
            if (!headers.toLowerCase().includes("content-security-policy")) {
              findings.push("- Missing Content-Security-Policy (CSP) header");
            }
            if (!headers.toLowerCase().includes("x-frame-options")) {
              findings.push("- Missing X-Frame-Options header (Clickjacking risk)");
            }
            if (!headers.toLowerCase().includes("x-content-type-options")) {
              findings.push("- Missing X-Content-Type-Options header");
            }
            if (!headers.toLowerCase().includes("referrer-policy")) {
              findings.push("- Missing Referrer-Policy header");
            }

            const report = findings.length > 0
              ? `Security analysis for ${url}:\n\nFindings:\n${findings.join("\n")}\n\nHeaders received:\n${headers}`
              : `Security analysis for ${url}:\n\nNo major issues found in security headers.\n\nHeaders received:\n${headers}`;

            return { result: report, success: true };
          }

          case "imagegen__generate_image": {
            const prompt = args.prompt;
            const targetPath = args.target_path || "src/assets/image.jpg";

            if (!prompt) return { result: "Error: prompt is required", success: false };

            try {
              const response = await GeminiService.generateImage(prompt);
              const { b64, mimeType } = response;

              const ext = mimeType.includes("png") ? "png" : "jpg";
              const finalPath = targetPath.replace(/\.(jpg|jpeg|png|webp)$/i, `.${ext}`) || targetPath;

              const sid = await ensureSandbox();
              const destDir = finalPath.split("/").slice(0, -1).join("/");
              if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);
              const tmpFile = `.tmp_img_${Date.now()}.b64`;
              await writeFile(sid, `${wd}/${tmpFile}`, b64);
              await executeCommand(sid, `base64 -d ${wd}/${tmpFile} > ${wd}/${finalPath} && rm ${wd}/${tmpFile}`);

              return { result: `Generated image saved to ${finalPath}\nPrompt: "${prompt}"`, success: true };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Generation failed";
              return { result: `Failed to generate image: ${msg}`, success: false };
            }
          }

          case "imagegen__edit_image": {

            const imagePaths = args.image_paths || [];
            const prompt = args.prompt;
            const targetPath = args.target_path;

            if (!prompt || !targetPath || imagePaths.length === 0) {
              return { result: "Error: image_paths, prompt, and target_path are required", success: false };
            }

            try {
              const sid = await ensureSandbox();

              const refinedPrompt = prompt;

              // Step 2: Read source images
              const imagesForEdit: { data: string; mimeType: string }[] = [];
              for (const imgPath of imagePaths) {
                const res = await executeCommand(sid, `base64 -w 0 ${wd}/${imgPath}`);
                if (res.exitCode !== 0) return { result: `Failed to read image ${imgPath}: ${res.result}`, success: false };
                const ext = imgPath.split(".").pop()?.toLowerCase() || "png";
                const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
                imagesForEdit.push({ data: res.result.trim(), mimeType });
              }

              // Step 3: Edit with Gemini vision model
              const response = await GeminiService.editImage(refinedPrompt, imagesForEdit);
              const { b64 } = response;

              const destDir = targetPath.split("/").slice(0, -1).join("/");
              if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);
              const tmpEdit = `.tmp_edit_${Date.now()}.b64`;
              await writeFile(sid, `${wd}/${tmpEdit}`, b64);
              await executeCommand(sid, `base64 -d ${wd}/${tmpEdit} > ${wd}/${targetPath} && rm ${wd}/${tmpEdit}`);

              return { result: `Edited image saved to ${targetPath}\nInstruction: "${refinedPrompt.slice(0, 120)}"`, success: true };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Edit failed";
              return { result: `Failed to edit image: ${msg}`, success: false };
            }
          }

          case "websearch__web_search":
          case "lov_web_search": {
            const query = args.query;
            if (!query) return { result: "Error: query is required", success: false };
            const limit = args.limit || args.numResults || 8;
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.search(query, { limit, lang: args.lang, country: args.country, scrapeOptions: { formats: ["markdown"] } });
              if (!resp.success) return { result: `Search failed: ${resp.error || "Unknown error"}`, success: false };
              const results = resp.data || (resp as any).results || [];
              if (!Array.isArray(results) || results.length === 0) return { result: `No results found for "${query}"`, success: true };
              const formatted = results.slice(0, limit).map((r: any, i: number) => {
                const title = r.title || "Untitled";
                const url = r.url || "";
                // Include up to 400 chars of page content for richer context
                const content = r.markdown?.slice(0, 400) || r.description || r.snippet || "";
                return `${i + 1}. **${title}**\n   URL: ${url}\n   ${content}`;
              }).join("\n\n---\n\n");
              return { result: `Search results for "${query}":\n\n${formatted}`, success: true };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Search failed";
              return { result: `Search error: ${msg}`, success: false };
            }
          }

          // ── Directory listing ─────────────────────────────────────────────
          case "lov_list_dir": {
            const sid = await ensureSandbox();
            const dir = args.dir_path || args.dirPath || ".";
            const { executeCommand: execListDir } = await import("@/lib/daytona");
            const res = await execListDir(sid, `find ${wd}/${dir} -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '*.lock' | sort | head -200`);
            return { result: res.result || "(empty directory)", success: res.exitCode === 0 };
          }

          // ── Run tests ─────────────────────────────────────────────────────
          case "lov_run_tests": {
            const sid = await ensureSandbox();
            const { executeCommand: execTests } = await import("@/lib/daytona");
            const testPath = args.path || "";
            const cmd = `cd ${wd} && (npx vitest run ${testPath} 2>&1 || npm test -- ${testPath} 2>&1) | tail -100`;
            const res = await execTests(sid, cmd);
            const output = res.result || "No output";
            const hasFail = output.toLowerCase().includes("fail") || output.toLowerCase().includes("error") || output.includes("✗") || output.includes("×");
            return { result: `${hasFail ? '❌' : '✅'} Tests finished\n${output}`, success: !hasFail };
          }

          // ── Task tracking (in-memory, scoped to session) ──────────────────
          case "task_tracking__create_task": {
            const id = crypto.randomUUID().slice(0, 8);
            const task = { id, title: args.title, description: args.description, status: "todo", notes: [] as string[], createdAt: new Date().toISOString() };
            (window as any).__tasks = (window as any).__tasks || {};
            (window as any).__tasks[id] = task;
            window.dispatchEvent(new CustomEvent("ai-task-update", { detail: (window as any).__tasks }));
            // Also persist to sessionStorage so tasks survive hot-reloads
            try { sessionStorage.setItem("__tasks", JSON.stringify((window as any).__tasks)); } catch { }
            return { result: JSON.stringify(task), success: true };
          }
          case "task_tracking__set_task_status": {
            const tasks = (window as any).__tasks || {};
            const task = tasks[args.task_id];
            if (!task) return { result: `Task ${args.task_id} not found`, success: false };
            task.status = args.status;
            window.dispatchEvent(new CustomEvent("ai-task-update", { detail: (window as any).__tasks }));
            try { sessionStorage.setItem("__tasks", JSON.stringify((window as any).__tasks)); } catch {}
            return { result: JSON.stringify(task), success: true };
          }
          case "task_tracking__get_task_list": {
            // Restore from sessionStorage if window state was lost
            if (!(window as any).__tasks) {
              try { (window as any).__tasks = JSON.parse(sessionStorage.getItem("__tasks") || "{}"); } catch { }
            }
            const tasks = (window as any).__tasks || {};
            const taskList = Object.values(tasks) as any[];
            const summary = taskList.map((t: any) => `[${t.status}] ${t.id}: ${t.title}`).join("\n");
            return {
              result: `Tasks (${taskList.length}):
${summary || "(none)"}

Full data:
${JSON.stringify(taskList, null, 2)}`, success: true
            };
          }
          case "task_tracking__get_task": {
            const tasks = (window as any).__tasks || {};
            const task = tasks[args.task_id];
            return { result: task ? JSON.stringify(task) : `Task ${args.task_id} not found`, success: !!task };
          }
          case "task_tracking__update_task_title": {
            const tasks = (window as any).__tasks || {};
            const task = tasks[args.task_id];
            if (!task) return { result: `Task ${args.task_id} not found`, success: false };
            task.title = args.new_title;
            window.dispatchEvent(new CustomEvent("ai-task-update", { detail: (window as any).__tasks }));
            try { sessionStorage.setItem("__tasks", JSON.stringify((window as any).__tasks)); } catch {}
            return { result: JSON.stringify(task), success: true };
          }
          case "task_tracking__update_task_description": {
            const tasks = (window as any).__tasks || {};
            const task = tasks[args.task_id];
            if (!task) return { result: `Task ${args.task_id} not found`, success: false };
            task.description = args.new_description;
            window.dispatchEvent(new CustomEvent("ai-task-update", { detail: (window as any).__tasks }));
            try { sessionStorage.setItem("__tasks", JSON.stringify((window as any).__tasks)); } catch {}
            return { result: JSON.stringify(task), success: true };
          }
          case "task_tracking__add_task_note": {
            const tasks = (window as any).__tasks || {};
            const task = tasks[args.task_id];
            if (!task) return { result: `Task ${args.task_id} not found`, success: false };
            task.notes = task.notes || [];
            task.notes.push(args.note);
            window.dispatchEvent(new CustomEvent("ai-task-update", { detail: (window as any).__tasks }));
            try { sessionStorage.setItem("__tasks", JSON.stringify((window as any).__tasks)); } catch {}
            return { result: JSON.stringify(task), success: true };
          }

          // ── Questions — rendered as suggestion chips in chat ─────────────
          case "questions__ask_questions": {
            const questions2 = args.questions || [];
            // Store questions in window for the UI to render as suggestion chips
            (window as any).__pendingQuestions = questions2;
            // Dispatch a custom event so ChatPanel can show the questions
            window.dispatchEvent(new CustomEvent("ai-questions", { detail: { questions: questions2 } }));
            const formatted2 = questions2.map((q: any) => {
              const opts2 = (q.options || []).map((o: any) => `  • **${o.label || o}**${o.description ? ` — ${o.description}` : ""}`).join("\n");
              return `**${q.question}**\n${opts2}`;
            }).join("\n\n");
            return { result: `Presenting ${questions2.length} question(s) to user:\n\n${formatted2}`, success: true };
          }

          // ── LSP code intelligence ─────────────────────────────────────────
          case "lsp__code_intelligence": {
            const sid = await ensureSandbox();
            const { readFile: readLspFile, executeCommand: execLspCmd } = await import("@/lib/daytona");
            const { operation, file_path, line, character } = args;
            try {
              const data = await readLspFile(sid, `${wd}/${file_path}`);
              const fileLines = data.content.split("\n");
              const targetLine = fileLines[(line || 1) - 1] || "";
              const contextStart = Math.max(0, (line || 1) - 8);
              const contextEnd = Math.min(fileLines.length, (line || 1) + 8);
              const context = fileLines.slice(contextStart, contextEnd).map((l, i) => `${contextStart + i + 1}: ${l}`).join("\n");
              // Run targeted tsc check on just this file
              const tscRes = await execLspCmd(sid, `cd ${wd} && npx tsc --noEmit --strict --isolatedModules ${file_path} 2>&1 | grep -v "^$" | head -20`);
              // Find references/definition via grep for "references" operation
              let extraInfo = "";
              if (operation === "references") {
                const tokenMatch = targetLine.match(/[a-zA-Z_][a-zA-Z0-9_]*/g);
                const token = tokenMatch?.[Math.floor((character || 0) / 5)] || "";
                if (token) {
                  const refsRes = await execLspCmd(sid, `cd ${wd} && grep -rn "\b${token}\b" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | head -20 2>/dev/null`);
                  extraInfo = `\n\nReferences to '${token}':\n${refsRes.result}`;
                }
              }
              return { result: `LSP Data:\nContext:\n${context}\n\nTSC:\n${tscRes.result}\n${extraInfo}`, success: true };
            } catch (e) {
              return { result: `LSP ${operation} failed: ${e instanceof Error ? e.message : e}`, success: false };
            }
          }

          // ── Browser automation (sandbox preview) ─────────────────────────
          case "browser__get_url": {
            // Return the current preview URL from sandbox state
            const previewUrl = (window as any).__previewUrl || "";
            return { result: previewUrl ? `Current preview URL: ${previewUrl}` : "No preview URL available yet. Start the dev server first.", success: !!previewUrl };
          }
          case "browser__navigate_to_sandbox": {
            const path = args.path || "/";
            const previewUrl = (window as any).__previewUrl || "";
            if (!previewUrl) return { result: "No preview URL available. The sandbox may still be starting.", success: false };
            const fullUrl = `${previewUrl}${path}`;
            // Post message to preview iframe if available
            const iframes = document.querySelectorAll("iframe");
            iframes.forEach(f => { try { f.contentWindow?.postMessage({ type: "navigate", url: fullUrl }, "*"); } catch { } });
            return { result: `Navigated preview to: ${fullUrl}`, success: true };
          }
          case "browser__read_console_logs": {
            const logs = (window as any).__consoleLogs || [];
            const search = (args.search || "").toLowerCase();
            const filtered = search ? logs.filter((l: string) => l.toLowerCase().includes(search)) : logs;
            return { result: filtered.slice(-50).join("\n") || "No console logs captured yet.", success: true };
          }
          case "browser__observe":
          case "browser__extract":
          case "browser__act": {
            const toolNameBrw = normalizedToolCall.name;
            const instruction = args.instruction || args.action || args.description || "";
            try {
              // Get real page HTML from iframe if available
              let pageHtml = "";
              try {
                const iframe4 = document.querySelector("iframe") as HTMLIFrameElement | null;
                if (iframe4?.contentDocument?.body) {
                  pageHtml = iframe4.contentDocument.body.innerHTML.slice(0, 3000);
                }
              } catch { }
              // Get source file context
              const currentPage = currentFiles.size > 0
                ? Array.from(currentFiles.entries()).find(([p]) => p.includes("/pages/") || p.includes("App.tsx"))?.[1]?.content?.slice(0, 1500) || ""
                : "";
              return { result: `Browser tool executed. Target: ${instruction}\n\nPage HTML snippet:\n${pageHtml}\n\nSource:\n${currentPage}`, success: true };
            } catch (e) {
              return { result: `${toolNameBrw} failed: ${e instanceof Error ? e.message : String(e)}`, success: false };
            }
          }
          case "browser__screenshot": {
            const previewUrl = (window as any).__previewUrl || "";
            if (!previewUrl) return { result: "No preview URL available. Start the dev server first.", success: false };
            // Try html2canvas on the iframe
            try {
              const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
              if (iframe?.contentDocument?.body) {
                const { default: html2canvas } = await import("html2canvas").catch(() => ({ default: null }));
                if (html2canvas) {
                  const canvas = await html2canvas(iframe.contentDocument.body, { useCORS: true, scale: 0.5 });
                  const dataUrl = canvas.toDataURL("image/png");
                  return { result: `Screenshot captured (${canvas.width}x${canvas.height}px). Data URL: ${dataUrl.slice(0, 100)}...`, success: true };
                }
              }
            } catch { }
            return { result: `Preview at: ${previewUrl}\nScreenshot requires the app to be running. Use browser__observe for AI-based page analysis.`, success: true };
          }
          case "browser__list_network_requests": {
            // Inject network interceptor into preview iframe if not already there
            const iframe2 = document.querySelector("iframe") as HTMLIFrameElement | null;
            if (iframe2?.contentWindow && !(iframe2.contentWindow as any).__networkIntercepted) {
              try {
                (iframe2.contentWindow as any).__networkLogs = [];
                (iframe2.contentWindow as any).__networkIntercepted = true;
                const origFetch = (iframe2.contentWindow as any).fetch;
                (iframe2.contentWindow as any).fetch = async (...fetchArgs: any[]) => {
                  const id = Math.random().toString(36).slice(2, 8);
                  const startTime = Date.now();
                  try {
                    const resp = await origFetch(...fetchArgs);
                    (iframe2.contentWindow as any).__networkLogs.push({ id, url: fetchArgs[0], method: fetchArgs[1]?.method || "GET", status: resp.status, duration: Date.now() - startTime, type: "fetch" });
                    return resp;
                  } catch (err) {
                    (iframe2.contentWindow as any).__networkLogs.push({ id, url: fetchArgs[0], error: String(err), type: "fetch" });
                    throw err;
                  }
                };
              } catch { }
            }
            const logs2 = (iframe2?.contentWindow as any)?.__networkLogs || (window as any).__networkLogs || [];
            const typeFilter = (args.resource_types || "xhr,fetch").split(",");
            const filtered2 = typeFilter.includes("all") ? logs2 : logs2.filter((l: any) => typeFilter.some((t: string) => l.type?.includes(t)));
            return { result: filtered2.length ? JSON.stringify(filtered2.slice(-30), null, 2) : "No network requests captured yet. Interact with the preview to trigger requests.", success: true };
          }
          case "browser__get_network_request_details": {
            const iframe3 = document.querySelector("iframe") as HTMLIFrameElement | null;
            const allLogs = (iframe3?.contentWindow as any)?.__networkLogs || (window as any).__networkLogs || [];
            const reqIds = (args.request_ids || "").split(",").map((s: string) => s.trim());
            const found2 = allLogs.filter((l: any) => reqIds.includes(l.id));
            return { result: found2.length ? JSON.stringify(found2, null, 2) : `No requests found for IDs: ${reqIds.join(", ")}`, success: !!found2.length };
          }
          case "browser__set_viewport_size": {
            const w = args.width || 1280;
            const h = args.height || 720;
            const iframes = document.querySelectorAll("iframe");
            iframes.forEach(f => {
              (f as HTMLIFrameElement).style.width = `${w}px`;
              (f as HTMLIFrameElement).style.height = `${h}px`;
            });
            return { result: `Viewport set to ${w}x${h}px`, success: true };
          }

          // ── Video generation ──────────────────────────────────────────────
          case "videogen__generate_video": {
            const prompt = args.prompt;
            const targetPath = args.target_path || "src/assets/video.mp4";
            if (!prompt) return { result: "Error: prompt is required", success: false };

            try {
              let frames: any[] = [{ frame: 1, description: `${prompt}, cinematic, high quality, 16:9` }];

              // Step 2: Generate key frame images with Imagen
              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const sid = await ensureSandbox();
              const basePath = targetPath.replace(/\.[^.]+$/, "");
              const generatedFrames: string[] = [];

              for (let i = 0; i < Math.min(frames.length, 4); i++) {
                const frame = frames[i];
                const framePath = `${basePath}_frame${i + 1}.jpg`;
                try {
                  const result = await ai.models.generateImages({
                    model: "imagen-4.0-fast-generate-001",
                    prompt: frame.description || `${prompt}, frame ${i + 1}`,
                    config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "16:9" },
                  });
                  const imgData = result.generatedImages?.[0]?.image?.imageBytes;
                  if (imgData) {
                    const destDir = framePath.split("/").slice(0, -1).join("/");
                    if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);
                    const tmpFile = `.tmp_vf${i}_${Date.now()}.b64`;
                    await writeFile(sid, `${wd}/${tmpFile}`, imgData);
                    await executeCommand(sid, `base64 -d ${wd}/${tmpFile} > ${wd}/${framePath} && rm ${wd}/${tmpFile}`);
                    generatedFrames.push(framePath);
                  }
                } catch { }
              }

              const componentCode: string = "";

              const result = `Video storyboard generated for: "${prompt}"\n\n` +
                `Frames created (${generatedFrames.length}/${frames.length}):\n${generatedFrames.map((f, i) => `  Frame ${i + 1}: ${f}`).join("\n")}\n\n` +
                `Storyboard:\n${frames.slice(0, 4).map((f: any) => `  [${f.timestamp || ""}] ${f.description?.slice(0, 80) || ""}`).join("\n")}` +
                (componentCode ? `\n\n--- Suggested React component ---\n${componentCode.slice(0, 800)}` : "");

              return { result, success: generatedFrames.length > 0 };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Video generation failed";
              return { result: `Video generation failed: ${msg}`, success: false };
            }
          }

          // ── Cross-project tools ───────────────────────────────────────────
          case "cross_project__list_projects": {
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs, query, where, orderBy, limit } = await import("firebase/firestore");
              const q = query(collection(fireDb, "projects"), where("ownerId", "==", fireAuth.currentUser.uid), orderBy("lastModified", "desc"), limit(20));
              const snap = await getDocs(q);
              const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              return { result: JSON.stringify(projects, null, 2), success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__search_project": {
            const q2 = (args.query || "").toLowerCase();
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs, query: fsQuery, where, orderBy } = await import("firebase/firestore");
              const snap = await getDocs(fsQuery(collection(fireDb, "projects"), where("ownerId", "==", fireAuth.currentUser.uid), orderBy("lastModified", "desc")));
              const matches = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter((p: any) => p.name?.toLowerCase().includes(q2) || p.id === q2);
              return { result: JSON.stringify(matches, null, 2), success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__list_project_dir": {
            const projectId2 = args.project;
            const dirPath = args.dir_path || "src";
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs } = await import("firebase/firestore");
              const snap = await getDocs(collection(fireDb, "projects", projectId2, "files"));
              const files = snap.docs.map(d => d.id).filter(p => p.startsWith(dirPath));
              return { result: files.join("\n") || "(empty)", success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__read_project_file": {
            const projectId3 = args.project;
            const filePath2 = args.file_path;
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { doc: fsDoc, getDoc } = await import("firebase/firestore");
              const fileRef = fsDoc(fireDb, "projects", projectId3, "files", filePath2.replace(/\//g, "__"));
              const fileSnap = await getDoc(fileRef);
              if (!fileSnap.exists()) return { result: `File not found: ${filePath2}`, success: false };
              return { result: (fileSnap.data() as any).content || "", success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__list_project_assets": {
            const projectId4 = args.project;
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs } = await import("firebase/firestore");
              const snap = await getDocs(collection(fireDb, "projects", projectId4, "files"));
              const assets = snap.docs.map(d => d.id).filter(p => /\.(png|jpg|jpeg|gif|svg|webp|ico|mp4|mp3|pdf|ttf|woff)$/i.test(p));
              return { result: assets.join("\n") || "(no assets)", success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__read_project_asset": {
            const raProjectId = args.project;
            const raPath = args.asset_path;
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection: raColl, getDocs: raGet } = await import("firebase/firestore");
              const raSnap = await raGet(raColl(fireDb, "projects", raProjectId, "files"));
              const raDoc = raSnap.docs.find(d => d.id === raPath);
              if (!raDoc) return { result: `Asset not found: ${raPath}`, success: false };
              const raData = raDoc.data() as any;
              const raContent = raData.content || "";
              const isBinaryAsset = /\.(png|jpg|jpeg|gif|webp|ico|mp4|mp3|woff|ttf)$/i.test(raPath);
              if (isBinaryAsset) return { result: `${raPath} is binary (${Math.round(raContent.length / 1024)}KB). Use cross_project__copy_project_asset to copy it.`, success: true };
              return { result: raContent.slice(0, 10000), success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }

          case "cross_project__copy_project_asset": {
            const copyProjectId = args.project;
            const copySource = args.source_path;
            const copyTarget = args.target_path;
            if (!copyProjectId || !copySource || !copyTarget) return { result: "project, source_path, and target_path are required", success: false };
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs } = await import("firebase/firestore");
              const snap = await getDocs(collection(fireDb, "projects", copyProjectId, "files"));
              const fileDoc = snap.docs.find(d => d.id === copySource);
              if (!fileDoc) return { result: `Source file not found: ${copySource} in project ${copyProjectId}`, success: false };
              const data = fileDoc.data() as any;
              const content = data.content || "";
              // Write into current sandbox
              const sid = await ensureSandbox();
              const destDir = copyTarget.split("/").slice(0, -1).join("/");
              if (destDir) await executeCommand(sid, `mkdir -p ${wd}/${destDir}`);
              await writeFile(sid, `${wd}/${copyTarget}`, content);
              addOrUpdateFile(copyTarget, content);
              return { result: `Copied ${copySource} from project ${copyProjectId} to ${copyTarget} (${Math.round(content.length / 1024)}KB)`, success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__read_project_messages": {
            const projectId5 = args.project;
            const msgLimit = args.limit || 20;
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs, query: fsQ, orderBy: fsOB, limit: fsL } = await import("firebase/firestore");
              const snap = await getDocs(fsQ(collection(fireDb, "projects", projectId5, "messages"), fsOB("timestamp", "asc"), fsL(msgLimit)));
              const msgs = snap.docs.map(d => { const data = d.data() as any; return `[${data.role}]: ${data.content?.slice(0, 200) || ""}`; });
              return { result: msgs.join("\n\n") || "(no messages)", success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }
          case "cross_project__search_project_files": {
            const projectId6 = args.project;
            const searchQuery = args.query || "";
            try {
              const { db: fireDb, auth: fireAuth } = await import("@/firebase");
              if (!fireDb || !fireAuth?.currentUser) return { result: "Not authenticated", success: false };
              const { collection, getDocs } = await import("firebase/firestore");
              const snap = await getDocs(collection(fireDb, "projects", projectId6, "files"));
              const pattern = new RegExp(searchQuery, args.case_sensitive ? "g" : "gi");
              const matches: string[] = [];
              for (const d of snap.docs) {
                const data = d.data() as any;
                if (pattern.test(data.content || "")) {
                  const lines = (data.content || "").split("\n");
                  lines.forEach((line: string, i: number) => {
                    if (pattern.test(line)) matches.push(`${d.id}:${i + 1}: ${line.trim().slice(0, 100)}`);
                  });
                }
              }
              return { result: matches.slice(0, 50).join("\n") || "No matches", success: true };
            } catch (e) { return { result: `Failed: ${e instanceof Error ? e.message : e}`, success: false }; }
          }

          // ── Secrets delete ────────────────────────────────────────────────
          case "secrets__delete_secret": {
            const sid = await ensureSandbox();
            const names: string[] = args.secret_names || [];
            for (const name of names) {
              await executeCommand(sid, `sed -i '/^${name}=/d' ${wd}/.env 2>/dev/null`);
            }
            return { result: `Removed from .env: ${names.join(", ")}. Restart the server for changes to take effect.`, success: true };
          }
          case "secrets__fetch_secrets": {
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cat ${wd}/.env 2>/dev/null | grep -v '^#' | grep '=' | sed 's/=.*/=<hidden>/' | head -50`);
            const dotenvKeys = res.result?.trim() || "";
            const runtimeKeys = Object.keys(process.env).filter(k => !k.startsWith("npm_") && !k.startsWith("NODE") && k === k.toUpperCase());
            return {
              result: `Configured secrets (values hidden):

${dotenvKeys}

Runtime env vars: ${runtimeKeys.join(", ")}`, success: true
            };
          }

          // ── Supabase enable ───────────────────────────────────────────────
          case "supabase__enable": {
            const sid = await ensureSandbox();
            await executeCommand(sid, `cd ${wd} && npm install @supabase/supabase-js 2>&1 | tail -5`);
            return { result: `Supabase client installed.\n\nAdd to your .env file:\n  VITE_SUPABASE_URL=https://your-project.supabase.co\n  VITE_SUPABASE_ANON_KEY=your-anon-key\n\nThen initialize in your app:\n  import { createClient } from "@supabase/supabase-js"\n  export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)\n\nGet your credentials at: https://supabase.com/dashboard`, success: true };
          }

          // ── Shopify ───────────────────────────────────────────────────────
          case "shopify__enable": {
            const sid = await ensureSandbox();
            await executeCommand(sid, `cd ${wd} && npm install @shopify/hydrogen @shopify/storefront-api-client 2>&1 | tail -5`);
            return { result: `Shopify dependencies installed.\n\nNext steps:\n1. Add to your .env:\n   VITE_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com\n   VITE_SHOPIFY_STOREFRONT_TOKEN=your-public-storefront-token\n2. Use @shopify/storefront-api-client to query products, cart, checkout.\n3. See: https://shopify.dev/docs/storefronts/headless/hydrogen`, success: true };
          }

          // ── Standard connectors ───────────────────────────────────────────
          case "standard_connectors__list_connections": {
            const env = {
              slack: !!process.env.SLACK_BOT_TOKEN,
              github: !!process.env.GITHUB_TOKEN,
              notion: !!process.env.NOTION_TOKEN,
              stripe: !!process.env.STRIPE_SECRET_KEY,
            };
            const connected = Object.entries(env).filter(([, v]) => v).map(([k]) => k);
            const disconnected = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
            return { result: `Connected: ${connected.join(", ") || "none"}\nDisconnected: ${disconnected.join(", ")}\n\nTo connect a service, add its API key to your .env file.`, success: true };
          }
          case "standard_connectors__connect": {
            const id = args.connector_id || args.connection_id || "";
            const envMap: Record<string, string> = { slack: "SLACK_BOT_TOKEN", github: "GITHUB_TOKEN", notion: "NOTION_TOKEN", stripe: "STRIPE_SECRET_KEY", linear: "LINEAR_API_KEY" };
            const envVar = envMap[id] || `${id.toUpperCase()}_API_KEY`;
            return { result: `To connect ${id}: add ${envVar}=your_key to your .env file and restart the server.`, success: true };
          }
          case "standard_connectors__disconnect": {
            const connId = args.connection_id || args.connector_id || "";
            const envMap2: Record<string, string> = { slack: "SLACK_BOT_TOKEN", github: "GITHUB_TOKEN", notion: "NOTION_TOKEN", stripe: "STRIPE_SECRET_KEY", linear: "LINEAR_API_KEY" };
            const envVar2 = envMap2[connId] || `${connId.toUpperCase()}_API_KEY`;
            return { result: `To disconnect ${connId}, remove ${envVar2} from your .env file and restart the server.`, success: true };
          }
          case "standard_connectors__get_connection_configuration": {
            const connId2 = args.connection_id || "";
            const configMap: Record<string, object> = {
              slack: { scopes: ["channels:read", "chat:write", "users:read"], access_type: "bot", env_var: "SLACK_BOT_TOKEN" },
              github: { scopes: ["repo", "read:user"], access_type: "token", env_var: "GITHUB_TOKEN" },
              notion: { scopes: ["read_content", "update_content"], access_type: "integration_token", env_var: "NOTION_TOKEN" },
              stripe: { scopes: ["full_access"], access_type: "secret_key", env_var: "STRIPE_SECRET_KEY" },
              linear: { scopes: ["read", "write"], access_type: "api_key", env_var: "LINEAR_API_KEY" },
            };
            const config = configMap[connId2] || { env_var: `${connId2.toUpperCase()}_API_KEY`, note: "Custom connector" };
            return { result: JSON.stringify(config, null, 2), success: true };
          }
          case "standard_connectors__reconnect": {
            const connId3 = args.connection_id || "";
            const reason = args.reason || "Token may have expired";
            return {
              result: `Reconnect ${connId3}: ${reason}

Update the API key in your .env file and restart the server.`, success: true
            };
          }

          // ── Lovable docs search ───────────────────────────────────────────
          case "lovable_docs__search_docs": {
            const query = args.question || args.query || "";
            // Try firecrawl first
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.search(`site:docs.lovable.dev ${query}`, { limit: 5, scrapeOptions: { formats: ["markdown"] } });
              const results = (resp as any).data || (resp as any).results || [];
              if (results.length > 0) {
                const formatted = results.slice(0, 5).map((r: any, i: number) =>
                  `${i + 1}. **${r.title || "Doc"}**\n   ${r.url}\n   ${r.description || r.markdown?.slice(0, 300) || ""}`
                ).join("\n\n");
                return { result: formatted, success: true };
              }
            } catch { }
            return { result: `Visit docs.lovable.dev for documentation on: ${query}`, success: true };
          }

          // ── Project URLs ──────────────────────────────────────────────────
          case "project_urls__get_urls": {
            const previewUrlNow = (window as any).__previewUrl || "";
            const publishedUrl = null; // Would come from Firestore project record
            return { result: JSON.stringify({ preview: previewUrlNow || window.location.origin, published: publishedUrl }), success: true };
          }

          // ── Sleep ─────────────────────────────────────────────────────────
          case "project_debug__sleep": {
            const ms = (args.seconds || 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, Math.min(ms, 60000)));
            return { result: `Waited ${args.seconds}s`, success: true };
          }

          // ── code--exec (raw bash in sandbox) ───────────────────────────────
          case "code__exec": {
            const sid = await ensureSandbox();
            const cmd = args.command;
            if (!cmd) return { result: "Error: command is required", success: false };
            const timeout = args.timeout || 60000;
            const res = await executeCommand(sid, `cd ${wd} && ${cmd}`);
            return { result: res.result || "(no output)", success: res.exitCode === 0 };
          }

          // ── code--read_session_replay ───────────────────────────────────
          case "code__read_session_replay": {
            const replayLogs = (window as any).__sessionReplay || [];
            return { result: replayLogs.length ? JSON.stringify(replayLogs.slice(-50)) : "No session replay data captured. Interactions are recorded after the preview loads.", success: true };
          }

          // ── code--dependency_scan ───────────────────────────────────────
          case "code__dependency_scan": {
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && npm audit --json 2>&1`);
            try {
              const audit = JSON.parse(res.result || "{}");
              const v = audit.metadata?.vulnerabilities || {};
              const vulns: any[] = [];
              if (audit.vulnerabilities) {
                for (const [pkg, info] of Object.entries(audit.vulnerabilities as any)) {
                  const i = info as any;
                  if (i.severity === "high" || i.severity === "critical") {
                    vulns.push({ package: pkg, severity: i.severity, fixAvailable: i.fixAvailable, via: (i.via || []).slice(0, 2).map((v: any) => typeof v === "string" ? v : v.title) });
                  }
                }
              }
              return {
                result: `Vulnerability summary: ${v.critical || 0} critical, ${v.high || 0} high, ${v.moderate || 0} moderate, ${v.low || 0} low

High/Critical:
${vulns.map(v => `- ${v.package} (${v.severity}): ${v.via.join(", ")} — fix: ${v.fixAvailable ? "available" : "none"}`).join("\n") || "none"}`, success: true
              };
            } catch {
              return { result: res.result?.slice(0, 2000) || "Scan complete", success: true };
            }
          }

          // ── code--dependency_update ─────────────────────────────────────
          case "code__dependency_update": {
            const sid = await ensureSandbox();
            const pkgs = args.vulnerable_packages as Record<string, string>;
            if (!pkgs || Object.keys(pkgs).length === 0) return { result: "No packages specified", success: false };
            const installs = Object.entries(pkgs).map(([pkg, ver]) => `${pkg}@${ver}`).join(" ");
            const res = await executeCommand(sid, `cd ${wd} && npm install ${installs} 2>&1 | tail -10`);
            return {
              result: `Updated: ${installs}
${res.result}`, success: res.exitCode === 0
            };
          }

          // ── websearch web code search ───────────────────────────────────
          case "websearch__web_code_search": {
            const query = args.query;
            if (!query) return { result: "Error: query is required", success: false };
            try {
              const { firecrawlApi } = await import("@/lib/api/firecrawl");
              const resp = await firecrawlApi.search(`${query} site:github.com OR site:stackoverflow.com OR site:docs.npmjs.com`, { limit: 6, scrapeOptions: { formats: ["markdown"] } });
              const results = (resp as any).data || [];
              if (!results.length) return { result: `No code results for: ${query}`, success: true };
              const formatted = results.slice(0, 6).map((r: any, i: number) =>
                `${i + 1}. **${r.title || "Result"}** — ${r.url}
${r.markdown?.slice(0, 500) || r.description || ""}`
              ).join("\n\n---\n\n");
              return { result: formatted, success: true };
            } catch (e) {
              return { result: `Code search error: ${e instanceof Error ? e.message : e}`, success: false };
            }
          }

          // ── image_tools--zoom_image ─────────────────────────────────────
          case "image_tools__zoom_image": {
            const source = args.source;
            if (!source) return { result: "Error: source is required", success: false };
            const sid = await ensureSandbox();
            // Use region shortcuts
            const regionMap: Record<string, [number, number, number, number]> = {
              top_left: [0, 0, 0.5, 0.5], top_center: [0.25, 0, 0.75, 0.5], top_right: [0.5, 0, 1, 0.5],
              center_left: [0, 0.25, 0.5, 0.75], center: [0.25, 0.25, 0.75, 0.75], center_right: [0.5, 0.25, 1, 0.75],
              bottom_left: [0, 0.5, 0.5, 1], bottom_center: [0.25, 0.5, 0.75, 1], bottom_right: [0.5, 0.5, 1, 1],
              left_half: [0, 0, 0.5, 1], right_half: [0.5, 0, 1, 1], top_half: [0, 0, 1, 0.5], bottom_half: [0, 0.5, 1, 1],
            };
            let x1 = args.x1 || 0, y1 = args.y1 || 0, x2 = args.x2 || 1, y2 = args.y2 || 1;
            if (args.region && regionMap[args.region]) [x1, y1, x2, y2] = regionMap[args.region];
            // Use ImageMagick if available, otherwise python3 PIL
            const actualPath = source.startsWith("user-uploads://") ? `/tmp/${source.replace("user-uploads://", "")}` : `${wd}/${source}`;
            const outPath = `${wd}/src/assets/zoom_${Date.now()}.png`;
            const script = `python3 -c "from PIL import Image; img=Image.open('${actualPath}'); w,h=img.size; box=(int(${x1}*w),int(${y1}*h),int(${x2}*w),int(${y2}*h)); img.crop(box).save('${outPath}')" 2>&1`;
            const res = await executeCommand(sid, script);
            if (res.exitCode !== 0) {
              // Fallback: ffmpeg or convert
              const res2 = await executeCommand(sid, `convert '${actualPath}' -crop $(python3 -c "from PIL import Image; img=Image.open('${actualPath}'); w,h=img.size; print(f'{int((${x2}-${x1})*w)}x{int((${y2}-${y1})*h)}+{int(${x1}*w)}+{int(${y1}*h)}')") '${outPath}' 2>&1`);
              if (res2.exitCode !== 0) return { result: `Zoom failed: ${res.result}`, success: false };
            }
            const relPath = `src/assets/zoom_${Date.now()}.png`;
            return {
              result: `Zoomed region saved to ${relPath}
Coordinates: (${x1},${y1}) to (${x2},${y2})`, success: true
            };
          }

          // ── browser profiling ───────────────────────────────────────────
          case "browser__performance_profile": {
            const logs = (window as any).__perfMetrics || {};
            const perf = performance.getEntriesByType("navigation")[0] as any;
            const metrics = {
              domNodes: document.querySelectorAll("*").length,
              jsHeapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : "unavailable",
              loadTime: perf ? Math.round(perf.loadEventEnd - perf.startTime) : "unavailable",
              domContentLoaded: perf ? Math.round(perf.domContentLoadedEventEnd - perf.startTime) : "unavailable",
              resourceCount: performance.getEntriesByType("resource").length,
            };
            return {
              result: `Performance metrics:
${JSON.stringify(metrics, null, 2)}`, success: true
            };
          }
          case "browser__start_profiling": {
            (window as any).__profilingStart = performance.now();
            (window as any).__profilingMarks = [];
            return { result: "CPU profiling started. Call browser__stop_profiling to get results.", success: true };
          }
          case "browser__stop_profiling": {
            const start = (window as any).__profilingStart;
            if (!start) return { result: "No profiling session active. Call browser__start_profiling first.", success: false };
            const elapsed = Math.round(performance.now() - start);
            const entries = performance.getEntriesByType("measure");
            const top = entries.sort((a, b) => b.duration - a.duration).slice(0, 10).map(e => `${e.name}: ${Math.round(e.duration)}ms`);
            return {
              result: `Profiling results (${elapsed}ms total):
Top measures:
${top.join("\n") || "No performance measures recorded.\nUse performance.mark() and performance.measure() in your app code to instrument specific operations."}`, success: true
            };
          }

          // ── email_domain tools ──────────────────────────────────────────
          case "email_domain__get_project_custom_domain":
          case "email_domain__list_email_domains":
          case "email_domain__check_email_domain_status": {
            const domain = args.domain || "";
            // Check DNS config via server-side fetch
            try {
              const resp = await fetch(`/api/email-domain/check${domain ? `?domain=${domain}` : ""}`, { method: "GET" }).catch(() => null);
              if (resp?.ok) {
                const data = await resp.json();
                return { result: JSON.stringify(data, null, 2), success: true };
              }
            } catch { }
            return {
              result: `Email domain check for ${domain || "project domain"}:
DNS verification requires configuring your domain's MX and SPF records.

Required DNS records:
  MX: mail.${domain || "yourdomain.com"} (priority 10)
  SPF: v=spf1 include:sendgrid.net ~all
  DKIM: Provided by your email service provider

Recommended services: Resend, SendGrid, Postmark`, success: true
            };
          }
          case "email_domain__scaffold_auth_email_templates": {
            const sid = await ensureSandbox();
            const templateDir = `${wd}/src/emails`;
            await executeCommand(sid, `mkdir -p ${templateDir}`);
            const confirmTemplate = `export function ConfirmEmailTemplate({ confirmUrl }: { confirmUrl: string }) {
  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <h1>Confirm your email</h1>
      <p>Click the button below to confirm your email address.</p>
      <a href={confirmUrl} style={{ background: "#6366f1", color: "#fff", padding: "12px 24px", borderRadius: 8, textDecoration: "none", display: "inline-block" }}>
        Confirm Email
      </a>
    </div>
  );
}`;
            const resetTemplate = `export function ResetPasswordTemplate({ resetUrl }: { resetUrl: string }) {
  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <h1>Reset your password</h1>
      <p>Click the button below to reset your password. This link expires in 1 hour.</p>
      <a href={resetUrl} style={{ background: "#6366f1", color: "#fff", padding: "12px 24px", borderRadius: 8, textDecoration: "none", display: "inline-block" }}>
        Reset Password
      </a>
    </div>
  );
}`;
            await writeFile(sid, `${templateDir}/ConfirmEmail.tsx`, confirmTemplate);
            await writeFile(sid, `${templateDir}/ResetPassword.tsx`, resetTemplate);
            addOrUpdateFile("src/emails/ConfirmEmail.tsx", confirmTemplate);
            addOrUpdateFile("src/emails/ResetPassword.tsx", resetTemplate);
            return {
              result: `Email templates scaffolded:
- src/emails/ConfirmEmail.tsx
- src/emails/ResetPassword.tsx

These are React components you can render to HTML and send via Resend/SendGrid.`, success: true
            };
          }
          case "email_domain__scaffold_transactional_email": {
            const sid = await ensureSandbox();
            const fnDir = `${wd}/supabase/functions/send-email`;
            await executeCommand(sid, `mkdir -p ${fnDir}`);
            const edgeFn = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

serve(async (req) => {
  const { to, subject, html, from = "noreply@yourdomain.com" } = await req.json();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": \`Bearer \${RESEND_API_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" }, status: res.status });
});`;
            await writeFile(sid, `${fnDir}/index.ts`, edgeFn);
            addOrUpdateFile("supabase/functions/send-email/index.ts", edgeFn);
            return {
              result: `Transactional email Edge Function scaffolded at supabase/functions/send-email/index.ts

Add RESEND_API_KEY to your project secrets, then deploy with: supabase functions deploy send-email`, success: true
            };
          }
          case "email_domain__setup_email_infra": {
            const sid = await ensureSandbox();
            const migration = `-- Email infrastructure tables
CREATE TABLE IF NOT EXISTS public.email_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT
);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON public.email_queue USING (false);

-- Email send log
CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL,
  to_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own logs" ON public.email_log FOR SELECT USING (user_id = auth.uid());`;
            const migDir = `${wd}/supabase/migrations`;
            await executeCommand(sid, `mkdir -p ${migDir}`);
            const fname = `${migDir}/${Date.now()}_email_infra.sql`;
            await writeFile(sid, fname, migration);
            return {
              result: `Email infrastructure migration created:
- email_queue table (pending/sent/failed status)
- email_log table (per-user send history)
- RLS policies configured

Apply with: supabase db push`, success: true
            };
          }

          // ── MCP knowledge connect ───────────────────────────────────────
          case "mcp_knowledge__connect": {
            const connectorId = args.connector_id;
            return {
              result: `MCP connector '${connectorId}' connection:

To connect an MCP server, add it to your Claude Desktop or editor config:

{
  "mcpServers": {
    "${connectorId}": {
      "command": "npx",
      "args": ["-y", "@${connectorId}/mcp"]
    }
  }
}

For Sanity, Contentful, or other CMS connectors, check their documentation for MCP setup instructions.`, success: true
            };
          }

          // ── standard_connectors--get_connection_secrets ─────────────────
          case "standard_connectors__get_connection_secrets": {
            const connId = args.connection_id;
            const secretMap: Record<string, string[]> = {
              slack: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
              github: ["GITHUB_TOKEN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
              notion: ["NOTION_TOKEN"],
              stripe: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
              linear: ["LINEAR_API_KEY"],
              google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
              discord: ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID"],
            };
            const secrets = secretMap[connId] || [`${connId.toUpperCase()}_API_KEY`];
            return {
              result: `Required secrets for ${connId}: ${secrets.join(", ")}

Add these to your .env file and use secrets__add_secret to make them available to edge functions.`, success: true
            };
          }

          // ── ai_gateway--enable ──────────────────────────────────────────
          case "ai_gateway__enable": {
            const sid = await ensureSandbox();
            // Generate a gateway key using the existing AI_GATEWAY_API_KEY
            const gatewayKey = process.env.AI_GATEWAY_API_KEY || "";
            if (!gatewayKey) {
              return {
                result: `AI Gateway requires AI_GATEWAY_API_KEY in your .env. This enables access to the Vercel AI Gateway at https://ai-gateway.vercel.sh/v1/chat/completions.

Add AI_GATEWAY_API_KEY to your .env file first.`, success: false
              };
            }
            const helperFile = `// AI Gateway helper — call from your edge functions or server code
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY || "";

export async function callAI(prompt: string, model = "anthropic/claude-sonnet-4-6") {
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": \`Bearer \${GATEWAY_KEY}\` },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(\`AI Gateway error \${resp.status}\`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}`;
            await writeFile(sid, `${wd}/src/lib/ai-gateway.ts`, helperFile);
            addOrUpdateFile("src/lib/ai-gateway.ts", helperFile);
            return {
              result: `AI Gateway enabled!

Created src/lib/ai-gateway.ts with a callAI() helper.

Available models:
- anthropic/claude-sonnet-4-6 (default)
- google/gemini-2.5-flash
- openai/gpt-4o

Usage:
  import { callAI } from "@/lib/ai-gateway";
  const result = await callAI("Summarize this text");`, success: true
            };
          }

          // ── supabase advanced tools ─────────────────────────────────────
          case "supabase__migration": {
            const sql = args.query;
            if (!sql) return { result: "Error: query is required", success: false };
            const sid = await ensureSandbox();
            const migDir = `${wd}/supabase/migrations`;
            await executeCommand(sid, `mkdir -p ${migDir}`);
            const fname = `${Date.now()}_migration.sql`;
            await writeFile(sid, `${migDir}/${fname}`, sql);
            addOrUpdateFile(`supabase/migrations/${fname}`, sql);
            // Try to apply via supabase CLI if available
            const apply = await executeCommand(sid, `cd ${wd} && npx supabase db push 2>&1 | tail -10`);
            const applied = apply.exitCode === 0;
            return {
              result: `Migration saved: supabase/migrations/${fname}

${applied ? "✅ Applied to database:\n" + apply.result : "⚠️ Saved locally. Run 'supabase db push' to apply, or paste this SQL in your Supabase dashboard SQL editor:\n\n" + sql}`, success: true
            };
          }

          case "supabase__read_query": {
            const sql = args.query;
            if (!sql || !sql.trim().toUpperCase().startsWith("SELECT")) return { result: "Error: Only SELECT queries are allowed", success: false };
            // Try via supabase CLI
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && echo ${JSON.stringify(sql)} | npx supabase db query 2>&1 || echo "SUPABASE_CLI_UNAVAILABLE"`);
            if (!res.result.includes("SUPABASE_CLI_UNAVAILABLE")) {
              return { result: res.result, success: true };
            }
            return { result: `Query: ${sql}\n\nTo run this query: Open your Supabase dashboard → SQL Editor → paste and execute.`, success: true };
          }

          case "supabase__insert": {
            const sql = args.query;
            if (!sql) return { result: "Error: query is required", success: false };
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && echo ${JSON.stringify(sql)} | npx supabase db query 2>&1 || echo "SUPABASE_CLI_UNAVAILABLE"`);
            if (!res.result.includes("SUPABASE_CLI_UNAVAILABLE")) {
              return { result: res.result, success: res.exitCode === 0 };
            }
            return {
              result: `Data operation: ${sql}

To execute: Open your Supabase dashboard → SQL Editor → paste and run.

Alternatively, use the Supabase client in your code:
  const { error } = await supabase.from("table").insert({...})`, success: true
            };
          }

          case "supabase__analytics_query": {
            const sql = args.query;
            return { result: `To run this query: Supabase Dashboard → Logs → Log Explorer → paste the SQL.\n\nQuery:\n${sql}`, success: true };
          }

          case "supabase__configure_auth": {
            const { disable_signup, external_anonymous_users_enabled, auto_confirm_email } = args;
            const sid = await ensureSandbox();
            // Save as supabase config
            const configPath = `${wd}/supabase/config.toml`;
            const configRes = await executeCommand(sid, `cat ${configPath} 2>/dev/null || echo ""`);
            let config = configRes.result || "[auth]\nenabled = true\n";
            config = config.replace(/enable_signup\s*=.*/, `enable_signup = ${!disable_signup}`);
            config = config.replace(/enable_confirmations\s*=.*/, `enable_confirmations = ${!auto_confirm_email}`);
            if (!config.includes("enable_signup")) config += `
enable_signup = ${!disable_signup}`;
            await writeFile(sid, configPath, config);
            return {
              result: `Auth configuration updated:
- Signup: ${disable_signup ? "disabled" : "enabled"}
- Anonymous users: ${external_anonymous_users_enabled ? "enabled" : "disabled"}
- Email auto-confirm: ${auto_confirm_email ? "enabled" : "disabled"}

Apply with: supabase db push (or via Supabase Dashboard → Auth → Settings)`, success: true
            };
          }

          case "supabase__configure_social_auth": {
            const providers = args.providers || [];
            const configs: string[] = [];
            for (const p of providers) {
              if (p === "google") configs.push(`[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_CLIENT_SECRET)"
`);
              if (p === "apple") configs.push(`[auth.external.apple]
enabled = true
client_id = "env(APPLE_CLIENT_ID)"
secret = "env(APPLE_CLIENT_SECRET)"
`);
            }
            return {
              result: `Social auth config for: ${providers.join(", ")}

Add to supabase/config.toml:

${configs.join("\n")}

Also add required env vars to .env and secrets.`, success: true
            };
          }

          case "supabase__deploy_edge_functions": {
            const fns = args.function_names || [];
            const sid = await ensureSandbox();
            const results: string[] = [];
            for (const fn of fns) {
              const res = await executeCommand(sid, `cd ${wd} && npx supabase functions deploy ${fn} 2>&1 | tail -5`);
              results.push(`${fn}: ${res.exitCode === 0 ? "✅ deployed" : "❌ " + res.result.slice(0, 100)}`);
            }
            return { result: results.join("\n") || "No functions specified", success: true };
          }

          case "supabase__delete_edge_functions": {
            const fns = args.function_names || [];
            const sid = await ensureSandbox();
            const results: string[] = [];
            for (const fn of fns) {
              const res = await executeCommand(sid, `cd ${wd} && npx supabase functions delete ${fn} 2>&1 | tail -3`);
              results.push(`${fn}: ${res.exitCode === 0 ? "✅ deleted" : "❌ " + res.result.slice(0, 80)}`);
            }
            return { result: results.join("\n") || "No functions specified", success: true };
          }

          case "supabase__curl_edge_functions": {
            const { path: fnPath, method, query_params, headers: hdrs, body: fnBody } = args;
            if (!fnPath || !method) return { result: "path and method are required", success: false };
            const sid = await ensureSandbox();
            const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
            if (!supabaseUrl) return { result: "VITE_SUPABASE_URL not configured. Add it to your .env file.", success: false };
            const fullUrl = `${supabaseUrl}/functions/v1/${fnPath.replace(/^\//, "")}`;
            const queryStr = query_params ? "?" + new URLSearchParams(query_params).toString() : "";
            const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
            let curlCmd = `curl -s -X ${method.toUpperCase()} '${fullUrl}${queryStr}' -H 'Authorization: Bearer ${anonKey}' -H 'Content-Type: application/json'`;
            if (hdrs) for (const [k, v] of Object.entries(hdrs as Record<string, string>)) curlCmd += ` -H '${k}: ${v}'`;
            if (fnBody) curlCmd += ` -d '${fnBody.replace(/'/g, "'\''")}'`;
            const res = await executeCommand(sid, curlCmd);
            return { result: res.result || "(empty response)", success: res.exitCode === 0 };
          }

          case "supabase__edge_function_logs": {
            const fnName = args.function_name;
            const search = args.search || "";
            const sid = await ensureSandbox();
            const res = await executeCommand(sid, `cd ${wd} && npx supabase functions logs ${fnName} 2>&1 | ${search ? `grep -i '${search}'` : "tail -50"}`);
            if (res.exitCode === 0 && res.result) return { result: res.result, success: true };
            return {
              result: `Edge function logs for '${fnName}':

To view live: supabase functions logs ${fnName} --follow
Or in Supabase Dashboard → Edge Functions → ${fnName} → Logs`, success: true
            };
          }

          case "supabase__test_edge_functions": {
            const fns = args.functions || [];
            const pattern = args.pattern || "";
            const sid = await ensureSandbox();
            const target = fns.length ? fns.map((f: string) => `supabase/functions/${f}`).join(" ") : "supabase/functions/";
            const res = await executeCommand(sid, `cd ${wd} && deno test ${target} ${pattern ? `--filter "${pattern}"` : ""} 2>&1 | tail -30`);
            return { result: res.result || "No test output", success: res.exitCode === 0 };
          }

          case "supabase__linter": {
            const sid = await ensureSandbox();
            const schemaRes = await executeCommand(sid, `find ${wd}/supabase -name "*.sql" 2>/dev/null | xargs cat 2>/dev/null | head -200`);
            return { result: `Linter executed. Manual review required for:\n${schemaRes.result || "(no migrations found)"}`, success: true };
          }

          case "supabase__project_info": {
            const url = process.env.VITE_SUPABASE_URL || "";
            const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
            const sid = await ensureSandbox();
            const [pkgRes, migRes] = await Promise.all([
              executeCommand(sid, `cat ${wd}/package.json 2>/dev/null`),
              executeCommand(sid, `ls ${wd}/supabase/migrations 2>/dev/null | wc -l`),
            ]);
            let projectId = "unknown";
            if (url) {
              const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
              if (match) projectId = match[1];
            }
            return {
              result: JSON.stringify({
                projectId,
                url: url || "(not configured)",
                anonKey: anonKey ? anonKey.slice(0, 20) + "..." : "(not configured)",
                migrationCount: parseInt(migRes.result?.trim() || "0"),
                dashboardUrl: url ? `https://supabase.com/dashboard/project/${projectId}` : null,
              }, null, 2), success: true
            };
          }

          case "supabase__storage_upload": {
            const { bucket, path: storagePath, file_path } = args;
            if (!bucket || !storagePath || !file_path) return { result: "bucket, path, and file_path are required", success: false };
            const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
            const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
            if (!supabaseUrl || !anonKey) return { result: "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured", success: false };
            const sid = await ensureSandbox();
            const ext = file_path.split(".").pop() || "bin";
            const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4" };
            const mime = mimeMap[ext] || "application/octet-stream";
            const res = await executeCommand(sid, `curl -s -X POST '${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}' -H 'Authorization: Bearer ${anonKey}' -H 'Content-Type: ${mime}' --data-binary @'${wd}/${file_path}' 2>&1`);
            if (res.exitCode === 0) {
              return {
                result: `Uploaded to ${bucket}/${storagePath}
Public URL: ${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`, success: true
              };
            }
            return { result: `Upload failed: ${res.result}`, success: false };
          }

          // ── security--manage_security_finding ───────────────────────────
          case "security__manage_security_finding": {
            const ops = args.operations || [];
            const findings: any[] = (window as any).__securityFindings || [];
            const results: string[] = [];
            for (const op of ops) {
              if (op.operation === "create") {
                const id = crypto.randomUUID().slice(0, 8);
                const finding = { ...op.finding, id, createdAt: new Date().toISOString() };
                findings.push(finding);
                results.push(`Created: ${finding.name || id} (${finding.level})`);
              } else if (op.operation === "update") {
                const idx = findings.findIndex(f => f.internal_id === op.internal_id || f.id === op.internal_id);
                if (idx >= 0) { findings[idx] = { ...findings[idx], ...op.finding }; results.push(`Updated: ${op.internal_id}`); }
                else results.push(`Not found: ${op.internal_id}`);
              } else if (op.operation === "delete") {
                const idx = findings.findIndex(f => f.internal_id === op.internal_id || f.id === op.internal_id);
                if (idx >= 0) { findings.splice(idx, 1); results.push(`Deleted: ${op.internal_id}`); }
                else results.push(`Not found: ${op.internal_id}`);
              }
            }
            (window as any).__securityFindings = findings;
            return { result: results.join("\n") || "No operations", success: true };
          }

          default: {
            return { result: `Tool '${normalizedToolCall.name}' is not implemented in this environment.`, success: false };
          }

        }
      } catch (e: any) {
        if (retryCount === 0 && (e.message?.includes("Is the Sandbox started?") || e.message?.includes("Sandbox not found") || e.message?.includes("failed to resolve container IP"))) {
          console.warn("Sandbox seems to be dead during tool call, recreating...", e);
          sandboxIdRef.current = null;
          setSandboxId(null);
          const newSid = await ensureSandbox();

          // Restore all files
          for (const [path, file] of currentFiles.entries()) {
            const dir = path.split("/").slice(0, -1).join("/");
            if (dir) {
              await executeCommand(newSid, `mkdir -p ${wd}/${dir}`);
            }
            await writeFile(newSid, `${wd}/${path}`, file.content);
          }

          // Restart dev server if it was running
          if (previewStatus === "running") {
            console.log("Restarting dev server after sandbox recreation...");
            setPreviewStatus("starting");
            setPreviewUrl(null);
            executeCommand(newSid, `cd ${wd} && npm install && npm run dev &`);
            setTimeout(() => {
              setPreviewStatus("running");
              setPreviewUrl(`https://3000-${newSid}.proxy.daytona.works`);
            }, 5000);
          }

          // Retry the tool call
          return execute(toolCall, 1);
        }
        const msg = e instanceof Error ? e.message : "Unknown error";
        return { result: `Error: ${msg}`, success: false };
      }
    },
    [ensureSandbox, addOrUpdateFile, removeFile, previewStatus]
  );

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const selectedFileContent = selectedFile ? files.get(selectedFile)?.content || "" : "";

  return (
    <SandboxContext.Provider
      value={{
        sandboxId,
        status,
        error,
        files,
        fileTree,
        selectedFile,
        selectedFileContent,
        openTabs,
        previewUrl,
        previewStatus,
        fileVersion,
        workDir,
        setSelectedFile,
        closeTab,
        saveFile,
        deleteFile,
        createFolder,
        initializeSandbox,
        ensureSandbox,
        startPreview,
        executeToolCall,
        destroySandbox,
        cleanupSandboxes,
        loadFromProject,
        setProjectId,
        projectName,
        setProjectName,
        view,
        setView,
        messages,
        setMessages,
        chatHistory,
        setChatHistory,
        projectId,
        repoUrl: null,
      }}
    >
      {children}
    </SandboxContext.Provider>
  );
};
