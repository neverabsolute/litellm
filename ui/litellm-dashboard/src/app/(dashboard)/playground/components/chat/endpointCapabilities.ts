import { EndpointType } from "@/components/chat_ui/mode_endpoint_mapping";
import { AUDIO_ACCEPT, CHAT_ATTACHMENT_ACCEPT, IMAGE_EDIT_ACCEPT } from "../chat_ui/uploadValidation";

export type AttachKind = "chat" | "images" | "audio";

export type Capabilities = Readonly<{
  attach: AttachKind | null;
  codeInterpreter: boolean;
  stream: boolean;
  simulateFallback: boolean;
  sampling: boolean;
  sessions: boolean;
  voice: boolean;
  customHeaders: boolean;
  textRequired: boolean;
  placeholder: string;
}>;

const BASE: Capabilities = {
  attach: null,
  codeInterpreter: false,
  stream: false,
  simulateFallback: false,
  sampling: false,
  sessions: false,
  voice: false,
  customHeaders: true,
  textRequired: true,
  placeholder: "Send a test request",
};

const CAPABILITIES: Readonly<Record<EndpointType, Capabilities>> = {
  [EndpointType.CHAT]: { ...BASE, stream: true, attach: "chat", simulateFallback: true, sampling: true },
  [EndpointType.RESPONSES]: { ...BASE, stream: true, attach: "chat", codeInterpreter: true, sessions: true },
  [EndpointType.ANTHROPIC_MESSAGES]: { ...BASE, stream: true },
  [EndpointType.IMAGE]: { ...BASE, placeholder: "Describe the image you want to generate" },
  [EndpointType.VIDEO]: { ...BASE, placeholder: "Describe the video you want to generate" },
  [EndpointType.IMAGE_EDITS]: { ...BASE, attach: "images", placeholder: "Describe how to edit the images" },
  [EndpointType.EMBEDDINGS]: { ...BASE, placeholder: "Text to embed" },
  [EndpointType.SPEECH]: { ...BASE, voice: true, placeholder: "Text to turn into speech" },
  [EndpointType.TRANSCRIPTION]: {
    ...BASE,
    attach: "audio",
    textRequired: false,
    placeholder: "Optional context for the transcription",
  },
  [EndpointType.REALTIME]: { ...BASE, customHeaders: false },
  [EndpointType.INTERACTIONS]: { ...BASE },
};

export const capabilitiesFor = (endpoint: EndpointType): Capabilities => CAPABILITIES[endpoint];

export const ACCEPT_FOR: Readonly<Record<AttachKind, string>> = {
  chat: CHAT_ATTACHMENT_ACCEPT,
  images: IMAGE_EDIT_ACCEPT,
  audio: AUDIO_ACCEPT,
};

export const ATTACH_LABEL: Readonly<Record<AttachKind, string>> = {
  chat: "Attach an image or PDF",
  images: "Add images to edit",
  audio: "Attach an audio file",
};

export const SUGGESTIONS: Readonly<Partial<Record<EndpointType, readonly string[]>>> = {
  [EndpointType.CHAT]: ["Write me a poem", "Explain quantum computing", "Draft a polite email requesting a meeting"],
  [EndpointType.RESPONSES]: [
    "Write me a poem",
    "Explain quantum computing",
    "Draft a polite email requesting a meeting",
  ],
  [EndpointType.ANTHROPIC_MESSAGES]: [
    "Write me a poem",
    "Explain quantum computing",
    "Draft a polite email requesting a meeting",
  ],
};

export const CODE_INTERPRETER_SUGGESTIONS: readonly string[] = [
  "Generate sample sales data CSV and create a chart",
  "Create a PNG bar chart comparing AI gateway providers including LiteLLM",
  "Generate a CSV of LLM pricing data and visualize it as a line chart",
];
