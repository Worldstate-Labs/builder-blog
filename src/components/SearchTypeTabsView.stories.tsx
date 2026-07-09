import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchTypeTabsView } from "./SearchTypeTabsView";

const meta = {
  title: "Navigation/SearchTypeTabs",
  component: SearchTypeTabsView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    ariaLabel: "Filter search results by type",
    controlsId: "search-results",
    items: [
      { id: "all", label: "All", ariaLabel: "All results", href: "?type=all", active: true, count: 128 },
      { id: "posts", label: "Posts", ariaLabel: "Posts", href: "?type=posts", active: false, count: 96 },
      { id: "sources", label: "Sources", ariaLabel: "Sources", href: "?type=sources", active: false, count: 24 },
      { id: "digests", label: "Briefs", ariaLabel: "Briefs", href: "?type=digests", active: false, count: null },
    ],
  },
} satisfies Meta<typeof SearchTypeTabsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SecondActive: Story = {
  args: {
    items: [
      { id: "all", label: "All", ariaLabel: "All results", href: "?type=all", active: false, count: 128 },
      { id: "posts", label: "Posts", ariaLabel: "Posts", href: "?type=posts", active: true, count: 96 },
      { id: "sources", label: "Sources", ariaLabel: "Sources", href: "?type=sources", active: false, count: 24 },
    ],
  },
};
