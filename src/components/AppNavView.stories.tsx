import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppNavView } from "./AppNavView";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today", icon: "home" as const, active: true },
  { href: "/builders", label: "Sources", icon: "sources" as const, active: false },
  { href: "/library-hub", label: "Library", icon: "hub" as const, active: false },
];

const meta = {
  title: "Navigation/AppNav",
  component: AppNavView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { items: NAV_ITEMS },
} satisfies Meta<typeof AppNavView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopRail: Story = {
  args: { mode: "desktop", desktopLayout: "rail" },
};

export const DesktopBar: Story = {
  args: { mode: "desktop", desktopLayout: "bar" },
};

export const MobileTabbar: Story = {
  args: { mode: "mobile" },
};
