import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandMark } from "./BrandMark";

const meta = {
  title: "Foundations/BrandMark",
  component: BrandMark,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: { control: "inline-radio", options: ["default", "dark"] },
  },
} satisfies Meta<typeof BrandMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: "default" },
};

export const OnDarkSurface: Story = {
  args: { size: "dark" },
  decorators: [
    (Story) => (
      <div
        style={{
          background: "var(--surface-ink)",
          padding: "2.5rem",
          borderRadius: 12,
          display: "inline-flex",
        }}
      >
        <Story />
      </div>
    ),
  ],
};
