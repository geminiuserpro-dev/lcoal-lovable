import { useState, memo, useEffect } from "react";
import { Bookmark, BookmarkCheck, CheckCircle2, Circle, ChevronRight, Eye, Info, MessageSquare, StopCircle, RefreshCw, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ToolCall } from "@/lib/tools";
import ToolCallBlock from "./ToolCallBlock";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskItem {
  id: string;
  label: string;
  done: boolean;
}

export interface TaskCardProps {
  title: string;
  tasks?: TaskItem[];
  summary?: string;      // shown below card (the full AI reply text)
  toolCalls?: ToolCall[];
  onToggle?: (id: string) => void;
}

export interface QuestionCardProps {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
}

// ─── Helper: parse plain text into task card data ─────────────────────────────
// Detects patterns like:
//   ## Title\n- [ ] task\n- [x] done task
//   or numbered lists after a heading

export function parseTaskCard(content: string): { card: TaskCardProps; rest: string } | null {
  const lines = content.split("\n");
  let titleLine = -1;
  let title = "";

  // Find a heading line (## or bold **text**)
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,3}\s+(.+)/);
    const b = lines[i].match(/^\*\*(.+)\*\*\s*$/);
    if (h || b) {
      title = (h ? h[1] : b![1]).trim();
      titleLine = i;
      break;
    }
  }

  if (titleLine === -1) return null;

  // Collect task lines after the heading
  const tasks: TaskItem[] = [];
  let k = titleLine + 1;
  while (k < lines.length) {
    const line = lines[k];
    // - [ ] task or - [x] task
    const checkMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)/);
    // plain list item without checkbox
    const listMatch = !checkMatch && line.match(/^[-*]\s+(.+)/);
    // numbered list
    const numMatch = !checkMatch && !listMatch && line.match(/^\d+\.\s+(.+)/);

    if (checkMatch) {
      tasks.push({ id: String(k), label: checkMatch[2].trim(), done: checkMatch[1].toLowerCase() === "x" });
      k++;
    } else if (listMatch) {
      tasks.push({ id: String(k), label: listMatch[1].trim(), done: false });
      k++;
    } else if (numMatch) {
      tasks.push({ id: String(k), label: numMatch[1].trim(), done: false });
      k++;
    } else if (line.trim() === "") {
      k++;
      // allow one blank line between items
      if (k < lines.length && !lines[k].match(/^[-*\d]/)) break;
    } else {
      break;
    }
  }

  if (tasks.length === 0) return null;

  // Everything before the heading + everything after tasks = "rest"
  const beforeLines = lines.slice(0, titleLine);
  const afterLines = lines.slice(k);
  const rest = [...beforeLines, ...afterLines].join("\n").trim();

  return {
    card: { title, tasks },
    rest,
  };
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

