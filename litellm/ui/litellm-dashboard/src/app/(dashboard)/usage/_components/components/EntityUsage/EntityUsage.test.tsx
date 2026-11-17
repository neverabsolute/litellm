import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useInfiniteUsers } from "@/app/(dashboard)/hooks/users/useUsers";
import useTeams from "@/app/(dashboard)/hooks/useTeams";
import * as networking from "@/components/networking";
import type {
  DailyData,
  KeyMetadata,
  KeyMetricWithMetadata,
  ModelActivityData,
  SpendMetrics,
} from "@/components/UsagePage/types";
import EntityUsage from "./EntityUsage";
import { getGlobalTopKeys, getTopAPIKeys } from "./entityUsageAggregations";

type EntityUsageProps = ComponentProps<typeof EntityUsage>;

function StatefulEntityUsage(props: Omit<EntityUsageProps, "selectedEntities" | "onSelectedEntitiesChange">) {
  const [selectedEntities, setSelectedEntities] = useState<readonly string[]>([]);
  return <EntityUsage {...props} selectedEntities={selectedEntities} onSelectedEntitiesChange={setSelectedEntities} />;
}

const emptySpendMetrics: SpendMetrics = {
  spend: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  api_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const createKeyMetrics = (spend: number, metadata: KeyMetadata): KeyMetricWithMetadata => ({
  metrics: { ...emptySpendMetrics, spend },
  metadata,
});

const createDailyData = (date: string, apiKeys: Record<string, KeyMetricWithMetadata>): DailyData => ({
  date,
  metrics: { ...emptySpendMetrics },
  breakdown: {
    models: {},
    model_groups: {},
    mcp_servers: {},
    providers: {},
    api_keys: apiKeys,
    entities: {},
  },
});

beforeAll(() => {
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  }
});

// Mock the networking module
vi.mock("@/components/networking", () => ({
  dailyActivityAggregatedCall: vi.fn(),
  dailyActivityKeyPageCall: vi.fn(),
  dailyActivityKeySearchCall: vi.fn(),
  dailyActivityModelTopKeysCall: vi.fn(),
  dailyActivityExportCall: vi.fn(),
}));

// Mock the child components to simplify testing
vi.mock("@/components/activity_metrics", () => ({
  ActivityMetrics: ({
    modelMetrics,
    summaryMetrics,
    summaryTitle = "Overall Usage",
    fetchTopApiKeys,
  }: {
    modelMetrics?: { __source?: string };
    summaryMetrics?: ModelActivityData;
    summaryTitle?: string;
    fetchTopApiKeys?: (model: string) => Promise<unknown>;
  }) => (
    <div>
      <span>Activity Metrics</span>
      <span>{`metrics-source:${modelMetrics?.__source ?? "none"}`}</span>
      {summaryMetrics !== undefined && <span>{summaryTitle}</span>}
      {fetchTopApiKeys !== undefined && <span>{`top-keys-fetcher:${modelMetrics?.__source ?? "none"}`}</span>}
    </div>
  ),
  processActivityData: (_data: unknown, key: string) => ({ __source: key }),
}));

vi.mock("../EndpointUsage/EndpointUsage", () => ({
  default: () => <div>Endpoint Usage Panel</div>,
}));

vi.mock("@/components/UsagePage/components/EntityUsage/TopKeyView", () => ({
  default: ({ topKeys }: { topKeys: { api_key: string; user?: string | null; spend: number }[] }) => (
    <div>
      <span>Top Keys</span>
      <span>{`top-keys:${topKeys.map((row) => `${row.api_key}=${row.spend}=${row.user ?? "-"}`).join("|")}`}</span>
    </div>
  ),
}));

vi.mock("./TopModelView", () => ({
  default: ({ topModels }: { topModels: { key: string; spend: number }[] }) => (
    <div>
      <span>Top Models</span>
      <span>{`top-models:${topModels.map((row) => `${row.key}=${row.spend}`).join("|")}`}</span>
    </div>
  ),
}));

vi.mock("./TeamUserSpendCard", () => ({
  default: ({ teamIds }: { teamIds: readonly string[] }) => <div>{`team-user-spend:${teamIds.join("|")}`}</div>,
}));

vi.mock("@/components/EntityUsageExport/EntityUsageExportModal", () => ({
  default: () => <div>Entity Usage Export Modal</div>,
}));

