"use client";

import { useMemo, useState, useTransition } from "react";

export type AdminBuilderManagerBuilder = {
  id: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  canonicalKey: string;
  sourceLabel: string;
  feedItemCount: number;
  subscriptionCount: number;
};

type SelectOption = {
  label: string;
  value: string;
};

export function AdminBuilderManager({
  builderKindOptions,
  initialBuilders,
  sourceOptions,
}: {
  builderKindOptions: SelectOption[];
  initialBuilders: AdminBuilderManagerBuilder[];
  sourceOptions: SelectOption[];
}) {
  const [builders, setBuilders] = useState(initialBuilders);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "added" | "removed" | "error">("idle");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const builderCountLabel = useMemo(
    () => `${builders.length} builders · unique by canonicalKey`,
    [builders.length],
  );

  function addBuilder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPhase("idle");
    setMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/builders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            kind: formData.get("kind"),
            sourceType: formData.get("sourceType"),
            handle: formData.get("handle"),
            sourceUrl: formData.get("sourceUrl"),
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setBuilders((current) => [body.builder, ...current.filter((item) => item.id !== body.builder.id)]);
        form.reset();
        setPhase("added");
        setMessage("Builder added");
      } catch (error) {
        setPhase("error");
        setMessage(error instanceof Error ? error.message : "Could not add builder");
      }
    });
  }

  function removeBuilder(builderId: string) {
    const previousBuilders = builders;
    setRemovingId(builderId);
    setPhase("idle");
    setMessage("");
    setBuilders((current) => current.filter((builder) => builder.id !== builderId));

    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/builders/${builderId}`, {
          method: "DELETE",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setPhase("removed");
        setMessage("Builder removed");
      } catch (error) {
        setBuilders(previousBuilders);
        setPhase("error");
        setMessage(error instanceof Error ? error.message : "Could not remove builder");
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <section className="mt-10">
      <div className="admin-panel mb-5">
        <h2 className="font-serif text-3xl">Add central builder</h2>
        <form className="mt-5 grid gap-3 md:grid-cols-[1fr_12rem_12rem_1fr_1fr_auto]" onSubmit={addBuilder}>
          <input className="input" name="name" placeholder="Name" required />
          <select className="input" name="kind" defaultValue={builderKindOptions[0]?.value}>
            {builderKindOptions.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <select className="input" name="sourceType" defaultValue="auto">
            <option value="auto">Auto source</option>
            {sourceOptions.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
          <input className="input" name="handle" placeholder="X handle" />
          <input className="input" name="sourceUrl" placeholder="URL or RSS" />
          <button className="button-dark button-compact justify-self-start" disabled={isPending} type="submit">
            {isPending ? "Adding..." : "Add"}
          </button>
        </form>
        <span aria-live="polite">
          {message ? (
            <span
              className={
                phase === "error"
                  ? "status-chip status-chip-danger mt-3"
                  : "status-chip status-chip-success mt-3"
              }
            >
              {message}
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-label">Builder pool</p>
          <h2 className="mt-2 font-serif text-4xl">Canonical sources</h2>
        </div>
        <span className="rounded-full border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm text-[var(--muted-strong)]">
          {builderCountLabel}
        </span>
      </div>

      <div className="item-list mt-5">
        {builders.map((builder) => (
          <article key={builder.id} className="admin-panel admin-panel-compact">
            <div className="item-summary item-summary-static">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-2xl">{builder.name}</h3>
                  <span className="kind-pill">{builder.sourceLabel}</span>
                </div>
                <p className="mt-2 truncate text-sm text-[var(--muted)]">
                  {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
                </p>
              </div>
              <div className="row-actions text-right text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                <span>{builder.feedItemCount} items</span>
                <span>{builder.subscriptionCount} subscribers</span>
                <button
                  className="button-light button-compact"
                  disabled={isPending || removingId === builder.id}
                  onClick={() => removeBuilder(builder.id)}
                  type="button"
                >
                  {removingId === builder.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
            <details className="inline-disclosure border-t border-[var(--line)] px-4 py-3">
              <summary>IDs and crawl source</summary>
              <dl className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Unique id</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {builder.id}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Canonical key</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {builder.canonicalKey}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Crawl source</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">
                    {builder.crawlUrl ?? builder.sourceUrl ?? "No crawl URL"}
                  </dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
