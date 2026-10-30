import { EndpointType } from "@/components/chat_ui/mode_endpoint_mapping";
import type { KeyValuePair } from "@/components/key_value_input";
import { parseStoredHeaderPairs } from "@/components/llm_calls/request_headers";
import { OPEN_AI_VOICES, type OpenAIVoice } from "../chat_ui/chatConstants";

export type KeySource = "session" | "custom";

export type PlaygroundSettings = Readonly<{
  keySource: KeySource;
  virtualKey: string;
  proxyBaseUrl: string;
  endpoint: EndpointType;
  model: string | null;
  voice: OpenAIVoice;
  tags: readonly string[];
  headerPairs: readonly KeyValuePair[];
  stream: boolean;
  simulateFallback: boolean;
  temperature: number | null;
  maxTokens: number | null;
}>;

export type StoredValue = Readonly<{ key: string; value: string | null; secure: boolean }>;

export type SettingsStorage = Readonly<{
  read: (key: string) => string | null;
  readSecure: (key: string) => string | null;
}>;

const ENDPOINTS: readonly string[] = Object.values(EndpointType);
const VOICES: readonly string[] = Object.values(OPEN_AI_VOICES);

const parseJson = (raw: string | null): unknown => {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const stringList = (raw: string | null): readonly string[] => {
  const parsed = parseJson(raw);
  return isStringList(parsed) ? parsed : [];
};

const endpoint = (raw: string | null): EndpointType =>
  ENDPOINTS.includes(raw ?? "") ? (raw as EndpointType) : EndpointType.CHAT;

const voice = (raw: string | null): OpenAIVoice => {
  const parsed = parseJson(raw);
  const candidate = typeof parsed === "string" ? parsed : raw;
  return VOICES.includes(candidate ?? "") ? (candidate as OpenAIVoice) : OPEN_AI_VOICES.ALLOY;
};

const keySource = (raw: string | null, keysDisabled: boolean): KeySource => {
  if (keysDisabled) return "custom";
  const parsed = parseJson(raw);
  return parsed === "custom" ? "custom" : "session";
};

export const defaultSettings = (keysDisabled: boolean): PlaygroundSettings => ({
  keySource: keysDisabled ? "custom" : "session",
  virtualKey: "",
  proxyBaseUrl: "",
  endpoint: EndpointType.CHAT,
  model: null,
  voice: OPEN_AI_VOICES.ALLOY,
  tags: [],
  headerPairs: [],
  stream: true,
  simulateFallback: false,
  temperature: null,
  maxTokens: null,
});

export const loadSettings = (storage: SettingsStorage, keysDisabled: boolean): PlaygroundSettings => ({
  ...defaultSettings(keysDisabled),
  keySource: keySource(storage.readSecure("apiKeySource"), keysDisabled),
  virtualKey: storage.readSecure("apiKey") ?? "",
  headerPairs: parseStoredHeaderPairs(storage.readSecure("customHeaders")),
  proxyBaseUrl: storage.read("customProxyBaseUrl") ?? "",
  endpoint: endpoint(storage.read("endpointType")),
  model: storage.read("selectedModel"),
  voice: voice(storage.read("selectedVoice")),
  tags: stringList(storage.read("selectedTags")),
  stream: storage.read("streamingEnabled") !== "false",
});

export const storedValues = (settings: PlaygroundSettings): readonly StoredValue[] => [
  { key: "apiKeySource", value: JSON.stringify(settings.keySource), secure: true },
  { key: "apiKey", value: settings.virtualKey, secure: true },
  { key: "customHeaders", value: JSON.stringify(settings.headerPairs), secure: true },
  { key: "customProxyBaseUrl", value: settings.proxyBaseUrl || null, secure: false },
  { key: "endpointType", value: settings.endpoint, secure: false },
  { key: "selectedModel", value: settings.model, secure: false },
  { key: "selectedVoice", value: settings.voice, secure: false },
  { key: "selectedTags", value: JSON.stringify(settings.tags), secure: false },
  { key: "streamingEnabled", value: String(settings.stream), secure: false },
];

export const withEndpoint = (settings: PlaygroundSettings, next: EndpointType): PlaygroundSettings => ({
  ...settings,
  endpoint: next,
  model: null,
});
