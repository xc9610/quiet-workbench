import type { TaskRecord } from "../core/types";

export type TaskCalendarDateMode = "effective" | "scheduled" | "due";
export type TaskStatusFilter = "all" | "open" | "completed" | "cancelled";

export interface TaskCalendarEntry {
  task: TaskRecord;
  date: string;
  dateRole: "scheduled" | "due";
}

export function matchesTaskStatus(task: TaskRecord, status: TaskStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "cancelled") return Boolean(task.cancelled);
  if (task.cancelled) return false;
  return status === "completed" ? task.completed : !task.completed;
}

/** Matches the board's scheduled-first date, while retaining the role shown to the user. */
export function taskCalendarEntry(task: TaskRecord, mode: TaskCalendarDateMode): TaskCalendarEntry | undefined {
  const scheduled = datePart(task.scheduled);
  const due = datePart(task.due);
  const date = mode === "scheduled" ? scheduled : mode === "due" ? due : scheduled || due;
  if (!date) return undefined;
  return { task, date, dateRole: mode === "due" || !scheduled ? "due" : "scheduled" };
}

export function groupTaskCalendarEntries(tasks: readonly TaskRecord[], mode: TaskCalendarDateMode): Map<string, TaskCalendarEntry[]> {
  const groups = new Map<string, TaskCalendarEntry[]>();
  for (const task of tasks) {
    const entry = taskCalendarEntry(task, mode);
    if (!entry) continue;
    const rows = groups.get(entry.date) ?? [];
    rows.push(entry);
    groups.set(entry.date, rows);
  }
  return groups;
}

function datePart(value?: string): string | undefined {
  const date = value?.slice(0, 10);
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match || !date) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? date : undefined;
}
