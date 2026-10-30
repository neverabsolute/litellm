import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseSelectOption } from "@/../tests/test-utils";
import { UsageViewSelect } from "./UsageViewSelect";

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox"));
};

// The listbox is portalled outside the render container in both antd and Base UI, so an
// option is "offered" when the label appears more times on the page than inside the trigger.
const offers = (container: HTMLElement, label: string) =>
  screen.queryAllByText(label).length > within(container).queryAllByText(label).length;

describe("UsageViewSelect", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it("should render", async () => {
    const user = userEvent.setup();
    const { container } = render(<UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" />);

    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Select the usage data you want to view" })).toBeInTheDocument();

    await openMenu(user);
    expect(offers(container, "Your Usage")).toBe(true);
  });

  it("should call onChange when value changes", async () => {
    const user = userEvent.setup();
    render(<UsageViewSelect value="global" onChange={mockOnChange} userRole="Admin" />);

    await chooseSelectOption(user, screen.getByRole("combobox"), /^Team Usage/);

    expect(mockOnChange).toHaveBeenCalled();
    expect(mockOnChange.mock.calls[0][0]).toBe("team");
  });

  it("should show Tag Usage for non-admin users with tag usage permission", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" canViewTagUsage={true} />,
    );

    await openMenu(user);
    expect(offers(container, "Tag Usage")).toBe(true);
  });

  it("should hide Tag Usage for non-admin users without tag usage permission", async () => {
    const user = userEvent.setup();
    const { container } = render(<UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" />);

    await openMenu(user);
    expect(offers(container, "Tag Usage")).toBe(false);
  });

  it("should show Organization Usage to an admin", async () => {
    const user = userEvent.setup();
    const { container } = render(<UsageViewSelect value="global" onChange={mockOnChange} userRole="Admin" />);

    await openMenu(user);
    expect(offers(container, "Organization Usage")).toBe(true);
  });

  it("should hide Organization Usage from an internal user", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" canViewTagUsage={true} />,
    );

    await openMenu(user);
    expect(offers(container, "Organization Usage")).toBe(false);
  });

  // An org admin's session role is "Internal User", since org-admin-ness lives in the
  // membership table, so the row above cannot tell them apart from a plain internal user.
  it("should offer Organization Usage to an org admin", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" isOrgAdmin={true} />,
    );

    await openMenu(user);
    expect(offers(container, "Organization Usage")).toBe(true);
  });

  it.each(["Team Usage", "Tag Usage"])("should keep %s available to an internal user", async (optionName) => {
    const user = userEvent.setup();
    const { container } = render(
      <UsageViewSelect value="global" onChange={mockOnChange} userRole="Internal User" canViewTagUsage={true} />,
    );

    await openMenu(user);
    expect(offers(container, optionName)).toBe(true);
  });
});
