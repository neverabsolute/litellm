import { describe, expect, it } from "vitest";
import {
  EndpointId,
  getAvailableEndpoints,
  getEndpointConfig,
  modelOptionsToSelectorOptions,
  hasValidSelection,
} from "./endpoint_config";

describe("endpoint_config", () => {
  it("offers every configured endpoint in the dropdown", () => {
    expect(getAvailableEndpoints()).toEqual([
      { value: EndpointId.CHAT_COMPLETIONS, label: getEndpointConfig(EndpointId.CHAT_COMPLETIONS).label },
    ]);
  });

  it("should convert model options to selector options", () => {
    const models = ["gpt-4", "gpt-3.5-turbo", "claude-3"];
    const options = modelOptionsToSelectorOptions(models);
    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ value: "gpt-4", label: "gpt-4" });
    expect(options[1]).toEqual({ value: "gpt-3.5-turbo", label: "gpt-3.5-turbo" });
    expect(options[2]).toEqual({ value: "claude-3", label: "claude-3" });
  });

  it("should check if comparison has valid selection", () => {
    expect(hasValidSelection({ model: "gpt-4" })).toBe(true);
    expect(hasValidSelection({ model: "" })).toBe(false);
    expect(hasValidSelection({ model: "   " })).toBe(false);
  });
});
