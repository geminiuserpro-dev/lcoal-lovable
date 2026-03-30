import { useState, memo } from "react";
import {
  ChevronRight, CheckCircle2, Loader2, AlertCircle, Clock,
  FileCode, Search, Package, Trash2, Pencil, Globe, Download,
  Copy, Settings, Zap, Image, Shield, Database, Terminal, RefreshCw
} from "lucide-react";
import { ToolCall } from "@/lib/tools";
import { motion, AnimatePresence } from "motion/react";

const toolConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  lov_write:                    { icon: <FileCode size={11} />,  label: "Write File",      color: "hsl(200,80%,58%)",  bg: "hsl(200,80%,58%,0.12)" },
  lov_view:                     { icon: <Search size={11} />,    label: "View File",       color: "hsl(252,75%,65%)",  bg: "hsl(252,75%,65%,0.12)" },
  lov_search_files:             { icon: <Search size={11} />,    label: "Search Files",    color: "hsl(38,85%,52%)",   bg: "hsl(38,85%,52%,0.12)"  },
  lov_add_dependency:           { icon: <Package size={11} />,   label: "Add Package",     color: "hsl(152,65%,48%)",  bg: "hsl(152,65%,48%,0.12)" },
  lov_remove_dependency:        { icon: <Package size={11} />,   label: "Remove Package",  color: "hsl(0,72%,55%)",    bg: "hsl(0,72%,55%,0.12)"   },
  lov_delete:                   { icon: <Trash2 size={11} />,    label: "Delete",          color: "hsl(0,72%,55%)",    bg: "hsl(0,72%,55%,0.12)"   },
  lov_line_replace:             { icon: <Pencil size={11} />,    label: "Edit Lines",      color: "hsl(20,85%,58%)",   bg: "hsl(20,85%,58%,0.12)"  },
  lov_fetch_website:            { icon: <Globe size={11} />,     label: "Fetch URL",       color: "hsl(180,70%,48%)",  bg: "hsl(180,70%,48%,0.12)" },
  lov_download_to_repo:         { icon: <Download size={11} />,  label: "Download File",   color: "hsl(252,80%,65%)",  bg: "hsl(252,80%,65%,0.12)" },
  lov_rename:                   { icon: <RefreshCw size={11} />, label: "Rename",          color: "hsl(152,60%,50%)",  bg: "hsl(152,60%,50%,0.12)" },
  lov_copy:                     { icon: <Copy size={11} />,      label: "Copy File",       color: "hsl(280,70%,60%)",  bg: "hsl(280,70%,60%,0.12)" },
  lov_read_console_logs:        { icon: <Terminal size={11} />,  label: "Console Logs",    color: "hsl(252,85%,62%)",  bg: "hsl(252,85%,62%,0.12)" },
  lov_read_network_requests:    { icon: <Globe size={11} />,     label: "Network Requests",color: "hsl(200,90%,58%)",  bg: "hsl(200,90%,58%,0.12)" },
  secrets__add_secret:          { icon: <Settings size={11} />,  label: "Add Secret",      color: "hsl(340,82%,60%)",  bg: "hsl(340,82%,60%,0.12)" },
  secrets__update_secret:       { icon: <Settings size={11} />,  label: "Update Secret",   color: "hsl(340,82%,60%)",  bg: "hsl(340,82%,60%,0.12)" },
  analytics__read_project_analytics: { icon: <Zap size={11} />, label: "Analytics",       color: "hsl(152,68%,48%)",  bg: "hsl(152,68%,48%,0.12)" },
  security__run_security_scan:  { icon: <Shield size={11} />,    label: "Security Scan",   color: "hsl(0,84%,62%)",    bg: "hsl(0,84%,62%,0.12)"   },
  supabase__docs_search:        { icon: <Database size={11} />,  label: "Supabase Docs",   color: "hsl(152,68%,48%)",  bg: "hsl(152,68%,48%,0.12)" },
  document__parse_document:     { icon: <FileCode size={11} />,  label: "Parse Document",  color: "hsl(252,85%,62%)",  bg: "hsl(252,85%,62%,0.12)" },
  imagegen__generate_image:     { icon: <Image size={11} />,     label: "Generate Image",  color: "hsl(280,75%,60%)",  bg: "hsl(280,75%,60%,0.12)" },
  imagegen__edit_image:         { icon: <Image size={11} />,     label: "Edit Image",      color: "hsl(200,80%,58%)",  bg: "hsl(200,80%,58%,0.12)" },
  websearch__web_search:        { icon: <Globe size={11} />,     label: "Web Search",      color: "hsl(38,85%,52%)",   bg: "hsl(38,85%,52%,0.12)"  },
  lov_web_search:               { icon: <Globe size={11} />,     label: "Web Search",      color: "hsl(38,85%,52%)",   bg: "hsl(38,85%,52%,0.12)"  },
  network__http_request:        { icon: <Globe size={11} />,     label: "HTTP Request",    color: "hsl(200,80%,58%)",  bg: "hsl(200,80%,58%,0.12)" },
};

