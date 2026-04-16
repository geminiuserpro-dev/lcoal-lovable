import type { FileUIPart, UIMessage } from "ai";
import type { ChatMessage, ToolCall } from "@/lib/tools";

function isToolPart(part: { type: string }) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function getToolName(part: { type: string; toolName?: string }) {
  return part.type === "dynamic-tool" ? (part.toolName || "dynamic-tool") : part.type.slice(5);
}

function getToolStatus(state?: string): ToolCall["status"] {
  if (state === "output-available") return "completed";
  if (state === "output-error" || state === "output-denied") return "error";
  return "running";
}

function stringifyToolResult(value: unknown) {
  if (value == null) return undefined;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getMessageTimestamp(message: UIMessage, previousById: Map<string, Date>) {
  const previousTimestamp = previousById.get(message.id);
  if (previousTimestamp) return previousTimestamp;

  const metadataTimestamp = (message.metadata as { timestamp?: string } | undefined)?.timestamp;
  if (metadataTimestamp) {
    const parsed = new Date(metadataTimestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

export function uiMessagesToChatMessages(
  messages: UIMessage[],
  previousMessages: ChatMessage[] = [],
): ChatMessage[] {
  const previousById = new Map(previousMessages.map((message) => [message.id, message.timestamp]));

  return messages
    .filter((message): message is UIMessage & { role: "user" | "assistant" } => (
      message.role === "user" || message.role === "assistant"
    ))
    .map((message) => {
      const content = message.parts
        .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("");

      const images = message.parts
        .filter((part): part is FileUIPart => part.type === "file")
        .filter((part) => part.mediaType.startsWith("image/"))
        .map((part) => part.url);

      const toolCalls = (message.parts
        .filter((part) => typeof part.type === "string" && isToolPart(part)) as Array<any>)
        .map((part) => {
          const result = part.state === "output-error"
            ? part.errorText
            : part.state === "output-denied"
              ? "Tool execution was denied."
              : stringifyToolResult("output" in part ? part.output : undefined);

          return {
            id: part.toolCallId,
            name: getToolName(part),
            arguments: (part.input as Record<string, unknown> | undefined) || {},
            status: getToolStatus(part.state),
            result,
          } satisfies ToolCall;
        });

      return {
        id: message.id,
        role: message.role,
        content,
        images: images.length > 0 ? images : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: getMessageTimestamp(message, previousById),
      } satisfies ChatMessage;
    });
}

function getDataUrlMediaType(url: string) {
  const match = url.match(/^data:([^;,]+)[;,]/i);
  return match?.[1] || "image/png";
}

function getExtension(mediaType: string) {
  const subtype = mediaType.split("/")[1] || "png";
  return subtype.split("+")[0] || "png";
}

export function dataUrlsToFileParts(dataUrls: string[] = []): FileUIPart[] {
  return dataUrls.map((url, index) => {
    const mediaType = getDataUrlMediaType(url);

    return {
      type: "file",
      url,
      mediaType,
      filename: `upload-${index + 1}.${getExtension(mediaType)}`,
    };
  });
}

function isUIMessageArray(value: unknown): value is UIMessage[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    return "id" in item && "role" in item && Array.isArray((item as UIMessage).parts);
  });
}

export function coerceInitialChatHistory(
  chatHistory: unknown,
  renderedMessages: ChatMessage[],
): UIMessage[] {
  if (isUIMessageArray(chatHistory)) {
    return chatHistory;
  }

  return renderedMessages
    .filter((message) => (message.content || "").trim() || (message.images?.length ?? 0) > 0)
    .map((message) => ({
      id: message.id,
      role: message.role,
      metadata: { timestamp: message.timestamp.toISOString() },
      parts: [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...(message.role === "user" ? dataUrlsToFileParts(message.images || []) : []),
      ],
    }));
}
