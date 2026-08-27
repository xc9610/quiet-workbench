import type { ActivityDay } from "../core/types";

export interface ActivityCell extends ActivityDay {
  level: 0 | 1 | 2 | 3 | 4;
  inRange: boolean;
}

export interface ActivityStats {
  total: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

export function buildActivityCalendar(days: ActivityDay[], today = new Date(), weeks = 53): ActivityCell[] {
  const end = startOfLocalDay(today);
  end.setDate(end.getDate() + (6 - mondayIndex(end)));
  const start = new Date(end);
  start.setDate(end.getDate() - (weeks * 7 - 1));
  const actualStart = new Date(today);
  actualStart.setDate(actualStart.getDate() - (weeks * 7 - 1));
  const counts = new Map(days.map((day) => [day.date, Math.max(0, day.count)]));
  const max = Math.max(1, ...counts.values());
  const result: ActivityCell[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = localDateKey(cursor);
    const count = counts.get(date) ?? 0;
    result.push({ date, count, level: activityLevel(count, max), inRange: cursor >= actualStart && cursor <= today });
  }
  return result;
}

export function activityStats(days: ActivityDay[], today = new Date()): ActivityStats {
  const counts = new Map(days.map((day) => [day.date, Math.max(0, day.count)]));
  const active = [...counts.entries()].filter(([, count]) => count > 0);
  let longestStreak = 0;
  let run = 0;
  let previous: Date | undefined;
  for (const date of active.map(([key]) => key).sort()) {
    const current = parseLocalDate(date);
    run = previous && daysBetween(previous, current) === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = current;
  }
  let currentStreak = 0;
  const cursor = startOfLocalDay(today);
  if (!(counts.get(localDateKey(cursor)) ?? 0)) cursor.setDate(cursor.getDate() - 1);
  while ((counts.get(localDateKey(cursor)) ?? 0) > 0) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    total: days.reduce((sum, day) => sum + Math.max(0, day.count), 0),
    activeDays: active.length,
    currentStreak,
    longestStreak
  };
}

export function activityLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function mondayIndex(date: Date): number { return (date.getDay() + 6) % 7; }
function startOfLocalDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function daysBetween(left: Date, right: Date): number { return Math.round((right.getTime() - left.getTime()) / 86_400_000); }
