import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor";

// MarkdownEditor is already a pure controlled component (value + onChange, no
// framework deps), so it needs no refactor — only a story that owns the state.
const meta = {
  title: "Forms/MarkdownEditor",
  component: MarkdownEditor,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    ariaLabel: "Summary rules",
    height: 280,
    placeholder: "Write markdown…",
  },
} satisfies Meta<typeof MarkdownEditor>;

export default meta;
type Story = StoryObj<typeof meta>;
type MarkdownEditorStoryProps = ComponentProps<typeof MarkdownEditor> & {
  initialValue: string;
};

const SAMPLE = [
  "## Summary rules",
  "",
  "- Lead with the takeaway, then the evidence",
  "- Keep it factual and cited — never hype",
  "",
  "> Replace doomscrolling with a daily, cited brief.",
  "",
  "1. Source",
  "2. Claim",
  "3. Evidence",
].join("\n");

function MarkdownEditorStory({ initialValue, ...args }: MarkdownEditorStoryProps) {
  const [value, setValue] = useState(initialValue);
  return <MarkdownEditor {...args} value={value} onChange={setValue} ariaLabel="Summary rules" />;
}

export const Default: Story = {
  render: (args) => <MarkdownEditorStory {...args} initialValue={SAMPLE} />,
};

export const Empty: Story = {
  render: (args) => <MarkdownEditorStory {...args} initialValue="" />,
};
