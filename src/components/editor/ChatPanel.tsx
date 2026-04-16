import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, Sparkles, Loader2, Paperclip, Mic, MicOff, Bot, StopCircle, Trash2 } from "lucide-react";
import { useSandbox } from "@/contexts/SandboxContext";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useChatManager } from "@/hooks/useChatManager";
import ChatMessageBubble from "./ChatMessageBubble";
import { TaskTrackingPanel } from "./TaskTrackingPanel";
import { toast } from "sonner";

// Note: If you get an import error here, change "motion/react" to "framer-motion"
import { motion, AnimatePresence } from "motion/react";

const SUGGESTED_PROMPTS = [
  "Build a beautiful landing page",
  "Add dark mode support",
  "Create a dashboard with charts",
  "Add authentication flow",
];

const ChatPanel = () => {
  const { status: sandboxStatus, messages } = useSandbox();

  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);

  // FIXED: Default to a clean, valid model ID
  const [activeModel, setActiveModel] = useState<string>(
    () => localStorage.getItem("activeModel") || "gemini-2.0-flash"
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isListening, startListening, stopListening } = useSpeechRecognition(
    (transcript) => setInput((prev) => prev ? `${prev} ${transcript}` : transcript)
  );

  const { isProcessing, handleSend: sendMessage, handleStop, clearChat } = useChatManager();

  useEffect(() => {
    if (messages.length > 0) setShowSuggestions(false);
  }, [messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== "string") return;
        setAttachedImages(prev => {
          if (prev.length >= 3) {
            toast.warning("Maximum of 3 images allowed.", { id: "img" });
            return prev;
          }
          return [...prev, result];
        });
      };
      reader.onerror = () => toast.error("Failed to read image file.");
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => setAttachedImages(prev => prev.filter((_, i) => i !== index));

  const handleSend = async (text?: string) => {
    const msgText = (text || input).trim();
    if (!msgText && attachedImages.length === 0) return;

    setShowSuggestions(false);
    const sentImages = attachedImages.length > 0 ? [...attachedImages] : undefined;

    setAttachedImages([]);
    setInput("");

    await sendMessage(msgText, sentImages);
  };

  const handleClearChat = useCallback(() => {
    if (!confirm("Clear all messages? This cannot be undone.")) return;
    clearChat();
    setShowSuggestions(true);
  }, [clearChat]);

  const isEmpty = messages.length === 0;
  const msgCount = messages.filter(m => m.role === "user").length;
  const charCount = input.length;
  const hasContent = input.trim().length > 0 || attachedImages.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "hsl(var(--background))" }}>
      {/* Header */}
      <div className="shrink-0 border-b border-border/50" style={{ background: "hsl(var(--card) / 0.8)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* AI avatar */}
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" style={{ background: "linear-gradient(135deg, hsl(258,90%,62%), hsl(278,85%,65%))" }}>
              <Sparkles size={14} className="text-white" />
            </div>
            {sandboxStatus === "ready" && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-background" />
            )}
          </div>

          {/* Model selector + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <select
                value={activeModel}
                onChange={(e) => {
                  const val = e.target.value;
                  localStorage.setItem("activeModel", val);
                  setActiveModel(val);
                }}
                className="text-sm font-semibold text-foreground bg-transparent border-none outline-none cursor-pointer hover:text-primary transition-colors"
                title="Switch model">
                {/* FIXED: Mapped properly to match server.ts backend */}
                <option value="gemini-2.0-flash">✦ Gemini 2.0 Flash</option>
                <option value="google/gemini-2.5-pro">✦ Gemini 2.5 Pro</option>
                <option value="claude-3-7-sonnet-20250219">◆ Claude 3.7 Sonnet</option>
                <option value="anthropic/claude-haiku-4.5">◆ Claude 3.5 Haiku</option>
              </select>
            </div>
            <div className="text-[11px] text-muted-foreground/60">
              {sandboxStatus === "creating" ? "Setting up sandbox..." : sandboxStatus === "ready" ? "Ready to Build" : sandboxStatus === "error" ? "Connection error" : "Initializing..."}
            </div>
          </div>

          {/* Live badge + message count */}
          <div className="ml-auto flex items-center gap-2">
            <AnimatePresence mode="wait">
              {sandboxStatus === "creating" && (
                <motion.div key="creating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/50">
                  <Loader2 size={9} className="animate-spin" /><span>Starting</span>
                </motion.div>
              )}
              {sandboxStatus === "ready" && (
                <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
                </motion.div>
              )}
            </AnimatePresence>
            {msgCount > 0 && (
              <span className="text-[11px] text-muted-foreground/40 font-medium tabular-nums">#{msgCount}</span>
            )}
            <button onClick={handleClearChat} title="Clear chat"
              className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground/30 hover:text-destructive transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Task tracking panel — auto-shows when AI dispatches tasks */}
      <TaskTrackingPanel />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-5 py-8 text-center gap-5">
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl"
              style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}>
              <Bot size={24} className="text-white" />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <h3 className="font-bold text-sm text-foreground mb-1">How can I help you build?</h3>
              <p className="text-xs text-muted-foreground/60 max-w-[200px] leading-relaxed">Describe what you want to create and I'll write the code.</p>
            </motion.div>
            <AnimatePresence>
              {showSuggestions && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.15 }}
                  className="w-full flex flex-col gap-2">
                  {SUGGESTED_PROMPTS.map((prompt, i) => (
                    <motion.button key={prompt} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.05 }}
                      onClick={() => handleSend(prompt)}
                      className="text-left px-3 py-2 rounded-xl text-xs text-muted-foreground border border-border/60 hover:border-primary/40 hover:text-foreground hover:bg-primary/5 transition-all duration-200">
                      {prompt}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="px-3 py-4 space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((msg: any) => <ChatMessageBubble key={msg.id} message={msg} onSuggestion={(text: string) => { setInput(text); setTimeout(() => textareaRef.current?.focus(), 50); }} />)}
            </AnimatePresence>

            {/* Added check for both toolCalls and tool_calls syntax depending on API response */}
            {(() => {
              const lastMessage = messages[messages.length - 1] as (typeof messages)[number] & { tool_calls?: unknown[] } | undefined;
              return isProcessing &&
                lastMessage?.content === "" &&
                ((lastMessage?.toolCalls?.length || lastMessage?.tool_calls?.length) ?? 0) === 0;
            })() && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5 pl-11">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(var(--primary))" }}
                        animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground/60">Thinking...</span>
                </motion.div>
              )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 p-3 border-t border-border/50" style={{ background: "hsl(var(--card) / 0.5)", backdropFilter: "blur(12px)" }}>
        <div className="rounded-2xl overflow-hidden border transition-all duration-200"
          style={{
            background: "hsl(var(--background))",
            borderColor: isProcessing ? "hsl(var(--primary) / 0.4)" : "hsl(var(--border))",
            boxShadow: isProcessing ? "var(--shadow-glow)" : "var(--shadow-sm)",
          }}>
          {/* Attached Images */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto custom-scrollbar">
              {attachedImages.map((src, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border/60 shrink-0 group shadow-sm bg-muted/20">
                  <img src={src} alt="upload" className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(i)} className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm" title="Remove image">
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Describe what you want to build..."
            className="w-full bg-transparent border-none outline-none resize-none text-sm text-foreground placeholder:text-muted-foreground/40 px-4 pt-3 pb-2 min-h-[46px] max-h-[160px]"
            rows={1} disabled={isProcessing} />
          <div className="flex items-center justify-between px-3 pb-2.5 gap-2">
            <div className="flex items-center gap-0.5">
              <input type="file" accept="image/*" multiple hidden ref={fileInputRef} onChange={handleImageUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/50 hover:text-foreground"
                title="Upload image (max 3)"
              >
                <Paperclip size={14} />
              </button>
              <button onClick={() => isListening ? stopListening() : startListening()}
                className={`p-1.5 rounded-lg transition-all duration-200 ${isListening ? "bg-red-500/10 text-red-500" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60"}`}>
                {isListening ? <MicOff size={14} className="animate-pulse" /> : <Mic size={14} />}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {charCount > 0 && !isProcessing && (
                <span className={`text-[10px] tabular-nums font-medium transition-colors ${charCount > 1500 ? "text-destructive" : "text-muted-foreground/30"}`}>
                  {charCount > 1000 ? `${(charCount / 1000).toFixed(1)}k` : charCount}
                </span>
              )}
              {isProcessing && (
                <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors border border-destructive/20">
                  <StopCircle size={12} />Stop
                </motion.button>
              )}
              <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} onClick={() => handleSend()}
                disabled={!hasContent || isProcessing}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-md"
                style={{ background: hasContent && !isProcessing ? "var(--gradient-primary)" : "hsl(var(--muted))" }}>
                {isProcessing ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : <ArrowUp size={14} className={hasContent ? "text-white" : "text-muted-foreground"} />}
              </motion.button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/35 text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
};

export default ChatPanel;
