import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearTokenCookies } from "@/utils/cookieUtils";
import * as Networking from "./networking";
import { uiHref } from "@/utils/uiHref";

vi.mock("@/utils/cookieUtils", () => ({
  clearTokenCookies: vi.fn(),
  getCookie: vi.fn(),
  storeLoginToken: vi.fn(),
}));

describe("networking - expired session handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const loadFreshHandleError = async () => {
    vi.resetModules();
    const fresh = await import("./networking");
    return fresh.handleError;
  };

  const stubLocation = (pathname: string, search: string, hash: string) => {
    const location = { pathname, search, hash, href: "" };
    vi.stubGlobal("window", { location });
    return location;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the query string and hash on the redirect after session expiry", async () => {
    const handleError = await loadFreshHandleError();
    const location = stubLocation("/ui/api-keys/", "?filter_team=t1&page=2", "#row-3");

    await handleError("Authentication Error - Expired Key");

    expect(location.href).toBe("/ui/api-keys/?filter_team=t1&page=2#row-3");
    expect(clearTokenCookies).toHaveBeenCalledOnce();
  });

  it("does not navigate or clear cookies for other errors", async () => {
    const handleError = await loadFreshHandleError();
    const location = stubLocation("/ui/api-keys/", "?filter_team=t1&page=2", "");

    await handleError("Some other error");

    expect(location.href).toBe("");
    expect(clearTokenCookies).not.toHaveBeenCalled();
  });

  it("should surface backend detail error when updateSSOSettings fails", async () => {
    expect.hasAssertions();

    const backendError = {
      detail: {
        error: "Set `'STORE_MODEL_IN_DB='True'` in your env to enable this feature.",
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue(backendError),
    } as any);

    global.fetch = mockFetch as any;

    try {
      await Networking.updateSSOSettings("token", { some: "setting" });
    } catch (error) {
      const thrownError = error as any;
      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError.message).toBe(backendError.detail.error);
      expect(thrownError.detail).toEqual(backendError.detail);
      expect(thrownError.rawError).toEqual(backendError);
    }

    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe("loginCall - storeLoginToken integration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls storeLoginToken when response includes token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirect_url: "/ui/?login=success", token: "my-jwt" }),
    }) as any;
    const { storeLoginToken } = await import("@/utils/cookieUtils");
    await Networking.loginCall("admin", "pass");
    expect(storeLoginToken).toHaveBeenCalledWith("my-jwt");
  });

  it("does not call storeLoginToken when response has no token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirect_url: "/ui/?login=success" }),
    }) as any;
    const { storeLoginToken } = await import("@/utils/cookieUtils");
    await Networking.loginCall("admin", "pass");
    expect(storeLoginToken).not.toHaveBeenCalled();
  });
});

describe("exchangeLoginCode - storeLoginToken integration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls storeLoginToken when exchange response includes token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "sso-jwt" }),
    }) as unknown as typeof global.fetch;
    const { storeLoginToken } = await import("@/utils/cookieUtils");
    const token = await Networking.exchangeLoginCode("some-login-code");
    expect(token).toBe("sso-jwt");
    expect(storeLoginToken).toHaveBeenCalledWith("sso-jwt");
  });

  it("does not call storeLoginToken when exchange response has no token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof global.fetch;
    const { storeLoginToken } = await import("@/utils/cookieUtils");
    const token = await Networking.exchangeLoginCode("some-login-code");
    expect(token).toBeUndefined();
    expect(storeLoginToken).not.toHaveBeenCalled();
  });
});

describe("modelInfoCall", () => {
  let currentFetch: typeof global.fetch;

  beforeEach(() => {
    currentFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = currentFetch;
  });

  it("sends the exact model name as the model query param and leaves search alone", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ data: [] }) } as any);
    global.fetch = mockFetch as any;

    await Networking.modelInfoCall(
      "token",
      "user",
      "Admin",
      2,
      25,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      "gpt-4",
    );

    const parsed = new URL(mockFetch.mock.calls[0][0] as string, "http://example.com");
    expect(parsed.pathname).toBe("/v2/model/info");
    expect(parsed.searchParams.get("model")).toBe("gpt-4");
    expect(parsed.searchParams.has("search")).toBe(false);
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("exclude_auto_routers")).toBe("true");
  });
});

