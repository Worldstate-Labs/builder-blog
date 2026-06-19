import type { Meta, StoryObj } from "@storybook/react-vite";
import { DigestContentView } from "./DigestContentView";
import type { DigestSourceLink } from "@/lib/digest-source-links";

// Digest markdown the CLI produces: `## section`, `### source`, `**title**`,
// summary paragraphs, then `Source: <url>`.
const CONTENT = [
  "## Blog",
  "",
  "### Stratechery",
  "",
  "**The quiet compounding of small infrastructure bets**",
  "",
  "A measured look at how unglamorous infrastructure investments compound over time, with three case studies and the second-order effects each unlocked.",
  "",
  "Source: https://stratechery.com/2026/quiet-compounding",
  "",
  "### Latent Space",
  "",
  "**Why evals are the new unit tests**",
  "",
  "The teams shipping reliable agents treat evaluation as a first-class workflow, not an afterthought bolted on before launch.",
  "",
  "Source: https://latent.space/p/evals",
  "",
  "## Podcast RSS",
  "",
  "### The Cognitive Revolution",
  "",
  "**Scaling laws, three years on**",
  "",
  "A retrospective on which predictions held up and which quietly broke down.",
  "",
  "Source: https://example.com/podcast/scaling-laws",
].join("\n");

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

const meta = {
  title: "Digest/DigestContent",
  component: DigestContentView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { content: CONTENT, sourceLinks },
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

// No sections/posts → plain prose (e.g. a "no new updates" note).
export const NoUpdates: Story = {
  args: {
    content: "No new updates since your last brief. Check back tomorrow.",
    sourceLinks: [],
  },
};
