import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PostFavoriteButton } from "./PostFavoriteButton";

const meta = {
  title: "Actions/PostFavoriteButton",
  component: PostFavoriteButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    isFavorite: false,
    disabled: false,
    onToggle: () => {},
  },
} satisfies Meta<typeof PostFavoriteButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = {
  args: { isFavorite: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Interactive: Story = {
  render: (args) => {
    const [isFavorite, setIsFavorite] = useState(false);
    return (
      <PostFavoriteButton
        {...args}
        isFavorite={isFavorite}
        onToggle={() => setIsFavorite((v) => !v)}
      />
    );
  },
};
