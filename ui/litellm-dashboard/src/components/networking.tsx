// Shared date formatter for daily activity endpoints
export const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getCallbackConfigsCall = async (accessToken: string) => {
  /**
   * Get callback configuration metadata (logos, params, etc.)
   */
  try {
    return await apiClient.get(`/callbacks/configs`, { accessToken });
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const getAutoRouterClassifierDefaultPromptCall = async (
  accessToken: string,
  contextWindowSize: number,
  tierLabels?: Record<string, string>,
  classificationRubric?: string,
): Promise<string> => {
  /**
   * Get the built-in system prompt an auto-router's LLM classifier uses when none is configured,
   * so the prompt editor prefills what the proxy actually sends rather than a frontend copy.
   *
   * tierLabels names the rubric's tier bullets, so a router that renamed its tiers prefills the
   * rubric it sends rather than one using the canonical names. rubric selects which calibration
   * examples it carries, for the same reason.
   */
  try {
    const response = await apiClient.get<{ system_prompt: string }>(`/auto_router/classifier/default_prompt`, {
      accessToken,
      query: {
        context_window_size: contextWindowSize,
        ...(tierLabels && Object.keys(tierLabels).length > 0 ? { tier_labels: JSON.stringify(tierLabels) } : {}),
        ...(classificationRubric ? { classification_rubric: classificationRubric } : {}),
      },
    });
    return response.system_prompt;
  } catch (error) {
    console.error("Failed to get the default classifier prompt:", error);
    throw error;
  }
};

export type AssembledPromptTierSource =
  | { tierDefinitions: { name: string; description?: string }[] }
  | { tierLabels?: Record<string, string>; classificationRubric?: string };

export const getAutoRouterAssembledPromptCall = async (
  accessToken: string,
  contextWindowSize: number,
  source: AssembledPromptTierSource,
  sections: { classificationPrompt?: string; classificationExamples?: string } = {},
): Promise<string> => {
  const { classificationPrompt, classificationExamples } = sections;
  /**
   * Assembled by the proxy, because tier criteria live only in the backend: a built-in tier name
   * with no description inherits them, and the built-in rubric derives its bullets from them.
   * POSTed so the operator's prompt does not reach access logs through a URL.
   */
  const response = await apiClient.post<{ system_prompt: string }>(`/auto_router/classifier/default_prompt`, {
    accessToken,
    body: {
      context_window_size: contextWindowSize,
      ...("tierDefinitions" in source
        ? { tier_definitions: source.tierDefinitions }
        : {
            ...(source.tierLabels && Object.keys(source.tierLabels).length > 0
              ? { tier_labels: source.tierLabels }
              : {}),
            ...(source.classificationRubric ? { classification_rubric: source.classificationRubric } : {}),
          }),
      ...(classificationPrompt?.trim() ? { classification_prompt: classificationPrompt } : {}),
      ...(classificationExamples?.trim() ? { classification_examples: classificationExamples } : {}),
    },
  });
  return response.system_prompt;
};

/**
 * Helper file for calls being made to proxy
 */
import { toast } from "@/lib/toast";
import { clearTokenCookies, getCookie, storeLoginToken } from "@/utils/cookieUtils";
import { decodeToken } from "@/utils/jwtUtils";
import { normalizeBackendPageUrlToUiOrigin } from "@/utils/returnUrlUtils";
import { TagNewRequest, TagUpdateRequest, TagListResponse, TagInfoResponse } from "./tag_management/types";
import { Team } from "./key_team_helpers/key_list";
import { EmailEventSettingsResponse, EmailEventSettingsUpdateRequest } from "./email_events/types";
import type { ModelBudgetUsage, ModelMaxBudget } from "./key_team_helpers/ModelMaxBudgetEditor";
import type { StoredModelMaxBudget } from "./key_team_helpers/modelMaxBudgetPayload";
import type { ObjectPermission } from "./object_permission_types";
import type { components } from "@/lib/http/schema";
import { fetchClient } from "@/lib/http/api";
import { jsonFields } from "./common_components/check_openapi_schema";

import type {
  CoordinationRedisSettings,
  CoordinationRedisSettingsResponse,
  CoordinationRedisTestResponse,
} from "@/app/(dashboard)/caching/_components/coordination_redis_settings/types";
import type { ComplexityRouterConfigPayload } from "./add_model/build_complexity_router_config";
import type { AutoRouterPresetsResponse } from "@/lib/autorouter_presets";
import type {
  SubscriptionAccountCreateRequest,
  SubscriptionAccountDeleteRequest,
  SubscriptionAccountUpdateRequest,
  SubscriptionFee,
  SubscriptionUsageResponse,
} from "@/app/(dashboard)/usage/_components/components/SubscriptionCost/types";
import type { RoutingDecision } from "./logs/detail/RoutingDecisionCard";

import {
  createApiClient,
  deriveErrorMessage,
  extractProxyErrorMessage,
  unwrapProxyErrorMessage,
  type QueryParams,
} from "@/lib/http/client";
import type {
  CacheLeakageKeysResponse,
  DailyActivityAggregatedResponse,
  DailyActivityEntity,
  DailyActivityKeyPageResponse,
  DailyActivityKeySearchResponse,
  DailyActivityRequest,
  DailyActivityUserPageResponse,
  ExportFormat,
  ExportType,
  ModelTopKeysResponse,
} from "./UsagePage/dailyActivityApi";
import { resolveApiBase } from "@/lib/http/resolveApiBase";
import {
  registerAuthHeaderNameGetter,
  registerAuthTokenGetter,
  registerBaseUrlGetter,
  registerErrorHandler,
} from "@/lib/http/runtime";
import { serverRootPath, setServerRootPath } from "@/lib/serverRootPath";

export { serverRootPath };

export { deriveErrorMessage };

const isLocal = process.env.NODE_ENV === "development";
// In dev, if NEXT_PUBLIC_USE_REWRITES=true the Next.js dev server proxies API calls
// to the backend — use relative URLs (null) so rewrites can intercept them.
const resolveDefaultBase = (fallback: string | null): string | null =>
  process.env.NEXT_PUBLIC_BASE_URL
    ? process.env.NEXT_PUBLIC_BASE_URL
    : isLocal && process.env.NEXT_PUBLIC_USE_REWRITES !== "true"
      ? "http://localhost:4000"
      : fallback;
const defaultProxyBaseUrl = resolveDefaultBase(null);
const WORKER_URL_KEY = "litellm_worker_url";
// If a worker URL is in localStorage, use it as the initial proxyBaseUrl.
// This survives page navigation.
const _rawWorkerUrl = typeof window !== "undefined" ? window.localStorage.getItem(WORKER_URL_KEY) : null;
// Validate stored worker URL — reject non-HTTP schemes to prevent exfiltration
const _initialWorkerUrl = (() => {
  if (!_rawWorkerUrl) return null;
  try {
    const parsed = new URL(_rawWorkerUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return _rawWorkerUrl;
  } catch {
    /* invalid URL */
  }
  // Invalid URL in storage — clear it
  if (typeof window !== "undefined") window.localStorage.removeItem(WORKER_URL_KEY);
  return null;
})();
export let proxyBaseUrl: string | null = _initialWorkerUrl ?? defaultProxyBaseUrl;
let discoveredProxyBaseUrl: string | null = defaultProxyBaseUrl;
let gatewayBaseUrl: string | null = null;
let runtimeBackendBaseUrl: string | null = null;
if (isLocal != true) {
  console.log = function () {};
}

const getWindowLocation = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.location;
};

const updateProxyBaseUrl = (serverRootPath: string, receivedProxyBaseUrl: string | null = null) => {
  /**
   * Special function for updating the proxy base url. Should only be called by getUiConfig.
   */
  const resolvedProxyBaseUrl = resolveApiBase({
    explicitBase: receivedProxyBaseUrl || resolveDefaultBase(getWindowLocation()?.origin ?? null),
    serverRootPath,
  });
  discoveredProxyBaseUrl = resolvedProxyBaseUrl || null;
  if (typeof window !== "undefined" && window.localStorage.getItem(WORKER_URL_KEY)) return;
  proxyBaseUrl = resolvedProxyBaseUrl;
};

const updateServerRootPath = (receivedServerRootPath: string) => {
  setServerRootPath(receivedServerRootPath);
};

export const getProxyBaseUrl = (): string => {
  if (proxyBaseUrl) {
    return proxyBaseUrl;
  }
  const browserLocation = getWindowLocation();
  return browserLocation?.origin ?? "";
};

export const getRuntimeBackendBaseUrl = (): string | null => runtimeBackendBaseUrl;

export const getUiPageUrl = (url: string, relativePath = false): string => {
  const browserLocation = getWindowLocation();
  return normalizeBackendPageUrlToUiOrigin(url, runtimeBackendBaseUrl, browserLocation?.origin ?? null, relativePath);
};

const normalizeHttpUrl = (url: string | null | undefined): string | null => {
  const trimmedUrl = (url ?? "").trim();
  if (!trimmedUrl || !isValidHttpUrl(trimmedUrl)) return null;
  return trimmedUrl.replace(/\/+$/, "");
};

export const getGatewayBaseUrl = (): string => {
  if (typeof window !== "undefined" && window.localStorage.getItem(WORKER_URL_KEY)) {
    return getProxyBaseUrl();
  }
  return gatewayBaseUrl ?? getProxyBaseUrl();
};

/**
 * Switch API calls to point at a worker (or back to the control plane).
 * Persists to localStorage so it survives page navigation. Also updates the
 * module-level proxyBaseUrl so in-flight code in this JS execution sees the
 * new value immediately.
 */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function switchToWorkerUrl(workerUrl: string | null): void {
  if (workerUrl && !isValidHttpUrl(workerUrl)) {
    return;
  }
  if (typeof window !== "undefined") {
    if (workerUrl) {
      window.localStorage.setItem(WORKER_URL_KEY, workerUrl);
    } else {
      window.localStorage.removeItem(WORKER_URL_KEY);
    }
  }
  proxyBaseUrl = workerUrl ?? discoveredProxyBaseUrl;
}

const HTTP_REQUEST = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
};

export interface Model {
  model_name: string;
  litellm_params: object;
  model_info: object | null;
}

interface PromptInfo {
  prompt_type: string;
  environment?: string;
}

export interface PromptSpec {
  prompt_id: string;
  litellm_params: object;
  prompt_info: PromptInfo;
  created_at?: string;
  updated_at?: string;
  version?: number; // Explicit version number for version history
  environment?: string;
  created_by?: string;
}

export interface PromptTemplateBase {
  litellm_prompt_id: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

interface PromptInfoResponse {
  prompt_spec: PromptSpec;
  raw_prompt_template: PromptTemplateBase | null;
  environments?: string[];
}

export interface ListPromptsResponse {
  prompts: PromptSpec[];
}

export interface Organization {
  organization_id: string;
  organization_alias: string;
  budget_id: string;
  metadata: Record<string, any>;
  models: string[];
  spend: number;
  model_spend: Record<string, number>;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  litellm_budget_table: any; // Simplified to any since we don't need the detailed structure
  teams: any[] | null;
  users: any[] | null;
  members: any[] | null;
  object_permission?: ObjectPermission | null;
}

export interface CredentialItem {
  credential_name: string;
  display_name?: string | null;
  source?: "db" | "config";
  credential_values: any;
  credential_info: {
    custom_llm_provider?: string;
    description?: string;
    required?: boolean;
  };
}

export interface ProviderCredentialFieldMetadata {
  key: string;
  label: string;
  placeholder?: string | null;
  tooltip?: string | null;
  required?: boolean;
  field_type?: "text" | "password" | "select" | "upload" | "textarea";
  options?: string[] | null;
  default_value?: string | null;
}

export interface ProviderCreateInfo {
  provider: string;
  provider_display_name: string;
  litellm_provider: string;
  default_model_placeholder?: string | null;
  credential_fields: ProviderCredentialFieldMetadata[];
}

export interface WorkerInfo {
  worker_id: string;
  name: string;
  url: string;
}

export interface LiteLLMWellKnownUiConfig {
  server_root_path: string;
  proxy_base_url: string | null;
  gateway_base_url?: string | null;
  auto_redirect_to_sso: boolean;
  admin_ui_disabled: boolean;
  sso_configured: boolean;
  hide_default_credentials_hint?: boolean;
  is_control_plane?: boolean;
  workers?: WorkerInfo[];
  use_si_terminology?: boolean;
}

export interface CredentialsResponse {
  credentials: CredentialItem[];
}

let lastErrorTime = 0;

export const handleError = async (errorData: string | any) => {
  const currentTime = Date.now();
  if (currentTime - lastErrorTime > 60000) {
    // 60000 milliseconds = 60 seconds
    // Convert errorData to string if it isn't already
    const errorString = typeof errorData === "string" ? errorData : JSON.stringify(errorData);
    if (errorString.includes("Authentication Error - Expired Key")) {
      toast.info("UI Session Expired. Logging out.");
      lastErrorTime = currentTime;
      clearTokenCookies();
      const browserLocation = getWindowLocation();
      if (browserLocation) {
        window.location.href = browserLocation.pathname + browserLocation.search + browserLocation.hash;
      }
    }
    lastErrorTime = currentTime;
  }
};

export const getProviderCreateMetadata = async (): Promise<ProviderCreateInfo[]> => {
  /**
   * Fetch provider credential field metadata from the proxy's public endpoint.
   * This is used by the UI to dynamically render provider-specific credential fields.
   */
  const url = proxyBaseUrl ? `${proxyBaseUrl}/public/providers/fields` : `/public/providers/fields`;
  const response = await fetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to fetch provider create metadata:", response.status, errorText);
    throw new Error("Failed to load provider configuration");
  }

  const jsonData: ProviderCreateInfo[] = await response.json();
  return jsonData;
};

export interface ComplexityScorerDefaults {
  tier_boundaries: Record<string, number>;
  token_thresholds: Record<string, number>;
  dimension_weights: Record<string, number>;
}

export const getComplexityScorerDefaults = async (): Promise<ComplexityScorerDefaults> => {
  /**
   * Fetch the complexity router's shipped heuristic scorer defaults from the proxy's public endpoint.
   * The Advanced scoring controls prefill from these rather than from a copy in the dashboard, so a
   * recalibration of the defaults cannot leave the form reporting numbers the router no longer uses.
   */
  return await apiClient.get(`/public/complexity_router/scorer_defaults`);
};

export const getAutoRouterPresets = async (): Promise<AutoRouterPresetsResponse> => {
  /**
   * Fetch the auto-router preset catalog from the proxy's public endpoint. The template picker
   * renders from this rather than from a copy in the dashboard, so a catalog update propagates
   * without a dashboard release.
   */
  return await apiClient.get(`/public/autorouter_presets`);
};

// Global variable for the header name
let globalLitellmHeaderName: string = "Authorization";

// Function to set the global header name
export function setGlobalLitellmHeaderName(headerName: string = "Authorization") {
  globalLitellmHeaderName = headerName;
}

// Function to get the global header name
export function getGlobalLitellmHeaderName(): string {
  return globalLitellmHeaderName;
}

export const apiClient = createApiClient({
  getBaseUrl: getProxyBaseUrl,
  getAuthHeaderName: getGlobalLitellmHeaderName,
  onError: handleError,
});

export const gatewayApiClient = createApiClient({
  getBaseUrl: getGatewayBaseUrl,
  getAuthHeaderName: getGlobalLitellmHeaderName,
  onError: handleError,
});

registerBaseUrlGetter(getProxyBaseUrl);
registerAuthHeaderNameGetter(getGlobalLitellmHeaderName);
registerAuthTokenGetter(() => decodeToken(getCookie("token"))?.key ?? null);
registerErrorHandler(handleError);

export const getUiConfig = async () => {
  /**Special route to get the proxy base url and server root path */
  const runtimeBackendUrl = defaultProxyBaseUrl
    ? null
    : await (async (): Promise<string | null> => {
        try {
          // eslint-disable-next-line no-restricted-syntax -- read the UI static config before the API origin is known
          const response = await fetch("/ui/litellm-runtime-config.json", { cache: "no-store" });
          if (!response.ok) return null;
          const runtimeConfig: unknown = await response.json();
          if (
            typeof runtimeConfig !== "object" ||
            runtimeConfig === null ||
            !("backend_url" in runtimeConfig) ||
            typeof runtimeConfig.backend_url !== "string"
          ) {
            return null;
          }
          return normalizeHttpUrl(runtimeConfig.backend_url);
        } catch {
          return null;
        }
      })();
  runtimeBackendBaseUrl = runtimeBackendUrl;
  const discoveryBaseUrl = defaultProxyBaseUrl ?? runtimeBackendUrl;
  const url = discoveryBaseUrl
    ? `${discoveryBaseUrl}/litellm/.well-known/litellm-ui-config`
    : `/litellm/.well-known/litellm-ui-config`;
  const response = await fetch(url);
  const jsonData: LiteLLMWellKnownUiConfig = await response.json();
  /**
   * Update the proxy base url and server root path
   */
  updateServerRootPath(jsonData.server_root_path);
  updateProxyBaseUrl(jsonData.server_root_path, jsonData.proxy_base_url || runtimeBackendUrl);
  gatewayBaseUrl = normalizeHttpUrl(jsonData.gateway_base_url);
  return jsonData;
};

export const getOpenAPISchema = async () => {
  const url = proxyBaseUrl ? `${proxyBaseUrl}/openapi.json` : `/openapi.json`;
  const response = await fetch(url);
  const jsonData = await response.json();
  return jsonData;
};

export const modelCostMap = async (catalogOnly = false) => {
  try {
    const path = catalogOnly ? "/public/litellm_model_cost_map?catalog_only=true" : "/public/litellm_model_cost_map";
    const url = proxyBaseUrl ? `${proxyBaseUrl}${path}` : path;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to get model cost map:", error);
    throw error;
  }
};

export const reloadModelCostMap = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/reload/model_cost_map` : `/reload/model_cost_map`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to reload model cost map:", error);
    throw error;
  }
};

export const scheduleModelCostMapReload = async (accessToken: string, hours: number) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/schedule/model_cost_map_reload?hours=${hours}`
      : `/schedule/model_cost_map_reload?hours=${hours}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to schedule model cost map reload:", error);
    throw error;
  }
};

export const cancelModelCostMapReload = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/schedule/model_cost_map_reload` : `/schedule/model_cost_map_reload`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to cancel model cost map reload:", error);
    throw error;
  }
};