vi.mock("@/components/EntityUsageExport", () => ({
  UsageExportHeader: ({
    filterLabel,
    filterSlot,
    showFilters,
  }: {
    filterLabel?: string;
    filterSlot?: ReactNode;
    showFilters?: boolean;
  }) => (
    <div>
      <span>Usage Export Header</span>
      <span>{filterLabel}</span>
      <span>{`show-filters:${showFilters === true}`}</span>
      {filterSlot}
    </div>
  ),
}));

vi.mock("@/app/(dashboard)/hooks/users/useUsers", () => ({
  useInfiniteUsers: vi.fn(),
  useUserLookup: vi.fn(() => ({ data: null })),
}));

vi.mock("@/components/common_components/team_multi_select", () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button onClick={() => onChange(["team-1"])}>Team Multi Select</button>
  ),
}));

vi.mock("@/components/common_components/CustomerMultiSelect", () => ({
  default: ({ value, onChange }: { value: readonly string[]; onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["customer-1", "customer-2"])}>Customer Multi Select {value.join(",")}</button>
  ),
}));

// Mock useTeams hook
vi.mock("@/app/(dashboard)/hooks/useTeams", () => ({
  default: vi.fn(() => ({
    teams: [],
    setTeams: vi.fn(),
  })),
}));

