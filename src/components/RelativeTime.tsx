"use client";

import { useEffect, useState } from "react";
import {
  type DateInput,
  formatAbsoluteDate,
  formatAbsoluteDateTime,
  relativeTime,
  toEpochMs,
} from "@/lib/relative-time";

/**
 * Shared 60s ticker. A single interval drives every mounted RelativeTime, so a
 * feed of N timestamps does not spin up N timers. Returns `null` on the server
 * and on the first client render (so SSR output is stable), then the current
 * epoch ms after mount, refreshing every minute.
 */
const subscribers = new Set<(now: number) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (ticker || typeof window === "undefined") return;
  ticker = setInterval(() => {
    const now = Date.now();
    subscribers.forEach((notify) => notify(now));
  }, 60_000);
}

export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const notify = (value: number) => setNow(value);
    subscribers.add(notify);
    ensureTicker();
    return () => {
      subscribers.delete(notify);
      if (subscribers.size === 0 && ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    };
  }, []);
  return now;
}

export type RelativeTimeProps = {
  /** ISO string, epoch ms, or Date. */
  value: DateInput | null | undefined;
  className?: string;
  /** Text shown when the value is missing/invalid (default: nothing). */
  fallback?: string;
  /** Prefix rendered before the relative label, e.g. "Last connected ". */
  prefix?: string;
};

/**
 * Renders a smart relative timestamp inside a semantic <time> element.
 *
 * - Server / pre-hydration: shows the short absolute date (stable for SSR).
 * - After mount: shows the relative label ("5 min ago"), refreshing each minute.
 * - `title` always carries the full precise timestamp for hover.
 * - `dateTime` carries the machine-readable ISO value for assistive tech.
 */
export function RelativeTime({ value, className, fallback = "", prefix }: RelativeTimeProps) {
  const now = useNow();
  const ms = toEpochMs(value);

  if (!Number.isFinite(ms)) {
    return fallback ? <span className={className}>{fallback}</span> : null;
  }

  const iso = new Date(ms).toISOString();
  const title = formatAbsoluteDateTime(ms);
  const label =
    now == null ? formatAbsoluteDate(ms, ms) : relativeTime(ms, now);

  return (
    <time className={className} dateTime={iso} title={title} suppressHydrationWarning>
      {prefix}
      {label}
    </time>
  );
}