export const getModelCostMapSource = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/model/cost_map/source` : `/model/cost_map/source`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to get model cost map source info:", error);
    throw error;
  }
};

export const getModelCostMapReloadStatus = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/schedule/model_cost_map_reload/status`
      : `/schedule/model_cost_map_reload/status`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Status request failed with status: ${response.status}`);
      const errorText = await response.text();
      console.error("Error response:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error("Failed to get model cost map reload status:", error);
    throw error;
  }
};
export const modelCreateCall = async (accessToken: string, formValues: Model) => {
  try {
    const data = await apiClient.post(`/model/new`, {
      accessToken,
      body: {
        ...formValues,
      },
    });

    // Close any existing messages before showing new ones
    toast.dismiss();

    // Sequential success messages
    toast.success(`Model ${formValues.model_name} created successfully`);

    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const modelDeleteCall = async (accessToken: string, model_id: string) => {
  try {
    const data = await apiClient.post(`/model/delete`, {
      accessToken,
      body: {
        id: model_id,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const budgetDeleteCall = async (accessToken: string | null, budget_id: string) => {
  if (accessToken == null) {
    return;
  }

  try {
    const data = await apiClient.post(`/budget/delete`, {
      accessToken,
      body: {
        id: budget_id,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const budgetCreateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    const data = await apiClient.post(`/budget/new`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const budgetUpdateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    const data = await apiClient.post(`/budget/update`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const invitationCreateCall = async (
  accessToken: string,
  userID: string, // Assuming formValues is an object
) => {
  try {
    const data = await apiClient.post(`/invitation/new`, {
      accessToken,
      body: {
        user_id: userID, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const alertingSettingsCall = async (accessToken: string) => {
  /**
   * Get all configurable params for setting a model
   */
  try {
    return await apiClient.get(`/alerting/settings`, { accessToken });
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const keyCreateServiceAccountCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    // check if formValues.description is not undefined, make it a string and add it to formValues.metadata
    if (formValues.description) {
      // add to formValues.metadata
      if (!formValues.metadata) {
        formValues.metadata = {};
      }
      // value needs to be in "", valid JSON
      formValues.metadata.description = formValues.description;
      // remove descrption from formValues
      delete formValues.description;
      formValues.metadata = JSON.stringify(formValues.metadata);
    }
    // Parse JSON fields if they exist
    for (const field of jsonFields) {
      if (formValues[field]) {
        // if there's an exception JSON.parse, show it in the message
        try {
          formValues[field] = JSON.parse(formValues[field]);
        } catch (error) {
          throw new Error(`Failed to parse ${field}: ` + error);
        }
      }
    }

    const url = proxyBaseUrl ? `${proxyBaseUrl}/key/service-account/generate` : `/key/service-account/generate`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const keyCreateCall = async (
  accessToken: string,
  userID: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    // check if formValues.description is not undefined, make it a string and add it to formValues.metadata
    if (formValues.description) {
      // add to formValues.metadat
      if (!formValues.metadata) {
        formValues.metadata = {};
      }
      // value needs to be in "", valid JSON
      formValues.metadata.description = formValues.description;
      // remove descrption from formValues
      delete formValues.description;
      formValues.metadata = JSON.stringify(formValues.metadata);
    }
    // Parse JSON fields if they exist
    for (const field of jsonFields) {
      if (formValues[field]) {
        // if there's an exception JSON.parse, show it in the message
        try {
          formValues[field] = JSON.parse(formValues[field]);
        } catch (error) {
          throw new Error(`Failed to parse ${field}: ` + error);
        }
      }
    }

    const url = proxyBaseUrl ? `${proxyBaseUrl}/key/generate` : `/key/generate`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userID,
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const userCreateCall = async (
  accessToken: string,
  userID: string | null,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    // check if formValues.description is not undefined, make it a string and add it to formValues.metadata
    if (formValues.description) {
      // add to formValues.metadata
      if (!formValues.metadata) {
        formValues.metadata = {};
      }
      // value needs to be in "", valid JSON
      formValues.metadata.description = formValues.description;
      // remove descrption from formValues
      delete formValues.description;
      formValues.metadata = JSON.stringify(formValues.metadata);
    }

    formValues.auto_create_key = false;
    // if formValues.metadata is not undefined, make it a valid dict
    if (formValues.metadata) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.metadata = JSON.parse(formValues.metadata);
      } catch (error) {
        throw new Error("Failed to parse metadata: " + error);
      }
    }

    const url = proxyBaseUrl ? `${proxyBaseUrl}/user/new` : `/user/new`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userID,
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const keyDeleteCall = async (accessToken: string, user_key: string) => {
  try {
    return await apiClient.post(`/key/delete`, { accessToken, body: { keys: [user_key] } });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const userDeleteCall = async (accessToken: string, userIds: string[]) => {
  try {
    return await apiClient.post(`/user/delete`, { accessToken, body: { user_ids: userIds } });
  } catch (error) {
    console.error("Failed to delete user(s):", error);
    throw error;
  }
};

export const teamDeleteCall = async (accessToken: string, teamID: string) => {
  try {
    return await apiClient.post(`/team/delete`, { accessToken, body: { team_ids: [teamID] } });
  } catch (error) {
    console.error("Failed to delete key:", error);
    throw error;
  }
};

export type UserListResponse = components["schemas"]["UserListResponse"];
export type UserInfo = UserListResponse["users"][number];

export const userListCall = async (
  accessToken: string,
  userIDs: string[] | null = null,
  page: number | null = null,
  page_size: number | null = null,
  userEmail: string | null = null,
  userRole: string | null = null,
  team: string | null = null,
  sso_user_id: string | null = null,
  sortBy: string | null = null,
  sortOrder: "asc" | "desc" | null = null,
  organizationIds: string[] | null = null,
  search: string | null = null,
): Promise<UserListResponse> => {
  const { data } = await fetchClient.GET("/user/list", {
    headers: { [globalLitellmHeaderName]: `Bearer ${accessToken}` },
    params: {
      query: {
        user_ids: userIDs && userIDs.length > 0 ? userIDs.join(",") : undefined,
        page: page || undefined,
        page_size: page_size || undefined,
        user_email: userEmail || undefined,
        role: userRole || undefined,
        team: team || undefined,
        sso_user_ids: sso_user_id || undefined,
        sort_by: sortBy || undefined,
        sort_order: sortOrder || undefined,
        organization_ids: organizationIds && organizationIds.length > 0 ? organizationIds.join(",") : undefined,
        search: search || undefined,
      },
    },
  });
  if (!data) throw new Error("User list response is empty");
  return data;
};

/**
 * Response type for /v2/user/info — lightweight endpoint that returns only the user object.
 */
export interface UserInfoV2Response {
  user_id: string;
  user_email: string | null;
  user_alias: string | null;
  user_role: string | null;
  spend: number;
  max_budget: number | null;
  tpm_limit?: number | null;
  rpm_limit?: number | null;
  models: string[];
  budget_duration: string | null;
  budget_reset_at: string | null;
  metadata: Record<string, any> | null;
  created_at: string | null;
  updated_at: string | null;
  sso_user_id: string | null;
  teams: string[];
  object_permission?: ObjectPermission | null;
  model_max_budget?: ModelMaxBudget | null;
  model_max_budget_usage?: Record<string, ModelBudgetUsage> | null;
}

/**
 * Lightweight user info fetch from /v2/user/info.
 * Returns only the user object — no keys, no teams objects.
 *
 * @param accessToken - Bearer token for auth
 * @param userId - Optional user ID to look up. If omitted, returns the caller's own info.
 */
export const userGetInfoV2 = async (accessToken: string, userId?: string): Promise<UserInfoV2Response> => {
  try {
    return await apiClient.get(`/v2/user/info`, { accessToken, query: { user_id: userId || undefined } });
  } catch (error) {
    console.error("Failed to fetch user info v2:", error);
    throw error;
  }
};

export const teamInfoCall = async (accessToken: string, teamID: string | null, options?: { keyLimit?: number }) => {
  try {
    return await apiClient.get(`/team/info`, {
      accessToken,
      query: { team_id: teamID || undefined, key_limit: options?.keyLimit },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const teamListCall = async (
  accessToken: string,
  organizationID: string | null,
  userID: string | null = null,
  teamID: string | null = null,
  team_alias: string | null = null,
) => {
  /**
   * Get all available teams on proxy
   */
  try {
    return await apiClient.get(`/team/list`, {
      accessToken,
      query: {
        user_id: userID || undefined,
        organization_id: organizationID || undefined,
        team_id: teamID || undefined,
        team_alias: team_alias || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const availableTeamListCall = async (accessToken: string) => {
  /**
   * Get all available teams on proxy
   */
  try {
    const data = await apiClient.get(`/team/available`, { accessToken });
    return data;
  } catch (error) {
    throw error;
  }
};

export const organizationListCall = async (
  accessToken: string,
  org_id: string | null = null,
  org_alias: string | null = null,
) => {
  /**
   * Get all organizations on proxy
   */
  try {
    return await apiClient.get(`/organization/list`, {
      accessToken,
      query: {
        org_id: org_id || undefined,
        org_alias: org_alias || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const organizationInfoCall = async (accessToken: string, organizationID: string) => {
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/organization/info` : `/organization/info`;
    if (organizationID) {
      url = `${url}?organization_id=${organizationID}`;
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const organizationDeleteCall = async (accessToken: string, organizationID: string) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/organization/delete` : `/organization/delete`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_ids: [organizationID],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error(`Error deleting organization: ${errorData}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to delete organization:", error);
    throw error;
  }
};

