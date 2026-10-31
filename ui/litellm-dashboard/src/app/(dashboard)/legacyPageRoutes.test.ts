import { describe, expect, it } from "vitest";
import { menuGroups } from "@/components/leftnav";
import { legacyPageRedirectHref } from "./legacyPageRoutes";

const redirect = (query: string) => legacyPageRedirectHref(new URLSearchParams(query));

describe("legacyPageRedirectHref", () => {
  it("sends an old ?page= bookmark to the path route that replaced it", () => {
    expect(redirect("page=logs")).toBe("/ui/logs");
    expect(redirect("page=models")).toBe("/ui/models-and-endpoints");
    expect(redirect("page=llm-playground")).toBe("/ui/playground");
    expect(redirect("page=new_usage")).toBe("/ui/usage");
    expect(redirect("page=usage")).toBe("/ui/usage");
  });

  it("keeps the older aliases for renamed pages", () => {
    expect(redirect("page=api_ref")).toBe("/ui/api-reference");
    expect(redirect("page=api-reference")).toBe("/ui/api-reference");
  });

  it("forwards the remaining query params to the new route", () => {
    expect(redirect("page=logs&request_id=req-1")).toBe("/ui/logs?request_id=req-1");
    expect(redirect("request_id=req-1&page=logs")).toBe("/ui/logs?request_id=req-1");
  });

  it("keeps forwarded values encoded", () => {
    expect(redirect("page=logs&request_id=a%26b%3Dc")).toBe("/ui/logs?request_id=a%26b%3Dc");
  });

  it("returns null for pages that were removed from the dashboard", () => {
    for (const page of [
      "mcp-servers",
      "guardrails",
      "policies",
      "agents",
      "vector-stores",
      "model-hub-table",
      "lens",
    ]) {
      expect(redirect(`page=${page}`), page).toBeNull();
    }
  });

  it("returns null when there is no page param or the id is unknown", () => {
    expect(redirect("")).toBeNull();
    expect(redirect("login=success")).toBeNull();
    expect(redirect("page=does-not-exist")).toBeNull();
    expect(redirect("page=constructor")).toBeNull();
  });

  it("covers every sidebar page id with the route the sidebar itself links to", () => {
    const leaves = menuGroups.flatMap((group) => group.items.flatMap((item) => item.children ?? [item]));
    expect(leaves.length).toBeGreaterThan(20);
    for (const leaf of leaves) {
      expect(redirect(`page=${leaf.page}`), leaf.page).toBe(`/ui/${leaf.route ?? leaf.page}`);
    }
  });
});