describe("UI config and public endpoints", () => {
  const originalFetch = global.fetch;

  const setupMockFetch = (responses: Array<{ url: string; data: any }>) => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const response = responses.find((r) => url.includes(r.url));
      if (response) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue(response.data),
          text: vi.fn().mockResolvedValue(JSON.stringify(response.data)),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue("{}"),
      } as any);
    });
    global.fetch = mockFetch as any;
    return mockFetch;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should use proxyBaseURL and server_root_path for /public/providers/fields when server_root_path is defined", async () => {
    const uiConfig = {
      server_root_path: "/api/v1",
      proxy_base_url: "https://example.com",
    };

    const mockFetch = setupMockFetch([
      { url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
      { url: "/public/providers/fields", data: [] },
    ]);

    // First call getUiConfig to set up proxyBaseUrl
    await Networking.getUiConfig();

    // Then call the public endpoint
    await Networking.getProviderCreateMetadata();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const publicEndpointCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("/public/providers/fields"),
    );
    expect(publicEndpointCall).toBeDefined();
    const calledUrl = publicEndpointCall![0] as string;
    expect(calledUrl).toBe("https://example.com/api/v1/public/providers/fields");
  });

  it("should not include server_root_path when it is root path", async () => {
    const uiConfig = {
      server_root_path: "/",
      proxy_base_url: "https://example.com",
    };

    const mockFetch = setupMockFetch([
      { url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
      { url: "/public/providers/fields", data: [] },
    ]);

    await Networking.getUiConfig();
    await Networking.getProviderCreateMetadata();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const publicEndpointCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("/public/providers/fields"),
    );
    expect(publicEndpointCall).toBeDefined();
    const calledUrl = publicEndpointCall![0] as string;
    expect(calledUrl).toBe("https://example.com/public/providers/fields");
  });

  it("should return UI config from getUiConfig", async () => {
    const uiConfig = {
      server_root_path: "/api/v1",
      proxy_base_url: "https://example.com",
    };

    const mockFetch = setupMockFetch([{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig }]);

    const result = await Networking.getUiConfig();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual(uiConfig);
    const configCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("/litellm/.well-known/litellm-ui-config"),
    );
    expect(configCall).toBeDefined();
  });

  it("updates serverRootPath so path-based nav links carry the root path", async () => {
    const uiConfig = {
      server_root_path: "/litellm",
      proxy_base_url: "https://example.com",
    };

    setupMockFetch([{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig }]);

    await Networking.getUiConfig();

    expect(Networking.serverRootPath).toBe("/litellm");
    expect(uiHref("api-reference")).toBe("/litellm/ui/api-reference");
  });

  it("sends model group connection probes to the configured gateway", async () => {
    const uiConfig = {
      server_root_path: "",
      proxy_base_url: "https://backend.example.com",
      gateway_base_url: "https://gateway.example.com",
    };
    const mockFetch = setupMockFetch([{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig }]);

    await Networking.getUiConfig();
    expect(await Networking.testModelGroupConnection("token", "chat-model", "chat")).toEqual({ status: "success" });
    expect(await Networking.testModelGroupConnection("token", "embedding-model", "embedding")).toEqual({
      status: "success",
    });

    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain("https://gateway.example.com/v1/chat/completions");
    expect(requestedUrls).toContain("https://gateway.example.com/v1/embeddings");
  });

  it("falls back to the proxy URL for model group probes when the gateway is unset", async () => {
    const uiConfig = {
      server_root_path: "",
      proxy_base_url: "https://backend.example.com",
    };
    const mockFetch = setupMockFetch([{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig }]);

    await Networking.getUiConfig();
    expect(await Networking.testModelGroupConnection("token", "embedding-model", "embedding")).toEqual({
      status: "success",
    });

    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain("https://backend.example.com/v1/embeddings");
  });
});

describe("individualModelHealthCheckCall", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should call /health with model_id query param so health checks run by deployment id", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        healthy_count: 1,
        unhealthy_count: 0,
        healthy_endpoints: [],
        unhealthy_endpoints: [],
      }),
    } as any);
    global.fetch = mockFetch as any;

    await Networking.individualModelHealthCheckCall("token-123", "deployment-abc-456");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    const urlStr = typeof url === "string" ? url : (url as Request).url;
    expect(urlStr).toContain("health");
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
    expect(parsed.searchParams.get("model_id")).toBe("deployment-abc-456");
    expect(parsed.searchParams.has("model")).toBe(false);
  });

  it("should encode model_id in URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        healthy_count: 0,
        unhealthy_count: 0,
        healthy_endpoints: [],
        unhealthy_endpoints: [],
      }),
    } as any);
    global.fetch = mockFetch as any;

    await Networking.individualModelHealthCheckCall("token", "id/with/slashes");

    const [url] = mockFetch.mock.calls[0];
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
    expect(parsed.searchParams.get("model_id")).toBe("id/with/slashes");
  });
});

