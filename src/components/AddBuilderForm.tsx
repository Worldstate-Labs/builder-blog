"use client";

import { FormEvent, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";

type SourceOption = {
  id: string;
  label: string;
};

export function AddBuilderForm({ sourceOptions }: { sourceOptions: SourceOption[] }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function addBuilder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError("");
    setStatus("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/builders/personal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(formData.get("name") ?? ""),
            sourceType: String(formData.get("sourceType") ?? "x"),
            sourceValue: String(formData.get("sourceValue") ?? ""),
          }),
        });
        if (!response.ok) throw new Error("Unable to add source");
        const payload = (await response.json()) as { builder?: BuilderLibraryEventItem };
        if (!payload.builder) throw new Error("Missing source");
        window.dispatchEvent(
          new CustomEvent<BuilderLibraryEventItem>(builderLibraryBuilderAdded, {
            detail: payload.builder,
          }),
        );
        form.reset();
        setStatus("Source added.");
      } catch {
        setError("Could not add source.");
      }
    });
  }

  return (
    <form className="grid gap-2" onSubmit={addBuilder}>
      <div className="grid items-center gap-2 sm:grid-cols-[11rem_1fr_auto]">
        <select
          aria-label="Source type"
          className="fb-input"
          name="sourceType"
          defaultValue="x"
        >
          {sourceOptions.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Handle or URL"
          className="fb-input"
          name="sourceValue"
          placeholder="@deepmind or https://example.com/feed"
          required
        />
        <button className="fb-btn dark" disabled={isPending} type="submit">
          <Plus aria-hidden="true" />
          {isPending ? "Adding..." : "Add source"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label="Display name"
          className="fb-input flex-1"
          name="name"
          placeholder="Display name (optional)"
        />
        <span aria-live="polite" className="text-[11.5px]">
          {error ? (
            <span className="text-[var(--danger)]">{error}</span>
          ) : status ? (
            <span className="text-[var(--success)]">{status}</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
