import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSandbox } from "@/contexts/SandboxContext";
import {
  Eye, Play, Loader2, ExternalLink, RefreshCw, Smartphone, Tablet, Monitor,
  AlertCircle, Wifi, WifiOff, RotateCcw, Copy, Check, Terminal, X, ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

type DeviceMode = "desktop" | "tablet" | "mobile";

const DEVICE_SIZES: Record<DeviceMode, { width: string; label: string; icon: React.ReactNode }> = {
  desktop: { width: "100%",   label: "Desktop",  icon: <Monitor    size={13} /> },
  tablet:  { width: "768px",  label: "Tablet",   icon: <Tablet     size={13} /> },
  mobile:  { width: "390px",  label: "Mobile",   icon: <Smartphone size={13} /> },
};

const LivePreview = () => {
  const { previewUrl, previewStatus, startPreview, files } = useSandbox();
  const [error, setError]             = useState<string | null>(null);
  const [device, setDevice]           = useState<DeviceMode>("desktop");
  const [iframeKey, setIframeKey]     = useState(0);
  const [isLoading, setIsLoading]     = useState(false);
  const [isCopied, setIsCopied]       = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [showConsole, setShowConsole]     = useState(false);
  const [consoleLogs, setConsoleLogs]     = useState<{ type: string; text: string; ts: number }[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Route through our proxy to add X-Daytona-Skip-Preview-Warning header server-side,
  // which prevents the Daytona warning page (with its HTTP form action Mixed Content error)
  const iframeSrc = useMemo(() => {
    if (!previewUrl) return undefined;
    return `/api/preview-proxy?target=${encodeURIComponent(previewUrl)}`;
  }, [previewUrl]);

  const handleStart = async () => {
    setError(null);
    try { await startPreview(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to start preview"); }
  };

  const handleReload = useCallback(() => {
    setIframeKey(k => k + 1);
    setIsLoading(true);
    setIframeError(false);
  }, []);

  const handleOpenNewTab = useCallback(() => {
    if (previewUrl) window.open(previewUrl, "_blank");
  }, [previewUrl]);

  const handleCopyUrl = useCallback(async () => {
    if (!previewUrl) return;
    await navigator.clipboard.writeText(previewUrl);
    setIsCopied(true);
    toast.success("URL copied!");
    setTimeout(() => setIsCopied(false), 2000);
  }, [previewUrl]);

  const fileCount = useMemo(
    () => Array.from(files.values()).filter(f => f.path.match(/\.(tsx|jsx|ts|js)$/i)).length,
    [files]
  );

  const handleIframeLoad  = () => setIsLoading(false);
  const handleIframeError = () => { setIsLoading(false); setIframeError(true); };

  useEffect(() => {
    if (previewUrl) { setIframeKey(k => k + 1); setIsLoading(true); setIframeError(false); }
  }, [previewUrl]);

  // Listen for console messages from the iframe via postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.__type !== "console") return;
      setConsoleLogs(prev => [...prev.slice(-199), { type: e.data.level || "log", text: e.data.message, ts: Date.now() }]);
      if (consoleRef.current) {
        setTimeout(() => consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" }), 50);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const isRunning = previewStatus === "running" && !!previewUrl;
  const { width: deviceWidth } = DEVICE_SIZES[device];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center gap-2 px-3 shrink-0 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-2 h-2 rounded-full transition-colors ${
            isRunning            ? "bg-emerald-500 animate-pulse" :
            previewStatus === "starting" ? "bg-amber-500 animate-pulse"  :
            previewStatus === "error"    ? "bg-red-500"                  :
                                           "bg-muted-foreground/30"
          }`} />
          <Eye size={12} className="text-muted-foreground/50" />
        </div>

        {/* Address bar */}
        <div
          onClick={handleCopyUrl}
          className="flex-1 flex items-center gap-1.5 bg-muted/50 border border-border/50 rounded-lg px-3 h-7 min-w-0 group hover:border-border transition-colors cursor-pointer"
        >
          {isRunning
            ? <Wifi    size={11} className="text-emerald-500 shrink-0" />
            : <WifiOff size={11} className="text-muted-foreground/40 shrink-0" />
          }
          <span className="text-[11px] text-muted-foreground/70 truncate font-mono flex-1 select-none">
            {previewUrl || "Not running"}
          </span>
          <AnimatePresence mode="wait">
            {isCopied
              ? <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={11} className="text-emerald-500 shrink-0" /></motion.div>
              : <motion.div key="copy"  initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Copy  size={11} className="text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors shrink-0" /></motion.div>
            }
          </AnimatePresence>
        </div>

        {/* Reload / Open */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={handleReload} disabled={!isRunning} title="Reload"
            className="p-1.5 rounded-md hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30">
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button onClick={handleOpenNewTab} disabled={!isRunning} title="Open in new tab"
            className="p-1.5 rounded-md hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ExternalLink size={12} />
          </button>
        </div>

        {/* Console toggle */}
        <button onClick={() => setShowConsole(v => !v)} title="Toggle console"
          className={`p-1.5 rounded-md transition-all relative ${showConsole ? "bg-muted text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/70"}`}>
          <Terminal size={12} />
          {consoleLogs.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 text-[7px] flex items-center justify-center text-white font-bold" />
          )}
        </button>

        {/* Device switcher */}
        <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 border border-border/40 shrink-0">
          {(Object.entries(DEVICE_SIZES) as [DeviceMode, typeof DEVICE_SIZES[DeviceMode]][]).map(([key, { label, icon }]) => (
            <button key={key} onClick={() => setDevice(key)} title={label}
              className={`p-1.5 rounded-md transition-all ${device === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground/50 hover:text-muted-foreground"}`}>
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden relative bg-[hsl(0,0%,9%)] flex items-start justify-center">
        <AnimatePresence mode="wait">
          {isRunning ? (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="h-full flex flex-col items-center w-full"
              style={{ paddingTop: device !== "desktop" ? "12px" : 0 }}>
              <motion.div
                animate={{ width: deviceWidth, maxWidth: deviceWidth }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="relative h-full bg-white overflow-hidden"
                style={{
                  borderRadius: device !== "desktop" ? "16px 16px 0 0" : 0,
                  boxShadow: device !== "desktop" ? "0 0 0 1px hsl(0,0%,22%), 0 8px 40px rgba(0,0,0,0.6)" : "none",
                  width: deviceWidth,
                }}
              >
                {/* Loading overlay */}
                <AnimatePresence>
                  {isLoading && (
                    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={20} className="animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground font-medium">Loading...</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* iframe error */}
                <AnimatePresence>
                  {iframeError && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
                      <AlertCircle size={32} className="text-destructive/60" />
                      <p className="text-sm font-medium">Preview failed to load</p>
                      <p className="text-xs text-muted-foreground">The URL may be unavailable or blocked.</p>
                      <button onClick={handleReload} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
                        <RotateCcw size={12} /> Retry
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  src={iframeSrc}
                  className="w-full h-full border-none"
                  title="Live Preview"
                  onLoad={handleIframeLoad}
                  onError={handleIframeError}
                  sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
                  allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write"
                />
                {/* Fallback for when iframed preview fails to load */}
                {iframeError && previewUrl && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm text-center p-6">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <ExternalLink size={20} className="text-primary/70" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Preview ready!</p>
                      <p className="text-xs text-muted-foreground/70 mt-1 max-w-[260px] leading-relaxed">
                        Open in a new tab to view your running app.
                      </p>
                    </div>
                    <button
                      onClick={handleOpenNewTab}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                    >
                      <ExternalLink size={13} /> Open Preview
                    </button>
                  </div>
                )}
              </motion.div>

              {device !== "desktop" && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full text-[10px] text-white/50 font-medium pointer-events-none">
                  {DEVICE_SIZES[device].label} · {deviceWidth}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center h-full w-full">
              <div className="text-center space-y-5 px-6">
                {previewStatus === "starting" ? (
                  <>
                    <div className="relative w-16 h-16 mx-auto">
                      <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
                      <div className="relative w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Loader2 size={24} className="animate-spin text-primary" />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Starting dev server...</p>
                      <p className="text-xs text-muted-foreground/60 mt-1.5">Installing dependencies & launching Vite</p>
                    </div>
                    <div className="flex gap-1.5 justify-center">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                      ))}
                    </div>
                  </>
                ) : previewStatus === "error" || error ? (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto">
                      <AlertCircle size={22} className="text-destructive/70" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Preview failed</p>
                      <p className="text-xs text-muted-foreground/60 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
                        {error || "The dev server encountered an error."}
                      </p>
                    </div>
                    <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={handleStart}
                      className="px-5 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-semibold hover:bg-destructive/20 transition-colors">
                      Retry
                    </motion.button>
                  </>
                ) : (
                  <>
                    <div className="text-muted-foreground/40">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-40">
                        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground/60">
                      {fileCount > 0 ? "Your app will live here" : "Your app will live here"}
                    </p>
                    <p className="text-xs text-muted-foreground/40 mt-1">
                      {fileCount > 0 ? "Run to start the preview" : "Ask Lovable to build it"}
                    </p>
                    {fileCount > 0 && (
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleStart}
                        className="mt-4 px-4 py-2 rounded-lg bg-foreground text-background text-xs font-semibold hover:opacity-90 transition-opacity">
                        Run
                      </motion.button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Console panel */}
        <AnimatePresence>
          {showConsole && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "180px", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-0 left-0 right-0 border-t border-border/50 overflow-hidden z-30"
              style={{ background: "hsl(220,18%,6%)" }}
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20">
                <div className="flex items-center gap-2">
                  <Terminal size={11} className="text-muted-foreground/50" />
                  <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Console</span>
                  {consoleLogs.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">{consoleLogs.length}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setConsoleLogs([])} className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors px-1.5 py-0.5 rounded">
                    Clear
                  </button>
                  <button onClick={() => setShowConsole(false)} className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors rounded">
                    <ChevronDown size={12} />
                  </button>
                </div>
              </div>
              <div ref={consoleRef} className="overflow-y-auto h-[calc(180px-33px)] custom-scrollbar">
                {consoleLogs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground/20">
                    No console output yet
                  </div>
                ) : (
                  <div className="font-mono text-[10px] leading-5">
                    {consoleLogs.map((log, i) => (
                      <div key={i} className={`px-3 py-0.5 border-b border-border/10 flex items-start gap-2 ${
                        log.type === "error"   ? "bg-red-950/30 text-red-400" :
                        log.type === "warn"    ? "bg-amber-950/20 text-amber-400" :
                        log.type === "info"    ? "text-blue-400" :
                        "text-slate-400"
                      }`}>
                        <span className="text-muted-foreground/20 shrink-0 tabular-nums">
                          {new Date(log.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="break-all whitespace-pre-wrap">{log.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default LivePreview;
