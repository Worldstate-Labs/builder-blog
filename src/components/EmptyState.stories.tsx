import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Feedback/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "inline-radio", options: [undefined, "empty", "error"] },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    tone: "empty",
    title: "No saved posts yet",
    body: "Posts you save to Favorites will collect here for later reading.",
  },
};

export const Error: Story = {
  args: {
    tone: "error",
    title: "Couldn’t load your feed",
    body: "Something went wrong fetching this source. Try again in a moment.",
  },
};

export const WithActions: Story = {
  args: {
    tone: "empty",
    title: "Your library is empty",
    body: "Add a source to start building your daily brief.",
    actions: (
      <button className="fb-btn" type="button">
        Add a source
      </button>
    ),
  },
};
