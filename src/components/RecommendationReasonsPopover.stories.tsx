import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecommendationReasonsPopover } from "./RecommendationReasonsPopover";

// Renders an icon button that opens a list of "why recommended" reasons.
// Returns null when reasons is empty, so every story passes at least one.
const meta = {
  title: "Overlays/RecommendationReasonsPopover",
  component: RecommendationReasonsPopover,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof RecommendationReasonsPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    reasons: [
      "You follow 3 sources in AI infrastructure",
      "Similar to posts you saved this week",
      "Trending among readers like you",
    ],
  },
};

export const SingleReason: Story = {
  args: {
    reasons: ["Matches your followed topic: developer tools"],
  },
};
