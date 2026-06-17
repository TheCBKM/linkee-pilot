import { getEnv } from "../config/env.js";
import { LIMITS } from "../config/limits.js";

function getLocalDate(): Date {
  const tz = getEnv().TIMEZONE;
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekday = weekdayMap[get("weekday")] ?? 0;
  const hour = parseInt(get("hour"), 10);

  const date = new Date(now);
  date.setHours(hour, 0, 0, 0);
  return Object.assign(date, { _weekday: weekday, _hour: hour });
}

export function getLocalHour(): number {
  const tz = getEnv().TIMEZONE;
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  return parseInt(hour, 10);
}

export function getLocalWeekday(): number {
  const tz = getEnv().TIMEZONE;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date());

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

export function isWithinWorkingHours(): boolean {
  const weekday = getLocalWeekday();
  const hour = getLocalHour();
  const { workDays, startHour, endHour } = LIMITS.workingHours;

  if (!(workDays as readonly number[]).includes(weekday)) return false;
  return hour >= startHour && hour < endHour;
}

export function msUntilWorkingHours(): number {
  if (isWithinWorkingHours()) return 0;

  const tz = getEnv().TIMEZONE;
  const now = new Date();
  const { startHour } = LIMITS.workingHours;

  // Sleep at least 5 minutes, max until next working window
  const minSleep = 5 * 60 * 1000;

  const weekday = getLocalWeekday();
  const hour = getLocalHour();

  if ((LIMITS.workingHours.workDays as readonly number[]).includes(weekday)) {
    if (hour < startHour) {
      const hoursUntil = startHour - hour;
      return Math.max(minSleep, hoursUntil * 60 * 60 * 1000);
    }
    // After hours on a workday — sleep until tomorrow 8am
    const hoursUntilTomorrow = 24 - hour + startHour;
    return Math.max(minSleep, hoursUntilTomorrow * 60 * 60 * 1000);
  }

  // Weekend — sleep 1 hour and re-check
  return 60 * 60 * 1000;
}

export function getTimeWindow():
  | "morning"
  | "midday"
  | "afternoon"
  | "late_afternoon"
  | "off_hours" {
  if (!isWithinWorkingHours()) return "off_hours";
  const hour = getLocalHour();
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  return "late_afternoon";
}
