"use client";

import { useId, useState, useTransition } from "react";
import {
  SaveStatus,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

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

// Day-count bounds shared by the custom-frequency and max-post-age fields.
const MIN_DAYS = 1;
const MAX_DAYS = 365;

// Mirrors the admin forms' integer-bound validation pattern. Returns an error
// message when invalid, or null when the value is acceptable.
function validateDays(value: string, fieldLabel: string): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
    return `${fieldLabel} must be a whole number between ${MIN_DAYS} and ${MAX_DAYS}.`;
  }
  return null;
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
  const [status, setStatus] = useState<SaveStatusState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const customDaysId = useId();
  const maxAgeId = useId();
  const profileId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Client-side validation, matching the admin forms: integers within bounds.
    if (digestFrequency === "CUSTOM") {
      const error = validateDays(digestCustomFrequencyDays, "Custom interval");
      if (error) {
        setStatus({ kind: "error", message: error });
        return;
      }
    }
    if (digestMaxPostAgeDays.trim() !== "") {
      const error = validateDays(digestMaxPostAgeDays, "Max post age");
      if (error) {
        setStatus({ kind: "error", message: error });
        return;
      }
    }

    setStatus({ kind: "saving" });
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
        setStatus({ kind: "saved", message: "Saved" });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Save failed",
        });
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
        <span id="fb-digest-frequency-label" className="fb-field-label">
          Digest frequency
        </span>
        <div
          className="fb-pill-group"
          role="radiogroup"
          aria-labelledby="fb-digest-frequency-label"
        >
          {frequencyOptions.map((option) => (
            <button
              className={`fb-pill${digestFrequency === option.value ? " active" : ""}`}
              key={option.value}
              role="radio"
              aria-checked={digestFrequency === option.value}
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
          <label htmlFor={customDaysId}>Custom interval</label>
          <div className="flex items-center gap-3">
            <input
              id={customDaysId}
              aria-label="Custom interval in days"
              className="fb-input w-20"
              min={MIN_DAYS}
              max={MAX_DAYS}
              step={1}
              type="number"
              inputMode="numeric"
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
        <label htmlFor={maxAgeId}>Max post age</label>
        <div className="flex items-center gap-3">
          <input
            id={maxAgeId}
            aria-label="Max post age in days"
            className="fb-input w-20"
            min={MIN_DAYS}
            max={MAX_DAYS}
            step={1}
            type="number"
            inputMode="numeric"
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
        <label htmlFor={profileId}>Recommendation profile</label>
        <textarea
          id={profileId}
          aria-label="Recommendation profile"
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
            setStatus({ kind: "idle" });
          }}
          type="button"
        >
          Reset
        </button>
        <span className="ml-1" aria-live="polite">
          <SaveStatus status={status} />
        </span>
      </div>
    </form>
  );
}
