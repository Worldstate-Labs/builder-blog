import type { Preview } from "@storybook/react-vite";
import React, { useEffect } from "react";
import "../src/app/globals.css";

type ThemeValue = "light" | "dark";

// The app drives theming via <html data-theme="light|dark"> (see globals.css
// `:root[data-theme="dark"]`) and applies base styles to `body` plus the
// `.fb-root` / `.fb-root-body` classes set in app/layout.tsx. The decorator
// reproduces that shell so components render exactly as they do in the app.
function applyShell(theme: ThemeValue) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.add("fb-root");
  document.body.classList.add("fb-root-body");
}

const preview: Preview = {
  parameters: {
    layout: "padded",
    // Background is owned by globals.css `body`; disable Storybook's own
    // backgrounds addon so the two never fight.
    backgrounds: { disable: true },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: { test: "todo" },
  },
  initialGlobals: {
    theme: "light",
  },
  globalTypes: {
    theme: {
      description: "FollowBrief light / dark theme",
      toolbar: {
        title: "Theme",
        icon: "contrast",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals.theme as ThemeValue) ?? "light";
      useEffect(() => {
        applyShell(theme);
      }, [theme]);
      // Apply synchronously too so the first paint already has the theme.
      applyShell(theme);
      return <Story />;
    },
  ],
};

export default preview;
