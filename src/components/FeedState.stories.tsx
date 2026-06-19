import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeedEmptyState, FeedLoadingState } from "./FeedState";

// FeedState bundles the feed-shaped loading skeleton and the empty/error panel
// used across the digest and following feeds.
const meta = {
  title: "Feedback/FeedState",
  component: FeedEmptyState,
  tags: ["autodocs"],
} satisfies Meta<typeof FeedEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: StoryObj = {
  render: () => <FeedLoadingState label="Loading your feed" />,
};

export const Empty: Story = {
  args: {
    tone: "empty",
    title: "Nothing new yet",
    body: "New posts from the sources you follow will appear here.",
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    tone: "error",
    role: "alert",
    title: "Couldn’t refresh this feed",
    body: "We hit an error talking to one of your sources. Try again shortly.",
  },
};
