import { z } from "zod";

import { KeyResponse } from "../key_team_helpers/key_list";
import { extractLoggingSettings, formatMetadataForDisplay, stripTagsFromMetadata } from "../key_info_utils";
import { mapInternalToDisplayNames } from "../callback_info_helpers";
import { estimateChecks, estimateFields } from "./estimatedOutputTokens";
import { canonicalBudgetDuration, keyOrganizationId } from "./keyEditFieldNormalizers";
import { storedAllowedIps, withoutAllowedIps } from "./keyAllowedIps";
import { ipEntriesError } from "@/utils/ipAddress";

export interface KeyEditFormValues {
  key_alias?: string;
  models?: string[];
  allowed_routes?: string;
  max_budget?: number | string | null;
  soft_budget?: number | string | null;
  budget_duration?: string | null;
  tpm_limit?: number | string | null;
  tpm_limit_type?: string | null;
  rpm_limit?: number | string | null;
  rpm_limit_type?: string | null;
  tpd_limit?: number | string | null;
  throttle_on_budget_exceeded?: boolean;
  enable_prompt_caching?: boolean;
  max_parallel_requests?: number | string | null;
  model_tpm_limit?: string;
  model_rpm_limit?: string;
  default_estimated_output_tokens?: number | string | null;
  default_estimated_output_tokens_per_model?: string;
  tags?: string[];
  prompts?: string[];
  allowed_passthrough_routes?: string[];
  allowed_ips?: string[];
  organization_id?: string | null;
  team_id?: string | null;
  project_id?: string | null;
  logging_settings?: unknown[];
  metadata?: string;
  duration?: string | null;
  token?: string;
  disabled_callbacks?: string[];
  auto_rotate?: boolean;
  rotation_interval?: string;
}

const readMetadata = (keyData: KeyResponse, key: string): unknown =>
  keyData.metadata != null && typeof keyData.metadata === "object"
    ? (keyData.metadata as Record<string, unknown>)[key]
    : undefined;

export const toKeyEditFormValues = (keyData: KeyResponse): KeyEditFormValues => ({
  key_alias: keyData.key_alias,
  models: keyData.models,
  allowed_routes:
    Array.isArray(keyData.allowed_routes) && keyData.allowed_routes.length > 0 ? keyData.allowed_routes.join(", ") : "",
  max_budget: keyData.max_budget,
  soft_budget:
    (keyData.litellm_budget_table as { soft_budget?: number | null } | null | undefined)?.soft_budget ?? null,
  budget_duration: canonicalBudgetDuration(keyData.budget_duration),
  tpm_limit: keyData.tpm_limit,
  tpm_limit_type: (keyData as { tpm_limit_type?: string | null }).tpm_limit_type ?? null,
  rpm_limit: keyData.rpm_limit,
  rpm_limit_type: (keyData as { rpm_limit_type?: string | null }).rpm_limit_type ?? null,
  tpd_limit: keyData.tpd_limit,
  throttle_on_budget_exceeded: Boolean(readMetadata(keyData, "throttle_on_budget_exceeded")),
  enable_prompt_caching: Boolean(readMetadata(keyData, "enable_prompt_caching")),
  max_parallel_requests: keyData.max_parallel_requests,
  model_tpm_limit: (keyData as { model_tpm_limit?: string }).model_tpm_limit,
  model_rpm_limit: (keyData as { model_rpm_limit?: string }).model_rpm_limit,
  ...(estimateFields(keyData.metadata as Record<string, unknown> | null | undefined) as {
    default_estimated_output_tokens?: number | string | null;
    default_estimated_output_tokens_per_model?: string;
  }),
  tags: readMetadata(keyData, "tags") as string[] | undefined,
  prompts: readMetadata(keyData, "prompts") as string[] | undefined,
  allowed_passthrough_routes: (keyData as { allowed_passthrough_routes?: string[] }).allowed_passthrough_routes,
  allowed_ips: storedAllowedIps(keyData.metadata),
  organization_id: keyOrganizationId(keyData),
  team_id: keyData.team_id,
  project_id: keyData.project_id,
  logging_settings: extractLoggingSettings(keyData.metadata),
  metadata: formatMetadataForDisplay(withoutAllowedIps(stripTagsFromMetadata(keyData.metadata))),
  duration: (keyData as { duration?: string }).duration ?? "",
  token: keyData.token || keyData.token_id,
  disabled_callbacks: Array.isArray(readMetadata(keyData, "litellm_disabled_callbacks"))
    ? mapInternalToDisplayNames(readMetadata(keyData, "litellm_disabled_callbacks") as string[])
    : [],
  auto_rotate: keyData.auto_rotate || false,
  rotation_interval: keyData.rotation_interval,
});