export const transformRequestCall = async (accessToken: string, request: object) => {
  /**
   * Transform request
   */

  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/utils/transform_request` : `/utils/transform_request`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

const ENTITY_ID_QUERY_PARAM: Record<DailyActivityEntity, string> = {
  user: "user_id",
  team: "team_ids",
  tag: "tags",
  organization: "organization_ids",
  customer: "end_user_ids",
};

const EXCLUDE_ENTITY_ID_QUERY_PARAM: Partial<Record<DailyActivityEntity, string>> = {
  team: "exclude_team_ids",
  organization: "exclude_organization_ids",
  customer: "exclude_end_user_ids",
};

const dailyActivityQuery = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
  extra: QueryParams = {},
): QueryParams => {
  const entityIds = req.entityIds ?? undefined;
  const excludeEntityIds = req.excludeEntityIds;
  const joinedEntityIds = entityIds && entityIds.length > 0 ? entityIds.join(",") : undefined;
  const entityIdValue = entity === "user" ? entityIds?.[0] : joinedEntityIds;
  const excludeParam = EXCLUDE_ENTITY_ID_QUERY_PARAM[entity];
  return {
    start_date: formatDate(req.startTime),
    end_date: formatDate(req.endTime),
    model: req.model,
    api_key: req.apiKey,
    [ENTITY_ID_QUERY_PARAM[entity]]: entityIdValue,
    ...(excludeParam
      ? { [excludeParam]: excludeEntityIds && excludeEntityIds.length > 0 ? excludeEntityIds.join(",") : undefined }
      : {}),
    timezone: new Date().getTimezoneOffset().toString(),
    include_current_utc_day: entity === "user" && req.includeCurrentUtcDay ? "true" : undefined,
    ...extra,
  };
};

export const dailyActivityAggregatedCall = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
): Promise<DailyActivityAggregatedResponse> =>
  apiClient.get<DailyActivityAggregatedResponse>(`/${entity}/daily/activity/aggregated`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery(entity, req, req.apiKeyLimit === undefined ? {} : { api_key_limit: req.apiKeyLimit }),
  });

export const subscriptionUsageCall = (
  accessToken: string,
  startTime: Date,
  endTime: Date,
): Promise<SubscriptionUsageResponse> =>
  apiClient.get<SubscriptionUsageResponse>("/subscription_accounts/usage", {
    accessToken,
    query: { start_date: formatDate(startTime), end_date: formatDate(endTime) },
  });

export const subscriptionAccountCreateCall = (
  accessToken: string,
  body: SubscriptionAccountCreateRequest,
): Promise<SubscriptionFee> => apiClient.post<SubscriptionFee>("/subscription_accounts/new", { accessToken, body });

export const subscriptionAccountUpdateCall = (
  accessToken: string,
  body: SubscriptionAccountUpdateRequest,
): Promise<SubscriptionFee> => apiClient.post<SubscriptionFee>("/subscription_accounts/update", { accessToken, body });

export const subscriptionAccountDeleteCall = (
  accessToken: string,
  subscriptionAccountId: string,
): Promise<SubscriptionFee> => {
  const body: SubscriptionAccountDeleteRequest = { subscription_account_id: subscriptionAccountId };
  return apiClient.post<SubscriptionFee>("/subscription_accounts/delete", { accessToken, body });
};

export const dailyActivityKeyPageCall = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
  offset: number,
  limit: number,
): Promise<DailyActivityKeyPageResponse> =>
  apiClient.get<DailyActivityKeyPageResponse>(`/${entity}/daily/activity/aggregated/keys`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery(entity, req, { offset, limit }),
  });

export const dailyActivityKeySearchCall = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
  search: string,
  limit?: number,
): Promise<DailyActivityKeySearchResponse> =>
  apiClient.get<DailyActivityKeySearchResponse>(`/${entity}/daily/activity/aggregated/search`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery(entity, req, { search, ...(limit === undefined ? {} : { limit }) }),
  });

export const dailyActivityModelTopKeysCall = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
  model: string,
  byModelGroup: boolean,
  limit?: number,
): Promise<ModelTopKeysResponse> =>
  apiClient.get<ModelTopKeysResponse>(`/${entity}/daily/activity/aggregated/model_top_keys`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery(entity, req, {
      model_group: model,
      by_model_group: byModelGroup ? "true" : "false",
      ...(limit === undefined ? {} : { limit }),
    }),
  });

export const dailyActivityExportCall = (
  entity: DailyActivityEntity,
  req: DailyActivityRequest,
  exportType: ExportType,
  format: ExportFormat,
): Promise<Blob> =>
  apiClient.getBlob(`/${entity}/daily/activity/export`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery(entity, req, { export_type: exportType, format }),
  });

export const userDailyActivityUserPageCall = (
  req: DailyActivityRequest,
  offset: number,
  limit: number,
): Promise<DailyActivityUserPageResponse> =>
  apiClient.get<DailyActivityUserPageResponse>(`/user/daily/activity/aggregated/users`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery("user", req, { offset, limit }),
  });

export const cacheLeakageKeysCall = (req: DailyActivityRequest, limit?: number): Promise<CacheLeakageKeysResponse> =>
  apiClient.get<CacheLeakageKeysResponse>(`/user/daily/activity/aggregated/cache_leakage_keys`, {
    accessToken: req.accessToken,
    query: dailyActivityQuery("user", req, limit === undefined ? {} : { limit }),
  });

export type TeamUserSpendResponse = components["schemas"]["TeamUserSpendResponse"];

export const teamSpendByUserCall = async (
  accessToken: string,
  startTime: Date,
  endTime: Date,
  teamIds: readonly string[],
): Promise<TeamUserSpendResponse> =>
  apiClient.get<TeamUserSpendResponse>(`/team/spend/by_user`, {
    accessToken,
    query: {
      start_date: formatDate(startTime),
      end_date: formatDate(endTime),
      team_ids: teamIds.join(","),
    },
  });

export const getOnboardingCredentials = async (inviteUUID: string) => {
  /**
   * Get all models on proxy
   */
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/onboarding/get_token` : `/onboarding/get_token`;
    url += `?invite_link=${inviteUUID}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const claimOnboardingToken = async (
  accessToken: string,
  inviteUUID: string,
  userID: string,
  password: string,
) => {
  try {
    const data = await apiClient.post(`/onboarding/claim_token`, {
      accessToken,
      body: {
        invitation_link: inviteUUID,
        user_id: userID,
        password: password,
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to delete key:", error);
    throw error;
  }
};

/**
 * Revokes the UI session key server-side (POST /session/logout). Best-effort
 * with a short timeout: logout must still complete locally when the server is
 * unreachable, so callers swallow rejections.
 */
export const sessionLogoutCall = async (accessToken: string): Promise<{ message: string }> => {
  return await apiClient.post(`/session/logout`, {
    accessToken,
    signal: AbortSignal.timeout(3000),
  });
};

export const changePasswordCall = async (
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ user_id: string; message: string }> => {
  return await apiClient.post(`/user/password/change`, {
    accessToken,
    body: {
      current_password: currentPassword,
      new_password: newPassword,
    },
  });
};

export const regenerateKeyCall = async (accessToken: string, keyToRegenerate: string, formData: any) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/key/${keyToRegenerate}/regenerate`
      : `/key/${keyToRegenerate}/regenerate`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to regenerate key:", error);
    throw error;
  }
};

