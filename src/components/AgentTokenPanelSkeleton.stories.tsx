import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentTokenPanelSkeleton } from "./AgentTokenPanelSkeleton";

const meta = {
  title: "Loading/AgentTokenPanelSkeleton",
  component: AgentTokenPanelSkeleton,
  tags: ["autodocs"],
} satisfies Meta<typeof AgentTokenPanelSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
