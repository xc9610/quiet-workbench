import type { TaskRecord } from "../core/types";
import type { FullCalendarEventSummary } from "../services/full-calendar-adapter";

export type CalendarEntryKind = "task" | "meeting" | "event";
export type CalendarDateRole = "due" | "scheduled" | "meeting" | "event";

export interface CalendarEntry {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  time?: string;
  path?: string;
  kind: CalendarEntryKind;
  dateRole: CalendarDateRole;
  overdue: boolean;
  completed: boolean;
}

export interface CalendarMeeting {
  path: string;
  name: string;
  due?: string;
  startTime?: string;
  endTime?: string;
  project?: string;
  client?: string;
}

export interface CalendarAgendaGroup {
  date: string;
  entries: CalendarEntry[];
}

export function buildTaskDeadlineEntries(tasks: TaskRecord[], today: string): CalendarEntry[] {
  return tasks.flatMap((task) => {
    const due = datePart(task.due);
    if (!due) return [];
    const scheduled = datePart(task.scheduled);
    if (scheduled === due) return [];
    return [{
      id: `due:${task.id}`,
      date: due,
      title: task.text,
      subtitle: `${scopeLabel(task.scope)} · ${task.sourceName}${scheduled ? ` · 计划 ${scheduled}` : ""}`,
      path: task.path,
      kind: "task" as const,
      dateRole: "due" as const,
      overdue: !task.completed && due < today,
      completed: task.completed
    }];
  });
}

export function buildMeetingEntries(meetings: CalendarMeeting[]): CalendarEntry[] {
  return meetings.flatMap((meeting) => {
    const date = datePart(meeting.due);
    if (!date) return [];
    return [{
      id: `meeting:${meeting.path}`,
      date,
      title: meeting.name,
      subtitle: meeting.project || meeting.client || "会议记录",
      time: meeting.startTime && meeting.endTime
        ? `${meeting.startTime}–${meeting.endTime}`
        : meeting.startTime,
      path: meeting.path,
      kind: "meeting" as const,
      dateRole: "meeting" as const,
      overdue: false,
      completed: false
    }];
  });
}

export function buildScheduleEntries(
  tasks: TaskRecord[],
  meetings: CalendarMeeting[],
  events: FullCalendarEventSummary[]
): CalendarEntry[] {
  const scheduledTasks: CalendarEntry[] = tasks.flatMap((task) => {
    const scheduled = datePart(task.scheduled);
    if (!scheduled) return [];
    const due = datePart(task.due);
    const deadlineNote = due === scheduled ? " · 同日截止" : due ? ` · 截止 ${due}` : "";
    return [{
      id: `scheduled:${task.id}`,
      date: scheduled,
      title: task.text,
      subtitle: `${scopeLabel(task.scope)} · ${task.sourceName}${deadlineNote}`,
      path: task.path,
      kind: "task" as const,
      dateRole: "scheduled" as const,
      overdue: false,
      completed: task.completed
    }];
  });
  const external: CalendarEntry[] = events
    .filter((event) => !event.isTask)
    .map((event) => ({
      id: `full-calendar:${event.id}`,
      date: event.date,
      title: event.title,
      subtitle: event.calendarName || "Full Calendar",
      time: event.startTime && event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime,
      kind: "event" as const,
      dateRole: "event" as const,
      overdue: false,
      completed: event.completed
    }));
  return deduplicateEntries([...scheduledTasks, ...buildMeetingEntries(meetings), ...external]);
}

export function groupScheduleAgenda(
  entries: CalendarEntry[],
  startDate: string,
  days = 7
): CalendarAgendaGroup[] {
  const finalDate = shiftDate(startDate, Math.max(1, Math.round(days)) - 1);
  const groups = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    if (entry.date < startDate || entry.date > finalDate) continue;
    groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, rows]) => ({
      date,
      entries: [...rows].sort((left, right) => (left.time || "24:00").localeCompare(right.time || "24:00") || left.title.localeCompare(right.title, "zh-CN"))
    }));
}

function deduplicateEntries(entries: CalendarEntry[]): CalendarEntry[] {
  const result = new Map<string, CalendarEntry>();
  for (const entry of entries) {
    const key = `${entry.date}::${entry.title.trim().toLocaleLowerCase("zh-CN")}`;
    const current = result.get(key);
    if (!current || entry.path) result.set(key, entry);
  }
  return [...result.values()];
}

function scopeLabel(scope: TaskRecord["scope"]): string {
  return { project: "项目", client: "客户", "meeting-draft": "会议草稿" }[scope];
}

function datePart(value?: string): string | undefined {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : undefined;
}

function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
