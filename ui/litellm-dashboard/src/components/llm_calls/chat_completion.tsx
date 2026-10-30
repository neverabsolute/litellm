import { ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { TokenUsage } from "../chat_ui/ResponseMetrics";
import { extractPromptCacheTokens } from "@/utils/promptCacheUsage";
import { parseUsageCost } from "./usage_cost";
import { buildPlaygroundHeaders, type CustomHeaders } from "./request_headers";
import { createGatewayClient } from "./gateway_client";
import { observeResponseHeaders, type ResponseHeadersListener } from "@/lib/http/observeResponseHeaders";

const completionAsSingleChunk = (completion: ChatCompletion): ChatCompletionChunk =>
  ({
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
    usage: completion.usage,
    choices: [
      {
        index: 0,
        finish_reason: completion.choices[0]?.finish_reason ?? null,
        delta: completion.choices[0]?.message ?? {},
      },
    ],
  }) as unknown as ChatCompletionChunk;

export async function makeOpenAIChatCompletionRequest(
  chatHistory: { role: string; content: string | any[] }[],
  updateUI: (chunk: string, model?: string) => void,
  selectedModel: string,
  accessToken: string,
  tags?: string[],
  signal?: AbortSignal,
  onReasoningContent?: (content: string) => void,
  onTimingData?: (timeToFirstToken: number) => void,
  onUsageData?: (usage: TokenUsage) => void,
  traceId?: string,
  onImageGenerated?: (imageUrl: string, model?: string) => void,
  temperature?: number,
  max_tokens?: number,
  onTotalLatency?: (latency: number) => void,
  customBaseUrl?: string,
  mockTestFallbacks?: boolean,
  streamingEnabled: boolean = true,
  customHeaders?: CustomHeaders,
  onResponseHeaders?: ResponseHeadersListener,
) {
  // base url should be the current base_url
  const isLocal = process.env.NODE_ENV === "development";
  if (isLocal !== true) {
    console.log = function () {};
  }
  const headers = buildPlaygroundHeaders(tags, customHeaders);

  const clientOptions = {
    accessToken,
    baseURL: customBaseUrl,
    defaultHeaders: headers,
    ...(onResponseHeaders ? { fetch: observeResponseHeaders(onResponseHeaders) } : {}),
  };
  const client = createGatewayClient(clientOptions);

  try {
    const startTime = Date.now();
    let firstTokenReceived = false;
    let timeToFirstToken: number | undefined = undefined;
    let servedFromResponseCache = false;

    const requestBody = {
      model: selectedModel,
      litellm_trace_id: traceId,
      messages: chatHistory as ChatCompletionMessageParam[],
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens !== undefined ? { max_tokens } : {}),
      ...(mockTestFallbacks ? { mock_testing_fallbacks: true } : {}),
    };

    const response: AsyncIterable<ChatCompletionChunk> | ChatCompletionChunk[] = streamingEnabled
      ? await client.chat.completions.create(
          { ...requestBody, stream: true, stream_options: { include_usage: true } },
          { signal },
        )
      : await (async () => {
          const nonStreamingResponse = await client.chat.completions
            .create({ ...requestBody, stream: false }, { signal })
            .withResponse();
          servedFromResponseCache = nonStreamingResponse.response.headers.get("x-litellm-cache-key") !== null;
          return [completionAsSingleChunk(nonStreamingResponse.data)];
        })();

    for await (const chunk of response) {
      // Process content and measure time to first token
      const delta = chunk.choices[0]?.delta as any;

      // Debug what's in the delta

      // Measure time to first token for either content or reasoning_content
      if (!firstTokenReceived && (chunk.choices[0]?.delta?.content || (delta && delta.reasoning_content))) {
        firstTokenReceived = true;
        timeToFirstToken = Date.now() - startTime;
        if (onTimingData && streamingEnabled) {
          onTimingData(timeToFirstToken);
        }
      }

      // Process content
      if (chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        updateUI(content, chunk.model);
      }

      // Process image generation if present
      if (delta && delta.image && onImageGenerated) {
        onImageGenerated(delta.image.url, chunk.model);
      }

      // Process reasoning content if present - using type assertion
      if (delta && delta.reasoning_content) {
        const reasoningContent = delta.reasoning_content;
        if (onReasoningContent) {
          onReasoningContent(reasoningContent);
        }
      }

      // Check for usage data using type assertion
      const chunkWithUsage = chunk as any;
      if (chunkWithUsage.usage && onUsageData) {
        const usageData: TokenUsage = {
          completionTokens: chunkWithUsage.usage.completion_tokens,
          promptTokens: chunkWithUsage.usage.prompt_tokens,
          totalTokens: chunkWithUsage.usage.total_tokens,
          ...extractPromptCacheTokens(chunkWithUsage.usage),
          ...(servedFromResponseCache ? { servedFromResponseCache: true } : {}),
        };

        // Check for reasoning tokens
        if (chunkWithUsage.usage.completion_tokens_details?.reasoning_tokens) {
          usageData.reasoningTokens = chunkWithUsage.usage.completion_tokens_details.reasoning_tokens;
        }

        const parsedCost = parseUsageCost(chunkWithUsage.usage.cost);
        if (parsedCost !== undefined) {
          usageData.cost = parsedCost;
        }

        onUsageData(usageData);
      }
    }

    const endTime = Date.now();
    const totalLatency = endTime - startTime;
    if (onTotalLatency) {
      onTotalLatency(totalLatency);
    }
  } catch (error) {
    throw error; // Re-throw to allow the caller to handle the error
  }
}
