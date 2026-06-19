import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // The tier-1 design-system components are pure React, so we use the Vite
  // builder rather than the Next.js framework (avoids coupling Storybook to
  // Next 16 internals). We only need to teach Vite the "@/..." path alias the
  // app uses; Tailwind v4 is picked up automatically from postcss.config.mjs.
  viteFinal: async (viteConfig) => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias ?? {}),
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    };
    return viteConfig;
  },
};

export default config;
