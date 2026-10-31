import { useTeamMetadataSchema } from "@/app/(dashboard)/hooks/teams/useTeamMetadataSchema";
import * as networking from "@/components/networking";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseSelectOption, renderWithProviders, testQueryClient } from "../../../tests/test-utils";
import { toast } from "@/lib/toast";
import type { Member } from "@/components/networking";
import TeamInfoView, { type TeamData } from "./TeamInfo";

const authState = vi.hoisted(() => ({ userRole: "Admin", isViewOnly: false }));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({
    token: "123",
    accessToken: "123",
    userId: "user-1",
    userEmail: "user@example.com",
    userRole: authState.userRole,
    isViewOnly: authState.isViewOnly,
    premiumUser: false,
    disabledPersonalKeyCreation: null,
    showSSOBanner: false,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/components/networking", () => ({
  serverRootPath: "",
  teamInfoCall: vi.fn(),
  teamMemberDeleteCall: vi.fn(),
  teamMemberAddCall: vi.fn(),
  teamMemberUpdateCall: vi.fn(),
  teamUpdateCall: vi.fn(),
  getTeamPermissionsCall: vi.fn(),
  organizationInfoCall: vi.fn(),
  getRouterSettingsCall: vi.fn().mockResolvedValue({ fields: [] }),
  getPassThroughEndpointsCall: vi.fn().mockResolvedValue({ endpoints: [] }),
}));

const { bulkUpdatePOST } = vi.hoisted(() => ({ bulkUpdatePOST: vi.fn() }));
vi.mock("@/lib/http/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/api")>();
  return { ...actual, fetchClient: { ...actual.fetchClient, POST: bulkUpdatePOST } };
});

vi.mock("@/components/utils/dataUtils", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  formatNumberWithCommas: vi.fn((value: number) => value.toLocaleString()),
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeamMetadataSchema", () => ({
  useTeamMetadataSchema: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@/app/(dashboard)/hooks/uiSettings/useUISettings", () => ({
  useUISettings: vi.fn(),
}));

vi.mock("@/app/(dashboard)/hooks/models/useModels", () => ({
  useAllProxyModels: vi.fn(),
  useModelAccessGroupNames: vi.fn(() => new Set<string>()),
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(dashboard)/hooks/teams/useTeams")>()),
  useTeam: vi.fn(),
}));

vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
  organizationKeys: { all: ["organizations"] },
  useOrganization: vi.fn(),
  useOrganizations: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

vi.mock("@/app/(dashboard)/hooks/users/useCurrentUser", () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock("@/components/team/TeamMemberTab", () => ({
  default: vi.fn(
    ({
      setIsAddMemberModalVisible,
      setSelectedEditMember,
      setIsEditMemberModalVisible,
    }: {
      setIsAddMemberModalVisible: (visible: boolean) => void;
      setSelectedEditMember: (member: Member) => void;
      setIsEditMemberModalVisible: (visible: boolean) => void;
    }) => (
      <div>
        <button onClick={() => setIsAddMemberModalVisible(true)}>Add Member</button>
        <button
          onClick={() => {
            setSelectedEditMember({ user_email: "edit@test.com", user_id: "edit-user", role: "user" });
            setIsEditMemberModalVisible(true);
          }}
        >
          Edit Member
        </button>
      </div>
    ),
  ),
}));

vi.mock("@/components/common_components/user_search_modal", () => ({
  default: vi.fn(({ isVisible, onCancel, onSubmit }) =>
    isVisible ? (
      <div>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => onSubmit({ user_email: "new@test.com", user_id: "new-user", role: "user" })}>
          Submit
        </button>
      </div>
    ) : null,
  ),
}));

vi.mock("@/components/team/EditMembership", () => ({
  default: vi.fn(({ visible, onCancel, onSubmit }) =>
    visible ? (
      <div>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => onSubmit({ user_email: "edit@test.com", user_id: "edit-user", role: "admin" })}>
          Submit
        </button>
      </div>
    ) : null,
  ),
}));

vi.mock("@/components/common_components/DeleteResourceModal", () => ({
  default: vi.fn(({ isOpen, onCancel, onOk }) =>
    isOpen ? (
      <div>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={onOk}>Confirm Delete</button>
      </div>
    ) : null,
  ),
}));

vi.mock("@/components/team/member_permissions", () => ({
  default: vi.fn(() => <div>Member Permissions</div>),
}));

vi.mock("@/components/common_components/ModelAliasManager", () => ({
  default: vi.fn(({ initialModelAliases, onAliasUpdate }) => (
    <div>
      <div data-testid="alias-editor-initial">{JSON.stringify(initialModelAliases)}</div>
      <button type="button" onClick={() => onAliasUpdate({ "gpt-4o": "gpt-4" })}>
        Set Alias
      </button>
      <button type="button" onClick={() => onAliasUpdate({})}>
        Clear Aliases
      </button>
    </div>
  )),
}));

