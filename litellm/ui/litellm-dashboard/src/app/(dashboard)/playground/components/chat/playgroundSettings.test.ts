import { describe, expect, it } from "vitest";
import { EndpointType } from "@/components/chat_ui/mode_endpoint_mapping";
import { OPEN_AI_VOICES } from "../chat_ui/chatConstants";
import {
  defaultSettings,
  loadSettings,
  storedValues,
  withEndpoint,
  type PlaygroundSettings,
  type SettingsStorage,
} from "./playgroundSettings";

const storageOf = (values: Readonly<Record<string, string>>): SettingsStorage => ({
  read: (key) => values[key] ?? null,
  readSecure: (key) => values[key] ?? null,
});

const settingsWith = (change: Partial<PlaygroundSettings>): PlaygroundSettings => ({
  ...defaultSettings(false),
  ...change,
});

describe("loadSettings", () => {
  it("restores every persisted field from what storedValues wrote", () => {
    const persisted: Partial<PlaygroundSettings> = {
      keySource: "custom",
      virtualKey: "sk-test",
      proxyBaseUrl: "http://gateway.test",
      endpoint: EndpointType.RESPONSES,
      model: "gpt-test",
      voice: OPEN_AI_VOICES.NOVA,
      tags: ["team-a"],
      headerPairs: [["x-trace", "abc"]],
      stream: false,
    };
    const original = settingsWith(persisted);
    const written = Object.fromEntries(
      storedValues(original)
        .filter((entry): entry is { key: string; value: string; secure: boolean } => entry.value !== null)
        .map(({ key, value }) => [key, value]),
    );

    expect(loadSettings(storageOf(written), false)).toEqual(original);
  });

  it("falls back to defaults when stored values are corrupt or unknown", () => {
    const corrupt = {
      endpointType: "/v1/not-an-endpoint",
      selectedVoice: "robot",
      selectedTags: "{not json",
    };
    const loaded = loadSettings(storageOf(corrupt), false);

    expect(loaded.endpoint).toBe(EndpointType.CHAT);
    expect(loaded.voice).toBe(OPEN_AI_VOICES.ALLOY);
    expect(loaded.tags).toEqual([]);
    expect(loadSettings(storageOf({ selectedTags: JSON.stringify([1, 2]) }), false).tags).toEqual([]);
  });

  it("forces the virtual key source when personal keys are disabled", () => {
    expect(loadSettings(storageOf({ apiKeySource: JSON.stringify("session") }), true).keySource).toBe("custom");
    expect(loadSettings(storageOf({ apiKeySource: JSON.stringify("session") }), false).keySource).toBe("session");
  });
});

describe("withEndpoint", () => {
  it("switches the endpoint and clears the model picked for the previous one", () => {
    const next = withEndpoint(settingsWith({ model: "gpt-test" }), EndpointType.RESPONSES);

    expect(next.endpoint).toBe(EndpointType.RESPONSES);
    expect(next.model).toBeNull();
  });
});
