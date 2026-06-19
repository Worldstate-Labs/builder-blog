import type { Meta, StoryObj } from "@storybook/react-vite";
import { DigestArchivePickerView } from "./DigestArchivePickerView";

const digests = [
  { id: "d-3", createdAt: "2026-06-17T09:30:00.000Z", itemCount: 12 },
  { id: "d-2", createdAt: "2026-06-16T09:30:00.000Z", itemCount: 9 },
  { id: "d-1", createdAt: "2026-06-15T09:30:00.000Z", itemCount: 14 },
];

const meta = {
  title: "Digest/DigestArchivePicker",
  component: DigestArchivePickerView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    digests,
    isOwnPipeline: true,
    latestDigestId: "d-3",
    selectedDigestId: "d-3",
    selectedPipelineId: "p-1",
  },
} satisfies Meta<typeof DigestArchivePickerView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Multiple issues → a collapsible picker (click the trigger to open the menu).
export const Default: Story = {};

// A single issue collapses to a static, non-interactive label.
export const SingleIssue: Story = {
  args: {
    digests: [digests[0]],
  },
};
