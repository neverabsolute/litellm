import type { TokenUsage } from "./ResponseMetrics";
import type { GatewayTrace } from "@/components/llm_calls/reply_trace";

export type ReplyTrace = Partial<GatewayTrace> &
  Readonly<{
    endpoint: string;
    requestedModel?: string;
    responseId?: string;
  }>;

export type MessageAttachment = Readonly<{
  name: string;
  size: number;
  kind: "image" | "pdf" | "audio";
  previewUrl?: string;
}>;

export interface MessageType {
  role: string;
  content: string | MultimodalContent[];
  model?: string;
  isImage?: boolean;
  isAudio?: boolean;
  isEmbeddings?: boolean;
  reasoningContent?: string;
  timeToFirstToken?: number;
  totalLatency?: number;
  usage?: TokenUsage;
  imagePreviewUrl?: string;
  image?: {
    url: string;
    detail: string;
  };
  trace?: ReplyTrace;
  attachments?: readonly MessageAttachment[];
  isError?: boolean;
}

export interface MultimodalContent {
  type: "input_text" | "input_image" | "input_file";
  filename?: string;
  file_data?: string;
  text?: string;
  image_url?: string;
  detail?: "low" | "high" | "auto";
}