describe("teamInfoCall", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should URL-encode team_id query param to handle special characters safely", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ team_id: "team with spaces & special?chars" })),
    } as any);
    global.fetch = mockFetch as any;

    const teamID = "team with spaces & special?chars";
    await Networking.teamInfoCall("token", teamID);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    const urlStr = typeof url === "string" ? url : (url as Request).url;
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);

    expect(urlStr).toContain("/team/info");
    // Special characters are encoded (not present raw) and round-trip back to the original
    expect(urlStr).not.toContain("team with spaces");
    expect(parsed.searchParams.get("team_id")).toBe(teamID);
  });

  it("passes key_limit when requested", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      await Networking.teamInfoCall("token", "team-1", { keyLimit: 1 });

      const [url] = mockFetch.mock.calls[0];
      const parsed = url instanceof Request ? new URL(url.url) : new URL(url.toString(), "http://example.com");
      expect(parsed.searchParams.get("key_limit")).toBe("1");
    } finally {
      mockFetch.mockRestore();
    }
  });

  it("should not append team_id when teamID is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("{}"),
    } as any);
    global.fetch = mockFetch as any;

    await Networking.teamInfoCall("token", null);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
    expect(parsed.searchParams.has("team_id")).toBe(false);
    expect(parsed.searchParams.has("key_limit")).toBe(false);
  });
});

describe("uiSpendLogsCall exclude_internal_health_checks serialization", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockOkFetch = () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, page_size: 50, total_pages: 0 }),
    } as any);
    global.fetch = mockFetch as any;
    return mockFetch;
  };

  const callWith = (params: Parameters<typeof Networking.uiSpendLogsCall>[0]["params"]) =>
    Networking.uiSpendLogsCall({
      accessToken: "token",
      start_date: "2026-01-01 00:00:00",
      end_date: "2026-01-02 00:00:00",
      params,
    });

  const lastUrl = (mockFetch: ReturnType<typeof vi.fn>) => {
    const [url] = mockFetch.mock.calls.at(-1) ?? [];
    return new URL(url as string, "http://example.com");
  };

  it("appends exclude_internal_health_checks=true when the toggle is on", async () => {
    const mockFetch = mockOkFetch();

    await callWith({ exclude_internal_health_checks: true });

    expect(lastUrl(mockFetch).searchParams.get("exclude_internal_health_checks")).toBe("true");
  });

  it("omits exclude_internal_health_checks when the toggle is off", async () => {
    const mockFetch = mockOkFetch();

    await callWith({ exclude_internal_health_checks: false });

    expect(lastUrl(mockFetch).searchParams.has("exclude_internal_health_checks")).toBe(false);
  });

  it("omits exclude_internal_health_checks when the param is absent", async () => {
    const mockFetch = mockOkFetch();

    await callWith({});

    expect(lastUrl(mockFetch).searchParams.has("exclude_internal_health_checks")).toBe(false);
  });
});

describe("uiSpendLogDetailsCall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["chatcmpl-123#a1", "chatcmpl-123?a=1", "chatcmpl-123%41b", "chatcmpl-123 a&b"])(
    "requests the details of %s with the full request id and start date",
    async (logId) => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ id: logId }) });
      vi.stubGlobal("fetch", mockFetch);

      await Networking.uiSpendLogDetailsCall("token", logId, "2026-01-01 00:00:00");

      const url = new URL(String(mockFetch.mock.calls.at(-1)?.[0]), "http://example.com");
      expect(decodeURIComponent(url.pathname.split("/spend/logs/ui/")[1])).toBe(logId);
      expect(url.hash).toBe("");
      expect([...url.searchParams.entries()]).toEqual([["start_date", "2026-01-01 00:00:00"]]);
    },
  );
});

describe("sessionSpendLogsCall", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should request the first page with defaults so the caller can page through the session", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, page_size: 100, total_pages: 1 }),
    } as any);
    global.fetch = mockFetch as any;

    await Networking.sessionSpendLogsCall("token", "session-123");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    const urlStr = typeof url === "string" ? url : (url as Request).url;
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);

    expect(urlStr).toContain("/spend/logs/session/ui");
    expect(parsed.searchParams.get("session_id")).toBe("session-123");
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("page_size")).toBe("100");
  });

  it("should pass explicit page and page_size query params for later pages", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [], total: 250, page: 3, page_size: 100, total_pages: 3 }),
    } as any);
    global.fetch = mockFetch as any;

    await Networking.sessionSpendLogsCall("token", "session-123", 3, 100);

    const [url] = mockFetch.mock.calls[0];
    const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("page_size")).toBe("100");
  });
});