describe("EntityUsage", () => {
  const mockDailyActivityAggregatedCall = vi.mocked(networking.dailyActivityAggregatedCall);
  const mockDailyActivityKeyPageCall = vi.mocked(networking.dailyActivityKeyPageCall);
  const mockTagDailyActivityCall = vi.fn();
  const mockTeamDailyActivityCall = vi.fn();
  const mockOrganizationDailyActivityCall = vi.fn();
  const mockCustomerDailyActivityCall = vi.fn();
  const mockUserDailyActivityCall = vi.fn();
  const entityMocks: Record<string, ReturnType<typeof vi.fn>> = {
    tag: mockTagDailyActivityCall,
    team: mockTeamDailyActivityCall,
    organization: mockOrganizationDailyActivityCall,
    customer: mockCustomerDailyActivityCall,
    user: mockUserDailyActivityCall,
  };
  const mockUseInfiniteUsers = vi.mocked(useInfiniteUsers);

  const infiniteUsersResult = (users: { user_id: string; user_alias: string | null; user_email: string | null }[]) =>
    ({
      data: { pages: [{ users, page: 1, total_pages: 1, total_count: users.length }], pageParams: [1] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    }) as unknown as ReturnType<typeof useInfiniteUsers>;

  const mockSpendData = {
    results: [
      {
        date: "2025-01-01",
        metrics: {
          spend: 100.5,
          api_requests: 1000,
          successful_requests: 950,
          failed_requests: 50,
          total_tokens: 50000,
          prompt_tokens: 30000,
          completion_tokens: 20000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        breakdown: {
          entities: {
            "tag-1": {
              metrics: {
                spend: 60.3,
                api_requests: 600,
                successful_requests: 570,
                failed_requests: 30,
                total_tokens: 30000,
                prompt_tokens: 18000,
                completion_tokens: 12000,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
              metadata: {
                team_alias: "Tag 1",
              },
              api_key_breakdown: {},
            },
          },
          models: {},
          api_keys: {},
          providers: {
            openai: {
              metrics: {
                spend: 100.5,
                api_requests: 1000,
                successful_requests: 950,
                failed_requests: 50,
                total_tokens: 50000,
                prompt_tokens: 30000,
                completion_tokens: 20000,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          },
        },
      },
    ],
    metadata: {
      total_spend: 100.5,
      total_api_requests: 1000,
      total_successful_requests: 950,
      total_failed_requests: 50,
      total_tokens: 50000,
    },
  };

  const defaultProps = {
    accessToken: "test-token",
    entityType: "tag" as const,
    entityId: "test-tag",
    userID: "user-123",
    userRole: "Admin",
    entityList: [
      { label: "Tag 1", value: "tag-1" },
      { label: "Tag 2", value: "tag-2" },
    ],
    premiumUser: true,
    dateValue: {
      from: new Date("2025-01-01"),
      to: new Date("2025-01-31"),
    },
  };

  beforeEach(() => {
    mockDailyActivityAggregatedCall.mockReset();
    mockDailyActivityKeyPageCall.mockReset();
    const emptyKeyPage = {
      api_keys: [],
      total_api_keys: 0,
      offset: 0,
      limit: 50,
    };
    mockDailyActivityKeyPageCall.mockResolvedValue(emptyKeyPage);
    mockDailyActivityAggregatedCall.mockImplementation((entity, request) =>
      (
        entityMocks[entity] as unknown as (
          req: typeof request,
        ) => ReturnType<typeof networking.dailyActivityAggregatedCall>
      )(request),
    );
    Object.values(entityMocks).forEach((mock) => mock.mockClear());
    mockTagDailyActivityCall.mockResolvedValue(mockSpendData);
    mockTeamDailyActivityCall.mockResolvedValue(mockSpendData);
    mockOrganizationDailyActivityCall.mockResolvedValue(mockSpendData);
    mockCustomerDailyActivityCall.mockResolvedValue(mockSpendData);
    mockUserDailyActivityCall.mockResolvedValue(mockSpendData);
    mockUseInfiniteUsers.mockClear();
    mockUseInfiniteUsers.mockReturnValue(
      infiniteUsersResult([
        { user_id: "user-001", user_alias: "Alice", user_email: "alice@example.com" },
        { user_id: "user-002", user_alias: null, user_email: "bob@example.com" },
      ]),
    );
  });

  describe("top key aggregations", () => {
    it("sums, sorts, limits, and carries email attribution for global top keys", () => {
      const results = [
        createDailyData("2025-01-01", {
          "key-low": createKeyMetrics(10, { key_alias: "Low", team_id: null, user_email: "low@example.com" }),
          "key-high": createKeyMetrics(25, { key_alias: "High", team_id: null, user_email: "high@example.com" }),
        }),
        createDailyData("2025-01-02", {
          "key-low": createKeyMetrics(30, { key_alias: "Low", team_id: null, user_email: "low@example.com" }),
        }),
      ];

      expect(getGlobalTopKeys(results, 1)).toEqual([
        {
          api_key: "key-low",
          key_alias: "Low",
          user: "low@example.com",
          tags: [],
          spend: 40,
        },
      ]);
    });

    it("falls back to user ID attribution for global and entity top keys", () => {
      const results = [
        createDailyData("2025-01-01", {
          "key-123": createKeyMetrics(12.5, { key_alias: "User ID key", team_id: null, user_id: "user-123" }),
        }),
      ];

      expect(getGlobalTopKeys(results, 5)[0]?.user).toBe("user-123");
      expect(getTopAPIKeys(results, 5)[0]?.user).toBe("user-123");
    });

    it("carries whether each key still exists for global and entity top keys", () => {
      const results = [
        createDailyData("2025-01-01", {
          "stored-key": createKeyMetrics(20, { key_alias: "Stored", team_id: null, key_exists: true }),
          "session-key": createKeyMetrics(10, { key_alias: null, team_id: null, key_exists: false }),
        }),
      ];
      const existsByKey = (rows: { api_key: string; key_exists?: boolean | null }[]) =>
        Object.fromEntries(rows.map((row) => [row.api_key, row.key_exists]));

      expect(existsByKey(getGlobalTopKeys(results, 5))).toEqual({ "stored-key": true, "session-key": false });
      expect(existsByKey(getTopAPIKeys(results, 5))).toEqual({ "stored-key": true, "session-key": false });
    });
  });

  it("should render with tag entity type and display spend metrics", async () => {
    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Tag Spend Overview")).toBeInTheDocument();
    expect(screen.getByText("Total Spend")).toBeInTheDocument();

    await waitFor(() => {
      const spendElements = screen.getAllByText("$100.50");
      expect(spendElements.length).toBeGreaterThan(0);
    });

    // Scoped to the active Cost tab: the keep-mounted Key Activity tab shows the same totals.
    expect(within(screen.getByRole("tabpanel")).getByText("1,000")).toBeInTheDocument(); // Total Requests
  });

  it("should render with team entity type and call team API", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(mockTeamDailyActivityCall).toHaveBeenCalled();
    });

    // Check that it shows team-specific label
    expect(screen.getByText("Team Spend Overview")).toBeInTheDocument();

    await waitFor(() => {
      const spendElements = screen.getAllByText("$100.50");
      expect(spendElements.length).toBeGreaterThan(0);
    });
  });

  it("feeds the per-user spend card every visible team except the dashboard team, only for teams", async () => {
    const mockUseTeams = vi.mocked(useTeams);
    const teamsResult = (teams: { team_id: string }[]) =>
      ({ teams, setTeams: vi.fn() }) as unknown as ReturnType<typeof useTeams>;
    mockUseTeams.mockReturnValue(
      teamsResult([{ team_id: "team-alpha" }, { team_id: "litellm-dashboard" }, { team_id: "team-beta" }]),
    );

    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);
    expect(await screen.findByText("team-user-spend:team-alpha|team-beta")).toBeInTheDocument();

    cleanup();
    mockUseTeams.mockReturnValue(teamsResult([]));
    render(<StatefulEntityUsage {...defaultProps} entityType="tag" />);
    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });
    expect(screen.queryByText(/^team-user-spend:/)).not.toBeInTheDocument();
  });

  it("should render with organization entity type and call organization API", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="organization" />);

    await waitFor(() => {
      expect(mockOrganizationDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Organization Spend Overview")).toBeInTheDocument();

    await waitFor(() => {
      const spendElements = screen.getAllByText("$100.50");
      expect(spendElements.length).toBeGreaterThan(0);
    });
  });

  it("should render with customer entity type and call customer API", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="customer" />);

    await waitFor(() => {
      expect(mockCustomerDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Customer Spend Overview")).toBeInTheDocument();

    await waitFor(() => {
      const spendElements = screen.getAllByText("$100.50");
      expect(spendElements.length).toBeGreaterThan(0);
    });
  });

  it("should render with user entity type and call user API", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="user" />);

    await waitFor(() => {
      expect(mockUserDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("User Spend Overview")).toBeInTheDocument();

    await waitFor(() => {
      const spendElements = screen.getAllByText("$100.50");
      expect(spendElements.length).toBeGreaterThan(0);
    });
  });

  it("should switch between tabs", async () => {
    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Tag Spend Overview")).toBeInTheDocument();

    const modelActivityTab = screen.getByText("Model Activity");
    act(() => {
      fireEvent.click(modelActivityTab);
    });

    expect(screen.getAllByText("Activity Metrics")[0]).toBeInTheDocument();

    const keyActivityTab = screen.getByText("Key Activity");
    act(() => {
      fireEvent.click(keyActivityTab);
    });

    expect(within(screen.getByRole("tabpanel")).getByRole("heading", { name: "Overall Usage" })).toBeInTheDocument();
  });

  it("loads key pages separately from the aggregate using the current entity scope", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(mockTeamDailyActivityCall).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("Team Multi Select"));
    await waitFor(() => {
      expect(mockTeamDailyActivityCall).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(screen.getByText("Key Activity"));
    await waitFor(() => {
      expect(mockDailyActivityKeyPageCall).toHaveBeenCalledWith(
        "team",
        expect.objectContaining({ entityIds: ["team-1"] }),
        0,
        50,
      );
    });
    expect(mockDailyActivityAggregatedCall.mock.lastCall?.[1]).not.toHaveProperty("apiKeyLimit");

    const pageCallsBeforeFilterChange = mockDailyActivityKeyPageCall.mock.calls.length;
    fireEvent.click(screen.getByText("Team Multi Select"));

    await waitFor(() => {
      expect(mockDailyActivityKeyPageCall.mock.calls.length).toBeGreaterThan(pageCallsBeforeFilterChange);
    });
    expect(mockDailyActivityKeyPageCall.mock.lastCall?.[1]).toEqual(expect.objectContaining({ entityIds: ["team-1"] }));
  });

  // An inactive tab panel is marked aria-selected="false" by one tab library and hidden by the
  // other, so treat either as "not on screen" and the assertion holds whichever one is rendering.
  const isShowing = (element: HTMLElement): boolean => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.hasAttribute("hidden")) return false;
      if (node.getAttribute("aria-selected") === "false") return false;
    }
    return true;
  };

  const showingCount = (marker: string): number => screen.queryAllByText(marker).filter(isShowing).length;

  const showingText = (text: string): HTMLElement => {
    const [element] = screen.getAllByText(text).filter(isShowing);
    expect(element).toBeDefined();
    return element;
  };

  const NON_TEAM_PANELS: [string, string][] = [
    ["Cost", "Tag Spend Overview"],
    ["Model Activity", "metrics-source:model_groups"],
    ["Key Activity", "Overall Usage"],
    ["Endpoint Activity", "Endpoint Usage Panel"],
  ];

  it.each(NON_TEAM_PANELS)("shows only the %s panel for a non-team entity type", async (tabLabel, marker) => {
    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    act(() => {
      fireEvent.click(screen.getByText(tabLabel));
    });

    expect(showingCount(marker)).toBeGreaterThan(0);
    for (const [otherLabel, otherMarker] of NON_TEAM_PANELS) {
      if (otherLabel === tabLabel) continue;
      expect(showingCount(otherMarker)).toBe(0);
    }
  });

  const TEAM_PANELS: [string, string][] = [
    ["Cost", "Team Spend Overview"],
    ["Model Activity", "metrics-source:model_groups"],
    ["Key Activity", "Overall Usage"],
    ["Endpoint Activity", "Endpoint Usage Panel"],
  ];

  it.each(TEAM_PANELS)("shows only the %s panel for the team entity type", async (tabLabel, marker) => {
    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(mockTeamDailyActivityCall).toHaveBeenCalled();
    });

    act(() => {
      fireEvent.click(screen.getByText(tabLabel));
    });

    expect(showingCount(marker)).toBeGreaterThan(0);
    for (const [otherLabel, otherMarker] of TEAM_PANELS) {
      if (otherLabel === tabLabel) continue;
      expect(showingCount(otherMarker)).toBe(0);
    }
  });

  it("should handle empty data gracefully", async () => {
    const emptyData = {
      results: [],
      metadata: {
        total_spend: 0,
        total_api_requests: 0,
        total_successful_requests: 0,
        total_failed_requests: 0,
        total_tokens: 0,
      },
    };

    mockTagDailyActivityCall.mockResolvedValue(emptyData);

    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(await screen.findByText("Tag Spend Overview")).toBeInTheDocument();
    const costTab = screen.getByRole("tabpanel");
    expect(await within(costTab).findByText("$0.00")).toBeInTheDocument();
    expect(within(costTab).getByText("Total Spend")).toBeInTheDocument();
    expect(within(costTab).getAllByText("0")[0]).toBeInTheDocument();
  });

  it("should display the Model Activity tab", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="tag" />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Model Activity")).toBeInTheDocument();
  });

  it("should display the Top Public Model Names title", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="tag" />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("Top Public Model Names")).toBeInTheDocument();
  });

  it("defaults Model Activity to public model names and toggles to litellm models", async () => {
    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    act(() => {
      fireEvent.click(screen.getByText("Model Activity"));
    });

    expect(showingCount("metrics-source:model_groups")).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(showingText("Litellm Model Name"));
    });

    expect(showingCount("metrics-source:models")).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(showingText("Public Model Name"));
    });

    expect(showingCount("metrics-source:model_groups")).toBeGreaterThan(0);
  });

  it("should use entityList label when entityList is provided and entity exists", async () => {
    const customEntityList = [
      { label: "Custom Tag Label", value: "tag-1" },
      { label: "Tag 2", value: "tag-2" },
    ];

    render(<StatefulEntityUsage {...defaultProps} entityList={customEntityList} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Custom Tag Label")).toBeInTheDocument();
    });
  });

  it("should fallback to team_alias when entityList is provided but entity does not exist", async () => {
    const customEntityList = [{ label: "Tag 2", value: "tag-2" }];

    render(<StatefulEntityUsage {...defaultProps} entityList={customEntityList} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Tag 1").length).toBeGreaterThan(0);
    });
  });

  it("uses customer aliases from activity metadata without loading the customer directory", async () => {
    mockCustomerDailyActivityCall.mockResolvedValue({
      ...mockSpendData,
      results: mockSpendData.results.map((day) => ({
        ...day,
        breakdown: {
          ...day.breakdown,
          entities: {
            "customer-1": {
              ...day.breakdown.entities["tag-1"],
              metadata: { alias: "Selected Customer" },
            },
          },
        },
      })),
    });
    render(<StatefulEntityUsage {...defaultProps} entityType="customer" entityList={null} />);
    expect(await screen.findByText("Selected Customer")).toBeInTheDocument();
  });

  it("passes multiple selected customers to the activity request", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="customer" entityList={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Customer Multi Select" }));
    await waitFor(() => {
      expect(mockCustomerDailyActivityCall).toHaveBeenLastCalledWith(
        expect.objectContaining({ entityIds: ["customer-1", "customer-2"] }),
      );
    });
  });

  it("should fallback to team_alias when entityList is null", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityList={null} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Tag 1").length).toBeGreaterThan(0);
    });
  });

  it("should still request the filter when the caller's tag scope is empty", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityList={[]} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("show-filters:true")).toBeInTheDocument();
  });

  it("should not request the filter while the entity list is still unresolved", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityList={null} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    expect(screen.getByText("show-filters:false")).toBeInTheDocument();
  });

  it("offers per-model top keys in Model Activity", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(mockTeamDailyActivityCall).toHaveBeenCalled();
    });

    act(() => {
      fireEvent.click(screen.getByText("Model Activity"));
    });
    expect(showingCount("top-keys-fetcher:model_groups")).toBeGreaterThan(0);
  });

  it("shows a loader instead of zero totals while the aggregate is in flight", async () => {
    let resolveSpend: (value: typeof mockSpendData) => void = () => {};
    mockTagDailyActivityCall.mockReturnValue(
      new Promise<typeof mockSpendData>((resolve) => {
        resolveSpend = resolve;
      }),
    );
    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });
    expect(screen.getAllByText("Loading chart data...")).toHaveLength(2);
    expect(screen.queryByText("Total Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Overall Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();

    await act(async () => {
      resolveSpend(mockSpendData);
    });

    expect(screen.queryByText("Loading chart data...")).not.toBeInTheDocument();
    expect(screen.getByText("Overall Usage")).toBeInTheDocument();
    expect(screen.getByText("Total Spend")).toBeInTheDocument();
    expect(screen.getAllByText("$100.50").length).toBeGreaterThan(0);
  });

  it("should fallback to entity value when no entityList and no team_alias", async () => {
    const spendDataWithoutAlias = {
      ...mockSpendData,
      results: [
        {
          ...mockSpendData.results[0],
          breakdown: {
            ...mockSpendData.results[0].breakdown,
            entities: {
              "tag-1": {
                ...mockSpendData.results[0].breakdown.entities["tag-1"],
                metadata: {},
              },
            },
          },
        },
      ],
    };

    mockTagDailyActivityCall.mockResolvedValue(spendDataWithoutAlias);

    render(<StatefulEntityUsage {...defaultProps} entityList={null} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText("tag-1").length).toBeGreaterThan(0);
    });
  });

  it("renders the stacked daily spend chart, the per-entity table, and the provider share bar with a $ total", async () => {
    const { container } = render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(mockTagDailyActivityCall).toHaveBeenCalled();
    });

    // The fixture carries no model breakdown, so the day's spend stacks as a single "Other" segment.
    await waitFor(() => {
      expect(container.querySelectorAll("path.recharts-rectangle")).toHaveLength(1);
    });
    expect(container.querySelector("path.recharts-rectangle")).toHaveAttribute("fill", "#94a3b8");

    expect(screen.getAllByText("Jan 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tag 1").length).toBeGreaterThan(0);

    const segments = screen.getAllByTestId("provider-share-segment");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveStyle({ backgroundColor: "rgb(236, 72, 153)" });
    expect(screen.getByTestId("provider-spend-total")).toHaveTextContent("$100.50");
  });

  it("lists a subscription-covered provider on the team view as included in the subscription at zero spend", async () => {
    const day = mockSpendData.results[0];
    mockTeamDailyActivityCall.mockResolvedValue({
      ...mockSpendData,
      results: [
        {
          ...day,
          breakdown: {
            ...day.breakdown,
            providers: {
              ...day.breakdown.providers,
              chatgpt: {
                metrics: { ...day.breakdown.providers.openai.metrics, spend: 0, api_requests: 4 },
                metadata: { subscription_covered: true },
              },
            },
          },
        },
      ],
    });

    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    expect(await screen.findByText("Included in subscription")).toBeInTheDocument();
    expect(screen.getByText("chatgpt")).toBeInTheDocument();
    expect(screen.getAllByTestId("provider-share-segment")).toHaveLength(1);
  });

  it("should label the chart with user_email metadata instead of the raw UUID (LIT-3889)", async () => {
    const userUuid = "c0e68be8-057e-4e2f-9d3a-000000000000";
    const spendDataForUser = {
      ...mockSpendData,
      results: [
        {
          ...mockSpendData.results[0],
          breakdown: {
            ...mockSpendData.results[0].breakdown,
            entities: {
              [userUuid]: {
                ...mockSpendData.results[0].breakdown.entities["tag-1"],
                metadata: { user_email: "spender@example.com" },
              },
            },
          },
        },
      ],
    };

    mockUserDailyActivityCall.mockResolvedValue(spendDataForUser);

    // entityList is null to simulate a spender missing from the paginated user list
    render(<StatefulEntityUsage {...defaultProps} entityType="user" entityList={null} />);

    await waitFor(() => {
      expect(mockUserDailyActivityCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("spender@example.com")).toBeInTheDocument();
    });
    expect(screen.queryByText(userUuid)).not.toBeInTheDocument();
  });

  it("renders the provider spend table logo from the bundled provider map", async () => {
    render(<StatefulEntityUsage {...defaultProps} />);

    const logo = await screen.findByAltText("openai logo");
    expect(logo).toHaveAttribute("src", expect.stringContaining("openai_small"));
  });

  describe("capability gating", () => {
    it.each([["organization", () => mockOrganizationDailyActivityCall, "Organization Spend Overview"]] as const)(
      "fetches %s activity for an admin but not for an internal user",
      async (entityType, call, heading) => {
        render(<StatefulEntityUsage {...defaultProps} entityType={entityType} />);
        await waitFor(() => {
          expect(call()).toHaveBeenCalled();
        });

        cleanup();
        call().mockClear();

        render(<StatefulEntityUsage {...defaultProps} entityType={entityType} userRole="Internal User" />);
        expect(await screen.findByText(heading)).toBeInTheDocument();
        expect(call()).not.toHaveBeenCalled();
      },
    );

    // An org admin's session role is "Internal User", so the row above cannot
    // distinguish them. Gating the fetch on the session role alone left the
    // Organization Usage panel rendered but permanently empty, because the
    // request was never issued even though the proxy would have served it.
    it("fetches organization activity for an org admin", async () => {
      render(
        <StatefulEntityUsage {...defaultProps} entityType="organization" userRole="Internal User" isOrgAdmin={true} />,
      );

      await waitFor(() => {
        expect(mockOrganizationDailyActivityCall).toHaveBeenCalled();
      });
    });

    it("keeps the team breakdown for an internal user", async () => {
      render(<StatefulEntityUsage {...defaultProps} entityType="team" userRole="Internal User" />);

      await waitFor(() => {
        expect(mockTeamDailyActivityCall).toHaveBeenCalled();
      });
      expect(screen.getByText("Team Spend Overview")).toBeInTheDocument();
    });

    it("keeps the tag breakdown for an internal user", async () => {
      render(<StatefulEntityUsage {...defaultProps} entityType="tag" userRole="Internal User" />);

      await waitFor(() => {
        expect(mockTagDailyActivityCall).toHaveBeenCalled();
      });
      expect(screen.getByText("Tag Spend Overview")).toBeInTheDocument();
    });
  });

  it("renders a letter avatar instead of an img for an unknown provider slug", async () => {
    const spendDataUnknownProvider = {
      ...mockSpendData,
      results: [
        {
          ...mockSpendData.results[0],
          breakdown: {
            ...mockSpendData.results[0].breakdown,
            providers: {
              "zzz-internal": mockSpendData.results[0].breakdown.providers.openai,
            },
          },
        },
      ],
    };
    mockTagDailyActivityCall.mockResolvedValue(spendDataUnknownProvider);

    render(<StatefulEntityUsage {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getAllByText("zzz-internal").length).toBeGreaterThan(0);
    });
    expect(screen.queryByAltText("zzz-internal logo")).not.toBeInTheDocument();
    expect(screen.getByText("z")).toBeInTheDocument();
  });

  it("feeds the key and model tables from their own breakdowns", async () => {
    const usageMetrics = {
      spend: 30.75,
      api_requests: 300,
      successful_requests: 290,
      failed_requests: 10,
      total_tokens: 15000,
      prompt_tokens: 9000,
      completion_tokens: 6000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    mockTeamDailyActivityCall.mockResolvedValue({
      ...mockSpendData,
      results: [
        {
          ...mockSpendData.results[0],
          breakdown: {
            ...mockSpendData.results[0].breakdown,
            model_groups: { "gpt-4o": { metrics: { ...usageMetrics, spend: 70.25 }, metadata: {} } },
            api_keys: {
              "sk-abc": {
                metrics: usageMetrics,
                metadata: { key_alias: "prod-key", team_id: null, user_email: "alice@example.com" },
              },
            },
          },
        },
      ],
    });

    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(screen.getByText("top-keys:sk-abc=30.75=alice@example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("top-models:gpt-4o=70.25")).toBeInTheDocument();
  });

  it("uses the aggregated team endpoint and makes a single bounded request", async () => {
    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    await waitFor(() => {
      expect(mockDailyActivityAggregatedCall).toHaveBeenCalledWith("team", expect.anything());
    });
    expect(mockDailyActivityAggregatedCall.mock.calls.filter((c) => c[0] === "team")).toHaveLength(1);

    await waitFor(() => {
      expect(screen.getAllByText("$100.50").length).toBeGreaterThan(0);
    });
  });

  it("surfaces a failure alert when the aggregated call fails instead of retrying other routes", async () => {
    mockTeamDailyActivityCall.mockRejectedValue(new Error("aggregated unavailable"));

    render(<StatefulEntityUsage {...defaultProps} entityType="team" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load spend data");
    expect(alert).toHaveTextContent("aggregated unavailable");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(mockDailyActivityAggregatedCall.mock.calls.filter((c) => c[0] === "team")).toHaveLength(1);
  });

  describe("user filter (LIT-5654)", () => {
    const userDropdown = (): HTMLElement => screen.getByTestId("user-dropdown");
    const userCombobox = (): HTMLElement => within(userDropdown()).getByRole("combobox");

    const renderUserUsage = async () => {
      render(<StatefulEntityUsage {...defaultProps} entityType="user" entityList={null} />);
      await waitFor(() => {
        expect(mockUserDailyActivityCall).toHaveBeenCalled();
      });
    };

    it("links the single picked user back to their Internal Users record", async () => {
      render(
        <EntityUsage
          {...defaultProps}
          entityType="user"
          entityList={null}
          selectedEntities={["user-001"]}
          onSelectedEntitiesChange={vi.fn()}
        />,
      );

      expect(await screen.findByRole("link", { name: "View user record" })).toHaveAttribute(
        "href",
        "/ui/users?user=user-001",
      );
    });

    it("shows no user record link until a user is picked", async () => {
      await renderUserUsage();

      expect(screen.queryByRole("link", { name: "View user record" })).not.toBeInTheDocument();
    });

    it("reports the picked user to the owner of the selection", async () => {
      const user = userEvent.setup();
      const onSelectedEntitiesChange = vi.fn();
      render(
        <EntityUsage
          {...defaultProps}
          entityType="user"
          entityList={null}
          selectedEntities={[]}
          onSelectedEntitiesChange={onSelectedEntitiesChange}
        />,
      );

      await user.click(userCombobox());
      await user.click(await screen.findByText("Alice (user-001)"));

      expect(onSelectedEntitiesChange).toHaveBeenCalledWith(["user-001"]);
    });

    it("offers a user filter even when the caller preloaded no user page", async () => {
      await renderUserUsage();

      expect(userCombobox()).toHaveAttribute("placeholder", "Search users by email…");
    });

    it("searches every user on the server rather than a preloaded page", async () => {
      const user = userEvent.setup();
      await renderUserUsage();

      expect(mockUseInfiniteUsers).toHaveBeenCalledWith(50, undefined);

      await user.type(userCombobox(), "alice");

      await waitFor(() => {
        expect(mockUseInfiniteUsers).toHaveBeenCalledWith(50, "alice");
      });
    });

    it("refetches daily activity for the picked user and drops the filter when cleared", async () => {
      const user = userEvent.setup();
      await renderUserUsage();

      expect(mockUserDailyActivityCall).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "test-token", entityIds: null }),
      );

      await user.click(userCombobox());
      await user.click(await screen.findByText("Alice (user-001)"));

      await waitFor(() => {
        expect(mockUserDailyActivityCall).toHaveBeenCalledWith(
          expect.objectContaining({ accessToken: "test-token", entityIds: ["user-001"] }),
        );
      });

      mockUserDailyActivityCall.mockClear();
      await user.click(userDropdown().querySelector('[data-slot="combobox-clear"]') as HTMLElement);

      await waitFor(() => {
        expect(mockUserDailyActivityCall).toHaveBeenCalledWith(
          expect.objectContaining({ accessToken: "test-token", entityIds: null }),
        );
      });
    });
  });
});
