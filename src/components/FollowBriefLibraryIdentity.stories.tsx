import type { Meta, StoryObj } from "@storybook/react-vite";
import { FollowBriefLibraryIdentity } from "./FollowBriefLibraryIdentity";

const meta = {
  title: "Foundations/FollowBriefLibraryIdentity",
  component: FollowBriefLibraryIdentity,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof FollowBriefLibraryIdentity>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LibraryTitle: Story = {};

export const CompactOwner: Story = {
  args: {
    compact: true,
    label: "FollowBrief",
  },
};

export const NarrowTitle: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 190 }}>
        <h3 className="fb-section-heading">
          <Story />
        </h3>
      </div>
    ),
  ],
};
