import type { TokenUsage } from "../chat_ui/ResponseMetrics";

interface AttachmentData {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
}

export interface ChatImageAttachment extends AttachmentData {
  kind?: "image";
}

export interface ChatFileAttachment extends AttachmentData {
  kind: "file";
  mimeType: string;
}

export type ChatAttachment = ChatImageAttachment | ChatFileAttachment;

export interface ChatImageGeneration {
  model: string;
  prompt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  attachments?: ChatAttachment[];
  generatedImages?: ChatImageAttachment[];
  imageGeneration?: ChatImageGeneration;
  reasoningContent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  timeToFirstToken?: number;
  totalLatency?: number;
  usage?: TokenUsage;
  timestamp: number;
}

export type AssistantMessageUpdate = Partial<
  Pick<
    ChatMessage,
    | "content"
    | "reasoningContent"
    | "timeToFirstToken"
    | "totalLatency"
    | "usage"
    | "generatedImages"
    | "imageGeneration"
  >
>;

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
