"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => <div className="settings-markdown-editor-loading" aria-hidden="true" />,
});

export function MarkdownEditor({
  value,
  onChange,
  height = 320,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  ariaLabel: string;
}) {
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const syncColorMode = () => {
      setColorMode(root.dataset.theme === "dark" ? "dark" : "light");
    };
    syncColorMode();
    const observer = new MutationObserver(syncColorMode);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="settings-markdown-editor" data-color-mode={colorMode}>
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? "")}
        height={height}
        preview="edit"
        visibleDragbar
        textareaProps={{
          "aria-label": ariaLabel,
          spellCheck: false,
        }}
      />
    </div>
  );
}
