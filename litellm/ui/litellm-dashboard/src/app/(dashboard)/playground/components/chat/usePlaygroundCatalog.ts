import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { fetchAvailableModels, type ModelGroup } from "@/components/llm_calls/fetch_models";
import { tagListCall } from "@/components/networking";
import type { Tag } from "@/components/tag_management/types";

export type PickerOption = Readonly<{ value: string; label: string; description?: string }>;

export function usePlaygroundModels(requestKey: string | null) {
  const options = {
    queryKey: ["playground", "models", requestKey],
    queryFn: (): Promise<readonly ModelGroup[]> => fetchAvailableModels(requestKey ?? ""),
    enabled: Boolean(requestKey),
    retry: false,
  } satisfies UseQueryOptions<readonly ModelGroup[]>;
  return useQuery(options);
}

export function useTagOptions(uiToken: string | null) {
  return useQuery<readonly string[]>({
    queryKey: ["playground", "tags", uiToken],
    queryFn: async () => {
      const response: Record<string, Tag> = await tagListCall(uiToken ?? "");
      return Object.values(response).map((tag) => tag.name);
    },
    enabled: Boolean(uiToken),
  });
}
