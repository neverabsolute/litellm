import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders as render, testQueryClient } from "@/../tests/test-utils";
import { makeOpenAIChatCompletionRequest } from "@/components/llm_calls/chat_completion";
import { fetchAvailableModels } from "@/components/llm_calls/fetch_models";
import { makeOpenAIResponsesRequest } from "@/components/llm_calls/responses_api";
import { tagListCall } from "@/components/networking";
import { setSecureItem } from "@/utils/secureStorage";
import { PlaygroundChat } from "./PlaygroundChat";

vi.mock("@/components/llm_calls/fetch_models", () => ({ fetchAvailableModels: vi.fn() }));

vi.mock("@/components/llm_calls/chat_completion", () => ({ makeOpenAIChatCompletionRequest: vi.fn() }));

vi.mock("@/components/llm_calls/responses_api", () => ({ makeOpenAIResponsesRequest: vi.fn() }));

vi.mock("@/components/networking", () => ({
  tagListCall: vi.fn().mockResolvedValue({}),
  getGatewayBaseUrl: () => "http://gateway.test",
  getGlobalLitellmHeaderName: () => "Authorization",
}));

const chatRequest = vi.mocked(makeOpenAIChatCompletionRequest);

const responsesRequest = vi.mocked(makeOpenAIResponsesRequest);

type ChatArgs = Parameters<typeof makeOpenAIChatCompletionRequest>;

type ResponsesArgs = Parameters<typeof makeOpenAIResponsesRequest>;

const sentMessages = (call: number) => (chatRequest.mock.calls[call] as ChatArgs)[0];

const replyWith =
  (text: string) =>
  async (...args: ChatArgs) => {
    args[1](text, args[2]);
  };

const preload = (values: Readonly<Record<string, string>>) =>
  Object.entries(values).forEach(([key, value]) => sessionStorage.setItem(key, value));

const deferred = () => {
  const control: { release: () => void } = { release: () => undefined };
  const promise = new Promise<void>((resolve) => {
    control.release = resolve;
  });
  return { promise, release: () => control.release() };
};

const settled = () => waitFor(() => expect(testQueryClient.isFetching()).toBe(0));

const renderChat = () =>
  render(<PlaygroundChat accessToken="session-token" disabledPersonalKeyCreation={false} proxySettings={undefined} />);

const send = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByRole("textbox", { name: "Message" }), text);
  await user.click(screen.getByRole("button", { name: "Send message" }));
};

