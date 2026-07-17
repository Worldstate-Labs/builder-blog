"use client";

import {
  Code2,
  Columns2,
  Eye,
  Heading2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Undo2,
} from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useRef, useState } from "react";

type MarkdownAction = "undo" | "heading" | "bullet" | "ordered" | "quote" | "code";
type MarkdownMode = "edit" | "split" | "preview";
type HistoryEntry = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const ACTIONS: Array<{
  id: MarkdownAction;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "undo", label: "Undo", icon: Undo2 },
  { id: "heading", label: "Heading", icon: Heading2 },
  { id: "bullet", label: "Bulleted list", icon: List },
  { id: "ordered", label: "Numbered list", icon: ListOrdered },
  { id: "quote", label: "Quote", icon: Quote },
  { id: "code", label: "Code block", icon: Code2 },
];

const MODES: Array<{
  id: MarkdownMode;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "edit", label: "Edit", icon: Pencil },
  { id: "split", label: "Edit and preview", icon: Columns2 },
  { id: "preview", label: "Preview", icon: Eye },
];

function renderMarkdownPreview(markdown: string) {
  const nodes = [];
  const lines = markdown.split("\n");
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre className="settings-markdown-preview-code" key={key++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const HeadingTag = `h${level}` as "h1" | "h2" | "h3";
      nodes.push(<HeadingTag key={key++}>{text}</HeadingTag>);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ul key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ol key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      nodes.push(<blockquote key={key++}>{quote.join("\n")}</blockquote>);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^\s*(```|#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    nodes.push(<p key={key++}>{paragraph.join(" ")}</p>);
  }

  if (nodes.length) return nodes;
  return (
    <p className="settings-markdown-preview-empty">
      Write text to preview formatting.
    </p>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  height = 320,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  ariaLabel: string;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const [mode, setMode] = useState<MarkdownMode>("edit");

  function focusSelection(selectionStart: number, selectionEnd: number) {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function pushHistory(entry: HistoryEntry) {
    historyRef.current = [...historyRef.current.slice(-49), entry];
  }

  function restoreFromHistory() {
    const previous = historyRef.current.pop();
    if (!previous) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      document.execCommand("undo");
      return;
    }
    if (mode === "preview") setMode("edit");
    onChange(previous.value);
    focusSelection(previous.selectionStart, previous.selectionEnd);
  }

  function replaceSelection(next: string, selectionStart: number, selectionEnd: number) {
    const textarea = textareaRef.current;
    if (next !== value) {
      pushHistory({
        value,
        selectionStart: textarea?.selectionStart ?? 0,
        selectionEnd: textarea?.selectionEnd ?? 0,
      });
    }
    onChange(next);
    focusSelection(selectionStart, selectionEnd);
  }

  function applyAction(action: MarkdownAction) {
    if (action === "undo") {
      restoreFromHistory();
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      setMode("edit");
      return;
    }
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
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      restoreFromHistory();
      return;
    }

    if (event.key !== "Tab") return;
    // Let Shift+Tab move focus backward out of the textarea (keyboard escape
    // path per WCAG 2.1.2) instead of inserting spaces and corrupting content.
    if (event.shiftKey) return;
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
            className="settings-markdown-tool settings-icon-button"
            onClick={() => applyAction(id)}
            onMouseDown={(event) => event.preventDefault()}
            title={label}
            type="button"
          >
            <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ))}
        <div className="settings-markdown-toolbar-spacer" />
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            aria-pressed={mode === id}
            className="settings-markdown-tool settings-icon-button"
            onClick={() => setMode(id)}
            onMouseDown={(event) => event.preventDefault()}
            title={label}
            type="button"
          >
            <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className={`settings-markdown-body is-${mode}`}>
        {mode !== "preview" ? (
          <textarea
            ref={textareaRef}
            aria-label={ariaLabel}
            className="settings-markdown-textarea"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            style={{ minHeight: `${height}px` }}
            value={value}
          />
        ) : null}
        {mode !== "edit" ? (
          <div
            aria-label={`${ariaLabel} preview`}
            className="settings-markdown-preview"
            style={{ minHeight: `${height}px` }}
          >
            {renderMarkdownPreview(value)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
