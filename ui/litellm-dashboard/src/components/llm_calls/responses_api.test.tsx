import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import openai from "openai";
import { makeOpenAIResponsesRequest } from "./responses_api";
import { MessageType } from "../chat_ui/types";
import type { TokenUsage } from "../chat_ui/ResponseMetrics";

vi.mock("@/components/networking", () => ({
  getProxyBaseUrl: vi.fn(() => "https://backend.example.com"),
  getGatewayBaseUrl: vi.fn(() => "https://gateway.example.com"),
}));

const mockResponsesCreate = vi.fn();
const mockClient = {
  responses: {
    create: mockResponsesCreate,
  },
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

describe("responses_api", () => {
  const mockUpdateTextUI = vi.fn();
  const messages: MessageType[] = [{ role: "user", content: "Hello" }];

  beforeEach(() => {
    const mockEvents = [
      { type: "response.output_text.delta", delta: "Hi" },
      {
        type: "response.completed",
        response: {
          id: "resp_123",
          usage: { output_tokens: 2, input_tokens: 5, total_tokens: 7 },
        },
      },
    ];

    async function* mockStream() {
      for (const event of mockEvents) {
        yield event;
      }
    }

    mockResponsesCreate.mockResolvedValue(mockStream());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should send a basic responses request", async () => {
    await makeOpenAIResponsesRequest(messages, mockUpdateTextUI, "gpt-4", "test-token");

    expect(openai.OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://gateway.example.com" }));
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4",
        input: [
          {
            role: "user",
            content: "Hello",
            type: "message",
          },
        ],
        stream: true,
      }),
      { signal: undefined },
    );
    expect(mockUpdateTextUI).toHaveBeenCalledWith("assistant", "Hi", "gpt-4");
  });

  it("should send a non-streaming request and render the whole output at once when streaming is disabled", async () => {
    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "resp_456",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Full " },
              { type: "output_text", text: "answer" },
            ],
          },
        ],
        usage: { output_tokens: 3, input_tokens: 4, total_tokens: 7 },
      }),
    );

    const onTimingData = vi.fn();
    const onUsageData = vi.fn();
    const onResponseId = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      onTimingData,
      onUsageData,
      undefined, // traceId
      undefined, // previousResponseId
      onResponseId,
      undefined, // codeInterpreterEnabled
      undefined, // onCodeInterpreterResult
      undefined, // customBaseUrl
      false, // streamingEnabled
    );

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate.mock.calls[0][0].stream).toBe(false);

    expect(mockUpdateTextUI).toHaveBeenCalledTimes(1);
    expect(mockUpdateTextUI).toHaveBeenCalledWith("assistant", "Full answer", "gpt-4");

    expect(onUsageData).toHaveBeenCalledWith({ completionTokens: 3, promptTokens: 4, totalTokens: 7 });
    expect(onResponseId).toHaveBeenCalledWith("resp_456");
    expect(onTimingData).not.toHaveBeenCalled();
  });

  it("should report total latency in both streaming and non-streaming modes", async () => {
    const onTotalLatency = vi.fn();
    const callWithStreaming = (streamingEnabled: boolean) =>
      makeOpenAIResponsesRequest(
        messages,
        mockUpdateTextUI,
        "gpt-4",
        "test-token",
        undefined, // tags
        undefined, // signal
        undefined, // onReasoningContent
        undefined, // onTimingData
        undefined, // onUsageData
        undefined, // traceId
        undefined, // previousResponseId
        undefined, // onResponseId
        undefined, // codeInterpreterEnabled
        undefined, // onCodeInterpreterResult
        undefined, // customBaseUrl
        streamingEnabled,
        onTotalLatency,
      );

    await callWithStreaming(true);
    expect(onTotalLatency).toHaveBeenCalledTimes(1);
    expect(onTotalLatency).toHaveBeenLastCalledWith(expect.any(Number));

    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "resp_latency",
        output: [{ type: "message", content: [{ type: "output_text", text: "Answer" }] }],
      }),
    );

    await callWithStreaming(false);
    expect(onTotalLatency).toHaveBeenCalledTimes(2);
    expect(onTotalLatency).toHaveBeenLastCalledWith(expect.any(Number));
  });

  it("should forward the cost the proxy reports on the streamed usage object", async () => {
    async function* streamWithCost() {
      yield { type: "response.output_text.delta", delta: "Hi" };
      yield {
        type: "response.completed",
        response: {
          id: "resp_cost",
          usage: { output_tokens: 12, input_tokens: 12, total_tokens: 24, cost: 0.000063 },
        },
      };
    }
    mockResponsesCreate.mockResolvedValueOnce(streamWithCost());

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledWith({
      completionTokens: 12,
      promptTokens: 12,
      totalTokens: 24,
      cost: 0.000063,
    });
  });

  it("should omit cost when the proxy reports none", async () => {
    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ cost: expect.anything() }));
  });

  it("should omit cost when the proxy reports a non-numeric cost", async () => {
    async function* streamWithNonNumericCost() {
      yield {
        type: "response.completed",
        response: {
          id: "resp_non_numeric_cost",
          usage: { output_tokens: 12, input_tokens: 12, total_tokens: 24, cost: "not-a-number" },
        },
      };
    }
    mockResponsesCreate.mockResolvedValueOnce(streamWithNonNumericCost());

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ cost: expect.anything() }));
  });

  it("should omit cost when the proxy reports a blank cost", async () => {
    async function* streamWithBlankCost() {
      yield {
        type: "response.completed",
        response: {
          id: "resp_blank_cost",
          usage: { output_tokens: 12, input_tokens: 12, total_tokens: 24, cost: "  " },
        },
      };
    }
    mockResponsesCreate.mockResolvedValueOnce(streamWithBlankCost());

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined,
      undefined,
      undefined,
      undefined,
      onUsageData,
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ cost: expect.anything() }));
  });
});

