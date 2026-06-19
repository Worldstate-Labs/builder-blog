import type { Meta, StoryObj } from "@storybook/react-vite";
import { PostCardView, type PostCardPost } from "./PostCardView";

const longBody =
  "Infrastructure rarely announces itself. The teams that win the decade are " +
  "usually the ones that made a series of unglamorous bets — on tooling, on " +
  "data hygiene, on the boring parts of reliability — and let them compound. " +
  "This piece traces three such bets and what they returned five years later.";

const basePost: PostCardPost = {
  id: "post-1",
  title: "The quiet compounding of small infrastructure bets",
  body: longBody,
  summary:
    "A measured look at how unglamorous infrastructure investments compound " +
    "over time, with three case studies and the second-order effects each one " +
    "unlocked for the teams that made them.",
  url: "https://stratechery.com/2026/quiet-compounding",
  detailUrl: "/read/post-1",
  publishedAt: "2026-06-15T08:00:00.000Z",
  createdAt: "2026-06-15T09:30:00.000Z",
  sourceName: "Stratechery",
  sourceType: "blog",
  fetchTool:
    "Codex Desktop (model gpt-5.5) FollowBrief skill fetcher (RSS + full text)",
  builder: {
    id: "b-stratechery",
    entityId: "stratechery",
    avatarUrl: null,
    avatarDataUrl: null,
    name: "Stratechery",
    kind: "BLOG",
    sourceType: "blog",
    sourceUrl: "https://stratechery.com",
    fetchUrl: "https://stratechery.com/feed",
  },
};

const meta = {
  title: "Content/PostCardView",
  component: PostCardView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { post: basePost },
  // Feed cards live in a reading column; constrain width so stories match the
  // app's ~62–72ch measure rather than stretching full-bleed.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PostCardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};

export const Row: Story = {
  args: { variant: "row" },
};

export const Detail: Story = {
  args: { variant: "detail" },
};

export const XPost: Story = {
  name: "X / Twitter post",
  args: {
    post: {
      ...basePost,
      title: null,
      body: "Spent the weekend re-reading the original MapReduce paper. Still the cleanest example of a hard idea explained simply.",
      summary:
        "Spent the weekend re-reading the original MapReduce paper. Still the cleanest example of a hard idea explained simply.",
      sourceName: "@karpathy",
      sourceType: "x",
      url: "https://x.com/karpathy/status/123",
      detailUrl: null,
      builder: {
        id: "b-karpathy",
        entityId: "karpathy",
        avatarUrl: null,
        avatarDataUrl: null,
        name: "@karpathy",
        kind: "X",
        sourceType: "x",
        sourceUrl: "https://x.com/karpathy",
        fetchUrl: null,
      },
    },
  },
};

export const WithReasons: Story = {
  name: "With debug actions + reasons",
  args: {
    showDebugActions: true,
    reasons: [
      "You follow 3 sources in AI infrastructure",
      "Similar to posts you saved this week",
    ],
  },
};

export const AlternateChannels: Story = {
  args: {
    post: { ...basePost, alternateChannelCount: 2 },
  },
};

export const ReadState: Story = {
  name: "Already read",
  args: {
    dataRead: true,
    post: { ...basePost, url: "", detailUrl: "/read/post-1" },
  },
};
