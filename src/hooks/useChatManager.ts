import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { CreditsService } from "@/services/CreditsService";
import { useSandbox } from "@/contexts/SandboxContext";
import { type ToolCall } from "@/lib/tools";
import {
  coerceInitialChatHistory,
  dataUrlsToFileParts,
  uiMessagesToChatMessages,
} from "@/lib/chat-message-adapter";
import { toast } from "sonner";

function getActiveModel() {
  return localStorage.getItem("activeModel") || "gemini-2.0-flash";
}

function formatChatErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Unknown error");
  const lower = raw.toLowerCase();

  if (lower.includes("network")) return "Network error - check your connection.";
  if (lower.includes("failed to fetch")) return "Network error - check your connection.";
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
    return "Rate limit reached - please try again shortly.";
  }

  return raw;
}

function appendErrorMessage(messages: UIMessage[], message: string) {
  const errorText = `⚠️ ${message}`;
  const lastMessage = messages[messages.length - 1];
  const lastPart = lastMessage?.parts[0];

  if (
    lastMessage?.role === "assistant" &&
    lastMessage.parts.length === 1 &&
    lastPart?.type === "text" &&
    lastPart.text === errorText
  ) {
    return messages;
  }

  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: errorText }],
    },
  ];
}

export function useChatManager() {
  const {
    sandboxId,
    executeToolCall,
    messages: renderedMessages,
    setMessages,
    chatHistory,
    setChatHistory,
  } = useSandbox();

  const initialMessagesRef = useRef<UIMessage[]>(
    coerceInitialChatHistory(chatHistory, renderedMessages),
  );
  const renderedMessagesRef = useRef(renderedMessages);
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    renderedMessagesRef.current = renderedMessages;
  }, [renderedMessages]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...(body || {}),
            messages,
            model: getActiveModel(),
            sandboxId,
          },
        }),
      }),
    [sandboxId],
  );

  const {
    messages: uiMessages,
    sendMessage,
    stop,
    addToolOutput,
    status,
    error,
    clearError,
    setMessages: setUiMessages,
  } = useChat({
    messages: initialMessagesRef.current,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      const toolName = toolCall.toolName;
      const toolInput = toolCall.input && typeof toolCall.input === "object"
        ? toolCall.input as Record<string, unknown>
        : { _raw: toolCall.input };

      const uiToolCall: ToolCall = {
        id: toolCall.toolCallId,
        name: toolName,
        arguments: toolInput,
        status: "running",
      };

      try {
        const result = await executeToolCall(uiToolCall);
        if (result.success) {
          addToolOutput({
            tool: toolName,
            toolCallId: toolCall.toolCallId,
            output: result.result,
          });
          return;
        }

        addToolOutput({
          tool: toolName,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: result.result || "Tool execution failed.",
        });
      } catch (toolError) {
        addToolOutput({
          tool: toolName,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: formatChatErrorMessage(toolError),
        });
      }
    },
  });

  useEffect(() => {
    const nextMessages = uiMessagesToChatMessages(uiMessages, renderedMessagesRef.current);
    renderedMessagesRef.current = nextMessages;
    setChatHistory(uiMessages as any[]);
    setMessages(nextMessages);
  }, [uiMessages, setChatHistory, setMessages]);

  useEffect(() => {
    if (!error) return;

    const message = formatChatErrorMessage(error);
    if (lastErrorRef.current === message) return;

    lastErrorRef.current = message;
    toast.error(message);
    setUiMessages((current) => appendErrorMessage(current, message));
  }, [error, setUiMessages]);

  const handleSend = useCallback(
    async (text: string, attachedImages?: string[]) => {
      const trimmedText = text.trim();
      if (!trimmedText && (!attachedImages || attachedImages.length === 0)) return;
      if (status === "submitted" || status === "streaming") return;

      try {
        const { allowed, reason } = await CreditsService.canUseCredits();
        if (!allowed) {
          toast.error(reason || "No credits remaining. Please upgrade your plan.");
          return;
        }

        await CreditsService.deductCredit();
        clearError();
        lastErrorRef.current = null;

        await sendMessage({
          text: trimmedText,
          ...(attachedImages && attachedImages.length > 0
            ? { files: dataUrlsToFileParts(attachedImages) }
            : {}),
        });
      } catch (sendError) {
        const message = formatChatErrorMessage(sendError);
        if (lastErrorRef.current !== message) {
          lastErrorRef.current = message;
          toast.error(message);
          setUiMessages((current) => appendErrorMessage(current, message));
        }
      }
    },
    [clearError, sendMessage, setUiMessages, status],
  );

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  useEffect(() => {
    window.addEventListener("ai-stop-generation", handleStop);
    return () => window.removeEventListener("ai-stop-generation", handleStop);
  }, [handleStop]);

  const clearChat = useCallback(() => {
    stop();
    clearError();
    lastErrorRef.current = null;
    setUiMessages([]);
    setChatHistory([]);
    setMessages([]);
  }, [clearError, setChatHistory, setMessages, setUiMessages, stop]);

  const isProcessing = status === "submitted" || status === "streaming";

  return { isProcessing, handleSend, handleStop, clearChat };
}
