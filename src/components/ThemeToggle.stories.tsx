import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "./ThemeToggle";

// ThemeToggle reads and writes <html data-theme>. Clicking it re-themes the
// whole Storybook preview live — the same mechanism the app uses.
const meta = {
  title: "Actions/ThemeToggle",
  component: ThemeToggle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