vi.mock("@/app/(dashboard)/hooks/keys/useKeys", () => ({
  useKeys: vi.fn().mockReturnValue({
    data: { keys: [], total_count: 0, current_page: 1, total_pages: 1 },
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../key_team_helpers/filter_helpers", () => ({
  fetchTeamFilterOptions: vi.fn().mockResolvedValue({
    keyAliases: [],
    organizationIds: [],
    userIds: [],
  }),
  fetchAllKeyAliases: vi.fn().mockResolvedValue([]),
  fetchAllOrganizations: vi.fn().mockResolvedValue([]),
}));

import { useAllProxyModels, useModelAccessGroupNames } from "@/app/(dashboard)/hooks/models/useModels";
import { useKeys } from "@/app/(dashboard)/hooks/keys/useKeys";
import { useOrganization } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { teamKeys, teamsTableKeys, useTeam } from "@/app/(dashboard)/hooks/teams/useTeams";
import { useCurrentUser } from "@/app/(dashboard)/hooks/users/useCurrentUser";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";

const mockUseAllProxyModels = vi.mocked(useAllProxyModels);
const mockUseModelAccessGroupNames = vi.mocked(useModelAccessGroupNames);
const mockUseKeys = vi.mocked(useKeys);
const mockUseTeam = vi.mocked(useTeam);
const mockUseOrganization = vi.mocked(useOrganization);
const mockUseCurrentUser = vi.mocked(useCurrentUser);
const mockUseUISettings = vi.mocked(useUISettings);

const createMockTeamData = (overrides = {}) => ({
  team_id: "123",
  team_info: {
    team_alias: "Test Team",
    team_id: "123",
    organization_id: null,
    admins: ["admin@test.com"],
    members: ["user1@test.com"],
    members_with_roles: [
      {
        user_id: "user1@test.com",
        user_email: "user1@test.com",
        role: "member",
        spend: 0,
        budget_id: "budget1",
      },
    ],
    metadata: {},
    tpm_limit: null,
    rpm_limit: null,
    max_budget: null,
    budget_duration: null,
    models: [],
    blocked: false,
    spend: 0,
    max_parallel_requests: null,
    budget_reset_at: null,
    model_id: null,
    litellm_model_table: null,
    created_at: "2024-01-01T00:00:00Z",
    team_member_budget_table: null,
    ...overrides,
  },
  keys: [],
  team_memberships: [],
});

const seedDefaultMocks = () => {
  mockUseModelAccessGroupNames.mockReturnValue(new Set());
  mockUseAllProxyModels.mockReturnValue({
    data: { data: [] },
    isLoading: false,
  } as any);
  mockUseTeam.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as any);
  mockUseOrganization.mockReturnValue({
    data: undefined,
    isLoading: false,
  } as any);
  mockUseCurrentUser.mockReturnValue({
    data: { models: [] },
    isLoading: false,
  } as any);
  mockUseUISettings.mockReturnValue({
    data: { values: {} },
    isLoading: false,
  } as any);
  mockUseKeys.mockReturnValue({
    data: { keys: [], total_count: 0, current_page: 1, total_pages: 1 },
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  } as any);
  vi.mocked(useTeamMetadataSchema).mockReturnValue({ data: [], isLoading: false } as any);

  vi.mocked(networking.getTeamPermissionsCall).mockResolvedValue({
    all_available_permissions: [],
    team_member_permissions: [],
  });
};

describe("TeamInfoView", () => {
  const defaultProps = {
    teamId: "123",
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    accessToken: "test-token",
    is_team_admin: true,
    is_proxy_admin: true,
    userModels: ["gpt-4", "gpt-3.5-turbo"],
    editTeam: false,
    premiumUser: false,
  };

  beforeEach(seedDefaultMocks);

  afterEach(() => {
    vi.clearAllMocks();
    authState.userRole = "Admin";
    authState.isViewOnly = false;
  });

  describe("display and rendering", () => {
    it("links direct model chips to their matching access-group or model filter", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ models: ["repro-access-group", "gpt-4.1"] }),
      );
      mockUseModelAccessGroupNames.mockReturnValue(new Set(["repro-access-group"]));

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      expect(await screen.findByRole("link", { name: "repro-access-group" })).toHaveAttribute(
        "href",
        expect.stringMatching(/\?access_group=repro-access-group$/),
      );
      expect(screen.getByRole("link", { name: "gpt-4.1" })).toHaveAttribute(
        "href",
        expect.stringMatching(/\?model_group=gpt-4\.1$/),
      );

      await userEvent.setup({ delay: null }).click(screen.getByRole("tab", { name: "Settings" }));
      const settings = await screen.findByRole("tabpanel", { name: "Settings" });
      expect(within(settings).getByRole("link", { name: "repro-access-group" })).toHaveAttribute(
        "href",
        expect.stringMatching(/\?access_group=repro-access-group$/),
      );
      expect(within(settings).getByRole("link", { name: "gpt-4.1" })).toHaveAttribute(
        "href",
        expect.stringMatching(/\?model_group=gpt-4\.1$/),
      );
    });

    it("should render", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });
    });

    it("links direct and access-group model badges to the models page filtered to that group", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          models: ["gpt-4.1"],
          access_group_models: ["claude-sonnet-5"],
          access_group_details: [{ access_group_id: "ag-1", access_group_name: "prod", models: ["claude-sonnet-5"] }],
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      expect(await screen.findByRole("link", { name: "gpt-4.1" })).toHaveAttribute(
        "href",
        expect.stringContaining("/models-and-endpoints?model_group=gpt-4.1"),
      );
      expect(screen.getByRole("link", { name: "claude-sonnet-5" })).toHaveAttribute(
        "href",
        expect.stringContaining("/models-and-endpoints?model_group=claude-sonnet-5"),
      );
    });

    it("keeps the all-proxy-models badge non-clickable", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["all-proxy-models"] }));

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      expect(await screen.findByText("All proxy models")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "All proxy models" })).not.toBeInTheDocument();
    });

    it("should display loading state while fetching team data", () => {
      vi.mocked(networking.teamInfoCall).mockImplementation(() => new Promise(() => {}));

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should display error message when team is not found", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue({
        team_id: "123",
        team_info: null as any,
        keys: [],
        team_memberships: [],
      });

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Team not found")).toBeInTheDocument();
      });
    });

    it("should display budget information in overview", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          max_budget: 1000,
          spend: 250.5,
          budget_duration: "30d",
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Budget Status")).toBeInTheDocument();
      });
      expect(screen.getByText("$250.50")).toBeInTheDocument();
      expect(screen.getByText(/of \$1,000\.00/)).toBeInTheDocument();
    });

    it("renders a tpm/rpm/budget limit of 0 as 0 in the overview and settings tabs, never as Unlimited or No Limit", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          tpm_limit: 0,
          rpm_limit: 0,
          team_member_budget_table: { max_budget: 0, budget_duration: null, tpm_limit: 0, rpm_limit: 0 },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      const overview = await screen.findByRole("tabpanel", { name: "Overview" });
      expect(within(overview).getByText("TPM: 0")).toBeInTheDocument();
      expect(within(overview).getByText("RPM: 0")).toBeInTheDocument();

      await userEvent.setup({ delay: null }).click(screen.getByRole("tab", { name: "Settings" }));
      const settings = await screen.findByRole("tabpanel", { name: "Settings" });
      expect(within(settings).getByText("TPM: 0")).toBeInTheDocument();
      expect(within(settings).getByText("RPM: 0")).toBeInTheDocument();
      expect(within(settings).getByText("TPM Limit: 0")).toBeInTheDocument();
      expect(within(settings).getByText("RPM Limit: 0")).toBeInTheDocument();
      expect(within(settings).getByText("Max Budget: 0")).toBeInTheDocument();
      expect(screen.queryByText("TPM: Unlimited")).not.toBeInTheDocument();
      expect(screen.queryByText("RPM: Unlimited")).not.toBeInTheDocument();
      expect(screen.queryByText("TPM Limit: No Limit")).not.toBeInTheDocument();
      expect(screen.queryByText("RPM Limit: No Limit")).not.toBeInTheDocument();
    });

    it("should display team member budget information when present", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          team_member_budget_table: {
            max_budget: 500,
            budget_duration: "30d",
            tpm_limit: 5000,
            rpm_limit: 50,
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Budget Status")).toBeInTheDocument();
      });
      expect(screen.getByText("Team Member Budget: $500.00")).toBeInTheDocument();
    });

    it("should display virtual keys information", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue({
        ...createMockTeamData(),
        keys: [{ user_id: "user1", token: "key1" }, { token: "key2" }],
      });

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Virtual Keys" })).toBeInTheDocument();
      });
    });

    it("should open Settings tab by default when editTeam is true and user can edit", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} editTeam={true} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      expect(screen.getByText("Team Settings")).toBeInTheDocument();
    });

    it("should open Overview tab by default when editTeam is false", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} editTeam={false} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      expect(screen.getByText("Budget Status")).toBeInTheDocument();
    });

    it("should open Overview tab by default when editTeam is true but user cannot edit", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(
        <TeamInfoView {...defaultProps} editTeam={true} is_team_admin={false} is_proxy_admin={false} />,
      );

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      expect(screen.getByText("Budget Status")).toBeInTheDocument();
    });
  });

  describe("tabs and navigation", () => {
    it("should show members tab when user can edit team", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
      });
    });

    it("should not show members tab when user cannot edit team", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} is_team_admin={false} is_proxy_admin={false} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      expect(screen.queryByRole("tab", { name: "Members" })).not.toBeInTheDocument();
    });

    it("should show settings tab when user can edit team", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
      });
    });

    it("shows edit tabs when the proxy reports the session user may edit, even without the is_team_admin prop", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ caller_edit_access: { kind: "team_admin_disabled" } }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} is_team_admin={false} is_proxy_admin={false} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
      });
      expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    });

    it("should navigate to settings tab when clicked", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });
    });

    it("should call onClose when back button is clicked", async () => {
      const user = userEvent.setup({ delay: null });
      const onClose = vi.fn();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const backButton = screen.getByRole("button", { name: /back to teams/i });
      await user.click(backButton);

      expect(onClose).toHaveBeenCalled();
    });

    it("should copy team ID to clipboard when copy button is clicked", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const copyButtons = screen.getAllByRole("button");
      const copyButton = copyButtons.find((btn) => btn.querySelector("svg"));
      expect(copyButton).toBeTruthy();

      if (copyButton) {
        await user.click(copyButton);
      }
    });

    it("should show Virtual Keys tab when user cannot edit team", async () => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} is_team_admin={false} is_proxy_admin={false} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Virtual Keys" })).toBeInTheDocument();
      });
    });

    it("should display X Members in Virtual Keys tab when navigated to", async () => {
      const user = userEvent.setup();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());
      const fiveKeys = Array.from({ length: 5 }, (_, i) => ({
        token: `sk-${i}`,
        token_id: `key-${i}`,
        key_alias: `key_${i}`,
        key_name: `sk-...${i}`,
        user_id: `user-${i}`,
        organization_id: null,
        user: { user_id: `user-${i}`, user_email: `user${i}@test.com` },
        created_at: "2024-01-01T00:00:00Z",
        team_id: "123",
        spend: 0,
        max_budget: 100,
        models: ["gpt-4"],
      }));
      mockUseKeys.mockReturnValue({
        data: { keys: fiveKeys, total_count: 5, current_page: 1, total_pages: 1 },
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const virtualKeysTab = screen.getByRole("tab", { name: "Virtual Keys" });
      await user.click(virtualKeysTab);

      await waitFor(() => {
        expect(screen.getByTestId("pagination-range")).toHaveTextContent("Showing 1-5 of 5");
      });
    });

    it("should show Filters and pagination controls in Virtual Keys tab", async () => {
      const user = userEvent.setup();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());
      mockUseKeys.mockReturnValue({
        data: {
          keys: [
            {
              token: "sk-1",
              token_id: "key-1",
              key_alias: "key1",
              key_name: "sk-...1",
              user_id: "user-1",
              organization_id: null,
              user: { user_id: "user-1", user_email: "user1@test.com" },
              created_at: "2024-01-01T00:00:00Z",
              team_id: "123",
              spend: 0,
              max_budget: 100,
              models: ["gpt-4"],
            },
          ],
          total_count: 1,
          current_page: 1,
          total_pages: 1,
        },
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const virtualKeysTab = screen.getByRole("tab", { name: "Virtual Keys" });
      await user.click(virtualKeysTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
      expect(screen.getByTestId("pagination-range")).toHaveTextContent("Showing 1-1 of 1");
      expect(screen.getByTestId("pagination-prev")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-next")).toBeInTheDocument();
    });
  });

  describe("settings and editing", () => {
    it("should open edit mode when edit button is clicked", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      const editButton = screen.getByRole("button", { name: /edit settings/i });
      await user.click(editButton);

      await waitFor(() => {
        expect(screen.getByLabelText("Team Name")).toBeInTheDocument();
      });
    });

    it("should close edit mode when cancel button is clicked", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      const editButton = screen.getByRole("button", { name: /edit settings/i });
      await user.click(editButton);

      await waitFor(() => {
        expect(screen.getByLabelText("Team Name")).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByLabelText("Team Name")).not.toBeInTheDocument();
      });
    });

    it("should disable secret manager settings for non-premium users", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            secret_manager_settings: { provider: "aws", secret_id: "abc" },
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={false} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      const editButton = screen.getByRole("button", { name: /edit settings/i });
      await user.click(editButton);

      const secretField = await screen.findByPlaceholderText(
        '{"namespace": "admin", "mount": "secret", "path_prefix": "litellm"}',
      );
      expect(secretField).toBeDisabled();
    });

    it("should allow premium users to edit secret manager settings", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            secret_manager_settings: { provider: "aws", secret_id: "abc" },
          },
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={true} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      const editButton = screen.getByRole("button", { name: /edit settings/i });
      await user.click(editButton);

      const secretField = await screen.findByPlaceholderText(
        '{"namespace": "admin", "mount": "secret", "path_prefix": "litellm"}',
      );
      expect(secretField).toBeEnabled();
    });

    it("should add team member when form is submitted", async () => {
      const user = userEvent.setup({ delay: null });
      const onUpdate = vi.fn();
      const teamData = createMockTeamData();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamData);
      vi.mocked(networking.teamMemberAddCall).mockResolvedValue({} as any);

      renderWithProviders(<TeamInfoView {...defaultProps} onUpdate={onUpdate} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const membersTab = screen.getByRole("tab", { name: "Members" });
      await user.click(membersTab);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /add member/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole("button", { name: /add member/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: "Submit" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(networking.teamMemberAddCall).toHaveBeenCalled();
      });
    });

    it("invalidates the member budget query after a successful member update", async () => {
      const user = userEvent.setup({ delay: null });
      const teamData = createMockTeamData();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamData);
      testQueryClient.clear();
      const invalidateQueriesSpy = vi.spyOn(testQueryClient, "invalidateQueries");

      try {
        renderWithProviders(<TeamInfoView {...defaultProps} />);

        await user.click(await screen.findByRole("tab", { name: "Members" }));
        await user.click(await screen.findByRole("button", { name: "Edit Member" }));
        await user.click(await screen.findByRole("button", { name: "Submit" }));

        await waitFor(() => expect(networking.teamMemberUpdateCall).toHaveBeenCalled());
        await waitFor(() =>
          expect(invalidateQueriesSpy).toHaveBeenCalledWith({
            queryKey: ["teams", "memberBudget", defaultProps.teamId],
          }),
        );
      } finally {
        invalidateQueriesSpy.mockRestore();
      }
    });

    it("should display soft budget in settings view when present", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          soft_budget: 500.75,
          max_budget: 1000,
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText(/Soft Budget:/)).toBeInTheDocument();
        expect(screen.getByText(/\$500\.75/)).toBeInTheDocument();
      });
    });

    it("should display soft budget alerting emails in settings view when present", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            soft_budget_alerting_emails: ["alert1@test.com", "alert2@test.com"],
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      const settingsTab = screen.getByRole("tab", { name: "Settings" });
      await user.click(settingsTab);

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText(/Soft Budget Alerting Emails:/)).toBeInTheDocument();
        expect(screen.getByText(/alert1@test\.com, alert2@test\.com/)).toBeInTheDocument();
      });
    });

    it("invalidates the cached team list and team detail queries after saving team settings", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["gpt-4"] }));
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);
      const tableKey = teamsTableKeys.list({ page: 1, limit: 10 });
      const detailKey = teamKeys.detail("123");
      testQueryClient.setQueryData(tableKey, { teams: [], total: 0 });
      testQueryClient.setQueryData(detailKey, { team_id: "123" });

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));
      await screen.findByLabelText("Team Name");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(testQueryClient.getQueryState(tableKey)?.isInvalidated).toBe(true));
      expect(testQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });

    const openSettingsEditorForTeam = async (
      user: ReturnType<typeof userEvent.setup>,
      teamOverrides: Record<string, unknown>,
    ) => {
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData(teamOverrides));
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /edit settings/i }));
      await waitFor(() => {
        expect(screen.getByLabelText("Team Name")).toBeInTheDocument();
      });

      return screen.getByLabelText("Reset Budget");
    };

    it("should send an explicit null budget_duration when a stored Reset Budget is cleared", async () => {
      const user = userEvent.setup({ delay: null });
      const resetBudgetSelect = await openSettingsEditorForTeam(user, { budget_duration: "30d" });

      await chooseSelectOption(user, resetBudgetSelect, "Never resets");

      await waitFor(() => {
        expect(resetBudgetSelect).toHaveTextContent("Never resets");
      });

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const updateArg = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
      expect(updateArg.budget_duration).toBeNull();
      expect(JSON.stringify(updateArg)).toContain('"budget_duration":null');
    });

    it("should keep a stored Reset Budget when the form is saved untouched", async () => {
      const user = userEvent.setup({ delay: null });
      await openSettingsEditorForTeam(user, { budget_duration: "30d" });

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      expect(vi.mocked(networking.teamUpdateCall).mock.calls[0][1].budget_duration).toBe("30d");
    });

    it("should send the newly picked budget_duration when one is selected", async () => {
      const user = userEvent.setup({ delay: null });
      const resetBudgetSelect = await openSettingsEditorForTeam(user, { budget_duration: null });

      await chooseSelectOption(user, resetBudgetSelect, "weekly");

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      expect(vi.mocked(networking.teamUpdateCall).mock.calls[0][1].budget_duration).toBe("7d");
    });
  });

  describe("metadata key-value editing", () => {
    const openSettingsEditor = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /edit settings/i }));

      await waitFor(() => {
        expect(screen.getByLabelText("Team Name")).toBeInTheDocument();
      });
    };

    it("should preserve metadata types and hide managed keys", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            department: "research",
            tier: 3,
            beta: true,
            config: { region: "us" },
            logging: [{ callback_name: "langfuse", callback_type: "success", callback_vars: {} }],
            model_tpm_limit: { "gpt-4": 100 },
          },
          models: ["gpt-4"],
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);
      await openSettingsEditor(user);

      const keyValues = screen.getAllByPlaceholderText("Key").map((input) => (input as HTMLInputElement).value);
      expect(keyValues).toEqual(["department", "tier", "beta", "config"]);
      const valueValues = screen.getAllByPlaceholderText("Value").map((input) => (input as HTMLInputElement).value);
      expect(valueValues).toEqual(["research", "3", "true", '{"region":"us"}']);

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const updateArg = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
      expect(updateArg.metadata).toMatchObject({
        department: "research",
        tier: 3,
        beta: true,
        config: { region: "us" },
        logging: [{ callback_name: "langfuse", callback_type: "success", callback_vars: {} }],
      });
      expect(updateArg.metadata).not.toHaveProperty("model_tpm_limit");
      expect(updateArg.model_tpm_limit).toEqual({ "gpt-4": 100 });
    });

    it("prefills the estimated output token controls, hides them from the pair editor, and saves edits", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            department: "research",
            default_estimated_output_tokens: 512,
            default_estimated_output_tokens_per_model: { "gpt-4": 4096 },
          },
          models: ["gpt-4"],
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);
      await openSettingsEditor(user);

      expect(screen.getByLabelText("Estimated Output Tokens")).toHaveValue(512);
      expect(screen.getByLabelText("Estimated Output Tokens Per Model")).toHaveValue('{"gpt-4":4096}');
      const keyValues = screen.queryAllByPlaceholderText("Key").map((input) => (input as HTMLInputElement).value);
      expect(keyValues).toEqual(["department"]);

      fireEvent.change(screen.getByLabelText("Estimated Output Tokens"), { target: { value: "999" } });

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const updateArg = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
      expect(updateArg.metadata.default_estimated_output_tokens).toBe(999);
      expect(updateArg.metadata.default_estimated_output_tokens_per_model).toEqual({ "gpt-4": 4096 });
    });

    it("omits the estimated output token settings when both controls are blank", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["gpt-4"] }));
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);
      await openSettingsEditor(user);

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const updateArg = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
      expect(updateArg.metadata).not.toHaveProperty("default_estimated_output_tokens");
      expect(updateArg.metadata).not.toHaveProperty("default_estimated_output_tokens_per_model");
    });

    it.each(["Internal User", "Admin Viewer", "org_admin"])(
      "leaves both estimate controls read-only for %s and still resubmits the stored values",
      async (userRole) => {
        authState.userRole = userRole;
        const user = userEvent.setup({ delay: null });
        vi.mocked(networking.teamInfoCall).mockResolvedValue(
          createMockTeamData({
            metadata: {
              default_estimated_output_tokens: 512,
              default_estimated_output_tokens_per_model: { "gpt-4": 4096 },
            },
            models: ["gpt-4"],
          }),
        );
        vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

        renderWithProviders(<TeamInfoView {...defaultProps} />);
        await openSettingsEditor(user);

        expect(screen.getByLabelText("Estimated Output Tokens")).toBeDisabled();
        expect(screen.getByLabelText("Estimated Output Tokens Per Model")).toBeDisabled();

        await user.click(screen.getByRole("button", { name: /save changes/i }));

        await waitFor(() => {
          expect(networking.teamUpdateCall).toHaveBeenCalled();
        });

        const updateArg = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
        expect(updateArg.metadata.default_estimated_output_tokens).toBe(512);
        expect(updateArg.metadata.default_estimated_output_tokens_per_model).toEqual({ "gpt-4": 4096 });
      },
    );

    it.each(["Admin", "proxy_admin"])("leaves both estimate controls editable for %s", async (userRole) => {
      authState.userRole = userRole;
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["gpt-4"] }));

      renderWithProviders(<TeamInfoView {...defaultProps} />);
      await openSettingsEditor(user);

      expect(screen.getByLabelText("Estimated Output Tokens")).toBeEnabled();
      expect(screen.getByLabelText("Estimated Output Tokens Per Model")).toBeEnabled();
    });

    it("should show declared keys as fixed labels and submit the edited value", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(useTeamMetadataSchema).mockReturnValue({
        data: [
          { key: "cost_center", label: "Cost Center" },
          { key: "app_name", label: "Application Name" },
        ],
        isLoading: false,
      } as any);
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: { cost_center: "CC-OLD", department: "research" },
          models: ["gpt-4"],
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);
      await openSettingsEditor(user);

      await waitFor(() => {
        expect(screen.getAllByTestId("metadata-schema-label").map((label) => label.textContent)).toEqual([
          "Cost Center",
          "Application Name",
        ]);
      });
      expect(screen.getAllByPlaceholderText("Key").map((input) => (input as HTMLInputElement).value)).toEqual([
        "department",
      ]);
      expect(screen.getByLabelText("Cost Center")).toHaveValue("CC-OLD");

      await user.clear(screen.getByLabelText("Cost Center"));
      fireEvent.change(screen.getByLabelText("Cost Center"), { target: { value: "CC-NEW" } });
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      expect(vi.mocked(networking.teamUpdateCall).mock.calls[0][1].metadata).toMatchObject({
        cost_center: "CC-NEW",
        department: "research",
        app_name: "",
      });
    });
  });

  describe("model aliases", () => {
    const openSettingsEditor = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /edit settings/i }));

      await waitFor(() => {
        expect(screen.getByLabelText("Team Name")).toBeInTheDocument();
      });
    };

    it("should render existing model aliases in the read-only settings view", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          litellm_model_table: { model_aliases: { "my-smart-model": "gpt-4", "my-fast-model": "gpt-3.5-turbo" } },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      expect(screen.getByText("Model Aliases")).toBeInTheDocument();
      expect(screen.getByText("my-smart-model")).toBeInTheDocument();
      expect(screen.getByText("gpt-4")).toBeInTheDocument();
      expect(screen.getByText("my-fast-model")).toBeInTheDocument();
      expect(screen.getByText("gpt-3.5-turbo")).toBeInTheDocument();
    });

    it("should render the estimated output token settings in the overview and read-only settings views", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: {
            default_estimated_output_tokens: 512,
            default_estimated_output_tokens_per_model: { "gpt-4": 4096 },
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      expect(screen.getAllByText("Estimated Output Tokens: 512")).toHaveLength(2);
      expect(screen.getAllByText('Estimated Output Tokens Per Model: {"gpt-4":4096}')).toHaveLength(2);
    });

    it("should show an empty state when the team has no model aliases", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ litellm_model_table: null }));

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        const teamNameElements = screen.queryAllByText("Test Team");
        expect(teamNameElements.length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      expect(screen.getByText("No model aliases configured")).toBeInTheDocument();
    });

    it("should seed the alias editor from existing team aliases", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          models: ["gpt-4"],
          litellm_model_table: { model_aliases: { "my-smart-model": "gpt-4" } },
        }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await openSettingsEditor(user);

      expect(screen.getByTestId("alias-editor-initial")).toHaveTextContent(
        JSON.stringify({ "my-smart-model": "gpt-4" }),
      );
    });

    it("should pass model_aliases to teamUpdateCall when aliases are added", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["gpt-4"] }));
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await openSettingsEditor(user);

      await user.click(screen.getByRole("button", { name: "Set Alias" }));
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalledWith(
          "test-token",
          expect.objectContaining({
            team_id: "123",
            model_aliases: { "gpt-4o": "gpt-4" },
          }),
        );
      });
    });

    it("should send an empty model_aliases map to clear existing aliases", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          models: ["gpt-4"],
          litellm_model_table: { model_aliases: { "my-smart-model": "gpt-4" } },
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await openSettingsEditor(user);

      await user.click(screen.getByRole("button", { name: "Clear Aliases" }));
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const payload = vi.mocked(networking.teamUpdateCall).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.model_aliases).toEqual({});
    });

    it("should not include model_aliases when the team has none and the editor is untouched", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ models: ["gpt-4"], litellm_model_table: null }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await openSettingsEditor(user);

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });

      const payload = vi.mocked(networking.teamUpdateCall).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("model_aliases");
    });
  });

  describe("per-model budgets", () => {
    const teamWithModelBudget = () =>
      createMockTeamData({
        models: ["gpt-4"],
        model_max_budget: { "gpt-4": { max_budget: 5, budget_duration: "1d" } },
        model_max_budget_usage: { "gpt-4": { current_spend: 1.25, budget_limit: 5, time_period: "1d" } },
      });

    const openSettingsEditor = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0);
      });
      await user.click(screen.getByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));
      await screen.findByLabelText("Team Name");
    };

    const savedPayload = async () => {
      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalled();
      });
      return vi.mocked(networking.teamUpdateCall).mock.calls[0][1] as Record<string, unknown>;
    };

    it("shows the stored per-model budget and its current spend in the read-only settings view", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamWithModelBudget());

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0);
      });
      await user.click(screen.getByRole("tab", { name: "Settings" }));

      expect(await screen.findByText("Per-Model Budget (gpt-4): $5 per 1d, spent $1.25")).toBeInTheDocument();
    });

    it("seeds the editor from the stored budget and keeps it read-only without an enterprise license", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamWithModelBudget());

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={false} />);

      await openSettingsEditor(user);

      expect(screen.getByPlaceholderText("Max spend ($)")).toHaveValue(5);
      expect(screen.getByPlaceholderText("Max spend ($)")).toBeDisabled();
      expect(screen.getByRole("button", { name: /Add Model Budget/i })).toBeDisabled();
    });

    it("leaves model_max_budget out of a save that did not touch it", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamWithModelBudget());
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={true} />);

      await openSettingsEditor(user);
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect(await savedPayload()).not.toHaveProperty("model_max_budget");
    });

    it("sends the edited cap for the model", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamWithModelBudget());
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={true} />);

      await openSettingsEditor(user);
      fireEvent.change(screen.getByPlaceholderText("Max spend ($)"), { target: { value: "2.5" } });
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect((await savedPayload()).model_max_budget).toEqual({ "gpt-4": { budget_limit: 2.5, time_period: "1d" } });
    });

    it("sends an empty model_max_budget when the last row is removed, so the stored cap is cleared", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(teamWithModelBudget());
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={true} />);

      await openSettingsEditor(user);
      await user.click(screen.getByRole("button", { name: "Remove model budget" }));
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect((await savedPayload()).model_max_budget).toEqual({});
    });
  });

  describe("team member settings", () => {
    it("should populate Default Key Duration from the team's stored metadata", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ metadata: { team_member_key_duration: "30d" } }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /edit settings/i }));

      await user.click(await screen.findByRole("button", { name: /team member settings/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/^Default Key Duration/)).toHaveValue("30d");
      });
    });
  });

  describe("allowed pass through routes", () => {
    beforeEach(() => {
      testQueryClient.clear();
      vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ models: ["gpt-4"] }));
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);
      vi.mocked(networking.getPassThroughEndpointsCall).mockResolvedValue({
        endpoints: [{ path: "/bedrock-passthrough", methods: ["POST"] }],
      });
    });

    it("should show a route picked from the dropdown in the field and save it", async () => {
      const user = userEvent.setup({ delay: null });

      renderWithProviders(<TeamInfoView {...defaultProps} premiumUser={true} />);

      await waitFor(() => {
        expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      await user.click(await screen.findByRole("combobox", { name: "Select pass through routes" }));

      const option = await screen.findByText("POST /bedrock-passthrough");
      await user.click(option);

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.getByText("POST /bedrock-passthrough")).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(networking.teamUpdateCall).toHaveBeenCalledWith(
          "test-token",
          expect.objectContaining({
            team_id: "123",
            metadata: expect.objectContaining({
              allowed_passthrough_routes: ["/bedrock-passthrough"],
            }),
          }),
        );
      });
    });
  });

  describe("team admin edit access", () => {
    const teamAdminProps = { ...defaultProps, is_proxy_admin: false, is_team_admin: true };

    beforeEach(() => {
      authState.userRole = "Internal User";
    });

    it("tells a team admin to ask a proxy admin when the proxy reports no team field is enabled for them", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ caller_edit_access: { kind: "team_admin_disabled" } }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      expect(toast.error).toHaveBeenCalledWith("Team admins cannot edit team settings on this proxy", {
        description: "Ask a proxy admin to enable fields under Settings > UI > Team admin editable fields.",
      });
      expect(screen.queryByLabelText("Team Name")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /edit settings/i })).toBeInTheDocument();
    });

    it("gives a team admin only the fields the proxy enabled and sends only those on save", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          tpm_limit: 1000,
          caller_edit_access: { kind: "team_admin", editable_fields: ["tpm_limit"] },
        }),
      );
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      const tpmInput = await screen.findByLabelText("Tokens per minute Limit (TPM)");
      expect(tpmInput).toHaveValue(1000);
      expect(screen.queryByLabelText("Team Name")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Requests per minute Limit (RPM)")).not.toBeInTheDocument();

      fireEvent.change(tpmInput, { target: { value: "5000" } });
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(networking.teamUpdateCall).toHaveBeenCalledTimes(1));
      expect(vi.mocked(networking.teamUpdateCall).mock.calls[0][1]).toStrictEqual({ team_id: "123", tpm_limit: 5000 });
      expect(toast.success).toHaveBeenCalledWith("Team settings updated successfully");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("prefills the RPM limit and budgets a team admin may edit with the team's stored values", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          rpm_limit: 50,
          max_budget: 20,
          soft_budget: 15,
          caller_edit_access: { kind: "team_admin", editable_fields: ["rpm_limit", "max_budget", "soft_budget"] },
        }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      expect(await screen.findByLabelText("Requests per minute Limit (RPM)")).toHaveValue(50);
      expect(screen.getByLabelText("Max Budget (USD)")).toHaveValue(20);
      expect(screen.getByLabelText("Soft Budget (USD)")).toHaveValue(15);
      expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    });

    it("saves a team admin's metadata edit with the proxy's own keys carried over", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(useTeamMetadataSchema).mockReturnValue({
        data: [{ key: "cost_center", label: "Cost Center" }],
        isLoading: false,
      } as any);
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          metadata: { cost_center: "eng", priority: "high" },
          caller_edit_access: {
            kind: "team_admin",
            editable_fields: ["metadata"],
            proxy_controlled_metadata_keys: ["priority"],
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));
      const costCenter = await screen.findByLabelText("Cost Center");
      expect(costCenter).toHaveValue("eng");
      expect(screen.queryByDisplayValue("priority")).not.toBeInTheDocument();

      await user.clear(costCenter);
      await user.type(costCenter, "sales");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(networking.teamUpdateCall).toHaveBeenCalled());
      expect(vi.mocked(networking.teamUpdateCall).mock.calls[0][1]).toMatchObject({
        metadata: { cost_center: "sales", priority: "high" },
      });
    });

    it("saves other fields when a declared metadata field is also a proxy setting", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(useTeamMetadataSchema).mockReturnValue({
        data: [
          { key: "cost_center", label: "Cost Center" },
          { key: "priority", label: "Priority" },
        ],
        isLoading: false,
      } as any);
      vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          tpm_limit: 1000,
          metadata: { cost_center: "eng", priority: "high" },
          caller_edit_access: {
            kind: "team_admin",
            editable_fields: ["metadata", "tpm_limit"],
            proxy_controlled_metadata_keys: ["priority"],
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));
      expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();

      const tpm = screen.getByLabelText("Tokens per minute Limit (TPM)");
      await user.clear(tpm);
      await user.type(tpm, "2000");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(networking.teamUpdateCall).toHaveBeenCalled());
      const sent = vi.mocked(networking.teamUpdateCall).mock.calls[0][1];
      expect(sent).toMatchObject({ tpm_limit: 2000 });
      expect(sent).not.toHaveProperty("metadata");
    });

    it("prefills the member defaults a team admin may edit from the team's member budget", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({
          team_member_budget_table: { max_budget: 10, budget_duration: "30d", tpm_limit: 100, rpm_limit: 5 },
          caller_edit_access: {
            kind: "team_admin",
            editable_fields: [
              "team_member_budget",
              "team_member_budget_duration",
              "team_member_tpm_limit",
              "team_member_rpm_limit",
            ],
          },
        }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      expect(await screen.findByLabelText("Member Default Budget (USD)")).toHaveValue(10);
      expect(screen.getByLabelText("Member Default Budget Duration")).toHaveTextContent("monthly");
      expect(screen.getByLabelText("Member Default TPM Limit")).toHaveValue(100);
      expect(screen.getByLabelText("Member Default RPM Limit")).toHaveValue(5);
      expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    });

    it("opens the form when the proxy reports unrestricted access although the props only mark a team admin", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ caller_edit_access: { kind: "unrestricted" } }),
      );

      renderWithProviders(<TeamInfoView {...teamAdminProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      expect(await screen.findByLabelText("Team Name")).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("never gates a proxy admin on the team admin field list", async () => {
      authState.userRole = "Admin";
      const user = userEvent.setup({ delay: null });
      vi.mocked(networking.teamInfoCall).mockResolvedValue(
        createMockTeamData({ caller_edit_access: { kind: "unrestricted" } }),
      );

      renderWithProviders(<TeamInfoView {...defaultProps} />);

      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(await screen.findByRole("button", { name: /edit settings/i }));

      expect(await screen.findByLabelText("Team Name")).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});

describe("TeamInfoView - which team member fields reach the update payload depends on the open sections", () => {
  const props = {
    teamId: "123",
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    accessToken: "test-token",
    is_team_admin: true,
    is_proxy_admin: true,
    userModels: ["gpt-4"],
    editTeam: false,
  };

  beforeEach(seedDefaultMocks);

  afterEach(() => {
    vi.clearAllMocks();
  });

  const openEditor = async (
    user: ReturnType<typeof userEvent.setup>,
    teamMemberBudgetTable: TeamData["team_info"]["team_member_budget_table"] = {
      max_budget: 42,
      budget_duration: "30d",
      tpm_limit: 11,
      rpm_limit: 22,
    },
  ) => {
    vi.mocked(networking.teamInfoCall).mockResolvedValue(
      createMockTeamData({
        team_member_budget_table: teamMemberBudgetTable,
        default_team_member_models: ["gpt-4"],
      }),
    );
    vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

    renderWithProviders(<TeamInfoView {...props} />);
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");
  };

  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(networking.teamUpdateCall).toHaveBeenCalled());
    return vi.mocked(networking.teamUpdateCall).mock.calls[0][1] as Record<string, unknown>;
  };

  it("omits every stored team member field when Team Member Settings is left closed", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    const payload = await save(user);

    expect(payload.team_member_budget_duration).toBeUndefined();
    expect(payload).not.toHaveProperty("team_member_budget");
    expect(payload).not.toHaveProperty("team_member_tpm_limit");
    expect(payload).not.toHaveProperty("team_member_rpm_limit");
    expect(payload).not.toHaveProperty("default_team_member_models");

    const wireBody = JSON.parse(JSON.stringify(payload));
    expect(Object.keys(wireBody).filter((key) => key.startsWith("team_member"))).toEqual([]);
    expect(wireBody).not.toHaveProperty("default_team_member_models");
  });

  it("resends every stored team member field once Team Member Settings is opened", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    const payload = await save(user);

    expect(payload.team_member_budget_duration).toBe("30d");
    expect(payload.team_member_budget).toBe(42);
    expect(payload.team_member_tpm_limit).toBe(11);
    expect(payload.team_member_rpm_limit).toBe(22);
    expect(payload.default_team_member_models).toEqual(["gpt-4"]);
  });

  it("sends a null team_member_budget_duration when Default Budget Duration is set to never reset", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    await chooseSelectOption(user, screen.getByLabelText("Default Budget Duration"), "Never resets");

    const payload = await save(user);

    expect(payload.team_member_budget_duration).toBeNull();
    expect(payload.team_member_budget).toBe(42);
    expect(JSON.stringify(payload)).toContain('"team_member_budget_duration":null');
  });

  it("shows Never resets for a stored member budget whose duration is null", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user, { max_budget: 42, budget_duration: null, tpm_limit: null, rpm_limit: null });

    await user.click(screen.getByText("Team Member Settings"));

    expect(await screen.findByLabelText("Default Budget Duration")).toHaveTextContent("Never resets");
  });

  it("omits team_member_budget_duration when the dropdown is left untouched on a team with no member budget", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user, null);

    await user.click(screen.getByText("Team Member Settings"));
    const durationSelect = await screen.findByLabelText("Default Budget Duration");
    expect(durationSelect).toHaveTextContent("Inherit team reset period");
    expect(durationSelect).not.toHaveTextContent("Never resets");
    await user.type(screen.getByLabelText("Default Budget (USD)"), "100");

    const payload = await save(user);

    expect(payload.team_member_budget).toBe(100);
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty("team_member_budget_duration");
  });

  it("sends a null team_member_budget when Default Budget is cleared, instead of a $0 cap", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    fireEvent.change(await screen.findByLabelText("Default Budget (USD)"), { target: { value: "" } });
    const payload = await save(user);

    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({
      team_member_budget: null,
      team_member_tpm_limit: 11,
      team_member_rpm_limit: 22,
    });
  });

  it("keeps a member default with no dollar cap uncapped when Team Member Settings is saved", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user, { max_budget: null, budget_duration: "30d", tpm_limit: null, rpm_limit: 60 });

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    const payload = await save(user);

    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({ team_member_budget: null, team_member_rpm_limit: 60 });
  });

  it("sends a typed Default Budget as a number", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    fireEvent.change(await screen.findByLabelText("Default Budget (USD)"), { target: { value: "12.5" } });
    const payload = await save(user);

    expect(payload.team_member_budget).toBe(12.5);
  });
});

