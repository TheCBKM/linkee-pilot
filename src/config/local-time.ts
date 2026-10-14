import { getEnv } from "./env.js";

/**
 * Calendar helpers in the agent's TIMEZONE (not UTC, not the host clock).
 * Daily quota keys, post days and day-long backoffs must all agree with the
 * working-hours window, which is evaluated in TIMEZONE.
 */

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getEnv().TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** YYYY-MM-DD in TIMEZONE. */
export function getLocalDateString(date = new Date()): string {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 0=Sun … 6=Sat in TIMEZONE. */
export function getLocalWeekdayOf(date = new Date()): number {
  return WEEKDAYS[localParts(date).weekday] ?? 0;
}

/** Milliseconds until the next local midnight in TIMEZONE. */
export function msUntilLocalMidnight(now = new Date()): number {
  const p = localParts(now);
  const elapsed =
    (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 +
    now.getMilliseconds();
  return 24 * 3600 * 1000 - elapsed;
}