describe("buildModelGroupTestRequest", () => {
  it("builds a chat completion request with NO max_tokens (reasoning models 400 on a tiny cap)", () => {
    const { path, body } = Networking.buildModelGroupTestRequest("o3", "chat");
    expect(path).toBe("/v1/chat/completions");
    expect(body).toEqual({ model: "o3", messages: [{ role: "user", content: "test from litellm" }] });
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("builds an embeddings request for embedding mode", () => {
    const { path, body } = Networking.buildModelGroupTestRequest("text-embedding-3-small", "embedding");
    expect(path).toBe("/v1/embeddings");
    expect(body).toEqual({ model: "text-embedding-3-small", input: "test from litellm" });
  });

  it("adds classifier request parameters to a chat probe", () => {
    const { body } = Networking.buildModelGroupTestRequest("gpt-5-mini", "chat", { reasoning_effort: "low" });
    expect(body).toEqual({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "test from litellm" }],
      reasoning_effort: "low",
    });
  });
});

describe("getAutoRouterClassifierDefaultPromptCall", () => {
  const originalFetch = global.fetch;

  const captureFetch = () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({ system_prompt: "rubric" }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ system_prompt: "rubric" })),
    } as any);
    global.fetch = mockFetch as any;
    return mockFetch;
  };

  const requestedUrl = (mockFetch: ReturnType<typeof vi.fn>): string => String(mockFetch.mock.calls[0][0]);

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends renamed tiers as a JSON object so the rubric names them", async () => {
    const mockFetch = captureFetch();

    await Networking.getAutoRouterClassifierDefaultPromptCall("sk-key", 5, { SIMPLE: "Cheap" });

    const url = requestedUrl(mockFetch);
    expect(url).toContain("context_window_size=5");
    expect(decodeURIComponent(url)).toContain('tier_labels={"SIMPLE":"Cheap"}');
  });

  it("omits tier_labels entirely when nothing was renamed", async () => {
    const mockFetch = captureFetch();

    await Networking.getAutoRouterClassifierDefaultPromptCall("sk-key", 5);
    await Networking.getAutoRouterClassifierDefaultPromptCall("sk-key", 5, {});

    expect(requestedUrl(mockFetch)).not.toContain("tier_labels");
    expect(String(mockFetch.mock.calls[1][0])).not.toContain("tier_labels");
  });
});

describe("userListCall search serialization", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockOkFetch = () => {
    const emptyPage = { users: [], total: 0, page: 1, page_size: 25, total_pages: 0 };
    const body = JSON.stringify(emptyPage);
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } }));
    global.fetch = mockFetch;
    return mockFetch;
  };

  const lastParams = (mockFetch: ReturnType<typeof vi.fn>) => {
    const [url] = mockFetch.mock.calls.at(-1) ?? [];
    return new URL((url as Request).url).searchParams;
  };

  it("sends the combined search term as search, not user_email", async () => {
    const mockFetch = mockOkFetch();

    await Networking.userListCall("token", null, 1, 25, null, null, null, null, null, null, null, "a6f5c02b");

    expect(lastParams(mockFetch).get("search")).toBe("a6f5c02b");
    expect(lastParams(mockFetch).has("user_email")).toBe(false);
  });

  it("omits search when no search term is given and keeps user_email as before", async () => {
    const mockFetch = mockOkFetch();

    await Networking.userListCall("token", null, 1, 25, "ada@example.com");

    expect(lastParams(mockFetch).has("search")).toBe(false);
    expect(lastParams(mockFetch).get("user_email")).toBe("ada@example.com");
  });
});

describe("userFilterUICall", () => {
  let currentFetch: typeof global.fetch;

  beforeEach(() => {
    currentFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = currentFetch;
  });

  it("forwards the search param to /user/filter/ui", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "[]" } as any);
    global.fetch = mockFetch as any;

    await Networking.userFilterUICall("sk-test", new URLSearchParams({ search: "svc" }));

    const parsed = new URL(mockFetch.mock.calls[0][0] as string, "http://localhost");
    expect(parsed.pathname).toContain("/user/filter/ui");
    expect(parsed.searchParams.get("search")).toBe("svc");
  });
});

describe("schema-bound dashboard responses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps nullable user fields without asserting they are strings", async () => {
    const user = { user_id: "user-1", user_email: null, user_role: null, created_at: null };
    const page = { users: [user], total: 1, page: 1, page_size: 25, total_pages: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(page))));
    const result = await Networking.userListCall("explicit-token");
    expect(result.users[0]).toEqual(user);
  });
});

