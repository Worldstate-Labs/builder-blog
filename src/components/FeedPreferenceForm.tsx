"use client";

import { useState, useTransition } from "react";

type DigestFrequency = "DAILY" | "WEEKLY" | "CUSTOM";

export type FeedPreferenceFormInitialValue = {
  digestFrequency: DigestFrequency;
  digestCustomFrequencyDays: number;
  // null = no lookback floor (blank input). When set, posts published longer
  // ago than this many days are excluded from digest candidate selection.
  digestMaxPostAgeDays: number | null;
  recommendationProfile: string;
};

// null → "" so the field renders blank (= no floor); a number → its string.
function ageToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

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
    ageToInput(initialValue.digestMaxPostAgeDays),
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
            // Blank → null (no floor); otherwise the entered number of days.
            digestMaxPostAgeDays:
              digestMaxPostAgeDays.trim() === ""
                ? null
                : Number(digestMaxPostAgeDays),
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

  const frequencyOptions: Array<{ value: DigestFrequency; label: string }> = [
    { value: "DAILY", label: "Daily" },
    { value: "WEEKLY", label: "Weekly" },
    { value: "CUSTOM", label: "Custom" },
  ];

  return (
    <form className="mt-4 grid gap-2" onSubmit={handleSubmit}>
      <div className="fb-field">
        <label>Digest frequency</label>
        <div className="fb-pill-group">
          {frequencyOptions.map((option) => (
            <button
              className={`fb-pill${digestFrequency === option.value ? " active" : ""}`}
              key={option.value}
              onClick={() => setDigestFrequency(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {digestFrequency === "CUSTOM" ? (
        <div className="fb-field">
          <label>Custom interval</label>
          <div className="flex items-center gap-3">
            <input
              aria-label="Custom interval in days"
              className="fb-input w-20"
              min="1"
              max="365"
              type="number"
              value={digestCustomFrequencyDays}
              onChange={(event) => setDigestCustomFrequencyDays(event.target.value)}
            />
            <span className="text-[13px] text-[var(--muted-strong)]">
              days between digests.
            </span>
          </div>
        </div>
      ) : null}

      <div className="fb-field">
        <label>Max post age</label>
        <div className="flex items-center gap-3">
          <input
            aria-label="Max post age in days"
            className="fb-input w-20"
            min="1"
            max="365"
            type="number"
            placeholder="No limit"
            value={digestMaxPostAgeDays}
            onChange={(event) => setDigestMaxPostAgeDays(event.target.value)}
          />
          <span className="text-[13px] text-[var(--muted-strong)]">
            days. Posts older than this are excluded from digests. Leave blank
            for no limit.
          </span>
        </div>
      </div>

      <div className="fb-field">
        <label>Recommendation profile</label>
        <textarea
          className="fb-textarea"
          maxLength={4000}
          value={recommendationProfile}
          onChange={(event) => setRecommendationProfile(event.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="fb-btn dark w-full justify-center sm:w-auto"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving..." : "Save preferences"}
        </button>
        <button
          className="fb-btn ghost w-full justify-center sm:w-auto"
          disabled={isPending}
          onClick={() => {
            setDigestFrequency(initialValue.digestFrequency);
            setDigestCustomFrequencyDays(String(initialValue.digestCustomFrequencyDays));
            setDigestMaxPostAgeDays(ageToInput(initialValue.digestMaxPostAgeDays));
            setRecommendationProfile(initialValue.recommendationProfile);
            setStatus("idle");
            setMessage("");
          }}
          type="button"
        >
          Reset
        </button>
        <span aria-live="polite" className="ml-1 text-[11.5px]">
          {message ? (
            <span
              className={
                status === "saved" ? "text-[var(--signal)]" : "text-[var(--danger)]"
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
