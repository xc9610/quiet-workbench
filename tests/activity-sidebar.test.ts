import { describe, expect, it } from "vitest";
import { activityLevel, activityStats, buildActivityCalendar } from "../src/domain/activity";
import { resolveSidebarProfile, sidebarTaskSource } from "../src/core/sidebar-context";

describe("activity heatmap", () => {
  it("builds a Monday-aligned 53 week calendar and stable levels", () => {
    const cells = buildActivityCalendar([
      { date: "2026-08-25", count: 1 },
      { date: "2026-08-26", count: 2 },
      { date: "2026-08-27", count: 4 }
    ], new Date(2026, 7, 27));
    expect(cells).toHaveLength(371);
    expect(new Date(`${cells[0].date}T12:00:00`).getDay()).toBe(1);
    expect(cells.find((cell) => cell.date === "2026-08-27")?.level).toBe(4);
    expect(activityLevel(0, 4)).toBe(0);
  });

  it("calculates totals and current/longest streaks", () => {
    expect(activityStats([
      { date: "2026-08-23", count: 1 },
      { date: "2026-08-24", count: 2 },
      { date: "2026-08-26", count: 1 },
      { date: "2026-08-27", count: 3 }
    ], new Date(2026, 7, 27))).toEqual({ total: 7, activeDays: 4, currentStreak: 2, longestStreak: 2 });
  });
});

describe("contextual sidebar routing", () => {
  const base = { title: "", relatedProjects: [], tasks: [], meetings: [] };
  it("prioritizes app surfaces and routes entity notes", () => {
    expect(resolveSidebarProfile({ ...base, surface: "workbench" })).toBe("workbench");
    expect(resolveSidebarProfile({ ...base, surface: "task-board" })).toBe("task-board");
    expect(resolveSidebarProfile({ ...base, surface: "note", kind: "project" })).toBe("project");
    expect(resolveSidebarProfile({ ...base, surface: "note", kind: "client" })).toBe("client");
    expect(resolveSidebarProfile({ ...base, surface: "note", kind: "supplier" })).toBe("supplier");
    expect(resolveSidebarProfile({ ...base, surface: "note", kind: "meeting" })).toBe("meeting");
    expect(resolveSidebarProfile({ ...base, surface: "note", kind: "knowledge" })).toBe("knowledge");
    expect(resolveSidebarProfile({ ...base, surface: "note" })).toBe("note");
  });

  it("uses contextual tasks for entity notes and global tasks elsewhere", () => {
    const contextual = ["project task"];
    const global = ["global task"];
    expect(sidebarTaskSource({ surface: "note", kind: "project" }, contextual, global)).toBe(contextual);
    expect(sidebarTaskSource({ surface: "note", kind: "client" }, contextual, global)).toBe(contextual);
    expect(sidebarTaskSource({ surface: "workbench" }, contextual, global)).toBe(global);
    expect(sidebarTaskSource({ surface: "note" }, contextual, global)).toBe(global);
  });
});
