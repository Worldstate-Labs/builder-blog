import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CountBadge,
  CountChip,
  CountMeta,
  CountMetric,
  CountRange,
} from "./Count";

// Count exposes several sibling numeric display primitives. They share the
// same formatter (en-US thousands separators) but differ in chrome and weight.
const meta = {
  title: "Foundations/Count",
  component: CountBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof CountBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badge: Story = {
  args: { value: 1240 },
};

export const Chip: Story = {
  render: () => <CountChip label="sources" value={18} />,
};

export const Meta_: Story = {
  name: "Meta",
  render: () => <CountMeta label="posts today" value={42} />,
};

export const Range: Story = {
  render: () => <CountRange>1–25 of 1,240</CountRange>,
};

export const MetricTones: Story = {
  name: "Metric (tones)",
  render: () => (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      <CountMetric label="Fetched" tone="neutral" value={128} />
      <CountMetric label="Succeeded" tone="ok" value={120} />
      <CountMetric label="Failed" tone="issue" value={5} />
      <CountMetric label="Pending" tone="waiting" value={3} />
    </div>
  ),
};
