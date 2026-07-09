import type { Meta, StoryObj } from "@storybook/react-vite";
import { DigestPipelineSelectorView } from "./DigestPipelineSelectorView";

const own = { id: "p-own", title: "My AI Brief", ownerLabel: "You", isOwnPipeline: true };
const shared = {
  id: "p-team",
  title: "Infra reading group",
  ownerLabel: "Dana K.",
  isOwnPipeline: false,
};

const meta = {
  title: "Digest/DigestPipelineSelector",
  component: DigestPipelineSelectorView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    options: [own, shared],
    selectedPipeline: own,
    selectedPipelineId: "p-own",
  },
} satisfies Meta<typeof DigestPipelineSelectorView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Multiple collections → a collapsible selector (click the trigger to open).
export const Default: Story = {};

export const SharedSelected: Story = {
  args: { selectedPipeline: shared, selectedPipelineId: "p-team" },
};

// A single collection collapses to a static label.
export const SingleCollection: Story = {
  args: { options: [own] },
};
