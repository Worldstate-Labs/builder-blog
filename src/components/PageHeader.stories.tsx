import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "Layout/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    title: "Favorites",
    description: "Posts you’ve saved across every source you follow.",
  },
};

export const WithActions: Story = {
  args: {
    title: "Your library",
    description: "Sources feeding your daily AI Brief.",
    actions: (
      <button className="fb-btn" type="button">
        Add source
      </button>
    ),
  },
};

export const TitleOnly: Story = {
  args: {
    title: "Settings",
  },
};