describe("TeamInfoView - the exact bytes the update call sends", () => {
  const props = {
    teamId: "123",
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    accessToken: "test-token",
    is_team_admin: true,
    is_proxy_admin: true,
    userModels: ["gpt-4"],
    editTeam: false,
  };

  beforeEach(seedDefaultMocks);

  afterEach(() => {
    vi.clearAllMocks();
    authState.userRole = "Admin";
    authState.isViewOnly = false;
  });

  const storedTeam = (requireTraceId = false) =>
    createMockTeamData({
      models: ["gpt-4"],
      max_budget: 100,
      budget_duration: "1d",
      tpm_limit: 1000,
      rpm_limit: 1000,
      team_member_budget_table: { max_budget: 42, budget_duration: "30d", tpm_limit: 11, rpm_limit: 22 },
      default_team_member_models: ["gpt-4"],
      metadata: requireTraceId ? { require_trace_id: true } : {},
    });

  const openEditor = async (
    user: ReturnType<typeof userEvent.setup>,
    options: { requireTraceId?: boolean; isProxyAdmin?: boolean } = {},
  ) => {
    vi.mocked(networking.teamInfoCall).mockResolvedValue(storedTeam(options.requireTraceId === true));
    vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

    renderWithProviders(<TeamInfoView {...props} is_proxy_admin={options.isProxyAdmin ?? true} />);
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");
  };

  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(networking.teamUpdateCall).toHaveBeenCalled());
    return vi.mocked(networking.teamUpdateCall).mock.calls[0][1] as Record<string, unknown>;
  };

  const wireBody = (payload: Record<string, unknown>) => JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  const alwaysSent = {
    team_id: "123",
    team_alias: "Test Team",
    tpm_limit: 1000,
    rpm_limit: 1000,
    tpd_limit: null,
    model_tpm_limit: {},
    model_rpm_limit: {},
    max_budget: 100,
    soft_budget: null,
    budget_duration: "1d",
    metadata: {
      allowed_passthrough_routes: [],
      soft_budget_alerting_emails: [],
    },
  };

  it("leaves every team member key out of the request body for an untouched save with both sections closed", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    const payload = await save(user);

    expect(payload.metadata).not.toHaveProperty("require_trace_id");
    expect(payload).toStrictEqual({
      ...alwaysSent,
      team_member_budget_duration: undefined,
    });
    expect(wireBody(payload)).toStrictEqual(alwaysSent);
  });

  it("sends require_trace_id when a proxy admin enables it", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    fireEvent.click(screen.getByRole("switch", { name: /Require Trace ID/i }));
    const payload = await save(user);

    expect(payload.metadata).toMatchObject({ require_trace_id: true });
  });

  it("hides the switch from non-admins and preserves the stored value on an unrelated save", async () => {
    const user = userEvent.setup({ delay: null });
    authState.userRole = "Internal User";
    await openEditor(user, { requireTraceId: true, isProxyAdmin: false });

    expect(screen.queryByRole("switch", { name: /Require Trace ID/i })).not.toBeInTheDocument();
    const payload = await save(user);

    expect(payload.metadata).toMatchObject({ require_trace_id: true });
  });

  it("resends every stored value once Team Member Settings is opened", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");

    const payload = await save(user);

    const expected = {
      ...alwaysSent,
      team_member_budget_duration: "30d",
      team_member_budget: 42,
      team_member_tpm_limit: 11,
      team_member_rpm_limit: 22,
      default_team_member_models: ["gpt-4"],
    };
    expect(payload).toStrictEqual(expected);
    expect(wireBody(payload)).toStrictEqual(expected);
  });

  const openEditorWithMemberBudgetAlerts = async (user: ReturnType<typeof userEvent.setup>) => {
    vi.mocked(networking.teamInfoCall).mockResolvedValue(
      createMockTeamData({
        models: ["gpt-4"],
        team_member_budget_table: { max_budget: 42 },
        metadata: { team_member_max_budget_alert_emails: { "50": [], "100": ["finance@test.com"] } },
      }),
    );
    vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

    renderWithProviders(<TeamInfoView {...props} />);
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");
  };

  const memberBudgetAlertEmails = (payload: Record<string, unknown>) =>
    (wireBody(payload).metadata as Record<string, unknown>).team_member_max_budget_alert_emails;

  it("resends the stored team member budget alert thresholds when the section stays closed", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditorWithMemberBudgetAlerts(user);

    const payload = await save(user);

    expect(memberBudgetAlertEmails(payload)).toStrictEqual({ "50": [], "100": ["finance@test.com"] });
  });

  it("sends the edited team member budget alert thresholds as a percent to recipients map", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditorWithMemberBudgetAlerts(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    const thresholds = screen.getAllByPlaceholderText("% of budget");
    const recipients = screen.getAllByPlaceholderText(/Additional recipients/);
    expect(thresholds.map((input) => (input as HTMLInputElement).value)).toStrictEqual(["50", "100"]);
    expect(recipients.map((input) => (input as HTMLInputElement).value)).toStrictEqual(["", "finance@test.com"]);

    fireEvent.change(thresholds[0], { target: { value: "75" } });
    fireEvent.change(recipients[0], { target: { value: " lead@test.com, finance@test.com " } });
    await user.click(screen.getByRole("button", { name: "Add Budget Alert Threshold" }));
    fireEvent.change(screen.getAllByPlaceholderText("% of budget")[2], { target: { value: "90" } });

    const payload = await save(user);

    expect(memberBudgetAlertEmails(payload)).toStrictEqual({
      "75": ["lead@test.com", "finance@test.com"],
      "100": ["finance@test.com"],
      "90": [],
    });
  });

  it("drops the team member budget alert thresholds key once every row is removed", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditorWithMemberBudgetAlerts(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    const removeButtons = screen.getAllByRole("button", { name: "Remove budget alert threshold" });
    await user.click(removeButtons[1]);
    await user.click(removeButtons[0]);

    const payload = await save(user);

    expect(memberBudgetAlertEmails(payload)).toBeUndefined();
  });

  it("blocks the save when a team member budget alert threshold is above 100", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditorWithMemberBudgetAlerts(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    const threshold = screen.getAllByPlaceholderText("% of budget")[0] as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: "150" } });
    expect(threshold.validity.rangeOverflow).toBe(true);

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(networking.teamUpdateCall).not.toHaveBeenCalled());
  });

  it("refuses to save a team member budget alert row with no threshold", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditorWithMemberBudgetAlerts(user);

    await user.click(screen.getByText("Team Member Settings"));
    await screen.findByLabelText("Default Budget (USD)");
    await user.click(screen.getByRole("button", { name: "Add Budget Alert Threshold" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText("Enter a whole number from 1 to 100");
    expect(networking.teamUpdateCall).not.toHaveBeenCalled();
  });

  it("carries every typed value to the update payload, with numeric fields as numbers", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    const alias = screen.getByLabelText("Team Name");
    await user.clear(alias);
    await user.type(alias, "Renamed Team");

    const softBudget = screen.getByLabelText("Soft Budget (USD)");
    await user.clear(softBudget);
    await user.type(softBudget, "9.5");

    const emails = screen.getByLabelText(/Soft Budget Alerting Emails/);
    await user.clear(emails);
    await user.type(emails, "a@test.com,  b@test.com ");

    const tpm = screen.getByLabelText("Tokens per minute Limit (TPM)");
    await user.clear(tpm);
    await user.type(tpm, "555");

    const payload = await save(user);

    expect(payload.team_alias).toBe("Renamed Team");
    expect(payload.soft_budget).toBe(9.5);
    expect(payload.tpm_limit).toBe(555);
    expect((payload.metadata as Record<string, unknown>).soft_budget_alerting_emails).toStrictEqual([
      "a@test.com",
      "b@test.com",
    ]);
  });

  it("builds model_tpm_limit and model_rpm_limit from the model-specific rate limit rows", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(networking.teamInfoCall).mockResolvedValue(
      createMockTeamData({
        models: ["gpt-4"],
        max_budget: 100,
        budget_duration: "1d",
        tpm_limit: 1000,
        rpm_limit: 1000,
        metadata: { model_tpm_limit: { "gpt-4": 30 }, model_rpm_limit: { "gpt-4": 40 } },
      }),
    );
    vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

    renderWithProviders(<TeamInfoView {...props} />);
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");

    const payload = await save(user);

    expect(payload.model_tpm_limit).toStrictEqual({ "gpt-4": 30 });
    expect(payload.model_rpm_limit).toStrictEqual({ "gpt-4": 40 });
  });

  it("keeps a team member budget edited before the section is collapsed and resends it on reopen", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    const budgetInput = await screen.findByLabelText("Default Budget (USD)");
    await user.clear(budgetInput);
    await user.type(budgetInput, "77");

    await user.click(screen.getByText("Team Member Settings"));
    await waitFor(() => expect(screen.queryByLabelText("Default Budget (USD)")).not.toBeInTheDocument());

    await user.click(screen.getByText("Team Member Settings"));
    expect(await screen.findByLabelText("Default Budget (USD)")).toHaveValue(77);

    const payload = await save(user);
    expect(payload.team_member_budget).toBe(77);
  });

  it("sends no team member key at all when the section is collapsed again after an edit", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.click(screen.getByText("Team Member Settings"));
    const budgetInput = await screen.findByLabelText("Default Budget (USD)");
    await user.clear(budgetInput);
    await user.type(budgetInput, "77");

    await user.click(screen.getByText("Team Member Settings"));
    await waitFor(() => expect(screen.queryByLabelText("Default Budget (USD)")).not.toBeInTheDocument());

    const payload = await save(user);

    expect(Object.keys(wireBody(payload)).filter((key) => key.startsWith("team_member"))).toEqual([]);
    expect(wireBody(payload)).not.toHaveProperty("default_team_member_models");
  });

  it("sends a typed model rate limit as a number", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(networking.teamInfoCall).mockResolvedValue(
      createMockTeamData({ models: ["gpt-4"], metadata: { model_tpm_limit: { "gpt-4": 30 } } }),
    );
    vi.mocked(networking.teamUpdateCall).mockResolvedValue({ data: {}, team_id: "123" } as any);

    renderWithProviders(<TeamInfoView {...props} />);
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");

    const rpmInput = await screen.findByPlaceholderText("RPM Limit");
    await user.clear(rpmInput);
    await user.type(rpmInput, "45");

    const payload = await save(user);

    expect(payload.model_rpm_limit).toStrictEqual({ "gpt-4": 45 });
    expect(payload.model_tpm_limit).toStrictEqual({ "gpt-4": 30 });
  });

  it("blocks the save on an empty team name and names the rule", async () => {
    const user = userEvent.setup({ delay: null });
    await openEditor(user);

    await user.clear(screen.getByLabelText("Team Name"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Please input a team name")).toBeInTheDocument();
    expect(networking.teamUpdateCall).not.toHaveBeenCalled();
  });
});

