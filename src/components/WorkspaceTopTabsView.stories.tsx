import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceTopTabsView } from "./WorkspaceTopTabsView";

const meta = {
  title: "Navigation/WorkspaceTopTabs",
  component: WorkspaceTopTabsView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    ariaLabel: "Today feed tabs",
    selectedValue: "ai-digest",
    items: [
      { value: "ai-digest", label: "AI Brief", href: "/dashboard?tab=ai-digest" },
      { value: "following", label: "Following", href: "/dashboard?tab=following" },
      { value: "favorites", label: "Favorites", href: "/dashboard?tab=favorites" },
    ],
  },
} satisfies Meta<typeof WorkspaceTopTabsView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Link mode (no onSelect): each tab is a navigational link.
export const Default: Story = {};

export const FollowingSelected: Story = {
  args: { selectedValue: "following" },
};

// Button mode: tabs call onSelect instead of navigating.
export const ButtonMode: Story = {
  args: {
    onSelect: () => {},
    items: [
      { value: "overview", label: "Overview" },
      { value: "activity", label: "Activity" },
      { value: "settings", label: "Settings" },
    ],
    selectedValue: "overview",
  },
};
