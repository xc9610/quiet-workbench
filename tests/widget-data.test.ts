import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import {
  calculateProjectHealth,
  clientFollowupBucket,
  dateAfter,
  isRecurringTask,
  isWaitingTask,
  suggestedDueForTimeBucket,
  suggestedTaskBoardDrop,
  taskQuadrant,
  taskTimeBucket
} from "../src/domain/widget-data";

function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task",
    scope: "project",
    path: "projects/example.md",
    line: 1,
    text: "下一步",
    completed: false,
    sourceName: "Example",
    revision: "r1",
    ...patch
  };
}

describe("independent widget data derivation", () => {
  it("maps time-board drops to explicit suggested due dates", () => {
    expect(suggestedDueForTimeBucket("overdue", "2026-08-17")).toBe("2026-08-16");
    expect(suggestedDueForTimeBucket("today", "2026-08-17")).toBe("2026-08-17");
    expect(suggestedDueForTimeBucket("week", "2026-08-17")).toBe("2026-08-20");
    expect(suggestedDueForTimeBucket("later", "2026-08-17")).toBe("2026-08-25");
    expect(suggestedDueForTimeBucket("unscheduled", "2026-08-17")).toBeUndefined();
  });

  it("maps standalone task-board drops to confirmable task patches", () => {
    expect(suggestedTaskBoardDrop("due", "2026-08-18", false)).toEqual({ due: "2026-08-18" });
    expect(suggestedTaskBoardDrop("next-seven", "2026-08-18", false)).toEqual({ due: "2026-08-21" });
    expect(suggestedTaskBoardDrop("backlog", "2026-08-18", true)).toEqual({ completed: false, due: "2026-08-26" });
    expect(suggestedTaskBoardDrop("undated", "2026-08-18", false)).toEqual({ due: null });
    expect(suggestedTaskBoardDrop("done", "2026-08-18", false)).toEqual({ completed: true });
  });

  it("derives task board columns without changing task files", () => {
    expect(taskTimeBucket(task({ due: "2026-08-11" }), "2026-08-12", "2026-08-19")).toBe("overdue");
    expect(taskTimeBucket(task({ scheduled: "2026-08-12" }), "2026-08-12", "2026-08-19")).toBe("today");
    expect(taskTimeBucket(task({ due: "2026-08-16" }), "2026-08-12", "2026-08-19")).toBe("week");
    expect(taskTimeBucket(task(), "2026-08-12", "2026-08-19")).toBe("unscheduled");
  });

  it("derives the four quadrants from priority and date", () => {
    expect(taskQuadrant(task({ priority: "high", due: "2026-08-12" }), "2026-08-12", "2026-08-14")).toBe("important-urgent");
    expect(taskQuadrant(task({ priority: "high", due: "2026-09-01" }), "2026-08-12", "2026-08-14")).toBe("important");
    expect(taskQuadrant(task({ priority: "normal", due: "2026-08-13" }), "2026-08-12", "2026-08-14")).toBe("urgent");
    expect(taskQuadrant(task(), "2026-08-12", "2026-08-14")).toBe("later");
  });

  it("recognizes waiting and recurring task conventions", () => {
    expect(isWaitingTask(task({ text: "等待客户确认方案" }))).toBe(true);
    expect(isRecurringTask(task({ text: "每周整理项目进度 🔁" }))).toBe(true);
    expect(isWaitingTask(task({ text: "完成接口开发" }))).toBe(false);
  });

  it("calculates project health, progress and reasons read-only", () => {
    const now = new Date("2026-08-12T12:00:00Z").getTime();
    const health = calculateProjectHealth(
      { due: "2026-08-10", updatedAt: now - 20 * 86_400_000 },
      [task({ completed: true }), task({ id: "late", due: "2026-08-11" })],
      "2026-08-12",
      now
    );
    expect(health.level).toBe("risk");
    expect(health.progress).toBe(50);
    expect(health.dueSoon).toBe(0);
    expect(health.unscheduled).toBe(0);
    expect(health.reasons).toEqual(expect.arrayContaining(["1 项任务逾期", "项目目标日期已过", "超过 14 天没有更新"]));
    expect(dateAfter("2026-08-12", 7)).toBe("2026-08-19");
  });

  it("counts near-term and unscheduled work and flags large backlogs", () => {
    const tasks = [
      task({ id: "today", due: "2026-08-12" }),
      task({ id: "scheduled", scheduled: "2026-08-15" }),
      ...Array.from({ length: 8 }, (_, index) => task({ id: `open-${index}` }))
    ];
    const health = calculateProjectHealth({ detail: "完成接口联调" }, tasks, "2026-08-12");
    expect(health.dueSoon).toBe(2);
    expect(health.unscheduled).toBe(8);
    expect(health.open).toBe(10);
    expect(health.reasons).toContain("10 项待处理任务积压");
    expect(health.level).toBe("attention");
  });

  it("groups client follow-up dates without writing client files", () => {
    expect(clientFollowupBucket(undefined, "2026-08-23", "2026-08-30")).toBe("unscheduled");
    expect(clientFollowupBucket("2026-08-22", "2026-08-23", "2026-08-30")).toBe("overdue");
    expect(clientFollowupBucket("2026-08-23", "2026-08-23", "2026-08-30")).toBe("today");
    expect(clientFollowupBucket("2026-08-29", "2026-08-23", "2026-08-30")).toBe("week");
    expect(clientFollowupBucket("2026-09-01", "2026-08-23", "2026-08-30")).toBe("later");
  });
});