describe("TeamInfoView - require_trace_id switch gating", () => {
  beforeEach(() => {
    seedDefaultMocks();
    vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData());
  });

  afterEach(() => {
    vi.clearAllMocks();
    authState.userRole = "Admin";
  });

  const props = {
    teamId: "123",
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    accessToken: "test-token",
    is_team_admin: true,
    is_proxy_admin: true,
    userModels: ["gpt-4"],
    editTeam: false,
    premiumUser: false,
  };

  const openEditForm = async () => {
    const user = userEvent.setup({ delay: null });
    await waitFor(() => expect(screen.queryAllByText("Test Team").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: /edit settings/i }));
    await screen.findByLabelText("Team Name");
  };

  it("hides the Require Trace ID switch from a non-admin", async () => {
    authState.userRole = "Internal User";
    renderWithProviders(<TeamInfoView {...props} is_proxy_admin={false} />);
    await openEditForm();

    expect(screen.queryByRole("switch", { name: /Require Trace ID/i })).not.toBeInTheDocument();
  });

  it("shows the stored trace requirement to a non-admin on the team overview", async () => {
    authState.userRole = "Internal User";
    vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ metadata: { require_trace_id: true } }));
    renderWithProviders(<TeamInfoView {...props} is_proxy_admin={false} />);

    expect(await screen.findByText("Require Trace ID: Enabled")).toBeInTheDocument();
  });

  it("keeps the Require Trace ID value read-only for a proxy admin viewer", async () => {
    authState.isViewOnly = true;
    vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ metadata: { require_trace_id: true } }));
    renderWithProviders(<TeamInfoView {...props} />);

    expect(await screen.findByText("Require Trace ID: Enabled")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Require Trace ID/i })).not.toBeInTheDocument();
  });

  it("shows a disabled trace requirement to a non-admin on the team overview", async () => {
    authState.userRole = "Internal User";
    vi.mocked(networking.teamInfoCall).mockResolvedValue(createMockTeamData({ metadata: {} }));
    renderWithProviders(<TeamInfoView {...props} is_proxy_admin={false} />);

    expect(await screen.findByText("Require Trace ID: Disabled")).toBeInTheDocument();
  });
});