describe("responses_api reasoning", () => {
  type Run = { reasoning: string; answer: string; timeToFirstToken: number[]; reasoningBeforeFirstToken: string };

  const run = async (streamingEnabled: boolean): Promise<Run> => {
    const reasoningChunks: string[] = [];
    const answerChunks: string[] = [];
    const timeToFirstToken: number[] = [];
    const reasoningAtFirstToken: string[] = [];
    await makeOpenAIResponsesRequest(
      [{ role: "user", content: "What is 3+4?" }],
      (_role, delta) => answerChunks.push(delta),
      "qwen3",
      "test-token",
      undefined,
      undefined,
      (content) => reasoningChunks.push(content),
      (ttft) => {
        timeToFirstToken.push(ttft);
        reasoningAtFirstToken.push(reasoningChunks.join("") + "|" + answerChunks.join(""));
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      streamingEnabled,
    );
    return {
      reasoning: reasoningChunks.join(""),
      answer: answerChunks.join(""),
      timeToFirstToken,
      reasoningBeforeFirstToken: reasoningAtFirstToken[0] ?? "",
    };
  };

  const streamOf = (events: Record<string, unknown>[]) => {
    async function* mockStream() {
      for (const event of events) {
        yield event;
      }
      yield { type: "response.completed", response: { id: "resp_reasoning" } };
    }
    mockResponsesCreate.mockResolvedValue(mockStream());
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows streamed reasoning_text deltas and starts the first-token timer on them", async () => {
    streamOf([
      { type: "response.reasoning_text.delta", item_id: "rs_1", content_index: 0, delta: "Add " },
      { type: "response.reasoning_text.delta", item_id: "rs_1", content_index: 0, delta: "them" },
      { type: "response.output_text.delta", delta: "7" },
    ]);

    const result = await run(true);

    expect(result.reasoning).toBe("Add them");
    expect(result.answer).toBe("7");
    expect(result.timeToFirstToken).toHaveLength(1);
    expect(result.reasoningBeforeFirstToken).toBe("Add |");
  });

  it("separates streamed reasoning summary parts and items with a blank line", async () => {
    streamOf([
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First" },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: " part" },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Second" },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_2", summary_index: 0, delta: "Third" },
    ]);

    await expect(run(true)).resolves.toMatchObject({ reasoning: "First part\n\nSecond\n\nThird" });
  });

  it("still shows the legacy reasoning.delta event", async () => {
    streamOf([{ type: "response.reasoning.delta", delta: "Legacy thought" }]);

    await expect(run(true)).resolves.toMatchObject({ reasoning: "Legacy thought" });
  });

  it("shows non-streamed reasoning content when the summary is empty", async () => {
    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "resp_content",
        output: [
          {
            type: "reasoning",
            summary: [],
            content: [
              { type: "reasoning_text", text: "Add" },
              { type: "reasoning_text", text: "them" },
            ],
          },
          { type: "message", content: [{ type: "output_text", text: "7" }] },
        ],
      }),
    );

    await expect(run(false)).resolves.toMatchObject({ reasoning: "Add\n\nthem", answer: "7" });
  });

  it("prefers the non-streamed reasoning summary over its content", async () => {
    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "resp_summary",
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Short summary" }],
            content: [{ type: "reasoning_text", text: "Raw chain" }],
          },
          { type: "reasoning", content: [{ type: "output_text", text: "Second item" }] },
        ],
      }),
    );

    await expect(run(false)).resolves.toMatchObject({ reasoning: "Short summary\n\nSecond item" });
  });
});

