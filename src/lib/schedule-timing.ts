export type ScheduleTimingJob = {
  frequencyKey: string;
  intervalMinutes: number;
  schedule: string;
  startedAt: string;
  platform?: string | null;
};

export function usesRelativeIntervalSchedule(cronJob: ScheduleTimingJob): boolean {
  const schedule = cronJob.schedule.trim();
  // `interval:<seconds>` fires every N seconds from load (launchd StartInterval),
  // so it is genuinely relative to the job start time.
  if (/^interval:\d+$/i.test(schedule)) return true;
  // `anchor:<cron>` fires at a fixed wall-clock time (cron / launchd
  // StartCalendarInterval). Daily and weekly anchors must track wall-clock so a
  // DST transition does not shift every run out of the grace window; sub-daily
  // anchors (hourly and shorter) are DST-neutral and keep relative-interval
  // alignment, where the wall-clock branches cannot honour the cron minute.
  if (/^anchor:/i.test(schedule)) {
    return cronJob.frequencyKey !== "daily" && cronJob.frequencyKey !== "weekly";
  }
  return /^(darwin|macos)$/i.test(cronJob.platform?.trim() ?? "");
}

export function addScheduleInterval(date: Date, cronJob: ScheduleTimingJob, steps = 1): Date {
  if (usesRelativeIntervalSchedule(cronJob)) {
    return new Date(date.getTime() + cronJob.intervalMinutes * 60_000 * steps);
  }

  const next = new Date(date);
  switch (cronJob.frequencyKey) {
    case "daily":
      next.setDate(next.getDate() + steps);
      return next;
    case "weekly":
      next.setDate(next.getDate() + steps * 7);
      return next;
    default:
      return new Date(date.getTime() + cronJob.intervalMinutes * 60_000 * steps);
  }
}

export function firstExpectedSchedule(cronJob: ScheduleTimingJob): Date | null {
  const startedAt = Date.parse(cronJob.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  const started = new Date(startedAt);
  return usesRelativeIntervalSchedule(cronJob) ? addScheduleInterval(started, cronJob) : started;
}

function parseCronSchedule(
  schedule: string,
): { minute: number; hour: number; weekday: number | null } | null {
  const expression = schedule.trim().replace(/^anchor:\s*/i, "");
  const fields = expression.split(/\s+/);
  if (fields.length < 5) return null;
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const weekdayField = Number(fields[4]);
  // cron weekday allows 0 and 7 for Sunday; normalise into Date#getDay() domain.
  const weekday =
    Number.isInteger(weekdayField) && weekdayField >= 0 && weekdayField <= 7
      ? weekdayField % 7
      : null;
  return { minute, hour, weekday };
}

export function floorToExpectedSchedule(now: Date, cronJob: ScheduleTimingJob): Date {
  if (usesRelativeIntervalSchedule(cronJob)) {
    const startedAt = Date.parse(cronJob.startedAt);
    const intervalMs = Math.max(1, cronJob.intervalMinutes) * 60_000;
    const elapsed = now.getTime() - startedAt;
    const slotIndex = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / intervalMs) : 0;
    return new Date(startedAt + slotIndex * intervalMs);
  }

  const value = new Date(now);
  value.setSeconds(0, 0);

  switch (cronJob.frequencyKey) {
    case "30m":
      value.setMinutes(value.getMinutes() >= 30 ? 30 : 0);
      return value;
    case "1h":
      value.setMinutes(0);
      return value;
    case "3h":
    case "6h":
    case "12h": {
      const hours = cronJob.intervalMinutes / 60;
      value.setHours(Math.floor(value.getHours() / hours) * hours, 0, 0, 0);
      return value;
    }
    case "daily": {
      const target = parseCronSchedule(cronJob.schedule);
      value.setHours(target?.hour ?? 8, target?.minute ?? 0, 0, 0);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 1);
      return value;
    }
    case "weekly": {
      const target = parseCronSchedule(cronJob.schedule);
      value.setHours(target?.hour ?? 8, target?.minute ?? 0, 0, 0);
      // Default to Monday when the stored schedule is not a parseable cron,
      // preserving the previous fixed-Monday alignment for legacy rows.
      const targetWeekday = target?.weekday ?? 1;
      const daysSinceTarget = (value.getDay() - targetWeekday + 7) % 7;
      value.setDate(value.getDate() - daysSinceTarget);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 7);
      return value;
    }
    default: {
      const startedAt = Date.parse(cronJob.startedAt);
      const intervalMs = Math.max(1, cronJob.intervalMinutes) * 60_000;
      const elapsed = now.getTime() - startedAt;
      const slotIndex = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / intervalMs) : 0;
      return new Date(startedAt + slotIndex * intervalMs);
    }
  }
}
