import type { Meta, StoryObj } from "@storybook/react-vite";
import { SourceBadge } from "./SourceBadge";

const meta = {
  title: "Foundations/SourceBadge",
  component: SourceBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    sourceType: {
      control: "select",
      options: [
        "x",
        "blog",
        "podcast",
        "website",
        "youtube",
        "github_trending",
        "product_hunt_top_products",
      ],
    },
    showLabel: { control: "boolean" },
    decorative: { control: "boolean" },
  },
} satisfies Meta<typeof SourceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const X: Story = { args: { sourceType: "x" } };
export const Blog: Story = { args: { sourceType: "blog" } };
export const Podcast: Story = { args: { sourceType: "podcast" } };
export const YouTube: Story = { args: { sourceType: "youtube" } };
export const Website: Story = { args: { sourceType: "website" } };

export const IconOnly: Story = {
  args: { sourceType: "blog", showLabel: false },
};

export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", maxWidth: 420 }}>
      {[
        "x",
        "blog",
        "podcast",
        "youtube",
        "website",
        "github_trending",
        "product_hunt_top_products",
      ].map((type) => (
        <SourceBadge key={type} sourceType={type} />
      ))}
    </div>
  ),
};
