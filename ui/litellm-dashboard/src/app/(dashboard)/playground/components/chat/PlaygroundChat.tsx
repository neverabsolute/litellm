"use client";

import { useState } from "react";
import { ChevronDown, PanelRight, RotateCcw, SquarePen } from "lucide-react";
import { generateCodeSnippet } from "@/components/chat_ui/CodeSnippets";
import { EndpointType, getEndpointType } from "@/components/chat_ui/mode_endpoint_mapping";
import type { MessageType } from "@/components/chat_ui/types";
import type { ModelGroup } from "@/components/llm_calls/fetch_models";
import { customHeadersFromPairs } from "@/components/llm_calls/request_headers";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import { useChatHistory } from "../../hooks/useChatHistory";
import { useCodeInterpreter } from "../../hooks/useCodeInterpreter";
import { filterModelsForEndpoint, isModelCompatibleWithEndpoint } from "../chat_ui/EndpointUtils";
import RealtimePlayground from "../chat_ui/RealtimePlayground";
import { Composer } from "./Composer";
import { EndpointMenu, VoiceMenu } from "./ComposerControls";
import { Conversation, formatCost } from "./Conversation";
import { capabilitiesFor, CODE_INTERPRETER_SUGGESTIONS, SUGGESTIONS } from "./endpointCapabilities";
import { InspectorPanel, type CodeSdk } from "./Inspector";
import { TargetPicker, type OptionGroup } from "./Pickers";
import { withEndpoint } from "./playgroundSettings";
import { SettingsPopover } from "./SettingsPopover";
import { usePlaygroundModels, useTagOptions } from "./usePlaygroundCatalog";
import { usePlaygroundSend, type SendDeps } from "./usePlaygroundSend";
import { usePlaygroundSettings } from "./usePlaygroundSettings";
import { useIsWide } from "./useIsWide";

export type ProxySettings = Readonly<{ PROXY_BASE_URL?: string; LITELLM_UI_API_DOC_BASE_URL?: string | null }>;

const providerOf = (model: ModelGroup): string => model.providers?.[0] ?? "other";

const modelGroups = (models: readonly ModelGroup[]): readonly OptionGroup[] =>
  [...new Set(models.map(providerOf))].sort().map((provider) => ({
    label: provider,
    options: models
      .filter((model) => providerOf(model) === provider)
      .map((model) => ({ value: model.model_group, label: model.model_group })),
  }));

const modelEmptyText = (failed: boolean, hasKey: boolean): string => {
  if (failed) return "Unable to load models for this key";
  if (!hasKey) return "Enter a virtual key to load models";
  return "No models available for this endpoint";
};

const lastTracedReply = (messages: readonly MessageType[]): number =>
  messages.findLastIndex((message) => message.role === "assistant" && message.trace !== undefined);

const totalCost = (messages: readonly MessageType[]): number =>
  messages.reduce((sum, message) => sum + (message.usage?.cost ?? message.trace?.cost ?? 0), 0);

const conversationSummary = (messages: readonly MessageType[]): string => {
  const requests = messages.filter((message) => message.role === "user").length;
  if (requests === 0) return "New chat";
  const label = requests === 1 ? "1 request" : `${requests} requests`;
  const cost = totalCost(messages);
  return cost > 0 ? `${label}, ${formatCost(cost)}` : label;
};