export const keyEditFormSchema = z.object({
  key_alias: z.custom<string | undefined>().optional(),
  models: z.custom<string[] | undefined>().optional(),
  allowed_routes: z.custom<string | undefined>().optional(),
  max_budget: z.custom<number | string | null | undefined>().optional(),
  soft_budget: z.custom<number | string | null | undefined>().optional(),
  budget_duration: z.custom<string | null | undefined>().optional(),
  tpm_limit: z.custom<number | string | null | undefined>().optional(),
  tpm_limit_type: z.custom<string | null | undefined>().optional(),
  rpm_limit: z.custom<number | string | null | undefined>().optional(),
  rpm_limit_type: z.custom<string | null | undefined>().optional(),
  tpd_limit: z.custom<number | string | null | undefined>().optional(),
  throttle_on_budget_exceeded: z.custom<boolean | undefined>().optional(),
  enable_prompt_caching: z.custom<boolean | undefined>().optional(),
  max_parallel_requests: z.custom<number | string | null | undefined>().optional(),
  model_tpm_limit: z.custom<string | undefined>().optional(),
  model_rpm_limit: z.custom<string | undefined>().optional(),
  default_estimated_output_tokens: z
    .custom<number | string | null | undefined>()
    .refine(estimateChecks.positive.isValid, estimateChecks.positive.message)
    .optional(),
  default_estimated_output_tokens_per_model: z
    .custom<string | undefined>()
    .refine(estimateChecks.perModel.isValid, estimateChecks.perModel.message)
    .optional(),
  tags: z.custom<string[] | undefined>().optional(),
  prompts: z.custom<string[] | undefined>().optional(),
  allowed_passthrough_routes: z.custom<string[] | undefined>().optional(),
  allowed_ips: z
    .custom<string[] | undefined>()
    .superRefine((value, ctx) => {
      const message = ipEntriesError(value);
      if (message !== undefined) ctx.addIssue({ code: "custom", message });
    })
    .optional(),
  organization_id: z.custom<string | null | undefined>().optional(),
  team_id: z.custom<string | null | undefined>().optional(),
  project_id: z.string().nullable().optional(),
  logging_settings: z.custom<unknown[] | undefined>().optional(),
  metadata: z.custom<string | undefined>().optional(),
  duration: z.custom<string | null | undefined>().optional(),
  token: z.custom<string | undefined>().optional(),
  disabled_callbacks: z.custom<string[] | undefined>().optional(),
  auto_rotate: z.custom<boolean | undefined>().optional(),
  rotation_interval: z.custom<string | undefined>().optional(),
});

export interface MountedFieldGates {
  canViewPrompts: boolean;
}

export const toSubmittedValues = (
  values: KeyEditFormValues,
  { canViewPrompts }: MountedFieldGates,
): Record<string, unknown> => ({
  key_alias: values.key_alias,
  models: values.models,
  allowed_routes: values.allowed_routes,
  max_budget: values.max_budget,
  soft_budget: values.soft_budget,
  budget_duration: values.budget_duration,
  tpm_limit: values.tpm_limit,
  tpm_limit_type: values.tpm_limit_type,
  rpm_limit: values.rpm_limit,
  rpm_limit_type: values.rpm_limit_type,
  tpd_limit: values.tpd_limit,
  throttle_on_budget_exceeded: values.throttle_on_budget_exceeded,
  enable_prompt_caching: values.enable_prompt_caching,
  max_parallel_requests: values.max_parallel_requests,
  model_tpm_limit: values.model_tpm_limit,
  model_rpm_limit: values.model_rpm_limit,
  default_estimated_output_tokens: values.default_estimated_output_tokens,
  default_estimated_output_tokens_per_model: values.default_estimated_output_tokens_per_model,
  tags: values.tags,
  ...(canViewPrompts ? { prompts: values.prompts } : {}),
  allowed_passthrough_routes: values.allowed_passthrough_routes,
  allowed_ips: values.allowed_ips,
  organization_id: values.organization_id,
  team_id: values.team_id,
  logging_settings: values.logging_settings,
  metadata: values.metadata,
  ...(typeof values.duration === "string" && values.duration.trim() === "" ? {} : { duration: values.duration }),
  token: values.token,
  disabled_callbacks: values.disabled_callbacks,
  auto_rotate: values.auto_rotate,
  rotation_interval: values.rotation_interval,
});