let ModelListerrorShown = false;
let errorTimer: NodeJS.Timeout | null = null;

export const modelInfoCall = async (
  accessToken: string,
  userID: string,
  userRole: string,
  page: number = 1,
  size: number = 50,
  search?: string,
  modelId?: string,
  teamId?: string,
  sortBy?: string,
  sortOrder?: string,
  excludeAutoRouters?: boolean,
  modelName?: string,
  accessGroup?: string,
  wildcardOnly?: boolean,
  blocked?: boolean,
  options: { useStoredParams?: boolean } = {},
) => {
  /**
   * Get all models on proxy
   */
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/v2/model/info` : `/v2/model/info`;
    const params = new URLSearchParams();
    params.append("include_team_models", "true");
    params.append("page", page.toString());
    params.append("size", size.toString());
    if (search && search.trim()) {
      params.append("search", search.trim());
    }
    if (modelName && modelName.trim()) {
      params.append("model", modelName.trim());
    }
    if (modelId && modelId.trim()) {
      params.append("modelId", modelId.trim());
    }
    if (options.useStoredParams) {
      params.append("use_stored_params", "true");
    }
    if (teamId && teamId.trim()) {
      params.append("teamId", teamId.trim());
    }
    if (sortBy && sortBy.trim()) {
      params.append("sortBy", sortBy.trim());
    }
    if (sortOrder && sortOrder.trim()) {
      params.append("sortOrder", sortOrder.trim());
    }
    if (excludeAutoRouters) {
      params.append("exclude_auto_routers", "true");
    }
    if (accessGroup && accessGroup.trim()) {
      params.append("access_group", accessGroup.trim());
    }
    if (wildcardOnly) {
      params.append("wildcard_only", "true");
    }
    if (blocked !== undefined) {
      params.append("blocked", blocked ? "true" : "false");
    }
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      let errorData = await response.text();
      errorData += `error shown=${ModelListerrorShown}`;
      if (!ModelListerrorShown) {
        if (errorData.includes("No model list passed")) {
          errorData = "No Models Exist. Click Add Model to get started.";
        }
        toast.info(errorData);
        ModelListerrorShown = true;

        if (errorTimer) clearTimeout(errorTimer);
        errorTimer = setTimeout(() => {
          ModelListerrorShown = false;
        }, 10000);
      }

      throw new Error("Network response was not ok");
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const modelInfoV1Call = async (accessToken: string, modelId: string) => {
  /**
   * Get all models on proxy
   */
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/v1/model/info` : `/v1/model/info`;
    url += `?litellm_model_id=${modelId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const modelHubCall = async (accessToken: string) => {
  /**
   * Get all models on proxy
   */
  try {
    const data = await apiClient.get(`/model_group/info`, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

// Function to get allowed IPs
export const getAllowedIPs = async (accessToken: string) => {
  try {
    const data = await apiClient.get(`/get/allowed_ips`, { accessToken });
    return data.data; // Assuming the API returns { data: [...] }
  } catch (error) {
    console.error("Failed to get allowed IPs:", error);
    throw error;
  }
};

// Function to add an allowed IP
export const addAllowedIP = async (accessToken: string, ip: string) => {
  try {
    const data = await apiClient.post(`/add/allowed_ip`, { accessToken, body: { ip: ip } });
    return data;
  } catch (error) {
    console.error("Failed to add allowed IP:", error);
    throw error;
  }
};

// Function to delete an allowed IP
export const deleteAllowedIP = async (accessToken: string, ip: string) => {
  try {
    const data = await apiClient.post(`/delete/allowed_ip`, { accessToken, body: { ip: ip } });
    return data;
  } catch (error) {
    console.error("Failed to delete allowed IP:", error);
    throw error;
  }
};

export const modelAvailableCall = async (
  accessToken: string,
  userID: string,
  userRole: string,
  return_wildcard_routes: boolean = false,
  teamID: string | null = null,
  include_model_access_groups: boolean = false,
  only_model_access_groups: boolean = false,
  scope?: string,
) => {
  /**
   * Get all the models user has access to
   */
  try {
    return await gatewayApiClient.get(`/models`, {
      accessToken,
      query: {
        include_model_access_groups: "True",
        return_wildcard_routes: return_wildcard_routes === true ? "True" : undefined,
        only_model_access_groups: only_model_access_groups === true ? "True" : undefined,
        team_id: teamID || undefined,
        scope: scope || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const userFilterUICall = async (accessToken: string, params: URLSearchParams) => {
  try {
    return await apiClient.get(`/user/filter/ui`, {
      accessToken,
      query: {
        user_email: params.get("user_email") || undefined,
        user_id: params.get("user_id") || undefined,
        team_id: params.get("team_id") || undefined,
        search: params.get("search") || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

/**
 * Optional query params for /spend/logs/ui - matches backend spend_management_endpoints.py
 */
interface UiSpendLogsParams {
  api_key?: string;
  team_id?: string;
  request_id?: string;
  session_id?: string;
  user_id?: string;
  end_user?: string;
  status_filter?: string;
  cache_hit_filter?: string;
  used_client_oauth_token?: string;
  span_type?: string;
  /** Filter by model name (e.g. "gpt-4") */
  model?: string;
  /** Filter by model ID (litellm model deployment id) */
  model_id?: string;
  key_alias?: string;
  error_code?: string;
  error_message?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  min_spend?: number;
  max_spend?: number;
  exclude_internal_health_checks?: boolean;
  group_by_session?: boolean;
  session_cursor?: string;
  search?: string;
}

interface UiSpendLogsCallOptions {
  accessToken: string;
  start_date: string;
  end_date: string;
  page?: number;
  page_size?: number;
  params?: UiSpendLogsParams;
}

export const uiSpendLogsCall = async ({
  accessToken,
  start_date,
  end_date,
  page = 1,
  page_size = 50,
  params = {},
}: UiSpendLogsCallOptions) => {
  try {
    // Construct base URL
    let url = proxyBaseUrl ? `${proxyBaseUrl}/spend/logs/ui` : `/spend/logs/ui`;

    const queryParams = new URLSearchParams();
    queryParams.append("start_date", start_date);
    queryParams.append("end_date", end_date);
    queryParams.append("page", page.toString());
    queryParams.append("page_size", page_size.toString());

    // Add optional params only when explicitly provided
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (key === "min_spend" || key === "max_spend") {
        queryParams.append(key, value.toString());
      } else if (typeof value === "boolean") {
        if (value) queryParams.append(key, "true");
      } else if (typeof value === "string" && value !== "") {
        queryParams.append(key, String(value));
      }
    }

    const queryString = queryParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch spend logs:", error);
    throw error;
  }
};

export const testConnectionRequest = async (
  accessToken: string,
  litellm_params: Record<string, any>,
  model_info: Record<string, any>,
  mode?: string,
) => {
  try {
    // Construct the URL based on environment
    const url = proxyBaseUrl ? `${proxyBaseUrl}/health/test_connection` : `/health/test_connection`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        litellm_params: litellm_params,
        model_info: model_info,
        mode: mode,
      }),
    });

    // Check for non-JSON responses first
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      console.error("Received non-JSON response:", text);
      throw new Error(
        `Received non-JSON response (${response.status}: ${response.statusText}). Check network tab for details.`,
      );
    }

    const data = await response.json();

    if (!response.ok || data.status === "error") {
      // Return the error response instead of throwing an error
      // This allows the caller to handle the error format properly
      if (data.status === "error") {
        return data; // Return the full error response
      } else {
        return {
          status: "error",
          message: data.error?.message || `Connection test failed: ${response.status} ${response.statusText}`,
        };
      }
    }

    return data;
  } catch (error) {
    console.error("Model connection test error:", error);
    // For network errors or other exceptions, still throw
    throw error;
  }
};

export type ModelGroupConnectionResult = { status: "success" } | { status: "error"; error: string };

/**
 * Test an existing model group by routing a minimal request through the proxy
 * exactly as production would (by public model_group name). Unlike
 * /health/test_connection, this needs no litellm_params resolution: the router
 * resolves the group, credentials, and provider. Used by the auto-router Test
 * Connection to probe each tier's model group and the embedding model.
 */
/**
 * Build the minimal request that probes a model group by public name. No
 * max_tokens: reasoning models (o1/o3/...) reject a tiny cap with "max_tokens
 * reached" because reasoning tokens count against it, which would show a false
 * failure for a reachable tier.
 */
export const buildModelGroupTestRequest = (
  modelGroup: string,
  mode: "chat" | "embedding",
  requestParams: Record<string, unknown> = {},
): { path: string; body: Record<string, unknown> } =>
  mode === "embedding"
    ? { path: "/v1/embeddings", body: { model: modelGroup, input: "test from litellm" } }
    : {
        path: "/v1/chat/completions",
        body: { ...requestParams, model: modelGroup, messages: [{ role: "user", content: "test from litellm" }] },
      };

export const testModelGroupConnection = async (
  accessToken: string,
  modelGroup: string,
  mode: "chat" | "embedding",
  requestParams?: Record<string, unknown>,
): Promise<ModelGroupConnectionResult> => {
  const { path, body } = buildModelGroupTestRequest(modelGroup, mode, requestParams);
  try {
    await gatewayApiClient.post(path, { accessToken, body });
    return { status: "success" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
};

export interface AutoRouterRoutingTestRequest {
  prompt: string;
  complexity_router_config: ComplexityRouterConfigPayload | Record<string, unknown>;
  saved_model_id?: string;
  default_model?: string;
  router_name?: string;
  team_id?: string;
}

export interface AutoRouterRoutingTestResult {
  routed_model: string;
  routed_model_configured: boolean;
  routing_decision: RoutingDecision;
}

export type AutoRouterRoutingTestResponse =
  | { status: "success"; result: AutoRouterRoutingTestResult }
  | { status: "error"; error: string };

export const testAutoRouterRouting = async (
  accessToken: string,
  request: AutoRouterRoutingTestRequest,
): Promise<AutoRouterRoutingTestResponse> => {
  try {
    const result = await apiClient.post<AutoRouterRoutingTestResult>("/auto_router/test_routing", {
      accessToken,
      body: request,
    });
    return { status: "success", result };
  } catch (error) {
    return { status: "error", error: extractProxyErrorMessage(error) };
  }
};

export interface ComplexityRouterConfigValidation {
  valid: boolean;
  error?: string | null;
}

// Dry-runs the same write gate /model/new and /model/update apply, so a save that would come back
// as a raw 400 shows the backend's own message inline first. Transport failures fail open: the
// write gate stays authoritative.
export const validateAutoRouterConfig = async (
  accessToken: string,
  complexityRouterConfig: Record<string, unknown>,
  teamId?: string,
): Promise<ComplexityRouterConfigValidation> => {
  try {
    return await apiClient.post<ComplexityRouterConfigValidation>("/auto_router/validate_complexity_router_config", {
      accessToken,
      body: { complexity_router_config: complexityRouterConfig, ...(teamId && { team_id: teamId }) },
    });
  } catch (error) {
    console.warn("Could not dry-run the complexity router config; the save will be validated server side", error);
    return { valid: true };
  }
};

// ... existing code ...
export const keyInfoV1Call = async (accessToken: string, key: string) => {
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/key/info` : `/key/info`;
    url = `${url}?key=${key}`; // Add key as query parameter

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      // Remove body since this is a GET request
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      toast.fromError("Failed to fetch key info - " + errorData);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch key info:", error);
    throw error;
  }
};

