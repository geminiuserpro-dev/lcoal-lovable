import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Circle, Clock, ChevronDown, ChevronRight, StickyNote } from "lucide-react";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "done";
  notes?: string[];
  createdAt: string;
}

const STATUS_CONFIG = {
  todo: { label: "To do", icon: Circle, color: "text-muted-foreground/60", dot: "bg-muted-foreground/30" },
  in_progress: { label: "In progress", icon: Clock, color: "text-blue-500", dot: "bg-blue-500 animate-pulse" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-500", dot: "bg-emerald-500" },
};

export const TaskTrackingPanel = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    // Load initial tasks
    try {
      const saved = sessionStorage.getItem("__tasks");
      if (saved) {
        const parsed = JSON.parse(saved);
        setTasks(Object.values(parsed) as Task[]);
      }
    } catch {}

    // Listen for task updates from tools
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setTasks(Object.values(detail) as Task[]);
    };
    window.addEventListener("ai-task-update", handler);
    return () => window.removeEventListener("ai-task-update", handler);
  }, []);

  if (tasks.length === 0) return null;

  const todo = tasks.filter(t => t.status === "todo");
  const inProgress = tasks.filter(t => t.status === "in_progress");
  const done = tasks.filter(t => t.status === "done");
  const total = tasks.length;
  const doneCount = done.length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mx-1 mb-2 rounded-2xl border border-border/50 bg-background overflow-hidden shadow-sm"
    >
      {/* Header */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-foreground truncate">
            {inProgress.length > 0 ? inProgress[0].title : tasks[tasks.length - 1]?.title || "Tasks"}
          </span>
          {inProgress.length > 0 && (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
              In progress
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Progress fraction */}
          <span className="text-[11px] text-muted-foreground/50">{doneCount}/{total}</span>
          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full rounded-full bg-emerald-500"
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
          {isOpen ? <ChevronDown size={13} className="text-muted-foreground/40" /> : <ChevronRight size={13} className="text-muted-foreground/40" />}
        </div>
      </button>

      {/* Task list */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="px-3 py-2 space-y-1 max-h-64 overflow-y-auto">
              {[...inProgress, ...todo, ...done].map((task) => {
                const cfg = STATUS_CONFIG[task.status];
                const Icon = cfg.icon;
                const isExpanded = expanded === task.id;
                const hasNotes = task.notes && task.notes.length > 0;

                return (
                  <motion.div key={task.id} layout className="group">
                    <button
                      onClick={() => setExpanded(isExpanded ? null : task.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors text-left ${
                        isExpanded ? "bg-muted/50" : "hover:bg-muted/30"
                      }`}
                    >
                      <Icon size={13} className={`shrink-0 ${cfg.color}`} />
                      <span className={`text-[12px] flex-1 truncate ${task.status === "done" ? "line-through text-muted-foreground/50" : "text-foreground"}`}>
                        {task.title}
                      </span>
                      {hasNotes && (
                        <StickyNote size={11} className="shrink-0 text-muted-foreground/30" />
                      )}
                      {task.status === "done" && (
                        <CheckCircle2 size={11} className="shrink-0 text-emerald-500/60" />
                      )}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-8 pb-2 space-y-1">
                            {task.description && (
                              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{task.description}</p>
                            )}
                            {task.notes?.map((note, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground/50">
                                <span className="shrink-0 mt-0.5">•</span>
                                <span>{note}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            {/* Footer stats */}
            <div className="px-4 py-2 border-t border-border/30 flex items-center gap-3">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const count = tasks.filter(t => t.status === key).length;
                if (count === 0) return null;
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    <span className="text-[10px] text-muted-foreground/50">{count} {cfg.label.toLowerCase()}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TaskTrackingPanel;