export function PlaygroundChat({
  accessToken,
  disabledPersonalKeyCreation,
  proxySettings,
}: {
  accessToken: string | null;
  disabledPersonalKeyCreation: boolean;
  proxySettings: ProxySettings | undefined;
}) {
  const { settings, update, reset } = usePlaygroundSettings(disabledPersonalKeyCreation);
  const apiKey = (settings.keySource === "session" ? accessToken : settings.virtualKey.trim()) || null;
  const capabilities = capabilitiesFor(settings.endpoint);
  const chat = useChatHistory({ simplified: false });
  const codeInterpreter = useCodeInterpreter();
  const [inspected, setInspected] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isWide = useIsWide();

  const models = usePlaygroundModels(apiKey);
  const [checkedModels, setCheckedModels] = useState<readonly ModelGroup[] | undefined>(undefined);
  if (models.data && models.data !== checkedModels) {
    setCheckedModels(models.data);
    const loaded = models.data;
    update((current) =>
      current.model && !loaded.some((option) => option.model_group === current.model)
        ? { ...current, model: null }
        : current,
    );
  }
  const tags = useTagOptions(accessToken);

  const customHeaders = customHeadersFromPairs(settings.headerPairs);

  const sendDeps: SendDeps = {
    settings,
    capabilities,
    apiKey,
    signedIn: Boolean(accessToken),
    customHeaders,
    chat,
    codeInterpreter,
  };
  const draft = usePlaygroundSend(sendDeps);

  const messages = chat.chatHistory;
  const inspectedIndex = inspected ?? lastTracedReply(messages);
  const inspectedMessage = inspectedIndex >= 0 ? messages[inspectedIndex] ?? null : null;
  const modelList = models.data ?? [];

  const selectModel = (model: string) => {
    const info = modelList.find((option) => option.model_group === model);
    const switchTo =
      info?.mode && !isModelCompatibleWithEndpoint(info, settings.endpoint) ? getEndpointType(info.mode) : null;
    update((current) => ({ ...(switchTo ? withEndpoint(current, switchTo) : current), model }));
  };

  const inspect = (index: number) => {
    setInspected(index);
    if (!isWide) setSheetOpen(true);
  };

  const clearChat = () => {
    chat.clearChatHistory();
    draft.clearDraft();
    codeInterpreter.clearResult();
    setInspected(null);
  };

  const newChat = () => {
    clearChat();
    toast.success("Chat history cleared.");
  };

  const resetAll = () => {
    clearChat();
    reset();
    toast.success("Chat and settings reset");
  };

  const code = (sdk: CodeSdk): string => {
    const snippet: Parameters<typeof generateCodeSnippet>[0] = {
      apiKeySource: "custom",
      accessToken: null,
      apiKey: "",
      inputMessage: draft.text,
      chatHistory: messages,
      selectedTags: [...settings.tags],
      endpointType: settings.endpoint,
      selectedModel: settings.model ?? undefined,
      selectedSdk: sdk,
      selectedVoice: settings.voice,
      proxySettings,
      customHeaders,
    };
    return generateCodeSnippet(snippet);
  };

  const targetRow = (
    <>
      <TargetPicker
        label="Model"
        placeholder="Select a model"
        groups={modelGroups(filterModelsForEndpoint([...modelList], settings.endpoint))}
        value={settings.model}
        onValueChange={selectModel}
        isLoading={models.isLoading}
        emptyText={modelEmptyText(models.isError, Boolean(apiKey))}
        allowCustom
      />
      <EndpointMenu
        value={settings.endpoint}
        onValueChange={(endpoint) => update((current) => withEndpoint(current, endpoint))}
      />
      {capabilities.voice && <VoiceMenu value={settings.voice} onValueChange={(voice) => update({ voice })} />}
    </>
  );

  const composer = (
    <Composer
      capabilities={capabilities}
      endpoint={settings.endpoint}
      targetRow={targetRow}
      draft={draft}
      codeInterpreter={{ enabled: codeInterpreter.enabled, onToggle: codeInterpreter.setEnabled }}
      settingsControl={
        <SettingsPopover
          settings={settings}
          update={update}
          capabilities={capabilities}
          keysDisabled={disabledPersonalKeyCreation}
          tagOptions={tags.data ?? []}
          suggestedBaseUrl={proxySettings?.LITELLM_UI_API_DOC_BASE_URL ?? proxySettings?.PROXY_BASE_URL ?? null}
          sessions={{
            enabled: chat.useApiSessionManagement,
            responseId: chat.responsesSessionId,
            onToggle: chat.handleToggleSessionManagement,
          }}
        />
      }
      sendDisabled={draft.isLoading}
    />
  );

  const suggestions =
    settings.endpoint === EndpointType.RESPONSES && codeInterpreter.enabled
      ? CODE_INTERPRETER_SUGGESTIONS
      : SUGGESTIONS[settings.endpoint] ?? [];

  const inspector = <InspectorPanel message={inspectedMessage} code={code} />;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="text-xs text-muted-foreground tabular-nums">{conversationSummary(messages)}</span>
          <span className="ml-auto flex items-center gap-2">
            {!isWide && (
              <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
                <PanelRight />
                Inspector
              </Button>
            )}
            <ButtonGroup>
              <Button variant="outline" size="sm" onClick={newChat}>
                <SquarePen />
                New chat
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon-sm" aria-label="More chat actions" />}
                >
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onClick={newChat}>
                    <SquarePen />
                    New chat, keep settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={resetAll}>
                    <RotateCcw />
                    Reset chat and settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </span>
        </div>
        {settings.endpoint === EndpointType.REALTIME ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <RealtimePlayground
              accessToken={apiKey ?? ""}
              selectedModel={settings.model ?? ""}
              customProxyBaseUrl={settings.proxyBaseUrl || undefined}
            />
          </div>
        ) : (
          <Conversation
            messages={messages}
            isLoading={draft.isLoading}
            waitingFor={messages.at(-1)?.model}
            extras={{
              endpoint: settings.endpoint,
              codeInterpreter: codeInterpreter.result,
              accessToken: apiKey ?? "",
            }}
            inspectedIndex={inspectedIndex}
            onInspect={inspect}
            suggestions={suggestions}
            onPickSuggestion={draft.setText}
          />
        )}
        <div className="mx-auto w-full max-w-3xl px-6 pb-6">{composer}</div>
      </div>
      {isWide ? (
        <aside aria-label="Inspector" className="flex w-96 shrink-0 flex-col border-l border-border">
          {inspector}
        </aside>
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-96 gap-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Inspector</SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