export const keyListCall = async (
  accessToken: string,
  organizationID: string | null,
  teamID: string | null,
  selectedKeyAlias: string | null,
  userID: string | null,
  keyHash: string | null,
  page: number,
  pageSize: number,
  sortBy: string | null = null,
  sortOrder: string | null = null,
  expand: string | null = null,
  status: string | null = null,
) => {
  /**
   * Get all available teams on proxy
   */
  try {
    return await apiClient.get(`/key/list`, {
      accessToken,
      query: {
        team_id: teamID || undefined,
        organization_id: organizationID || undefined,
        key_alias: selectedKeyAlias || undefined,
        key_hash: keyHash || undefined,
        user_id: userID || undefined,
        page: page ? page.toString() : undefined,
        size: pageSize ? pageSize.toString() : undefined,
        sort_by: sortBy || undefined,
        sort_order: sortOrder || undefined,
        expand: expand || undefined,
        status: status || undefined,
        return_full_object: "true",
        include_team_keys: "true",
        include_created_by_keys: "true",
        // /key/list is exact by default; opt in so the key-list search box keeps
        // matching partial user_id/key_alias.
        substring_matching: "true",
      },
    });
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export interface PaginatedKeyAliasResponse {
  aliases: string[];
  total_count: number;
  current_page: number;
  total_pages: number;
  size: number;
}

export const keyAliasesCall = async (
  accessToken: string,
  page: number = 1,
  size: number = 50,
  search?: string,
  team_id?: string,
): Promise<PaginatedKeyAliasResponse> => {
  /**
   * Get key aliases from proxy with pagination and optional search
   */
  try {
    return await apiClient.get(`/key/aliases`, {
      accessToken,
      query: {
        page: String(page),
        size: String(size),
        search: search || undefined,
        team_id: team_id || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch key aliases:", error);
    throw error;
  }
};

export const gatewayDailyActivityCall = async (accessToken: string, startTime: Date, endTime: Date) => {
  /**
   * Get gateway request counts (SGR) recorded by the proxy middleware.
   * Deployment-wide and admin-only; carries no per-key or per-user dimension.
   */
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    return await apiClient.get(`/gateway/daily/activity`, {
      accessToken,
      query: {
        start_date: formatDate(startTime),
        end_date: formatDate(endTime),
      },
    });
  } catch (error) {
    console.error("Failed to fetch gateway daily activity:", error);
    throw error;
  }
};

export const requestErrorActivityCall = async (accessToken: string, startTime: Date, endTime: Date) => {
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    return await apiClient.get(`/gateway/errors/activity`, {
      accessToken,
      query: {
        start_date: formatDate(startTime),
        end_date: formatDate(endTime),
      },
    });
  } catch (error) {
    console.error("Failed to fetch request error activity:", error);
    throw error;
  }
};

export const getPossibleUserRoles = async (accessToken: string) => {
  try {
    const data = (await apiClient.get(`/user/available_roles`, { accessToken })) as Record<
      string,
      Record<string, string>
    >;
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    throw error;
  }
};

export const teamCreateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    if (formValues.metadata) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.metadata = JSON.parse(formValues.metadata);
      } catch (error) {
        throw new Error("Failed to parse metadata: " + error);
      }
    }

    const data = await apiClient.post(`/team/new`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const credentialCreateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    if (formValues.metadata) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.metadata = JSON.parse(formValues.metadata);
      } catch (error) {
        throw new Error("Failed to parse metadata: " + error);
      }
    }

    const data = await apiClient.post(`/credentials`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const credentialListCall = async (accessToken: string) => {
  /**
   * Get all available teams on proxy
   */
  try {
    const data = await apiClient.get(`/credentials`, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const credentialGetCall = async (accessToken: string, credentialName: string | null, modelId: string | null) => {
  try {
    let path = `/credentials`;

    if (credentialName) {
      path += `/by_name/${credentialName}`;
    } else if (modelId) {
      path += `/by_model/${modelId}`;
    }

    const data = await apiClient.get(path, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const credentialDeleteCall = async (accessToken: string, credentialName: string) => {
  try {
    const data = await apiClient.delete(`/credentials/${credentialName}`, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to delete key:", error);
    throw error;
  }
};

export interface UserProviderConnection {
  credential_name: string;
  provider: string;
  connected: boolean;
  github_login: string | null;
  connected_at: string | null;
}

export interface UserProviderConnectionsResponse {
  connections: UserProviderConnection[];
}

export interface UserConnectionStartResponse {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  flow_handle: string;
}

export type UserConnectionPollStatus = "pending" | "slow_down" | "expired" | "denied" | "no_copilot_seat" | "connected";

export interface UserConnectionPollResponse {
  status: UserConnectionPollStatus;
  interval?: number | null;
  github_login?: string | null;
}

const userConnectionPath = (credentialName: string): string =>
  `/credentials/${encodeURIComponent(credentialName)}/user_connection`;

export const userConnectionsListCall = (accessToken: string): Promise<UserProviderConnectionsResponse> =>
  apiClient.get<UserProviderConnectionsResponse>("/credentials/user_connections", { accessToken });

export const userConnectionStartCall = (
  accessToken: string,
  credentialName: string,
): Promise<UserConnectionStartResponse> =>
  apiClient.post<UserConnectionStartResponse>(`${userConnectionPath(credentialName)}/start`, { accessToken });

export const userConnectionPollCall = (
  accessToken: string,
  credentialName: string,
  flowHandle: string,
): Promise<UserConnectionPollResponse> =>
  apiClient.post<UserConnectionPollResponse>(`${userConnectionPath(credentialName)}/poll`, {
    accessToken,
    body: { flow_handle: flowHandle },
  });

export const userConnectionDeleteCall = (accessToken: string, credentialName: string): Promise<void> =>
  apiClient.delete<void>(userConnectionPath(credentialName), { accessToken });

export const credentialUpdateCall = async (
  accessToken: string,
  credentialName: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    if (formValues.metadata) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.metadata = JSON.parse(formValues.metadata);
      } catch (error) {
        throw new Error("Failed to parse metadata: " + error);
      }
    }

    const data = await apiClient.patch(`/credentials/${credentialName}`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const keyUpdateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    if (formValues.model_tpm_limit) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.model_tpm_limit = JSON.parse(formValues.model_tpm_limit);
      } catch (error) {
        throw new Error("Failed to parse model_tpm_limit: " + error);
      }
    }

    if (formValues.model_rpm_limit) {
      // if there's an exception JSON.parse, show it in the message
      try {
        formValues.model_rpm_limit = JSON.parse(formValues.model_rpm_limit);
      } catch (error) {
        throw new Error("Failed to parse model_rpm_limit: " + error);
      }
    }
    const url = proxyBaseUrl ? `${proxyBaseUrl}/key/update` : `/key/update`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      throw new Error(errorData);
    }
    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const teamUpdateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/team/update` : `/team/update`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      toast.fromError("Failed to update team settings: " + unwrapProxyErrorMessage(errorData));
      throw new Error(errorData);
    }
    const data = (await response.json()) as { data: Team; team_id: string };
    return data;
    // Handle success - you might want to update some state or UI based on the updated team
  } catch (error) {
    console.error("Failed to update team:", error);
    throw error;
  }
};

/**
 * Patch update a model
 *
 * @param accessToken
 * @param formValues
 * @returns
 */
export const modelPatchUpdateCall = async (
  accessToken: string,
  formValues: Record<string, any>, // Assuming formValues is an object
  modelId: string,
) => {
  try {
    // Intentionally not logging the payload: it can contain freshly-entered
    // provider secrets (api_key, vertex_credentials, AWS creds).
    const url = proxyBaseUrl ? `${proxyBaseUrl}/model/${modelId}/update` : `/model/${modelId}/update`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error update from the server:", errorData);
      throw new Error("Network response was not ok");
    }
    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to update model:", error);
    throw error;
  }
};

export interface Member {
  role: string;
  user_id: string | null;
  user_email?: string | null;
  user_alias?: string | null;
  max_budget_in_team?: number | null;
  tpm_limit?: number | null;
  rpm_limit?: number | null;
  budget_duration?: string | null;
  allowed_models?: string[] | null;
  temp_budget_increase?: number | null;
  temp_budget_expiry?: string | null;
  model_max_budget?: StoredModelMaxBudget | null;
}

export const teamMemberAddCall = async (accessToken: string, teamId: string, formValues: Member) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/team/member_add` : `/team/member_add`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        team_id: teamId,
        member: formValues,
      }),
    });

    if (!response.ok) {
      // Read and parse JSON error body
      const errorText = await response.text();
      let parsedError: any = {};

      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {
        console.warn("Failed to parse error body as JSON:", errorText);
      }

      const rawMessage = parsedError?.detail?.error || "Failed to add team member";
      const err = new Error(rawMessage);
      (err as any).raw = parsedError;
      throw err;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const teamBulkMemberAddCall = async (
  accessToken: string,
  teamId: string,
  members: Member[] | null,
  maxBudgetInTeam?: number,
  allUsers?: boolean,
) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/team/bulk_member_add` : `/team/bulk_member_add`;

    const requestBody: any = {
      team_id: teamId,
    };

    if (allUsers) {
      requestBody.all_users = true;
    } else {
      requestBody.members = members;
    }

    if (maxBudgetInTeam !== undefined && maxBudgetInTeam !== null) {
      requestBody.max_budget_in_team = maxBudgetInTeam;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Read and parse JSON error body
      const errorText = await response.text();
      let parsedError: any = {};

      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {
        console.warn("Failed to parse error body as JSON:", errorText);
      }

      const rawMessage = parsedError?.detail?.error || "Failed to bulk add team members";
      const err = new Error(rawMessage);
      (err as any).raw = parsedError;
      throw err;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to bulk add team members:", error);
    throw error;
  }
};

export const teamMemberUpdateCall = async (
  accessToken: string,
  teamId: string,
  formValues: Member, // Assuming formValues is an object
) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/team/member_update` : `/team/member_update`;

    const requestBody: any = {
      team_id: teamId,
      role: formValues.role,
      user_id: formValues.user_id,
    };

    const orNull = (value: unknown) => (value === undefined || value === null || value === "" ? null : value);
    if (formValues.user_email !== undefined) {
      requestBody.user_email = formValues.user_email;
    }
    if ("max_budget_in_team" in formValues) {
      requestBody.max_budget_in_team = orNull(formValues.max_budget_in_team);
    }
    if ("tpm_limit" in formValues) {
      requestBody.tpm_limit = orNull(formValues.tpm_limit);
    }
    if ("rpm_limit" in formValues) {
      requestBody.rpm_limit = orNull(formValues.rpm_limit);
    }
    if ("budget_duration" in formValues) {
      requestBody.budget_duration = orNull(formValues.budget_duration);
    }
    if (formValues.allowed_models !== undefined) {
      requestBody.allowed_models = formValues.allowed_models;
    }
    if ("temp_budget_increase" in formValues) {
      requestBody.temp_budget_increase = orNull(formValues.temp_budget_increase);
    }
    if ("temp_budget_expiry" in formValues) {
      requestBody.temp_budget_expiry = orNull(formValues.temp_budget_expiry);
    }
    if (formValues.model_max_budget !== undefined) {
      requestBody.model_max_budget = formValues.model_max_budget;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Read and parse JSON error body
      const errorText = await response.text();
      let parsedError: any = {};

      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {
        console.warn("Failed to parse error body as JSON:", errorText);
      }

      const rawMessage = parsedError?.detail?.error || "Failed to add team member";
      const err = new Error(rawMessage);
      (err as any).raw = parsedError;
      throw err;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to update team member:", error);
    throw error;
  }
};

export const teamMemberDeleteCall = async (
  accessToken: string,
  teamId: string,
  formValues: Member, // Assuming formValues is an object
) => {
  try {
    const data = await apiClient.post(`/team/member_delete`, {
      accessToken,
      body: {
        team_id: teamId,
        ...(formValues.user_email !== undefined && {
          user_email: formValues.user_email,
        }),
        ...(formValues.user_id !== undefined && {
          user_id: formValues.user_id,
        }),
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const organizationMemberAddCall = async (
  accessToken: string,
  organizationId: string,
  formValues: Member, // Assuming formValues is an object
) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/organization/member_add` : `/organization/member_add`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_id: organizationId,
        member: formValues, // Include formValues in the request body
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      console.error("Error response from the server:", errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create organization member:", error);
    throw error;
  }
};

export const organizationMemberDeleteCall = async (accessToken: string, organizationId: string, userId: string) => {
  try {
    const data = await apiClient.delete(`/organization/member_delete`, {
      accessToken,
      body: {
        organization_id: organizationId,
        user_id: userId,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to delete organization member:", error);
    throw error;
  }
};
export const organizationMemberUpdateCall = async (
  accessToken: string,
  organizationId: string,
  formValues: Member, // Assuming formValues is an object
) => {
  try {
    const data = await apiClient.patch(`/organization/member_update`, {
      accessToken,
      body: {
        organization_id: organizationId,
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to update organization member:", error);
    throw error;
  }
};

export const userUpdateUserCall = async (
  accessToken: string,
  formValues: any, // Assuming formValues is an object
  userRole: string | null,
) => {
  try {
    const response_body = { ...formValues };
    if (userRole !== null) {
      response_body["user_role"] = userRole;
    }
    const data = (await apiClient.post(`/user/update`, { accessToken, body: response_body })) as {
      user_id: string;
      data: UserInfo;
    };
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const userBulkUpdateUserCall = async (
  accessToken: string,
  formValues: any, // Assuming formValues is an object
  userIds?: string[], // Optional - if not provided, will update all users
  allUsers: boolean = false, // Flag to update all users
) => {
  try {
    let request_body: Record<string, any>;

    if (allUsers) {
      // Update all users mode
      request_body = {
        all_users: true,
        user_updates: formValues,
      };
    } else if (userIds && userIds.length > 0) {
      // Update specific users mode
      const users = [];
      for (const user_id of userIds) {
        users.push({
          user_id: user_id,
          ...formValues,
        });
      }
      request_body = {
        users: users,
      };
    } else {
      throw new Error("Must provide either userIds or set allUsers=true");
    }

    const data = (await apiClient.post(`/user/bulk_update`, { accessToken, body: request_body })) as {
      results: Array<{
        user_id?: string;
        user_email?: string;
        success: boolean;
        error?: string;
        updated_user?: any;
      }>;
      total_requested: number;
      successful_updates: number;
      failed_updates: number;
    };
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to create key:", error);
    throw error;
  }
};

export const serviceHealthCheck = async (accessToken: string, service: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/health/services?service=${service}`
      : `/health/services?service=${service}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      // throw error with message
      throw new Error(errorData);
    }

    const data = await response.json();
    // You can add additional logic here based on the response if needed
    return data;
  } catch (error) {
    console.error("Failed to perform health check:", error);
    throw error;
  }
};

export const getCallbacksCall = async (accessToken: string, userID: string, userRole: string) => {
  /**
   * Get all the models user has access to
   */
  try {
    const data = await apiClient.get(`/get/config/callbacks`, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const getGeneralSettingsCall = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/config/list?config_type=general_settings`
      : `/config/list?config_type=general_settings`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const getRouterSettingsCall = async (accessToken: string) => {
  try {
    const data = await apiClient.get(`/router/settings`, { accessToken });
    return data;
  } catch (error) {
    console.error("Failed to get router settings:", error);
    throw error;
  }
};

export const getCacheSettingsCall = async (accessToken: string) => {
  try {
    const data = await apiClient.get(`/cache/settings`, { accessToken });
    return data;
  } catch (error) {
    console.error("Failed to get cache settings:", error);
    throw error;
  }
};

export const testCacheConnectionCall = async (accessToken: string, cacheSettings: Record<string, any>) => {
  try {
    const data = await apiClient.post(`/cache/settings/test`, {
      accessToken,
      body: {
        cache_settings: cacheSettings,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to test cache connection:", error);
    throw error;
  }
};

export const updateCacheSettingsCall = async (accessToken: string, cacheSettings: Record<string, any>) => {
  try {
    const data = await apiClient.post(`/cache/settings`, {
      accessToken,
      body: {
        cache_settings: cacheSettings,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to update cache settings:", error);
    throw error;
  }
};

export const getCoordinationRedisSettingsCall = async (
  accessToken: string,
): Promise<CoordinationRedisSettingsResponse> => {
  try {
    return await apiClient.get<CoordinationRedisSettingsResponse>(`/coordination_redis/settings`, { accessToken });
  } catch (error) {
    console.error("Failed to get coordination redis settings:", error);
    throw error;
  }
};

export const testCoordinationRedisConnectionCall = async (
  accessToken: string,
  settings: CoordinationRedisSettings,
): Promise<CoordinationRedisTestResponse> => {
  try {
    return await apiClient.post<CoordinationRedisTestResponse>(`/coordination_redis/settings/test`, {
      accessToken,
      body: { settings },
    });
  } catch (error) {
    console.error("Failed to test coordination redis connection:", error);
    throw error;
  }
};

export const updateCoordinationRedisSettingsCall = async (
  accessToken: string,
  settings: CoordinationRedisSettings,
): Promise<void> => {
  try {
    await apiClient.post(`/coordination_redis/settings`, {
      accessToken,
      body: { settings },
    });
  } catch (error) {
    console.error("Failed to update coordination redis settings:", error);
    throw error;
  }
};

export const getPassThroughEndpointsCall = async (accessToken: string, teamId?: string | null) => {
  try {
    let path = `/config/pass_through_endpoint`;

    if (teamId) {
      path += `/team/${teamId}`;
    }

    const data = await apiClient.get(path, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const getConfigFieldSetting = async (accessToken: string, fieldName: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/config/field/info?field_name=${fieldName}`
      : `/config/field/info?field_name=${fieldName}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to set callbacks:", error);
    throw error;
  }
};

export const createPassThroughEndpoint = async (accessToken: string, formValues: Record<string, any>) => {
  /**
   * Set callbacks on proxy
   */
  try {
    const data = await apiClient.post(`/config/pass_through_endpoint`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to set callbacks:", error);
    throw error;
  }
};

export const updateConfigFieldSetting = async (accessToken: string, fieldName: string, fieldValue: any) => {
  try {
    const formData = {
      field_name: fieldName,
      field_value: fieldValue,
      config_type: "general_settings",
    };
    const data = await apiClient.post(`/config/field/update`, { accessToken, body: formData });
    toast.success("Successfully updated value!");
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to set callbacks:", error);
    throw error;
  }
};

export const deleteConfigFieldSetting = async (accessToken: string, fieldName: string) => {
  try {
    const formData = {
      field_name: fieldName,
      config_type: "general_settings",
    };
    const data = await apiClient.post(`/config/field/delete`, { accessToken, body: formData });
    toast.success("Field reset on proxy");
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const deletePassThroughEndpointsCall = async (accessToken: string, endpointId: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/config/pass_through_endpoint?endpoint_id=${endpointId}`
      : `/config/pass_through_endpoint?endpoint_id=${endpointId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const setCallbacksCall = async (accessToken: string, formValues: Record<string, any>) => {
  /**
   * Set callbacks on proxy
   */
  try {
    const data = await apiClient.post(`/config/update`, {
      accessToken,
      body: {
        ...formValues, // Include formValues in the request body
      },
    });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to set callbacks:", error);
    throw error;
  }
};

export const individualModelHealthCheckCall = async (accessToken: string, modelId: string) => {
  /**
   * Run health check for a specific model using model ID (so each deployment is checked separately).
   */
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/health?model_id=${encodeURIComponent(modelId)}`
      : `/health?model_id=${encodeURIComponent(modelId)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Failed to call /health for model id ${modelId}:`, error);
    throw error;
  }
};

export const cachingHealthCheckCall = async (accessToken: string) => {
  /**
   * Get all the models user has access to
   */
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/cache/ping` : `/cache/ping`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to call /cache/ping:", error);
    throw error;
  }
};

export const latestHealthChecksCall = async (accessToken: string) => {
  /**
   * Get the latest health check status for all models
   */
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/health/latest` : `/health/latest`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error(errorData);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to call /health/latest:", error);
    throw error;
  }
};

export const getProxyUISettings = async (accessToken: string) => {
  /**
   * Get all the models user has access to
   */
  try {
    const data = await apiClient.get(`/sso/get/ui_settings`, { accessToken });
    return data;
    // Handle success - you might want to update some state or UI based on the created key
  } catch (error) {
    console.error("Failed to get callbacks:", error);
    throw error;
  }
};

export const getUISettings = async (accessToken: string) => {
  /**
   * Get UI-specific configuration flags from the database
   */
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/get/ui_settings` : `/get/ui_settings`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      console.error("Failed to get UI settings:", errorMessage);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to get UI settings:", error);
    return null;
  }
};

export const getPromptsList = async (accessToken: string, environment?: string): Promise<ListPromptsResponse> => {
  try {
    return await apiClient.get(`/prompts/list`, { accessToken, query: { environment: environment || undefined } });
  } catch (error) {
    console.error("Failed to get prompts list:", error);
    throw error;
  }
};

export const getPromptInfo = async (
  accessToken: string,
  promptId: string,
  environment?: string,
): Promise<PromptInfoResponse> => {
  try {
    return await apiClient.get(`/prompts/${promptId}/info`, {
      accessToken,
      query: { environment: environment || undefined },
    });
  } catch (error) {
    console.error("Failed to get prompt info:", error);
    throw error;
  }
};

export const getPromptVersions = async (
  accessToken: string,
  promptId: string,
  environment?: string,
): Promise<ListPromptsResponse> => {
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/prompts/${promptId}/versions` : `/prompts/${promptId}/versions`;
    if (environment) {
      url += `?environment=${encodeURIComponent(environment)}`;
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      // Don't throw global error for 404 (no versions found) as we might want to handle it gracefully
      if (response.status !== 404) {
        handleError(errorMessage);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to get prompt versions:", error);
    throw error;
  }
};

export const createPromptCall = async (accessToken: string, promptData: any) => {
  try {
    const data = await apiClient.post(`/prompts`, { accessToken, body: promptData });
    return data;
  } catch (error) {
    console.error("Failed to create prompt:", error);
    throw error;
  }
};

export const updatePromptCall = async (accessToken: string, promptId: string, promptData: any) => {
  try {
    const data = await apiClient.put(`/prompts/${promptId}`, { accessToken, body: promptData });
    return data;
  } catch (error) {
    console.error("Failed to update prompt:", error);
    throw error;
  }
};

export const deletePromptCall = async (accessToken: string, promptId: string, environment?: string) => {
  try {
    const data = await apiClient.delete(`/prompts/${promptId}`, {
      accessToken,
      query: { environment: environment || undefined },
    });
    return data;
  } catch (error) {
    console.error("Failed to delete prompt:", error);
    throw error;
  }
};

export const convertPromptFileToJson = async (
  accessToken: string,
  file: File,
): Promise<{ prompt_id: string; json_data: any }> => {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const url = proxyBaseUrl ? `${proxyBaseUrl}/utils/dotprompt_json_converter` : `/utils/dotprompt_json_converter`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to convert prompt file:", error);
    throw error;
  }
};

export const uiSpendLogDetailsCall = async (accessToken: string, logId: string, start_date: string) => {
  try {
    // Construct base URL
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/spend/logs/ui/${encodeURIComponent(logId)}?start_date=${encodeURIComponent(start_date)}`
      : `/spend/logs/ui/${encodeURIComponent(logId)}?start_date=${encodeURIComponent(start_date)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch log details:", error);
    throw error;
  }
};

export const tagCreateCall = async (accessToken: string, formValues: TagNewRequest): Promise<void> => {
  await fetchClient.POST("/tag/new", {
    headers: { [globalLitellmHeaderName]: `Bearer ${accessToken}` },
    body: formValues,
  });
};

export const tagUpdateCall = async (accessToken: string, formValues: TagUpdateRequest): Promise<void> => {
  await fetchClient.POST("/tag/update", {
    headers: { [globalLitellmHeaderName]: `Bearer ${accessToken}` },
    body: formValues,
  });
};

export const tagInfoCall = async (accessToken: string, tagNames: string[]): Promise<TagInfoResponse> => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/tag/info` : `/tag/info`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ names: tagNames }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      await handleError(errorData);
      return {};
    }

    const data = await response.json();
    return data as TagInfoResponse;
  } catch (error) {
    console.error("Error getting tag info:", error);
    throw error;
  }
};

const formatYmd = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const tagListCall = async (
  accessToken: string,
  startTime?: Date | null,
  endTime?: Date | null,
): Promise<TagListResponse> => {
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/tag/list` : `/tag/list`;

    if (startTime && endTime) {
      const params = new URLSearchParams({
        start_date: formatYmd(startTime),
        end_date: formatYmd(endTime),
      });
      url = `${url}?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      await handleError(errorData);
      return {};
    }

    const data = await response.json();
    return data as TagListResponse;
  } catch (error) {
    console.error("Error listing tags:", error);
    throw error;
  }
};

export const tagDeleteCall = async (accessToken: string, tagName: string): Promise<void> => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/tag/delete` : `/tag/delete`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: tagName }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      await handleError(errorData);
      return;
    }

    return await response.json();
  } catch (error) {
    console.error("Error deleting tag:", error);
    throw error;
  }
};

export const getDefaultTeamSettings = async (accessToken: string) => {
  try {
    const data = await apiClient.get(`/get/default_team_settings`, { accessToken });
    return data;
  } catch (error) {
    console.error("Failed to fetch default team settings:", error);
    throw error;
  }
};

export const updateDefaultTeamSettings = async (accessToken: string, settings: Record<string, any>) => {
  try {
    const data = await apiClient.patch(`/update/default_team_settings`, { accessToken, body: settings });
    return data;
  } catch (error) {
    console.error("Failed to update default team settings:", error);
    throw error;
  }
};

export const getTeamPermissionsCall = async (accessToken: string, teamId: string) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/team/permissions_list?team_id=${teamId}`
      : `/team/permissions_list?team_id=${teamId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      console.error("Available permissions fetch failed:", errorMessage);
      return { all_available_permissions: [], team_member_permissions: [] };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to get team permissions:", error);
    throw error;
  }
};

export const teamPermissionsUpdateCall = async (accessToken: string, teamId: string, permissions: string[]) => {
  try {
    const data = await apiClient.post(`/team/permissions_update`, {
      accessToken,
      body: {
        team_id: teamId,
        team_member_permissions: permissions,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to update team permissions:", error);
    throw error;
  }
};

/**
 * Get a page of spend logs for a particular session.
 *
 * The backend paginates this endpoint (page / page_size, returning
 * { data, total, page, page_size, total_pages }). Callers that need the whole
 * session should page through total_pages and accumulate the results.
 */
export const sessionSpendLogsCall = async (
  accessToken: string,
  session_id: string,
  page: number = 1,
  page_size: number = 100,
) => {
  try {
    const params = new URLSearchParams({
      session_id,
      page: String(page),
      page_size: String(page_size),
    });
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/spend/logs/session/ui?${params.toString()}`
      : `/spend/logs/session/ui?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch session logs:", error);
    throw error;
  }
};

export const getEmailEventSettings = async (accessToken: string): Promise<EmailEventSettingsResponse> => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/email/event_settings` : `/email/event_settings`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error("Failed to get email event settings");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to get email event settings:", error);
    throw error;
  }
};

export const updateEmailEventSettings = async (accessToken: string, settings: EmailEventSettingsUpdateRequest) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/email/event_settings` : `/email/event_settings`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error("Failed to update email event settings");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to update email event settings:", error);
    throw error;
  }
};

export const resetEmailEventSettings = async (accessToken: string) => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/email/event_settings/reset` : `/email/event_settings/reset`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      handleError(errorData);
      throw new Error("Failed to reset email event settings");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to reset email event settings:", error);
    throw error;
  }
};

export { type Team } from "./key_team_helpers/key_list"; // Re-export Team

export const getSSOSettings = async (accessToken: string) => {
  try {
    const data = await apiClient.get(`/get/sso_settings`, { accessToken });
    return data;
  } catch (error) {
    console.error("Failed to fetch SSO configuration:", error);
    throw error;
  }
};

export const updateSSOSettings = async (accessToken: string, settings: Record<string, any>) => {
  try {
    // Construct base URL
    const url = proxyBaseUrl ? `${proxyBaseUrl}/update/sso_settings` : `/update/sso_settings`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const detailMessage =
        typeof errorData?.detail === "object"
          ? errorData.detail?.error || errorData.detail?.message
          : errorData?.detail;
      const errorMessage =
        typeof detailMessage === "string" && detailMessage.length > 0 ? detailMessage : deriveErrorMessage(errorData);

      handleError(errorMessage);

      const enhancedError = new Error(errorMessage);
      if (errorData?.detail !== undefined) {
        (enhancedError as any).detail = errorData.detail;
      }
      (enhancedError as any).rawError = errorData;

      throw enhancedError;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to update SSO configuration:", error);
    throw error;
  }
};

interface UiAuditLogsParams {
  action?: string;
  table_name?: string;
  object_id?: string;
  changed_by?: string;
  changed_by_api_key?: string;
  object_team_id?: string;
  object_key_hash?: string;
  search?: string | null;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

interface UiAuditLogsCallOptions {
  accessToken: string;
  page?: number;
  page_size?: number;
  params?: UiAuditLogsParams;
}

export const uiAuditLogsCall = async ({
  accessToken,
  page = 1,
  page_size = 50,
  params = {},
}: UiAuditLogsCallOptions) => {
  try {
    let url = proxyBaseUrl ? `${proxyBaseUrl}/audit` : `/audit`;

    const queryParams = new URLSearchParams();
    queryParams.append("page", page.toString());
    queryParams.append("page_size", page_size.toString());

    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        queryParams.append(key, String(value));
      }
    }

    url += `?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    throw error;
  }
};

export const getRemainingUsers = async (
  accessToken: string,
): Promise<{
  total_users: number | null;
  total_users_used: number;
  total_users_remaining: number | null;
  total_teams: number | null;
  total_teams_used: number;
  total_teams_remaining: number | null;
} | null> => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/user/available_users` : `/user/available_users`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      // if 404 - return None
      if (response.status === 404) {
        return null;
      }
      const errorData = await response.text();
      handleError(errorData);
      throw new Error("Network response was not ok");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch remaining users:", error);
    throw error;
  }
};

export interface LicenseInfo {
  has_license: boolean;
  license_type: string | null;
  expiration_date: string | null;
  allowed_features: string[];
  limits: {
    max_users: number | null;
    max_teams: number | null;
  };
}

export const getLicenseInfo = async (accessToken: string): Promise<LicenseInfo | null> => {
  try {
    const url = proxyBaseUrl ? `${proxyBaseUrl}/health/license` : `/health/license`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      // if 404 - return null (endpoint not available)
      if (response.status === 404) {
        return null;
      }
      const errorData = await response.text();
      handleError(errorData);
      throw new Error("Network response was not ok");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch license info:", error);
    throw error;
  }
};

export const updatePassThroughEndpoint = async (
  accessToken: string,
  endpointPath: string,
  formValues: Record<string, any>,
) => {
  try {
    const url = proxyBaseUrl
      ? `${proxyBaseUrl}/config/pass_through_endpoint/${encodeURIComponent(endpointPath)}`
      : `/config/pass_through_endpoint/${encodeURIComponent(endpointPath)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [globalLitellmHeaderName]: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formValues),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = deriveErrorMessage(errorData);
      handleError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    toast.success("Pass through endpoint updated successfully");
    return data;
  } catch (error) {
    console.error("Failed to update pass through endpoint:", error);
    throw error;
  }
};

export const deleteCallback = async (accessToken: string, callbackName: string) => {
  /**
   * Delete specific callback from proxy using the /config/callback/delete API
   */
  try {
    const data = await apiClient.post(`/config/callback/delete`, {
      accessToken,
      body: {
        callback_name: callbackName,
      },
    });
    return data;
  } catch (error) {
    console.error("Failed to delete specific callback:", error);
    throw error;
  }
};

// New endpoint functions for DAU, WAU, MAU
export const tagDauCall = async (accessToken: string, endDate: Date, tagFilter?: string, tagFilters?: string[]) => {
  /**
   * Get Daily Active Users (DAU) for last 7 days ending on endDate
   */
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const hasTagFilters = tagFilters && tagFilters.length > 0;
    return await apiClient.get(`/tag/dau`, {
      accessToken,
      query: {
        end_date: formatDate(endDate),
        tag_filters: hasTagFilters ? tagFilters : undefined,
        tag_filter: !hasTagFilters && tagFilter ? tagFilter : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch DAU:", error);
    throw error;
  }
};

export const tagWauCall = async (accessToken: string, endDate: Date, tagFilter?: string, tagFilters?: string[]) => {
  /**
   * Get Weekly Active Users (WAU) for last 7 weeks ending on endDate
   */
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const hasTagFilters = tagFilters && tagFilters.length > 0;
    return await apiClient.get(`/tag/wau`, {
      accessToken,
      query: {
        end_date: formatDate(endDate),
        tag_filters: hasTagFilters ? tagFilters : undefined,
        tag_filter: !hasTagFilters && tagFilter ? tagFilter : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch WAU:", error);
    throw error;
  }
};

export const tagMauCall = async (accessToken: string, endDate: Date, tagFilter?: string, tagFilters?: string[]) => {
  /**
   * Get Monthly Active Users (MAU) for last 7 months ending on endDate
   */
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const hasTagFilters = tagFilters && tagFilters.length > 0;
    return await apiClient.get(`/tag/mau`, {
      accessToken,
      query: {
        end_date: formatDate(endDate),
        tag_filters: hasTagFilters ? tagFilters : undefined,
        tag_filter: !hasTagFilters && tagFilter ? tagFilter : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch MAU:", error);
    throw error;
  }
};

export const tagDistinctCall = async (accessToken: string) => {
  /**
   * Get all distinct user agent tags (up to 250)
   */
  try {
    const data = await apiClient.get(`/tag/distinct`, { accessToken });
    return data;
  } catch (error) {
    console.error("Failed to fetch distinct tags:", error);
    throw error;
  }
};

export const userAgentSummaryCall = async (
  accessToken: string,
  startTime: Date,
  endTime: Date,
  tagFilters?: string[],
) => {
  /**
   * Get user agent summary statistics
   */
  try {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    return await apiClient.get(`/tag/summary`, {
      accessToken,
      query: {
        start_date: formatDate(startTime),
        end_date: formatDate(endTime),
        tag_filters: tagFilters && tagFilters.length > 0 ? tagFilters : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch user agent summary:", error);
    throw error;
  }
};

export const perUserAnalyticsCall = async (
  accessToken: string,
  page: number = 1,
  pageSize: number = 50,
  tagFilters?: string[],
) => {
  /**
   * Get per-user analytics data for the last 30 days
   */
  try {
    return await apiClient.get(`/tag/user-agent/per-user-analytics`, {
      accessToken,
      query: {
        page: page.toString(),
        page_size: pageSize.toString(),
        tag_filters: tagFilters && tagFilters.length > 0 ? tagFilters : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to fetch per-user analytics:", error);
    throw error;
  }
};

export interface LoginRequest {
  username: string;
  password: string;
  useV3?: boolean;
}

interface LoginResponse {
  redirect_url: string;
  token?: string;
  code?: string;
  expires_in?: number;
}

export const loginCall = async (username: string, password: string, useV3?: boolean): Promise<LoginResponse> => {
  const proxyBaseUrl = getProxyBaseUrl();
  const loginPath = useV3 ? "/v3/login" : "/v2/login";
  const loginUrl = proxyBaseUrl ? `${proxyBaseUrl}${loginPath}` : loginPath;

  const body = JSON.stringify({
    username,
    password,
  });

  const response = await fetch(loginUrl, {
    method: "POST",
    body,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = deriveErrorMessage(errorData);
    throw new Error(errorMessage);
  }

  const data: LoginResponse = await response.json();

  // v3 returns an opaque code — exchange it for the real JWT
  if (useV3 && data.code) {
    const exchangeUrl = proxyBaseUrl ? `${proxyBaseUrl}/v3/login/exchange` : "/v3/login/exchange";

    const exchangeResponse = await fetch(exchangeUrl, {
      method: "POST",
      body: JSON.stringify({ code: data.code }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (!exchangeResponse.ok) {
      const errorData = await exchangeResponse.json();
      throw new Error(deriveErrorMessage(errorData));
    }

    const exchangeData: LoginResponse = await exchangeResponse.json();
    if (exchangeData.token) {
      storeLoginToken(exchangeData.token);
    }
    return exchangeData;
  }

  // Backwards compatibility: v2 or old v3 returns token directly
  if (data.token) {
    storeLoginToken(data.token);
  }

  return data;
};

/**
 * Exchange a single-use login code for a JWT token.
 * Used by the SSO callback when the worker redirects back with ?code=.
 */
export const exchangeLoginCode = async (code: string, workerBaseUrl?: string | null): Promise<string> => {
  const base = workerBaseUrl || getProxyBaseUrl();
  const response = await fetch(`${base}/v3/login/exchange`, {
    method: "POST",
    body: JSON.stringify({ code }),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(deriveErrorMessage(errorData));
  }

  const data = await response.json();
  if (data.token) {
    storeLoginToken(data.token);
  }
  return data.token;
};

export const getUiSettings = async () => {
  const proxyBaseUrl = getProxyBaseUrl();
  const url = proxyBaseUrl ? `${proxyBaseUrl}/get/ui_settings` : `/get/ui_settings`;
  const response = await fetch(url, {
    method: "GET",
  });
  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = deriveErrorMessage(errorData);
    throw new Error(errorMessage);
  }
  const data = await response.json();
  return data;
};

export const updateUiSettings = async (accessToken: string, settings: Record<string, any>) => {
  const proxyBaseUrl = getProxyBaseUrl();
  const url = proxyBaseUrl ? `${proxyBaseUrl}/update/ui_settings` : `/update/ui_settings`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      [globalLitellmHeaderName]: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = deriveErrorMessage(errorData);
    throw new Error(errorMessage);
  }
  const data = await response.json();
  return data;
};

export const startMoyaiQuickConnect = async (accessToken: string, moyaiUrl: string, returnTo: string) => {
  return apiClient.post<{ connect_url: string }>("/moyai/connect/start", {
    accessToken,
    body: { moyai_url: moyaiUrl, return_to: returnTo },
  });
};

export type UserBannerSeverity = "info" | "warning" | "error";

export interface UserBanner {
  enabled: boolean;
  message: string;
  severity: UserBannerSeverity;
  revision: string;
}

export type UserBannerUpdate = Omit<UserBanner, "revision">;

export const getUserBanner = async (accessToken: string): Promise<UserBanner> => {
  return await apiClient.get<UserBanner>("/get/user_banner", { accessToken });
};

export const updateUserBanner = async (accessToken: string, banner: UserBannerUpdate): Promise<UserBanner> => {
  const data = await apiClient.patch<{ message: string; banner: UserBanner }>("/update/user_banner", {
    accessToken,
    body: banner,
  });
  return data.banner;
};
