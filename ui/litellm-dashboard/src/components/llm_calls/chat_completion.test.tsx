import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import openai from "openai";
import { makeOpenAIChatCompletionRequest } from "./chat_completion";
import type { TokenUsage } from "../chat_ui/ResponseMetrics";

vi.mock("@/components/networking", () => ({
  getGatewayBaseUrl: vi.fn(() => "https://gateway.example.com"),
}));

// Mock the OpenAI client
const mockCreate = vi.fn();
const mockChatCompletions = {
  create: mockCreate,
};
const mockChat = {
  completions: mockChatCompletions,
};
const mockClient = {
  chat: mockChat,
};

vi.mock("openai", () => ({
  default: {
    OpenAI: vi.fn(function () {
      return mockClient;
    }),
  },
}));

const nonStreamingResponse = (data: unknown, headers: Record<string, string> = {}) => ({
  withResponse: async () => ({ data, response: { headers: new Headers(headers) } }),
});

describe("chat_completion", () => {
  const mockUpdateUI = vi.fn();
  const mockChatHistory = [{ role: "user", content: "Hello" }];

  beforeEach(() => {
    // Create a mock async iterator for streaming response
    const mockChunks = [
      {
        choices: [{ delta: { content: "Hello" }, index: 0 }],
        model: "gpt-4",
      },
      {
        choices: [{ delta: { content: " there" }, index: 0 }],
        model: "gpt-4",
      },
      {
        choices: [{ delta: {}, index: 0 }],
        model: "gpt-4",
        usage: {
          completion_tokens: 2,
          prompt_tokens: 5,
          total_tokens: 7,
        },
      },
    ];

    async function* mockStream() {
      for (const chunk of mockChunks) {
        yield chunk;
      }
    }

    mockCreate.mockResolvedValue(mockStream());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should make a basic chat completion request", async () => {
    await makeOpenAIChatCompletionRequest(mockChatHistory, mockUpdateUI, "gpt-4", "test-token");

    expect(openai.OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://gateway.example.com" }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: "gpt-4",
        stream: true,
        stream_options: {
          include_usage: true,
        },
        messages: mockChatHistory,
      },
      { signal: undefined },
    );
    expect(mockUpdateUI).toHaveBeenCalledWith("Hello", "gpt-4");
    expect(mockUpdateUI).toHaveBeenCalledWith(" there", "gpt-4");
  });

  it("should include temperature and max_tokens when provided", async () => {
    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      undefined, // onUsageData
      undefined, // traceId
      undefined, // onImageGenerated
      0.7, // temperature
      100, // max_tokens
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      model: "gpt-4",
      stream: true,
      stream_options: {
        include_usage: true,
      },
      messages: mockChatHistory,
      temperature: 0.7,
      max_tokens: 100,
    });
  });

  it("should include mock_testing_fallbacks in request body when mockTestFallbacks is true", async () => {
    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      undefined, // onUsageData
      undefined, // traceId
      undefined, // onImageGenerated
      undefined, // temperature
      undefined, // max_tokens
      undefined, // onTotalLatency
      undefined, // customBaseUrl
      true, // mockTestFallbacks
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.mock_testing_fallbacks).toBe(true);
  });

  it("should send a non-streaming request and render the whole message at once when streaming is disabled", async () => {
    mockCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Hello there" },
          },
        ],
        usage: {
          completion_tokens: 2,
          prompt_tokens: 5,
          total_tokens: 7,
          cost: 0.25,
        },
      }),
    );

    const onTimingData = vi.fn();
    const onUsageData = vi.fn();
    const onTotalLatency = vi.fn();

    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      onTimingData,
      onUsageData,
      undefined, // traceId
      undefined, // onImageGenerated
      undefined, // temperature
      undefined, // max_tokens
      onTotalLatency,
      undefined, // customBaseUrl
      undefined, // mockTestFallbacks
      false, // streamingEnabled
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.stream).toBe(false);
    expect(callArgs).not.toHaveProperty("stream_options");

    expect(mockUpdateUI).toHaveBeenCalledTimes(1);
    expect(mockUpdateUI).toHaveBeenCalledWith("Hello there", "gpt-4");

    expect(onUsageData).toHaveBeenCalledWith({
      completionTokens: 2,
      promptTokens: 5,
      totalTokens: 7,
      cost: 0.25,
    });
    expect(onTimingData).not.toHaveBeenCalled();
    expect(onTotalLatency).toHaveBeenCalledWith(expect.any(Number));
  });

  it("should surface reasoning content from a non-streaming response", async () => {
    mockCreate.mockReturnValueOnce(
      nonStreamingResponse({
        model: "gpt-4",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "done",
              reasoning_content: "thinking",
            },
          },
        ],
      }),
    );

    const onReasoningContent = vi.fn();

    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      onReasoningContent,
      undefined, // onTimingData
      undefined, // onUsageData
      undefined, // traceId
      undefined, // onImageGenerated
      undefined, // temperature
      undefined, // max_tokens
      undefined, // onTotalLatency
      undefined, // customBaseUrl
      undefined, // mockTestFallbacks
      false, // streamingEnabled
    );

    expect(onReasoningContent).toHaveBeenCalledWith("thinking");
    expect(mockUpdateUI).toHaveBeenCalledWith("done", "gpt-4");
  });

  it("should not include mock_testing_fallbacks in request body when mockTestFallbacks is false or undefined", async () => {
    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      undefined, // onUsageData
      undefined, // traceId
      undefined, // onImageGenerated
      undefined, // temperature
      undefined, // max_tokens
      undefined, // onTotalLatency
      undefined, // customBaseUrl
      false, // mockTestFallbacks
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("mock_testing_fallbacks");
  });
});