const DEFAULT_CFG = { icon: <Terminal size={11} />, label: "", color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" };

// Truncate result text smartly
function truncateResult(text: string, maxLen = 500): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor(maxLen / 2);
  return text.slice(0, half) + `\n\n… (${text.length - maxLen} chars omitted) …\n\n` + text.slice(-half);
}

const ToolCallBlock = memo(({ toolCall }: { toolCall: ToolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const cfg = toolConfig[toolCall.name] || { ...DEFAULT_CFG, label: toolCall.name };
  const isRunning   = toolCall.status === "running";
  const isError     = toolCall.status === "error";
  const isCompleted = toolCall.status === "completed";

  // Primary display path
  const filePath = toolCall.arguments?.file_path
    || toolCall.arguments?.filePath
    || toolCall.arguments?.target_path
    || toolCall.arguments?.source_file_path;

  const queryArg = toolCall.arguments?.query || toolCall.arguments?.package || toolCall.arguments?.url;
  const displayHint = filePath || queryArg;

  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden border border-border/40 text-xs"
      style={{ background: "hsl(var(--card) / 0.6)" }}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/20 transition-colors text-left"
      >
        {/* Expand chevron */}
        <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.12 }} className="shrink-0">
          <ChevronRight size={10} className="text-muted-foreground/30" />
        </motion.div>

        {/* Icon pill */}
        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: cfg.bg, color: cfg.color }}>
          {isRunning
            ? <Loader2 size={10} className="animate-spin" style={{ color: cfg.color }} />
            : cfg.icon
          }
        </div>

        {/* Label */}
        <span className="font-medium text-foreground/80 shrink-0 text-[11px]">{cfg.label}</span>

        {/* Path/query hint */}
        {displayHint && (
          <span className="font-mono text-[10px] text-muted-foreground/40 truncate flex-1 min-w-0">
            {displayHint}
          </span>
        )}

        {/* Right side: status + timing */}
        <div className="shrink-0 flex items-center gap-1.5 ml-auto">
          {isCompleted && <CheckCircle2 size={11} className="text-emerald-500" />}
          {isError     && <AlertCircle  size={11} className="text-destructive" />}
          {toolCall.duration && (
            <span className="text-[10px] text-muted-foreground/35 tabular-nums flex items-center gap-0.5">
              <Clock size={9} />{(toolCall.duration / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/25 px-3 py-2.5 space-y-2"
              style={{ background: "hsl(var(--muted) / 0.25)" }}>

              {/* Args */}
              <div>
                <div className="text-[9px] font-bold text-muted-foreground/35 uppercase tracking-widest mb-1">Arguments</div>
                {toolCall.name === "lov_write" && toolCall.arguments?.content ? (
                  <div className="space-y-1.5">
                    {displayHint && <div className="text-[9px] text-muted-foreground/40 font-mono">Writing: {displayHint}</div>}
                    <pre className="text-[10px] bg-[#1a1a1c] rounded-lg p-3 overflow-x-auto text-emerald-400/90 border border-black/20 shadow-inner font-mono leading-relaxed max-h-60 custom-scrollbar">
                      {toolCall.arguments.content}
                    </pre>
                  </div>
                ) : (
                  <pre className="text-[10px] bg-background/50 rounded-lg p-2 overflow-x-auto text-foreground/70 border border-border/25 font-mono leading-relaxed max-h-40 custom-scrollbar">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                )}
              </div>

              {/* Result */}
              {toolCall.result && (
                <div>
                  <div className="text-[9px] font-bold text-muted-foreground/35 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                    Result
                    {isError && <span className="text-destructive normal-case font-normal">• error</span>}
                    {isCompleted && <span className="text-emerald-500 normal-case font-normal">• success</span>}
                  </div>
                  <pre className={`text-[10px] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed border max-h-48 ${
                    isError
                      ? "bg-destructive/5 text-destructive/80 border-destructive/20"
                      : "bg-background/50 text-foreground/70 border-border/25"
                  }`}>
                    {truncateResult(toolCall.result)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export default ToolCallBlock;
