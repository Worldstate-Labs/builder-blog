import type { Meta, StoryObj } from "@storybook/react-vite";
import { SourceAvatar, type SourceAvatarSource } from "./SourceAvatar";

// An inline SVG data URL keeps the "with image" story self-contained and
// offline — no external avatar host required to demo the image path.
const sampleAvatar =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72'>
       <rect width='72' height='72' fill='#2f6df6'/>
       <text x='50%' y='54%' font-size='34' fill='white' text-anchor='middle'
             dominant-baseline='middle' font-family='sans-serif'>K</text>
     </svg>`,
  );

function source(overrides: Partial<SourceAvatarSource>): SourceAvatarSource {
  return {
    avatarDataUrl: null,
    avatarUrl: null,
    fetchUrl: null,
    name: "Stratechery",
    sourceType: "blog",
    sourceUrl: "https://stratechery.com",
    ...overrides,
  };
}

const meta = {
  title: "Foundations/SourceAvatar",
  component: SourceAvatar,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof SourceAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monogram: Story = {
  args: {
    source: source({ name: "Stratechery", avatarUrl: null, sourceUrl: null, fetchUrl: null }),
  },
};

export const XHandle: Story = {
  name: "X handle (strips @)",
  args: {
    source: source({ name: "@karpathy", sourceType: "x", sourceUrl: null, fetchUrl: null }),
  },
};

export const WithImage: Story = {
  args: {
    source: source({ name: "Karpathy", avatarUrl: sampleAvatar }),
    imageSize: 48,
  },
};