describe("chat_completion prompt cache usage", () => {
  const captureUsage = async (usage: Record<string, unknown>): Promise<TokenUsage> => {
    async function* mockStream() {
      yield {
        choices: [{ delta: {}, index: 0 }],
        model: "gpt-4",
        usage: { completion_tokens: 2, prompt_tokens: 5000, total_tokens: 5002, ...usage },
      };
    }
    mockCreate.mockResolvedValue(mockStream());

    const onUsageData = vi.fn();
    await makeOpenAIChatCompletionRequest(
      [{ role: "user", content: "Hello" }],
      vi.fn(),
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledTimes(1);
    return onUsageData.mock.calls[0][0] as TokenUsage;
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces read and creation tokens from Anthropic-shape usage", async () => {
    await expect(
      captureUsage({ cache_read_input_tokens: 4695, cache_creation_input_tokens: 1234 }),
    ).resolves.toMatchObject({ cacheReadTokens: 4695, cacheCreationTokens: 1234 });
  });

  it("surfaces read tokens from OpenAI-shape prompt_tokens_details", async () => {
    await expect(
      captureUsage({ prompt_tokens_details: { cached_tokens: 4695, cache_write_tokens: 0 } }),
    ).resolves.toMatchObject({ cacheReadTokens: 4695, promptTokens: 5000 });
  });

  it("omits cache fields entirely for a provider that reports none", async () => {
    const usageData = await captureUsage({});

    expect(usageData).not.toHaveProperty("cacheReadTokens");
    expect(usageData).not.toHaveProperty("cacheCreationTokens");
    expect(usageData.promptTokens).toBe(5000);
  });

  it("omits cache fields when the provider reports zeroes", async () => {
    const usageData = await captureUsage({
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
    });

    expect(usageData).not.toHaveProperty("cacheReadTokens");
    expect(usageData).not.toHaveProperty("cacheCreationTokens");
  });

  it("omits cost when the provider reports a non-numeric value", async () => {
    const usageData = await captureUsage({ cost: "not-a-number" });

    expect(usageData).toEqual(expect.not.objectContaining({ cost: expect.anything() }));
  });

  it("omits cost when the provider reports a blank value", async () => {
    const usageData = await captureUsage({ cost: "  " });

    expect(usageData).toEqual(expect.not.objectContaining({ cost: expect.anything() }));
  });
});

describe("chat_completion response cache", () => {
  const mockUpdateUI = vi.fn();
  const mockChatHistory = [{ role: "user", content: "Hello" }];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("flags a non-streaming response-cache hit even though it replays provider prompt-cache usage", async () => {
    mockCreate.mockReturnValueOnce(
      nonStreamingResponse(
        {
          id: "chatcmpl-replayed",
          model: "gpt-4",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hello there" } }],
          usage: {
            completion_tokens: 2,
            prompt_tokens: 5000,
            total_tokens: 5002,
            prompt_tokens_details: { cached_tokens: 4695 },
          },
        },
        { "x-litellm-cache-key": "cache-key-abc" },
      ),
    );

    const onUsageData = vi.fn();

    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      onUsageData,
      undefined, // traceId
      undefined, // onImageGenerated
      undefined, // temperature
      undefined, // max_tokens
      undefined, // onTotalLatency
      undefined, // customBaseUrl
      undefined, // mockTestFallbacks
      false, // streamingEnabled
    );

    expect(onUsageData).toHaveBeenCalledWith(
      expect.objectContaining({ cacheReadTokens: 4695, servedFromResponseCache: true }),
    );
  });

  it("does not flag a non-streaming response that missed the response cache", async () => {
    mockCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "chatcmpl-fresh",
        model: "gpt-4",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hello there" } }],
        usage: { completion_tokens: 2, prompt_tokens: 5, total_tokens: 7 },
      }),
    );

    const onUsageData = vi.fn();

    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false, // streamingEnabled
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ servedFromResponseCache: true }));
  });

  it("never flags a streaming response, even when the proxy reports a cache key", async () => {
    async function* mockStream() {
      yield {
        choices: [{ delta: {}, index: 0 }],
        model: "gpt-4",
        usage: { completion_tokens: 2, prompt_tokens: 5, total_tokens: 7 },
      };
    }
    mockCreate.mockResolvedValueOnce(mockStream());

    const onUsageData = vi.fn();

    await makeOpenAIChatCompletionRequest(
      mockChatHistory,
      mockUpdateUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ servedFromResponseCache: true }));
  });
});

describe("chat_completion custom headers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends custom headers alongside the tags header on the OpenAI client", async () => {
    mockCreate.mockReturnValueOnce(nonStreamingResponse({ choices: [{ message: { content: "Hi" } }] }));

    await makeOpenAIChatCompletionRequest(
      [{ role: "user", content: "Hello" }],
      vi.fn(),
      "gpt-4",
      "test-token",
      ["team-a"],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      { "anthropic-beta": "context-1m-2025-08-07", "x-litellm-tags": "overridden" },
    );

    expect(vi.mocked(openai.OpenAI).mock.calls[0][0]).toMatchObject({
      defaultHeaders: { "anthropic-beta": "context-1m-2025-08-07", "x-litellm-tags": "overridden" },
    });
  });
});
