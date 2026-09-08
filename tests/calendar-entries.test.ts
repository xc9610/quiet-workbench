import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import {
  buildScheduleEntries,
  buildTaskDeadlineEntries,
  groupScheduleAgenda
} from "../src/domain/calendar-entries";

function task(id: string, due?: string, scheduled?: string): TaskRecord {
  return {
    id,
    scope: "project",
    path: `项目/${id}.md`,
    line: 1,
    text: `任务 ${id}`,
    completed: false,
    due,
    scheduled,
    sourceName: "演示项目",
    revision: "r1"
  };
}

describe("calendar entry responsibilities", () => {
  it("keeps deadlines in task calendar and scheduled work in the agenda", () => {
    const rows = [
      task("due-only", "2026-09-03"),
      task("scheduled-only", undefined, "2026-09-04"),
      task("same-day", "2026-09-05", "2026-09-05"),
      task("two-dates", "2026-09-08", "2026-09-06")
    ];

    const deadlines = buildTaskDeadlineEntries(rows, "2026-09-01");
    const schedule = buildScheduleEntries(rows, [], []);

    expect(deadlines.map((entry) => entry.id)).toEqual(["due:due-only", "due:two-dates"]);
    expect(schedule.map((entry) => entry.id)).toEqual([
      "scheduled:scheduled-only",
      "scheduled:same-day",
      "scheduled:two-dates"
    ]);
    expect(schedule.find((entry) => entry.id === "scheduled:same-day")?.subtitle).toContain("同日截止");
  });

  it("combines scheduled work, meetings and external events without importing Full Calendar tasks twice", () => {
    const entries = buildScheduleEntries(
      [task("scheduled", undefined, "2026-09-02")],
      [{ path: "会议/评审.md", name: "客户评审", due: "2026-09-02", startTime: "09:00", endTime: "10:30", project: "演示项目" }],
      [
        { id: "event", date: "2026-09-02", title: "电话", calendarName: "工作", startTime: "10:00", endTime: "10:30", allDay: false, isTask: false, completed: false },
        { id: "task", date: "2026-09-02", title: "插件任务镜像", allDay: true, isTask: true, completed: false }
      ]
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["task", "meeting", "event"]);
    expect(entries.find((entry) => entry.kind === "meeting")?.time).toBe("09:00–10:30");
    expect(entries.find((entry) => entry.kind === "event")?.time).toBe("10:00–10:30");
  });

  it("prefers the linked meeting note when Full Calendar contains the same event", () => {
    const entries = buildScheduleEntries(
      [],
      [{ path: "会议/评审.md", name: "客户评审", due: "2026-09-02", startTime: "09:00" }],
      [{ id: "external", date: "2026-09-02", title: "客户评审", startTime: "09:00", allDay: false, isTask: false, completed: false }]
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "meeting", path: "会议/评审.md", time: "09:00" });
  });

  it("groups only the configured agenda horizon and sorts timed entries first", () => {
    const entries = buildScheduleEntries(
      [task("all-day", undefined, "2026-09-02")],
      [],
      [
        { id: "timed", date: "2026-09-02", title: "上午会议", startTime: "09:00", allDay: false, isTask: false, completed: false },
        { id: "later", date: "2026-09-09", title: "范围外", allDay: true, isTask: false, completed: false }
      ]
    );
    const groups = groupScheduleAgenda(entries, "2026-09-01", 7);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((entry) => entry.title)).toEqual(["上午会议", "任务 all-day"]);
  });
});
