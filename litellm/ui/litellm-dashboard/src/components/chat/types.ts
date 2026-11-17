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

export interface ChatBackgroundRun {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete" | "expired";
}

export interface ChatCitation {
  url: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  attachments?: ChatAttachment[];
  generatedImages?: ChatImageAttachment[];
  imageGeneration?: ChatImageGeneration;
  research?: boolean;
  citations?: ChatCitation[];
  webSearchCount?: number;
  reasoningContent?: string;
  backgroundRun?: ChatBackgroundRun;
  backgroundError?: string;
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
    | "backgroundRun"
    | "backgroundError"
    | "citations"
    | "webSearchCount"
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
