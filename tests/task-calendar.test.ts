import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import { groupTaskCalendarEntries, matchesTaskStatus, taskCalendarEntry } from "../src/domain/task-calendar";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { id: "a", scope: "project", path: "projects/a.md", sourceName: "Project A", line: 2, text: "Review", completed: false, revision: "r1", ...overrides };
}

describe("task month calendar", () => {
  it("uses the same scheduled-first date as the board, with explicit date roles", () => {
    const row = task({ scheduled: "2026-10-11", due: "2026-10-15" });
    expect(taskCalendarEntry(row, "effective")).toMatchObject({ date: "2026-10-11", dateRole: "scheduled" });
    expect(taskCalendarEntry(row, "due")).toMatchObject({ date: "2026-10-15", dateRole: "due" });
    expect(taskCalendarEntry(row, "scheduled")).toMatchObject({ date: "2026-10-11", dateRole: "scheduled" });
    expect(taskCalendarEntry(task({ due: "2026-10-15" }), "effective")).toMatchObject({ date: "2026-10-15", dateRole: "due" });
    expect(taskCalendarEntry(task({ due: "2026-10-15" }), "scheduled")).toBeUndefined();
  });

  it("keeps equally named tasks in different sources and terminal states individually addressable", () => {
    const rows = [
      task({ id: "one", due: "2026-10-11" }),
      task({ id: "two", path: "clients/b.md", scope: "client", due: "2026-10-11" }),
      task({ id: "three", completed: true, due: "2026-10-11" }),
      task({ id: "four", completed: true, cancelled: true, due: "2026-10-11" }),
      task({ id: "undated" })
    ];
    expect(groupTaskCalendarEntries(rows, "effective").get("2026-10-11")?.map((entry) => entry.task.id)).toEqual(["one", "two", "three", "four"]);
  });

  it("never counts cancelled tasks as completed or open", () => {
    const cancelled = task({ completed: true, cancelled: true });
    expect(matchesTaskStatus(cancelled, "all")).toBe(true);
    expect(matchesTaskStatus(cancelled, "cancelled")).toBe(true);
    expect(matchesTaskStatus(cancelled, "completed")).toBe(false);
    expect(matchesTaskStatus(cancelled, "open")).toBe(false);
    expect(matchesTaskStatus(task({ completed: true }), "completed")).toBe(true);
    expect(matchesTaskStatus(task(), "open")).toBe(true);
  });

  it("leaves missing and impossible dates off the grid", () => {
    expect(taskCalendarEntry(task(), "effective")).toBeUndefined();
    expect(taskCalendarEntry(task({ due: "2026-02-30" }), "due")).toBeUndefined();
    expect(taskCalendarEntry(task({ scheduled: "bad", due: "2026-12-31" }), "effective")?.date).toBe("2026-12-31");
    expect(taskCalendarEntry(task({ due: "2028-02-29" }), "due")?.date).toBe("2028-02-29");
  });
});
