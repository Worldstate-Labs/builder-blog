"use client";

import { Code2, Heading2, List, ListOrdered, Quote } from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useRef } from "react";

type MarkdownAction = "heading" | "bullet" | "ordered" | "quote" | "code";

const ACTIONS: Array<{
  id: MarkdownAction;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "heading", label: "Heading", icon: Heading2 },
  { id: "bullet", label: "Bulleted list", icon: List },
  { id: "ordered", label: "Numbered list", icon: ListOrdered },
  { id: "quote", label: "Quote", icon: Quote },
  { id: "code", label: "Code block", icon: Code2 },
];

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function replaceSelection(next: string, selectionStart: number, selectionEnd: number) {
    onChange(next);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function applyAction(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);

    if (action === "code") {
      const block = `\`\`\`\n${selected}\n\`\`\``;
      const next = value.slice(0, start) + block + value.slice(end);
      replaceSelection(next, start + 4, start + 4 + selected.length);
      return;
    }

    const prefix =
      action === "heading" ? "## " : action === "bullet" ? "- " : action === "quote" ? "> " : "";
    if (!selected) {
      const marker = action === "ordered" ? "1. " : prefix;
      const next = value.slice(0, start) + marker + value.slice(end);
      replaceSelection(next, start + marker.length, start + marker.length);
      return;
    }

    const lines = selected.split("\n");
    const formatted = lines
      .map((line, index) =>
        action === "ordered" ? `${index + 1}. ${line.replace(/^\d+\.\s*/, "")}` : `${prefix}${line}`,
      )
      .join("\n");
    const next = value.slice(0, start) + formatted + value.slice(end);
    replaceSelection(next, start, start + formatted.length);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = value.slice(0, start) + "  " + value.slice(end);
    replaceSelection(next, start + 2, start + 2);
  }

  return (
    <div className="settings-markdown-editor">
      <div
        className="settings-markdown-toolbar"
        aria-label={`${ariaLabel} formatting`}
        role="toolbar"
      >
        {ACTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            className="settings-markdown-tool"
            onClick={() => applyAction(id)}
            title={label}
            type="button"
          >
            <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        className="settings-markdown-textarea"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        style={{ minHeight: `${height}px` }}
        value={value}
      />
    </div>
  );
}
