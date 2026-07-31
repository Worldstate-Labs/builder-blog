export type ScheduleTimingJob = {
  frequencyKey: string;
  intervalMinutes: number;
  schedule: string;
  startedAt: string;
  timeZone?: string | null;
  platform?: string | null;
};

type ParsedCronSchedule = {
  minute: number;
  hour: number;
  weekday: number | null;
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type LocalDateParts = Pick<LocalDateTimeParts, "year" | "month" | "day">;

type ZonedCalendarSchedule = {
  frequencyKey: "daily" | "weekly";
  timeZone: string;
  target: ParsedCronSchedule;
};

export function usesRelativeIntervalSchedule(cronJob: ScheduleTimingJob): boolean {
  const schedule = cronJob.schedule.trim();
  // `interval:<seconds>` fires every N seconds from load (launchd StartInterval),
  // so it is genuinely relative to the job start time.
  if (/^interval:\d+$/i.test(schedule)) return true;
  if (getZonedCalendarSchedule(cronJob)) return false;
  if (cronJob.frequencyKey === "daily" || cronJob.frequencyKey === "weekly") return true;
  // `anchor:<cron>` fires at a fixed wall-clock time (cron / launchd
  // StartCalendarInterval). Daily and weekly anchors must track wall-clock so a
  // DST transition does not shift every run out of the grace window; sub-daily
  // anchors (hourly and shorter) are DST-neutral and keep relative-interval
  // alignment, where the wall-clock branches cannot honour the cron minute.
  if (/^anchor:/i.test(schedule)) return true;
  return /^(darwin|macos)$/i.test(cronJob.platform?.trim() ?? "");
}

export function addScheduleInterval(date: Date, cronJob: ScheduleTimingJob, steps = 1): Date {
  const zonedSchedule = getZonedCalendarSchedule(cronJob);
  if (zonedSchedule) {
    return addZonedCalendarInterval(date, zonedSchedule, steps);
  }

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
  const zonedSchedule = getZonedCalendarSchedule(cronJob);
  if (zonedSchedule) {
    return addZonedCalendarInterval(floorZonedCalendarSchedule(started, zonedSchedule), zonedSchedule);
  }
  return usesRelativeIntervalSchedule(cronJob) ? addScheduleInterval(started, cronJob) : started;
}

function parseCronSchedule(schedule: string): ParsedCronSchedule | null {
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
  const zonedSchedule = getZonedCalendarSchedule(cronJob);
  if (zonedSchedule) {
    return floorZonedCalendarSchedule(now, zonedSchedule);
  }

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

function normalizeTimeZone(timeZone: string | null | undefined): string | null {
  const candidate = String(timeZone ?? "").trim();
  if (!candidate) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function getZonedCalendarSchedule(cronJob: ScheduleTimingJob): ZonedCalendarSchedule | null {
  if (cronJob.frequencyKey !== "daily" && cronJob.frequencyKey !== "weekly") return null;

  const timeZone = normalizeTimeZone(cronJob.timeZone);
  if (!timeZone) return null;

  const parsed = parseCronSchedule(cronJob.schedule);
  if (!parsed) return null;
  if (cronJob.frequencyKey === "weekly" && parsed.weekday === null) return null;
  return {
    frequencyKey: cronJob.frequencyKey,
    timeZone,
    target: {
      minute: parsed.minute,
      hour: parsed.hour,
      weekday: cronJob.frequencyKey === "weekly" ? parsed.weekday : null,
    },
  };
}

function addZonedCalendarInterval(date: Date, schedule: ZonedCalendarSchedule, steps = 1): Date {
  const localDate = getTimeZoneDateParts(date, schedule.timeZone);
  const nextDate = addLocalDays(localDate, schedule.frequencyKey === "daily" ? steps : steps * 7);
  return localDateTimeToUtcCompatible(nextDate, schedule.target.hour, schedule.target.minute, schedule.timeZone);
}

function floorZonedCalendarSchedule(now: Date, schedule: ZonedCalendarSchedule): Date {
  const localNow = getTimeZoneParts(now, schedule.timeZone);
  const candidateDate =
    schedule.frequencyKey === "weekly"
      ? addLocalDays(
          localNow,
          -((weekdayForDate(localNow) - (schedule.target.weekday ?? 1) + 7) % 7),
        )
      : getTimeZoneDateParts(now, schedule.timeZone);
  let candidate = localDateTimeToUtcCompatible(
    candidateDate,
    schedule.target.hour,
    schedule.target.minute,
    schedule.timeZone,
  );

  if (candidate.getTime() > now.getTime()) {
    candidate = addZonedCalendarInterval(candidate, schedule, -1);
  }

  return candidate;
}

function getTimeZoneDateParts(date: Date, timeZone: string): LocalDateParts {
  const { year, month, day } = getTimeZoneParts(date, timeZone);
  return { year, month, day };
}

function getTimeZoneParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const utcLike = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (utcLike - Math.trunc(date.getTime() / 1000) * 1000) / 60_000;
}

function localDateTimeToUtcCompatible(
  date: LocalDateParts,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtcMs = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  const offsets = new Set<number>();
  for (let offsetHours = -36; offsetHours <= 36; offsetHours += 3) {
    offsets.add(getTimeZoneOffsetMinutes(new Date(naiveUtcMs + offsetHours * 60 * 60_000), timeZone));
  }

  const candidates = [...offsets]
    .filter((offset) => Number.isFinite(offset))
    .map((offset) => {
      const utcMs = naiveUtcMs - offset * 60_000;
      const local = getTimeZoneParts(new Date(utcMs), timeZone);
      return { utcMs, local };
    })
    .sort((left, right) => left.utcMs - right.utcMs);

  const exact = candidates.find(({ local }) => (
    local.year === date.year &&
    local.month === date.month &&
    local.day === date.day &&
    local.hour === hour &&
    local.minute === minute
  ));
  if (exact) return new Date(exact.utcMs);

  const target = { ...date, hour, minute };
  const shiftedForward = candidates
    .filter(({ local }) => (
      local.year === date.year &&
      local.month === date.month &&
      local.day === date.day &&
      compareLocalDateTimes(local, target) > 0
    ))
    .sort((left, right) => compareLocalDateTimes(left.local, right.local) || left.utcMs - right.utcMs)[0];

  if (shiftedForward) return new Date(shiftedForward.utcMs);
  return new Date(candidates.at(-1)?.utcMs ?? naiveUtcMs);
}

function compareLocalDateTimes(
  left: Pick<LocalDateTimeParts, "year" | "month" | "day" | "hour" | "minute">,
  right: Pick<LocalDateTimeParts, "year" | "month" | "day" | "hour" | "minute">,
): number {
  return (
    left.year - right.year ||
    left.month - right.month ||
    left.day - right.day ||
    left.hour - right.hour ||
    left.minute - right.minute
  );
}

function addLocalDays(date: LocalDateParts, days: number): LocalDateParts {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function weekdayForDate(date: LocalDateParts): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}