describe("modelCostMap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the catalog-only map when catalogOnly is set and the full map otherwise", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({})));
    vi.stubGlobal("fetch", mockFetch);

    await Networking.modelCostMap(true);
    await Networking.modelCostMap();

    expect(mockFetch.mock.calls[0][0]).toMatch(/\/public\/litellm_model_cost_map\?catalog_only=true$/);
    expect(mockFetch.mock.calls[1][0]).toMatch(/\/public\/litellm_model_cost_map$/);
  });
});

describe("getUiConfig runtime backend discovery", () => {
  const discoveryConfig = () => ({
    server_root_path: "/",
    proxy_base_url: null,
    gateway_base_url: null,
    auto_redirect_to_sso: false,
    admin_ui_disabled: false,
    sso_configured: false,
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const loadFreshNetworking = async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { origin: "https://ui.example.com" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_USE_REWRITES", "true");
    vi.resetModules();
    return import("./networking");
  };

  const loadNetworkingWithGateway = async (gatewayBaseUrl: string | null) => {
    const backendBaseUrl = "https://backend.example.com";
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "/ui/litellm-runtime-config.json") {
        return new Response(JSON.stringify({ backend_url: backendBaseUrl }));
      }
      if (url === `${backendBaseUrl}/litellm/.well-known/litellm-ui-config`) {
        return new Response(
          JSON.stringify({
            ...discoveryConfig(),
            proxy_base_url: backendBaseUrl,
            gateway_base_url: gatewayBaseUrl,
          }),
        );
      }
      if (url.endsWith("/v1/indexes")) {
        return new Response(JSON.stringify({ object: "list", data: [] }));
      }
      if (url.endsWith("/v1/a2a/discover")) {
        return new Response(JSON.stringify({ agent_card: {}, url: "https://agent.example.com" }));
      }
      return new Response("{}");
    });
    vi.stubGlobal("fetch", mockFetch);
    const networking = await loadFreshNetworking();
    await networking.getUiConfig();
    return { networking, mockFetch };
  };

  it("uses a normalized runtime backend URL for discovery and the management fallback", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ backend_url: "  https://backend.example.com///  " }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...discoveryConfig(),
          gateway_base_url: "  https://gateway.example.com/// ",
        }),
      } as Response);
    vi.stubGlobal("fetch", mockFetch);
    const networking = await loadFreshNetworking();

    await networking.getUiConfig();

    expect(mockFetch).toHaveBeenNthCalledWith(1, "/ui/litellm-runtime-config.json", { cache: "no-store" });
    expect(mockFetch.mock.calls[1][0]).toBe("https://backend.example.com/litellm/.well-known/litellm-ui-config");
    expect(networking.getProxyBaseUrl().replace(/\/+$/, "")).toBe("https://backend.example.com");
    expect(networking.getGatewayBaseUrl()).toBe("https://gateway.example.com");

    networking.switchToWorkerUrl("https://worker.example.com");
    expect(networking.getGatewayBaseUrl()).toBe("https://worker.example.com");
    networking.switchToWorkerUrl(null);
    expect(networking.getGatewayBaseUrl()).toBe("https://gateway.example.com");
  });

  it.each([
    ["404", { ok: false }],
    [
      "HTML 200",
      {
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      },
    ],
  ])("keeps discovery behavior when runtime config returns %s", async (_label, runtimeResponse) => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(runtimeResponse as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => discoveryConfig() } as Response);
    vi.stubGlobal("fetch", mockFetch);
    const networking = await loadFreshNetworking();

    await networking.getUiConfig();

    expect(mockFetch).toHaveBeenNthCalledWith(1, "/ui/litellm-runtime-config.json", { cache: "no-store" });
    expect(mockFetch.mock.calls[1][0]).toBe("/litellm/.well-known/litellm-ui-config");
    expect(networking.getGatewayBaseUrl()).toBe(networking.getProxyBaseUrl());
  });

  it("fetches model availability from the gateway and falls back to the backend when unset", async () => {
    const { networking, mockFetch } = await loadNetworkingWithGateway("https://gateway.example.com");
    await networking.modelAvailableCall("token", "user-1", "Admin");

    const gatewayRequestUrl = new URL(String(mockFetch.mock.calls.at(-1)?.[0]));
    expect(gatewayRequestUrl.origin).toBe("https://gateway.example.com");
    expect(gatewayRequestUrl.pathname).toBe("/models");

    const fallback = await loadNetworkingWithGateway(null);
    await fallback.networking.modelAvailableCall("token", "user-1", "Admin");

    const fallbackRequestUrl = new URL(String(fallback.mockFetch.mock.calls.at(-1)?.[0]));
    expect(fallbackRequestUrl.origin).toBe("https://backend.example.com");
    expect(fallbackRequestUrl.pathname).toBe("/models");
  });
});