describe("PlaygroundChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    testQueryClient.clear();
    Element.prototype.scrollIntoView = vi.fn();
    chatRequest.mockReset();
    responsesRequest.mockReset();
    vi.mocked(fetchAvailableModels).mockResolvedValue([
      { model_group: "gpt-fast", mode: "chat", providers: ["openai"] },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the chosen model with the session key", async () => {
    const user = userEvent.setup();
    chatRequest.mockImplementation(replyWith("Hi there"));
    renderChat();

    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "gpt-fast" }));
    await send(user, "hello");

    expect(await screen.findByText("Hi there")).toBeInTheDocument();
    const [messages, , model, apiKey] = chatRequest.mock.calls[0] as ChatArgs;
    expect(messages).toEqual([{ role: "user", content: "hello" }]);
    expect(model).toBe("gpt-fast");
    expect(apiKey).toBe("session-token");
  });

  it("keeps answered turns in the history but never resends a failed one", async () => {
    const user = userEvent.setup();
    chatRequest
      .mockImplementationOnce(replyWith("Hi there"))
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockImplementationOnce(replyWith("Back again"));
    renderChat();

    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "gpt-fast" }));
    await send(user, "hello");
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
    await send(user, "this one fails");
    expect(await screen.findByText("The request failed")).toBeInTheDocument();
    await send(user, "try again");

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(3));
    expect(sentMessages(2)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "try again" },
    ]);
  });

  it("sends every saved request setting with the chat request", async () => {
    const user = userEvent.setup();
    chatRequest.mockImplementation(replyWith("Hi there"));
    preload({
      selectedModel: "gpt-fast",
      selectedTags: JSON.stringify(["team-a"]),
      streamingEnabled: "false",
    });
    setSecureItem("customHeaders", JSON.stringify([["x-team", "blue"]]));
    renderChat();

    await send(user, "hello");

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(1));
    const args = chatRequest.mock.calls[0] as ChatArgs;
    expect(args[2]).toBe("gpt-fast");
    expect(args[4]).toEqual(["team-a"]);
    expect(args[16]).toBe(false);
    expect(args[17]).toMatchObject({ "x-team": "blue" });
  });

  it("sends a custom model and tag that are prefixes of listed ones", async () => {
    const user = userEvent.setup();
    chatRequest.mockImplementation(replyWith("Hi there"));
    vi.mocked(tagListCall).mockResolvedValueOnce({
      production: { name: "production", models: [], created_at: "", updated_at: "" },
    });
    renderChat();

    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.type(await screen.findByPlaceholderText("Search models"), "gpt-f");
    await user.click(await screen.findByRole("option", { name: "Use gpt-f" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.type(await screen.findByLabelText("Tags"), "prod");
    await user.click(await screen.findByRole("option", { name: "Add prod" }));
    await send(user, "hello");

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(1));
    const args = chatRequest.mock.calls[0] as ChatArgs;
    expect(args[2]).toBe("gpt-f");
    expect(args[4]).toEqual(["prod"]);
  });

  it("sends a temperature typed with two decimals", async () => {
    const user = userEvent.setup();
    chatRequest.mockImplementation(replyWith("Hi there"));
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Advanced" }));
    await user.type(screen.getByLabelText("Temperature value"), "0.05");
    await user.keyboard("{Escape}");
    await send(user, "hello");

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(1));
    expect((chatRequest.mock.calls[0] as ChatArgs)[11]).toBe(0.05);
  });

  it("drops a saved model that the current key cannot use", async () => {
    const user = userEvent.setup();
    chatRequest.mockImplementation(replyWith("Hi there"));
    preload({ selectedModel: "retired-model" });
    renderChat();

    await waitFor(() => expect(fetchAvailableModels).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Select a model"));
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "gpt-fast" }));
    await send(user, "hello");

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(1));
    expect((chatRequest.mock.calls[0] as ChatArgs)[2]).toBe("gpt-fast");
  });

  it("drops a saved model that is missing from an already loaded model list", async () => {
    const first = renderChat();
    await waitFor(() => expect(fetchAvailableModels).toHaveBeenCalled());
    await settled();
    first.unmount();
    sessionStorage.setItem("selectedModel", "retired-model");

    renderChat();

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Select a model"));
    expect(fetchAvailableModels).toHaveBeenCalledTimes(1);
  });

  it("drops a request that is still running when a new chat starts", async () => {
    const user = userEvent.setup();
    const first = deferred();
    chatRequest.mockImplementationOnce(async (...args: ChatArgs) => {
      await first.promise;
      args[1]("late reply", args[2]);
    });
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    await send(user, "first");
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await act(async () => {
      first.release();
      await chatRequest.mock.results[0]?.value;
    });

    expect(chatRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByText("late reply")).not.toBeInTheDocument();
  });

  it("keeps a stopped request's response id out of the next request", async () => {
    const user = userEvent.setup();
    const first = deferred();
    responsesRequest
      .mockImplementationOnce(async (...args: ResponsesArgs) => {
        await first.promise;
        args[11]?.("resp-stopped");
      })
      .mockImplementationOnce(async (...args: ResponsesArgs) => {
        args[11]?.("resp-fresh");
        args[1]("assistant", "fresh reply", args[2]);
      })
      .mockImplementationOnce(async (...args: ResponsesArgs) => {
        args[1]("assistant", "third reply", args[2]);
      });
    preload({ endpointType: "responses", selectedModel: "gpt-fast", useApiSessionManagement: "true" });
    renderChat();

    await send(user, "first");
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await send(user, "second");
    expect(await screen.findByText("fresh reply")).toBeInTheDocument();
    await act(async () => {
      first.release();
      await responsesRequest.mock.results[0]?.value;
    });
    await send(user, "third");

    await waitFor(() => expect(responsesRequest).toHaveBeenCalledTimes(3));
    expect((responsesRequest.mock.calls[2] as ResponsesArgs)[10]).toBe("resp-fresh");
  });

  it("ignores a stopped request that finishes after a newer one started", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    chatRequest
      .mockImplementationOnce(async (...args: ChatArgs) => {
        await first.promise;
        args[1]("late reply", args[2]);
      })
      .mockImplementationOnce(async (...args: ChatArgs) => {
        await second.promise;
        args[1]("fresh reply", args[2]);
      });
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    await send(user, "first");
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await send(user, "second");
    first.release();

    await waitFor(() => expect(chatRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByText("late reply")).not.toBeInTheDocument();
    second.release();
    expect(await screen.findByText("fresh reply")).toBeInTheDocument();
    expect(screen.queryByText("late reply")).not.toBeInTheDocument();
  });

  it("keeps a stopped request's gateway details off the newer reply", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const first = deferred();
    chatRequest
      .mockImplementationOnce(async (...args: ChatArgs) => {
        args[18]?.(new Headers({ "x-litellm-call-id": "call-stopped" }));
        await first.promise;
      })
      .mockImplementationOnce(async (...args: ChatArgs) => {
        args[18]?.(new Headers({ "x-litellm-call-id": "call-fresh" }));
        args[1]("fresh reply", args[2]);
      });
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    await send(user, "first");
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await send(user, "second");
    expect(await screen.findByText("call-fresh")).toBeInTheDocument();
    await act(async () => {
      first.release();
      await chatRequest.mock.results[0]?.value;
    });

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByText("call-fresh")).toBeInTheDocument();
    expect(screen.queryByText("call-stopped")).not.toBeInTheDocument();
  });

  it("sends once when Enter is pressed twice before the first request starts", async () => {
    const user = userEvent.setup();
    const first = deferred();
    chatRequest.mockImplementation(async (...args: ChatArgs) => {
      await first.promise;
      args[1]("Hi there", args[2]);
    });
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    const message = screen.getByRole("textbox", { name: "Message" });
    await user.type(message, "hello");
    fireEvent.keyDown(message, { key: "Enter" });
    fireEvent.keyDown(message, { key: "Enter" });

    await waitFor(() => expect(chatRequest).toHaveBeenCalled());
    await act(async () => {
      first.release();
      await chatRequest.mock.results[0]?.value;
    });
    expect(chatRequest).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("hello")).toHaveLength(1);
  });

  it("drops a chat attachment when the endpoint cannot use it", async () => {
    const user = userEvent.setup();
    preload({ selectedModel: "gpt-fast" });
    renderChat();

    fireEvent.drop(screen.getByRole("textbox", { name: "Message" }), {
      dataTransfer: { files: [new File(["%PDF"], "notes.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByRole("button", { name: "Remove notes.pdf" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Endpoint" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "/v1/audio/transcriptions" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Endpoint" })).toHaveTextContent("audio/transcriptions"),
    );
    expect(screen.queryByRole("button", { name: "Remove notes.pdf" })).not.toBeInTheDocument();
  });

  it("keeps a stopped request's code output off the newer reply", async () => {
    const user = userEvent.setup();
    const first = deferred();
    responsesRequest
      .mockImplementationOnce(async (...args: ResponsesArgs) => {
        await first.promise;
        args[13]?.({ code: "print('stopped run')", containerId: "c-1", annotations: [] });
      })
      .mockImplementationOnce(async (...args: ResponsesArgs) => {
        args[1]("assistant", "fresh reply", args[2]);
      });
    preload({ endpointType: "responses", selectedModel: "gpt-fast" });
    renderChat();

    await send(user, "first");
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await send(user, "second");
    expect(await screen.findByText("fresh reply")).toBeInTheDocument();
    await act(async () => {
      first.release();
      await responsesRequest.mock.results[0]?.value;
    });

    expect(screen.queryByText("Python Code Executed")).not.toBeInTheDocument();
  });
});
