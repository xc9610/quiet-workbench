import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_SETTINGS,
  parseHeroCopyLines,
  selectHeroCopy,
  serializeHeroCopies
} from "../src/core/hero-copy";
import { buildHeroContext, buildHeroMetrics } from "../src/domain/hero-metrics";

const emptyContext = { overdue: 0, dueToday: 0, upcoming: 0, missingNext: 0 };

describe("hero copy", () => {
  it("matches the active project task scope and accepts tasks as a next action", () => {
    const context = buildHeroContext({
      projects: [{ path: "active.md" }, { path: "empty.md" }],
      tasks: [
        { path: "active.md", scope: "project", completed: false, due: "2026-08-01" },
        { path: "closed.md", scope: "project", completed: false, due: "2026-08-01" }
      ]
    }, "2026-09-09");
    expect(context.overdue).toBe(1);
    expect(context.missingNext).toBe(1);
  });

  it("keeps the daily copy stable for the same local date", () => {
    expect(selectHeroCopy(DEFAULT_HERO_SETTINGS, "2026-08-27", emptyContext))
      .toEqual(selectHeroCopy(DEFAULT_HERO_SETTINGS, "2026-08-27", emptyContext));
  });

  it("rotates built-in daily copy across a date range", () => {
    const titles = new Set(Array.from({ length: 12 }, (_, index) =>
      selectHeroCopy(DEFAULT_HERO_SETTINGS, `2026-09-${String(index + 1).padStart(2, "0")}`, emptyContext).title
    ));
    expect(titles.size).toBeGreaterThan(1);
  });

  it("uses contextual copy only in contextual mode", () => {
    const result = selectHeroCopy({ mode: "contextual", customCopies: [] }, "2026-08-27", { ...emptyContext, overdue: 3 });
    expect(result.title).toBe("先收拢，再出发");
    expect(result.subtitle).toContain("逾期");
  });

  it("rotates valid custom copy and ignores incomplete lines", () => {
    const copies = parseHeroCopyLines("第一句｜第一条说明\n无效行\n第二句 | 第二条说明");
    expect(copies).toEqual([
      { title: "第一句", subtitle: "第一条说明" },
      { title: "第二句", subtitle: "第二条说明" }
    ]);
    expect(serializeHeroCopies(copies)).toBe("第一句｜第一条说明\n第二句｜第二条说明");
    expect(["第一句", "第二句"]).toContain(selectHeroCopy({ mode: "custom", customCopies: copies }, "2026-08-27", emptyContext).title);
  });

  it("falls back to built-in copy when the custom library is empty", () => {
    const result = selectHeroCopy({ mode: "custom", customCopies: [] }, "2026-08-27", emptyContext);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.subtitle.length).toBeGreaterThan(0);
  });

  it("summarizes only actionable tasks for a stable date", () => {
    const context = buildHeroContext({
      tasks: [
        { completed: false, due: "2026-08-30" },
        { completed: false, scheduled: "2026-08-31", due: "2026-09-09" },
        { completed: false, due: "2026-09-04" },
        { completed: true, due: "2026-08-30" },
        { completed: false, migrated: true, due: "2026-08-30" }
      ],
      projects: [{ detail: "下一步" }, { detail: "  " }]
    }, "2026-08-31");

    expect(context).toEqual({ overdue: 1, dueToday: 1, upcoming: 1, missingNext: 1 });
    expect(buildHeroMetrics(context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "逾期任务", value: 1, tone: "danger" }),
      expect.objectContaining({ label: "今日待办", value: 1, tone: "accent" })
    ]));
  });
});
