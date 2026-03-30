import { ChatMessage } from "@/lib/tools";
import ToolCallBlock from "./ToolCallBlock";
import XmlRenderer from "./XmlRenderer";
import { TaskCard } from "./TaskCard";
import { QuestionsCard, type Question } from "./QuestionsCard";
import { User, Sparkles, Copy, Check, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { memo, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";

// Parsing logic for questions is now handled directly from tool arguments.

// ─── Thought indicator ────────────────────────────────────────────────────────

const ThoughtHeader = memo(({ content }: { content: string }) => {
  const m = content.match(/Thought for (\d+)s/i);
  if (!m) return null;
  return (
    <div className="flex items-center gap-1.5 mb-1 px-0.5">
      <div className="w-3.5 h-3.5 rounded-sm flex items-center justify-center"
        style={{ background: "hsl(252,75%,65%,0.15)" }}>
        <span style={{ fontSize: 8, color: "hsl(252,75%,65%)" }}>✦</span>
      </div>
      <span className="text-[10px] text-muted-foreground/50 font-medium">
        Thought for {m[1]}s
      </span>
    </div>
  );
});

// ─── Main bubble ─────────────────────────────────────────────────────────────

const ChatMessageBubble = memo(({ message, onRetry, onSuggestion }: {
  message: ChatMessage;
  onRetry?: (content: string) => void;
  onSuggestion?: (message: string) => void;
}) => {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [questionsDismissed, setQuestionsDismissed] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!message.content) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const timestamp = useMemo(() => {
    const ts = message.timestamp;
    if (!ts) return "";
    const date = (ts as any).seconds !== undefined
      ? new Date((ts as any).seconds * 1000)
      : new Date(ts);
    return isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [message.timestamp]);

  // ── Detect structured content ─────────────────────────────────────────────
  const parsed = useMemo(() => {
    if (isUser) return null;

    // 1. Try questions card from explicit tool calls
    const questionsTool = message.toolCalls?.find(tc => tc.name === "questions--ask_questions" && tc.status !== "error");
    if (questionsTool && !questionsDismissed) {
      let qData: Question[] = [];
      try {
        if (Array.isArray(questionsTool.arguments.questions)) {
          qData = questionsTool.arguments.questions;
        }
      } catch {}
      if (qData.length > 0) {
        return { type: "questions" as const, data: { questions: qData, rest: message.content || "" } };
      }
    }

    if (!message.content) return null;

    return null;
  }, [isUser, message.content, message.toolCalls, questionsDismissed]);

  const handleQuestionsSubmit = useCallback((answers: Record<number, string[]>) => {
    // Build a natural-language answer and send it as a user message
    const parts = Object.values(answers).flat().filter(Boolean);
    if (parts.length > 0) onSuggestion?.(parts.join(", "));
    setQuestionsDismissed(true);
  }, [onSuggestion]);

  const handleQuestionsSkip = useCallback(() => {
    setQuestionsDismissed(true);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex gap-2.5 group ${isUser ? "flex-row-reverse" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-1 ${isUser ? "shadow-sm" : "border border-border/60"}`}
        style={isUser ? { background: "var(--gradient-primary)" } : { background: "hsl(var(--muted) / 0.8)" }}
      >
        {isUser
          ? <User size={11} className="text-white" />
          : <Sparkles size={11} style={{ color: "hsl(var(--primary))" }} />
        }
      </div>

      {/* Content column */}
      <div className={`flex-1 min-w-0 max-w-[88%] space-y-2 ${isUser ? "items-end flex flex-col" : ""}`}>

        {/* ── USER bubble ──────────────────────────────────── */}
        {isUser && (message.content || (message.images && message.images.length > 0)) && (
          <div className="relative flex flex-col items-end gap-1.5">
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {message.images.map((src, idx) => (
                  <img key={idx} src={src} alt="Attached" className="w-32 sm:w-48 max-w-full h-auto rounded-xl object-cover border border-border/50 shadow-sm bg-muted/20" />
                ))}
              </div>
            )}
            {message.content && (
              <div className="relative">
                <div
                  className="inline-block rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed max-w-full shadow-sm text-white text-left break-words"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <span className="font-medium text-sm">{message.content}</span>
                </div>
                <AnimatePresence>
                  {hovered && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.1 }}
                      className="absolute -bottom-6 flex items-center gap-0.5 right-0"
                    >
                      <button onClick={handleCopy}
                        className="p-1 rounded-md hover:bg-muted/80 text-muted-foreground/50 hover:text-foreground transition-colors"
                        title="Copy">
                        {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      </button>
                      {onRetry && (
                        <button onClick={() => onRetry(message.content)}
                          className="p-1 rounded-md hover:bg-muted/80 text-muted-foreground/50 hover:text-foreground transition-colors"
                          title="Retry">
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}



        {/* ── ASSISTANT: questions card ────────────────────── */}
        {!isUser && parsed?.type === "questions" && !questionsDismissed && (
          <>
            {message.content && <ThoughtHeader content={message.content} />}
            {parsed.data.rest && (
              <div
                className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 border border-border/50 shadow-sm text-sm leading-relaxed"
                style={{ background: "hsl(var(--card))", color: "hsl(var(--card-foreground))" }}
              >
                <XmlRenderer content={parsed.data.rest} onSuggestion={onSuggestion} />
              </div>
            )}
            <QuestionsCard
              questions={parsed.data.questions}
              onSubmit={handleQuestionsSubmit}
              onSkip={handleQuestionsSkip}
            />
          </>
        )}

        {/* ── ASSISTANT: plain bubble ──────────────────────── */}
        {!isUser && message.content && !parsed && (
          <div className="relative">
            <ThoughtHeader content={message.content} />
            <div
              className="inline-block rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed max-w-full border border-border/50 shadow-sm"
              style={{ background: "hsl(var(--card))", color: "hsl(var(--card-foreground))" }}
            >
              <XmlRenderer content={message.content} onSuggestion={onSuggestion} />
            </div>
            <AnimatePresence>
              {hovered && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.1 }}
                  className="absolute -bottom-6 flex items-center gap-0.5 left-0"
                >
                  <button onClick={handleCopy}
                    className="p-1 rounded-md hover:bg-muted/80 text-muted-foreground/50 hover:text-foreground transition-colors"
                    title="Copy">
                    {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1 w-full text-left mt-2">
            {(() => {
              const visibleTools = message.toolCalls!.filter(tc => !(tc.name === "questions--ask_questions" && (!questionsDismissed || tc.status === "completed")));
              if (visibleTools.length === 0) return null;
              
              const isRunning = visibleTools.some(t => t.status === "running");
              
              return (
                <TaskCard 
                  title={isRunning ? "Executing Tools..." : "Completed Tools"} 
                  toolCalls={visibleTools} 
                />
              );
            })()}
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <div className={`text-[10px] text-muted-foreground/25 font-medium px-1 mt-6 ${isUser ? "text-right" : "text-left"}`}>
            {timestamp}
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default ChatMessageBubble;