describe("responses_api prompt cache usage", () => {
  const captureUsage = async (usage: Record<string, unknown>): Promise<TokenUsage> => {
    async function* mockStream() {
      yield {
        type: "response.completed",
        response: {
          id: "resp_cache",
          usage: { output_tokens: 2, input_tokens: 5000, total_tokens: 5002, ...usage },
        },
      };
    }
    mockResponsesCreate.mockResolvedValue(mockStream());

    const onUsageData = vi.fn();
    await makeOpenAIResponsesRequest(
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

  it("surfaces read tokens from Responses-shape input_tokens_details", async () => {
    await expect(
      captureUsage({ input_tokens_details: { cached_tokens: 4695, cache_write_tokens: 0 } }),
    ).resolves.toMatchObject({ cacheReadTokens: 4695, promptTokens: 5000 });
  });

  it("surfaces creation tokens from Responses-shape cache writes", async () => {
    await expect(
      captureUsage({ input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4695 } }),
    ).resolves.toMatchObject({ cacheCreationTokens: 4695 });
  });

  it("omits cache fields entirely for a provider that reports none", async () => {
    const usageData = await captureUsage({});

    expect(usageData).not.toHaveProperty("cacheReadTokens");
    expect(usageData).not.toHaveProperty("cacheCreationTokens");
    expect(usageData.promptTokens).toBe(5000);
  });

  it("surfaces reasoning tokens from Responses-shape output_tokens_details", async () => {
    await expect(captureUsage({ output_tokens_details: { reasoning_tokens: 42 } })).resolves.toMatchObject({
      reasoningTokens: 42,
    });
  });

  it("falls back to completion_tokens_details reasoning tokens when output_tokens_details is absent", async () => {
    await expect(captureUsage({ completion_tokens_details: { reasoning_tokens: 17 } })).resolves.toMatchObject({
      reasoningTokens: 17,
    });
  });
});

describe("responses_api response cache", () => {
  const mockUpdateTextUI = vi.fn();
  const messages: MessageType[] = [{ role: "user", content: "Hello" }];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("flags a non-streaming response-cache hit even though it replays provider prompt-cache usage", async () => {
    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse(
        {
          id: "resp_replayed",
          output: [{ type: "message", content: [{ type: "output_text", text: "Full answer" }] }],
          usage: {
            output_tokens: 2,
            input_tokens: 5000,
            total_tokens: 5002,
            input_tokens_details: { cached_tokens: 4695 },
          },
        },
        { "x-litellm-cache-key": "cache-key-abc" },
      ),
    );

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      onUsageData,
      undefined, // traceId
      undefined, // previousResponseId
      undefined, // onResponseId
      undefined, // codeInterpreterEnabled
      undefined, // onCodeInterpreterResult
      undefined, // customBaseUrl
      false, // streamingEnabled
    );

    expect(onUsageData).toHaveBeenCalledWith(
      expect.objectContaining({ cacheReadTokens: 4695, servedFromResponseCache: true }),
    );
  });

  it("does not flag a non-streaming response that missed the response cache", async () => {
    mockResponsesCreate.mockReturnValueOnce(
      nonStreamingResponse({
        id: "resp_fresh",
        output: [{ type: "message", content: [{ type: "output_text", text: "Full answer" }] }],
        usage: { output_tokens: 2, input_tokens: 5, total_tokens: 7 },
      }),
    );

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
      "gpt-4",
      "test-token",
      undefined, // tags
      undefined, // signal
      undefined, // onReasoningContent
      undefined, // onTimingData
      onUsageData,
      undefined, // traceId
      undefined, // previousResponseId
      undefined, // onResponseId
      undefined, // codeInterpreterEnabled
      undefined, // onCodeInterpreterResult
      undefined, // customBaseUrl
      false, // streamingEnabled
    );

    expect(onUsageData).toHaveBeenCalledWith(expect.not.objectContaining({ servedFromResponseCache: true }));
  });

  it("never flags a streaming response, even when the proxy reports a cache key", async () => {
    async function* mockStream() {
      yield {
        type: "response.completed",
        response: { id: "resp_stream", usage: { output_tokens: 2, input_tokens: 5, total_tokens: 7 } },
      };
    }
    mockResponsesCreate.mockResolvedValueOnce(mockStream());

    const onUsageData = vi.fn();

    await makeOpenAIResponsesRequest(
      messages,
      mockUpdateTextUI,
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

describe("responses_api custom headers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends custom headers alongside the tags header on the OpenAI client", async () => {
    mockResponsesCreate.mockReturnValueOnce(nonStreamingResponse({ id: "resp_1", output: [] }));

    await makeOpenAIResponsesRequest(
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
      false,
      undefined,
      { "anthropic-beta": "context-1m-2025-08-07" },
    );

    expect(vi.mocked(openai.OpenAI).mock.calls[0][0]).toMatchObject({
      defaultHeaders: { "x-litellm-tags": "team-a", "anthropic-beta": "context-1m-2025-08-07" },
    });
  });
});
