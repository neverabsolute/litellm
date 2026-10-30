import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, testQueryClient, waitFor, within } from "../../../../tests/test-utils";
import IpAnalyticsPage from "./page";

const { useAuthorizedMock } = vi.hoisted(() => ({ useAuthorizedMock: vi.fn() }));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({ default: useAuthorizedMock }));

const KEY_HASH = "88dc28d0f030c55ed4ab77ed8faf098196cb1c05df778539800c9f1243fe6b4b";

const SUMMARY = {
  start_date: "2026-10-23",
  end_date: "2026-10-30",
  ips: [
    {
      ip_address: "203.0.113.7",
      successful_requests: 120,
      failed_requests: 3,
      denied_requests: 2,
      spend: 1.5,
      total_tokens: 4000,
      distinct_keys: 1,
      last_seen_at: "2026-10-30T10:00:00Z",
    },
    {
      ip_address: "198.51.100.9",
      successful_requests: 0,
      failed_requests: 0,
      denied_requests: 40,
      spend: 0,
      total_tokens: 0,
      distinct_keys: 0,
      last_seen_at: "2026-10-30T11:00:00Z",
    },
  ],
};

const denial = (overrides: Record<string, unknown>) => ({
  date: "2026-10-30",
  ip_address: "198.51.100.9",
  route: "/chat/completions",
  status_code: 403,
  reason: "ip_not_allowed_key",
  api_key: KEY_HASH,
  denied_requests: 40,
  last_seen_at: "2026-10-30T11:00:00Z",
  ...overrides,
});

const UNAUTHENTICATED_DENIAL = {
  ip_address: "203.0.113.7",
  route: "/key/info",
  status_code: 401,
  reason: "auth_error",
  api_key: "",
};

const DENIED = {
  start_date: "2026-10-23",
  end_date: "2026-10-30",
  denied: [denial({}), denial(UNAUTHENTICATED_DENIAL)],
};

const DETAIL = {
  ip_address: "203.0.113.7",
  by_key: [
    {
      api_key: KEY_HASH,
      key_alias: "ci-runner",
      successful_requests: 120,
      failed_requests: 3,
      spend: 1.5,
      total_tokens: 4000,
    },
  ],
  denied: [denial({ ip_address: "203.0.113.7", reason: "ip_not_allowed_global", denied_requests: 2 })],
};

const BODIES: Record<string, unknown> = {
  "/ip_analytics/summary": SUMMARY,
  "/ip_analytics/denied": DENIED,
  "/ip_analytics/ip": DETAIL,
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return new Response(JSON.stringify(BODIES[url.pathname] ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

const requestedUrls = (): URL[] =>
  fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)));

const renderAs = (userRole: string) => {
  useAuthorizedMock.mockReturnValue({ accessToken: "sk-test", userId: "u1", userRole });
  return renderWithProviders(<IpAnalyticsPage />);
};

describe("IP Analytics page", () => {
  beforeEach(() => {
    testQueryClient.clear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists each caller address with its request counts for the last seven days", async () => {
    renderAs("proxy_admin");

    expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.9")).toBeInTheDocument();

    const summaryUrl = requestedUrls().find((url) => url.pathname === "/ip_analytics/summary") as URL;
    const days =
      (Date.parse(summaryUrl.searchParams.get("end_date") as string) -
        Date.parse(summaryUrl.searchParams.get("start_date") as string)) /
      86_400_000;
    expect(days).toBe(7);
  });

  it("opens the detail for a clicked address with its keys and denials", async () => {
    renderAs("proxy_admin_viewer");

    await userEvent.click(await screen.findByText("203.0.113.7"));

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("ci-runner")).toBeInTheDocument();
    expect(within(sheet).getByText("IP not in global allow-list")).toBeInTheDocument();
    const detailUrl = requestedUrls().find((url) => url.pathname === "/ip_analytics/ip") as URL;
    expect(detailUrl.searchParams.get("ip_address")).toBe("203.0.113.7");
  });

  it("labels each denial reason in the denied requests tab", async () => {
    renderAs("proxy_admin");

    await userEvent.click(await screen.findByRole("tab", { name: "Denied Requests" }));

    expect(await screen.findByText("IP not allowed for this key")).toBeInTheDocument();
    expect(screen.getByText("Authentication failed")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it.each(["Internal User", "org_admin"])("shows a notice and fires no request for %s", async (userRole) => {
    renderAs(userRole);

    expect(await screen.findByText("IP Analytics is only available to proxy admins.")).toBeInTheDocument();
    await waitFor(() => expect(requestedUrls()).toEqual([]));
  });
});
