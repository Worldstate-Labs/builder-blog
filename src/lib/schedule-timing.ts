export type ScheduleTimingJob = {
  frequencyKey: string;
  intervalMinutes: number;
  schedule: string;
  startedAt: string;
  platform?: string | null;
};

export function usesRelativeIntervalSchedule(cronJob: ScheduleTimingJob): boolean {
  if (/^interval:\d+$/i.test(cronJob.schedule.trim())) return true;
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
    case "daily":
      value.setHours(8, 0, 0, 0);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 1);
      return value;
    case "weekly": {
      value.setHours(8, 0, 0, 0);
      const daysSinceMonday = (value.getDay() + 6) % 7;
      value.setDate(value.getDate() - daysSinceMonday);
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
