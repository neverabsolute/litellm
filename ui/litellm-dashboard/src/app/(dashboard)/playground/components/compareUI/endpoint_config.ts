/**
 * Endpoint configuration for CompareUI.
 * Add new endpoints here to extend the comparison functionality.
 */

// Endpoint identifiers
export const EndpointId = {
  CHAT_COMPLETIONS: "/v1/chat/completions",
  // Future endpoints:
  // RESPONSES: "/v1/responses",
  // ANTHROPIC: "/v1/messages",
} as const;

export type EndpointIdType = (typeof EndpointId)[keyof typeof EndpointId];

export interface EndpointConfig {
  id: EndpointIdType;
  label: string;
  selectorLabel: string;
  selectorPlaceholder: string;
  inputPlaceholder: string;
  loadingMessage: string;
  validationMessage: string;
}

// Endpoint configurations
export const ENDPOINT_CONFIGS: Record<EndpointIdType, EndpointConfig> = {
  [EndpointId.CHAT_COMPLETIONS]: {
    id: EndpointId.CHAT_COMPLETIONS,
    label: "/v1/chat/completions",
    selectorLabel: "Model",
    selectorPlaceholder: "Select a model",
    inputPlaceholder: "Send a prompt to compare models",
    loadingMessage: "Gathering responses from all models...",
    validationMessage: "Select a model before sending a message.",
  },
};

// Get list of available endpoints for the dropdown
export const getAvailableEndpoints = () =>
  Object.values(ENDPOINT_CONFIGS).map((config) => ({
    value: config.id,
    label: config.label,
  }));

// Helper to get config for an endpoint
export const getEndpointConfig = (endpointId: EndpointIdType): EndpointConfig => ENDPOINT_CONFIGS[endpointId];

// Selector options type
export interface SelectorOption {
  value: string;
  label: string;
}

// Convert model options to unified format
export const modelOptionsToSelectorOptions = (models: string[]): SelectorOption[] =>
  models.map((model) => ({ value: model, label: model }));

// Check if comparison has a valid selection for the endpoint
export const hasValidSelection = (comparison: { model: string }): boolean => Boolean(comparison.model.trim());

/**
 * To add a new endpoint:
 *
 * 1. Add the endpoint ID to EndpointId const
 * 2. Add configuration to ENDPOINT_CONFIGS
 * 3. Add request handling in CompareUI.tsx handleSendMessage
 *
 * Example for adding /v1/responses endpoint:
 *
 * EndpointId.RESPONSES = "/v1/responses"
 *
 * ENDPOINT_CONFIGS[EndpointId.RESPONSES] = {
 *   id: EndpointId.RESPONSES,
 *   label: "/v1/responses",
 *   selectorLabel: "Model",
 *   selectorPlaceholder: "Select a model",
 *   inputPlaceholder: "Send a prompt to compare responses",
 *   loadingMessage: "Gathering responses...",
 *   validationMessage: "Select a model before sending.",
 * }
 */
