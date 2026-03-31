import { useState, useEffect, useRef } from "react";
import ChatPanel from "@/components/editor/ChatPanel";
import CodePreview from "@/components/editor/CodePreview";
import LivePreview from "@/components/editor/LivePreview";
import SecurityScan from "@/components/editor/SecurityScan";
import { SandboxProvider, useSandbox } from "@/contexts/SandboxContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Code, Eye, GripVertical, Play, Loader2, Sparkles, Github, LayoutGrid, Trash2, Save, FolderOpen, Eraser, RotateCcw, Download, PenLine, CheckCircle2 } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Link, useSearchParams } from "react-router-dom";
import { useFirebase } from "@/components/FirebaseProvider";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import PublishModal from "@/components/editor/PublishModal";
import CreditsIndicator from "@/components/CreditsIndicator";
import UpgradeModal from "@/components/UpgradeModal";
import { CreditsService } from "@/services/CreditsService";

const EditorInner = () => {
  const {
    startPreview,
    previewStatus,
    initializeSandbox,
    status,
    destroySandbox,
    cleanupSandboxes,
    files,
    projectId,
    setProjectId,
    loadFromProject,
    projectName,
    setProjectName,
    view,
    setView
  } = useSandbox();
  const { user } = useFirebase();
  const [initialized, setInitialized] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");

  const latestState = useRef({ files, projectId, projectName, user });
  const lastSavedFilesRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    latestState.current = { files, projectId, projectName, user };
  }, [files, projectId, projectName, user]);

  useEffect(() => {
    const autoSaveInterval = setInterval(async () => {
      const state = latestState.current;
      if (!state.user) return;
      if (state.files.size === 0) return;

      // Check if files have actually changed since last auto-save
      let hasChanges = false;
      if (state.files.size !== lastSavedFilesRef.current.size) {
        hasChanges = true;
      } else {
        for (const [path, file] of state.files.entries()) {
          const lastSaved = lastSavedFilesRef.current.get(path);
          if (!lastSaved || lastSaved.content !== file.content) {
            hasChanges = true;
            break;
          }
        }
      }

      if (!hasChanges) return;

      let nameToSave = state.projectName || "Untitled Project";
      let projectDescription = "Auto-saved from AI Tool Editor";

      setIsAutoSaving(true);
      try {
        const { ProjectService } = await import("@/services/ProjectService");
        const newProjectId = await ProjectService.saveProject(
          nameToSave,
          projectDescription,
          state.currentRepoUrl,
          state.files,
          state.projectId || undefined
        );
        if (newProjectId !== state.projectId) {
          setProjectId(newProjectId);
          setSearchParams({ project: newProjectId });
        }
        lastSavedFilesRef.current = new Map(state.files);
        setLastSavedAt(new Date());
        console.log("Auto-saved successfully at", new Date().toLocaleTimeString());
      } catch (e) {
        console.error("Auto-save failed:", e);
      } finally {
        setIsAutoSaving(false);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [setProjectId, setSearchParams]);

  const handleSave = async () => {
    if (!user) {
      toast.error("Please sign in to save your work.");
      return;
    }

    let nameToSave = projectName;
    let projectDescription = "Saved from AI Tool Editor";

    if (!projectId) {
      const name = prompt("Enter project name:", "My Project");
      if (name === null) return; // Cancelled
      nameToSave = name || "My Project";
      setProjectName(nameToSave);

      const desc = prompt("Enter project description (optional):", "");
      if (desc !== null) {
        projectDescription = desc;
      }
    }

    setIsSaving(true);
    try {
      const { ProjectService } = await import("@/services/ProjectService");
      const newProjectId = await ProjectService.saveProject(
        nameToSave,
        projectDescription,
        currentRepoUrl,
        files,
        projectId || undefined
      );
      if (newProjectId !== projectId) {
        setProjectId(newProjectId);
        setSearchParams({ project: newProjectId });
      }
      lastSavedFilesRef.current = new Map(files);
      setLastSavedAt(new Date());
      toast.success("Project saved successfully!");
    } catch (e) {
      toast.error("Failed to save project: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // Use ref to avoid stale closure
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // empty deps — uses ref

  // Ref so the keydown handler always calls the latest handleSave without re-registering
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  const handleReset = async () => {
    if (confirm("Are you sure you want to reset the sandbox? All unsaved changes will be lost.")) {
      await destroySandbox();
      window.location.href = "/editor";
    }
  };

  const handleClearAllStates = async () => {
    if (confirm("Are you sure you want to clear ALL local states? This will wipe your chat history, local files, and sandbox. This cannot be undone.")) {
      try {
        await destroySandbox();
      } catch (e) {
        console.warn("Failed to destroy sandbox during clear-all:", e);
      }
      sessionStorage.clear();
      toast.success("All local states cleared. Reloading...");
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    }
  };

  useEffect(() => {
    const init = async () => {
      if (initialized) return;
      setInitialized(true);

      if (projectIdFromUrl) {
        try {
          await loadFromProject(projectIdFromUrl);
          const { ProjectService } = await import("@/services/ProjectService");
          const { project } = await ProjectService.loadProject(projectIdFromUrl);
          if (project.name) setProjectName(project.name);
          if (project.lastModified) {
            // Check if it's a Firestore Timestamp or a Date string
            const date = typeof project.lastModified.toDate === 'function'
              ? project.lastModified.toDate()
              : new Date(project.lastModified);
            setLastSavedAt(date);
          }
          return;
        } catch (e) {
          toast.error("Failed to load project from URL");
        }
      }

      const resumed = false;
      if (resumed) {
        toast.success("Sandbox resumed!");
        return;
      }

      try {
        await initializeSandbox();
        toast.success("Sandbox initialized from snapshot!");
      } catch (e) {
        toast.error("Initialization failed: " + (e instanceof Error ? e.message : "Unknown error"));
      }
    };

    init();
  }, [initialized, initializeSandbox, projectIdFromUrl, loadFromProject]);

  const handleRunAll = async () => {
    setView("preview");
    if (previewStatus !== "running") {
      try {
        await startPreview();
      } catch {
        // error handled in context
      }
    }
  };

  const handleDownload = async () => {
    try {
      const zip = new JSZip();
      for (const [path, file] of files.entries()) {
        zip.file(path, file.content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${projectName || "project"}.zip`);
      toast.success("Project downloaded successfully!");
    } catch (e) {
      toast.error("Failed to download project");
      console.error(e);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar — Lovable style */}
      <header className="h-12 border-b border-border/50 flex items-center justify-between px-3 shrink-0 bg-background/95 backdrop-blur-xl">
        {/* Left — project name + status */}
        <div className="flex items-center gap-2.5 min-w-[200px]">
          <div className="flex items-center gap-1.5">
            {isEditingName ? (
              <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                onBlur={() => { if (nameInput.trim()) setProjectName(nameInput.trim()); setIsEditingName(false); }}
                onKeyDown={e => { if (e.key === "Enter") { if (nameInput.trim()) setProjectName(nameInput.trim()); setIsEditingName(false); } if (e.key === "Escape") setIsEditingName(false); }}
                className="font-semibold text-sm text-foreground bg-transparent border-b border-primary outline-none w-36" />
            ) : (
              <button onClick={() => { setNameInput(projectName); setIsEditingName(true); }}
                className="font-semibold text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1 group">
                {projectName}
                <PenLine size={10} className="opacity-0 group-hover:opacity-40 transition-opacity" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className={`w-1.5 h-1.5 rounded-full ${status === "ready" ? "bg-emerald-500" : status === "creating" ? "bg-yellow-500 animate-pulse" : "bg-muted-foreground/40"}`} />
            <span>{status === "ready" ? "Ready to Build" : status === "creating" ? "Starting..." : "Idle"}</span>
          </div>
        </div>

        {/* Center — Code | Preview | Security tabs */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          {[
            { key: "code" as const, icon: Code, label: "Code" },
            { key: "preview" as const, icon: Eye, label: "Preview" },
            { key: "security" as const, icon: Sparkles, label: "Security" },
          ].map(({ key, icon: Icon, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={`relative flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-colors ${view === key ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={13} />
              {label}
              {view === key && <div className="absolute bottom-0 inset-x-3 h-0.5 rounded-full bg-foreground" />}
            </button>
          ))}
        </div>

        {/* Right — Save | Run | Credits | Publish */}
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link to="/projects">
            <button className="p-1.5 rounded-lg hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors" title="Projects"><FolderOpen size={14} /></button>
          </Link>
          <button onClick={handleDownload} className="p-1.5 rounded-lg hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors" title="Download ZIP"><Download size={14} /></button>

          <div className="w-px h-4 bg-border/60 mx-0.5" />

          {/* Time saved */}
          {lastSavedAt && (
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <CheckCircle2 size={9} className="text-emerald-500" />
              {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {isAutoSaving && <span className="text-[10px] text-primary/70 animate-pulse flex items-center gap-1"><Loader2 size={9} className="animate-spin" />Saving</span>}

          <button onClick={handleSave} disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 bg-background hover:bg-muted/50 text-xs font-medium transition-colors disabled:opacity-50">
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>

          <CreditsIndicator onUpgrade={() => setShowUpgrade(true)} />

          <button onClick={handleRunAll} disabled={previewStatus === "starting"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-60 shadow-sm">
            {previewStatus === "starting" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
            Run
          </button>

          <button onClick={async () => {
              const { allowed, reason } = await CreditsService.canUseCredits();
              if (!allowed) { toast.error(reason || "No credits remaining"); setShowUpgrade(true); return; }
              setShowPublish(true);
            }}
            className="px-3 py-1.5 rounded-lg text-white text-xs font-bold transition-all"
            style={{ background: "linear-gradient(135deg, hsl(258,90%,62%), hsl(278,85%,65%))" }}>
            Publish
          </button>
        </div>
      </header>

      {/* Main area */}
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <Panel defaultSize={30} minSize={22} maxSize={45}>
          <ChatPanel />
        </Panel>

        <PanelResizeHandle className="w-1 hover:w-1.5 bg-border/40 hover:bg-primary/30 transition-all flex items-center justify-center group">
          <div className="w-4 h-8 rounded-full bg-muted/80 group-hover:bg-primary/20 flex items-center justify-center transition-all">
            <GripVertical size={10} className="text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </div>
        </PanelResizeHandle>

        <Panel defaultSize={70} minSize={30}>
          <motion.div
            key={view}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="h-full"
          >
            {view === "code" ? (
              <CodePreview />
            ) : view === "preview" ? (
              <LivePreview />
            ) : (
              <SecurityScan />
            )}
          </motion.div>
        </Panel>
      </PanelGroup>

      <PublishModal open={showPublish} onClose={() => setShowPublish(false)} projectName={projectName || "my-app"} />
      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </div>
  );
};

const Editor = () => (
  <SandboxProvider>
    <EditorInner />
  </SandboxProvider>
);

export default Editor;
