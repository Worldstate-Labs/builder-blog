import type { Meta, StoryObj } from "@storybook/react-vite";
import { DigestContentView } from "./DigestContentView";
import type { DigestSourceLink } from "@/lib/digest-source-links";

const sourceLinks: DigestSourceLink[] = [
  {
    entityId: "stratechery",
    name: "Stratechery",
    href: "/builder/stratechery",
    sourceType: "blog",
    sourceUrl: "https://stratechery.com",
    aliases: ["Stratechery"],
  },
  {
    entityId: "latent-space",
    name: "Latent Space",
    href: "/builder/latent-space",
    sourceType: "blog",
    sourceUrl: "https://latent.space",
    aliases: ["Latent Space"],
  },
  {
    entityId: "cognitive-revolution",
    name: "The Cognitive Revolution",
    href: "/builder/cognitive-revolution",
    sourceType: "podcast",
    sourceUrl: "https://example.com/podcast",
    aliases: ["The Cognitive Revolution"],
  },
];

const ITEMS = [
  {
    order: 0,
    section: { key: "blog", label: "Blog", sourceType: "blog" },
    source: {
      entityId: "stratechery",
      name: "Stratechery",
      sourceType: "blog",
      sourceUrl: "https://stratechery.com",
      fetchUrl: null,
    },
    sourceSummary: null,
    post: {
      feedItemId: "feed_stratechery",
      entityId: "stratechery",
      kind: "BLOG_POST" as const,
      externalId: "quiet-compounding",
      title: "The quiet compounding of small infrastructure bets",
      url: "https://stratechery.com/2026/quiet-compounding",
      sourceName: "Stratechery",
      sourceType: "blog",
      publishedAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T01:00:00.000Z",
    },
    summary:
      "A measured look at how unglamorous infrastructure investments compound over time, with three case studies and the second-order effects each unlocked.",
  },
  {
    order: 1,
    section: { key: "blog", label: "Blog", sourceType: "blog" },
    source: {
      entityId: "latent-space",
      name: "Latent Space",
      sourceType: "blog",
      sourceUrl: "https://latent.space",
      fetchUrl: null,
    },
    sourceSummary: null,
    post: {
      feedItemId: "feed_latent_space",
      entityId: "latent-space",
      kind: "BLOG_POST" as const,
      externalId: "evals",
      title: "Why evals are the new unit tests",
      url: "https://latent.space/p/evals",
      sourceName: "Latent Space",
      sourceType: "blog",
      publishedAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T01:00:00.000Z",
    },
    summary:
      "The teams shipping reliable agents treat evaluation as a first-class workflow, not an afterthought bolted on before launch.",
  },
  {
    order: 2,
    section: { key: "podcast", label: "Podcast RSS", sourceType: "podcast" },
    source: {
      entityId: "cognitive-revolution",
      name: "The Cognitive Revolution",
      sourceType: "podcast",
      sourceUrl: "https://example.com/podcast",
      fetchUrl: null,
    },
    sourceSummary: null,
    post: {
      feedItemId: "feed_cognitive_revolution",
      entityId: "cognitive-revolution",
      kind: "PODCAST_EPISODE" as const,
      externalId: "scaling-laws",
      title: "Scaling laws, three years on",
      url: "https://example.com/podcast/scaling-laws",
      sourceName: "The Cognitive Revolution",
      sourceType: "podcast",
      publishedAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T01:00:00.000Z",
    },
    summary: "A retrospective on which predictions held up and which quietly broke down.",
  },
];

const meta = {
  title: "Digest/DigestContent",
  component: DigestContentView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { items: ITEMS, sourceLinks },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DigestContentView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paper: Story = {};

export const Dark: Story = {
  args: { tone: "dark" },
  decorators: [
    (Story) => (
      <div style={{ background: "var(--surface-ink)", padding: "1.5rem", borderRadius: 14, maxWidth: 720, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};

export const NoUpdates: Story = {
  args: {
    items: [],
    sourceLinks: [],
  },
};
