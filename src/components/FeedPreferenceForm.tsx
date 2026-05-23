"use client";

import { useState, useTransition } from "react";

type DigestFrequency = "DAILY" | "WEEKLY" | "CUSTOM";

export type FeedPreferenceFormInitialValue = {
  digestFrequency: DigestFrequency;
  digestCustomFrequencyDays: number;
  digestMaxPostAgeDays: number;
  recommendationProfile: string;
};

export function FeedPreferenceForm({
  initialValue,
}: {
  initialValue: FeedPreferenceFormInitialValue;
}) {
  const [digestFrequency, setDigestFrequency] = useState(initialValue.digestFrequency);
  const [digestCustomFrequencyDays, setDigestCustomFrequencyDays] = useState(
    String(initialValue.digestCustomFrequencyDays),
  );
  const [digestMaxPostAgeDays, setDigestMaxPostAgeDays] = useState(
    String(initialValue.digestMaxPostAgeDays),
  );
  const [recommendationProfile, setRecommendationProfile] = useState(
    initialValue.recommendationProfile,
  );
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("idle");
    setMessage("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/feed-preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            digestFrequency,
            digestCustomFrequencyDays: Number(digestCustomFrequencyDays),
            digestMaxPostAgeDays: Number(digestMaxPostAgeDays),
            recommendationProfile,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setStatus("saved");
        setMessage("Saved");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Save failed");
      }
    });
  }

  return (
    <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold">
          Digest frequency
          <select
            className="input"
            value={digestFrequency}
            onChange={(event) => setDigestFrequency(event.target.value as DigestFrequency)}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Custom days
          <input
            className="input"
            min="1"
            max="365"
            type="number"
            value={digestCustomFrequencyDays}
            onChange={(event) => setDigestCustomFrequencyDays(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Max post age
          <input
            className="input"
            min="1"
            max="365"
            type="number"
            value={digestMaxPostAgeDays}
            onChange={(event) => setDigestMaxPostAgeDays(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-semibold">
        Recommendation profile
        <textarea
          className="input min-h-32"
          maxLength={4000}
          value={recommendationProfile}
          onChange={(event) => setRecommendationProfile(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button-dark button-compact" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save feed preferences"}
        </button>
        <span aria-live="polite">
          {message ? (
            <span
              className={
                status === "saved"
                  ? "status-chip status-chip-success"
                  : "status-chip status-chip-danger"
              }
            >
              {message}
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