export const TaskCard = memo(({
  title,
  tasks = [], // default to empty array
  toolCalls = [],
  onToggle,
}: TaskCardProps) => {
  const [bookmarked, setBookmarked] = useState(false);
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [localTasks, setLocalTasks] = useState<TaskItem[]>(tasks);
  const [iframeKey, setIframeKey] = useState(0);
  const previewUrl = (window as any).__previewUrl;

  useEffect(() => {
    // Auto-switch to preview when everything is fully completed and we have a URL
    const isCompleted = localTasks.filter(t => t.done).length + toolCalls.filter(tc => tc.status === "completed" || tc.status === "error").length === localTasks.length + toolCalls.length;
    if (isCompleted && (localTasks.length > 0 || toolCalls.length > 0) && previewUrl) {
      setTab("preview");
    }
  }, [localTasks, toolCalls, previewUrl]);

  const handleToggle = (id: string) => {
    setLocalTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
    onToggle?.(id);
  };

  const completedTasks = localTasks.filter(t => t.done).length;
  const completedTools = toolCalls.filter(tc => tc.status === "completed" || tc.status === "error").length;
  
  const totalItems = localTasks.length + toolCalls.length;
  const completedItems = completedTasks + completedTools;
  const progress = totalItems > 0 ? completedItems / totalItems : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="rounded-2xl overflow-hidden border border-border/60 shadow-sm w-full"
      style={{ background: "hsl(var(--card))" }}
    >
      {/* Progress bar */}
      {totalItems > 0 && (
        <div className="h-0.5 w-full" style={{ background: "hsl(var(--muted))" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, hsl(258,90%,62%), hsl(278,85%,65%))" }}
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Card header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground leading-snug">{title.replace(/\*\*/g, "")}</h3>
          {totalItems > 0 && (
            <span className="text-[10px] text-muted-foreground/50 mt-0.5 block">
              {completedItems}/{totalItems} completed
            </span>
          )}
        </div>
        {progress < 1 && totalItems > 0 && (
          <button
            onClick={() => window.dispatchEvent(new Event('ai-stop-generation'))}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 transition-colors shrink-0 mt-0.5"
            title="Stop Generation"
          >
            <StopCircle size={10} /> Stop
          </button>
        )}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setBookmarked(v => !v)}
          className={`p-1 rounded-lg transition-colors shrink-0 mt-0.5 ${
            bookmarked
              ? "text-primary bg-primary/10"
              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/60"
          }`}
        >
          {bookmarked ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
        </motion.button>
      </div>

      {/* Task list */}
      <AnimatePresence initial={false}>
        {tab === "details" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-1">
              {localTasks.map((task, i) => (
                <motion.button
                  key={task.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => handleToggle(task.id)}
                  className="w-full flex items-start gap-2 py-1 px-1 rounded-lg hover:bg-muted/40 transition-colors text-left group"
                >
                  <div className="mt-0.5 shrink-0">
                    {task.done ? (
                      <CheckCircle2
                        size={14}
                        className="text-emerald-500"
                      />
                    ) : (
                      <Circle
                        size={14}
                        className="text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors"
                      />
                    )}
                  </div>
                  <span className={`text-[12px] leading-snug flex-1 min-w-0 ${
                    task.done ? "line-through text-muted-foreground/40" : "text-foreground/80"
                  }`}>
                    {task.label}
                  </span>
                </motion.button>
              ))}
              {/* Render Tools */}
              {toolCalls.length > 0 && (
                <div className="space-y-1.5 mt-2 first:mt-0">
                  {toolCalls.map((tc, index) => (
                    <motion.div key={tc.id}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}>
                      <ToolCallBlock toolCall={tc} />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {tab === "preview" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full relative bg-white border-y border-border/40"
            style={{ height: "340px" }}
          >
            {previewUrl ? (
              <>
                <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10 p-1 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 shadow-lg">
                  <button onClick={() => setIframeKey(k => k + 1)} className="p-1.5 rounded-md hover:bg-white/20 text-white/90 transition-colors" title="Reload Preview">
                    <RefreshCw size={12} />
                  </button>
                  <button onClick={() => window.open(previewUrl, "_blank")} className="p-1.5 rounded-md hover:bg-white/20 text-white/90 transition-colors" title="Open in New Tab">
                    <ExternalLink size={12} />
                  </button>
                </div>
                <iframe key={iframeKey} src={previewUrl} className="w-full h-full border-none" title="Sandbox Preview" />
              </>
            ) : (
              <div className="flex items-center justify-center p-8 text-center h-full bg-muted/20">
                <span className="text-[12px] text-muted-foreground/60 italic">Preview will appear here once the build runs.</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs footer */}
      <div className="flex border-t border-border/40">
        <button
          onClick={() => setTab("details")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors ${
            tab === "details"
              ? "text-foreground bg-muted/30"
              : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20"
          }`}
        >
          <Info size={11} />
          Details
        </button>
        <div className="w-px bg-border/40" />
        <button
          onClick={() => setTab("preview")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors ${
            tab === "preview"
              ? "text-foreground bg-muted/30"
              : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20"
          }`}
        >
          <Eye size={11} />
          Preview
        </button>
      </div>
    </motion.div>
  );
});

// ─── QuestionCard ─────────────────────────────────────────────────────────────

export const QuestionCard = memo(({ question, options, onAnswer }: QuestionCardProps) => {
  const [answered, setAnswered] = useState<string | null>(null);

  const handleAnswer = (option: string) => {
    if (answered) return;
    setAnswered(option);
    onAnswer(option);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="rounded-2xl overflow-hidden border border-border/60 shadow-sm w-full"
      style={{ background: "hsl(var(--card))" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: "hsl(252,75%,65%,0.15)" }}
        >
          <MessageSquare size={11} style={{ color: "hsl(252,75%,65%)" }} />
        </div>
        <p className="text-[12px] font-medium text-foreground flex-1 min-w-0 leading-snug">{question}</p>
      </div>

      {/* Options */}
      <div className="px-3 pb-3 space-y-1.5">
        {options.map((opt, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={answered ? {} : { scale: 1.01 }}
            whileTap={answered ? {} : { scale: 0.98 }}
            onClick={() => handleAnswer(opt)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition-all border ${
              answered === opt
                ? "bg-primary/10 border-primary/40 text-primary"
                : answered
                  ? "opacity-40 border-border/30 text-muted-foreground cursor-not-allowed bg-muted/20"
                  : "border-border/40 text-foreground/80 bg-muted/20 hover:bg-primary/5 hover:border-primary/30 hover:text-foreground cursor-pointer"
            }`}
          >
            <span>{opt}</span>
            {answered === opt && <CheckCircle2 size={13} className="text-primary shrink-0" />}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
});

export default TaskCard;
