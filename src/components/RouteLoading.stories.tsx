import type { Meta, StoryObj } from "@storybook/react-vite";
import { RouteLoading } from "./RouteLoading";

const meta = {
  title: "Loading/RouteLoading",
  component: RouteLoading,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "inline-radio", options: ["reading", "workspace"] },
    rows: { control: { type: "number", min: 1, max: 8 } },
  },
} satisfies Meta<typeof RouteLoading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = {
  args: {
    label: "Loading posts",
    title: "Favorites",
    rows: 4,
    variant: "reading",
  },
};

export const Workspace: Story = {
  args: {
    label: "Loading your library",
    title: "Library",
    rows: 5,
    variant: "workspace",
  },
};
