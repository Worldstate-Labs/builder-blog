"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "fb-theme";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  window.addEventListener("fb-theme-change", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener("fb-theme-change", callback);
  };
}

function getClientSnapshot(): Theme {
  const dataset = document.documentElement.dataset.theme;
  if (dataset === "light" || dataset === "dark") return dataset;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (Safari private mode etc.); fall through.
  }
  window.dispatchEvent(new Event("fb-theme-change"));
}

export function ThemeToggle() {
  const theme = useTheme();

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="theme-toggle"
      suppressHydrationWarning
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
    </button>
  );
}
