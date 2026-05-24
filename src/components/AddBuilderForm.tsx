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
    <form className="add-builder-form" onSubmit={addBuilder}>
      <div className="add-builder-form-header">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">Add source</h3>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">
            Create a private library entry.
          </p>
        </div>
        <button className="button-dark button-compact gap-2" disabled={isPending} type="submit">
          <Plus className="h-4 w-4" />
          {isPending ? "Adding..." : "Add"}
        </button>
      </div>
      <div className="add-builder-grid">
        <label>
          <span>Source</span>
          <select className="input" name="sourceType" defaultValue="x">
            {sourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Handle or URL</span>
          <input
            className="input"
            name="sourceValue"
            placeholder="@deepmind or https://example.com/feed"
            required
          />
        </label>
        <label className="add-builder-grid-wide">
          <span>Display name</span>
          <input className="input" name="name" placeholder="Optional; inferred when empty" />
        </label>
      </div>
      <span aria-live="polite">
        {error ? <span className="text-sm text-[var(--danger)]">{error}</span> : null}
        {status ? <span className="text-sm text-[var(--success)]">{status}</span> : null}
      </span>
    </form>
  );
}
