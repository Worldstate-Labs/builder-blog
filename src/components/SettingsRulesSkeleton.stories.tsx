import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsRulesSkeleton } from "./SettingsRulesSkeleton";

const meta = {
  title: "Loading/SettingsRulesSkeleton",
  component: SettingsRulesSkeleton,
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsRulesSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
