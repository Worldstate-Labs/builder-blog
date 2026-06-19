import type { Meta, StoryObj } from "@storybook/react-vite";
import { FetchMethodPopover } from "./FetchMethodPopover";

// The popover opens on click. The info button renders inline; click it in the
// canvas to reveal the parsed runtime / model / source-note rows.
const meta = {
  title: "Overlays/FetchMethodPopover",
  component: FetchMethodPopover,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof FetchMethodPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    fetchTool:
      "Codex Desktop (model gpt-5.5) FollowBrief skill fetcher (YouTube RSS + feed description)",
    summarizedAt: "2026-06-17T09:30:00.000Z",
  },
};

export const RawMethod: Story = {
  name: "Unparsed method",
  args: {
    fetchTool: "Manual paste",
    summarizedAt: null,
  },
};
